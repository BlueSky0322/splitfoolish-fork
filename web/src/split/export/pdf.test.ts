import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { SplitMember } from '@shared/api';
import type { Person } from '@shared/types';
import { computeTotals } from '../derive';
import type { SplitItem, SplitPayment } from '../state';
import { FONT, makePdf } from './pdf';
import { type ExportSource, exportRows } from './rows';

// A split as a PDF, with jsPDF stood in for: what it's asked to write, in what font,
// and on which page. (A real PDF is made from the same code by the app.)

const { calls, autoTable, pages } = vi.hoisted(() => ({
  /** Every call made on the document, in order: [method, ...arguments] */
  calls: [] as unknown[][],
  autoTable: vi.fn(),
  pages: { count: 1 },
}));

vi.mock('jspdf', () => ({
  jsPDF: function jsPDF(options: unknown) {
    calls.push(['new', options]);
    pages.count = 1;
    const doc: Record<string, unknown> = {
      internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
      lastAutoTable: { finalY: 100 },
      splitTextToSize: (text: string) => [text],
      getNumberOfPages: () => pages.count,
      addPage: () => {
        pages.count++;
        calls.push(['addPage']);
      },
      output: (type: string) => {
        calls.push(['output', type]);
        return new Blob(['%PDF-1.3 stand-in'], { type: 'application/pdf' });
      },
    };
    const proxy: unknown = new Proxy(doc, {
      get: (target, method: string) =>
        method in target
          ? target[method]
          : (...args: unknown[]) => {
              calls.push([method, ...args]);
              return proxy;
            },
    });
    return proxy;
  },
}));

vi.mock('jspdf-autotable', () => ({ autoTable }));

vi.mock('./font', () => ({ loadFont: () => Promise.resolve('Rk9OVA==') }));

beforeEach(() => {
  calls.length = 0;
  autoTable.mockReset();
});

const ryan: Person = { id: 'me', name: 'Ryan', memberEmail: 'ryan@example.com' };
const hanako: Person = { id: 'hk', name: '田中 花子', memberEmail: 'hanako@example.com' };
const OCT_10 = Date.UTC(2026, 9, 10, 12);
const OCT_16 = new Date(2026, 9, 16, 9).getTime();

const item = (over: Partial<SplitItem> & Pick<SplitItem, 'id' | 'name' | 'cost'>): SplitItem => ({
  payer: hanako,
  participants: [ryan, hanako],
  splitMode: 'equal',
  category: null,
  notes: null,
  createdAt: OCT_10,
  original: null,
  ...over,
});

const hanakoPays: SplitMember = {
  email: 'hanako@example.com',
  role: 'editor',
  displayName: null,
  avatarVersion: null,
  paymentMethods: [{ id: 'm', type: 'DuitNow', detail: '012-345 6789' }],
};

function source(
  items: SplitItem[],
  people = [ryan, hanako],
  payments: SplitPayment[] = [],
): ExportSource {
  return {
    name: '日本旅行',
    currency: 'MYR',
    people,
    items,
    payments,
    totals: computeTotals(people, items, null, payments),
    members: [hanakoPays],
  };
}

const trip = source([
  item({
    id: 'r',
    name: 'ラーメン',
    cost: 90,
    original: { currency: 'JPY', amount: 3000, rate: 0.03, rateSource: 'wise', rateAt: 1 },
  }),
  item({
    id: 'b',
    name: 'Boat',
    cost: 12,
    original: { currency: 'THB', amount: 120, rate: 0.1, rateSource: 'manual' },
  }),
  item({
    id: 'h',
    name: 'Hotel',
    cost: 60,
    payer: ryan,
    splitMode: 'shares',
    shares: { me: 2, hk: 1 },
    createdAt: Date.UTC(2026, 9, 12, 12),
  }),
]);

const index = (method: string) => calls.findIndex(([m]) => m === method);
const texts = () => calls.filter(([m]) => m === 'text').map(([, text]) => text);
/** The options of each table drawn */
const tables = () => autoTable.mock.calls.map(([, options]) => options as Record<string, unknown>);

