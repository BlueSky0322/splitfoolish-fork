import { ActionIcon, Button, Select, Textarea, UnstyledButton } from '@mantine/core';
import { X } from '@phosphor-icons/react';
import { useState } from 'react';
import { fitsItemCents, isValidRate, toCents } from '@shared/rates';
import { MAX_COST, MAX_NOTES_LENGTH } from '@shared/types';
import type { PaymentInput } from '../../../api';
import { useIsMobile } from '../../../hooks/useBreakpoints';
import type { SplitPayment } from '../../../split/state';
import { useSplitState } from '../../../split/SplitStateContext';
import { useAmountConversion } from '../../../split/useAmountConversion';
import {
  atTimeNow,
  fromDateInput,
  isPastDay,
  keepTimeOf,
  toDateInput,
} from '../../../utils/date-input';
import CurrencySelect from '../../ui/CurrencySelect';
import { ConversionRow } from '../forms/ConversionRow';
import { DayField } from '../forms/DayField';
import type { PaymentPrefill } from '../SplitPageContext';
import { useSplitPage } from '../SplitPageContext';
import classes from './Payments.module.css';

/**
 * Recording that one person paid another, or editing such a payment: who, how much (in
 * the split's currency or another, converted like an item), when, what it was for and
 * any notes. Opened prefilled from a transfer in Settle up or a person's part of an item.
 */
