import {
  ActionIcon,
  Button,
  Select,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  ArrowClockwise,
  ArrowsDownUp,
  ArrowsLeftRight,
  CaretDown,
  CaretLeft,
  CaretRight,
  MagnifyingGlass,
  Plus,
} from '@phosphor-icons/react';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { COMMON_CURRENCIES, convertCents, toCents } from '../../../../shared/rates';
import { api } from '../../api';
import { useIsDesktop } from '../../hooks/useBreakpoints';
import { useHomeData } from '../../hooks/useHomeData';
import { navigate } from '../../hooks/useRoute';
import { useProfile } from '../../profile/ProfileContext';
import { queryClient } from '../../query-client';
import { formatMoney, listCurrencies } from '../../utils/money';
import { SOURCE_LABELS, describeRate, describeWhen } from '../../utils/rates';
import CurrencySelect from '../ui/CurrencySelect';
import ResponsiveDialog from '../ui/ResponsiveDialog';
import SplitAvatar from '../ui/SplitAvatar';
import classes from './Convert.module.css';
import { DEFAULT_SETTINGS, type SplitSummary } from '../../../../shared/api';

const RECENT_KEY = 'sf-convert-recent';
const MAX_RECENT = 5;

type Pair = [from: string, to: string];

function readRecent(): Pair[] {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(saved)
      ? saved.filter(
          (p): p is Pair =>
            Array.isArray(p) && p.length === 2 && p.every((c) => /^[A-Z]{3}$/.test(String(c))),
        )
      : [];
  } catch {
    return [];
  }
}

function saveRecent(pairs: Pair[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(pairs));
  } catch {
    // Private mode: recents just aren't kept
  }
}

