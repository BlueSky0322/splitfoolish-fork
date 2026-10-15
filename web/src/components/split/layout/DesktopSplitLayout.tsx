import { ActionIcon, Button, Menu, Title, Tooltip, UnstyledButton } from '@mantine/core';
import {
  ArrowsLeftRight,
  CaretDown,
  CheckSquare,
  DotsThreeOutline,
  Plus,
  ShareNetwork,
  SortAscending,
  SortDescending,
  StackSimple,
} from '@phosphor-icons/react';
import { GROUP_LABELS, type SortDir, type SortKey } from '../../../split/grouping';
import { useSplitState } from '../../../split/SplitStateContext';
import { currencySymbol } from '../../../utils/money';
import ErrorBoundary from '../../ui/ErrorBoundary';
import { DesktopSelectionBar } from '../items/ItemSelection';
import SplitAvatar from '../../common/SplitAvatar';
import { useSplitPage } from '../SplitPageContext';
import { otherCurrencyCount } from '../../../split/derive';
import {
  AvatarStack,
  SaveStatus,
  type SelectionUi,
  type SplitPageParts,
  SplitMoreMenu,
  SplitNotices,
} from './SplitPageParts';
import { GROUP_ORDER, useItemViewPrefs } from '../items/useItemViewPrefs';
import classes from '../Split.module.css';
import { canChangePeople } from '@shared/rules';

/** The split page on a computer: the items, with the balances alongside */
const SORT_LABELS: Record<SortKey, string> = {
  date: 'Date',
  amount: 'Amount',
  name: 'Item',
  payer: 'Paid by',
};

/** Each way round, as it reads for that sort: "Newest first", "A to Z" */
const DIRECTION_LABELS: Record<SortKey, Record<SortDir, string>> = {
  date: { desc: 'Newest first', asc: 'Oldest first' },
  amount: { desc: 'Largest first', asc: 'Smallest first' },
  name: { asc: 'A to Z', desc: 'Z to A' },
  payer: { asc: 'A to Z', desc: 'Z to A' },
};

const DesktopSplitLayout = ({
  parts,
  selection,
}: {
  parts: SplitPageParts;
  selection: SelectionUi;
}) => {
  const { splitId, myEmail, meta, currency, pictureVersion, openDialog } = useSplitPage();
  const { state } = useSplitState();
  const { prefs, setPref, sortBy } = useItemViewPrefs();
  const loaded = meta != null;
  const hasPeople = state.people.length > 0;
  const otherCurrencies = otherCurrencyCount(state.items);

  return (
    <>
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
                <Title order={2}>{meta?.name ?? ' '}</Title>
                {meta && (
                  <span className="sf-tag">
                    {currency} · {currencySymbol(currency)}
                  </span>
                )}
                {otherCurrencies > 0 && (
                  <Tooltip label="Currencies">
                    <UnstyledButton
                      className={classes.currenciesTag}
                      onClick={() => openDialog({ kind: 'currencies' })}
                      aria-label={`${otherCurrencies} other currencies`}
                    >
                      <ArrowsLeftRight size={12} />+{otherCurrencies}
                    </UnstyledButton>
                  </Tooltip>
                )}
              </div>
              <SaveStatus />
            </div>
            <div className={classes.actions}>
              <Button
                variant="default"
                leftSection={<ShareNetwork size={16} />}
                onClick={() => openDialog({ kind: 'members' })}
                disabled={!loaded || myEmail == null}
              >
                Share
              </Button>
              <SplitMoreMenu
                target={
                  <ActionIcon
                    variant="default"
                    size={36}
                    aria-label="More"
                  >
                    <DotsThreeOutline size={16} />
                  </ActionIcon>
                }
              />
              <Button
                leftSection={<Plus size={16} />}
                onClick={() => openDialog({ kind: 'add' })}
                disabled={!loaded || !hasPeople}
              >
                Add item
              </Button>
            </div>
          </div>

          {hasPeople && (
            <div className={classes.peopleLine}>
              <AvatarStack
                people={state.people}
                size={26}
                max={6}
              />
              <span className={classes.peopleNames}>
                {state.people.map((p) => p.name).join(', ')}
              </span>
              <button
                type="button"
                className={classes.linkButton}
                onClick={() => openDialog({ kind: 'people' })}
              >
                {meta != null && canChangePeople(meta.role) ? 'Edit people' : 'See people'}
              </button>
            </div>
          )}

          <SplitNotices />

          {hasPeople && state.items.length > 0 && (
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
              <Menu
                position="bottom-start"
                withinPortal
              >
                <Menu.Target>
                  <Button
                    variant="subtle"
                    color="gray"
                    leftSection={
                      prefs.sortDir === 'asc' ? (
                        <SortAscending size={16} />
                      ) : (
                        <SortDescending size={16} />
                      )
                    }
                    rightSection={<CaretDown size={12} />}
                    aria-label={`Sort: ${SORT_LABELS[prefs.sortKey]}, ${DIRECTION_LABELS[prefs.sortKey][prefs.sortDir]}`}
                  >
                    {SORT_LABELS[prefs.sortKey]}
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Sort by</Menu.Label>
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                    <Menu.Item
                      key={key}
                      // The one already chosen keeps its direction; another starts its usual way
                      onClick={() => key !== prefs.sortKey && sortBy(key)}
                      color={key === prefs.sortKey ? 'accent' : undefined}
                    >
                      {SORT_LABELS[key]}
                    </Menu.Item>
                  ))}
                  <Menu.Divider />
                  {(['desc', 'asc'] as SortDir[]).map((dir) => (
                    <Menu.Item
                      key={dir}
                      leftSection={
                        dir === 'asc' ? <SortAscending size={14} /> : <SortDescending size={14} />
                      }
                      onClick={() => setPref({ sortDir: dir })}
                      color={dir === prefs.sortDir ? 'accent' : undefined}
                    >
                      {DIRECTION_LABELS[prefs.sortKey][dir]}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
              {parts.filterChip}
              <span className={classes.toolbarSpacer} />
              <Button
                variant={selection.active ? 'light' : 'default'}
                size="xs"
                leftSection={<CheckSquare size={14} />}
                onClick={selection.active ? selection.clear : selection.start}
                aria-pressed={selection.active}
              >
                {selection.active ? 'Done' : 'Select'}
              </Button>
              {parts.viewToggle}
            </div>
          )}

          <ErrorBoundary fallback={<div>Something went wrong showing the items.</div>}>
            {parts.list}
          </ErrorBoundary>
          {selection.active && <DesktopSelectionBar {...selection.bar} />}
          {selection.moveDialog}
        </div>
        <aside className={classes.aside}>{parts.panel}</aside>
      </div>
      {parts.dialogs}
    </>
  );
};

export default DesktopSplitLayout;
