import { ActionIcon, UnstyledButton, UnstyledButtonProps } from '@mantine/core';
import { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Note, Paperclip, PencilSimple, Trash } from '@phosphor-icons/react';
import { IItem, IPerson } from '../../interfaces/app-reducer';
import { SplitSummary } from '../../split/derive';
import { categoryIcon } from '../../split/categories';
import { ItemGroup, SortDir, SortKey } from '../../split/grouping';
import { currencySymbol, formatMoney } from '../../utils/money';
import { RowSelection, useLongPress } from '../../hooks/useItemSelection';
import { RowCheck } from './ItemSelection';
import PersonAvatar from './PersonAvatar';
import classes from './Split.module.css';

interface ItemViewProps {
  groups: ItemGroup[];
  /** Hide group headers when there's only the one "all items" group */
  grouped: boolean;
  summary: SplitSummary;
  me: IPerson | null;
  people: IPerson[];
  currency: string;
  mobile: boolean;
  onEdit: (item: IItem) => void;
  onDelete: (item: IItem) => void;
  /** Receipt photos per item id */
  photoCounts: Map<string, number>;
  /** Picking several items at once; absent where items can't be picked */
  selection?: RowSelection;
}

/**
 * An item's tap target: opens it, or while selecting picks it. A long press with a
 * finger starts selecting.
 */
function ItemButton({
  id,
  selection,
  onOpen,
  children,
  ...props
}: UnstyledButtonProps & {
  id: string;
  selection?: RowSelection;
  onOpen: () => void;
  children: ReactNode;
  role?: string;
}) {
  const { consumeClick, ...press } = useLongPress(() => selection?.toggle(id));
  return (
    <UnstyledButton
      {...props}
      {...(selection ? press : {})}
      onClick={(e) => {
        if (consumeClick()) return;
        if (selection?.active) selection.toggle(id, e.shiftKey);
        else onOpen();
      }}
    >
      {children}
    </UnstyledButton>
  );
}

/** The tick in a row, while picking items */
function CheckSlot({ item, selection }: { item: IItem; selection?: RowSelection }) {
  if (selection == null || !selection.active) return null;
  return (
    <span
      className={classes.checkSlot}
      data-active={selection.active || undefined}
    >
      <RowCheck
        id={item.id}
        name={item.name}
        selection={selection}
      />
    </span>
  );
}

function PhotoBadge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span
      className={classes.photoBadge}
      title={`${count} ${count === 1 ? 'photo' : 'photos'}`}
    >
      <Paperclip size={12} />
      {count > 1 && count}
    </span>
  );
}

/** Shown when an item has notes; hovering shows them */
function NotesBadge({ notes }: { notes?: string | null }) {
  if (!notes) return null;
  return (
    <span
      className={classes.photoBadge}
      title={notes}
      aria-label="Has notes"
    >
      <Note size={12} />
    </span>
  );
}

const MODE_LABELS = { equal: 'Equal', shares: 'Shares', exact: 'Exact' } as const;

/** What an item in another currency came to as paid, under its converted amount */
function OriginalAmount({ item }: { item: IItem }) {
  if (item.original == null) return null;
  return (
    <span className={classes.originalAmount}>
      {formatMoney(Math.round(item.original.amount * 100), item.original.currency)}
    </span>
  );
}

const cents = (amount: number) => Math.round(amount * 100);

const who = (item: IItem, people: IPerson[]) =>
  item.participants.length === people.length && people.length > 1
    ? 'everyone'
    : item.participants.map((p) => p.name).join(', ');

function useMyShare(summary: SplitSummary, me: IPerson | null) {
  return (item: IItem) => (me == null ? null : summary.sharesByItem.get(item.id)?.get(me.id) ?? 0);
}

function RowActions({
  item,
  onEdit,
  onDelete,
}: { item: IItem } & Pick<ItemViewProps, 'onEdit' | 'onDelete'>) {
  return (
    <div className={classes.rowActions}>
      <ActionIcon
        variant="subtle"
        color="gray"
        size={28}
        aria-label={`Edit ${item.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onEdit(item);
        }}
      >
        <PencilSimple size={16} />
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        color="gray"
        size={28}
        aria-label={`Delete ${item.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete(item);
        }}
      >
        <Trash size={16} />
      </ActionIcon>
    </div>
  );
}

