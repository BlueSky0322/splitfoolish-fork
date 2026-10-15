import { ActionIcon, Button, UnstyledButton } from '@mantine/core';
import {
  CaretLeft,
  CaretRight,
  DotsThreeOutline,
  ImageSquare,
  ShareNetwork,
  SortDescending,
  StackSimple,
} from '@phosphor-icons/react';
import type { Person } from '../../../../shared/types';
import { navigate } from '../../hooks/useRoute';
import type { SplitTotals } from '../../split/derive';
import { GROUP_LABELS } from '../../split/grouping';
import { useSplitState } from '../../split/SplitStateContext';
import { plural } from '../../utils/text';
import ErrorBoundary from '../ui/ErrorBoundary';
import Fab from '../ui/Fab';
import { BalanceHero, BalanceLine } from './balances/BalancePanel';
import { MobileSelectionBar } from './items/ItemSelection';
import SplitAvatar from '../ui/SplitAvatar';
import { useSplitPage } from './SplitPageContext';
import { AvatarStack, SaveStatus, type SelectionUi, type SplitPageParts } from './SplitPageParts';
import { useHeroHidden } from './useHeroHidden';
import { useItemViewPrefs } from './items/useItemViewPrefs';
import classes from './Split.module.css';

const MAX_AVATARS = 4;

/** "Chen and Dev owe you", for the people summary */
function oweLine(people: Person[], totals: SplitTotals, me: Person | null) {
  if (!totals.hasItems) return 'No items yet';
  if (me == null) return 'Tap to edit or pick yourself';
  const oweYou = totals.transfers.filter((t) => t.toId === me.id).map((t) => t.fromId);
  const youOwe = totals.transfers.filter((t) => t.fromId === me.id).map((t) => t.toId);
  const names = (ids: string[]) => {
    const list = ids.map((id) => people.find((p) => p.id === id)?.name ?? '');
    return list.length <= 2
      ? list.join(' and ')
      : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
  };
  if (oweYou.length > 0) return `${names(oweYou)} ${oweYou.length === 1 ? 'owes' : 'owe'} you`;
  if (youOwe.length > 0) return `You owe ${names(youOwe)}`;
  return 'Everyone is settled';
}

/** The split page on a phone: where you stand first, then the items */
const MobileSplitLayout = ({
  parts,
  selection,
}: {
  parts: SplitPageParts;
  selection: SelectionUi;
}) => {
  const { splitId, myEmail, meta, totals, me, pictureVersion, openDialog } = useSplitPage();
  const { state } = useSplitState();
  const { prefs, shownSort, cycleMobileSort, cycleGroup } = useItemViewPrefs();
  const { heroRef, barRef, heroHidden } = useHeroHidden(meta != null);
  const loaded = meta != null;
  const noPeople = loaded && state.people.length === 0;

  return (
    <>
      <div className={classes.mobile}>
        {selection.active && <MobileSelectionBar {...selection.bar} />}
        {selection.moveDialog}
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
                <BalanceLine />
              </UnstyledButton>
              <Button
                size="compact-sm"
                onClick={() => openDialog({ kind: 'settle' })}
                disabled={noPeople || !loaded}
              >
                Settle up
              </Button>
              <ActionIcon
                variant="subtle"
                color="gray"
                size={40}
                aria-label="Share image"
                onClick={() => openDialog({ kind: 'share' })}
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
                  onClick={() => openDialog({ kind: 'members' })}
                  disabled={!loaded || myEmail == null}
                >
                  <ShareNetwork size={20} />
                </ActionIcon>
                {parts.moreMenu(
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
          <BalanceHero size={40} />
          <div
            className={classes.heroButtons}
            ref={heroRef}
          >
            <Button
              onClick={() => openDialog({ kind: 'settle' })}
              disabled={noPeople || !loaded}
            >
              Settle up
            </Button>
            <Button
              variant="default"
              onClick={() => openDialog({ kind: 'share' })}
              disabled={!totals.hasItems}
            >
              Share image
            </Button>
          </div>
          <SaveStatus />
        </div>

        {state.people.length > 0 && (
          <UnstyledButton
            className={classes.peopleSummary}
            onClick={() => openDialog({ kind: 'people' })}
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

        {parts.notices}

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
            {parts.viewToggle}
          </div>
        )}
        {parts.filterChip}

        <ErrorBoundary fallback={<div>Something went wrong showing the items.</div>}>
          {parts.list}
        </ErrorBoundary>
      </div>
      {!noPeople && loaded && !selection.active && (
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
