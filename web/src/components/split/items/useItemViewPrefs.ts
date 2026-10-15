import { DEFAULT_SETTINGS, ITEMS_GROUPS, type Settings } from '../../../../../shared/api';
import { useProfile } from '../../../profile/ProfileContext';
import { GroupBy, MOBILE_SORTS, SortDir, SortKey } from '../../../split/grouping';

// How a split's items are shown (cards or a table, grouped, sorted), saved with the
// account so every split and device shows them the same way

export interface ViewPrefs {
  view: Settings['itemsView'];
  groupBy: GroupBy;
  sortKey: SortKey;
  sortDir: SortDir;
}

export const GROUP_ORDER: readonly GroupBy[] = ITEMS_GROUPS;
// Item and payer read best A to Z; amounts largest first
const FIRST_DIR: Record<SortKey, SortDir> = {
  name: 'asc',
  payer: 'asc',
  amount: 'desc',
  // Newest first
  date: 'desc',
};

export function useItemViewPrefs() {
  const { profile, rememberSettings } = useProfile();
  const settings = profile?.settings;
  const prefs: ViewPrefs = {
    view: settings?.itemsView ?? DEFAULT_SETTINGS.itemsView,
    groupBy: settings?.itemsGroupBy ?? DEFAULT_SETTINGS.itemsGroupBy,
    sortKey: settings?.itemsSortKey ?? DEFAULT_SETTINGS.itemsSortKey,
    sortDir: settings?.itemsSortDir ?? DEFAULT_SETTINGS.itemsSortDir,
  };

  const setPref = (patch: Partial<ViewPrefs>) =>
    rememberSettings({
      ...(patch.view && { itemsView: patch.view }),
      ...(patch.groupBy && { itemsGroupBy: patch.groupBy }),
      ...(patch.sortKey && { itemsSortKey: patch.sortKey }),
      ...(patch.sortDir && { itemsSortDir: patch.sortDir }),
    });

  /** A column heading clicked: the other way round, or that column in its usual order */
  const sortBy = (key: SortKey) =>
    setPref(
      prefs.sortKey === key
        ? { sortDir: prefs.sortDir === 'asc' ? 'desc' : 'asc' }
        : { sortKey: key, sortDir: FIRST_DIR[key] },
    );

  // Phones step through a short list of sorts, and of groupings
  const mobileSort = MOBILE_SORTS.findIndex(
    (s) => s.key === prefs.sortKey && s.dir === prefs.sortDir,
  );
  const shownSort = MOBILE_SORTS[mobileSort] ?? MOBILE_SORTS[0];
  const cycleMobileSort = () => {
    const next = MOBILE_SORTS[(mobileSort + 1) % MOBILE_SORTS.length];
    void setPref({ sortKey: next.key, sortDir: next.dir });
  };
  const cycleGroup = () =>
    setPref({
      groupBy: GROUP_ORDER[(GROUP_ORDER.indexOf(prefs.groupBy) + 1) % GROUP_ORDER.length],
    });

  return { prefs, setPref, sortBy, shownSort, cycleMobileSort, cycleGroup };
}
