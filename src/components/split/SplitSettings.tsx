import { Button, Select, TextInput } from '@mantine/core';
import { useMemo, useState } from 'react';
import { api } from '../../api';
import { reloadHomeData } from '../../hooks/useHomeData';
import { listCurrencies } from '../../utils/money';

interface SplitSettingsProps {
  splitId: string;
  name: string;
  currency: string;
  canEdit: boolean;
  onSaved: (changes: { name: string; currency: string }) => void;
  onClose: () => void;
}

// Rename a split or change its currency. Amounts stay as they are: changing the
// currency relabels them, it doesn't convert them.
const SplitSettings = ({
  splitId,
  name,
  currency,
  canEdit,
  onSaved,
  onClose,
}: SplitSettingsProps) => {
  const [draftName, setDraftName] = useState(name);
  const [draftCurrency, setDraftCurrency] = useState(currency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currencies = useMemo(listCurrencies, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draftName.trim();
    if (!trimmed) {
      setError('Give the split a name');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateSplit(splitId, { name: trimmed, currency: draftCurrency });
      onSaved({ name: trimmed, currency: draftCurrency });
      reloadHomeData();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the settings');
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={save}
      className="flex flex-col gap-[18px]"
    >
      <TextInput
        label="Name"
        value={draftName}
        onChange={(e) => setDraftName(e.target.value)}
        maxLength={80}
        disabled={!canEdit}
        data-autofocus
      />
      <Select
        label="Currency"
        searchable
        allowDeselect={false}
        data={currencies}
        value={draftCurrency}
        onChange={(v) => v && setDraftCurrency(v)}
        disabled={!canEdit}
        description="Changing it relabels the amounts; it doesn't convert them."
        inputWrapperOrder={['label', 'input', 'description', 'error']}
        // Inside a dialog, so screen readers can reach the options (the dialog hides other popups)
        comboboxProps={{ withinPortal: false }}
      />
      {!canEdit && <div className="sf-muted text-sm">Only the owner can change these.</div>}
      {error && <div className="sf-negative text-sm">{error}</div>}
      <div className="flex justify-end gap-2">
        <Button
          variant="default"
          onClick={onClose}
        >
          {canEdit ? 'Cancel' : 'Close'}
        </Button>
        {canEdit && (
          <Button
            type="submit"
            loading={busy}
          >
            Save
          </Button>
        )}
      </div>
    </form>
  );
};

export default SplitSettings;
