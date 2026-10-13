// User profiles: display name, appearance, last-used currency and payment methods.
// A profile row is created on first change; until then everything has its default.

export const ACCENTS = ['blurple', 'blue', 'teal', 'green', 'amber', 'rose'] as const;
const THEMES = ['dark', 'light', 'auto'] as const;
const MAX_DISPLAY_NAME = 32;
const MAX_METHODS = 10;
const MAX_METHOD_TYPE = 32;
const MAX_METHOD_DETAIL = 120;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const CURRENCY = /^[A-Z]{3}$/;

export interface PaymentMethod {
  id: string;
  type: string;
  detail: string;
}

interface ProfileRow {
  displayName: string | null;
  theme: string;
  accent: string;
  lastCurrency: string | null;
  preferredPaymentMethodId: string | null;
  avatarVersion: number | null;
}

export async function getProfile(db: D1Database, email: string) {
  const [profile, methods] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT display_name AS displayName, theme, accent, last_currency AS lastCurrency,
           preferred_payment_method_id AS preferredPaymentMethodId, avatar_version AS avatarVersion
         FROM profiles WHERE email = ?`,
      )
      .bind(email),
    db
      .prepare('SELECT id, type, detail FROM payment_methods WHERE email = ? ORDER BY position')
      .bind(email),
  ]);
  const row = profile.results[0] as unknown as ProfileRow | undefined;
  return {
    email,
    displayName: row?.displayName ?? null,
    theme: row?.theme ?? 'auto',
    accent: row?.accent ?? 'blurple',
    lastCurrency: row?.lastCurrency ?? null,
    avatarVersion: row?.avatarVersion ?? null,
    paymentMethods: methods.results as unknown as PaymentMethod[],
    preferredPaymentMethodId: row?.preferredPaymentMethodId ?? null,
  };
}

/** Insert-or-update one profile column, creating the profile on first use */
export const setProfileField = (
  db: D1Database,
  email: string,
  column: 'display_name' | 'theme' | 'accent' | 'last_currency' | 'preferred_payment_method_id',
  value: string | null,
) =>
  db
    .prepare(
      `INSERT INTO profiles (email, ${column}, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (email) DO UPDATE SET ${column} = ?2, updated_at = ?3`,
    )
    .bind(email, value, Date.now());

export async function patchProfile(db: D1Database, email: string, body: Record<string, unknown>) {
  const statements: D1PreparedStatement[] = [];

  if ('displayName' in body) {
    const raw = body.displayName;
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (raw != null && typeof raw !== 'string') return json({ error: 'Invalid name' }, 400);
    if (name.length > MAX_DISPLAY_NAME) {
      return json({ error: `Display name can be up to ${MAX_DISPLAY_NAME} characters` }, 400);
    }
    statements.push(setProfileField(db, email, 'display_name', name || null));
  }
  if ('theme' in body) {
    if (!THEMES.includes(body.theme as (typeof THEMES)[number])) {
      return json({ error: 'Invalid theme' }, 400);
    }
    statements.push(setProfileField(db, email, 'theme', body.theme as string));
  }
  if ('accent' in body) {
    if (!ACCENTS.includes(body.accent as (typeof ACCENTS)[number])) {
      return json({ error: 'Invalid accent colour' }, 400);
    }
    statements.push(setProfileField(db, email, 'accent', body.accent as string));
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
    const type = typeof m?.type === 'string' ? m.type.trim() : '';
    const detail = typeof m?.detail === 'string' ? m.detail.trim() : '';
    if (id == null || clean.some((c) => c.id === id)) {
      return json({ error: 'Invalid payment method' }, 400);
    }
    if (!type || type.length > MAX_METHOD_TYPE || !detail || detail.length > MAX_METHOD_DETAIL) {
      return json({ error: 'Each payment method needs a type and details' }, 400);
    }
    clean.push({ id, type, detail });
  }

  const preferred =
    typeof body.preferredId === 'string' && clean.some((m) => m.id === body.preferredId)
      ? body.preferredId
      : clean[0]?.id ?? null;

  await db.batch([
    db.prepare('DELETE FROM payment_methods WHERE email = ?').bind(email),
    ...clean.map((m, position) =>
      db
        .prepare(
          'INSERT INTO payment_methods (id, email, type, detail, position) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(m.id, email, m.type, m.detail, position),
    ),
    setProfileField(db, email, 'preferred_payment_method_id', preferred),
  ]);
  return json(await getProfile(db, email));
}

/**
 * Display names, pictures and payment methods for a split's members, shown to the
 * other members (so people who owe you can see how to pay you).
 */
export const memberProfileStatements = (db: D1Database, splitId: string) => [
  db
    .prepare(
      `SELECT m.email, m.role, p.display_name AS displayName, p.avatar_version AS avatarVersion,
         p.preferred_payment_method_id AS preferredPaymentMethodId
       FROM split_members m LEFT JOIN profiles p ON p.email = m.email
       WHERE m.split_id = ? ORDER BY m.joined_at, m.email`,
    )
    .bind(splitId),
  db
    .prepare(
      `SELECT pm.email, pm.id, pm.type, pm.detail FROM payment_methods pm
       JOIN split_members m ON m.email = pm.email AND m.split_id = ?
       ORDER BY pm.position`,
    )
    .bind(splitId),
];

export function assembleMembers([members, methods]: D1Result<Record<string, unknown>>[]) {
  const byEmail = new Map<string, PaymentMethod[]>();
  for (const m of methods.results as unknown as (PaymentMethod & { email: string })[]) {
    byEmail.set(m.email, [
      ...(byEmail.get(m.email) ?? []),
      { id: m.id, type: m.type, detail: m.detail },
    ]);
  }
  return (
    members.results as unknown as {
      email: string;
      role: string;
      displayName: string | null;
      avatarVersion: number | null;
      preferredPaymentMethodId: string | null;
    }[]
  ).map((m) => {
    const all = byEmail.get(m.email) ?? [];
    // Preferred first, so the app can show it and list the rest as "also accepts"
    const paymentMethods = [
      ...all.filter((p) => p.id === m.preferredPaymentMethodId),
      ...all.filter((p) => p.id !== m.preferredPaymentMethodId),
    ];
    return {
      email: m.email,
      role: m.role,
      displayName: m.displayName,
      avatarVersion: m.avatarVersion,
      paymentMethods,
    };
  });
}
