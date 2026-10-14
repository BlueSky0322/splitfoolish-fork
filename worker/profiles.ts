// User profiles (what others see: display name, picture, payment methods) and settings
// (private preferences that follow the account between devices). A profile row is
// made the first time someone saves anything; until then everything has its default.

import {
  BANK_TRANSFER,
  MAX_ACCOUNT_NAME,
  MAX_BANK,
  MAX_METHOD_DETAIL,
  MAX_METHOD_TYPE,
  type PaymentMethod,
  needsDetail,
} from '../shared/payments';

export const ACCENTS = ['blurple', 'blue', 'teal', 'green', 'amber', 'rose'] as const;
export const CURRENCY = /^[A-Z]{3}$/;

const MAX_DISPLAY_NAME = 32;
const MAX_METHODS = 10;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export type { PaymentMethod };

/** Each setting's column and allowed values (null: any currency code, or none) */
const SETTINGS = {
  theme: { column: 'theme', values: ['dark', 'light', 'auto'] },
  accent: { column: 'accent', values: ACCENTS },
  lastCurrency: { column: 'last_currency', values: null },
  sidebarOpen: { column: 'sidebar_open', values: [true, false] },
  itemsView: { column: 'items_view', values: ['card', 'table'] },
  itemsGroupBy: { column: 'items_group_by', values: ['none', 'day', 'payer', 'category'] },
  itemsSortKey: { column: 'items_sort_key', values: ['date', 'name', 'payer', 'amount'] },
  itemsSortDir: { column: 'items_sort_dir', values: ['asc', 'desc'] },
} as const;

type SettingKey = keyof typeof SETTINGS;
type SettingChanges = Partial<Record<SettingKey, string | boolean | null>>;

// The same defaults as the user_settings table
const DEFAULT_SETTINGS = {
  theme: 'auto',
  accent: 'blurple',
  lastCurrency: null as string | null,
  sidebarOpen: true,
  itemsView: 'card',
  itemsGroupBy: 'day',
  itemsSortKey: 'date',
  itemsSortDir: 'asc',
};

/** Makes the profile row if there isn't one, so rows that belong to it can be added */
export const ensureProfile = (db: D1Database, email: string) =>
  db
    .prepare('INSERT OR IGNORE INTO profiles (email, created_at, updated_at) VALUES (?1, ?2, ?2)')
    .bind(email, Date.now());

