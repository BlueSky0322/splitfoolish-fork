// Suggesting item names from ones used before, ranked by how well they match what's
// typed: names starting with it, then a word starting with it, then containing it,
// then having its letters in order ("cfe" finds "Coffee"). Ties keep the most recent
// first, the order the names arrive in.

export interface PastItemName {
  name: string;
  category: string | null;
}

const MAX_SUGGESTIONS = 8;

/** Where the names are kept for the app, refreshed after items are saved */
export const ITEM_NAMES_KEY = ['item-names'] as const;

/** Lower is better; null when it doesn't match at all */
function matchRank(name: string, query: string): number | null {
  const n = name.toLowerCase();
  if (n === query) return null; // Already typed in full: nothing to suggest
  if (n.startsWith(query)) return 0;
  if (n.split(/[\s\-/,.()&]+/).some((word) => word.startsWith(query))) return 1;
  if (n.includes(query)) return 2;
  let at = 0;
  for (const ch of n) if (ch === query[at]) at++;
  return at === query.length ? 3 : null;
}

export function suggestNames(names: PastItemName[], typed: string): PastItemName[] {
  const query = typed.trim().toLowerCase();
  if (query === '') return names.slice(0, MAX_SUGGESTIONS);
  return names
    .map((entry, order) => ({ entry, order, rank: matchRank(entry.name, query) }))
    .filter((m): m is typeof m & { rank: number } => m.rank != null)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, MAX_SUGGESTIONS)
    .map((m) => m.entry);
}
