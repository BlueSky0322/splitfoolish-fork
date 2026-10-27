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
import {
  ArrowSquareOut,
  CalendarBlank,
  Check,
  Copy,
  DotsThree,
  HandCoins,
  Minus,
  Plus,
  Trash,
} from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useContext, useEffect, useId, useMemo, useState } from 'react';
import { MAX_ITEM_CENTS, fitsItemCents, isValidRate, toCents } from '@shared/rates';
import type { SplitMode } from '@shared/settle';
import { itemShares, MAX_SHARES } from '@shared/settle';
import { MAX_COST, MAX_NAME_LENGTH, MAX_NOTES_LENGTH, type Person } from '@shared/types';
import type { ItemInput } from '../../../api';
import { api } from '../../../api';
import type { SplitItem } from '../../../split/state';
import { useSplitState } from '../../../split/SplitStateContext';
import { useSplitPage } from '../SplitPageContext';
import { CATEGORIES, OTHER, categoryKey } from '../../../split/categories';
import { ITEM_NAMES_KEY, suggestNames } from '../../../split/item-names';
import { currencySymbol, formatMoney } from '../../../utils/money';
import {
  atTimeNow,
  fromDateInput,
  isPastDay,
  keepTimeOf,
  toDateInput,
} from '../../../utils/date-input';
import { ConversionRow } from '../forms/ConversionRow';
import { DayField } from '../forms/DayField';
import { useIsDesktop, useIsMobile } from '../../../hooks/useBreakpoints';
import PhotoStrip from '../photos/PhotoStrip';
import CurrencySelect from '../../ui/CurrencySelect';
import { DialogHeaderSlot } from '../../ui/dialog-header';
import PersonAvatar, { PersonName } from '../PersonAvatar';
import SplitBetween from './SplitBetween';
import classes from './ItemForm.module.css';
import { findLinks, plural } from '../../../utils/text';
import { buildItemInput, exactCents } from '../../../split/item-input';
import { useAmountConversion } from '../../../split/useAmountConversion';

