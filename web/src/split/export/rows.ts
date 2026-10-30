import { placeLabel } from '@shared/places';
import type { SplitMember } from '@shared/api';
import { type RateSource, savedRateSource, toCents } from '@shared/rates';
import type { Person, SplitMode } from '@shared/types';
import { fileSlug } from '../../utils/deliver-file';
import { isQr, methodLine, methodName } from '../../utils/payment-labels';
import { categoryLabel } from '../categories';
import type { SplitTotals } from '../derive';
import type { SplitItem, SplitPayment } from '../state';

// What a split's export holds, worked out once for both the CSV and the PDF: each item
// and what it costs each person, the payments made, everyone's balance, and who pays
// who. It's the split as this device shows it, changes not yet saved included. Amounts
// are whole cents.

/** The split as it's shown on this device */
export interface ExportSource {
  name: string;
  currency: string;
  people: Person[];
  items: SplitItem[];
  payments: SplitPayment[];
  /** Worked out with the split's distributor, as the split page does */
  totals: SplitTotals;
  /** The split's accounts, for how each person likes to be paid */
  members: SplitMember[];
}

export interface ExportItem {
  createdAt: number;
  name: string;
  /** Its category's label, or null when it has none */
  category: string | null;
  amountCents: number;
  /** What was paid, when it was paid in another currency */
  original: {
    currency: string;
    amountCents: number;
    /** Units of the split's currency to one of this; null until the server converts it */
    rate: number | null;
    rateSource: RateSource | null;
  } | null;
  paidBy: string;
  splitMode: SplitMode;
  /** What it costs each person in `people`, in the same order; null for those not in it */
  shares: (number | null)[];
  /** Who it's split between, with what it costs each */
  between: { name: string; cents: number }[];
  notes: string | null;
  /** Where it was paid for: its name, or its position until it has one */
  place: string | null;
}

export interface ExportPayment {
  createdAt: number;
  from: string;
  to: string;
  amountCents: number;
  /** What was paid, when it was paid in another currency */
  original: { currency: string; amountCents: number; rate: number | null } | null;
  /** The item it settled, if one */
  forItem: string | null;
  notes: string | null;
}

export interface ExportBalance {
  name: string;
  paidCents: number;
  shareCents: number;
  /** Paid less share, and payments made less received: positive when others owe them */
  balanceCents: number;
}

export interface ExportTransfer {
  from: string;
  to: string;
  amountCents: number;
  /** How the person paid likes to be paid ("DuitNow: 012 345 6789"), if they've said */
  payWith: string | null;
}

export interface ExportRows {
  name: string;
  currency: string;
  totalCents: number;
  /** One column each in the items: the split's people, then anyone removed who paid */
  people: string[];
  items: ExportItem[];
  payments: ExportPayment[];
  /** Everyone's balance; none before anything has been added */
  balances: ExportBalance[];
  transfers: ExportTransfer[];
}

/** How a payment method reads in an export: its type and details, on one line */
function paymentLabel(member: SplitMember | undefined) {
  const [preferred] = member?.paymentMethods ?? [];
  if (preferred == null) return null;
  if (isQr(preferred)) return methodName(preferred);
  const line = methodLine(preferred);
  return line ? `${preferred.type}: ${line}` : preferred.type;
}

export function exportRows({
  name,
  currency,
  people,
  items,
  payments,
  totals,
  members,
}: ExportSource): ExportRows {
  // Someone removed from the split still counts for the items they paid for
  const columns = [...people];
  for (const item of items) {
    if (!columns.some((p) => p.id === item.payer.id)) columns.push(item.payer);
  }
  const nameOf = (id: string) => columns.find((p) => p.id === id)?.name ?? '';
  const memberFor = (id: string) => {
    const email = columns.find((p) => p.id === id)?.memberEmail;
    return email == null ? undefined : members.find((m) => m.email === email);
  };

  return {
    name,
    currency,
    totalCents: totals.totalCents,
    people: columns.map((p) => p.name),
    items: items.map((item) => {
      const shares = totals.sharesByItem.get(item.id) ?? new Map<string, number>();
      return {
        createdAt: item.createdAt,
        name: item.name,
        category: categoryLabel(item.category),
        amountCents: toCents(item.cost),
        original: item.original && {
          currency: item.original.currency,
          amountCents: toCents(item.original.amount),
          rate: item.original.rate ?? null,
          rateSource: item.original.rate == null ? null : savedRateSource(item.original.rateSource),
        },
        paidBy: item.payer.name,
        splitMode: item.splitMode,
        shares: columns.map((p) => shares.get(p.id) ?? null),
        between: item.participants.map((p) => ({ name: p.name, cents: shares.get(p.id) ?? 0 })),
        notes: item.notes,
        place: item.place ? placeLabel(item.place) : null,
      };
    }),
    payments: payments.map((p) => ({
      createdAt: p.createdAt,
      from: p.from.name,
      to: p.to.name,
      amountCents: toCents(p.amount),
      original: p.original && {
        currency: p.original.currency,
        amountCents: toCents(p.original.amount),
        rate: p.original.rate ?? null,
      },
      forItem: items.find((i) => i.id === p.itemId)?.name ?? null,
      notes: p.notes,
    })),
    balances: totals.hasItems
      ? columns.map((p) => {
          const b = totals.balances.get(p.id);
          return {
            name: p.name,
            paidCents: b?.paidCents ?? 0,
            shareCents: b?.shareCents ?? 0,
            balanceCents: b?.balanceCents ?? 0,
          };
        })
      : [],
    transfers: totals.transfers.map((t) => ({
      from: nameOf(t.fromId),
      to: nameOf(t.toId),
      amountCents: t.amountCents,
      payWith: paymentLabel(memberFor(t.toId)),
    })),
  };
}

const two = (n: number) => String(n).padStart(2, '0');

/** "2026-10-16": the day, in local time */
export function isoDate(at: number) {
  const d = new Date(at);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** "japan-trip-2026-10-16.csv": the split's name and the day it was exported */
export const exportFileName = (splitName: string, extension: 'csv' | 'pdf', now: number) =>
  `${fileSlug(splitName)}-${isoDate(now)}.${extension}`;
