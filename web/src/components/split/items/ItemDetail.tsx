import { ActionIcon, Menu, UnstyledButton } from '@mantine/core';
import { CalendarBlank, Copy, PencilSimple, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { toCents } from '@shared/rates';
import { attachmentUrl } from '../../../api';
import { categoryIcon, categoryLabel } from '../../../split/categories';
import type { SplitItem } from '../../../split/state';
import { formatAmount, formatMoney } from '../../../utils/money';
import { SOURCE_LABELS } from '../../../utils/rate-labels';
import PhotoViewer from '../../ui/PhotoViewer';
import PersonAvatar from '../PersonAvatar';
import { PaidBy } from './PaidBy';
import { useSplitPage } from '../SplitPageContext';
import classes from './ItemDetail.module.css';

/** "Sat 11 Oct" */
const shortDate = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * Phones: an item as it stands (10l). The amount and how it was converted, its category,
 * date and payer, what each person's part comes to, and its receipts. Duplicate, Delete
 * and Edit sit at the bottom; Edit opens the form.
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
  const { splitId, currency, totals, photos } = useSplitPage();
  const [viewing, setViewing] = useState<number | null>(null);
  const parts = totals.sharesByItem.get(item.id);
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
        {item.category && (
          <span className="sf-tag">
            {Icon && <Icon size={12} />}
            {categoryLabel(item.category)}
          </span>
        )}
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
            <span className={classes.partAmount}>
              {formatAmount(parts?.get(p.id) ?? 0, currency)}
            </span>
          </li>
        ))}
      </ul>
      {item.notes && <p className={classes.notes}>{item.notes}</p>}
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
