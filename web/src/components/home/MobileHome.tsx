import { ActionIcon, Radio, UnstyledButton } from '@mantine/core';
import {
  Archive,
  ArrowCounterClockwise,
  MagnifyingGlass,
  SignOut,
  SortAscending,
  Trash,
} from '@phosphor-icons/react';
import type { SplitSummary } from '@shared/api';
import { canDeleteSplit } from '@shared/rules';
import { type TouchEvent, useRef, useState } from 'react';
import { navigate } from '../../hooks/useRoute';
import { archiveSplit, moveSplit } from '../../my-splits/my-splits';
import { useMySplits } from '../../my-splits/useMySplits';
import { useProfile } from '../../profile/ProfileContext';
import { formatAmount } from '../../utils/money';
import { quietly } from '../../utils/quietly';
import { plural } from '../../utils/text';
import SplitAvatar from '../common/SplitAvatar';
import EndSplit, { EndSplitTitle } from '../split/dialogs/EndSplit';
import Fab from '../ui/Fab';
import ResponsiveDialog from '../ui/ResponsiveDialog';
import { InstallCard } from '../common/InstallApp';
import HomeSearch from './HomeSearch';
import { isSplitSort, SPLIT_SORT_LABELS, SPLIT_SORTS, type SplitSort } from './split-sorts';
import { SortableSplits } from './SortableSplits';
import { justDragged, useSortableSplitParts } from './useSortableSplit';
import { useOpenNewSplit } from './NewSplitDialog';
import { MobileSplitRowsSkeleton } from './HomeSkeletons';
import classes from './MobileHome.module.css';

type Show = 'active' | 'settled' | 'archived' | 'all';
/** Your own order (tap and hold a split to drag it), or one of the sorts */
type Sort = SplitSort | 'yours';

const SHOW_LABELS: Record<Show, string> = {
  active: 'Active',
  settled: 'Settled',
  archived: 'Archived',
  all: 'All',
};
const SORT_LABELS: Record<Sort, string> = { yours: 'Your order', ...SPLIT_SORT_LABELS };
const EMPTY: Record<Show, string> = {
  active: 'Nothing open. Start a split with New split.',
  settled: 'No settled splits yet.',
  archived: 'Nothing archived. Swipe a split left to archive it.',
  all: 'No splits yet. Start one with New split.',
};

// Versioned: the first kept the sort it started with (Recent activity) at any change of
// filter, so everyone starts again on Your order, where splits can be dragged
const PREFS_KEY = 'splitfoolish:home-view-v2';

const readPrefs = (): { show: Show; sort: Sort } => {
  const saved = quietly(
    () =>
      JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as {
        show?: string;
        sort?: string;
      } | null,
  );
  const show = saved?.show ?? '';
  const sort = saved?.sort ?? '';
  return {
    show: Object.keys(SHOW_LABELS).includes(show) ? (show as Show) : 'active',
    sort: isSplitSort(sort) ? sort : 'yours',
  };
};

/** Which list a split is in: archived (by you), else settled, else active */
const showsIn = (split: SplitSummary, show: Show) =>
  show === 'all' ||
  (show === 'archived'
    ? split.archived
    : !split.archived && (show === 'settled') === split.settled);

/** Width of the two actions a row shows when swiped left */
const ACTIONS_PX = 168;

/** Where you stand in a split, on the right of its row */
function RowBalance({ split }: { split: SplitSummary }) {
  const cents = split.myBalanceCents;
  let text: React.ReactNode;
  if (split.totalCents === 0) text = <span className="sf-muted">No items</span>;
  else if (split.settled || cents === 0) text = <span className="sf-muted">Settled</span>;
  else if (cents == null)
    text = <span className="sf-muted">{formatAmount(split.totalCents, split.currency)}</span>;
  else {
    text = (
      <span className={cents > 0 ? 'sf-positive' : 'sf-negative'}>
        <span className={classes.arrow}>{cents > 0 ? '▲' : '▼'}</span>
        {formatAmount(cents, split.currency)}
      </span>
    );
  }
  return (
    <span className={classes.balance}>
      <span className={classes.balanceAmount}>{text}</span>
      <span className={classes.balanceCurrency}>{split.currency}</span>
    </span>
  );
}

