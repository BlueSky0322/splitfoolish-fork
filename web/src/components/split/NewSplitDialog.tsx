import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useState } from 'react';
import { navigate } from '../../hooks/useRoute';
import { useProfile } from '../../profile/ProfileContext';
import { uploadSplitPicture } from '../../split/pictures';
import type { SplitFormValues } from './SplitForm';
import SplitForm from './SplitForm';
import ResponsiveDialog from '../ui/ResponsiveDialog';
import { createSplit } from '../../my-splits/my-splits';
import { homeCurrency } from '../../utils/money';

// The one "New split" form, opened from the sidebar, My splits and the phone's FAB

const NewSplitContext = createContext<() => void>(() => {});

export const useOpenNewSplit = () => useContext(NewSplitContext);

function NewSplitForm({ onDone }: { onDone: () => void }) {
  const { profile, replace } = useProfile();

  // The split opens straight away; it's created on the server in the background
  const submit = ({ name, currency, picture }: SplitFormValues) => {
    if (profile == null) return;
    replace({ ...profile, settings: { ...profile.settings, lastCurrency: currency } });
    const { id, shown } = createSplit(profile, { name, currency }, (gone) => {
      if (new URLSearchParams(window.location.search).get('s') === gone) navigate('');
    });
    // The picture shows from this device while it uploads after the split is created
    if (picture instanceof File) void uploadSplitPicture(id, picture);
    void shown.finally(() => {
      onDone();
      navigate(`?s=${id}`);
    });
  };

  return (
    <SplitForm
      initial={{
        name: '',
        currency: homeCurrency(profile?.settings),
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
