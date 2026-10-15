import { Button } from '@mantine/core';
import { SignOut, Trash } from '@phosphor-icons/react';
import { api } from '../../../api';
import { navigate } from '../../../hooks/useRoute';
import classes from '../Split.module.css';
import { removeListedSplit, sendMySplitsChange } from '../../../my-splits/my-splits';

interface EndSplitProps {
  splitId: string;
  name: string;
  canDelete: boolean;
  myEmail: string;
  onCancel: () => void;
  /** Done, where it was asked from; otherwise it goes to My splits */
  onEnded?: () => void;
}

/** The title: a red-tinted icon beside "Delete this split?" (or "Leave this split?") */
export const EndSplitTitle = ({ canDelete }: { canDelete: boolean }) => (
  <span className={classes.endTitle}>
    <span className={classes.endIcon}>
      {canDelete ? <Trash size={18} /> : <SignOut size={18} />}
    </span>
    {canDelete ? 'Delete this split?' : 'Leave this split?'}
  </span>
);

// Asks before the owner deletes a split, or someone else leaves it. Either way the
// split goes from their list straight away and the server catches up.
const EndSplit = ({ splitId, name, canDelete, myEmail, onCancel, onEnded }: EndSplitProps) => {
  const end = () => {
    removeListedSplit(splitId);
    if (onEnded) onEnded();
    else navigate('');
    void sendMySplitsChange(
      () => (canDelete ? api.deleteSplit(splitId) : api.removeMember(splitId, myEmail)),
      `Could not ${canDelete ? 'delete' : 'leave'} the split`,
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className={classes.endName}>{name}</div>
        <p className="sf-muted text-sm">
          {canDelete
            ? "Removes it for everyone, with all items and photos. This can't be undone."
            : "You'll lose access. To come back, open the share link again."}
        </p>
      </div>
      <div className="flex gap-2 justify-end">
        <Button
          variant="default"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          variant="default"
          className="sf-danger-outline"
          onClick={end}
        >
          {canDelete ? 'Delete for everyone' : 'Leave split'}
        </Button>
      </div>
    </div>
  );
};

export default EndSplit;
