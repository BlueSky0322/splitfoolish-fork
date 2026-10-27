import { ActionIcon, Button, Menu, UnstyledButton } from '@mantine/core';
import { CalendarBlank, Copy, PencilSimple, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { toCents } from '@shared/rates';
import { attachmentUrl } from '../../../api';
import type { Person } from '@shared/types';
import { categoryIcon, categoryLabel } from '../../../split/categories';
import { payBack } from '../../../split/derive';
import type { SplitItem } from '../../../split/state';
import { formatAmount, formatMoney } from '../../../utils/money';
import { SOURCE_LABELS } from '../../../utils/rate-labels';
import LinkedText from '../../ui/LinkedText';
import PhotoViewer from '../../ui/PhotoViewer';
import PersonAvatar from '../PersonAvatar';
import { PaidBy } from './PaidBy';
import { useSplitPage } from '../SplitPageContext';
import { useSplitState } from '../../../split/SplitStateContext';
import { useSplitActions } from '../../../split/useSplit';
import { PaymentRow } from '../payments/PaymentRow';
import { deletePayment } from '../payments/delete-payment';
import classes from './ItemDetail.module.css';

/** "Sat 11 Oct" */
const shortDate = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * Paid back, by someone's part of an item: a button to record it while they still owe
 * money, prefilled with what's left of their part up to what they owe, or a tag once
 * they've paid it. Nothing for whoever paid for it, or for someone settled or owed money.
 */
function PayBack({ item, person }: { item: SplitItem; person: Person }) {
  const { totals, openDialog } = useSplitPage();
  const { payments } = useSplitState().state;
  const { paidCents, dueCents } = payBack(item, person.id, totals, payments);
  if (dueCents > 0) {
    return (
      <Button
        variant="subtle"
        size="compact-xs"
        aria-label={`${person.name} paid back`}
        onClick={() =>
          openDialog({
            kind: 'payment',
            prefill: {
              fromId: person.id,
              toId: item.payer.id,
              amountCents: dueCents,
              itemId: item.id,
            },
          })
        }
      >
        Paid back
      </Button>
    );
  }
  return paidCents > 0 ? <span className="sf-tag">Paid back</span> : null;
}

/**
 * Phones: an item as it stands (10l). The amount and how it was converted, its category,
 * date and payer, what each person's part comes to (with Paid back, to record that they
 * paid it, while they still owe money), the payments that settled it, and its receipts. Duplicate, Delete and Edit
 * sit at the bottom; Edit opens the form.
 */
const ItemDetail = ({
  item,
  onEdit,
  onDelete,
  onDuplicate,
}: {
  item: SplitItem;
  onEdit: () => void;
  onDelete: () => void;
  /** Adds a copy, keeping its date or as of today */
  onDuplicate: (keepDate: boolean) => void;
}) => {
  const { splitId, currency, totals, photos, openDialog } = useSplitPage();
  const { payments } = useSplitState().state;
  const actions = useSplitActions();
  const [viewing, setViewing] = useState<number | null>(null);
  const parts = totals.sharesByItem.get(item.id);
  const settledBy = payments.filter((p) => p.itemId === item.id);
  const receipts = photos.photosOf(item.id);
  const { original } = item;
  const Icon = categoryIcon(item.category);

  return (
    <div className={classes.detail}>
      <div>
        <div className={classes.amount}>{formatMoney(toCents(item.cost), currency)}</div>
        {original && (
          <div className="sf-muted text-[13px]">
            {formatMoney(toCents(original.amount), original.currency)}
            {original.rate != null &&
              ` at ${original.rate.toLocaleString(undefined, { maximumSignificantDigits: 4 })}`}
            {original.rateSource && `, ${SOURCE_LABELS[original.rateSource]}`}
          </div>
        )}
      </div>
      <div className={classes.tags}>
        <span className="sf-tag">
          {Icon && <Icon size={12} />}
          {categoryLabel(item.category)}
        </span>
        <span className="sf-tag">{shortDate(item.createdAt)}</span>
        <span className="sf-tag">
          <PaidBy item={item} />
        </span>
      </div>
      <ul
        className={classes.parts}
        aria-label="Each person's part"
      >
        {item.participants.map((p) => (
          <li
            key={p.id}
            className={classes.part}
          >
            <PersonAvatar
              person={p}
              size={30}
            />
            <span className={classes.name}>{p.name}</span>
            <PayBack
              item={item}
              person={p}
            />
            <span className={classes.partAmount}>
              {formatAmount(parts?.get(p.id) ?? 0, currency)}
            </span>
          </li>
        ))}
      </ul>
      {settledBy.length > 0 && (
        <div className="flex flex-col gap-2">
          <h6 className="sf-label">Paid back</h6>
          {settledBy.map((p) => (
            <PaymentRow
              key={p.id}
              payment={p}
              currency={currency}
              showItem={false}
              onEdit={() => openDialog({ kind: 'payment', payment: p })}
              onDelete={() => deletePayment(actions, p)}
            />
          ))}
        </div>
      )}
      {item.notes && (
        <p className={classes.notes}>
          <LinkedText text={item.notes} />
        </p>
      )}
      {receipts.length > 0 && (
        <div className={classes.receipts}>
          {receipts.map((photo, i) => (
            <UnstyledButton
              key={photo.id}
              className={classes.receipt}
              onClick={() => setViewing(i)}
              aria-label={`Receipt ${i + 1}`}
            >
              <img
                src={attachmentUrl(splitId, photo.id)}
                alt=""
                loading="lazy"
              />
            </UnstyledButton>
          ))}
        </div>
      )}
      <div className={classes.footer}>
        <Menu
          position="top-end"
          withinPortal={false}
        >
          <Menu.Target>
            <ActionIcon
              variant="default"
              size={48}
              radius={12}
              aria-label="Duplicate item"
            >
              <Copy size={20} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Duplicate</Menu.Label>
            <Menu.Item
              leftSection={<Copy size={16} />}
              onClick={() => onDuplicate(true)}
            >
              Keep its date
            </Menu.Item>
            <Menu.Item
              leftSection={<CalendarBlank size={16} />}
              onClick={() => onDuplicate(false)}
            >
              Dated today
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
        <ActionIcon
          variant="default"
          size={48}
          radius={12}
          className="sf-danger-outline"
          aria-label="Delete item"
          onClick={onDelete}
        >
          <Trash size={20} />
        </ActionIcon>
        <ActionIcon
          size={48}
          radius={12}
          aria-label="Edit item"
          onClick={onEdit}
        >
          <PencilSimple size={20} />
        </ActionIcon>
      </div>
      <PhotoViewer
        photos={receipts.map((photo) => ({
          key: photo.id,
          src: attachmentUrl(splitId, photo.id),
        }))}
        index={viewing}
        onIndexChange={setViewing}
      />
    </div>
  );
};

export default ItemDetail;
