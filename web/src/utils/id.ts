/** A new id for a split, person, item or payment method, shaped as ROW_ID_CHARS in shared/api.ts */
export const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
