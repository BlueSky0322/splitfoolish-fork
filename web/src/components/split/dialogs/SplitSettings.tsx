import { Button } from '@mantine/core';
import { SignOut, Trash } from '@phosphor-icons/react';
import { api } from '../../../api';
import { uploadSplitPicture } from '../../../split/pictures';
import type { MetaChanges } from '../../../split/state';
import type { SplitFormValues } from './SplitForm';
import SplitForm from './SplitForm';
import { reloadMySplits } from '../../../my-splits/my-splits';

interface SplitSettingsProps {
  splitId: string;
  name: string;
  currency: string;
  pictureVersion: number | null;
  canEdit: boolean;
  /** Opens the delete (owner) or leave (member) confirm */
  onEnd: () => void;
  changeMeta: MetaChanges['changeMeta'];
  /** A new picture, once uploaded */
  onPictureSaved: (pictureVersion: number) => void;
  onClose: () => void;
}

// Rename a split, change its currency or picture. A new currency converts every item
// on the server, in the background.
const SplitSettings = ({
  splitId,
  name,
  currency,
  pictureVersion,
  canEdit,
  onEnd,
  changeMeta,
  onPictureSaved,
  onClose,
}: SplitSettingsProps) => {
  // Everything shows straight away; the server's copy is shown again if it refuses them
  const save = (values: SplitFormValues) => {
    onClose();
    if (values.name !== name || values.currency !== currency) {
      changeMeta(
        // A new currency converts every item, in the background
        (m) => ({
          ...m,
          name: values.name,
          currency: values.currency,
          converting: m.converting || values.currency !== currency,
        }),
        async () => {
          const { converting } = await api.updateSplit(splitId, {
            name: values.name,
            currency: values.currency,
          });
          void reloadMySplits();
          // The server knows whether there was anything to convert
          return (m) => ({ ...m, converting });
        },
        'Could not save the split settings',
      );
    }
    if (values.picture instanceof File) {
      void uploadSplitPicture(splitId, values.picture).then(
        (version) => version != null && onPictureSaved(version),
      );
    } else if (values.picture === 'remove') {
      changeMeta(
        (m) => ({ ...m, pictureVersion: null }),
        async () => void (await api.deleteSplitPicture(splitId)),
        'Could not remove the picture',
      );
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <SplitForm
        splitId={splitId}
        initial={{ name, currency, pictureVersion }}
        canEdit={canEdit}
        submitLabel="Save"
        currencyHelp="Changing it converts every item at today's rate. Items keep what was originally paid, so changing back restores them."
        onSubmit={save}
        onCancel={onClose}
      />
      <hr className="sf-rule" />
      <div className="flex flex-col gap-2">
        <Button
          variant="default"
          fullWidth
          className="sf-danger-outline"
          leftSection={canEdit ? <Trash size={16} /> : <SignOut size={16} />}
          onClick={onEnd}
        >
          {canEdit ? 'Delete split' : 'Leave split'}
        </Button>
        <p className="sf-muted text-xs">
          {canEdit
            ? 'Removes it for everyone in it, with all its items and photos.'
            : 'Takes it off your splits. You can come back if someone shares it again.'}
        </p>
      </div>
    </div>
  );
};

export default SplitSettings;
