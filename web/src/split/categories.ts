import type { Icon } from '@phosphor-icons/react';
import {
  Bed,
  Car,
  DotsThreeCircle,
  ForkKnife,
  Receipt,
  ShoppingBag,
  ShoppingCart,
  Waves,
} from '@phosphor-icons/react';

// Item categories. The key is what's stored; anything else stored shows as typed. An
// item with none stored is Other wherever categories show, so nothing is ever left out
// of a grouping or the Spending chart.
export const CATEGORIES: { key: string; label: string; icon: Icon }[] = [
  { key: 'food', label: 'Food', icon: ForkKnife },
  { key: 'transport', label: 'Transport', icon: Car },
  { key: 'activities', label: 'Activities', icon: Waves },
  { key: 'groceries', label: 'Groceries', icon: ShoppingCart },
  { key: 'accommodation', label: 'Accommodation', icon: Bed },
  { key: 'shopping', label: 'Shopping', icon: ShoppingBag },
  { key: 'bills', label: 'Bills', icon: Receipt },
  { key: 'other', label: 'Other', icon: DotsThreeCircle },
];

const byKey = new Map(CATEGORIES.map((c) => [c.key, c]));

/** The category an item counts under: the one stored, or Other */
export const OTHER = 'other';
export const categoryKey = (key: string | null) => key ?? OTHER;

export const categoryLabel = (key: string | null) =>
  byKey.get(categoryKey(key))?.label ?? key ?? OTHER;

export const categoryIcon = (key: string | null) => byKey.get(categoryKey(key))?.icon ?? null;
