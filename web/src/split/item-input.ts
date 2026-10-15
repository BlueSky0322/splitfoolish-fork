import { DEFAULT_SETTINGS, RATE_PROVIDERS } from '../../../shared/api';
import { RateSource, convertParts, isValidRate, toCents } from '../../../shared/rates';
import type { SplitMode } from '../../../shared/settle';
import type { ItemOriginal } from '../../../shared/types';
import type { ItemInput } from '../api';

// What the item form works out from what's typed: which rate converts it, and the item
// it saves. Plain functions, so the rules can be read (and tested) without the form.

/** An exact amount as typed: blank counts as nothing yet */
export const exactCents = (typed: number | '') => (typed === '' ? 0 : toCents(typed));

export interface RateInputs {
  /** Paid in a currency other than the split's */
  foreign: boolean;
  entryCurrency: string;
  /** The amount as typed, in cents of the currency it was paid in */
  enteredCents: number | null;
  useOwnRate: boolean;
  ownRate: number | '';
  /** What the item was saved with, when editing one */
  original: ItemOriginal | null | undefined;
  /** Today's rate, once fetched */
  fetched: { rate: number; source: RateSource } | undefined;
}

/**
 * The rate for the preview, and where it came from: 1 in the split's own currency; the
 * one typed; the one the item was saved with, if the amount and currency haven't
 * changed (the server keeps it too); or else today's rate. Null until there is one.
 */
export function chooseRate(r: RateInputs): { rate: number | null; source: RateSource | null } {
  if (!r.foreign) return { rate: 1, source: null };
  if (r.useOwnRate) return { rate: isValidRate(r.ownRate) ? r.ownRate : null, source: 'manual' };
  const saved = r.original;
  if (
    saved?.rate != null &&
    saved.currency === r.entryCurrency &&
    r.enteredCents === toCents(saved.amount) &&
    saved.rateSource !== 'manual'
  ) {
    return {
      rate: saved.rate,
      source: saved.rateSource ?? RATE_PROVIDERS[DEFAULT_SETTINGS.rateSource],
    };
  }
  return { rate: r.fetched?.rate ?? null, source: r.fetched?.source ?? null };
}

export interface ItemFields {
  name: string;
  /** The amount as typed, in cents of the currency it was paid in */
  enteredCents: number;
  /** Converted into the split's currency; null without a rate yet (offline, say) */
  costCents: number | null;
  rate: number | null;
  foreign: boolean;
  entryCurrency: string;
  useOwnRate: boolean;
  ownRate: number | '';
  payerId: string;
  participantIds: string[];
  mode: SplitMode;
  shares: Record<string, number>;
  /** Exact amounts as typed, in the currency it was paid in */
  exact: Record<string, number | ''>;
  category: string | null;
  notes: string;
}

/**
 * The item to save. Its amounts are shown until the server's converted numbers arrive;
 * without a rate yet, the amounts as typed stand in. The server converts again from
 * `original`.
 */
export function buildItemInput(f: ItemFields): ItemInput {
  const ids = f.participantIds;
  const typed = (id: string) => {
    const value = f.exact[id];
    return value === '' ? 0 : value;
  };
  const typedExact: Record<string, number> = Object.fromEntries(ids.map((id) => [id, typed(id)]));
  const shownCents = f.costCents ?? f.enteredCents;
  const shownExact =
    f.foreign && f.rate != null
      ? convertParts(
          ids.map((id) => [id, toCents(typedExact[id])]),
          f.rate,
          shownCents,
        )
      : null;
  return {
    name: f.name.trim(),
    cost: shownCents / 100,
    payerId: f.payerId,
    participantIds: ids,
    splitMode: f.mode,
    shares:
      f.mode === 'shares' ? Object.fromEntries(ids.map((id) => [id, f.shares[id]])) : undefined,
    exact:
      f.mode !== 'exact'
        ? undefined
        : shownExact
          ? Object.fromEntries(ids.map((id) => [id, (shownExact.get(id) ?? 0) / 100]))
          : typedExact,
    category: f.category,
    notes: f.notes.trim() === '' ? null : f.notes.trim(),
    original: f.foreign
      ? {
          currency: f.entryCurrency,
          amount: f.enteredCents / 100,
          exact: f.mode === 'exact' ? typedExact : undefined,
          ...(f.useOwnRate && isValidRate(f.ownRate)
            ? { rate: f.ownRate, rateSource: 'manual' as const }
            : {}),
        }
      : null,
  };
}
