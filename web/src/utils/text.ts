// Wording that depends on a number

/** "1 item", "3 items"; `many` for words that don't just take an s ("people") */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A run of text, or a web address in it with where it goes */
export interface TextPart {
  text: string;
  href?: string;
}

// http(s) addresses and www. ones, up to a space or a quote; punctuation after an
// address, and a bracket that closes none opened in it, belong to the sentence
const ADDRESS = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING = /[.,;:!?)\]}]$/;

/** Longer addresses are cut, so a link reads as where it goes rather than all of it */
const SHORT_LINK_LENGTH = 32;

/** A web address as a person reads it: "example.com/menu", without https:// or www. */
export function shortLink(href: string) {
  const bare = href
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '');
  return bare.length <= SHORT_LINK_LENGTH ? bare : `${bare.slice(0, SHORT_LINK_LENGTH - 1)}…`;
}

/** Text split into its plain runs and the web addresses typed in it, in order */
export function findLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let from = 0;
  for (const match of text.matchAll(ADDRESS)) {
    let address = match[0];
    while (TRAILING.test(address)) {
      const last = address.at(-1)!;
      const opener = { ')': '(', ']': '[', '}': '{' }[last];
      if (opener != null && address.split(opener).length > address.split(last).length - 1) break;
      address = address.slice(0, -1);
    }
    const at = match.index;
    if (at > from) parts.push({ text: text.slice(from, at) });
    parts.push({ text: address, href: /^www\./i.test(address) ? `https://${address}` : address });
    from = at + address.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from) });
  return parts;
}
