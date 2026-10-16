import type { jsPDF } from 'jspdf';
import type { UserOptions } from 'jspdf-autotable';
import { currencySymbol, formatAmount, formatMoney } from '../../utils/money';
import { describeRate } from '../../utils/rate-labels';
import { plural } from '../../utils/text';
import { dateRange } from '../derive';
import { loadFont } from './font';
import type { ExportItem, ExportRows } from './rows';

// A split as an A4 PDF to share or keep: a header with the split's name, dates and
// total, then its items, everyone's balance and who pays who, with page numbers at the
// foot of each page. jsPDF is only downloaded the first time someone makes one.

/** What the font is called inside the PDF */
export const FONT = 'NotoSansJP';
const FONT_FILE = 'NotoSansJP-subset.ttf';

/** In millimetres */
const MARGIN = 14;

type Rgb = [number, number, number];
const INK: Rgb = [31, 35, 40];
const MUTED: Rgb = [101, 109, 118];
const HEAD_FILL: Rgb = [234, 238, 242];
const STRIPE_FILL: Rgb = [247, 248, 250];
const RULE: Rgb = [208, 215, 222];

/**
 * Currency symbols the font draws besides Latin and Japanese ones. Any other symbol
 * (฿, ₱) would be blank, so those amounts show the currency's code instead.
 */
const DRAWN_SYMBOL = /^[ -~\u00A0-\u00FF₩₫€\u3000-\u30FF\uFF00-\uFFEF]+$/;

/** "RM 248.00", or "THB 248.00" where the font has no ฿ */
function money(cents: number, currency: string) {
  return DRAWN_SYMBOL.test(currencySymbol(currency))
    ? formatMoney(cents, currency)
    : `${currency} ${formatAmount(cents, currency)}`;
}

/** "+RM 53.50", or "−RM 102.50" for someone who owes */
const signed = (cents: number, currency: string) =>
  `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${money(cents, currency)}`;

const day = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Who an item is split between: names, with each one's part unless it's split evenly */
const between = (item: ExportItem, currency: string) =>
  item.between
    .map((p) =>
      item.splitMode === 'equal' ? p.name : `${p.name} ${formatAmount(p.cents, currency)}`,
    )
    .join(', ');

/** The amount, with what was paid and the rate under it when it was another currency */
function amountCell(item: ExportItem, currency: string) {
  const lines = [money(item.amountCents, currency)];
  if (item.original) {
    lines.push(money(item.original.amountCents, item.original.currency));
    if (item.original.rate != null) {
      lines.push(describeRate(item.original.rate, item.original.currency, currency));
    }
  }
  return lines.join('\n');
}

/** The rows of each table, as the PDF shows them */
function pdfTables(rows: ExportRows) {
  const { currency } = rows;
  return {
    items: rows.items.map((i) => [
      day(i.createdAt),
      i.name,
      i.paidBy,
      between(i, currency),
      amountCell(i, currency),
    ]),
    balances: rows.balances.map((b) => [
      b.name,
      money(b.paidCents, currency),
      money(b.shareCents, currency),
      signed(b.balanceCents, currency),
    ]),
    transfers: rows.transfers.map((t) => [
      t.from,
      t.to,
      money(t.amountCents, currency),
      t.payWith ?? '',
    ]),
  };
}

/** Starts downloading jsPDF and the font, so making a PDF is quick when asked for */
export function preparePdf() {
  Promise.all([import('jspdf'), import('jspdf-autotable'), loadFont()]).catch(() => {
    // Tried again, and explained, when someone makes a PDF
  });
}

export async function makePdf(rows: ExportRows, now: number): Promise<Blob> {
  const [{ jsPDF }, { autoTable }, font] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadFont(),
  ]);
  const doc: jsPDF = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  doc.addFileToVFS(FONT_FILE, font);
  doc.addFont(FONT_FILE, FONT, 'normal');
  doc.setFont(FONT, 'normal');
  doc.setProperties({ title: rows.name, creator: 'Splitfoolish' });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const width = pageWidth - 2 * MARGIN;
  const tables = pdfTables(rows);
  let y = MARGIN;

  /** Writes lines of text at `size` points, moving down past them */
  const write = (text: string, size: number, color: Rgb, gap = 1.5) => {
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, width) as string[];
    const lineHeight = (size * 1.25 * 25.4) / 72;
    for (const line of lines) {
      y += lineHeight;
      doc.text(line, MARGIN, y);
    }
    y += gap;
  };

  /** A section's title, on a new page when there's no room under it for a few rows */
  const heading = (title: string) => {
    if (y > pageHeight - MARGIN - 40) {
      doc.addPage();
      y = MARGIN;
    }
    y += 4;
    write(title, 13, INK, 2);
  };

  /** A table whose `amounts` columns line up on the right, headers included */
  const table = (amounts: number[], options: UserOptions) => {
    autoTable(doc, {
      startY: y,
      margin: { top: MARGIN, right: MARGIN, bottom: MARGIN + 6, left: MARGIN },
      theme: 'striped',
      styles: {
        font: FONT,
        fontStyle: 'normal',
        fontSize: 9,
        textColor: INK,
        cellPadding: 1.8,
        overflow: 'linebreak',
        valign: 'top',
      },
      headStyles: { font: FONT, fontStyle: 'normal', fillColor: HEAD_FILL, textColor: INK },
      alternateRowStyles: { fillColor: STRIPE_FILL },
      // A row is never split over two pages
      rowPageBreak: 'avoid',
      didParseCell: ({ cell, column }) => {
        if (amounts.includes(column.index)) cell.styles.halign = 'right';
      },
      ...options,
    });
    const last = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable;
    y = (last?.finalY ?? y) + 2;
  };

  // The header
  write(rows.name, 20, INK, 2);
  const range = dateRange(rows.items);
  write(
    [
      range,
      plural(rows.people.length, 'person', 'people'),
      `In ${rows.currency}`,
      `Total ${money(rows.totalCents, rows.currency)}`,
    ]
      .filter(Boolean)
      .join(' · '),
    10,
    MUTED,
  );
  write(`Exported ${day(now)}`, 10, MUTED, 3);
  doc.setDrawColor(...RULE);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);
  y += 2;

  heading('Items');
  if (tables.items.length === 0) {
    write('No items yet.', 10, MUTED);
  } else {
    table([4], {
      head: [['Date', 'Item', 'Paid by', 'Split between', 'Amount']],
      body: tables.items,
      columnStyles: { 0: { cellWidth: 24 }, 2: { cellWidth: 28 }, 4: { cellWidth: 38 } },
    });
  }

  if (tables.balances.length > 0) {
    heading('Balances');
    table([1, 2, 3], { head: [['Person', 'Paid', 'Share', 'Balance']], body: tables.balances });
  }

  heading('Settle up');
  if (tables.transfers.length === 0) {
    write(rows.items.length > 0 ? 'Everyone is settled up.' : 'Nothing to settle yet.', 10, MUTED);
  } else {
    table([2], { head: [['From', 'To', 'Amount', 'Pay with']], body: tables.transfers });
  }

  // Page numbers, once the number of pages is known
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    // One line, cut short if the name is long
    const [label] = doc.splitTextToSize(`Splitfoolish · ${rows.name}`, width - 30) as string[];
    doc.text(label, MARGIN, pageHeight - MARGIN / 2);
    doc.text(`Page ${page} of ${pages}`, pageWidth - MARGIN, pageHeight - MARGIN / 2, {
      align: 'right',
    });
  }

  return doc.output('blob');
}