export function ItemCards({
  photoCounts,
  groups,
  grouped,
  summary,
  me,
  people,
  currency,
  mobile,
  onEdit,
  onDelete,
  selection,
}: ItemViewProps) {
  const myShare = useMyShare(summary, me);
  return (
    <div
      className={classes.groups}
      data-selecting={selection?.active || undefined}
    >
      {groups.map((group) => (
        <section
          key={group.key}
          className={classes.group}
        >
          {grouped && (
            <div className={classes.groupHeader}>
              <span>{group.label}</span>
              <span>{formatMoney(group.subtotalCents, currency)}</span>
            </div>
          )}
          <div className={classes.itemCard}>
            {group.items.map((item) => {
              const share = myShare(item);
              const Icon = categoryIcon(item.category);
              return (
                <div
                  key={item.id}
                  className={classes.itemRow}
                  data-selected={selection?.selected.has(item.id) || undefined}
                >
                  <CheckSlot
                    item={item}
                    selection={selection}
                  />
                  {Icon && !mobile && (
                    <Icon
                      size={18}
                      className={classes.categoryIcon}
                    />
                  )}
                  {/* The whole row opens the item; edit and delete sit above it */}
                  <ItemButton
                    id={item.id}
                    selection={selection}
                    className={`${classes.itemText} ${classes.stretched}`}
                    onOpen={() => onEdit(item)}
                  >
                    <div className={classes.itemName}>
                      {item.name}
                      <PhotoBadge count={photoCounts.get(item.id)} />
                      <NotesBadge notes={item.notes} />
                    </div>
                    <div className={classes.itemMeta}>
                      {mobile
                        ? `${item.payer.name} paid${share != null ? ` · yours ${formatMoney(share, currency)}` : ''}`
                        : `${item.payer.name} paid · ${MODE_LABELS[item.splitMode]} between ${who(item, people)}`}
                    </div>
                  </ItemButton>
                  {!mobile && share != null && (
                    <span className={classes.itemShare}>
                      Your share {formatMoney(share, currency)}
                    </span>
                  )}
                  <span className={classes.itemAmount}>
                    {formatMoney(cents(item.cost), currency)}
                    <OriginalAmount item={item} />
                  </span>
                  {!mobile && !selection?.active && (
                    <RowActions
                      item={item}
                      onEdit={onEdit}
                      onDelete={onDelete}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

interface ItemTableProps extends ItemViewProps {
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  totalCents: number;
}

function SortHeader({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
  align,
}: {
  label: string;
  column: SortKey;
  align?: 'right';
} & Pick<ItemTableProps, 'sortKey' | 'sortDir' | 'onSort'>) {
  const active = sortKey === column;
  return (
    <UnstyledButton
      className={`${classes.sortButton} ${align === 'right' ? classes.right : ''}`}
      data-active={active || undefined}
      onClick={() => onSort(column)}
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      {label}
      {active &&
        (sortDir === 'asc' ? (
          <ArrowUp
            size={12}
            weight="bold"
          />
        ) : (
          <ArrowDown
            size={12}
            weight="bold"
          />
        ))}
    </UnstyledButton>
  );
}

export function ItemTable({
  photoCounts,
  groups,
  grouped,
  summary,
  me,
  people,
  currency,
  mobile,
  onEdit,
  onDelete,
  sortKey,
  sortDir,
  onSort,
  totalCents,
  selection,
}: ItemTableProps) {
  const myShare = useMyShare(summary, me);
  const sort = { sortKey, sortDir, onSort };

  return (
    <div
      className={classes.table}
      role="table"
      data-selecting={selection?.active || undefined}
    >
      <div
        className={classes.tableHead}
        role="row"
      >
        <SortHeader
          label="Item"
          column="name"
          {...sort}
        />
        {mobile ? (
          <>
            <span className={classes.right}>Yours</span>
            <span className={classes.right}>{currencySymbol(currency)}</span>
          </>
        ) : (
          <>
            <SortHeader
              label="Paid by"
              column="payer"
              {...sort}
            />
            <span>Split</span>
            <span className={classes.right}>Your share</span>
            <SortHeader
              label="Amount"
              column="amount"
              align="right"
              {...sort}
            />
          </>
        )}
      </div>

      {groups.map((group) => (
        <div
          key={group.key}
          role="rowgroup"
        >
          {grouped && (
            <div className={classes.tableGroup}>
              <span className={classes.tableGroupLabel}>{group.label}</span>
              <span className={classes.tableGroupCount}>
                {group.items.length} {group.items.length === 1 ? 'item' : 'items'}
              </span>
              <span className={classes.tableGroupTotal}>
                {formatMoney(group.subtotalCents, currency)}
              </span>
            </div>
          )}
          {group.items.map((item) => {
            const share = myShare(item);
            const shareText = share == null ? '—' : formatMoney(share, currency);
            if (mobile) {
              return (
                <ItemButton
                  key={item.id}
                  id={item.id}
                  selection={selection}
                  className={classes.tableRow}
                  role="row"
                  data-selected={selection?.selected.has(item.id) || undefined}
                  onOpen={() => onEdit(item)}
                >
                  <span className={classes.payerCell}>
                    <CheckSlot
                      item={item}
                      selection={selection}
                    />
                    <PersonAvatar
                      preview={false}
                      person={item.payer}
                      size={26}
                    />
                    <span className="min-w-0">
                      <span className={`${classes.cellEllipsis} block text-[14px]`}>
                        {item.name}
                      </span>
                      <span className={`${classes.cellEllipsis} block text-[11px] sf-muted`}>
                        {MODE_LABELS[item.splitMode]} · {who(item, people)}
                      </span>
                    </span>
                  </span>
                  <span className={`${classes.num} sf-muted text-[13px]`}>
                    {share == null ? '—' : (share / 100).toFixed(2)}
                  </span>
                  <span className={classes.num}>
                    {item.cost.toFixed(2)}
                    <OriginalAmount item={item} />
                  </span>
                </ItemButton>
              );
            }
            return (
              <div
                key={item.id}
                className={classes.tableRow}
                role="row"
                data-selected={selection?.selected.has(item.id) || undefined}
                onClick={(e) => selection?.active && selection.toggle(item.id, e.shiftKey)}
                onDoubleClick={() => !selection?.active && onEdit(item)}
              >
                <span className={classes.nameCell}>
                  <CheckSlot
                    item={item}
                    selection={selection}
                  />
                  <span className={classes.cellEllipsis}>
                    {item.name}
                    <PhotoBadge count={photoCounts.get(item.id)} />
                    <NotesBadge notes={item.notes} />
                  </span>
                </span>
                <span className={classes.payerCell}>
                  <PersonAvatar
                    person={item.payer}
                    size={22}
                  />
                  <span className={classes.cellEllipsis}>{item.payer.name}</span>
                </span>
                <span className={classes.cellEllipsis}>
                  <span className={classes.modePill}>{MODE_LABELS[item.splitMode]}</span>
                  {who(item, people)}
                </span>
                <span className={`${classes.num} sf-muted`}>{shareText}</span>
                <span className={classes.num}>
                  {formatMoney(cents(item.cost), currency)}
                  <OriginalAmount item={item} />
                </span>
                {!selection?.active && (
                  <RowActions
                    item={item}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}

      <div
        className={classes.tableFoot}
        role="row"
      >
        <span>Total</span>
        {mobile ? (
          <>
            <span className={classes.num}>
              {me ? ((summary.balances.get(me.id)?.shareCents ?? 0) / 100).toFixed(2) : ''}
            </span>
            <span className={classes.num}>{(totalCents / 100).toFixed(2)}</span>
          </>
        ) : (
          <>
            <span />
            <span />
            <span className={`${classes.num} sf-muted`}>
              {me ? formatMoney(summary.balances.get(me.id)?.shareCents ?? 0, currency) : ''}
            </span>
            <span className={classes.num}>{formatMoney(totalCents, currency)}</span>
          </>
        )}
      </div>
    </div>
  );
}
