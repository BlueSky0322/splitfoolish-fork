import type { Person } from '@shared/types';
import { toCents } from '@shared/rates';
import { categoryKey, categoryLabel } from './categories';
import type { SplitTotals } from './derive';
import type { SplitItem } from './state';

// Where a split's money went, as the Spending chart shows it: whole cents, largest
// first. Payments between people aren't spending, so they never count here.

/** One item's part of a slice: its cost, or a person's share of it */
export interface Part {
  itemId: string;
  cents: number;
}

/** One slice of the spending: what it is, how much, and the items that make it up */
export interface Slice {
  /** A category key, a person id, or REST for the folded tail */
  key: string;
  label: string;
  cents: number;
  /** Largest first */
  parts: Part[];
}

/** The key of the slice the smaller categories are folded into */
export const REST = 'rest';

/** How many slices the chart shows apart before the rest fold into one */
export const MAX_SLICES = 5;

const byCents = (a: { cents: number }, b: { cents: number }) => b.cents - a.cents;

const sorted = (slices: Slice[]) =>
  slices
    .filter((s) => s.cents > 0)
    .map((s) => ({ ...s, parts: [...s.parts].sort(byCents) }))
    .sort((a, b) => byCents(a, b) || a.label.localeCompare(b.label));

/** Adds one item's part to the slice kept under `key`, starting it with `label` */
function add(slices: Map<string, Slice>, key: string, label: string, part: Part) {
  const slice = slices.get(key) ?? { key, label, cents: 0, parts: [] };
  slice.cents += part.cents;
  slice.parts.push(part);
  slices.set(key, slice);
}

/** Each category's items added up; items without one count as Other */
export function byCategory(items: SplitItem[]): Slice[] {
  const slices = new Map<string, Slice>();
  for (const item of items) {
    add(slices, categoryKey(item.category), categoryLabel(item.category), {
      itemId: item.id,
      cents: toCents(item.cost),
    });
  }
  return sorted([...slices.values()]);
}

/** What each person paid out, by the items they paid for */
export function byPayer(items: SplitItem[], people: Person[]): Slice[] {
  const names = new Map(people.map((p) => [p.id, p.name]));
  const slices = new Map<string, Slice>();
  for (const item of items) {
    const name = names.get(item.payer.id);
    if (name == null) continue;
    add(slices, item.payer.id, name, { itemId: item.id, cents: toCents(item.cost) });
  }
  return sorted([...slices.values()]);
}

/** What each person's share of the items comes to, whoever paid */
export function byShare(items: SplitItem[], people: Person[], totals: SplitTotals): Slice[] {
  const names = new Map(people.map((p) => [p.id, p.name]));
  const slices = new Map<string, Slice>();
  for (const item of items) {
    for (const [personId, cents] of totals.sharesByItem.get(item.id) ?? []) {
      const name = names.get(personId);
      if (name != null && cents > 0) add(slices, personId, name, { itemId: item.id, cents });
    }
  }
  return sorted([...slices.values()]);
}

/**
 * The first `max` slices as they are and the rest folded into one, so the ring never
 * has more colours than can be told apart; nothing folds when it would fold one alone
 */
export function foldTail(slices: Slice[], max = MAX_SLICES): Slice[] {
  if (slices.length <= max + 1) return slices;
  const tail = slices.slice(max);
  return [
    ...slices.slice(0, max),
    {
      key: REST,
      label: 'Everything else',
      cents: tail.reduce((sum, s) => sum + s.cents, 0),
      parts: tail.flatMap((s) => s.parts).sort(byCents),
    },
  ];
}

/**
 * A slice cut the other way, largest first: a category by who paid for it, a person's
 * spending by category
 */
export function crossCut(slice: Slice, by: 'payer' | 'category', items: SplitItem[]) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const cut = new Map<string, { key: string; label: string; cents: number }>();
  for (const part of slice.parts) {
    const item = byId.get(part.itemId);
    if (item == null) continue;
    const [key, label] =
      by === 'payer'
        ? [item.payer.id, item.payer.name]
        : [categoryKey(item.category), categoryLabel(item.category)];
    const entry = cut.get(key) ?? { key, label, cents: 0 };
    entry.cents += part.cents;
    cut.set(key, entry);
  }
  return [...cut.values()].sort((a, b) => byCents(a, b) || a.label.localeCompare(b.label));
}

/** A slice's share of the whole, as a whole percentage */
export const percentOf = (cents: number, totalCents: number) =>
  totalCents === 0 ? 0 : Math.round((cents / totalCents) * 100);
