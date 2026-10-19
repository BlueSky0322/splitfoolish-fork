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

// "Chen pays Ben RM 102.50", used in the balance panel, Settle up and the share image:
// the two avatars and the amount on one line, and who pays whom under them
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
      <div className={classes.transferTop}>
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
        <span className={classes.transferAmount}>{formatMoney(amountCents, currency)}</span>
      </div>
      {/* One line: names too long for it shorten with "…", so "pays" always shows */}
      <span
        className={classes.transferText}
        title={fromMe ? `You pay ${to.name}` : `${from.name} pays ${to.name}`}
      >
        {fromMe ? (
          <span className={classes.transferPays}>You pay </span>
        ) : (
          <>
            <span className={classes.transferName}>
              <PersonName person={from} />
            </span>
            <span className={classes.transferPays}> pays </span>
          </>
        )}
        <span className={classes.transferName}>
          <PersonName person={to} />
        </span>
      </span>
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