/**
 * A split; swipe it left for Archive and Leave (or Delete, for its owner), or tap and
 * hold to drag it into your own order
 */
function SplitRow({
  split,
  open,
  onOpen,
  onEnd,
}: {
  split: SplitSummary;
  /** Its actions are showing */
  open: boolean;
  onOpen: (open: boolean) => void;
  onEnd: () => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ x: number; y: number; sideways: boolean | null } | null>(null);
  const moved = useRef(false);
  const offset = drag ?? (open ? -ACTIONS_PX : 0);
  // Tap and hold to drag it up or down, in Your order
  const sortable = useSortableSplitParts(split.id);
  const { dragging } = sortable;

  const touchStart = (e: TouchEvent) => {
    sortable.onTouchStart?.(e);
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, sideways: null };
    moved.current = false;
  };
  const touchMove = (e: TouchEvent) => {
    const s = start.current;
    // Being dragged up or down: it doesn't swipe as well
    if (s == null || dragging) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    // Decided by the first few pixels: scrolling the list, or swiping the row
    if (s.sideways == null && Math.abs(dx) + Math.abs(dy) > 8)
      s.sideways = Math.abs(dx) > Math.abs(dy);
    if (!s.sideways) return;
    moved.current = true;
    setDrag(Math.min(0, Math.max(-ACTIONS_PX - 24, dx + (open ? -ACTIONS_PX : 0))));
  };
  const touchEnd = () => {
    if (drag != null) onOpen(drag < -ACTIONS_PX / 2);
    setDrag(null);
    start.current = null;
  };

  const canDelete = canDeleteSplit(split.role);
  return (
    <div
      {...sortable.node}
      className={classes.swipe}
      data-revealed={offset < 0 || undefined}
    >
      <div
        className={classes.actions}
        aria-hidden={!open}
      >
        <UnstyledButton
          className={classes.action}
          tabIndex={open ? 0 : -1}
          onClick={() => {
            onOpen(false);
            archiveSplit(split.id, !split.archived);
          }}
        >
          {split.archived ? <ArrowCounterClockwise size={20} /> : <Archive size={20} />}
          {split.archived ? 'Unarchive' : 'Archive'}
        </UnstyledButton>
        <UnstyledButton
          className={`${classes.action} ${classes.actionDanger}`}
          tabIndex={open ? 0 : -1}
          onClick={() => {
            onOpen(false);
            onEnd();
          }}
        >
          {canDelete ? <Trash size={20} /> : <SignOut size={20} />}
          {canDelete ? 'Delete' : 'Leave'}
        </UnstyledButton>
      </div>
      <UnstyledButton
        className={classes.row}
        style={{
          transform: `translateX(${offset}px)`,
          transition: drag == null ? 'transform 180ms ease-out' : 'none',
        }}
        onMouseDown={sortable.onMouseDown}
        onTouchStart={touchStart}
        onTouchMove={touchMove}
        onTouchEnd={touchEnd}
        onClick={() => {
          // A swipe or a drag ends with a click, which doesn't open it
          if (moved.current || justDragged()) return;
          if (open) onOpen(false);
          else navigate(`?s=${split.id}`);
        }}
      >
        <SplitAvatar
          splitId={split.id}
          name={split.name}
          pictureVersion={split.pictureVersion}
          size={44}
        />
        <span className="min-w-0 flex-1">
          <span className={classes.rowName}>{split.name}</span>
          <span className={classes.rowMeta}>
            {plural(split.peopleCount, 'person', 'people')}, {plural(split.itemCount ?? 0, 'item')}
          </span>
        </span>
        <RowBalance split={split} />
      </UnstyledButton>
    </div>
  );
}

