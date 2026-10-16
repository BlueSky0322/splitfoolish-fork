import { toCsv } from './csv';
import { makePdf } from './pdf';
import { type ExportSource, exportFileName, exportRows } from './rows';

// Making the file someone exports a split as, from the split as this device shows it

export type ExportKind = 'csv' | 'pdf';

/** The split as a CSV or a PDF file, named for the split and the day */
export async function makeExportFile(
  kind: ExportKind,
  source: ExportSource,
  now = Date.now(),
): Promise<File> {
  const rows = exportRows(source);
  const name = exportFileName(source.name, kind, now);
  if (kind === 'csv') return new File([toCsv(rows)], name, { type: 'text/csv' });
  return new File([await makePdf(rows, now)], name, { type: 'application/pdf' });
}
