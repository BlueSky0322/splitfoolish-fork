import { ArrowRight } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type { Person } from '@shared/types';
import { formatMoney } from '../../../utils/money';
import PersonAvatar, { PersonName } from '../PersonAvatar';
import classes from './Balances.module.css';

interface TransferRowProps {
  from: Person;
  to: Person;
  amountCents: number;
  currency: string;
  /** lg for Settle up on phones, xl for the share image */
  size?: 'md' | 'lg' | 'xl';
  /** Reads "You pay …" */
  fromMe?: boolean;
  /** A second line in the same box, e.g. how to pay */
  payLine?: ReactNode;
}

// "Chen pays Ben RM 102.50", used in the balance panel, Settle up and the share image
const TransferRow = ({
  from,
  to,
  amountCents,
  currency,
  size = 'md',
  fromMe = false,
  payLine,
}: TransferRowProps) => {
  const avatar = { md: 26, lg: 30, xl: 52 }[size];
  const row = (
    <div
      className={classes.transfer}
      data-size={size}
    >
      <PersonAvatar
        person={from}
        size={avatar}
      />
      <ArrowRight
        size={size === 'xl' ? 28 : 14}
        className={classes.transferArrow}
      />
      <PersonAvatar
        person={to}
        size={avatar}
      />
      {/* Wraps between words only, never inside a name; a name too long for a line
          of its own ends in "…" */}
      <span
        className={classes.transferText}
        title={fromMe ? `You pay ${to.name}` : `${from.name} pays ${to.name}`}
      >
        {fromMe ? (
          'You pay'
        ) : (
          <>
            <span className={classes.transferName}>
              <PersonName person={from} />
            </span>{' '}
            pays
          </>
        )}{' '}
        <span className={classes.transferName}>
          <PersonName person={to} />
        </span>
      </span>
      <span className={classes.transferAmount}>{formatMoney(amountCents, currency)}</span>
    </div>
  );
  if (payLine == null) return row;
  return (
    <div
      className={classes.transferGroup}
      data-size={size}
    >
      {row}
      <div className={classes.payLine}>{payLine}</div>
    </div>
  );
};

export default TransferRow;
