import { describe, expect, test } from 'vitest';
import type { SplitMember } from '@shared/api';
import type { Person } from '@shared/types';
import { computeTotals } from '../derive';
import type { SplitItem, SplitPayment } from '../state';
import { type ExportSource, exportFileName, exportRows } from './rows';

// What an export holds, before it's written as a CSV or a PDF: each item and what it
// costs each person, everyone's balance, and who pays who

const ryan: Person = { id: 'me', name: 'Ryan', memberEmail: 'ryan@example.com' };
const ann: Person = { id: 'ann', name: 'Ann', memberEmail: 'ann@example.com' };
const ben: Person = { id: 'ben', name: 'Ben', memberEmail: null };

const OCT_10 = Date.UTC(2026, 9, 10, 12);

const item = (over: Partial<SplitItem> & Pick<SplitItem, 'id' | 'name' | 'cost'>): SplitItem => ({
  payer: ryan,
  participants: [ryan, ann, ben],
  splitMode: 'equal',
  category: null,
  notes: null,
  createdAt: OCT_10,
  original: null,
  ...over,
});

function source(
  people: Person[],
  items: SplitItem[],
  {
    distributorId = null,
    members = [],
    payments = [],
  }: { distributorId?: string | null; members?: SplitMember[]; payments?: SplitPayment[] } = {},
): ExportSource {
  return {
    name: 'Japan trip',
    currency: 'MYR',
    people,
    items,
    payments,
    totals: computeTotals(people, items, distributorId, payments),
    members,
  };
}

const member = (email: string, paymentMethods: SplitMember['paymentMethods']): SplitMember => ({
  email,
  role: 'editor',
  displayName: null,
  avatarVersion: null,
  paymentMethods,
});

describe('the items in an export', () => {
  test('an even split shares out the leftover cent, as the split page does', () => {
    const rows = exportRows(
      source([ryan, ann, ben], [item({ id: 'd', name: 'Dinner', cost: 100 })]),
    );
    expect(rows.people).toEqual(['Ryan', 'Ann', 'Ben']);
    expect(rows.items).toEqual([
      {
        createdAt: OCT_10,
        name: 'Dinner',
        category: 'Other',
        amountCents: 10000,
        original: null,
        paidBy: 'Ryan',
        splitMode: 'equal',
        // Ties go by person id: "ann" comes first, so Ann takes the extra cent
        shares: [3333, 3334, 3333],
        between: [
          { name: 'Ryan', cents: 3333 },
          { name: 'Ann', cents: 3334 },
          { name: 'Ben', cents: 3333 },
        ],
        notes: null,
        place: null,
      },
    ]);
  });

  test('by shares and by exact amounts, with nothing for people not in it', () => {
    const rows = exportRows(
      source(
        [ryan, ann, ben],
        [
          item({
            id: 'h',
            name: 'Hotel',
            cost: 60,
            participants: [ryan, ann],
            splitMode: 'shares',
            shares: { me: 2, ann: 1 },
            category: 'accommodation',
          }),
          item({
            id: 's',
            name: 'Snacks',
            cost: 50,
            payer: ann,
            participants: [ryan, ben],
            splitMode: 'exact',
            exact: { me: 30, ben: 20 },
            notes: 'From the 7-Eleven',
          }),
        ],
      ),
    );
    expect(rows.items.map((i) => [i.name, i.category, i.splitMode, i.shares, i.notes])).toEqual([
      ['Hotel', 'Accommodation', 'shares', [4000, 2000, null], null],
      ['Snacks', 'Other', 'exact', [3000, null, 2000], 'From the 7-Eleven'],
    ]);
    expect(rows.items[1].between).toEqual([
      { name: 'Ryan', cents: 3000 },
      { name: 'Ben', cents: 2000 },
    ]);
  });

  test('an item paid in another currency keeps what was paid, the rate and where it came from', () => {
    const rows = exportRows(
      source(
        [ryan, ann],
        [
          item({
            id: 'r',
            name: 'Ramen',
            cost: 90,
            participants: [ryan, ann],
            original: { currency: 'JPY', amount: 3000, rate: 0.03, rateSource: 'wise', rateAt: 1 },
          }),
          // Saved before sources were kept: it counts as typed
          item({
            id: 't',
            name: 'Taxi',
            cost: 30,
            participants: [ryan, ann],
            original: { currency: 'JPY', amount: 1000, rate: 0.03 },
          }),
          // Added offline, so not converted by the server yet
          item({
            id: 'm',
            name: 'Museum',
            cost: 0,
            participants: [ryan, ann],
            original: { currency: 'JPY', amount: 1200 },
          }),
        ],
      ),
    );
    expect(rows.items.map((i) => [i.amountCents, i.original])).toEqual([
      [9000, { currency: 'JPY', amountCents: 300000, rate: 0.03, rateSource: 'wise' }],
      [3000, { currency: 'JPY', amountCents: 100000, rate: 0.03, rateSource: 'manual' }],
      [0, { currency: 'JPY', amountCents: 120000, rate: null, rateSource: null }],
    ]);
  });
});

