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

// Item categories. The key is what's stored; anything else stored shows as typed.
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

export const categoryLabel = (key: string | null) =>
  key == null ? 'Uncategorised' : byKey.get(key)?.label ?? key;

export const categoryIcon = (key: string | null) =>
  key == null ? null : byKey.get(key)?.icon ?? null;