interface ItemFormProps {
  /** Editing this item; adding a new one when absent */
  item?: SplitItem;
  /** A new item's amount and the currency it was paid in, e.g. from Convert */
  initialAmount?: string;
  initialCurrency?: string;
  /** A new item's day, when it's added from that day's heading; its time is the time now */
  initialDay?: number;
  /**
   * Photos picked for a new item are uploaded once it's added. day: the day picked when
   * it isn't the item's own (a new item's is today); null when it's unchanged.
   */
  onSave: (input: ItemInput, newPhotos: File[], day: Date | null) => boolean;
  onDelete?: () => void;
  /** Adds a copy of the item being edited, keeping its date or as of today */
  onDuplicate?: (keepDate: boolean) => void;
  /** Records that someone paid their part of it back (desktop's More menu) */
  onRecordPayment?: () => void;
  onCancel: () => void;
  /** What's been entered or changed that closing would lose, as a sentence; null when nothing */
  onDirtyChange?: (unsaved: string | null) => void;
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
  initialDay,
  onSave,
  onDelete,
  onDuplicate,
  onRecordPayment,
  onCancel,
  onDirtyChange,
}: ItemFormProps) => {
  const { splitId, currency, me, photos: splitPhotos, canRemovePhoto } = useSplitPage();
  const { people } = useSplitState().state;
  // Receipt photos are added to a saved item straight away; a new item's wait until it's added
  const photos = item ? splitPhotos.photosOf(item.id) : [];
  const queued = item ? splitPhotos.queuedOf(item.id) : [];
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isDesktop = useIsDesktop();
  const isMobile = useIsMobile();
  // Phones: the sheet's header takes Save and the menu (see DialogHeaderSlot)
  const headerSlot = useContext(DialogHeaderSlot);
  const formId = useId();
  const original = item?.original ?? null;
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
  // Other until picked; a name used before brings its category while none is picked
  const [category, setCategory] = useState<string>(categoryKey(item?.category ?? null));
  const [categoryPicked, setCategoryPicked] = useState(item != null);
  const [notes, setNotes] = useState(item?.notes ?? '');
  const links = useMemo(() => findLinks(notes).filter((p) => p.href != null), [notes]);
  // The day it was paid: an item's own, the day whose heading it was added from, or today
  const [ownDayText] = useState(() =>
    toDateInput(new Date(item?.createdAt ?? initialDay ?? Date.now())),
  );
  const [dayText, setDayText] = useState(ownDayText);
  const chosenDay = isPastDay(dayText) ? fromDateInput(dayText) : null;
  /** The day picked, when it isn't the one it started on (today, for a new item) */
  const newDay =
    chosenDay != null && dayText !== (item ? ownDayText : toDateInput(new Date()))
      ? chosenDay
      : null;
  // When it was paid, which decides the rate for the preview. A saved item moved to
  // another day keeps its time of day, as Move to a day does.
  const paidAt = item
    ? newDay
      ? keepTimeOf(newDay, item.createdAt)
      : item.createdAt
    : chosenDay
      ? atTimeNow(chosenDay)
      : undefined;
  // Items in another currency are edited as they were typed, in that currency. An edit
  // keeps the rate the item was recorded with, a new amount included; a new item, or a
  // new currency, takes the rate on the day it was paid. The server converts again
  // when saving, the same way.
  const conversion = useAmountConversion({
    currency,
    original,
    initialExpression: item ? String(item.cost) : initialAmount ?? '',
    initialCurrency: item ? currency : initialCurrency ?? currency,
    paidAt,
  });
  const { expression, setExpression, entryCurrency, setEntryCurrency, foreign } = conversion;
  const { ownRateChosen, ownRate, enteredCents, rate, costCents } = conversion;
  // Names used before, in any of your splits, suggested as you type
  const pastNames = useQuery({
    queryKey: ITEM_NAMES_KEY,
    queryFn: async () => (await api.listItemNames()).names,
    staleTime: 5 * 60 * 1000,
  });
  const suggestions = suggestNames(pastNames.data ?? [], name);
  const [tried, setTried] = useState(false);

  // Closing a phone sheet with something entered asks first (see SplitDialogs)
  const snapshot = JSON.stringify([
    expression,
    entryCurrency,
    ownRateChosen,
    ownRate,
    name,
    payerId,
    mode,
    [...included].sort(),
    shares,
    exact,
    category,
    notes,
    newPhotos.length,
    dayText,
  ]);
  const [initialSnapshot] = useState(snapshot);
  const unsaved =
    snapshot === initialSnapshot
      ? null
      : item
        ? 'Your changes to it will be lost.'
        : describeEntered(expression.trim() !== '', name.trim() !== '');
  useEffect(() => {
    onDirtyChange?.(unsaved);
  }, [onDirtyChange, unsaved]);

  const cost = conversion.amount;
  const chosen = people.filter((p) => included.has(p.id));

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
          : costCents != null && !fitsItemCents(costCents)
            ? `That comes to more than ${(MAX_ITEM_CENTS / 100).toLocaleString()} ${currency}`
            : null,
    rate: foreign && ownRateChosen && !isValidRate(ownRate) ? 'Enter the rate, like 0.03' : null,
    name: name.trim() ? null : 'Enter what it was for',
    payer: payerId ? null : 'Choose who paid',
    people: chosen.length > 0 ? null : 'Choose at least one person to split with',
    exact: mode === 'exact' && leftCents !== 0 ? 'Assign the whole amount' : null,
    day: chosenDay == null ? 'Pick a day that has already come' : null,
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
      newDay,
    );
  };

  const moreMenu = (onDuplicate || onDelete || onRecordPayment) && (
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
        {onRecordPayment && (
          <Menu.Item
            leftSection={<HandCoins size={16} />}
            onClick={onRecordPayment}
          >
            Record payment
          </Menu.Item>
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

  const categorySelect = (
    <Select
      label="Category"
      data={CATEGORIES.map((c) => ({ value: c.key, label: c.label }))}
      value={category}
      onChange={(v) => {
        setCategory(v ?? OTHER);
        setCategoryPicked(true);
      }}
      allowDeselect={false}
      // Inside a dialog, so screen readers can reach the options (the dialog hides other popups)
      comboboxProps={{ withinPortal: false }}
    />
  );

  return (
    <form
      id={formId}
      onSubmit={submit}
      className={classes.form}
      data-phone={isMobile || undefined}
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
        {cost != null && /[-+*/]/.test(expression.trim().replace(/^-/, '')) && (
          <span className={classes.evaluated}>= {(toCents(cost) / 100).toFixed(2)}</span>
        )}
      </div>
      {tried && problems.cost && <div className={classes.error}>{problems.cost}</div>}
      {foreign && (
        <ConversionRow
          {...conversion.view}
          rateError={tried ? problems.rate : null}
          compact={isMobile}
        />
      )}

      <Autocomplete
        aria-label="What it was for"
        label={isMobile ? 'What for' : undefined}
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
          if (past?.category && known && !categoryPicked) setCategory(past.category);
        }}
        maxLength={MAX_NAME_LENGTH}
        size="md"
        error={tried && problems.name}
        comboboxProps={{ withinPortal: false }}
      />

      <DayField
        value={dayText}
        onChange={setDayText}
        label={
          initialDay != null ? (
            <span className={classes.dayLabel}>
              Date
              <span className={classes.dayTag}>From the day you picked</span>
            </span>
          ) : (
            'Date'
          )
        }
        description={
          initialDay != null
            ? 'Time is set to now. Change the date here if you need to.'
            : item && newDay
              ? 'It keeps its time of day.'
              : undefined
        }
        highlighted={initialDay != null}
      />

      {!isMobile && categorySelect}

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
              <PersonName person={p} />
            </UnstyledButton>
          ))}
        </div>
        {tried && problems.payer && <div className={classes.error}>{problems.payer}</div>}
      </div>

      {isMobile ? (
        <SplitBetween
          people={people}
          included={included}
          mode={mode}
          shares={shares}
          exact={exact}
          preview={preview}
          costCents={costCents}
          enteredCents={enteredCents}
          leftCents={leftCents}
          entryCurrency={entryCurrency}
          currency={currency}
          error={tried ? problems.people : null}
          onMode={setMode}
          onToggle={toggle}
          onAll={() => setIncluded(new Set(people.map((p) => p.id)))}
          onShares={(id, n) => setShares((s) => ({ ...s, [id]: n }))}
          onExact={(id, v) => setExact((s) => ({ ...s, [id]: v }))}
        />
      ) : (
        <div className={classes.field}>
          <div className={classes.label}>Split</div>
          <SegmentedControl
            fullWidth
            data={MODES}
            value={mode}
            onChange={(v) => setMode(v as SplitMode)}
          />
          <div className={classes.people}>
            {people.map((p) => (
              <PersonPart
                key={p.id}
                person={p}
                on={included.has(p.id)}
                mode={mode}
                shares={shares[p.id]}
                exact={exact[p.id]}
                partCents={preview.get(p.id)}
                entryCurrency={entryCurrency}
                currency={currency}
                onToggle={() => toggle(p.id)}
                onShares={(n) => setShares((s) => ({ ...s, [p.id]: n }))}
                onExact={(v) => setExact((s) => ({ ...s, [p.id]: v }))}
              />
            ))}
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
      )}
      {isMobile && categorySelect}

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
      {links.length > 0 && (
        // The addresses in the notes, to open from here: on desktop the form is where
        // an item's notes are read in full
        <div className={classes.links}>
          {links.map((l) => (
            <a
              key={l.href}
              className={classes.link}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ArrowSquareOut size={14} />
              {l.text}
            </a>
          ))}
        </div>
      )}

      <div className={classes.field}>
        <div className={classes.label}>
          Images
          {photos.length + newPhotos.length + queued.length > 0 &&
            ` · ${photos.length + newPhotos.length + queued.length}`}
        </div>
        <PhotoStrip
          splitId={splitId}
          photos={photos}
          pending={newPhotos}
          queued={queued}
          canRemove={canRemovePhoto}
          onAdd={(files) =>
            item ? splitPhotos.upload(files, item.id) : setNewPhotos((p) => [...p, ...files])
          }
          onRemove={splitPhotos.remove}
          onRemovePending={(file) => setNewPhotos((p) => p.filter((f) => f !== file))}
          onRemoveQueued={splitPhotos.removeQueued}
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
        // Phones: the main button at the bottom; Duplicate and Delete are on the item's own sheet
        <div className={classes.mainAction}>
          <Button
            type="submit"
            size="lg"
            fullWidth
            // Exact amounts that don't add up yet can't be saved
            disabled={(tried && !valid) || problems.exact != null}
          >
            {item ? 'Save' : 'Add item'}
          </Button>
        </div>
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

