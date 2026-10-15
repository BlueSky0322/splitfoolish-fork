import { ActionIcon, NumberInput, SegmentedControl, UnstyledButton } from '@mantine/core';
import { Check, Minus, Plus } from '@phosphor-icons/react';
import type { SplitMode } from '@shared/settle';
import { MAX_SHARES } from '@shared/settle';
import type { Person } from '@shared/types';
import { currencySymbol, formatAmount, formatMoney } from '../../../utils/money';
import PersonAvatar from '../PersonAvatar';
import classes from './SplitBetween.module.css';

const MODES: { value: SplitMode; label: string }[] = [
  { value: 'equal', label: 'Equally' },
  { value: 'shares', label: 'By shares' },
  { value: 'exact', label: 'Exact' },
];

interface SplitBetweenProps {
  people: Person[];
  included: Set<string>;
  mode: SplitMode;
  shares: Record<string, number>;
  exact: Record<string, number | ''>;
  /** Each person's part in the split's currency, as it stands */
  preview: Map<string, number>;
  /** The amount in the split's currency; null until it's known */
  costCents: number | null;
  /** The amount as typed, and what's left of it to assign in Exact */
  enteredCents: number | null;
  leftCents: number;
  entryCurrency: string;
  currency: string;
  error: string | null | undefined;
  onMode: (mode: SplitMode) => void;
  onToggle: (id: string) => void;
  onAll: () => void;
  onShares: (id: string, shares: number) => void;
  onExact: (id: string, amount: number | '') => void;
}

/**
 * Phones: who an item is split between, always on show. The way it's split, then one
 * row per person (tap to include or leave out) and a line saying how it works out.
 */
const SplitBetween = (props: SplitBetweenProps) => {
  const { people, included, mode, onMode, onAll, error } = props;
  return (
    <div className={classes.root}>
      <div className={classes.labelRow}>
        <span className={classes.label}>Split between</span>
        <UnstyledButton
          className={classes.all}
          onClick={onAll}
        >
          All
        </UnstyledButton>
      </div>
      <SegmentedControl
        fullWidth
        data={MODES}
        value={mode}
        onChange={(v) => onMode(v as SplitMode)}
        aria-label="How it's split"
        withItemsBorders={false}
        classNames={{
          root: classes.modes,
          indicator: classes.modeIndicator,
          label: classes.modeLabel,
        }}
      />
      <div className={classes.list}>
        {people.map((p) => (
          <PersonRow
            key={p.id}
            person={p}
            on={included.has(p.id)}
            {...props}
          />
        ))}
      </div>
      <Summary {...props} />
      {error && <div className={classes.error}>{error}</div>}
    </div>
  );
};

export default SplitBetween;

/** "3 of 4 people, RM 29.70 each", "4 shares, RM 22.28 a share" or what's left to assign */
function Summary({
  people,
  included,
  mode,
  shares,
  costCents,
  enteredCents,
  leftCents,
  entryCurrency,
  currency,
}: SplitBetweenProps) {
  const chosen = people.filter((p) => included.has(p.id));
  if (chosen.length === 0) return null;
  if (mode === 'exact') {
    const of = formatMoney(enteredCents ?? 0, entryCurrency);
    if (leftCents === 0) return <p className={classes.summary}>All of {of} assigned</p>;
    const off = formatMoney(Math.abs(leftCents), entryCurrency);
    return (
      <p className={`${classes.summary} sf-negative`}>
        {leftCents > 0 ? `${off} left of ${of}` : `${off} more than ${of}`}
      </p>
    );
  }
  if (mode === 'shares') {
    const total = chosen.reduce((sum, p) => sum + (shares[p.id] ?? 1), 0);
    const each =
      costCents == null ? '' : `, ${formatMoney(Math.round(costCents / total), currency)} a share`;
    return (
      <p className={classes.summary}>
        {total} {total === 1 ? 'share' : 'shares'}
        {each}
      </p>
    );
  }
  const each =
    costCents == null
      ? ''
      : `, ${formatMoney(Math.round(costCents / chosen.length), currency)} each`;
  return (
    <p className={classes.summary}>
      {chosen.length} of {people.length} {people.length === 1 ? 'person' : 'people'}
      {each}
    </p>
  );
}

/** One person: tap their name to include or leave them out; their part on the right */
function PersonRow({
  person,
  on,
  mode,
  shares,
  exact,
  preview,
  entryCurrency,
  currency,
  onToggle,
  onShares,
  onExact,
}: SplitBetweenProps & { person: Person; on: boolean }) {
  const part = preview.get(person.id);
  const count = shares[person.id] ?? 1;
  // Equally, and anyone left out, show plain text: the whole row is the toggle then
  const plain = !on || mode === 'equal';
  return (
    <div
      className={classes.row}
      data-off={!on || undefined}
    >
      <UnstyledButton
        role="checkbox"
        aria-checked={on}
        aria-label={person.name}
        className={classes.toggle}
        onClick={() => onToggle(person.id)}
      >
        <span className={classes.avatar}>
          <PersonAvatar
            preview={false}
            person={person}
            size={30}
          />
          {on && (
            <span className={classes.tick}>
              <Check
                size={9}
                weight="bold"
              />
            </span>
          )}
        </span>
        <span className={classes.name}>{person.name}</span>
        {plain && (
          <span className={on ? classes.part : classes.notIn}>
            {on ? (part == null ? '' : formatAmount(part, currency)) : 'Not in'}
          </span>
        )}
      </UnstyledButton>
      {!plain && mode === 'shares' && (
        <>
          <span className={classes.sharePart}>
            {part == null ? '' : formatAmount(part, currency)}
          </span>
          <ActionIcon
            variant="default"
            size={32}
            radius={9}
            aria-label={`Fewer shares for ${person.name}`}
            disabled={count <= 1}
            onClick={() => onShares(person.id, Math.max(1, count - 1))}
          >
            <Minus size={14} />
          </ActionIcon>
          <span className={classes.count}>{count}</span>
          <ActionIcon
            variant="default"
            size={32}
            radius={9}
            aria-label={`More shares for ${person.name}`}
            disabled={count >= MAX_SHARES}
            onClick={() => onShares(person.id, Math.min(MAX_SHARES, count + 1))}
          >
            <Plus size={14} />
          </ActionIcon>
        </>
      )}
      {!plain && mode === 'exact' && (
        <NumberInput
          className={classes.exact}
          aria-label={`${person.name}'s amount`}
          value={exact[person.id]}
          onChange={(v) => onExact(person.id, v === '' ? '' : Number(v))}
          min={0}
          decimalScale={2}
          hideControls
          inputMode="decimal"
          placeholder="0.00"
          leftSection={<span className={classes.symbol}>{currencySymbol(entryCurrency)}</span>}
        />
      )}
    </div>
  );
}
