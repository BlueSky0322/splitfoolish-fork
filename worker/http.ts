// Small helpers every part of the API uses to answer and to read what it was sent

/** Responds with JSON. Pass the response's type (json<SplitDetail>(…)) to check it. */
export const json = <T>(body: T, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' },
  });

export const notFound = () => json({ error: 'Not found' }, 404);

/** A new id for a row: 16 hex characters */
export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

/** The longest name a split, person or item can have */
export const MAX_NAME_LENGTH = 80;

/** A name as sent, trimmed; null when it's missing, empty or too long */
export const readName = (value: unknown) => {
  const name = typeof value === 'string' ? value.trim() : '';
  return name.length > 0 && name.length <= MAX_NAME_LENGTH ? name : null;
};
