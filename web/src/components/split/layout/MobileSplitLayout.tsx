import { ActionIcon, Button, UnstyledButton } from '@mantine/core';
import {
  ArrowsLeftRight,
  CaretLeft,
  CaretRight,
  DotsThreeVertical,
  ShareNetwork,
  SortDescending,
  StackSimple,
} from '@phosphor-icons/react';
import { type TouchEvent, useEffect, useRef, useState } from 'react';
import { useIsMobile } from '../../../hooks/useBreakpoints';
import { navigate } from '../../../hooks/useRoute';
import { otherCurrencyCount } from '../../../split/derive';
import { GROUP_LABELS } from '../../../split/grouping';
import { useSplitState } from '../../../split/SplitStateContext';
import { formatAmount } from '../../../utils/money';
import SplitAvatar from '../../common/SplitAvatar';
import { setTabsHidden } from '../../shell/tabs-visibility';
import ErrorBoundary from '../../ui/ErrorBoundary';
import Fab from '../../ui/Fab';
import { BalanceHero } from '../balances/BalancePanel';
import { MobileSelectionBar } from '../items/ItemSelection';
import { useItemViewPrefs } from '../items/useItemViewPrefs';
import PhotosTab from '../photos/PhotosTab';
import { useSplitPage } from '../SplitPageContext';
import { SaveStatus, type SelectionUi, type SplitPageParts, SplitNotices } from './SplitPageParts';
import page from '../Split.module.css';
import classes from './MobileSplitLayout.module.css';

type SplitTab = 'items' | 'settle' | 'photos';
const TABS: { key: SplitTab; label: string }[] = [
  { key: 'items', label: 'Items' },
  { key: 'settle', label: 'Settle up' },
  { key: 'photos', label: 'Photos' },
];

/** A sideways swipe at least this long, and mostly sideways, moves between tabs */
const SWIPE_PX = 60;

/** Where you stand, in a card on the Items tab, with Settle up a tap away */
function BalanceCard({ onSettle }: { onSettle: () => void }) {
  const { meta } = useSplitPage();
  return (
    <div className={classes.balanceCard}>
      <BalanceHero size={28} />
      <UnstyledButton
        className={classes.settleLink}
        onClick={onSettle}
        disabled={meta == null}
      >
        Settle up <CaretRight size={12} />
      </UnstyledButton>
    </div>
  );
}

/** The Settle up tab: where you stand, then who pays whom and how */
function SettleTab({ panel }: { panel: SplitPageParts['panel'] }) {
  const { me, totals, currency } = useSplitPage();
  const mine = me ? totals.balances.get(me.id) : null;
  return (
    <div className={classes.settle}>
      <BalanceHero size={32} />
      {mine && totals.hasItems && (
        <p className="sf-muted text-[13px]">
          You paid {formatAmount(mine.paidCents, currency)}, your share{' '}
          {formatAmount(mine.shareCents, currency)}
        </p>
      )}
      {panel}
    </div>
  );
}

/**
 * The split page on phones and tablets: a header with the split's menu, then its items,
 * settling up and photos as tabs (swipe or tap). Phones go back with the gesture or the
 * bottom tabs; tablets keep a Splits button.
 */
