import { ArrowDown, ArrowUp, Check } from '@phosphor-icons/react';
import { formatMoney } from '../../utils/money';
import classes from './BalanceTag.module.css';

// A split's balance in the sidebar: amount then an arrow, green when you're owed and
// red when you owe. No sign: the colour and arrow carry the direction.
const BalanceTag = ({
  cents,
  currency,
  hasItems = true,
}: {
  cents: number | null;
  currency: string;
  /** Nothing to show for a split with nothing in it yet */
  hasItems?: boolean;
}) => {
  if (cents == null || !hasItems) return null;
  if (cents === 0) {
    return (
      <span className={`${classes.tag} ${classes.settled}`}>
        <span className={classes.amount}>Settled</span>
        <Check
          size={12}
          weight="bold"
        />
      </span>
    );
  }
  const owed = cents > 0;
  return (
    <span
      className={`${classes.tag} ${owed ? 'sf-positive' : 'sf-negative'}`}
      title={owed ? "You're owed" : 'You owe'}
    >
      <span className={classes.amount}>{formatMoney(cents, currency)}</span>
      {owed ? (
        <ArrowUp
          size={12}
          weight="bold"
          aria-label="You're owed"
        />
      ) : (
        <ArrowDown
          size={12}
          weight="bold"
          aria-label="You owe"
        />
      )}
    </span>
  );
};

export default BalanceTag;
