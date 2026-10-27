import { convertCents, rateDay, toCents } from '@shared/rates';
import type { RateSource } from '@shared/rates';
import { useMemo, useState } from 'react';
import { useRate } from '../hooks/useRate';
import { evaluateSum } from '../utils/math';
import { formatMoney } from '../utils/money';
import { type RateInputs, chooseRate } from './item-input';

/** What the line under an amount in another currency shows, and what it can change */
export interface ConversionView {
  entryCurrency: string;
  currency: string;
  ownRateChosen: boolean;
  ownRate: number | '';
  onOwnRate: (rate: number | '') => void;
  /** What it comes to in the split's currency; null until there's a rate */
  costCents: number | null;
  /** "≈ RM 89.10", or why that isn't known yet */
  note: string;
  rate: number | null;
  rateSource: RateSource | null;
  /** Paid before today, so it goes back to that day's rate rather than the live one */
  paidBefore: boolean;
  onChooseOwn: () => void;
  onUseLive: () => void;
}

/**
 * An amount typed in the item and payment forms, in the split's currency or another: the
 * sum as typed ("30*3"), the currency it was paid in, the rate (the one it was saved
 * with, the day's, or one typed) and what it comes to in the split's currency. Each form
 * keeps its own rules for the amount (an item may be 0, a payment must be more).
 */
export function useAmountConversion({
  currency,
  original,
  initialExpression,
  initialCurrency,
  paidAt,
}: {
  /** The split's currency */
  currency: string;
  /** What it was saved with, when editing; its amount and currency are typed again */
  original: RateInputs['original'];
  initialExpression: string;
  initialCurrency: string;
  /** When it was paid, which decides the day's rate; undefined while no day is picked */
  paidAt: number | undefined;
}) {
  const [expression, setExpression] = useState(
    original ? String(original.amount) : initialExpression,
  );
  const [entryCurrency, setEntryCurrency] = useState(original?.currency ?? initialCurrency);
  const [ownRateChosen, setOwnRateChosen] = useState(original?.rateSource === 'manual');
  const [ownRate, setOwnRate] = useState<number | ''>(
    original?.rateSource === 'manual' ? original.rate ?? '' : '',
  );
  const foreign = entryCurrency !== currency;

  /** The amount as typed: a number or a sum like "30*3"; null while it doesn't work out */
  const amount = useMemo(() => evaluateSum(expression), [expression]);
  /** The amount as typed, in cents of the currency it was paid in */
  const enteredCents = amount == null || amount < 0 ? null : toCents(amount);
  const fetched = useRate(entryCurrency, currency, {
    enabled: foreign && !ownRateChosen,
    at: paidAt,
  });
  const { rate, source: rateSource } = chooseRate({
    foreign,
    entryCurrency,
    enteredCents,
    ownRateChosen,
    ownRate,
    original,
    fetched: fetched.data,
  });
  /** The amount in the split's currency; unknown in another currency until there's a rate */
  const costCents = enteredCents == null || rate == null ? null : convertCents(enteredCents, rate);
  const note =
    costCents != null
      ? `≈ ${formatMoney(costCents, currency)}`
      : fetched.isError
        ? 'Converted when saved'
        : enteredCents == null
          ? ''
          : 'Getting the rate…';

  const view: ConversionView = {
    entryCurrency,
    currency,
    ownRateChosen,
    ownRate,
    onOwnRate: setOwnRate,
    costCents,
    note,
    rate,
    rateSource,
    paidBefore: paidAt != null && rateDay(paidAt) < rateDay(Date.now()),
    onChooseOwn: () => {
      setOwnRateChosen(true);
      if (ownRate === '' && rate != null) setOwnRate(rate);
    },
    onUseLive: () => setOwnRateChosen(false),
  };

  return {
    expression,
    setExpression,
    entryCurrency,
    setEntryCurrency,
    foreign,
    ownRateChosen,
    setOwnRateChosen,
    ownRate,
    setOwnRate,
    amount,
    enteredCents,
    rate,
    costCents,
    view,
  };
}
