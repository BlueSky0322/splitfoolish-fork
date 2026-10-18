import { Button, NumberInput, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { isValidRate } from '@shared/rates';
import type { SplitItem } from '../../../split/state';
import type { UsedCurrency } from '../../../split/currencies';
import { usedCurrencies } from '../../../split/currencies';
import { SOURCE_LABELS, describeDay, describeRate } from '../../../utils/rate-labels';
import classes from './CurrenciesSheet.module.css';
import { plural } from '../../../utils/text';

// Each other currency items were paid in. Items are converted at the rate on the day
// they were paid, which never changes; a rate typed here goes on all of a currency's
// items, until they're put back on their days' rates.

interface CurrenciesSheetProps {
  currency: string;
  items: SplitItem[];
  onSetRate: (currency: string, rate: number | null) => void;
}

function RateRow({
  used,
  currency,
  onSetRate,
}: {
  used: UsedCurrency;
  currency: string;
  onSetRate: CurrenciesSheetProps['onSetRate'];
}) {
  const [typing, setTyping] = useState(false);
  const [rate, setRate] = useState<number | string>(used.rate);

  if (typing) {
    const valid = isValidRate(Number(rate)) && rate !== '';
    return (
      <form
        className={classes.row}
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onSetRate(used.code, Number(rate));
          setTyping(false);
        }}
      >
        <span className={classes.code}>{used.code}</span>
        <div className={classes.edit}>
          <span className="sf-muted shrink-0 text-sm">1 {used.code} =</span>
          <NumberInput
            aria-label={`${currency} per ${used.code}`}
            value={rate}
            onChange={setRate}
            decimalScale={6}
            min={0}
            hideControls
            autoFocus
            rightSection={<span className="sf-muted text-xs">{currency}</span>}
            rightSectionWidth={44}
            className="min-w-0 flex-1"
          />
        </div>
        <div className={classes.editActions}>
          <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            onClick={() => setTyping(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="compact-sm"
            disabled={!valid}
          >
            Save
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className={classes.row}>
      <span className={classes.code}>{used.code}</span>
      <div className="min-w-0 flex-1">
        <div className={classes.rate}>
          {used.varied && !used.manual && 'Newest: '}
          {describeRate(used.rate, used.code, currency)}
        </div>
        <div className={classes.source}>
          {used.manual ? 'Your rate' : `${SOURCE_LABELS[used.source]}, ${describeDay(used.at)}`}
        </div>
      </div>
      <div className={classes.side}>
        <div className={classes.count}>{plural(used.count, 'item')}</div>
        <UnstyledButton
          className={classes.action}
          onClick={() => {
            if (used.manual) {
              onSetRate(used.code, null);
            } else {
              setRate(used.rate);
              setTyping(true);
            }
          }}
        >
          {used.manual ? "Use each day's rate" : 'Use my own rate'}
        </UnstyledButton>
      </div>
    </div>
  );
}

const CurrenciesSheet = ({ currency, items, onSetRate }: CurrenciesSheetProps) => {
  const used = usedCurrencies(items);

  return (
    <div className="flex flex-col gap-3">
      <p className="sf-muted -mt-1 text-sm">
        Everything converts to {currency}, the split's currency, at the rate on the day each item
        was paid
      </p>
      {used.length === 0 ? (
        <p className="sf-muted text-sm">No items are in another currency.</p>
      ) : (
        <>
          <div className={classes.list}>
            {used.map((u) => (
              <RateRow
                // A new rate starts the row afresh
                key={`${u.code}:${u.rate}:${u.manual}`}
                used={u}
                currency={currency}
                onSetRate={onSetRate}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default CurrenciesSheet;
