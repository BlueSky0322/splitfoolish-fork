import { ReactNode, createContext, useCallback, useContext, useState } from 'react';
import { notifications } from '@mantine/notifications';
import { newId } from '../split/useSplit';
import { startCreate } from '../offline/pending-creates';
import { removeCache, writeCache } from '../offline/cache';
import { navigate } from '../hooks/useRoute';
import { useProfile } from '../profile/ProfileContext';
import { uploadSplitPicture } from '../split/pictures';
import SplitForm, { SplitFormValues } from './split/SplitForm';
import ResponsiveDialog from './ui/ResponsiveDialog';
import type { SplitDetail, SplitSummary } from '../../../shared/api';
import { reloadHomeData, updateHomeData } from '../home-data';

// The one "New split" form, opened from the sidebar, My splits and the phone's FAB

const NewSplitContext = createContext<() => void>(() => {});

export const useOpenNewSplit = () => useContext(NewSplitContext);

const DEFAULT_CURRENCY = 'MYR';

function NewSplitForm({ onDone }: { onDone: () => void }) {
  const { profile, replace } = useProfile();

  // The split opens straight away; it's created on the server in the background
  const submit = ({ name, currency, picture }: SplitFormValues) => {
    if (profile == null) return;
    const id = newId();
    const trimmed = name;
    const now = Date.now();
    const detail: SplitDetail = {
      id,
      name: trimmed,
      currency,
      distributorId: null,
      pictureVersion: null,
      converting: false,
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
      pictureVersion: null,
      updatedAt: now,
    };

    replace({ ...profile, settings: { ...profile.settings, lastCurrency: currency } });
    updateHomeData((data) => ({ splits: [summary, ...(data.splits ?? [])] }));
    startCreate({ id, name: trimmed, currency, summary })
      .then(() => reloadHomeData())
      .catch((err) => {
        notifications.show({
          color: 'red',
          message: err instanceof Error ? err.message : 'Could not create the split',
        });
        updateHomeData((data) => ({ splits: (data.splits ?? []).filter((x) => x.id !== id) }));
        void removeCache(`split:${id}`);
        if (new URLSearchParams(window.location.search).get('s') === id) navigate('');
      });
    // The picture shows from this device while it uploads after the split is created
    if (picture instanceof File) {
      uploadSplitPicture(id, picture).catch((err) =>
        notifications.show({
          color: 'red',
          message: err instanceof Error ? err.message : 'Could not add the picture',
        }),
      );
    }
    // Shown from this copy until the server answers
    void writeCache(`split:${id}`, detail).finally(() => {
      onDone();
      navigate(`?s=${id}`);
    });
  };

  return (
    <SplitForm
      initial={{
        name: '',
        currency:
          profile?.settings.defaultCurrency ?? profile?.settings.lastCurrency ?? DEFAULT_CURRENCY,
      }}
      submitLabel="Create split"
      currencyHelp="Defaults to your last-used currency. You can change it later in split settings."
      onSubmit={submit}
      onCancel={onDone}
    />
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
