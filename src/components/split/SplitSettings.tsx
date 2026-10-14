import { notifications } from '@mantine/notifications';
import { api } from '../../api';
import { reloadHomeData } from '../../hooks/useHomeData';
import { removeSplitPicture, uploadSplitPicture } from '../../split-pictures';
import SplitForm, { SplitFormValues } from './SplitForm';

interface SplitSettingsProps {
  splitId: string;
  name: string;
  currency: string;
  pictureVersion: number | null;
  canEdit: boolean;
  onSaved: (changes: {
    name?: string;
    currency?: string;
    pictureVersion?: number | null;
    converting?: boolean;
  }) => void;
  onClose: () => void;
}

const fail = (err: unknown, fallback: string) =>
  notifications.show({ color: 'red', message: err instanceof Error ? err.message : fallback });

// Rename a split, change its currency or picture. A new currency converts every item
// on the server, in the background.
const SplitSettings = ({
  splitId,
  name,
  currency,
  pictureVersion,
  canEdit,
  onSaved,
  onClose,
}: SplitSettingsProps) => {
  // Everything shows straight away; changes are put back if the server refuses them
  const save = (values: SplitFormValues) => {
    onClose();
    if (values.name !== name || values.currency !== currency) {
      // A new currency converts every item, in the background
      onSaved({
        name: values.name,
        currency: values.currency,
        ...(values.currency !== currency && { converting: true }),
      });
      api
        .updateSplit(splitId, { name: values.name, currency: values.currency })
        .then(() => reloadHomeData())
        .catch((err) => {
          onSaved({ name, currency });
          fail(err, 'Could not save the split settings');
        });
    }
    if (values.picture instanceof File) {
      uploadSplitPicture(splitId, values.picture, (v) => onSaved({ pictureVersion: v })).catch(
        (err) => fail(err, 'Could not change the picture'),
      );
    } else if (values.picture === 'remove') {
      onSaved({ pictureVersion: null });
      removeSplitPicture(splitId).catch((err) => {
        onSaved({ pictureVersion });
        fail(err, 'Could not remove the picture');
      });
    }
  };

  return (
    <SplitForm
      splitId={splitId}
      initial={{ name, currency, pictureVersion }}
      canEdit={canEdit}
      submitLabel="Save"
      currencyHelp="Changing it converts every item at today's rate. Items keep what was originally paid, so changing back restores them."
      onSubmit={save}
      onCancel={onClose}
    />
  );
};

export default SplitSettings;
