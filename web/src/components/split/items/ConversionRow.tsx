import { NumberInput, UnstyledButton } from '@mantine/core';
import type { RateSource } from '@shared/rates';
import { formatMoney } from '../../../utils/money';
import { SOURCE_LABELS, describeRate } from '../../../utils/rate-labels';
import classes from './ConversionRow.module.css';

/**
 * Under an amount in another currency, in the item and payment forms: the rate it's
 * converted at, the day's or one typed, and what it comes to
 */
export function ConversionRow({
  entryCurrency,
  currency,
  ownRateChosen,
  ownRate,
  onOwnRate,
  rateError,
  costCents,
  note,
  rate,
  rateSource,
  paidBefore,
  compact,
  onChooseOwn,
  onUseLive,
}: {
  /** Phones: one line, "≈ RM 89.10 at 0.0297, Wise" */
  compact?: boolean;
  entryCurrency: string;
  currency: string;
  ownRateChosen: boolean;
  ownRate: number | '';
  onOwnRate: (rate: number | '') => void;
  rateError: string | null | undefined;
  costCents: number | null;
  note: string;
  rate: number | null;
  rateSource: RateSource | null;
  /** Paid before today, so it goes back to that day's rate rather than the live one */
  paidBefore: boolean;
  onChooseOwn: () => void;
  onUseLive: () => void;
}) {
  return (
    <div className={classes.conversion}>
      {ownRateChosen ? (
        <>
          <span>1 {entryCurrency} =</span>
          <NumberInput
            aria-label={`How much 1 ${entryCurrency} is in ${currency}`}
            className={classes.rateInput}
            value={ownRate}
            onChange={(v) => onOwnRate(v === '' ? '' : Number(v))}
            min={0}
            decimalScale={6}
            hideControls
            size="xs"
            placeholder="0.00"
            error={rateError}
          />
          <span>{currency}</span>
          {costCents != null && (
            <span className={classes.converted}>≈ {formatMoney(costCents, currency)}</span>
          )}
          <UnstyledButton
            className={classes.rateToggle}
            onClick={onUseLive}
          >
            {paidBefore ? "Use that day's rate" : 'Use the live rate'}
          </UnstyledButton>
        </>
      ) : (
        <>
          <span className={compact ? undefined : classes.converted}>
            {note}
            {compact && costCents != null && rate != null && rateSource != null && (
              <>
                {' '}
                at {rate.toLocaleString(undefined, { maximumSignificantDigits: 4 })},{' '}
                {SOURCE_LABELS[rateSource]}
              </>
            )}
          </span>
          {!compact && rate != null && rateSource != null && (
            <span>
              {describeRate(rate, entryCurrency, currency)} · {SOURCE_LABELS[rateSource]}
            </span>
          )}
          <UnstyledButton
            className={classes.rateToggle}
            onClick={onChooseOwn}
          >
            Use my own rate
          </UnstyledButton>
        </>
      )}
    </div>
  );
}
