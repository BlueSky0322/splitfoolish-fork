import { ActionIcon, Menu } from '@mantine/core';
import { ArrowRight, DotsThree, PencilSimple, Trash } from '@phosphor-icons/react';
import { toCents } from '@shared/rates';
import { dayLabel } from '../../../split/grouping';
import type { SplitPayment } from '../../../split/state';
import { useSplitState } from '../../../split/SplitStateContext';
import { formatMoney } from '../../../utils/money';
import PersonAvatar, { PersonName } from '../PersonAvatar';
import classes from './Payments.module.css';

/**
 * "Tom paid Ryan RM 30.00", with when, what it was for and what was paid in another
 * currency under it; Edit and Delete in a menu when the row offers them
 */
export const PaymentRow = ({
  payment,
  currency,
  showItem = true,
  onEdit,
  onDelete,
}: {
  payment: SplitPayment;
  currency: string;
  /** "for Dinner", when it settles an item; off where the item is already in view */
  showItem?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) => {
  const { items } = useSplitState().state;
  const item =
    showItem && payment.itemId != null ? items.find((i) => i.id === payment.itemId) : null;
  const { original } = payment;
  const details = [
    dayLabel(payment.createdAt),
    item && `for ${item.name}`,
    original &&
      `${formatMoney(toCents(original.amount), original.currency)}${
        original.rate == null
          ? ''
          : ` at ${original.rate.toLocaleString(undefined, { maximumSignificantDigits: 4 })}`
      }`,
    payment.notes,
  ].filter(Boolean);
  return (
    <div className={classes.row}>
      <PersonAvatar
        person={payment.from}
        size={26}
      />
      <ArrowRight
        size={14}
        className={classes.arrow}
      />
      <PersonAvatar
        person={payment.to}
        size={26}
      />
      <div className={classes.text}>
        <span className={classes.line}>
          <PersonName person={payment.from} /> paid <PersonName person={payment.to} />
        </span>
        <span className={classes.details}>{details.join(' · ')}</span>
      </div>
      <span className={classes.amount}>{formatMoney(toCents(payment.amount), currency)}</span>
      {(onEdit || onDelete) && (
        <Menu
          position="bottom-end"
          withinPortal={false}
        >
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              color="gray"
              size={28}
              aria-label="Payment actions"
            >
              <DotsThree
                size={18}
                weight="bold"
              />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {onEdit && (
              <Menu.Item
                leftSection={<PencilSimple size={16} />}
                onClick={onEdit}
              >
                Edit payment
              </Menu.Item>
            )}
            {onDelete && (
              <Menu.Item
                color="red"
                leftSection={<Trash size={16} />}
                onClick={onDelete}
              >
                Delete payment
              </Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
      )}
    </div>
  );
};
