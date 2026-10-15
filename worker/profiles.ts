// User profiles (what others see: display name, picture, payment methods) and settings
// (private preferences that follow the account between devices). A profile row is
// made the first time someone saves anything; until then everything has its default.

import type { PaymentMethodsBody, ProfilePatch } from '../shared/api';
import {
  BANK_TRANSFER,
  MAX_ACCOUNT_NAME,
  MAX_BANK,
  MAX_METHODS,
  MAX_METHOD_DETAIL,
  MAX_METHOD_TYPE,
  type PaymentMethod,
  QR_CODE,
  needsDetail,
} from '../shared/payments';
import {
  ACCENTS,
  DEFAULT_SETTINGS,
  ITEMS_GROUPS,
  MAX_DISPLAY_NAME,
  ITEMS_SORT_KEYS,
  ITEMS_VIEWS,
  type Profile,
  RATE_PREFERENCES,
  type RatePreference,
  SORT_DIRS,
  type Settings,
  type SplitMember,
  THEMES,
} from '../shared/api';
import { isCurrency } from '../shared/rates';
import type { Role } from '../shared/types';
import { type Unchecked, json, fail, isClientId, isConstraintError } from './http';

/** Each setting's column and allowed values (null: any currency code, or none) */
const SETTINGS = {
  theme: { column: 'theme', values: THEMES },
  accent: { column: 'accent', values: ACCENTS },
  lastCurrency: { column: 'last_currency', values: null },
  defaultCurrency: { column: 'default_currency', values: null },
  ratePreference: { column: 'rate_preference', values: RATE_PREFERENCES },
  sidebarOpen: { column: 'sidebar_open', values: [true, false] },
  itemsView: { column: 'items_view', values: ITEMS_VIEWS },
  itemsGroupBy: { column: 'items_group_by', values: ITEMS_GROUPS },
  itemsSortKey: { column: 'items_sort_key', values: ITEMS_SORT_KEYS },
  itemsSortDir: { column: 'items_sort_dir', values: SORT_DIRS },
} as const satisfies Record<keyof Settings, unknown>;

type SettingKey = keyof typeof SETTINGS;
type SettingChanges = Partial<Record<SettingKey, string | boolean | null>>;

// A new settings row is written with every one of DEFAULT_SETTINGS (not the table's
// own column defaults), so the defaults can change in shared/api.ts alone.

/** Makes the profile row if there isn't one, so rows that belong to it can be added */
export const ensureProfileStatement = (db: D1Database, email: string) =>
  db
    .prepare('INSERT OR IGNORE INTO profiles (email, created_at, updated_at) VALUES (?1, ?2, ?2)')
    .bind(email, Date.now());

export async function getProfile(db: D1Database, email: string): Promise<Profile> {
  const [profile, settings, avatar, methods] = await db.batch([
    db.prepare('SELECT display_name AS displayName FROM profiles WHERE email = ?').bind(email),
    db
      .prepare(
        `SELECT theme, accent, last_currency AS lastCurrency,
           default_currency AS defaultCurrency, rate_preference AS ratePreference,
           sidebar_open AS sidebarOpen,
           items_view AS itemsView, items_group_by AS itemsGroupBy,
           items_sort_key AS itemsSortKey, items_sort_dir AS itemsSortDir
         FROM user_settings WHERE email = ?`,
      )
      .bind(email),
    db.prepare('SELECT version FROM avatars WHERE email = ?').bind(email),
    db
      .prepare(
        `SELECT pm.id, pm.type, pm.detail, pm.bank, pm.account_name AS accountName,
           q.version AS qrVersion, pm.is_preferred AS isPreferred
         FROM payment_methods pm LEFT JOIN payment_qr_codes q ON q.method_id = pm.id
         WHERE pm.email = ? ORDER BY pm.position`,
      )
      .bind(email),
  ]);
  const saved = settings.results[0] as
    | (Omit<Settings, 'sidebarOpen'> & { sidebarOpen: number })
    | undefined;
  const all = methods.results as (PaymentMethod & { isPreferred: number })[];
  return {
    email,
    displayName:
      (profile.results[0] as { displayName: string | null } | undefined)?.displayName ?? null,
    avatarVersion: (avatar.results[0] as { version: number } | undefined)?.version ?? null,
    paymentMethods: all.map(({ id, type, detail, bank, accountName, qrVersion }) => ({
      id,
      type,
      detail,
      bank,
      accountName,
      qrVersion,
    })),
    preferredPaymentMethodId: all.find((m) => m.isPreferred)?.id ?? null,
    settings: saved
      ? { ...saved, sidebarOpen: Boolean(saved.sidebarOpen) }
      : { ...DEFAULT_SETTINGS },
  };
}

