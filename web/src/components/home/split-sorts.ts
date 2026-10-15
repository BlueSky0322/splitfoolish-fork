import type { SplitSummary } from '@shared/api';
import { quietly } from '../../utils/quietly';

// Ways to order My splits: shared by the phone's Sort and filter sheet and the desktop list

export type SplitSort = 'recent' | 'name' | 'balance';

export const SPLIT_SORT_LABELS: Record<SplitSort, string> = {
  recent: 'Recent activity',
  name: 'Name',
  balance: 'What you owe or are owed',
};

export const isSplitSort = (value: unknown): value is SplitSort =>
  typeof value === 'string' && Object.keys(SPLIT_SORT_LABELS).includes(value);

export const SPLIT_SORTS: Record<SplitSort, (a: SplitSummary, b: SplitSummary) => number> = {
  recent: (a, b) => b.updatedAt - a.updatedAt,
  name: (a, b) => a.name.localeCompare(b.name),
  balance: (a, b) => Math.abs(b.myBalanceCents ?? 0) - Math.abs(a.myBalanceCents ?? 0),
};

const DESKTOP_KEY = 'splitfoolish:desktop-split-sort';

/** The desktop list's order: your own (dragged), or one of the sorts */
export type DesktopSplitSort = SplitSort | 'yours';

export const readDesktopSort = (): DesktopSplitSort => {
  const saved = quietly(() => localStorage.getItem(DESKTOP_KEY));
  return isSplitSort(saved) ? saved : 'yours';
};

export const saveDesktopSort = (sort: DesktopSplitSort) =>
  quietly(() => localStorage.setItem(DESKTOP_KEY, sort));
