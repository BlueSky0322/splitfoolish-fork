import { Balance } from '../../../../../shared/settle';
import type { Person } from '../../../../../shared/types';
import { formatSigned } from '../../../utils/money';
import classes from '../Split.module.css';

// Each person's balance as a bar from the middle: right and green when they're owed,
// left and red when they owe
const BalanceBars = ({
  people,
  balances,
}: {
  people: Person[];
  balances: Map<string, Balance>;
}) => {
  const max = Math.max(1, ...people.map((p) => Math.abs(balances.get(p.id)?.balanceCents ?? 0)));
  return (
    <div className={classes.bars}>
      {people.map((p) => {
        const cents = balances.get(p.id)?.balanceCents ?? 0;
        const width = `${(Math.abs(cents) / max) * 100}%`;
        return (
          <div
            key={p.id}
            className={classes.barRow}
          >
            <span className={classes.barName}>{p.name}</span>
            <div
              className={classes.barTrack}
              aria-hidden
            >
              <div className={classes.barHalf}>
                {cents < 0 && (
                  <div
                    className={`${classes.bar} ${classes.barNegative}`}
                    style={{ width }}
                  />
                )}
              </div>
              <div className={classes.barHalf}>
                {cents > 0 && (
                  <div
                    className={`${classes.bar} ${classes.barPositive}`}
                    style={{ width }}
                  />
                )}
              </div>
            </div>
            <span
              className={`${classes.barAmount} ${
                cents > 0 ? 'sf-positive' : cents < 0 ? 'sf-negative' : 'sf-muted'
              }`}
            >
              {formatSigned(cents)}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default BalanceBars;
