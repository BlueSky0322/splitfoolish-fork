import { Button, Select, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';
import { SplitDetail, SplitSummary, api } from '../api';
import { notifications } from '@mantine/notifications';
import { newId } from '../hooks/useSplit';
import { reloadHomeData, updateHomeData } from '../hooks/useHomeData';
import { trackCreate } from '../pending-creates';
import { removeCache, writeCache } from '../split-cache';
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
  const currencies = useMemo(listCurrencies, []);
  const form = useForm({
    initialValues: { name: '', currency: profile?.settings.lastCurrency ?? DEFAULT_CURRENCY },
    validate: {
      name: (value) => (value.trim() ? null : 'Give the split a name'),
      currency: (value) => (value ? null : 'Pick a currency'),
    },
  });

  // The split opens straight away; it's created on the server in the background
  const submit = form.onSubmit(({ name, currency }) => {
    if (profile == null) return;
    const id = newId();
    const trimmed = name.trim();
    const now = Date.now();
    const detail: SplitDetail = {
      id,
      name: trimmed,
      currency,
      distributorId: null,
      role: 'owner',
      members: [
        {
          email: profile.email,
          role: 'owner',
          displayName: profile.displayName,
          avatarVersion: profile.avatarVersion,
          paymentMethods: profile.paymentMethods,
        },
      ],
      invites: [],
      attachments: [],
      people: [],
      items: [],
    };
    const summary: SplitSummary = {
      id,
      name: trimmed,
      currency,
      role: 'owner',
      memberCount: 1,
      peopleCount: 0,
      totalCents: 0,
      myBalanceCents: null,
      updatedAt: now,
    };

    replace({ ...profile, settings: { ...profile.settings, lastCurrency: currency } });
    updateHomeData((data) => ({ splits: [summary, ...(data.splits ?? [])] }));
    trackCreate(id, api.createSplit(id, trimmed, currency))
      .then(() => reloadHomeData())
      .catch((err) => {
        notifications.show({
          color: 'red',
          message: err instanceof Error ? err.message : 'Could not create the split',
        });
        updateHomeData((data) => ({ splits: (data.splits ?? []).filter((x) => x.id !== id) }));
        removeCache(`split:${id}`);
        if (new URLSearchParams(window.location.search).get('s') === id) navigate('');
      });
    // Shown from this copy until the server answers
    writeCache(`split:${id}`, detail).finally(() => {
      onDone();
      navigate(`?s=${id}`);
    });
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
      <div className="flex justify-end gap-2">
        <Button
          variant="default"
          onClick={onDone}
        >
          Cancel
        </Button>
        <Button type="submit">Create split</Button>
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
