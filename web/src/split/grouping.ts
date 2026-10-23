import type { Settings } from '@shared/api';
import type { SplitItem } from './state';
import { categoryLabel } from './categories';
import { toCents } from '@shared/rates';

export type GroupBy = Settings['itemsGroupBy'];
export type SortKey = Settings['itemsSortKey'];
export type SortDir = Settings['itemsSortDir'];

export interface ItemGroup {
  key: string;
  label: string;
  items: SplitItem[];
  subtotalCents: number;
  /** Grouped by day: the start of that day, so an item can be added to it */
  day?: number;
}

export const GROUP_LABELS: Record<GroupBy, string> = {
  none: 'No grouping',
  day: 'By day',
  week: 'By week',
  month: 'By month',
  payer: 'By payer',
  category: 'By category',
};

/** The day a time falls on, as YYYY-MM-DD in local time */
export const dayKey = (time: number) => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
};

/** "Sat 11 Oct" */
export const dayLabel = (time: number) =>
  new Date(time).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

/** The start of the week (Monday) a time falls in, in local time */
export const weekStart = (time: number) => {
  const d = new Date(time);
  const sinceMonday = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - sinceMonday);
};

/** "6–12 Oct", or "29 Sep – 5 Oct" when a week straddles two months (years, if two) */
export const weekLabel = (time: number) => {
  const from = weekStart(time);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6);
  const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
  const sameYear = from.getFullYear() === to.getFullYear();
  const ends: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  };
  if (sameMonth) {
    // The month once, after both days: "6–12 Oct"
    const parts = new Intl.DateTimeFormat(undefined, ends).formatToParts(to);
    const month = parts.find((p) => p.type === 'month')?.value ?? '';
    const dayFirst =
      parts.findIndex((p) => p.type === 'day') < parts.findIndex((p) => p.type === 'month');
    return dayFirst
      ? `${from.getDate()}–${to.getDate()} ${month}`
      : `${month} ${from.getDate()}–${to.getDate()}`;
  }
  return `${from.toLocaleDateString(undefined, ends)} – ${to.toLocaleDateString(undefined, ends)}`;
};

/** The month a time falls in, as YYYY-MM in local time */
export const monthKey = (time: number) => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** "October 2026" */
export const monthLabel = (time: number) =>
  new Date(time).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

const compare = (key: SortKey) => (a: SplitItem, b: SplitItem) => {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    case 'payer':
      return a.payer.name.localeCompare(b.payer.name, undefined, { sensitivity: 'base' });
    case 'amount':
      return a.cost - b.cost;
    case 'date':
      return a.createdAt - b.createdAt;
  }
};

export function sortItems(items: SplitItem[], key: SortKey, dir: SortDir): SplitItem[] {
  const by = compare(key);
  // Ties keep the order items were added in
  return [...items].sort(
    (a, b) => (dir === 'asc' ? by(a, b) : by(b, a)) || a.createdAt - b.createdAt,
  );
}

/** Items in groups, each sorted; groups follow the order of their first item */
export function groupItems(
  items: SplitItem[],
  groupBy: GroupBy,
  key: SortKey,
  dir: SortDir,
): ItemGroup[] {
  const sorted = sortItems(items, key, dir);
  if (groupBy === 'none') {
    return [
      {
        key: 'all',
        label: 'All items',
        items: sorted,
        subtotalCents: sorted.reduce((sum, i) => sum + toCents(i.cost), 0),
      },
    ];
  }

  const groups = new Map<string, ItemGroup>();
  for (const item of sorted) {
    const [groupKey, label] =
      groupBy === 'day'
        ? [dayKey(item.createdAt), dayLabel(item.createdAt)]
        : groupBy === 'week'
          ? [dayKey(weekStart(item.createdAt).getTime()), weekLabel(item.createdAt)]
          : groupBy === 'month'
            ? [monthKey(item.createdAt), monthLabel(item.createdAt)]
            : groupBy === 'payer'
              ? [item.payer.id, item.payer.name]
              : [item.category ?? '', categoryLabel(item.category)];
    let group = groups.get(groupKey);
    if (group == null) {
      group = { key: groupKey, label, items: [], subtotalCents: 0 };
      if (groupBy === 'day') {
        const d = new Date(item.createdAt);
        group.day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      }
      groups.set(groupKey, group);
    }
    group.items.push(item);
    group.subtotalCents += toCents(item.cost);
  }
  return [...groups.values()];
}

/** The sorts a phone's sort menu offers */
export const MOBILE_SORTS: { key: SortKey; dir: SortDir; label: string }[] = [
  { key: 'date', dir: 'desc', label: 'Newest' },
  { key: 'date', dir: 'asc', label: 'Oldest' },
  { key: 'amount', dir: 'desc', label: 'Largest' },
  { key: 'name', dir: 'asc', label: 'A–Z' },
];