/** Splits on phones (10a): your splits as rows, with sorting, filters and search */
const MobileHome = () => {
  const { splits, error } = useMySplits();
  const { profile } = useProfile();
  const openNewSplit = useOpenNewSplit();
  const [prefs, setPrefs] = useState(readPrefs);
  const [sorting, setSorting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [ending, setEnding] = useState<SplitSummary | null>(null);

  const change = (next: Partial<typeof prefs>) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    quietly(() => localStorage.setItem(PREFS_KEY, JSON.stringify(merged)));
  };

  if (searching) {
    return (
      <HomeSearch
        splits={splits ?? []}
        onClose={() => setSearching(false)}
      />
    );
  }

  const listed = splits?.filter((s) => showsIn(s, prefs.show)) ?? null;
  // Your order is the order they come in
  const shown = prefs.sort === 'yours' ? listed : listed?.sort(SPLIT_SORTS[prefs.sort]) ?? null;
  // Archived is chosen from Sort and filter; it shows as a chip while it's on
  const chips: Show[] =
    prefs.show === 'archived'
      ? ['active', 'settled', 'archived', 'all']
      : ['active', 'settled', 'all'];

  return (
    <div className={classes.page}>
      <div className={classes.titleRow}>
        <h1 className={classes.title}>Splits</h1>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={44}
          aria-label="Search"
          onClick={() => setSearching(true)}
        >
          <MagnifyingGlass size={22} />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={44}
          aria-label="Sort and filter"
          onClick={() => setSorting(true)}
        >
          <SortAscending size={22} />
        </ActionIcon>
      </div>
      <div
        className={classes.chips}
        role="radiogroup"
        aria-label="Show"
      >
        {chips.map((show) => (
          <UnstyledButton
            key={show}
            role="radio"
            aria-checked={prefs.show === show}
            className={classes.chip}
            data-selected={prefs.show === show || undefined}
            onClick={() => change({ show })}
          >
            {SHOW_LABELS[show]}
          </UnstyledButton>
        ))}
      </div>

      <InstallCard />
      {error && <div className="sf-negative">{error}</div>}
      {shown == null && error == null && <MobileSplitRowsSkeleton />}
      {shown?.length === 0 && <p className="sf-muted text-center py-10">{EMPTY[prefs.show]}</p>}
      {shown != null && shown.length > 0 && (
        <SortableSplits
          onMove={moveSplit}
          ids={shown.map((s) => s.id)}
          // Only your own order can be dragged; the sorts are worked out
          disabled={prefs.sort !== 'yours'}
        >
          <div className={classes.list}>
            {shown.map((s) => (
              <SplitRow
                key={s.id}
                split={s}
                open={openRow === s.id}
                onOpen={(open) => setOpenRow(open ? s.id : null)}
                onEnd={() => setEnding(s)}
              />
            ))}
          </div>
        </SortableSplits>
      )}

      <Fab
        label="New split"
        onClick={openNewSplit}
      />

      <ResponsiveDialog
        opened={sorting}
        onClose={() => setSorting(false)}
        title="Sort by"
      >
        <Radio.Group
          value={prefs.sort}
          onChange={(sort) => change({ sort: sort as Sort })}
          aria-label="Sort by"
        >
          <div className="flex flex-col">
            {(Object.keys(SORT_LABELS) as Sort[]).map((sort) => (
              <Radio
                key={sort}
                value={sort}
                label={SORT_LABELS[sort]}
                description={sort === 'yours' ? 'Tap and hold a split to move it' : undefined}
                classNames={{ root: classes.radio }}
              />
            ))}
          </div>
        </Radio.Group>
        <div className={classes.sheetLabel}>Show</div>
        <div
          className={classes.chips}
          role="radiogroup"
          aria-label="Show"
        >
          {(['active', 'settled', 'archived', 'all'] as Show[]).map((show) => (
            <UnstyledButton
              key={show}
              role="radio"
              aria-checked={prefs.show === show}
              className={classes.chip}
              data-selected={prefs.show === show || undefined}
              onClick={() => change({ show })}
            >
              {SHOW_LABELS[show]}
            </UnstyledButton>
          ))}
        </div>
      </ResponsiveDialog>

      <ResponsiveDialog
        opened={ending != null}
        onClose={() => setEnding(null)}
        title={<EndSplitTitle canDelete={ending != null && canDeleteSplit(ending.role)} />}
      >
        {ending && profile && (
          <EndSplit
            splitId={ending.id}
            name={ending.name}
            canDelete={canDeleteSplit(ending.role)}
            myEmail={profile.email}
            onCancel={() => setEnding(null)}
            onEnded={() => setEnding(null)}
          />
        )}
      </ResponsiveDialog>
    </div>
  );
};

export default MobileHome;