const MobileSplitLayout = ({
  parts,
  selection,
}: {
  parts: SplitPageParts;
  selection: SelectionUi;
}) => {
  const { splitId, myEmail, meta, currency, pictureVersion, openDialog } = useSplitPage();
  const { state } = useSplitState();
  const { prefs, shownSort, cycleMobileSort, cycleGroup } = useItemViewPrefs();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<SplitTab>('items');
  const touch = useRef<{ x: number; y: number } | null>(null);
  const loaded = meta != null;
  const noPeople = loaded && state.people.length === 0;
  const others = otherCurrencyCount(state.items);

  // Picking items takes the bottom of the screen from the tabs
  useEffect(() => {
    if (!selection.active) return;
    setTabsHidden(true);
    return () => setTabsHidden(false);
  }, [selection.active]);

  const swipeStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const swipeEnd = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (start == null || selection.active) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < 2 * Math.abs(t.clientY - start.y)) return;
    const at = TABS.findIndex((x) => x.key === tab) + (dx < 0 ? 1 : -1);
    if (at >= 0 && at < TABS.length) setTab(TABS[at].key);
  };

  return (
    <>
      <div className={`${page.mobile} ${classes.page}`}>
        {selection.active && <MobileSelectionBar {...selection.bar} />}
        {selection.moveDialog}
        <div
          className={classes.sticky}
          // Picking items: the bar above takes the header's place
          data-selecting={selection.active || undefined}
        >
          {!isMobile && (
            <Button
              variant="subtle"
              color="gray"
              className="self-start"
              leftSection={<CaretLeft size={16} />}
              onClick={() => navigate('')}
            >
              Splits
            </Button>
          )}
          <header
            className={classes.header}
            hidden={selection.active}
          >
            {meta && (
              <SplitAvatar
                splitId={splitId}
                name={meta.name}
                pictureVersion={pictureVersion}
                size={36}
              />
            )}
            <div className="min-w-0 flex-1">
              <h1 className={classes.name}>{meta?.name ?? ' '}</h1>
              {meta && (
                <div className={classes.tags}>
                  <span className="sf-tag">{currency}</span>
                  {others > 0 && (
                    <UnstyledButton
                      className={page.currenciesTag}
                      onClick={() => openDialog({ kind: 'currencies' })}
                      aria-label={`${others} other currencies`}
                    >
                      <ArrowsLeftRight size={12} />+{others}
                    </UnstyledButton>
                  )}
                  <SaveStatus />
                </div>
              )}
            </div>
            <ActionIcon
              variant="subtle"
              color="gray"
              size={44}
              aria-label="Share split"
              onClick={() => openDialog({ kind: 'members' })}
              disabled={!loaded || myEmail == null}
            >
              <ShareNetwork size={20} />
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              color="gray"
              size={44}
              aria-label="More"
              onClick={() => openDialog({ kind: 'menu' })}
              disabled={!loaded}
            >
              <DotsThreeVertical
                size={20}
                weight="bold"
              />
            </ActionIcon>
          </header>
          {tab === 'items' && !selection.active && (
            <BalanceCard onSettle={() => setTab('settle')} />
          )}
          <div
            className={classes.tabs}
            role="tablist"
            aria-label="Split"
          >
            {TABS.map((t) => (
              <UnstyledButton
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={classes.tab}
                data-active={tab === t.key || undefined}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </UnstyledButton>
            ))}
          </div>
        </div>
        <SplitNotices />

        <div
          className={classes.content}
          onTouchStart={swipeStart}
          onTouchEnd={swipeEnd}
        >
          {tab === 'items' && (
            <>
              {!noPeople && state.items.length > 0 && (
                <div className={page.toolbar}>
                  <UnstyledButton
                    className={page.pill}
                    onClick={cycleGroup}
                  >
                    <StackSimple size={14} />
                    {GROUP_LABELS[prefs.groupBy]}
                  </UnstyledButton>
                  <UnstyledButton
                    className={page.pill}
                    onClick={cycleMobileSort}
                  >
                    <SortDescending size={14} />
                    {shownSort.label}
                  </UnstyledButton>
                  <span className={page.toolbarSpacer} />
                  {parts.viewToggle}
                </div>
              )}
              {parts.filterChip}
              <ErrorBoundary fallback={<div>Something went wrong showing the items.</div>}>
                {parts.list}
              </ErrorBoundary>
            </>
          )}
          {tab === 'settle' && <SettleTab panel={parts.panel} />}
          {tab === 'photos' && <PhotosTab />}
        </div>
      </div>
      {tab === 'items' && !noPeople && loaded && !selection.active && (
        <Fab
          label="Add item"
          onClick={() => openDialog({ kind: 'add' })}
        />
      )}
      {parts.dialogs}
    </>
  );
};

export default MobileSplitLayout;
