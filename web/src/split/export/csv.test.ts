import { describe, expect, test } from 'vitest';
import type { Person } from '@shared/types';
import { computeTotals } from '../derive';
import type { SplitItem, SplitPayment } from '../state';
import { toCsv } from './csv';
import { type ExportRows, exportRows } from './rows';

// A split as a CSV file, as a spreadsheet will read it

const ryan: Person = { id: 'me', name: 'Ryan', memberEmail: null };
const ann: Person = { id: 'ann', name: 'Ann', memberEmail: null };

const item = (over: Partial<SplitItem> & Pick<SplitItem, 'id' | 'name' | 'cost'>): SplitItem => ({
  payer: ryan,
  participants: [ryan, ann],
  splitMode: 'equal',
  category: null,
  notes: null,
  createdAt: Date.UTC(2026, 9, 10, 12),
  original: null,
  ...over,
});

function csvOf(people: Person[], items: SplitItem[], payments: SplitPayment[] = []) {
  return toCsv(
    exportRows({
      name: 'Trip',
      currency: 'MYR',
      people,
      items,
      payments,
      totals: computeTotals(people, items, null, payments),
      members: [],
    }),
  );
}

/** Rows written straight, for cells a split wouldn't easily make */
const rowsWith = (over: Partial<ExportRows>): ExportRows => ({
  name: 'Trip',
  currency: 'MYR',
  totalCents: 0,
  people: [],
  items: [],
  payments: [],
  balances: [],
  transfers: [],
  ...over,
});

/** Reads CSV text back into rows of cells, as a spreadsheet would */
function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += c;
  }
  return rows;
}

describe('a split as a CSV', () => {
  test('items, balances and who pays who, in that order, with amounts as plain numbers', () => {
    const csv = csvOf(
      [ryan, ann],
      [
        item({ id: 'd', name: 'Dinner', cost: 100, category: 'food' }),
        item({
          id: 't',
          name: 'Taxi',
          cost: 30,
          payer: ann,
          notes: 'Airport, late',
          createdAt: Date.UTC(2026, 9, 11, 12),
        }),
        item({
          id: 'r',
          name: 'Ramen',
          cost: 90,
          category: 'food',
          original: { currency: 'JPY', amount: 3000, rate: 0.03, rateSource: 'wise', rateAt: 1 },
          createdAt: Date.UTC(2026, 9, 12, 12),
        }),
        item({
          id: 'h',
          name: 'Hotel',
          cost: 60,
          splitMode: 'shares',
          shares: { me: 2, ann: 1 },
          createdAt: Date.UTC(2026, 9, 12, 13),
        }),
      ],
    );
    expect(csv).toBe(
      '\uFEFF' +
        'Date,Item,Category,Amount (MYR),Original currency,Original amount,Rate,Rate source,Paid by,Split mode,Ryan,Ann,Notes\r\n' +
        '2026-10-10,Dinner,Food,100.00,,,,,Ryan,Equal,50.00,50.00,\r\n' +
        '2026-10-11,Taxi,,30.00,,,,,Ann,Equal,15.00,15.00,"Airport, late"\r\n' +
        '2026-10-12,Ramen,Food,90.00,JPY,3000.00,0.03,Wise,Ryan,Equal,45.00,45.00,\r\n' +
        '2026-10-12,Hotel,,60.00,,,,,Ryan,Shares,40.00,20.00,\r\n' +
        '\r\n' +
        'Person,Paid,Share,Balance\r\n' +
        'Ryan,250.00,150.00,100.00\r\n' +
        // Someone who owes has a negative number, not text
        'Ann,30.00,130.00,-100.00\r\n' +
        '\r\n' +
        'From,To,Amount\r\n' +
        'Ann,Ryan,100.00\r\n' +
        '\r\n' +
        'Date,Paid by,Paid to,Amount (MYR),Original currency,Original amount,Rate,For,Notes\r\n',
    );
  });

  test('payments made are a table of their own, and the balances count them', () => {
    const csv = csvOf(
      [ryan, ann],
      [item({ id: 'd', name: 'Dinner', cost: 100 })],
      [
        {
          id: 'p',
          from: ann,
          to: ryan,
          amount: 30,
          itemId: 'd',
          notes: null,
          createdAt: Date.UTC(2026, 9, 12, 12),
          original: { currency: 'JPY', amount: 1000, rate: 0.03, rateSource: 'wise', rateAt: 1 },
        },
      ],
    );
    // Paid is what was paid for; the payment shows in the balance and its own table
    expect(csv).toContain('Ann,0.00,50.00,-20.00\r\n');
    expect(csv).toContain('From,To,Amount\r\nAnn,Ryan,20.00\r\n');
    expect(csv.endsWith('2026-10-12,Ann,Ryan,30.00,JPY,1000.00,0.03,Dinner,\r\n')).toBe(true);
  });

  test('a split with nothing in it yet is the headers alone', () => {
    expect(csvOf([ryan, ann], [])).toBe(
      '\uFEFF' +
        'Date,Item,Category,Amount (MYR),Original currency,Original amount,Rate,Rate source,Paid by,Split mode,Ryan,Ann,Notes\r\n' +
        '\r\n' +
        'Person,Paid,Share,Balance\r\n' +
        '\r\n' +
        'From,To,Amount\r\n' +
        '\r\n' +
        'Date,Paid by,Paid to,Amount (MYR),Original currency,Original amount,Rate,For,Notes\r\n',
    );
  });

  test('amounts are exact to the cent, however large, and typed rates say so', () => {
    const csv = toCsv(
      rowsWith({
        balances: [{ name: 'Ryan', paidCents: 100_000_000_001, shareCents: 5, balanceCents: -7 }],
        items: [
          {
            createdAt: Date.UTC(2026, 9, 10, 12),
            name: 'Boat',
            category: null,
            amountCents: 1,
            original: { currency: 'USD', amountCents: 25, rate: 4.4, rateSource: 'manual' },
            paidBy: 'Ryan',
            splitMode: 'exact',
            shares: [],
            between: [],
            notes: null,
          },
        ],
      }),
    );
    expect(csv).toContain('\r\n2026-10-10,Boat,,0.01,USD,0.25,4.4,Typed in,Ryan,Exact,\r\n');
    expect(csv).toContain('\r\nRyan,1000000000.01,0.05,-0.07\r\n');
  });
});

