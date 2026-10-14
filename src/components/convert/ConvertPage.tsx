import {
  ActionIcon,
  Button,
  Select,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { ArrowClockwise, ArrowsLeftRight, CaretLeft, Plus } from '@phosphor-icons/react';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { COMMON_CURRENCIES, convertCents } from '../../../shared/rates';
import { api } from '../../api';
import { useIsDesktop } from '../../hooks/useBreakpoints';
import { useHomeData } from '../../hooks/useHomeData';
import { navigate } from '../../hooks/useRoute';
import { useProfile } from '../../profile/ProfileContext';
import { queryClient } from '../../query-client';
import { formatMoney, listCurrencies } from '../../utils/money';
import { SOURCE_LABELS, describeRate, describeWhen } from '../../utils/rates';
import classes from './Convert.module.css';

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

// Convert (6a desktop, 6b phone): a quick converter at the split's rates, that can
// drop the amount straight into a split as a new item
const ConvertPage = () => {
  const isDesktop = useIsDesktop();
  const { profile } = useProfile();
  const { splits } = useHomeData();
  const currencies = useMemo(() => {
    const all = listCurrencies();
    const common = new Set<string>(COMMON_CURRENCIES);
    return [
      ...all.filter((c) => common.has(c.value)),
      ...all.filter((c) => !common.has(c.value)),
    ].map((c) => ({ value: c.value, label: c.value }));
  }, []);

  const home = profile?.settings.defaultCurrency ?? profile?.settings.lastCurrency ?? 'MYR';
  const [recent, setRecent] = useState(readRecent);
  const [from, setFrom] = useState(() => recent[0]?.[0] ?? (home === 'USD' ? 'MYR' : 'USD'));
  const [to, setTo] = useState(() => recent[0]?.[1] ?? home);
  const [amountText, setAmountText] = useState('100');
  const [splitId, setSplitId] = useState<string | null>(null);
  const amount = readAmount(amountText);

  const rateKey = ['rate', from, to, profile?.settings.rateSource ?? 'wise'];
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
        ? Math.round(amount * 100)
        : rate.data
          ? convertCents(Math.round(amount * 100), rate.data.rate)
          : null;

  const splitOptions = (splits ?? []).map((s) => ({ value: s.id, label: s.name }));
  const chosenSplit = splitId ?? splitOptions[0]?.value ?? null;
  const addAsItem = () => {
    if (chosenSplit == null || amount == null) return;
    navigate(
      `?s=${encodeURIComponent(chosenSplit)}&add=1&from=${from}&amount=${encodeURIComponent(
        String(amount),
      )}`,
    );
  };

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
        <Select
          label="From"
          data={currencies}
          value={from}
          onChange={(v) => v && setFrom(v)}
          searchable
          allowDeselect={false}
          className={classes.currency}
          classNames={{ input: classes.currencyInput }}
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
        <Select
          label="To"
          data={currencies}
          value={to}
          onChange={(v) => v && setTo(v)}
          searchable
          allowDeselect={false}
          className={classes.currency}
          classNames={{ input: classes.currencyInput }}
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
        <div className={classes.card}>
          {fields}
          {resultBlock}
        </div>
        {recents}
        <div className={classes.mobileFooter}>{addToSplit}</div>
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