const PaymentForm = ({
  payment,
  prefill,
  onSave,
  onCancel,
}: {
  payment?: SplitPayment;
  prefill?: PaymentPrefill;
  /** True when saved, so the form can close */
  onSave: (input: PaymentInput) => boolean;
  onCancel: () => void;
}) => {
  const { currency, me } = useSplitPage();
  const { people, items } = useSplitState().state;
  const isMobile = useIsMobile();
  const original = payment?.original ?? null;
  const [fromId, setFromId] = useState<string | null>(
    payment?.from.id ?? prefill?.fromId ?? me?.id ?? people[0]?.id ?? null,
  );
  const [toId, setToId] = useState<string | null>(
    payment?.to.id ?? prefill?.toId ?? people.find((p) => p.id !== fromId)?.id ?? null,
  );
  const [dayText, setDayText] = useState(() =>
    toDateInput(new Date(payment?.createdAt ?? Date.now())),
  );
  const [notes, setNotes] = useState(payment?.notes ?? '');
  const [itemId, setItemId] = useState(payment?.itemId ?? prefill?.itemId ?? null);
  const [tried, setTried] = useState(false);
  const item = itemId == null ? null : items.find((i) => i.id === itemId);

  const chosenDay = isPastDay(dayText) ? fromDateInput(dayText) : null;
  // When it was paid, which decides the rate; a saved payment keeps its time of day
  const paidAt =
    chosenDay == null
      ? undefined
      : payment
        ? keepTimeOf(chosenDay, payment.createdAt)
        : atTimeNow(chosenDay);
  const conversion = useAmountConversion({
    currency,
    original,
    initialExpression: payment
      ? String(payment.amount)
      : prefill?.amountCents != null
        ? (prefill.amountCents / 100).toFixed(2)
        : '',
    initialCurrency: currency,
    paidAt,
  });
  const { expression, setExpression, entryCurrency, setEntryCurrency, foreign } = conversion;
  const { ownRateChosen, ownRate, enteredCents, costCents: amountCents } = conversion;

  // Paying back a yen dinner in yen: the part in that currency, at the item's own rate,
  // so what it comes to in the split's currency is the part exactly
  const itemCurrency = item?.original?.rate != null ? item.original : null;
  const inItemCurrency = () => {
    if (itemCurrency == null || enteredCents == null) return;
    setEntryCurrency(itemCurrency.currency);
    conversion.setOwnRateChosen(true);
    conversion.setOwnRate(itemCurrency.rate!);
    setExpression((enteredCents / itemCurrency.rate! / 100).toFixed(2));
  };

  const problems = {
    amount:
      enteredCents == null || enteredCents <= 0
        ? 'Enter an amount above 0'
        : enteredCents > toCents(MAX_COST)
          ? `Amounts go up to ${MAX_COST.toLocaleString()}`
          : amountCents != null && !fitsItemCents(amountCents)
            ? `That comes to more than the split can hold in ${currency}`
            : null,
    rate: foreign && ownRateChosen && !isValidRate(ownRate) ? 'Enter the rate, like 0.03' : null,
    people:
      fromId == null || toId == null
        ? 'Choose who paid whom'
        : fromId === toId
          ? 'Choose two different people'
          : null,
    day: chosenDay == null ? 'Pick a day that has already come' : null,
  };
  const valid = Object.values(problems).every((p) => p == null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!valid || enteredCents == null || fromId == null || toId == null || paidAt == null) return;
    // Without a rate yet (offline, say), the amount as typed stands in until the server converts it
    const shownCents = amountCents ?? enteredCents;
    onSave({
      fromId,
      toId,
      amount: shownCents / 100,
      itemId,
      notes: notes.trim() === '' ? null : notes.trim(),
      createdAt: paidAt,
      original: foreign
        ? {
            currency: entryCurrency,
            amount: enteredCents / 100,
            ...(ownRateChosen && isValidRate(ownRate)
              ? { rate: ownRate, rateSource: 'manual' as const }
              : {}),
          }
        : null,
    });
  };

  const personOptions = people.map((p) => ({ value: p.id, label: p.name }));
  // Inside a dialog, so screen readers can reach the options (the dialog hides other popups)
  const combobox = { withinPortal: false };

  return (
    <form
      className={classes.form}
      onSubmit={submit}
    >
      <div className={classes.people}>
        <Select
          label="Who paid"
          data={personOptions}
          value={fromId}
          onChange={setFromId}
          allowDeselect={false}
          comboboxProps={combobox}
        />
        <Select
          label="Paid to"
          data={personOptions}
          value={toId}
          onChange={setToId}
          allowDeselect={false}
          comboboxProps={combobox}
        />
      </div>
      {tried && problems.people && <div className={classes.error}>{problems.people}</div>}
      <div className={classes.amountRow}>
        <CurrencySelect
          aria-label="Currency"
          className={classes.currency}
          first={[currency, ...(itemCurrency ? [itemCurrency.currency] : [])]}
          value={entryCurrency}
          onChange={setEntryCurrency}
          variant="unstyled"
          comboboxProps={{ ...combobox, width: 240, position: 'bottom-start' }}
        />
        <input
          className={classes.amountInput}
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          placeholder="0.00"
          inputMode="decimal"
          aria-label="Amount"
          data-autofocus={payment ? undefined : true}
          autoComplete="off"
        />
      </div>
      {tried && problems.amount && <div className={classes.error}>{problems.amount}</div>}
      {foreign && (
        <ConversionRow
          {...conversion.view}
          rateError={tried ? problems.rate : null}
          compact={isMobile}
        />
      )}
      {!foreign && itemCurrency && enteredCents != null && (
        <UnstyledButton
          className="sf-link text-[13px]"
          onClick={inItemCurrency}
        >
          In {itemCurrency.currency}, at the rate {item?.name} was paid at
        </UnstyledButton>
      )}
      {item && (
        <div className={classes.forItem}>
          <span>For {item.name}</span>
          <ActionIcon
            variant="subtle"
            color="gray"
            size={20}
            aria-label="Not for an item"
            onClick={() => setItemId(null)}
          >
            <X size={12} />
          </ActionIcon>
        </div>
      )}
      <DayField
        value={dayText}
        onChange={setDayText}
        error={tried ? problems.day : undefined}
      />
      <Textarea
        label="Notes"
        placeholder="Optional"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={MAX_NOTES_LENGTH}
        autosize
        minRows={1}
      />
      <div className={classes.actions}>
        <Button
          variant="subtle"
          color="gray"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit">{payment ? 'Save' : 'Record payment'}</Button>
      </div>
    </form>
  );
};

export default PaymentForm;