export async function getProfile(db: D1Database, email: string) {
  const [profile, settings, avatar, methods] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT display_name AS displayName FROM profiles WHERE email = ?').bind(email),
    db
      .prepare(
        `SELECT theme, accent, last_currency AS lastCurrency, sidebar_open AS sidebarOpen,
           items_view AS itemsView, items_group_by AS itemsGroupBy,
           items_sort_key AS itemsSortKey, items_sort_dir AS itemsSortDir
         FROM user_settings WHERE email = ?`,
      )
      .bind(email),
    db.prepare('SELECT version FROM avatars WHERE email = ?').bind(email),
    db
      .prepare(
        `SELECT id, type, detail, bank, account_name AS accountName,
           is_preferred AS isPreferred FROM payment_methods
         WHERE email = ? ORDER BY position`,
      )
      .bind(email),
  ]);
  const saved = settings.results[0] as unknown as typeof DEFAULT_SETTINGS | undefined;
  const all = methods.results as unknown as (PaymentMethod & { isPreferred: number })[];
  return {
    email,
    displayName: (profile.results[0]?.displayName as string | null | undefined) ?? null,
    avatarVersion: (avatar.results[0]?.version as number | undefined) ?? null,
    paymentMethods: all.map(({ id, type, detail, bank, accountName }) => ({
      id,
      type,
      detail,
      bank,
      accountName,
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
  // Column names come from SETTINGS, never from the request
  const columns = keys.map((k) => SETTINGS[k].column);
  const values = keys.map((k) => {
    const v = changes[k];
    return typeof v === 'boolean' ? Number(v) : v ?? null;
  });
  return [
    ensureProfile(db, email),
    db
      .prepare(
        `INSERT INTO user_settings (email, ${columns.join(', ')}, updated_at)
         VALUES (?, ${columns.map(() => '?').join(', ')}, ?)
         ON CONFLICT (email) DO UPDATE SET
           ${columns.map((c) => `${c} = excluded.${c}`).join(', ')},
           updated_at = excluded.updated_at`,
      )
      .bind(email, ...values, Date.now()),
  ];
}

/** Checks the settings in a request; returns the changes, or why they're refused */
function readSettings(raw: unknown): SettingChanges | string {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return 'Invalid settings';
  const changes: SettingChanges = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!Object.hasOwn(SETTINGS, key)) return `Unknown setting ${key}`;
    const spec = SETTINGS[key as SettingKey];
    if (spec.values == null) {
      if (value !== null && (typeof value !== 'string' || !CURRENCY.test(value))) {
        return 'Invalid currency';
      }
    } else if (!(spec.values as readonly unknown[]).includes(value)) {
      return `Invalid ${key}`;
    }
    changes[key as SettingKey] = value as string | boolean | null;
  }
  return changes;
}

/** PATCH /api/me: { displayName?, settings? } */
export async function patchProfile(db: D1Database, email: string, body: Record<string, unknown>) {
  const statements: D1PreparedStatement[] = [];

  if ('displayName' in body) {
    const raw = body.displayName;
    if (raw != null && typeof raw !== 'string') return json({ error: 'Invalid name' }, 400);
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (name.length > MAX_DISPLAY_NAME) {
      return json({ error: `Display name can be up to ${MAX_DISPLAY_NAME} characters` }, 400);
    }
    statements.push(
      ensureProfile(db, email),
      db
        .prepare('UPDATE profiles SET display_name = ?, updated_at = ? WHERE email = ?')
        .bind(name || null, Date.now(), email),
    );
  }

  if ('settings' in body) {
    const changes = readSettings(body.settings);
    if (typeof changes === 'string') return json({ error: changes }, 400);
    statements.push(...settingsStatements(db, email, changes));
  }

  if (statements.length > 0) await db.batch(statements);
  return json(await getProfile(db, email));
}

/** Replaces the whole list of payment methods, and which one is preferred */
export async function putPaymentMethods(
  db: D1Database,
  email: string,
  body: Record<string, unknown>,
) {
  const methods = body.methods;
  if (!Array.isArray(methods) || methods.length > MAX_METHODS) {
    return json({ error: `You can save up to ${MAX_METHODS} payment methods` }, 400);
  }
  const clean: PaymentMethod[] = [];
  for (const m of methods as Record<string, unknown>[]) {
    const id = typeof m?.id === 'string' && /^[0-9a-f]{16}$/.test(m.id) ? m.id : null;
    const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
    const type = text(m?.type);
    const detail = text(m?.detail);
    if (id == null || clean.some((c) => c.id === id)) {
      return json({ error: 'Invalid payment method' }, 400);
    }
    if (
      !type ||
      type.length > MAX_METHOD_TYPE ||
      (!detail && needsDetail(type)) ||
      detail.length > MAX_METHOD_DETAIL
    ) {
      return json({ error: 'Each payment method needs a type and details' }, 400);
    }
    // Only bank transfers name a bank and an account holder
    const isBank = type === BANK_TRANSFER;
    const bank = isBank ? text(m?.bank) : '';
    const accountName = isBank ? text(m?.accountName) : '';
    if (bank.length > MAX_BANK || accountName.length > MAX_ACCOUNT_NAME) {
      return json({ error: 'The bank or account name is too long' }, 400);
    }
    clean.push({ id, type, detail, bank: bank || null, accountName: accountName || null });
  }

  const preferred =
    typeof body.preferredId === 'string' && clean.some((m) => m.id === body.preferredId)
      ? body.preferredId
      : clean[0]?.id ?? null;

  try {
    await db.batch([
      ensureProfile(db, email),
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
            m.bank ?? null,
            m.accountName ?? null,
            position,
            m.id === preferred ? 1 : 0,
          ),
      ),
    ]);
  } catch (err) {
    // An id already used by someone else's method
    if (String(err).includes('CONSTRAINT')) return json({ error: 'Invalid payment method' }, 400);
    throw err;
  }
  return json(await getProfile(db, email));
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
      `SELECT pm.email, pm.id, pm.type, pm.detail, pm.bank, pm.account_name AS accountName
       FROM payment_methods pm
       JOIN split_members m ON m.email = pm.email AND m.split_id = ?
       ORDER BY pm.is_preferred DESC, pm.position`,
    )
    .bind(splitId),
];

export function assembleMembers([members, methods]: D1Result<Record<string, unknown>>[]) {
  const byEmail = new Map<string, PaymentMethod[]>();
  for (const m of methods.results as unknown as (PaymentMethod & { email: string })[]) {
    byEmail.set(m.email, [
      ...(byEmail.get(m.email) ?? []),
      { id: m.id, type: m.type, detail: m.detail, bank: m.bank, accountName: m.accountName },
    ]);
  }
  return (
    members.results as unknown as {
      email: string;
      role: string;
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
