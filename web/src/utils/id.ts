/** A new id for a split, person, item or payment method: 16 hex characters, as the server makes them */
export const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