describe('text in a CSV cell', () => {
  const withNames = (...names: string[]) =>
    toCsv(
      rowsWith({
        transfers: names.map((name) => ({
          from: name,
          to: 'Ann',
          amountCents: 500,
          payWith: null,
        })),
      }),
    )
      .split('From,To,Amount\r\n')[1]
      .split('\r\n\r\n')[0]
      .split('\r\n')
      .filter(Boolean);

  test('that a spreadsheet would run as a formula gets a quote mark in front', () => {
    expect(
      withNames('=SUM(A1:A9)', '+60123456789', '-5 off', '@home', '\tTab', '\rReturn'),
    ).toEqual([
      "'=SUM(A1:A9),Ann,5.00",
      "'+60123456789,Ann,5.00",
      "'-5 off,Ann,5.00",
      "'@home,Ann,5.00",
      "'\tTab,Ann,5.00",
      // Quoted as well, for its line break
      `"'\rReturn",Ann,5.00`,
    ]);
  });

  test('is left as it is when the formula characters are not first', () => {
    expect(withNames('Ann = Ben', 'A+B', 'mail@home', 'Ryan')).toEqual([
      'Ann = Ben,Ann,5.00',
      'A+B,Ann,5.00',
      'mail@home,Ann,5.00',
      'Ryan,Ann,5.00',
    ]);
  });

  test('in a header is guarded too: a person named like a formula', () => {
    const csv = csvOf([ryan, { id: 'x', name: '=1+1', memberEmail: null }], []);
    expect(csv.split('\r\n')[0]).toMatch(/,Ryan,'=1\+1,Notes$/);
  });

  test('with commas, quotes or line breaks is quoted, and reads back as written', () => {
    const notes = 'He said "two plates",\nthen\r\nleft';
    const csv = csvOf([ryan, ann], [item({ id: 'd', name: 'Dinner, "set"', cost: 10, notes })]);
    expect(csv).toContain(
      '2026-10-10,"Dinner, ""set""",,10.00,,,,,Ryan,Equal,5.00,5.00,"He said ""two plates"",\nthen\r\nleft"\r\n',
    );
    const [, dinner] = parseCsv(csv.slice(1));
    expect(dinner[1]).toBe('Dinner, "set"');
    expect(dinner[12]).toBe(notes);
    expect(dinner).toHaveLength(13);
  });

  test('in Japanese survives being saved as UTF-8 and read back', () => {
    const tanaka: Person = { id: 't', name: '田中 花子', memberEmail: null };
    const csv = csvOf(
      [ryan, tanaka],
      [
        item({
          id: 'r',
          name: 'ラーメン（一蘭）',
          cost: 30,
          participants: [ryan, tanaka],
          notes: '美味しい！',
        }),
      ],
    );
    const bytes = new TextEncoder().encode(csv);
    // The byte order mark Excel looks for, to read the file as UTF-8
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const back = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(back).toBe(csv);
    const [header, ramen] = parseCsv(back.slice(1));
    expect(header[11]).toBe('田中 花子');
    expect([ramen[1], ramen[10], ramen[11], ramen[12]]).toEqual([
      'ラーメン（一蘭）',
      '15.00',
      '15.00',
      '美味しい！',
    ]);
  });
});
