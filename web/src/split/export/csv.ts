import type { SplitMode } from '@shared/types';
import { type ExportRows, isoDate } from './rows';

// A split as a CSV file for spreadsheets: its items, then everyone's balance, then who
// pays who, each under its own header row with a blank row between. Amounts are plain
// numbers (12.50, no symbol) so a spreadsheet can add them up. It starts with a byte
// order mark so Excel reads Japanese and other non-Latin text correctly.

const BOM = '\uFEFF';

/** Text or an amount; amounts are written as numbers, text is quoted and guarded */
type Cell = { text: string | null } | { cents: number } | { number: number | null };

const text = (value: string | null): Cell => ({ text: value });
const amount = (cents: number | null): Cell => (cents == null ? { text: null } : { cents });
const number = (value: number | null): Cell => ({ number: value });

const MODES: Record<SplitMode, string> = { equal: 'Equal', shares: 'Shares', exact: 'Exact' };
const SOURCES = { wise: 'Wise', frankfurter: 'ECB', manual: 'Typed in' } as const;

/** "-12.50": whole cents as a decimal, without rounding through floating point */
function decimal(cents: number) {
  const whole = Math.floor(Math.abs(cents) / 100);
  const part = String(Math.abs(cents) % 100).padStart(2, '0');
  return `${cents < 0 ? '-' : ''}${whole}.${part}`;
}

/**
 * Text a spreadsheet would run as a formula (=, +, - or @ first, or a tab or return)
 * gets a ' in front, so it shows as typed. Amounts are numbers and aren't changed.
 */
const guard = (value: string) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

/** Quotes a cell with a comma, quote or line break in it, doubling any quotes */
const quote = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

function cell(c: Cell) {
  if ('cents' in c) return decimal(c.cents);
  if ('number' in c) return c.number == null ? '' : String(c.number);
  return c.text == null ? '' : quote(guard(c.text));
}

export function toCsv(rows: ExportRows): string {
  const header = (names: string[]) => names.map(text);
  const lines: Cell[][] = [
    header([
      'Date',
      'Item',
      'Category',
      `Amount (${rows.currency})`,
      'Original currency',
      'Original amount',
      'Rate',
      'Rate source',
      'Paid by',
      'Split mode',
      ...rows.people,
      'Notes',
    ]),
    ...rows.items.map((i) => [
      text(isoDate(i.createdAt)),
      text(i.name),
      text(i.category),
      amount(i.amountCents),
      text(i.original?.currency ?? null),
      amount(i.original?.amountCents ?? null),
      number(i.original?.rate ?? null),
      text(i.original?.rateSource == null ? null : SOURCES[i.original.rateSource]),
      text(i.paidBy),
      text(MODES[i.splitMode]),
      ...i.shares.map(amount),
      text(i.notes),
    ]),
    [],
    header(['Person', 'Paid', 'Share', 'Balance']),
    ...rows.balances.map((b) => [
      text(b.name),
      amount(b.paidCents),
      amount(b.shareCents),
      amount(b.balanceCents),
    ]),
    [],
    header(['From', 'To', 'Amount']),
    ...rows.transfers.map((t) => [text(t.from), text(t.to), amount(t.amountCents)]),
  ];
  return BOM + lines.map((line) => line.map(cell).join(',') + '\r\n').join('');
}
