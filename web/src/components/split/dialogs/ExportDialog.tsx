import { Button } from '@mantine/core';
import { FileCsv, FilePdf } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { type ExportKind, makeExportFile } from '../../../split/export/export';
import { preparePdf } from '../../../split/export/pdf';
import { useSplitState } from '../../../split/SplitStateContext';
import { useIsDesktop } from '../../../hooks/useBreakpoints';
import { deliverFile, saveBlob } from '../../../utils/deliver-file';
import { useSplitPage } from '../SplitPageContext';

const FAILED: Record<ExportKind, string> = {
  csv: "Couldn't make the CSV. Try again.",
  pdf: "Couldn't make the PDF. The first one needs a connection to fetch its font; try again.",
};

// Saving the split as a file: a CSV for spreadsheets or a PDF to share or keep. Made on
// this device from what's on screen, so it works offline and includes changes not yet
// saved. Phones and tablets offer to share the file; computers download it, even where
// the browser has a share sheet (Windows, macOS), which would only offer to copy it.
const ExportDialog = ({ onDone }: { onDone: () => void }) => {
  const { meta, currency, totals } = useSplitPage();
  const { people, items, payments } = useSplitState().state;
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isDesktop = useIsDesktop();

  // So the PDF is quick to make, and ready while the tap still counts for sharing it
  useEffect(() => preparePdf(), []);

  if (meta == null) return null;
  // Amounts are part way through changing currency until it's done
  const converting = meta.converting;

  const exportAs = async (kind: ExportKind) => {
    setBusy(kind);
    setError(null);
    try {
      const file = await makeExportFile(kind, {
        name: meta.name,
        currency,
        people,
        items,
        payments,
        totals,
        members: meta.members,
      });
      if (isDesktop) {
        saveBlob(file);
        onDone();
        return;
      }
      const delivery = await deliverFile(file, { title: meta.name });
      if (delivery !== 'cancelled') onDone();
    } catch {
      setError(FAILED[kind]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="sf-muted text-sm">
        Every item, each person's balance and who pays who, as this device shows them.
      </p>
      {converting && (
        <p
          className="text-sm"
          role="status"
        >
          Amounts are being converted to {currency}. You can export once that's done.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="default"
          size="lg"
          leftSection={<FileCsv size={20} />}
          disabled={converting || busy != null}
          loading={busy === 'csv'}
          onClick={() => void exportAs('csv')}
        >
          CSV
        </Button>
        <Button
          variant="default"
          size="lg"
          leftSection={<FilePdf size={20} />}
          disabled={converting || busy != null}
          loading={busy === 'pdf'}
          onClick={() => void exportAs('pdf')}
        >
          PDF
        </Button>
      </div>
      <p className="sf-muted text-xs">
        CSV opens in Excel, Numbers or Google Sheets. PDF is a summary to print or send.
      </p>
      {error && (
        <p
          className="sf-negative text-sm"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
};

export default ExportDialog;
