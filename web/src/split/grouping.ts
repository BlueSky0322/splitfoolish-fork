import type { Settings } from '../../../shared/api';
import type { SplitItem } from './state';
import { categoryLabel } from './categories';
import { toCents } from '../../../shared/rates';

export type GroupBy = Settings['itemsGroupBy'];
export type SortKey = Settings['itemsSortKey'];
export type SortDir = Settings['itemsSortDir'];

export interface ItemGroup {
  key: string;
  label: string;
  items: SplitItem[];
  subtotalCents: number;
}

export const GROUP_LABELS: Record<GroupBy, string> = {
  none: 'No grouping',
  day: 'By day',
  payer: 'By payer',
  category: 'By category',
};

const dayKey = (time: number) => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
};

const dayLabel = (time: number) =>
  new Date(time).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

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
        : groupBy === 'payer'
          ? [item.payer.id, item.payer.name]
          : [item.category ?? '', categoryLabel(item.category)];
    let group = groups.get(groupKey);
    if (group == null) {
      group = { key: groupKey, label, items: [], subtotalCents: 0 };
      groups.set(groupKey, group);
    }
    group.items.push(item);
    group.subtotalCents += toCents(item.cost);
  }
  return [...groups.values()];
}

/** The phone's sort pill cycles through these */
export const MOBILE_SORTS: { key: SortKey; dir: SortDir; label: string }[] = [
  { key: 'date', dir: 'desc', label: 'Newest' },
  { key: 'date', dir: 'asc', label: 'Oldest' },
  { key: 'amount', dir: 'desc', label: 'Largest' },
  { key: 'name', dir: 'asc', label: 'A–Z' },
];
