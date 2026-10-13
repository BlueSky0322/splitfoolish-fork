import { Button, Select, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';
import { api } from '../api';
import { reloadHomeData } from '../hooks/useHomeData';
import { navigate } from '../hooks/useRoute';
import { useProfile } from '../profile/ProfileContext';
import { listCurrencies } from '../utils/money';
import ResponsiveDialog from './ui/ResponsiveDialog';

// The one "New split" form, opened from the sidebar, My splits and the phone's FAB

const NewSplitContext = createContext<() => void>(() => {});

export const useOpenNewSplit = () => useContext(NewSplitContext);

const DEFAULT_CURRENCY = 'MYR';

function NewSplitForm({ onDone }: { onDone: () => void }) {
  const { profile, replace } = useProfile();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const currencies = useMemo(listCurrencies, []);
  const form = useForm({
    initialValues: { name: '', currency: profile?.lastCurrency ?? DEFAULT_CURRENCY },
    validate: {
      name: (value) => (value.trim() ? null : 'Give the split a name'),
      currency: (value) => (value ? null : 'Pick a currency'),
    },
  });

  const submit = form.onSubmit(async ({ name, currency }) => {
    setError(null);
    setBusy(true);
    try {
      const { id } = await api.createSplit(name.trim(), currency);
      if (profile != null) replace({ ...profile, lastCurrency: currency });
      reloadHomeData();
      onDone();
      navigate(`?s=${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the split.');
      setBusy(false);
    }
  });

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-[18px]"
    >
      <TextInput
        label="Name"
        placeholder="Langkawi trip"
        data-autofocus
        maxLength={80}
        {...form.getInputProps('name')}
      />
      <Select
        label="Currency"
        searchable
        allowDeselect={false}
        data={currencies}
        description="Defaults to your last-used currency. You can change it later in split settings."
        inputWrapperOrder={['label', 'input', 'description', 'error']}
        // Inside a dialog, so screen readers can reach the options (the dialog hides other popups)
        comboboxProps={{ withinPortal: false }}
        {...form.getInputProps('currency')}
      />
      {error && <div className="sf-negative text-sm">{error}</div>}
      <div className="flex justify-end gap-2">
        <Button
          variant="default"
          onClick={onDone}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          loading={busy}
        >
          Create split
        </Button>
      </div>
    </form>
  );
}

export function NewSplitProvider({ children }: { children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  const open = useCallback(() => setOpened(true), []);
  const close = useCallback(() => setOpened(false), []);

  return (
    <NewSplitContext.Provider value={open}>
      {children}
      <ResponsiveDialog
        opened={opened}
        onClose={close}
        title="New split"
      >
        {opened && <NewSplitForm onDone={close} />}
      </ResponsiveDialog>
    </NewSplitContext.Provider>
  );
}
