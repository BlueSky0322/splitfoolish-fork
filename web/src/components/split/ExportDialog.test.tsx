// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { isoDate } from '../../split/export/rows';
import { fakeServer, item, renderApp, setupAppTests, splitDetail } from '../../testing/app';

// Exporting a split from its menu: a CSV for spreadsheets or a PDF, shared through the
// share sheet on a phone that has one for files, and downloaded otherwise

setupAppTests();

afterEach(() => {
  vi.restoreAllMocks();
  // Back to jsdom's navigator, which has no share sheet
  delete (navigator as Partial<Navigator>).canShare;
  delete (navigator as Partial<Navigator>).share;
});

/**
 * Files the page hands over: those it downloads through a link, and those it shares.
 * `share` is how the share sheet answers, on a device that has one for files.
 */
function watchFiles(share?: () => Promise<void>) {
  const saved: File[] = [];
  const shared: { files: File[]; title?: string }[] = [];
  const objects = new Map<string, File>();
  Object.assign(URL, {
    createObjectURL: vi.fn((file: File) => {
      const url = `blob:file-${objects.size}`;
      objects.set(url, file);
      return url;
    }),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    const file = objects.get(this.getAttribute('href') ?? '');
    if (file && file.name === this.download) saved.push(file);
  });
  if (share) {
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: (data: ShareData) => (data.files?.length ?? 0) > 0,
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        await share();
        shared.push({ files: data.files ?? [], title: data.title });
      },
    });
  }
  return { saved, shared };
}

