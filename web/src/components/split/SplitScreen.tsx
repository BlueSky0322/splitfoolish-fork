import { FALLBACK_CURRENCY } from '../../utils/money';
import { ActionIcon, Button, SegmentedControl } from '@mantine/core';
import { LockSimple, Rows, Table, UsersThree, X } from '@phosphor-icons/react';
import { useCallback, useMemo, useState } from 'react';
import type { Attachment } from '@shared/api';
import { useIsDesktop, useIsMobile } from '../../hooks/useBreakpoints';
import { useMySplitsSnapshot } from '../../my-splits/useMySplits';
import { useItemSelection, useSelectionKeys } from './items/useItemSelection';
import { navigate } from '../../hooks/useRoute';
import { computeTotals, findMe } from '../../split/derive';
import { groupItems } from '../../split/grouping';
import type { SplitItem } from '../../split/state';
import { useSplitState } from '../../split/SplitStateContext';
import { SplitActionsContext, useSplit } from '../../split/useSplit';
import { plural } from '../../utils/text';
import { usePhotos } from '../../split/usePhotos';
import { ItemsSkeleton } from './layout/SplitSkeletons';
import StateCard from '../ui/StateCard';
import { showUndo } from '../common/undo-toast';
import BalancePanel from './balances/BalancePanel';
import DesktopSplitLayout from './layout/DesktopSplitLayout';
import { MoveDateDialog } from './items/ItemSelection';
import { ItemCards, ItemTable } from './items/ItemViews';
import MobileSplitLayout from './layout/MobileSplitLayout';
import { AvatarVersionsContext, PersonName } from './PersonAvatar';
import { PersonColorsContext } from './person-colors-context';
import { personColors } from '../../split/person-colors';
import SplitDialogs from './dialogs/SplitDialogs';
import { type Dialog, type SplitPage, SplitPageProvider } from './SplitPageContext';
import { type SelectionUi, type SplitPageParts } from './layout/SplitPageParts';
import type { Prefill } from './useConvertPrefill';
import { useConvertPrefill } from './useConvertPrefill';
import { makeDeleteItems } from './items/delete-items';
import type { ViewPrefs } from './items/useItemViewPrefs';
import { useItemViewPrefs } from './items/useItemViewPrefs';
import classes from './Split.module.css';
import { canRemovePhoto } from '@shared/rules';