/** "3,000" or "12.50" as a number; null while it isn't one */
const readAmount = (text: string) => {
  const cleaned = text.replace(/,/g, '').trim();
  if (cleaned === '' || !/^\d*\.?\d*$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

/** Picks a currency on a phone: suggestions first, then every currency, searchable */
function CurrencySheet({
  opened,
  title,
  value,
  suggested,
  onPick,
  onClose,
}: {
  opened: boolean;
  title: string;
  value: string;
  suggested: string[];
  onPick: (code: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (opened) setQuery('');
  }, [opened]);
  const all = listCurrencies();
  const q = query.trim().toLowerCase();
  const matches = q === '' ? all : all.filter((c) => c.label.toLowerCase().includes(q));
  const top =
    q === '' ? suggested.map((code) => all.find((c) => c.value === code)!).filter(Boolean) : [];
  const row = (c: { value: string; label: string }) => {
    const [code, ...rest] = c.label.split(' · ');
    return (
      <UnstyledButton
        key={c.value}
        className={classes.currencyRow}
        data-selected={c.value === value || undefined}
        onClick={() => {
          onPick(c.value);
          onClose();
        }}
      >
        <span className={classes.currencyCode}>{code}</span>
        <span className="sf-muted min-w-0 flex-1 truncate text-sm">{rest.join(' · ')}</span>
      </UnstyledButton>
    );
  };
  return (
    <ResponsiveDialog
      opened={opened}
      onClose={onClose}
      title={title}
    >
      <div className="flex flex-col gap-3">
        <TextInput
          placeholder="Search, e.g. yen or JPY"
          leftSection={<MagnifyingGlass size={16} />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search currencies"
        />
        <div className={classes.currencyList}>
          {top.length > 0 && (
            <>
              <div className="sf-label">Suggested</div>
              {top.map(row)}
              <div className="sf-label mt-2">All currencies</div>
            </>
          )}
          {matches.map(row)}
          {matches.length === 0 && <p className="sf-muted text-sm">No currency matches that.</p>}
        </div>
      </div>
    </ResponsiveDialog>
  );
}

/** Which split to add the amount to, on a phone */
function SplitSheet({
  opened,
  splits,
  label,
  onPick,
  onClose,
}: {
  opened: boolean;
  splits: SplitSummary[];
  label: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <ResponsiveDialog
      opened={opened}
      onClose={onClose}
      title={label}
    >
      {splits.length === 0 ? (
        <p className="sf-muted text-sm">Make a split first, then add to it from here.</p>
      ) : (
        <div className={classes.splitList}>
          {splits.map((s) => (
            <UnstyledButton
              key={s.id}
              className={classes.splitRow}
              onClick={() => onPick(s.id)}
            >
              <SplitAvatar
                splitId={s.id}
                name={s.name}
                pictureVersion={s.pictureVersion}
                size={36}
              />
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="sf-muted text-xs">{s.currency}</span>
              <CaretRight size={14} />
            </UnstyledButton>
          ))}
        </div>
      )}
    </ResponsiveDialog>
  );
}

// Convert (6a desktop, 6b phone): a quick converter at the split's rates, that can
// drop the amount straight into a split as a new item
const ConvertPage = () => {
  const isDesktop = useIsDesktop();
  const { profile } = useProfile();
  const { splits } = useHomeData();

  const home = profile?.settings.defaultCurrency ?? profile?.settings.lastCurrency ?? 'MYR';
  const [recent, setRecent] = useState(readRecent);
  const [from, setFrom] = useState(() => recent[0]?.[0] ?? (home === 'USD' ? 'MYR' : 'USD'));
  const [to, setTo] = useState(() => recent[0]?.[1] ?? home);
  const [amountText, setAmountText] = useState('100');
  const [splitId, setSplitId] = useState<string | null>(null);
  const amount = readAmount(amountText);

  const rateKey = ['rate', from, to, profile?.settings.rateSource ?? DEFAULT_SETTINGS.rateSource];
  const rate = useQuery({
    queryKey: rateKey,
    queryFn: () => api.getRate(from, to),
    enabled: from !== to,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // A pair that converted is worth offering again, whether its rate was fetched just
  // now or was already on hand
  const converted = rate.data != null;
  useEffect(() => {
    if (!converted || from === to) return;
    setRecent((list) => {
      if (list[0]?.[0] === from && list[0]?.[1] === to) return list;
      const next = [
        [from, to] as Pair,
        ...list.filter(([f, t]) => !(f === from && t === to)),
      ].slice(0, MAX_RECENT);
      saveRecent(next);
      return next;
    });
  }, [converted, from, to]);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      queryClient.setQueryData(rateKey, await api.getRate(from, to, { fresh: true }));
    } catch (err) {
      notifications.show({
        color: 'red',
        message: err instanceof Error ? err.message : "Couldn't get a rate right now",
      });
    } finally {
      setRefreshing(false);
    }
  };

  const result =
    amount == null
      ? null
      : from === to
        ? toCents(amount)
        : rate.data
          ? convertCents(toCents(amount), rate.data.rate)
          : null;

  const splitOptions = (splits ?? []).map((s) => ({ value: s.id, label: s.name }));
  const chosenSplit = splitId ?? splitOptions[0]?.value ?? null;
  const addTo = (id: string) => {
    if (amount == null) return;
    navigate(
      `?s=${encodeURIComponent(id)}&add=1&from=${from}&amount=${encodeURIComponent(
        String(amount),
      )}`,
    );
  };
  const addAsItem = () => {
    if (chosenSplit != null) addTo(chosenSplit);
  };

  // Phones: currency and split pickers open as sheets
  const [picking, setPicking] = useState<'from' | 'to' | 'split' | null>(null);
  const suggested = [...new Set([home, ...recent.flat(), ...COMMON_CURRENCIES])].slice(0, 6);

  const rateLine = (
    <div className={classes.rateLine}>
      {from === to ? (
        <span>Same currency</span>
      ) : rate.data ? (
        <>
          <span className="sf-tabular">{describeRate(rate.data.rate, from, to)}</span>
          <span>
            {SOURCE_LABELS[rate.data.source]}, {describeWhen(rate.data.fetchedAt)}
          </span>
        </>
      ) : rate.isError ? (
        <span>Couldn't get a rate right now</span>
      ) : (
        <span>Getting the rate…</span>
      )}
      {from !== to && (
        <Tooltip label="Fetch the live rate">
          <Button
            variant="subtle"
            size="compact-sm"
            leftSection={<ArrowClockwise size={14} />}
            loading={rate.isFetching || refreshing}
            onClick={() => void refresh()}
          >
            Refresh
          </Button>
        </Tooltip>
      )}
    </div>
  );

  const fields = (
    <div className={classes.fields}>
      <TextInput
        label="Amount"
        className={classes.amount}
        classNames={{ input: classes.amountInput }}
        inputMode="decimal"
        value={amountText}
        onChange={(e) => setAmountText(e.target.value)}
        error={amount == null && amountText.trim() !== '' ? 'Enter a number' : undefined}
      />
      <div className={classes.pair}>
        <CurrencySelect
          label="From"
          first={suggested}
          value={from}
          onChange={setFrom}
          className={classes.currency}
          classNames={{ input: classes.currencyInput }}
          comboboxProps={{ width: 240, position: 'bottom-start' }}
        />
        <Tooltip label="Swap">
          <ActionIcon
            variant="subtle"
            color="gray"
            size={40}
            className={classes.swap}
            aria-label="Swap currencies"
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}
          >
            <ArrowsLeftRight size={18} />
          </ActionIcon>
        </Tooltip>
        <CurrencySelect
          label="To"
          first={suggested}
          value={to}
          onChange={setTo}
          className={classes.currency}
          classNames={{ input: classes.currencyInput }}
          comboboxProps={{ width: 240, position: 'bottom-start' }}
        />
      </div>
    </div>
  );

  const addToSplit = (
    <div className={classes.addRow}>
      <Select
        label="Add to a split"
        placeholder={splitOptions.length === 0 ? 'No splits yet' : undefined}
        data={splitOptions}
        value={chosenSplit}
        onChange={setSplitId}
        allowDeselect={false}
        disabled={splitOptions.length === 0}
        className="min-w-0 flex-1"
        size={isDesktop ? 'sm' : 'md'}
      />
      <Button
        leftSection={<Plus size={16} />}
        onClick={addAsItem}
        disabled={chosenSplit == null || amount == null || amount === 0}
        size={isDesktop ? 'sm' : 'md'}
      >
        Add as item
      </Button>
    </div>
  );

  const recents = recent.length > 0 && (
    <div className={classes.recent}>
      <h2 className="sf-label">Recent</h2>
      <div className={classes.chips}>
        {recent.map(([f, t]) => (
          <UnstyledButton
            key={`${f}${t}`}
            className={classes.chip}
            onClick={() => {
              setFrom(f);
              setTo(t);
            }}
          >
            {f} to {t}
          </UnstyledButton>
        ))}
      </div>
    </div>
  );

  const resultBlock = (
    <div>
      <div className={classes.result}>{result == null ? '—' : formatMoney(result, to)}</div>
      {rateLine}
    </div>
  );

  if (!isDesktop) {
    const pill = (side: 'from' | 'to', code: string) => (
      <UnstyledButton
        className={classes.pill}
        onClick={() => setPicking(side)}
        aria-label={`${side === 'from' ? 'From' : 'To'} ${code}, change`}
      >
        {code}
        <CaretDown size={12} />
      </UnstyledButton>
    );
    const canAdd = amount != null && amount > 0;
    return (
      <div className={classes.mobilePage}>
        <UnstyledButton
          className={classes.back}
          onClick={() => navigate('')}
          aria-label="Back to My splits"
        >
          <CaretLeft size={20} />
          <span>Convert</span>
        </UnstyledButton>

        {/* Two rows, like a calculator: what you have on top, what it comes to below */}
        <div className={classes.converter}>
          <label className={classes.side}>
            <span className={classes.sideLabel}>From</span>
            <span className={classes.sideRow}>
              {pill('from', from)}
              <input
                className={classes.bigInput}
                inputMode="decimal"
                placeholder="0"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                aria-label="Amount"
                aria-invalid={amount == null && amountText.trim() !== ''}
              />
            </span>
          </label>
          <div className={classes.swapLine}>
            <ActionIcon
              variant="default"
              radius="xl"
              size={40}
              className={classes.swapRound}
              aria-label="Swap currencies"
              onClick={() => {
                setFrom(to);
                setTo(from);
              }}
            >
              <ArrowsDownUp size={18} />
            </ActionIcon>
          </div>
          <div className={classes.side}>
            <span className={classes.sideLabel}>To</span>
            <span className={classes.sideRow}>
              {pill('to', to)}
              <output
                className={classes.bigResult}
                data-empty={result == null || undefined}
                aria-live="polite"
              >
                {result == null ? '0' : formatMoney(result, to)}
              </output>
            </span>
          </div>
        </div>
        {rateLine}
        {recents}

        <div className={classes.mobileFooter}>
          <Button
            fullWidth
            size="lg"
            leftSection={<Plus size={18} />}
            disabled={!canAdd}
            onClick={() => setPicking('split')}
          >
            {canAdd ? `Add ${formatMoney(toCents(amount), from)} to a split` : 'Add to a split'}
          </Button>
        </div>

        <CurrencySheet
          opened={picking === 'from' || picking === 'to'}
          title={picking === 'to' ? 'Convert to' : 'Convert from'}
          value={picking === 'to' ? to : from}
          suggested={suggested}
          onPick={(code) => (picking === 'to' ? setTo(code) : setFrom(code))}
          onClose={() => setPicking(null)}
        />
        <SplitSheet
          opened={picking === 'split'}
          splits={splits ?? []}
          label={canAdd ? `Add ${formatMoney(toCents(amount), from)} to` : 'Add to'}
          onPick={(id) => {
            setPicking(null);
            addTo(id);
          }}
          onClose={() => setPicking(null)}
        />
      </div>
    );
  }

  return (
    <div className={classes.page}>
      <Title order={1}>Convert</Title>
      <div className={classes.card}>
        {fields}
        {resultBlock}
        <hr className="sf-rule" />
        {addToSplit}
      </div>
      {recents}
    </div>
  );
};

export default ConvertPage;