/** Someone on the item: whether they're in, and their shares, amount or part */
function PersonPart({
  person,
  on,
  mode,
  shares,
  exact,
  partCents,
  entryCurrency,
  currency,
  onToggle,
  onShares,
  onExact,
}: {
  person: Person;
  on: boolean;
  mode: SplitMode;
  shares: number;
  exact: number | '';
  /** Their part in the split's currency, as it stands */
  partCents: number | undefined;
  entryCurrency: string;
  currency: string;
  onToggle: () => void;
  onShares: (shares: number) => void;
  onExact: (amount: number | '') => void;
}) {
  return (
    <div
      className={classes.personRow}
      data-off={!on || undefined}
    >
      <Checkbox
        checked={on}
        onChange={onToggle}
        label={person.name}
        radius={6}
        size="md"
        classNames={{ root: classes.check, label: classes.checkLabel }}
      />
      {mode === 'shares' && on && (
        <div className={classes.stepper}>
          <ActionIcon
            variant="default"
            size={36}
            aria-label={`Fewer shares for ${person.name}`}
            disabled={shares <= 1}
            onClick={() => onShares(Math.max(1, shares - 1))}
          >
            <Minus size={16} />
          </ActionIcon>
          <span className={classes.stepCount}>{shares}</span>
          <ActionIcon
            variant="default"
            size={36}
            aria-label={`More shares for ${person.name}`}
            disabled={shares >= MAX_SHARES}
            onClick={() => onShares(Math.min(MAX_SHARES, shares + 1))}
          >
            <Plus size={16} />
          </ActionIcon>
        </div>
      )}
      {mode === 'exact' && on ? (
        <NumberInput
          className={classes.exactInput}
          aria-label={`${person.name}'s amount`}
          value={exact}
          onChange={(v) => onExact(v === '' ? '' : Number(v))}
          min={0}
          decimalScale={2}
          hideControls
          placeholder="0.00"
          leftSection={<span className="sf-muted text-xs">{currencySymbol(entryCurrency)}</span>}
        />
      ) : (
        <span className={classes.part}>
          {on && partCents != null ? formatMoney(partCents, currency) : ''}
        </span>
      )}
    </div>
  );
}

/** A new item's unsaved entries, for the prompt before closing it */
function describeEntered(amount: boolean, name: boolean) {
  if (amount && name) return "You've entered an amount and a name.";
  if (amount) return "You've entered an amount.";
  if (name) return "You've entered a name.";
  return "What you've entered will be lost.";
}
