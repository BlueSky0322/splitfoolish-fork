import {
  ActionIcon,
  Autocomplete,
  Button,
  Checkbox,
  Menu,
  NumberInput,
  SegmentedControl,
  Select,
  Textarea,
  UnstyledButton,
} from '@mantine/core';
import { CalendarBlank, Check, Copy, DotsThree, Minus, Plus, Trash } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useContext, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { convertCents, isValidRate, toCents } from '@shared/rates';
import type { SplitMode } from '@shared/settle';
import { itemShares, MAX_SHARES } from '@shared/settle';
import { MAX_COST, MAX_NAME_LENGTH, MAX_NOTES_LENGTH } from '@shared/types';
import type { ItemInput } from '../../../api';
import { api } from '../../../api';
import type { SplitItem } from '../../../split/state';
import { useSplitState } from '../../../split/SplitStateContext';
import { useSplitPage } from '../SplitPageContext';
import { CATEGORIES } from '../../../split/categories';
import { ITEM_NAMES_KEY, suggestNames } from '../../../split/item-names';
import { currencySymbol, formatMoney } from '../../../utils/money';
import { evaluateSum } from '../../../utils/math';
import { useIsDesktop } from '../../../hooks/useBreakpoints';
import PhotoStrip from '../photos/PhotoStrip';
import CurrencySelect from '../../ui/CurrencySelect';
import { DialogHeaderSlot } from '../../ui/dialog-header';
import PersonAvatar from '../PersonAvatar';
import classes from './ItemForm.module.css';
import { SOURCE_LABELS, describeRate } from '../../../utils/rate-labels';
import { plural } from '../../../utils/text';
import { useRate } from '../../../hooks/useRate';
import { buildItemInput, chooseRate, exactCents } from '../../../split/item-input';

interface ItemFormProps {
  /** Editing this item; adding a new one when absent */
  item?: SplitItem;
  /** A new item's amount and the currency it was paid in, e.g. from Convert */
  initialAmount?: string;
  initialCurrency?: string;
  /** Photos picked for a new item are uploaded once it's added */
  onSave: (input: ItemInput, newPhotos: File[]) => boolean;
  onDelete?: () => void;
  /** Adds a copy of the item being edited, keeping its date or as of today */
  onDuplicate?: (keepDate: boolean) => void;
  onCancel: () => void;
}

const MODES: { value: SplitMode; label: string }[] = [
  { value: 'equal', label: 'Equally' },
  { value: 'shares', label: 'By shares' },
  { value: 'exact', label: 'Exact' },
];

