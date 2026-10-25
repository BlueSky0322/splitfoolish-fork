import type { Person } from '@shared/types';
import { toCents } from '@shared/rates';
import { categoryKey, categoryLabel } from './categories';
import type { SplitTotals } from './derive';
import type { SplitItem } from './state';

// Where a split's money went, as the Spending chart shows it: whole cents, largest
// first. Payments between people aren't spending, so they never count here.

/** One slice of the spending: what it is, how much, and over how many items */
export interface Slice {
  /** A category key, a person id, or REST for the folded tail */
  key: string;
  label: string;
  cents: number;
  /** How many items make it up; a person's share counts every item they're on */
  count: number;
}

/** The key of the slice the smaller categories are folded into */
export const REST = 'rest';

/** How many slices the chart shows apart before the rest fold into one */
export const MAX_SLICES = 5;

const sorted = (slices: Slice[]) =>
  slices
    .filter((s) => s.cents > 0)
    .sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label));

/** Each category's items added up; items without one count as Other */
export function byCategory(items: SplitItem[]): Slice[] {
  const slices = new Map<string, Slice>();
  for (const item of items) {
    const key = categoryKey(item.category);
    const slice = slices.get(key) ?? {
      key,
      label: categoryLabel(item.category),
      cents: 0,
      count: 0,
    };
    slice.cents += toCents(item.cost);
    slice.count += 1;
    slices.set(key, slice);
  }
  return sorted([...slices.values()]);
}

/** What each person paid out, by the items they paid for */
export function byPayer(items: SplitItem[], people: Person[]): Slice[] {
  const slices = new Map(
    people.map((p): [string, Slice] => [p.id, { key: p.id, label: p.name, cents: 0, count: 0 }]),
  );
  for (const item of items) {
    const slice = slices.get(item.payer.id);
    if (slice == null) continue;
    slice.cents += toCents(item.cost);
    slice.count += 1;
  }
  return sorted([...slices.values()]);
}

/** What each person's share of the items comes to, whoever paid */
export function byShare(items: SplitItem[], people: Person[], totals: SplitTotals): Slice[] {
  const slices = new Map(
    people.map((p): [string, Slice] => [
      p.id,
      { key: p.id, label: p.name, cents: totals.balances.get(p.id)?.shareCents ?? 0, count: 0 },
    ]),
  );
  for (const item of items) {
    for (const p of item.participants) {
      const slice = slices.get(p.id);
      if (slice != null) slice.count += 1;
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
      count: tail.reduce((sum, s) => sum + s.count, 0),
    },
  ];
}

/** A slice's share of the whole, as a whole percentage */
export const percentOf = (cents: number, totalCents: number) =>
  totalCents === 0 ? 0 : Math.round((cents / totalCents) * 100);
