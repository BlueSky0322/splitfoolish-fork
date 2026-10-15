import { Button, Select, UnstyledButton } from '@mantine/core';
import { ArrowsLeftRight } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../../api';
import { navigate } from '../../hooks/useRoute';
import { useProfile } from '../../profile/ProfileContext';
import { listCurrencies } from '../../utils/money';
import { SOURCE_LABELS, describeRate, describeWhen } from '../../utils/rates';
import SettingsCard from './SettingsCard';
import type { Track } from './useSaveIndicator';
import classes from './SettingsLayout.module.css';
import { DEFAULT_SETTINGS } from '../../../../shared/api';
import { plural } from '../../utils/text';

/** The Select value for "use the currency used last" */
const LAST_USED = 'last';

const RATE_SOURCES = [
  {
    value: 'wise',
    label: 'Wise',
    tag: 'Live',
    help: 'Live mid-market rates, updated every minute.',
  },
  {
    value: 'ecb',
    label: 'ECB',
    tag: null,
    help: 'European Central Bank reference rates, published once a working day.',
  },
] as const;

// Currency (9c): what new splits use, where rates come from, and today's rates for the
// currencies in your splits
const CurrencySection = ({ track }: { track: Track }) => {
  const { profile, updateSettings } = useProfile();
  const currencies = useMemo(listCurrencies, []);
  const settings = profile?.settings;
  const home = settings?.defaultCurrency ?? settings?.lastCurrency ?? 'MYR';
  const source = settings?.rateSource ?? DEFAULT_SETTINGS.rateSource;

  const rates = useQuery({
    queryKey: ['used-currency-rates', home, source],
    queryFn: () => api.usedCurrencyRates(home),
    enabled: profile != null,
    staleTime: 5 * 60 * 1000,
  });

  if (profile == null || settings == null) return null;
  const lastUsed = settings.lastCurrency ?? 'MYR';
  const nameOf = (code: string) =>
    currencies.find((c) => c.value === code)?.label.split(' · ')[1] ?? code;
  const chosen = settings.defaultCurrency ?? lastUsed;
  const rows = rates.data?.currencies ?? [];
  const latest = Math.max(0, ...rows.map((r) => r.fetchedAt ?? 0));
  const sourceUsed = rows.find((r) => r.source)?.source;

  return (
    <>
      <SettingsCard
        title="Default for new splits"
        help="You can change it per split in Split settings."
      >
        <Select
          aria-label="Default for new splits"
          description={'"Last used" picks the currency of your most recent split.'}
          inputWrapperOrder={['label', 'input', 'description']}
          data={[
            { value: LAST_USED, label: `Last used, ${nameOf(lastUsed)}` },
            ...currencies.map((c) => ({ value: c.value, label: c.label })),
          ]}
          value={settings.defaultCurrency ?? LAST_USED}
          onChange={(v) =>
            v && track(updateSettings({ defaultCurrency: v === LAST_USED ? null : v }))
          }
          searchable
          allowDeselect={false}
          leftSection={<span className={classes.codeTag}>{chosen}</span>}
          leftSectionWidth={64}
          className={classes.wideField}
        />
      </SettingsCard>

      <SettingsCard
        title="Rate source"
        help="Used when you add an item in another currency. You can always type your own rate."
      >
        <div
          className={classes.choiceTiles}
          role="radiogroup"
          aria-label="Rate source"
        >
          {RATE_SOURCES.map((s) => (
            <UnstyledButton
              key={s.value}
              role="radio"
              aria-checked={source === s.value}
              className={classes.choiceTile}
              data-selected={source === s.value || undefined}
              onClick={() => source !== s.value && track(updateSettings({ rateSource: s.value }))}
            >
              <span className={classes.choiceHead}>
                <span
                  className={classes.radio}
                  aria-hidden
                />
                <span className="flex-1">{s.label}</span>
                {s.tag && <span className={classes.neutralTag}>{s.tag}</span>}
              </span>
              <span className={classes.choiceHelp}>{s.help}</span>
            </UnstyledButton>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard
        title="Rates in your splits"
        help={`Currencies used in any of your splits, against ${home}.`}
        action={
          <Button
            variant="subtle"
            size="compact-sm"
            leftSection={<ArrowsLeftRight size={14} />}
            onClick={() => navigate('?convert')}
          >
            Open converter
          </Button>
        }
        flush
      >
        {rates.isPending ? (
          <p className={classes.listNote}>Getting today's rates…</p>
        ) : rows.length === 0 ? (
          <p className={classes.listNote}>
            {rates.isError
              ? "Couldn't get the rates right now."
              : `Your splits are all in ${home} so far.`}
          </p>
        ) : (
          <>
            <div className={classes.rateList}>
              {rows.map((r) => (
                <div
                  key={r.currency}
                  className={classes.rateRow}
                >
                  <span className={classes.codeTag}>{r.currency}</span>
                  <span className="sf-tabular min-w-0 flex-1 truncate">
                    {r.rate == null ? 'No rate right now' : describeRate(r.rate, r.currency, home)}
                  </span>
                  <span className={classes.rateCount}>{plural(r.splits, 'split')}</span>
                </div>
              ))}
            </div>
            {latest > 0 && sourceUsed && (
              <p className={classes.listNote}>
                {SOURCE_LABELS[sourceUsed]}, updated {describeWhen(latest)}
              </p>
            )}
          </>
        )}
      </SettingsCard>
    </>
  );
};

export default CurrencySection;
