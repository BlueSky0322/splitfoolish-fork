import type { Person } from '@shared/types';
import type { SplitItem } from '../../../split/state';

/** The one person an item is for, when it's on no one else */
export const onlyFor = (item: SplitItem): Person | null =>
  item.participants.length === 1 ? item.participants[0] : null;
