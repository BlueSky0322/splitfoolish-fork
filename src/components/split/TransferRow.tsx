import { ArrowRight } from '@phosphor-icons/react';
import { IPerson } from '../../interfaces/app-reducer';
import { formatMoney } from '../../utils/money';
import PersonAvatar from './PersonAvatar';
import classes from './Split.module.css';

interface TransferRowProps {
  from: IPerson;
  to: IPerson;
  amountCents: number;
  currency: string;
  /** lg for Settle up on phones, xl for the share image */
  size?: 'md' | 'lg' | 'xl';
}

// "Chen pays Ben RM 102.50", used in the balance panel, Settle up and the share image
const TransferRow = ({ from, to, amountCents, currency, size = 'md' }: TransferRowProps) => {
  const avatar = { md: 26, lg: 30, xl: 52 }[size];
  return (
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
      <span className={classes.transferText}>
        {from.name} pays {to.name}
      </span>
      <span className={classes.transferAmount}>{formatMoney(amountCents, currency)}</span>
    </div>
  );
};

export default TransferRow;
