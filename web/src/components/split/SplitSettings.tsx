import { Button } from '@mantine/core';
import { SignOut, Trash } from '@phosphor-icons/react';
import { api } from '../../api';
import { removeSplitPicture, uploadSplitPicture } from '../../split/pictures';
import type { SplitFormValues } from './SplitForm';
import SplitForm from './SplitForm';
import { reloadMySplits } from '../../my-splits/my-splits';
import { showError } from '../../utils/notify';

interface SplitSettingsProps {
  splitId: string;
  name: string;
  currency: string;
  pictureVersion: number | null;
  canEdit: boolean;
  /** Opens the delete (owner) or leave (member) confirm */
  onEnd: () => void;
  onSaved: (changes: {
    name?: string;
    currency?: string;
    pictureVersion?: number | null;
    converting?: boolean;
  }) => void;
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
        .then(({ converting }) => {
          // The server knows whether there was anything to convert
          onSaved({ converting });
          return reloadMySplits();
        })
        .catch((err) => {
          onSaved({ name, currency });
          showError(err, 'Could not save the split settings');
        });
    }
    if (values.picture instanceof File) {
      void uploadSplitPicture(splitId, values.picture).then(
        (version) => version != null && onSaved({ pictureVersion: version }),
      );
    } else if (values.picture === 'remove') {
      onSaved({ pictureVersion: null });
      void removeSplitPicture(splitId).then(
        // Put back after a failure (explained already)
        (removed) => removed === undefined && onSaved({ pictureVersion }),
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
