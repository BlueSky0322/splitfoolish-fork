import {
  ActionIcon,
  Button,
  Menu,
  SegmentedControl,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  CaretDown,
  CaretLeft,
  CheckSquare,
  CaretRight,
  CloudCheck,
  ArrowsClockwise,
  ArrowsLeftRight,
  CloudSlash,
  DotsThreeOutline,
  ImageSquare,
  GearSix,
  Images,
  LockSimple,
  Plus,
  Rows,
  ShareNetwork,
  SortDescending,
  StackSimple,
  Table,
  UserPlus,
  UsersThree,
  X,
} from '@phosphor-icons/react';
import { ReactNode, useCallback, useMemo, useState } from 'react';
import { useIsDesktop } from '../../hooks/useBreakpoints';
import { useHomeDataSnapshot } from '../../hooks/useHomeData';
import { navigate } from '../../hooks/useRoute';
import { SplitActionsContext, SyncStatus, useSplit } from '../../split/useSplit';
import type { Person } from '../../../../shared/types';
import { SplitTotals, computeTotals, findMe } from '../../split/derive';
import { GROUP_LABELS, groupItems } from '../../split/grouping';
import { currencySymbol } from '../../utils/money';
import ErrorBoundary from '../ui/ErrorBoundary';
import { usePhotos } from '../photos/usePhotos';
import Fab from '../ui/Fab';
import SplitAvatar from './SplitAvatar';
import StateCard from '../ui/StateCard';
import PersonAvatar, { AvatarVersionsContext } from './PersonAvatar';
import BalancePanel, { BalanceHero, BalanceLine } from './BalancePanel';
import { ItemCards, ItemTable } from './ItemViews';
import { DesktopSelectionBar, MobileSelectionBar, MoveDateDialog } from './ItemSelection';
import { useItemSelection, useSelectionKeys } from '../../hooks/useItemSelection';
import { type Attachment } from '../../../../shared/api';
import classes from './Split.module.css';
import { useSplitState } from '../../split/SplitStateContext';
import { plural } from '../../utils/text';
import { GROUP_ORDER, ViewPrefs, useItemViewPrefs } from './useItemViewPrefs';
import { Prefill, useConvertPrefill } from './useConvertPrefill';
import { useDeleteItems } from './useDeleteItems';
import { useHeroHidden } from './useHeroHidden';
import SplitDialogs, { type Dialog } from './SplitDialogs';

const MAX_AVATARS = 4;

function AvatarStack({ people, size, max }: { people: Person[]; size: number; max: number }) {
  const shown = people.slice(0, max);
  return (
    <div
      className={classes.avatarStack}
      data-size={size >= 30 ? 'lg' : undefined}
    >
      {shown.map((p) => (
        <PersonAvatar
          preview={false}
          key={p.id}
          person={p}
          size={size}
        />
      ))}
      {people.length > max && <span className={classes.moreCount}>+{people.length - max}</span>}
    </div>
  );
}

function SaveStatus({
  status,
  count,
  waiting,
  onRetry,
}: {
  status: SyncStatus;
  count: number;
  /** Changes kept on this device until they're sent */
  waiting: number;
  onRetry: () => void;
}) {
  if (status === 'offline') {
    return (
      <div className={classes.status}>
        <CloudSlash size={14} />
        {waiting === 0 ? 'Offline' : `Offline · ${plural(waiting, 'change')} waiting`}
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className={classes.status}>
        <CloudSlash size={14} />
        Not saved yet, retrying ·{' '}
        <button
          type="button"
          className={classes.linkButton}
          onClick={onRetry}
        >
          Retry now
        </button>
      </div>
    );
  }
  const label =
    status === 'loading'
      ? 'Loading'
      : status === 'refreshing'
        ? 'Updating'
        : status === 'saving'
          ? 'Saving'
          : 'Saved';
  return (
    <div className={classes.status}>
      <CloudCheck size={14} />
      {label} · {plural(count, 'item')}
    </div>
  );
}

