// Wording that depends on a number

/** "1 item", "3 items"; `many` for words that don't just take an s ("people") */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