/** Changes some settings, making the settings row (and profile) on first use */
export function settingsStatements(db: D1Database, email: string, changes: SettingChanges) {
  const keys = Object.keys(changes) as SettingKey[];
  if (keys.length === 0) return [];
  // A first row gets every setting: the changes, and the defaults for the rest. An
  // existing row only has the changed ones updated. Column names come from SETTINGS,
  // never from the request.
  const all = Object.keys(SETTINGS) as SettingKey[];
  const value = (k: SettingKey) => {
    const v = Object.hasOwn(changes, k) ? changes[k] : DEFAULT_SETTINGS[k];
    return typeof v === 'boolean' ? Number(v) : v ?? null;
  };
  const changed = keys.map((k) => SETTINGS[k].column);
  return [
    ensureProfileStatement(db, email),
    db
      .prepare(
        `INSERT INTO user_settings (email, ${all.map((k) => SETTINGS[k].column).join(', ')}, updated_at)
         VALUES (?, ${all.map(() => '?').join(', ')}, ?)
         ON CONFLICT (email) DO UPDATE SET
           ${changed.map((c) => `${c} = excluded.${c}`).join(', ')},
           updated_at = excluded.updated_at`,
      )
      .bind(email, ...all.map(value), Date.now()),
  ];
}

/** Checks the settings in a request; returns the changes, or the refusal */
function readSettings(raw: unknown): SettingChanges | Response {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('Invalid settings', 400);
  }
  const changes: SettingChanges = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!Object.hasOwn(SETTINGS, key)) return fail(`Unknown setting ${key}`, 400);
    const spec = SETTINGS[key as SettingKey];
    if (spec.values == null) {
      if (value !== null && !isCurrency(value)) {
        return fail('Invalid currency', 400);
      }
    } else if (!(spec.values as readonly unknown[]).includes(value)) {
      return fail(`Invalid ${key}`, 400);
    }
    changes[key as SettingKey] = value as string | boolean | null;
  }
  return changes;
}

/** PATCH /api/me: { displayName?, settings? } */
export async function patchProfile(db: D1Database, email: string, body: Unchecked<ProfilePatch>) {
  const statements: D1PreparedStatement[] = [];

  if ('displayName' in body) {
    const raw = body.displayName;
    if (raw != null && typeof raw !== 'string') return fail('Invalid name', 400);
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (name.length > MAX_DISPLAY_NAME) {
      return fail(`Display name can be up to ${MAX_DISPLAY_NAME} characters`, 400);
    }
    statements.push(
      ensureProfileStatement(db, email),
      db
        .prepare('UPDATE profiles SET display_name = ?, updated_at = ? WHERE email = ?')
        .bind(name || null, Date.now(), email),
    );
  }

  if ('settings' in body) {
    const changes = readSettings(body.settings);
    if (changes instanceof Response) return changes;
    statements.push(...settingsStatements(db, email, changes));
  }

  if (statements.length > 0) await db.batch(statements);
  return json<Profile>(await getProfile(db, email));
}