// Add item and Edit item: amount first, who paid, then how it's split
const ItemForm = ({
  item,
  initialAmount,
  initialCurrency,
  onSave,
  onDelete,
  onDuplicate,
  onCancel,
}: ItemFormProps) => {
  const { splitId, currency, me, photos: splitPhotos, canRemovePhoto } = useSplitPage();
  const { people } = useSplitState().state;
  // Receipt photos are added to a saved item straight away; a new item's wait until it's added
  const photos = item ? splitPhotos.photosOf(item.id) : [];
  const uploading = item ? splitPhotos.uploading[item.id] ?? [] : [];
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isDesktop = useIsDesktop();
  // Phones: the sheet's header takes Save and the menu (see DialogHeaderSlot)
  const headerSlot = useContext(DialogHeaderSlot);
  const formId = useId();
  // Items in another currency are edited as they were typed, in that currency
  const original = item?.original ?? null;
  const [expression, setExpression] = useState(
    original ? String(original.amount) : item ? String(item.cost) : initialAmount ?? '',
  );
  const [entryCurrency, setEntryCurrency] = useState(
    original?.currency ?? (item ? currency : initialCurrency ?? currency),
  );
  const foreign = entryCurrency !== currency;
  const [ownRateChosen, setOwnRateChosen] = useState(original?.rateSource === 'manual');
  const [ownRate, setOwnRate] = useState<number | ''>(
    original?.rateSource === 'manual' ? original.rate ?? '' : '',
  );
  const [name, setName] = useState(item?.name ?? '');
  const [payerId, setPayerId] = useState<string | null>(
    item?.payer.id ?? me?.id ?? people[0]?.id ?? null,
  );
  const [mode, setMode] = useState<SplitMode>(item?.splitMode ?? 'equal');
  const [included, setIncluded] = useState<Set<string>>(
    new Set(item ? item.participants.map((p) => p.id) : people.map((p) => p.id)),
  );
  const [shares, setShares] = useState<Record<string, number>>(() =>
    Object.fromEntries(people.map((p) => [p.id, item?.shares?.[p.id] ?? 1])),
  );
  const [exact, setExact] = useState<Record<string, number | ''>>(() =>
    Object.fromEntries(
      people.map((p) => [p.id, original?.exact?.[p.id] ?? item?.exact?.[p.id] ?? '']),
    ),
  );
  const [category, setCategory] = useState<string | null>(item?.category ?? null);
  const [notes, setNotes] = useState(item?.notes ?? '');
  // Names used before, in any of your splits, suggested as you type
  const pastNames = useQuery({
    queryKey: ITEM_NAMES_KEY,
    queryFn: async () => (await api.listItemNames()).names,
    staleTime: 5 * 60 * 1000,
  });
  const suggestions = suggestNames(pastNames.data ?? [], name);
  const [tried, setTried] = useState(false);

  /** The cost as typed: a number or a sum like "30*3"; null while it doesn't work out */
  const cost = useMemo(() => evaluateSum(expression), [expression]);
  /** The amount as typed, in the currency it was paid in */
  const enteredCents = cost == null || cost < 0 ? null : toCents(cost);
  const chosen = people.filter((p) => included.has(p.id));

  // The rate for the preview. The server converts again when saving, except that an
  // edit leaving the amount alone keeps the rate the item was saved with.
  const fetchedRate = useRate(entryCurrency, currency, { enabled: foreign && !ownRateChosen });
  const { rate, source: rateSource } = chooseRate({
    foreign,
    entryCurrency,
    enteredCents,
    ownRateChosen,
    ownRate,
    original,
    fetched: fetchedRate.data,
  });
  /** The amount in the split's currency; unknown in another currency until there's a rate */
  const costCents = enteredCents == null || rate == null ? null : convertCents(enteredCents, rate);

  /** Under the amount in another currency: what it comes to, or why that isn't known yet */
  const conversionNote = () => {
    if (costCents != null) return `≈ ${formatMoney(costCents, currency)}`;
    if (fetchedRate.isError) return 'Converted when saved';
    return enteredCents == null ? '' : 'Getting the rate…';
  };

  // What each person's part comes to, shown next to them
  // A handful of people: cheap to work out on every change
  const preview =
    costCents == null || chosen.length === 0
      ? new Map<string, number>()
      : itemShares({
          costCents,
          payerId: payerId ?? '',
          splitMode: mode,
          participants: chosen.map((p) => ({
            personId: p.id,
            shares: shares[p.id] ?? 1,
            exactCents: exactCents(exact[p.id]),
          })),
        });

  const assignedCents = chosen.reduce((sum, p) => sum + exactCents(exact[p.id]), 0);
  // Exact amounts are typed in the currency it was paid in
  const leftCents = (enteredCents ?? 0) - assignedCents;

  const problems = {
    cost:
      enteredCents == null
        ? 'Enter an amount, like 90 or 30*3'
        : enteredCents > toCents(MAX_COST)
          ? `Amounts go up to ${MAX_COST.toLocaleString()}`
          : null,
    rate: foreign && ownRateChosen && !isValidRate(ownRate) ? 'Enter the rate, like 0.03' : null,
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
    if (!valid || enteredCents == null || payerId == null) return;
    onSave(
      buildItemInput({
        name,
        enteredCents,
        costCents,
        rate,
        foreign,
        entryCurrency,
        ownRateChosen,
        ownRate,
        payerId,
        participantIds: chosen.map((p) => p.id),
        mode,
        shares,
        exact,
        category,
        notes,
      }),
      newPhotos,
    );
  };

  const moreMenu = (onDuplicate || onDelete) && (
    <Menu
      position={headerSlot ? 'bottom-end' : 'top-start'}
      withinPortal={false}
    >
      <Menu.Target>
        <ActionIcon
          variant="default"
          size={headerSlot ? 32 : 36}
          aria-label="More actions"
        >
          <DotsThree
            size={20}
            weight="bold"
          />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {onDuplicate && (
          <>
            <Menu.Label>Duplicate</Menu.Label>
            <Menu.Item
              leftSection={<Copy size={16} />}
              onClick={() => onDuplicate(true)}
            >
              Keep its date
            </Menu.Item>
            <Menu.Item
              leftSection={<CalendarBlank size={16} />}
              onClick={() => onDuplicate(false)}
            >
              Dated today
            </Menu.Item>
          </>
        )}
        {onDuplicate && onDelete && <Menu.Divider />}
        {onDelete && (
          <Menu.Item
            color="red"
            leftSection={<Trash size={16} />}
            onClick={() => (photos.length > 0 ? setConfirmDelete(true) : onDelete())}
          >
            Delete item
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );

  return (
    <form
      id={formId}
      onSubmit={submit}
      className={classes.form}
    >
      <div className={classes.amount}>
        <CurrencySelect
          aria-label="Currency"
          className={classes.currency}
          first={[currency]}
          value={entryCurrency}
          onChange={setEntryCurrency}
          variant="unstyled"
          comboboxProps={{ withinPortal: false, width: 240, position: 'bottom-start' }}
        />
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
      {foreign && (
        <div className={classes.conversion}>
          {ownRateChosen ? (
            <>
              <span>1 {entryCurrency} =</span>
              <NumberInput
                aria-label={`How much 1 ${entryCurrency} is in ${currency}`}
                className={classes.rateInput}
                value={ownRate}
                onChange={(v) => setOwnRate(v === '' ? '' : Number(v))}
                min={0}
                decimalScale={6}
                hideControls
                size="xs"
                placeholder="0.00"
                error={tried && problems.rate}
              />
              <span>{currency}</span>
              {costCents != null && (
                <span className={classes.converted}>≈ {formatMoney(costCents, currency)}</span>
              )}
              <UnstyledButton
                className={classes.rateToggle}
                onClick={() => setOwnRateChosen(false)}
              >
                Use the live rate
              </UnstyledButton>
            </>
          ) : (
            <>
              <span className={classes.converted}>{conversionNote()}</span>
              {rate != null && rateSource != null && (
                <span>
                  {describeRate(rate, entryCurrency, currency)} · {SOURCE_LABELS[rateSource]}
                </span>
              )}
              <UnstyledButton
                className={classes.rateToggle}
                onClick={() => {
                  setOwnRateChosen(true);
                  if (ownRate === '' && rate != null) setOwnRate(rate);
                }}
              >
                Use my own rate
              </UnstyledButton>
            </>
          )}
        </div>
      )}

      <Autocomplete
        aria-label="What it was for"
        placeholder="What was it for?"
        value={name}
        onChange={setName}
        data={[...new Set(suggestions.map((s) => s.name))]}
        // Already ranked by suggestNames
        filter={({ options }) => options}
        onOptionSubmit={(picked) => {
          // A name used before brings its category, unless one is already chosen
          const past = suggestions.find((s) => s.name === picked);
          const known = CATEGORIES.some((c) => c.key === past?.category);
          if (past?.category && known && category == null) setCategory(past.category);
        }}
        maxLength={MAX_NAME_LENGTH}
        size="md"
        error={tried && problems.name}
        comboboxProps={{ withinPortal: false }}
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
                preview={false}
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
                      <span className="sf-muted text-xs">{currencySymbol(entryCurrency)}</span>
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
              {formatMoney(leftCents, entryCurrency)}
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

      <Textarea
        label="Notes"
        placeholder="What was ordered, who still owes, anything else"
        value={notes}
        onChange={(e) => setNotes(e.currentTarget.value)}
        autosize
        minRows={2}
        maxRows={10}
        maxLength={MAX_NOTES_LENGTH}
        description={
          notes.length > MAX_NOTES_LENGTH - 200
            ? `${MAX_NOTES_LENGTH - notes.length} characters left`
            : undefined
        }
        inputWrapperOrder={['label', 'input', 'description']}
      />

      <div className={classes.field}>
        <div className={classes.label}>
          Images
          {photos.length + newPhotos.length + uploading.length > 0 &&
            ` · ${photos.length + newPhotos.length + uploading.length}`}
        </div>
        <PhotoStrip
          splitId={splitId}
          photos={photos}
          pending={newPhotos}
          uploading={uploading}
          canRemove={canRemovePhoto}
          onAdd={(files) =>
            item ? splitPhotos.upload(files, item.id) : setNewPhotos((p) => [...p, ...files])
          }
          onRemove={splitPhotos.remove}
          onRemovePending={(file) => setNewPhotos((p) => p.filter((f) => f !== file))}
        />
      </div>

      {confirmDelete ? (
        // Photos can't come back with Undo, so it's asked first when there are some
        <div className={classes.actions}>
          <span className={classes.confirm}>Delete with {plural(photos.length, 'photo')}?</span>
          <Button
            variant="default"
            onClick={() => setConfirmDelete(false)}
          >
            Keep
          </Button>
          <Button
            variant="default"
            className="sf-danger-outline"
            onClick={onDelete}
          >
            Delete
          </Button>
        </div>
      ) : headerSlot ? (
        // Phones: Save and the menu sit in the sheet's header, clear of the keyboard
        createPortal(
          <>
            {moreMenu}
            <Button
              type="submit"
              form={formId}
              size="compact-md"
              disabled={tried && !valid}
            >
              {item ? 'Save' : 'Add'}
            </Button>
          </>,
          headerSlot,
        )
      ) : (
        <div className={classes.actions}>
          {moreMenu}
          <span className="flex-1" />
          {/* On a phone the sheet's X closes it, so Save gets the room */}
          {isDesktop && (
            <Button
              variant="default"
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            disabled={tried && !valid}
            className={isDesktop ? undefined : 'flex-1'}
          >
            {item ? 'Save' : 'Add item'}
          </Button>
        </div>
      )}
    </form>
  );
};

export default ItemForm;