/** A file's bytes as text, byte order mark included; jsdom reads files through a FileReader */
const readFile = (file: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(new TextDecoder('utf-8', { ignoreBOM: true }).decode(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(file);
  });

function trip() {
  return splitDetail('trip', [
    item({ id: 'dinner', name: 'Seafood dinner', cost: 248 }),
    item({ id: 'taxi', name: 'Taxi', cost: 30, payerId: 'ann' }),
  ]);
}

const TRIP_CSV =
  '\uFEFF' +
  'Date,Item,Category,Amount (MYR),Original currency,Original amount,Rate,Rate source,Paid by,Split mode,Ryan,Ann,Notes\r\n' +
  '2026-10-10,Seafood dinner,,248.00,,,,,Ryan,Equal,124.00,124.00,\r\n' +
  '2026-10-10,Taxi,,30.00,,,,,Ann,Equal,15.00,15.00,\r\n' +
  '\r\n' +
  'Person,Paid,Share,Balance\r\n' +
  'Ryan,248.00,139.00,109.00\r\n' +
  'Ann,30.00,139.00,-109.00\r\n' +
  '\r\n' +
  'From,To,Amount\r\n' +
  'Ann,Ryan,109.00\r\n';

/** On a computer: More, then Export */
async function openExport(server = fakeServer(trip())) {
  renderApp(server, '/?s=trip');
  const user = userEvent.setup();
  await screen.findByText('Seafood dinner');
  await user.click(screen.getAllByRole('button', { name: 'More' })[0]);
  await user.click(await screen.findByRole('menuitem', { name: 'Export' }));
  return { user, dialog: within(await screen.findByRole('dialog', { name: 'Export' })) };
}

/** On a phone: the split's menu sheet, then Export */
async function openExportOnPhone(server = fakeServer(trip())) {
  renderApp(server, '/?s=trip', { size: 'phone' });
  const user = userEvent.setup();
  const more = await screen.findByRole('button', { name: 'More' });
  await waitFor(() => expect(more.hasAttribute('disabled')).toBe(false));
  await user.click(more);
  const menu = within(await screen.findByRole('dialog'));
  const row = menu.getByRole('button', { name: /^Export/ });
  await user.click(row);
  return { user, row, dialog: within(await screen.findByRole('dialog', { name: 'Export' })) };
}

describe('exporting a split on a computer', () => {
  test.each([
    { kind: 'CSV', extension: 'csv', type: 'text/csv' },
    { kind: 'PDF', extension: 'pdf', type: 'application/pdf' },
  ])(
    '$kind downloads, even where the browser has a share sheet for files',
    async ({ kind, extension, type }) => {
      // Windows and macOS browsers can share files, but their sheet only offers to copy
      const { saved, shared } = watchFiles(() => Promise.resolve());
      const { user, dialog } = await openExport();
      await user.click(dialog.getByRole('button', { name: kind }));

      await waitFor(() => expect(saved).toHaveLength(1), { timeout: 10_000 });
      expect(saved[0].name).toBe(`trip-${isoDate(Date.now())}.${extension}`);
      expect(saved[0].type).toBe(type);
      expect(shared).toEqual([]);
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Export' })).toBeNull());
    },
    20_000,
  );

  test('PDF downloads a PDF written in the font from /fonts', async () => {
    const { saved } = watchFiles();
    const { user, dialog } = await openExport();
    await user.click(dialog.getByRole('button', { name: 'PDF' }));

    await waitFor(() => expect(saved).toHaveLength(1), { timeout: 15_000 });
    expect(saved[0].name).toBe(`trip-${isoDate(Date.now())}.pdf`);
    expect(saved[0].type).toBe('application/pdf');
    const pdf = await readFile(saved[0]);
    expect(pdf.startsWith('%PDF-')).toBe(true);
    // The font is embedded, cut down to the characters used
    expect(pdf).toContain('/BaseFont /NotoSansJP');
  }, 20_000);
});

describe('exporting a split on a phone', () => {
  test('CSV opens the share sheet with the file', async () => {
    const { saved, shared } = watchFiles(() => Promise.resolve());
    const { user, row, dialog } = await openExportOnPhone();
    expect(row.textContent).toContain('CSV for spreadsheets, or PDF');
    await user.click(dialog.getByRole('button', { name: 'CSV' }));

    await waitFor(() => expect(shared).toHaveLength(1));
    expect(saved).toEqual([]);
    const [{ files, title }] = shared;
    expect(title).toBe('Trip');
    expect(files.map((f) => [f.name, f.type])).toEqual([
      [`trip-${isoDate(Date.now())}.csv`, 'text/csv'],
    ]);
    expect(await readFile(files[0])).toBe(TRIP_CSV);
  });

  test('closing the share sheet without sharing leaves the dialog open, and saves nothing', async () => {
    const { saved, shared } = watchFiles(() =>
      Promise.reject(new DOMException('Share canceled', 'AbortError')),
    );
    const { user, dialog } = await openExportOnPhone();
    const csv = dialog.getByRole('button', { name: 'CSV' });
    await user.click(csv);

    await waitFor(() => expect(csv.hasAttribute('disabled')).toBe(false));
    expect(screen.getByRole('dialog', { name: 'Export' })).toBeTruthy();
    expect(saved).toEqual([]);
    expect(shared).toEqual([]);
  });

  test('a share sheet that fails another way downloads the file instead', async () => {
    const { saved } = watchFiles(() =>
      Promise.reject(new DOMException('No user gesture', 'NotAllowedError')),
    );
    const { user, dialog } = await openExportOnPhone();
    await user.click(dialog.getByRole('button', { name: 'CSV' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe(`trip-${isoDate(Date.now())}.csv`);
  });

  test('while amounts are being converted, export waits and says why', async () => {
    const split = trip();
    split.converting = true;
    const { saved } = watchFiles();
    const { row, dialog } = await openExportOnPhone(fakeServer(split));
    expect(row.textContent).toContain('Once amounts are converted to MYR');
    expect(dialog.getByRole('status').textContent).toBe(
      "Amounts are being converted to MYR. You can export once that's done.",
    );
    expect(dialog.getByRole('button', { name: 'CSV' }).hasAttribute('disabled')).toBe(true);
    expect(dialog.getByRole('button', { name: 'PDF' }).hasAttribute('disabled')).toBe(true);
    expect(saved).toEqual([]);
  });
});
