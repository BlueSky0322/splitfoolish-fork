import {
  ActionIcon,
  Button,
  Checkbox,
  NumberInput,
  SegmentedControl,
  Select,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { Check, Minus, Plus } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { SplitMode, itemShares } from '../../../shared/settle';
import { Attachment, ItemInput } from '../../api';
import { IItem, IPerson } from '../../interfaces/app-reducer';
import { CATEGORIES } from '../../split/categories';
import { currencySymbol, formatMoney } from '../../utils/money';
import { loadMath } from '../../utils/math';
import PhotoStrip from '../photos/PhotoStrip';
import PersonAvatar from './PersonAvatar';
import classes from './ItemForm.module.css';

interface ItemFormProps {
  splitId: string;
  people: IPerson[];
  currency: string;
  /** Editing this item; adding a new one when absent */
  item?: IItem;
  /** Who paid by default for a new item */
  defaultPayerId?: string | null;
  /** Photos picked for a new item are uploaded once it's added */
  onSave: (input: ItemInput, newPhotos: File[]) => boolean;
  onDelete?: () => void;
  onCancel: () => void;
  /** The item's receipt photos (editing only) */
  photos: Attachment[];
  uploading: File[];
  canRemovePhoto: (photo: Attachment) => boolean;
  onAddPhotos: (files: File[]) => void;
  onRemovePhoto: (photo: Attachment) => void;
}

const MODES: { value: SplitMode; label: string }[] = [
  { value: 'equal', label: 'Equally' },
  { value: 'shares', label: 'By shares' },
  { value: 'exact', label: 'Exact' },
];

const MAX_SHARES = 999;
const toCents = (amount: number) => Math.round(amount * 100);

/** The cost as typed: a number or a sum like "30*3"; null while it doesn't work out */
function useEvaluated(expression: string) {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    let current = true;
    const text = expression.trim();
    if (text === '') {
      setValue(null);
      return;
    }
    const plain = Number(text);
    if (Number.isFinite(plain)) {
      setValue(plain);
      return;
    }
    loadMath().then(({ evaluate }) => {
      if (!current) return;
      try {
        const result = Number(evaluate(text));
        setValue(Number.isFinite(result) ? result : null);
      } catch {
        setValue(null);
      }
    });
    return () => {
      current = false;
    };
  }, [expression]);
  return value;
}