describe('balances and who pays who in an export', () => {
  const items = [
    item({ id: 'd', name: 'Dinner', cost: 90 }),
    item({ id: 't', name: 'Taxi', cost: 30, payer: ann, participants: [ann, ben] }),
  ];

  test('match the split page’s totals, person by person', () => {
    const rows = exportRows(source([ryan, ann, ben], items));
    expect(rows.totalCents).toBe(12000);
    expect(rows.balances).toEqual([
      { name: 'Ryan', paidCents: 9000, shareCents: 3000, balanceCents: 6000 },
      { name: 'Ann', paidCents: 3000, shareCents: 4500, balanceCents: -1500 },
      { name: 'Ben', paidCents: 0, shareCents: 4500, balanceCents: -4500 },
    ]);
    // Each person's column adds up to their share
    for (const [i, b] of rows.balances.entries()) {
      const column = rows.items.reduce((sum, row) => sum + (row.shares[i] ?? 0), 0);
      expect(column).toBe(b.shareCents);
    }
    expect(rows.transfers).toEqual([
      { from: 'Ben', to: 'Ryan', amountCents: 4500, payWith: null },
      { from: 'Ann', to: 'Ryan', amountCents: 1500, payWith: null },
    ]);
  });

  test('payments made count in the balances, and are listed with what they were for', () => {
    const payments: SplitPayment[] = [
      {
        id: 'p',
        from: ben,
        to: ryan,
        amount: 45,
        itemId: 'd',
        notes: 'Cash',
        createdAt: OCT_10 + 86_400_000,
        original: { currency: 'JPY', amount: 1500, rate: 0.03, rateSource: 'wise', rateAt: 1 },
      },
    ];
    const rows = exportRows(source([ryan, ann, ben], items, { payments }));
    expect(rows.totalCents).toBe(12000);
    expect(rows.balances.map((b) => [b.name, b.balanceCents])).toEqual([
      ['Ryan', 1500],
      ['Ann', -1500],
      ['Ben', 0],
    ]);
    expect(rows.transfers).toEqual([{ from: 'Ann', to: 'Ryan', amountCents: 1500, payWith: null }]);
    expect(rows.payments).toEqual([
      {
        createdAt: OCT_10 + 86_400_000,
        from: 'Ben',
        to: 'Ryan',
        amountCents: 4500,
        original: { currency: 'JPY', amountCents: 150000, rate: 0.03 },
        forItem: 'Dinner',
        notes: 'Cash',
      },
    ]);
  });

  test('go through the person payments are routed through', () => {
    const rows = exportRows(source([ryan, ann, ben], items, { distributorId: 'ann' }));
    expect(rows.transfers).toEqual([
      { from: 'Ann', to: 'Ryan', amountCents: 6000, payWith: null },
      { from: 'Ben', to: 'Ann', amountCents: 4500, payWith: null },
    ]);
  });

  test('say how the person paid likes to be paid, when they have said', () => {
    const rows = exportRows(
      source([ryan, ann, ben], items, {
        members: [
          member('ryan@example.com', [
            {
              id: 'm1',
              type: 'Bank transfer',
              detail: '5140 1234',
              bank: 'Maybank',
              accountName: 'Ryan Ng',
            },
            { id: 'm2', type: 'Cash', detail: '' },
          ]),
        ],
      }),
    );
    expect(rows.transfers.map((t) => t.payWith)).toEqual([
      'Bank transfer: Maybank · 5140 1234 · Ryan Ng',
      'Bank transfer: Maybank · 5140 1234 · Ryan Ng',
    ]);

    const qr = exportRows(
      source([ryan, ann, ben], items, {
        members: [member('ryan@example.com', [{ id: 'q', type: 'QR code', detail: 'DuitNow QR' }])],
      }),
    );
    expect(qr.transfers[0].payWith).toBe('DuitNow QR');
  });

  test('someone removed who paid for an item still has a column and a balance', () => {
    // Ben paid for the taxi, then was taken out of the split
    const taxi = item({ id: 't', name: 'Taxi', cost: 30, payer: ben, participants: [ryan, ann] });
    const rows = exportRows(source([ryan, ann], [taxi]));
    expect(rows.people).toEqual(['Ryan', 'Ann', 'Ben']);
    expect(rows.items[0].shares).toEqual([1500, 1500, null]);
    expect(rows.balances).toEqual([
      { name: 'Ryan', paidCents: 0, shareCents: 1500, balanceCents: -1500 },
      { name: 'Ann', paidCents: 0, shareCents: 1500, balanceCents: -1500 },
      { name: 'Ben', paidCents: 3000, shareCents: 0, balanceCents: 3000 },
    ]);
    expect(rows.transfers).toEqual([
      { from: 'Ryan', to: 'Ben', amountCents: 1500, payWith: null },
      { from: 'Ann', to: 'Ben', amountCents: 1500, payWith: null },
    ]);
  });

  test('a split with nothing in it yet has no balances or payments', () => {
    const rows = exportRows(source([ryan, ann], []));
    expect(rows).toMatchObject({ totalCents: 0, items: [], balances: [], transfers: [] });
    expect(rows.people).toEqual(['Ryan', 'Ann']);
  });
});

describe('the name of an exported file', () => {
  const OCT_16 = new Date(2026, 9, 16, 9).getTime();

  test('is the split’s name and the day', () => {
    expect(exportFileName('Japan trip', 'csv', OCT_16)).toBe('japan-trip-2026-10-16.csv');
    expect(exportFileName('Langkawi / Penang!', 'pdf', OCT_16)).toBe(
      'langkawi-penang-2026-10-16.pdf',
    );
  });

  test('keeps Japanese and other letters, and falls back to "split"', () => {
    expect(exportFileName('東京旅行 2026', 'pdf', OCT_16)).toBe('東京旅行-2026-2026-10-16.pdf');
    expect(exportFileName('!!!', 'csv', OCT_16)).toBe('split-2026-10-16.csv');
  });
});