// The split page: loads the split, works out what's shown from it, and builds the parts
// both layouts place (the item list, the balances, the menu, the dialogs). The layouts
// read the rest from SplitPageProvider.
const SplitScreen = ({ splitId, myEmail }: { splitId: string; myEmail: string | null }) => {
  const { status, waiting, meta, metaChanges, refreshMeta, actions, retry, whenSaved } =
    useSplit(splitId);
  const photos = usePhotos({ splitId, meta, metaChanges, whenSaved });
  const { state } = useSplitState();
  const isDesktop = useIsDesktop();
  const isMobile = useIsMobile();
  const { prefs, setPref, sortBy } = useItemViewPrefs();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [personFilter, setPersonFilter] = useState<string | null>(null);

  const openAdd = useCallback((prefill?: Prefill) => setDialog({ kind: 'add', prefill }), []);
  useConvertPrefill(splitId, meta != null, state.people.length > 0, openAdd);

  // Only until the split has loaded
  const currency = meta?.currency ?? FALLBACK_CURRENCY;
  // Shared by everyone in the split; ignored if that person was just removed
  const distributorId = state.people.some((p) => p.id === meta?.distributorId)
    ? meta?.distributorId ?? null
    : null;
  const totals = useMemo(
    () => computeTotals(state.people, state.items, distributorId),
    [state.people, state.items, distributorId],
  );
  // My splits hears about a new picture first (it may be uploaded from New split)
  const listed = useMySplitsSnapshot().splits?.find((s) => s.id === splitId);
  const page: SplitPage = {
    splitId,
    myEmail,
    meta,
    metaChanges,
    refreshMeta,
    status,
    waiting,
    retry,
    currency,
    totals,
    me: findMe(state.people, myEmail),
    distributorId,
    pictureVersion: listed ? listed.pictureVersion : meta?.pictureVersion ?? null,
    photos,
    // People can remove photos they added; the owner can remove any
    canRemovePhoto: (photo: Attachment) =>
      myEmail != null &&
      meta != null &&
      canRemovePhoto(photo.uploadedBy, { email: myEmail, role: meta.role }),
    openDialog: setDialog,
  };
  const avatarVersions = useMemo(
    () => new Map((meta?.members ?? []).map((m) => [m.email, m.avatarVersion])),
    [meta?.members],
  );
  const colors = useMemo(() => {
    const byPerson = personColors(splitId, state.people);
    const byEmail = new Map(
      state.people.flatMap((p) =>
        p.memberEmail == null ? [] : [[p.memberEmail, byPerson.get(p.id)!] as const],
      ),
    );
    return { byPerson, byEmail };
  }, [splitId, state.people]);

  const photoCounts = new Map<string, number>();
  for (const a of meta?.attachments ?? []) {
    if (a.itemId) photoCounts.set(a.itemId, (photoCounts.get(a.itemId) ?? 0) + 1);
  }

  const filterPerson = state.people.find((p) => p.id === personFilter) ?? null;
  const shownItems = filterPerson
    ? state.items.filter(
        (i) =>
          i.payer.id === filterPerson.id || i.participants.some((p) => p.id === filterPerson.id),
      )
    : state.items;
  const groups = groupItems(shownItems, prefs.groupBy, prefs.sortKey, prefs.sortDir);
  const grouped = prefs.groupBy !== 'none';

  // Several items picked at once, in the order they're shown (for shift-click ranges)
  const selection = useItemSelection(groups.flatMap((g) => g.items.map((i) => i.id)));
  const [moving, setMoving] = useState(false);

  const deleteItems = makeDeleteItems({
    actions,
    photosOf: photos.photosOf,
    forgetItemAttachments: metaChanges.forgetItemAttachments,
    confirm: (c) => setDialog({ kind: 'confirmDelete', ...c }),
  });
  /** Deletes the picked items: with Undo, or after asking when photos would go too */
  const deleteSelected = () =>
    deleteItems(
      state.items.filter((i) => selection.selected.has(i.id)),
      { onDeleted: selection.clear },
    );
  useSelectionKeys(selection.active, isDesktop === true, selection.clear, deleteSelected);

  if (status === 'notfound') {
    return (
      <StateCard
        icon={<LockSimple size={36} />}
        title="This split doesn't exist, or you don't have access"
        body="If someone shared it with you, they may have removed you."
        action={<Button onClick={() => navigate('')}>Go to My splits</Button>}
      />
    );
  }

  /** Moves the picked items to a day, with Undo to put each back on its own date */
  const moveSelected = (day: Date) => {
    const count = selection.count;
    const before = state.items
      .filter((i) => selection.selected.has(i.id))
      .map(({ id, createdAt }) => ({ id, createdAt }));
    actions.moveItemsToDay([...selection.selected], day);
    setMoving(false);
    selection.clear();
    const shown = day.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    showUndo(`Moved ${plural(count, 'item')} to ${shown}`, () => actions.restoreItemDates(before));
  };

  const selectionUi: SelectionUi = {
    active: selection.active,
    start: selection.start,
    clear: selection.clear,
    bar: {
      count: selection.count,
      total: state.items.length,
      onSelectAll: selection.selectAll,
      onClear: selection.clear,
      onMove: () => setMoving(true),
      onDelete: deleteSelected,
    },
    moveDialog: (
      <MoveDateDialog
        opened={moving}
        count={selection.count}
        onMove={moveSelected}
        onClose={() => setMoving(false)}
      />
    ),
  };

  const loaded = meta != null;
  const noPeople = loaded && state.people.length === 0;
  // Nothing to show yet, not even a copy kept on this device
  const loading = !loaded && status === 'loading';

  const viewToggle = (
    <SegmentedControl
      size="xs"
      value={prefs.view}
      onChange={(v) => setPref({ view: v as ViewPrefs['view'] })}
      data={[
        {
          value: 'card',
          label: (
            <Rows
              size={16}
              aria-label="Card view"
            />
          ),
        },
        {
          value: 'table',
          label: (
            <Table
              size={16}
              aria-label="Table view"
            />
          ),
        },
      ]}
    />
  );

  const filterChip = filterPerson && (
    <div className={classes.filterChip}>
      Showing <PersonName person={filterPerson} />
      's items
      <ActionIcon
        variant="subtle"
        size={22}
        radius="xl"
        aria-label="Show all items"
        onClick={() => setPersonFilter(null)}
      >
        <X size={12} />
      </ActionIcon>
    </div>
  );

  const itemViewProps = {
    groups,
    grouped,
    mobile: !isDesktop,
    // Phones show the item first, with Edit a tap away
    onEdit: (item: SplitItem) =>
      setDialog(isMobile ? { kind: 'item', itemId: item.id } : { kind: 'edit', item }),
    onDelete: (item: SplitItem) => deleteItems([item]),
    photoCounts,
    selection: selection.row,
  };
  const list = loading ? (
    <ItemsSkeleton mobile={!isDesktop} />
  ) : noPeople ? (
    <div className={classes.empty}>
      <UsersThree
        size={36}
        className={classes.emptyIcon}
      />
      <div className={classes.emptyTitle}>Who's splitting?</div>
      <div className={classes.emptyBody}>Add everyone sharing the costs, including yourself.</div>
      <Button onClick={() => setDialog({ kind: 'people' })}>Add people</Button>
    </div>
  ) : loaded && state.items.length === 0 ? (
    <div className={classes.empty}>
      <div className={classes.emptyTitle}>No items yet</div>
      <div className={classes.emptyBody}>
        Add what was bought and who paid, and the balances work themselves out.
      </div>
      {isDesktop && <Button onClick={() => setDialog({ kind: 'add' })}>Add item</Button>}
    </div>
  ) : prefs.view === 'table' ? (
    <ItemTable
      {...itemViewProps}
      sortKey={prefs.sortKey}
      sortDir={prefs.sortDir}
      onSort={sortBy}
      totalCents={groups.reduce((sum, g) => sum + g.subtotalCents, 0)}
    />
  ) : (
    <ItemCards {...itemViewProps} />
  );

  const panel = <BalancePanel variant={isDesktop ? 'panel' : 'sheet'} />;

  const parts: SplitPageParts = {
    list,
    panel,
    viewToggle,
    filterChip,
    dialogs: (
      <SplitDialogs
        dialog={dialog}
        panel={panel}
        deleteItems={deleteItems}
        onShowItems={setPersonFilter}
      />
    ),
  };

  return (
    <SplitPageProvider page={page}>
      <SplitActionsContext.Provider value={actions}>
        <AvatarVersionsContext.Provider value={avatarVersions}>
          <PersonColorsContext.Provider value={colors}>
            {isDesktop ? (
              <DesktopSplitLayout
                parts={parts}
                selection={selectionUi}
              />
            ) : (
              <MobileSplitLayout
                parts={parts}
                selection={selectionUi}
              />
            )}
          </PersonColorsContext.Provider>
        </AvatarVersionsContext.Provider>
      </SplitActionsContext.Provider>
    </SplitPageProvider>
  );
};

export default SplitScreen;