// Add item (F5) and Edit item (F6): amount first, who paid, then how it's split
const ItemForm = ({
  splitId,
  people,
  currency,
  item,
  defaultPayerId,
  onSave,
  onDelete,
  onCancel,
  photos,
  uploading,
  canRemovePhoto,
  onAddPhotos,
  onRemovePhoto,
}: ItemFormProps) => {
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expression, setExpression] = useState(item ? String(item.cost) : '');
  const [name, setName] = useState(item?.name ?? '');
  const [payerId, setPayerId] = useState<string | null>(
    item?.payer.id ?? defaultPayerId ?? people[0]?.id ?? null,
  );
  const [mode, setMode] = useState<SplitMode>(item?.splitMode ?? 'equal');
  const [included, setIncluded] = useState<Set<string>>(
    new Set(item ? item.participants.map((p) => p.id) : people.map((p) => p.id)),
  );
  const [shares, setShares] = useState<Record<string, number>>(() =>
    Object.fromEntries(people.map((p) => [p.id, item?.shares?.[p.id] ?? 1])),
  );
  const [exact, setExact] = useState<Record<string, number | ''>>(() =>
    Object.fromEntries(people.map((p) => [p.id, item?.exact?.[p.id] ?? ''])),
  );
  const [category, setCategory] = useState<string | null>(item?.category ?? null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    loadMath();
  }, []);

  const cost = useEvaluated(expression);
  const costCents = cost == null || cost < 0 ? null : toCents(cost);
  const chosen = people.filter((p) => included.has(p.id));

  // What each person's part comes to, shown next to them
  const preview = useMemo(() => {
    if (costCents == null || chosen.length === 0) return new Map<string, number>();
    return itemShares({
      costCents,
      payerId: payerId ?? '',
      splitMode: mode,
      participants: chosen.map((p) => ({
        personId: p.id,
        shares: shares[p.id] ?? 1,
        exactCents: exact[p.id] === '' ? 0 : toCents(Number(exact[p.id])),
      })),
    });
  }, [costCents, chosen, payerId, mode, shares, exact]);

  const assignedCents = chosen.reduce(
    (sum, p) => sum + (exact[p.id] === '' ? 0 : toCents(Number(exact[p.id]))),
    0,
  );
  const leftCents = (costCents ?? 0) - assignedCents;

  const problems = {
    cost: costCents == null ? 'Enter an amount, like 90 or 30*3' : null,
    name: name.trim() ? null : 'Enter what it was for',
    payer: payerId ? null : 'Choose who paid',
    people: chosen.length > 0 ? null : 'Choose at least one person to split with',
    exact: mode === 'exact' && leftCents !== 0 ? 'Assign the whole amount' : null,
  };
  const valid = Object.values(problems).every((p) => p == null);

  const toggle = (id: string) =>
    setIncluded((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!valid || cost == null || payerId == null) return;
    const ids = chosen.map((p) => p.id);
    onSave(
      {
        name: name.trim(),
        cost: toCents(cost) / 100,
        payerId,
        participantIds: ids,
        splitMode: mode,
        shares:
          mode === 'shares' ? Object.fromEntries(ids.map((id) => [id, shares[id]])) : undefined,
        exact:
          mode === 'exact'
            ? Object.fromEntries(ids.map((id) => [id, exact[id] === '' ? 0 : Number(exact[id])]))
            : undefined,
        category,
      },
      newPhotos,
    );
  };

  return (
    <form
      onSubmit={submit}
      className={classes.form}
    >
      <div className={classes.amount}>
        <span className={classes.symbol}>{currencySymbol(currency)}</span>
        <input
          className={classes.amountInput}
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          placeholder="0.00"
          inputMode="decimal"
          aria-label="Amount"
          data-autofocus={item ? undefined : true}
          autoComplete="off"
        />
        {cost != null && expression.trim() !== String(cost) && (
          <span className={classes.evaluated}>= {(toCents(cost) / 100).toFixed(2)}</span>
        )}
      </div>
      {tried && problems.cost && <div className={classes.error}>{problems.cost}</div>}

      <TextInput
        aria-label="What it was for"
        placeholder="What was it for?"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={80}
        size="md"
        error={tried && problems.name}
      />

      <Select
        label="Category"
        placeholder="None"
        data={CATEGORIES.map((c) => ({ value: c.key, label: c.label }))}
        value={category}
        onChange={setCategory}
        clearable
        // Inside a dialog, so screen readers can reach the options (the dialog hides other popups)
        comboboxProps={{ withinPortal: false }}
      />

      <div className={classes.field}>
        <div className={classes.label}>Paid by</div>
        <div
          className={classes.pills}
          role="radiogroup"
          aria-label="Paid by"
        >
          {people.map((p) => (
            <UnstyledButton
              key={p.id}
              role="radio"
              aria-checked={payerId === p.id}
              className={classes.pill}
              data-selected={payerId === p.id || undefined}
              onClick={() => setPayerId(p.id)}
            >
              <PersonAvatar
                person={p}
                size={22}
              />
              {p.name}
            </UnstyledButton>
          ))}
        </div>
        {tried && problems.payer && <div className={classes.error}>{problems.payer}</div>}
      </div>

      <div className={classes.field}>
        <div className={classes.label}>Split</div>
        <SegmentedControl
          fullWidth
          data={MODES}
          value={mode}
          onChange={(v) => setMode(v as SplitMode)}
        />
        <div className={classes.people}>
          {people.map((p) => {
            const on = included.has(p.id);
            return (
              <div
                key={p.id}
                className={classes.personRow}
                data-off={!on || undefined}
              >
                <Checkbox
                  checked={on}
                  onChange={() => toggle(p.id)}
                  label={p.name}
                  radius={6}
                  size="md"
                  classNames={{ root: classes.check, label: classes.checkLabel }}
                />
                {mode === 'shares' && on && (
                  <div className={classes.stepper}>
                    <ActionIcon
                      variant="default"
                      size={36}
                      aria-label={`Fewer shares for ${p.name}`}
                      disabled={shares[p.id] <= 1}
                      onClick={() => setShares((s) => ({ ...s, [p.id]: Math.max(1, s[p.id] - 1) }))}
                    >
                      <Minus size={16} />
                    </ActionIcon>
                    <span className={classes.stepCount}>{shares[p.id]}</span>
                    <ActionIcon
                      variant="default"
                      size={36}
                      aria-label={`More shares for ${p.name}`}
                      disabled={shares[p.id] >= MAX_SHARES}
                      onClick={() =>
                        setShares((s) => ({ ...s, [p.id]: Math.min(MAX_SHARES, s[p.id] + 1) }))
                      }
                    >
                      <Plus size={16} />
                    </ActionIcon>
                  </div>
                )}
                {mode === 'exact' && on ? (
                  <NumberInput
                    className={classes.exactInput}
                    aria-label={`${p.name}'s amount`}
                    value={exact[p.id]}
                    onChange={(v) => setExact((s) => ({ ...s, [p.id]: v === '' ? '' : Number(v) }))}
                    min={0}
                    decimalScale={2}
                    hideControls
                    placeholder="0.00"
                    leftSection={
                      <span className="sf-muted text-xs">{currencySymbol(currency)}</span>
                    }
                  />
                ) : (
                  <span className={classes.part}>
                    {on && preview.has(p.id) ? formatMoney(preview.get(p.id)!, currency) : ''}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {mode === 'exact' && (
          <div className={classes.left}>
            <span>Left to assign</span>
            <span
              className={leftCents === 0 ? classes.leftDone : leftCents < 0 ? 'sf-negative' : ''}
            >
              {leftCents < 0 ? '−' : ''}
              {formatMoney(leftCents, currency)}
              {leftCents === 0 && (
                <Check
                  size={14}
                  weight="bold"
                />
              )}
            </span>
          </div>
        )}
        {tried && (problems.people || problems.exact) && (
          <div className={classes.error}>{problems.people ?? problems.exact}</div>
        )}
      </div>

      <div className={classes.field}>
        <div className={classes.label}>Receipts</div>
        <PhotoStrip
          splitId={splitId}
          photos={photos}
          pending={newPhotos}
          uploading={uploading}
          canRemove={canRemovePhoto}
          onAdd={(files) => (item ? onAddPhotos(files) : setNewPhotos((p) => [...p, ...files]))}
          onRemove={onRemovePhoto}
          onRemovePending={(file) => setNewPhotos((p) => p.filter((f) => f !== file))}
        />
      </div>

      <div className={classes.actions}>
        {onDelete && (
          <Button
            variant="subtle"
            color="red"
            // Photos can't come back with Undo, so ask first when there are some
            onClick={() =>
              photos.length > 0 && !confirmDelete ? setConfirmDelete(true) : onDelete()
            }
            className="mr-auto"
          >
            {confirmDelete
              ? `Delete with ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}?`
              : 'Delete item'}
          </Button>
        )}
        <Button
          variant="default"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={tried && !valid}
        >
          {item ? 'Save' : 'Add item'}
        </Button>
      </div>
    </form>
  );
};

export default ItemForm;