/** "Chen and Dev owe you", for the phone's people summary */
function oweLine(people: Person[], totals: SplitTotals, me: Person | null) {
  if (!totals.hasItems) return 'No items yet';
  if (me == null) return 'Tap to edit or pick yourself';
  const owe = totals.transfers.filter((t) => t.toId === me.id).map((t) => t.fromId);
  const youOwe = totals.transfers.filter((t) => t.fromId === me.id).map((t) => t.toId);
  const names = (ids: string[]) => {
    const list = ids.map((id) => people.find((p) => p.id === id)?.name ?? '');
    return list.length <= 2
      ? list.join(' and ')
      : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
  };
  if (owe.length > 0) return `${names(owe)} ${owe.length === 1 ? 'owes' : 'owe'} you`;
  if (youOwe.length > 0) return `You owe ${names(youOwe)}`;
  return 'Everyone is settled';
}

const SplitScreen = ({ splitId, myEmail }: { splitId: string; myEmail: string | null }) => {
  const { status, waiting, meta, metaChanges, refreshMeta, actions, retry, whenSaved } =
    useSplit(splitId);
  const photos = usePhotos({ splitId, meta, metaChanges, whenSaved });
  // People can remove photos they added; the owner can remove any
  const canRemovePhoto = (photo: Attachment) =>
    photo.uploadedBy === myEmail || meta?.role === 'owner';
  const { state } = useSplitState();
  const isDesktop = useIsDesktop();
  const { prefs, setPref, sortBy, shownSort, cycleMobileSort, cycleGroup } = useItemViewPrefs();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [personFilter, setPersonFilter] = useState<string | null>(null);

  const openAdd = useCallback((prefill?: Prefill) => setDialog({ kind: 'add', prefill }), []);
  useConvertPrefill(splitId, meta != null, state.people.length > 0, openAdd);
  const photoCounts = new Map<string, number>();
  for (const a of meta?.attachments ?? []) {
    if (a.itemId) photoCounts.set(a.itemId, (photoCounts.get(a.itemId) ?? 0) + 1);
  }
  const splitPhotoCount = meta?.attachments.filter((a) => a.itemId == null).length ?? 0;

  const currency = meta?.currency ?? 'MYR';
  const otherCurrencies = new Set(
    state.items.map((i) => i.original?.currency).filter((c): c is string => c != null),
  ).size;
  // Shared by everyone in the split; ignored if that person was just removed
  const distributorId = state.people.some((p) => p.id === meta?.distributorId)
    ? meta?.distributorId ?? null
    : null;
  const totals = useMemo(
    () => computeTotals(state.people, state.items, distributorId),
    [state.people, state.items, distributorId],
  );
  const me = findMe(state.people, myEmail);
  // My splits hears about a new picture first (it may be uploaded from New split)
  const listed = useHomeDataSnapshot().splits?.find((s) => s.id === splitId);
  const pictureVersion = listed ? listed.pictureVersion : meta?.pictureVersion ?? null;
  const avatarVersions = useMemo(
    () => new Map((meta?.members ?? []).map((m) => [m.email, m.avatarVersion])),
    [meta?.members],
  );
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
  const selecting = selection.active;
  const [moving, setMoving] = useState(false);

  const deleteItems = useDeleteItems(actions, photos);
  /** Deletes the picked items: with Undo, or after asking when photos would go too */
  const deleteSelected = () =>
    deleteItems(
      state.items.filter((i) => selection.selected.has(i.id)),
      { onDeleted: selection.clear },
    );
  useSelectionKeys(selecting, isDesktop === true, selection.clear, deleteSelected);

  const { heroRef, barRef, heroHidden } = useHeroHidden(!isDesktop && meta != null);

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

  const moveSelected = (day: Date) => {
    const count = selection.count;
    actions.moveItemsToDay([...selection.selected], day);
    setMoving(false);
    selection.clear();
    notifications.show({
      message: `Moved ${plural(count, 'item')} to ${day.toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })}`,
    });
  };

  const selectionProps = {
    count: selection.count,
    total: state.items.length,
    onSelectAll: selection.selectAll,
    onClear: selection.clear,
    onMove: () => setMoving(true),
    onDelete: deleteSelected,
  };

  const moveDialog = (
    <MoveDateDialog
      opened={moving}
      count={selection.count}
      onMove={moveSelected}
      onClose={() => setMoving(false)}
    />
  );

  const openPeople = (personId?: string) => setDialog({ kind: 'people', personId });
  const linkMe = () => openPeople();

  const loaded = meta != null;
  const noPeople = loaded && state.people.length === 0;

  const peopleNames = state.people.map((p) => p.name).join(', ');

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

  const moreMenu = (target: ReactNode) => (
    <Menu
      position="bottom-end"
      withinPortal
    >
      <Menu.Target>{target}</Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<UsersThree size={16} />}
          onClick={() => openPeople()}
        >
          People
        </Menu.Item>
        <Menu.Item
          leftSection={<UserPlus size={16} />}
          onClick={() => setDialog({ kind: 'members' })}
        >
          Share split
        </Menu.Item>
        <Menu.Item
          leftSection={<Images size={16} />}
          onClick={() => setDialog({ kind: 'photos' })}
        >
          Photos
          {splitPhotoCount > 0 && <span className="sf-muted"> ({splitPhotoCount})</span>}
        </Menu.Item>
        {otherCurrencies > 0 && (
          <Menu.Item
            leftSection={<ArrowsLeftRight size={16} />}
            rightSection={<span className="sf-tag">{otherCurrencies}</span>}
            onClick={() => setDialog({ kind: 'currencies' })}
          >
            Currencies
          </Menu.Item>
        )}
        <Menu.Item
          leftSection={<GearSix size={16} />}
          onClick={() => setDialog({ kind: 'settings' })}
        >
          Split settings
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );

  const filterChip = filterPerson && (
    <div className={classes.filterChip}>
      Showing {filterPerson.name}'s items
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

  const converting = meta?.converting && (
    <div
      className={classes.banner}
      role="status"
    >
      <ArrowsClockwise
        size={18}
        className="animate-spin"
      />
      <span className="flex-1">
        Converting amounts to {currency}. Items keep what was originally paid.
      </span>
    </div>
  );

  const banner = status === 'error' && (
    <div className={classes.banner}>
      <CloudSlash size={18} />
      <span className="flex-1">
        Couldn't save your latest changes. They're kept here and we keep retrying.
      </span>
      <Button
        variant="default"
        size="compact-sm"
        onClick={retry}
      >
        Retry now
      </Button>
    </div>
  );

  const list = noPeople ? (
    <div className={classes.empty}>
      <UsersThree
        size={36}
        className={classes.emptyIcon}
      />
      <div className={classes.emptyTitle}>Who's splitting?</div>
      <div className={classes.emptyBody}>Add everyone sharing the costs, including yourself.</div>
      <Button onClick={() => openPeople()}>Add people</Button>
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
      groups={groups}
      grouped={grouped}
      totals={totals}
      me={me}
      people={state.people}
      currency={currency}
      mobile={!isDesktop}
      onEdit={(item) => setDialog({ kind: 'edit', item })}
      onDelete={(item) => deleteItems([item])}
      photoCounts={photoCounts}
      selection={selection.row}
      sortKey={prefs.sortKey}
      sortDir={prefs.sortDir}
      onSort={sortBy}
      totalCents={groups.reduce((sum, g) => sum + g.subtotalCents, 0)}
    />
  ) : (
    <ItemCards
      groups={groups}
      grouped={grouped}
      totals={totals}
      me={me}
      people={state.people}
      currency={currency}
      mobile={!isDesktop}
      onEdit={(item) => setDialog({ kind: 'edit', item })}
      onDelete={(item) => deleteItems([item])}
      photoCounts={photoCounts}
      selection={selection.row}
    />
  );

  const panel = (
    <BalancePanel
      people={state.people}
      totals={totals}
      currency={currency}
      me={me}
      distributorId={distributorId}
      onDistributorChange={(id) => actions.setDistributor(id)}
      onShareImage={() => setDialog({ kind: 'share' })}
      onLinkMe={linkMe}
      members={meta?.members ?? []}
      variant={isDesktop ? 'panel' : 'sheet'}
    />
  );

  const dialogs = (
    <SplitDialogs
      dialog={dialog}
      setDialog={setDialog}
      splitId={splitId}
      myEmail={myEmail}
      meta={meta}
      metaChanges={metaChanges}
      refreshMeta={refreshMeta}
      totals={totals}
      currency={currency}
      me={me}
      photos={photos}
      canRemovePhoto={canRemovePhoto}
      saving={status === 'saving'}
      pictureVersion={pictureVersion}
      panel={panel}
      deleteItems={deleteItems}
      onShowItems={setPersonFilter}
      onLinkMe={linkMe}
    />
  );

  if (isDesktop) {
    return (
      <SplitActionsContext.Provider value={actions}>
        <AvatarVersionsContext.Provider value={avatarVersions}>
          <div className={classes.desktop}>
            <div className={classes.main}>
              <div className={classes.titleRow}>
                <div className={classes.titleBlock}>
                  <div className={classes.title}>
                    {meta && (
                      <SplitAvatar
                        splitId={splitId}
                        name={meta.name}
                        pictureVersion={pictureVersion}
                        size={40}
                      />
                    )}
                    <Title order={2}>{meta?.name ?? ' '}</Title>
                    {meta && (
                      <span className="sf-tag">
                        {currency} · {currencySymbol(currency)}
                      </span>
                    )}
                    {otherCurrencies > 0 && (
                      <Tooltip label="Currencies">
                        <UnstyledButton
                          className={classes.currenciesTag}
                          onClick={() => setDialog({ kind: 'currencies' })}
                          aria-label={`${otherCurrencies} other currencies`}
                        >
                          <ArrowsLeftRight size={12} />+{otherCurrencies}
                        </UnstyledButton>
                      </Tooltip>
                    )}
                  </div>
                  <SaveStatus
                    status={status}
                    count={state.items.length}
                    waiting={waiting}
                    onRetry={retry}
                  />
                </div>
                <div className={classes.actions}>
                  <Button
                    variant="default"
                    leftSection={<ShareNetwork size={16} />}
                    onClick={() => setDialog({ kind: 'members' })}
                    disabled={!loaded || myEmail == null}
                  >
                    Share
                  </Button>
                  {moreMenu(
                    <ActionIcon
                      variant="default"
                      size={36}
                      aria-label="More"
                    >
                      <DotsThreeOutline size={16} />
                    </ActionIcon>,
                  )}
                  <Button
                    leftSection={<Plus size={16} />}
                    onClick={() => setDialog({ kind: 'add' })}
                    disabled={!loaded || state.people.length === 0}
                  >
                    Add item
                  </Button>
                </div>
              </div>

              {state.people.length > 0 && (
                <div className={classes.peopleLine}>
                  <AvatarStack
                    people={state.people}
                    size={26}
                    max={6}
                  />
                  <span className={classes.peopleNames}>{peopleNames}</span>
                  <button
                    type="button"
                    className={classes.linkButton}
                    onClick={() => openPeople()}
                  >
                    {meta?.role === 'owner' ? 'Edit people' : 'See people'}
                  </button>
                </div>
              )}

              {converting}

              {banner}

              {!noPeople && state.items.length > 0 && (
                <div className={classes.toolbar}>
                  <Menu
                    position="bottom-start"
                    withinPortal
                  >
                    <Menu.Target>
                      <Button
                        variant="subtle"
                        color="gray"
                        leftSection={<StackSimple size={16} />}
                        rightSection={<CaretDown size={12} />}
                      >
                        {GROUP_LABELS[prefs.groupBy]}
                      </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {GROUP_ORDER.map((g) => (
                        <Menu.Item
                          key={g}
                          onClick={() => setPref({ groupBy: g })}
                          color={g === prefs.groupBy ? 'accent' : undefined}
                        >
                          {GROUP_LABELS[g]}
                        </Menu.Item>
                      ))}
                    </Menu.Dropdown>
                  </Menu>
                  {filterChip}
                  <span className={classes.toolbarSpacer} />
                  <Button
                    variant={selecting ? 'light' : 'default'}
                    size="xs"
                    leftSection={<CheckSquare size={14} />}
                    onClick={selecting ? selection.clear : selection.start}
                    aria-pressed={selecting}
                  >
                    {selecting ? 'Done' : 'Select'}
                  </Button>
                  {viewToggle}
                </div>
              )}

              <ErrorBoundary fallback={<div>Something went wrong showing the items.</div>}>
                {list}
              </ErrorBoundary>
              {selecting && <DesktopSelectionBar {...selectionProps} />}
              {moveDialog}
            </div>
            <aside className={classes.aside}>{panel}</aside>
          </div>
          {dialogs}
        </AvatarVersionsContext.Provider>
      </SplitActionsContext.Provider>
    );
  }

  return (
    <SplitActionsContext.Provider value={actions}>
      <AvatarVersionsContext.Provider value={avatarVersions}>
        <div className={classes.mobile}>
          {selecting && <MobileSelectionBar {...selectionProps} />}
          {moveDialog}
          {/* Once the balance and its buttons scroll away, the bar keeps them in reach */}
          <div
            ref={barRef}
            className={classes.topBar}
            data-collapsed={heroHidden || undefined}
          >
            {heroHidden ? (
              <>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={40}
                  aria-label="Back to splits"
                  onClick={() => navigate('')}
                >
                  <CaretLeft size={18} />
                </ActionIcon>
                <UnstyledButton
                  className={classes.compactTitle}
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                  aria-label="Back to the top"
                >
                  <span className={classes.compactName}>{meta?.name}</span>
                  <BalanceLine
                    totals={totals}
                    currency={currency}
                    me={me}
                  />
                </UnstyledButton>
                <Button
                  size="compact-sm"
                  onClick={() => setDialog({ kind: 'settle' })}
                  disabled={noPeople || !loaded}
                >
                  Settle up
                </Button>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={40}
                  aria-label="Share image"
                  onClick={() => setDialog({ kind: 'share' })}
                  disabled={!totals.hasItems}
                >
                  <ImageSquare size={20} />
                </ActionIcon>
              </>
            ) : (
              <>
                <Button
                  variant="subtle"
                  color="gray"
                  leftSection={<CaretLeft size={16} />}
                  onClick={() => navigate('')}
                >
                  Splits
                </Button>
                <div className="flex gap-1">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size={44}
                    aria-label="Share split"
                    onClick={() => setDialog({ kind: 'members' })}
                    disabled={!loaded || myEmail == null}
                  >
                    <ShareNetwork size={20} />
                  </ActionIcon>
                  {moreMenu(
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size={44}
                      aria-label="More"
                    >
                      <DotsThreeOutline size={20} />
                    </ActionIcon>,
                  )}
                </div>
              </>
            )}
          </div>

          <div className={classes.mobileHero}>
            {meta && (
              <div className={classes.mobileTitle}>
                <SplitAvatar
                  splitId={splitId}
                  name={meta.name}
                  pictureVersion={pictureVersion}
                  size={40}
                />
                <h1 className={classes.mobileName}>{meta.name}</h1>
              </div>
            )}
            <BalanceHero
              totals={totals}
              currency={currency}
              me={me}
              onLinkMe={linkMe}
              size={40}
            />
            <div
              className={classes.heroButtons}
              ref={heroRef}
            >
              <Button
                onClick={() => setDialog({ kind: 'settle' })}
                disabled={noPeople || !loaded}
              >
                Settle up
              </Button>
              <Button
                variant="default"
                onClick={() => setDialog({ kind: 'share' })}
                disabled={!totals.hasItems}
              >
                Share image
              </Button>
            </div>
            <SaveStatus
              status={status}
              count={state.items.length}
              waiting={waiting}
              onRetry={retry}
            />
          </div>

          {state.people.length > 0 && (
            <UnstyledButton
              className={classes.peopleSummary}
              onClick={() => openPeople()}
            >
              <AvatarStack
                people={state.people}
                size={30}
                max={MAX_AVATARS}
              />
              <div className={classes.peopleSummaryText}>
                <div className={classes.peopleSummaryTitle}>
                  {plural(state.people.length, 'person', 'people')}
                </div>
                <div className={classes.peopleSummarySub}>{oweLine(state.people, totals, me)}</div>
              </div>
              <CaretRight size={16} />
            </UnstyledButton>
          )}

          {converting}

          {banner}

          {!noPeople && state.items.length > 0 && (
            <div className={classes.toolbar}>
              <UnstyledButton
                className={classes.pill}
                onClick={cycleGroup}
              >
                <StackSimple size={14} />
                {GROUP_LABELS[prefs.groupBy]}
              </UnstyledButton>
              <UnstyledButton
                className={classes.pill}
                onClick={cycleMobileSort}
              >
                <SortDescending size={14} />
                {shownSort.label}
              </UnstyledButton>
              <span className={classes.toolbarSpacer} />
              {viewToggle}
            </div>
          )}
          {filterChip}

          <ErrorBoundary fallback={<div>Something went wrong showing the items.</div>}>
            {list}
          </ErrorBoundary>
        </div>
        {!noPeople && loaded && !selecting && (
          <Fab
            label="Add item"
            onClick={() => setDialog({ kind: 'add' })}
          />
        )}
        {dialogs}
      </AvatarVersionsContext.Provider>
    </SplitActionsContext.Provider>
  );
};

export default SplitScreen;