describe('a split as a PDF', () => {
  test('is an A4 page in the embedded font, registered and chosen before any text', async () => {
    expect(await (await makePdf(exportRows(trip), OCT_16)).text()).toBe('%PDF-1.3 stand-in');
    // Made as a file to save or share, last of all
    expect(calls.at(-1)).toEqual(['output', 'blob']);
    expect(calls[0]).toEqual(['new', { unit: 'mm', format: 'a4', orientation: 'portrait' }]);
    expect(calls[index('addFileToVFS')]).toEqual([
      'addFileToVFS',
      'NotoSansJP-subset-v2.ttf',
      'Rk9OVA==',
    ]);
    expect(calls[index('addFont')]).toEqual([
      'addFont',
      'NotoSansJP-subset-v2.ttf',
      FONT,
      'normal',
    ]);
    expect(calls[index('setFont')]).toEqual(['setFont', FONT, 'normal']);
    expect(index('addFileToVFS')).toBeLessThan(index('addFont'));
    expect(index('addFont')).toBeLessThan(index('setFont'));
    expect(index('setFont')).toBeLessThan(index('text'));
    // Tables too, headers included: there's no bold Noto Sans JP to fall back on
    expect(tables()).toHaveLength(3);
    for (const options of tables()) {
      expect(options.styles).toMatchObject({ font: FONT, fontStyle: 'normal' });
      expect(options.headStyles).toMatchObject({ font: FONT, fontStyle: 'normal' });
    }
  });

  test('has a header with the name, dates, people and total', async () => {
    await makePdf(exportRows(trip), OCT_16);
    expect(texts().slice(0, 3)).toEqual([
      '日本旅行',
      'Oct 10, 2026 – Oct 12, 2026 · 2 people · In MYR · Total RM 162.00',
      'Exported Oct 16, 2026',
    ]);
  });

  test('lists the items, balances and who pays who', async () => {
    await makePdf(exportRows(trip), OCT_16);
    const [items, balances, transfers] = tables();
    expect(items.head).toEqual([['Date', 'Item', 'Paid by', 'Split between', 'Amount']]);
    expect(items.body).toEqual([
      // What was paid and the rate go under the amount
      [
        'Oct 10, 2026',
        'ラーメン',
        '田中 花子',
        'Ryan, 田中 花子',
        'RM 90.00\n¥ 3,000\n1 JPY = 0.03 MYR',
      ],
      // The font has no ฿, so baht show as THB
      [
        'Oct 10, 2026',
        'Boat',
        '田中 花子',
        'Ryan, 田中 花子',
        'RM 12.00\nTHB 120.00\n1 THB = 0.1 MYR',
      ],
      ['Oct 12, 2026', 'Hotel', 'Ryan', 'Ryan 40.00, 田中 花子 20.00', 'RM 60.00'],
    ]);
    expect(balances.head).toEqual([['Person', 'Paid', 'Share', 'Balance']]);
    expect(balances.body).toEqual([
      ['Ryan', 'RM 60.00', 'RM 91.00', '−RM 31.00'],
      ['田中 花子', 'RM 102.00', 'RM 71.00', '+RM 31.00'],
    ]);
    expect(transfers.head).toEqual([['From', 'To', 'Amount', 'Pay with']]);
    expect(transfers.body).toEqual([['Ryan', '田中 花子', 'RM 31.00', 'DuitNow: 012-345 6789']]);
  });

  test('numbers every page once the tables have run over several', async () => {
    // The items table runs on to two more pages
    autoTable.mockImplementationOnce((doc: { addPage: () => void }) => {
      doc.addPage();
      doc.addPage();
    });
    await makePdf(exportRows(trip), OCT_16);
    const footer = calls.filter(
      ([m, text]) => m === 'setPage' || (m === 'text' && /^Page /.test(String(text))),
    );
    expect(footer.map(([m, a]) => [m, a])).toEqual([
      ['setPage', 1],
      ['text', 'Page 1 of 3'],
      ['setPage', 2],
      ['text', 'Page 2 of 3'],
      ['setPage', 3],
      ['text', 'Page 3 of 3'],
    ]);
    expect(texts()).toContain('Splitfoolish · 日本旅行');
  });

  test('of a split with nothing in it yet says so, with no tables', async () => {
    await makePdf(exportRows(source([])), OCT_16);
    expect(autoTable).not.toHaveBeenCalled();
    expect(texts()).toContain('No items yet.');
    expect(texts()).toContain('Nothing to settle yet.');
    expect(texts()).not.toContain('Balances');
  });

  test('lists payments made in a table of their own, only when there are any', async () => {
    const paid: SplitPayment = {
      id: 'p',
      from: hanako,
      to: ryan,
      amount: 20,
      itemId: 'h',
      notes: null,
      createdAt: Date.UTC(2026, 9, 13, 12),
      original: null,
    };
    await makePdf(exportRows(source(trip.items, [ryan, hanako], [paid])), OCT_16);
    expect(texts()).toContain('Payments');
    const payments = tables()[3];
    expect(payments.head).toEqual([['Date', 'Paid by', 'Paid to', 'For', 'Amount']]);
    expect(payments.body).toEqual([
      [expect.stringContaining('13'), hanako.name, 'Ryan', 'Hotel', 'RM 20.00'],
    ]);
  });

  test('when everyone is even, says they are settled up', async () => {
    const even = source([
      item({ id: 'a', name: 'Lunch', cost: 20, payer: ryan }),
      item({ id: 'b', name: 'Coffee', cost: 20 }),
    ]);
    await makePdf(exportRows(even), OCT_16);
    expect(tables()).toHaveLength(2);
    expect(texts()).toContain('Everyone is settled up.');
  });
});