/** Replaces the whole list of payment methods, and which one is preferred */
export async function putPaymentMethods(
  db: D1Database,
  email: string,
  body: Unchecked<PaymentMethodsBody>,
) {
  const methods = body.methods;
  if (!Array.isArray(methods) || methods.length > MAX_METHODS) {
    return fail(`You can save up to ${MAX_METHODS} payment methods`, 400);
  }
  const clean: (PaymentMethod & { bank: string | null; accountName: string | null })[] = [];
  for (const m of methods as Record<string, unknown>[]) {
    const id = isClientId(m?.id) ? m.id : null;
    const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
    const type = text(m?.type);
    const detail = text(m?.detail);
    if (id == null || clean.some((c) => c.id === id)) {
      return fail('Invalid payment method', 400);
    }
    if (
      !type ||
      type.length > MAX_METHOD_TYPE ||
      (!detail && needsDetail(type)) ||
      detail.length > MAX_METHOD_DETAIL
    ) {
      return fail('Each payment method needs a type and details', 400);
    }
    // Only bank transfers name a bank and an account holder
    const isBank = type === BANK_TRANSFER;
    const bank = isBank ? text(m?.bank) : '';
    const accountName = isBank ? text(m?.accountName) : '';
    if (bank.length > MAX_BANK || accountName.length > MAX_ACCOUNT_NAME) {
      return fail('The bank or account name is too long', 400);
    }
    clean.push({ id, type, detail, bank: bank || null, accountName: accountName || null });
  }

  // A QR code method needs its image, uploaded first
  const qrIds = clean.filter((m) => m.type === QR_CODE).map((m) => m.id);
  if (qrIds.length > 0) {
    const found = await db
      .prepare(
        `SELECT count(*) AS n FROM payment_qr_codes
         WHERE email = ? AND method_id IN (${qrIds.map(() => '?').join(', ')})`,
      )
      .bind(email, ...qrIds)
      .first<{ n: number }>();
    if ((found?.n ?? 0) !== qrIds.length) {
      return fail('Add the QR code image first', 400);
    }
  }

  const preferred =
    typeof body.preferredId === 'string' && clean.some((m) => m.id === body.preferredId)
      ? body.preferredId
      : clean[0]?.id ?? null;

  try {
    await db.batch([
      ensureProfileStatement(db, email),
      db.prepare('DELETE FROM payment_methods WHERE email = ?').bind(email),
      ...clean.map((m, position) =>
        db
          .prepare(
            `INSERT INTO payment_methods
               (id, email, type, detail, bank, account_name, position, is_preferred)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            m.id,
            email,
            m.type,
            m.detail,
            m.bank,
            m.accountName,
            position,
            m.id === preferred ? 1 : 0,
          ),
      ),
      // Codes whose method was removed, or uploaded and never saved
      db
        .prepare(
          `DELETE FROM payment_qr_codes WHERE email = ?1
           AND method_id NOT IN (SELECT id FROM payment_methods WHERE email = ?1 AND type = ?2)`,
        )
        .bind(email, QR_CODE),
    ]);
  } catch (err) {
    // An id already used by someone else's method
    if (isConstraintError(err)) return fail('Invalid payment method', 400);
    throw err;
  }
  return json<Profile>(await getProfile(db, email));
}

/**
 * Display names, pictures and payment methods for a split's members, shown to the
 * other members (so people who owe you can see how to pay you).
 */
export const memberProfileStatements = (db: D1Database, splitId: string) => [
  db
    .prepare(
      `SELECT m.email, m.role, p.display_name AS displayName, a.version AS avatarVersion
       FROM split_members m
       LEFT JOIN profiles p ON p.email = m.email
       LEFT JOIN avatars a ON a.email = m.email
       WHERE m.split_id = ? ORDER BY m.joined_at, m.email`,
    )
    .bind(splitId),
  db
    .prepare(
      `SELECT pm.email, pm.id, pm.type, pm.detail, pm.bank, pm.account_name AS accountName,
         q.version AS qrVersion
       FROM payment_methods pm
       JOIN split_members m ON m.email = pm.email AND m.split_id = ?
       LEFT JOIN payment_qr_codes q ON q.method_id = pm.id
       ORDER BY pm.is_preferred DESC, pm.position`,
    )
    .bind(splitId),
];

export function assembleMembers([members, methods]: D1Result[]): SplitMember[] {
  const byEmail = new Map<string, PaymentMethod[]>();
  for (const m of methods.results as (PaymentMethod & { email: string })[]) {
    byEmail.set(m.email, [
      ...(byEmail.get(m.email) ?? []),
      {
        id: m.id,
        type: m.type,
        detail: m.detail,
        bank: m.bank,
        accountName: m.accountName,
        qrVersion: m.qrVersion,
      },
    ]);
  }
  return (
    members.results as {
      email: string;
      role: Role;
      displayName: string | null;
      avatarVersion: number | null;
    }[]
  ).map((m) => ({
    email: m.email,
    role: m.role,
    displayName: m.displayName,
    avatarVersion: m.avatarVersion,
    // Preferred first, so the app can show it and list the rest as "also accepts"
    paymentMethods: byEmail.get(m.email) ?? [],
  }));
}

/** Where someone's exchange rates come from: Wise unless they picked the ECB */
export async function getRatePreference(db: D1Database, email: string): Promise<RatePreference> {
  const row = await db
    .prepare('SELECT rate_preference AS ratePreference FROM user_settings WHERE email = ?')
    .bind(email)
    .first<{ ratePreference: RatePreference }>();
  return row?.ratePreference ?? DEFAULT_SETTINGS.ratePreference;
}

/**
 * Whose a payment method id is: the account that saved the method, or that uploaded a
 * QR code for it before saving it. Null when it's no one's yet.
 */
export async function paymentMethodOwner(db: D1Database, id: string) {
  const row = await db
    .prepare(
      `SELECT email FROM payment_methods WHERE id = ?1
       UNION SELECT email FROM payment_qr_codes WHERE method_id = ?1`,
    )
    .bind(id)
    .first<{ email: string }>();
  return row?.email ?? null;
}
