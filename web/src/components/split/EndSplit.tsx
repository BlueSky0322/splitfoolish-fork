import { Button } from '@mantine/core';
import { SignOut, Trash } from '@phosphor-icons/react';
import { api } from '../../api';
import { navigate } from '../../hooks/useRoute';
import classes from './Split.module.css';
import { removeListedSplit, sendMySplitsChange } from '../../my-splits/my-splits';

interface EndSplitProps {
  splitId: string;
  name: string;
  isOwner: boolean;
  myEmail: string;
  onCancel: () => void;
}

/** The title: a red-tinted icon beside "Delete this split?" (or "Leave this split?") */
export const EndSplitTitle = ({ isOwner }: { isOwner: boolean }) => (
  <span className={classes.endTitle}>
    <span className={classes.endIcon}>{isOwner ? <Trash size={18} /> : <SignOut size={18} />}</span>
    {isOwner ? 'Delete this split?' : 'Leave this split?'}
  </span>
);

// Asks before the owner deletes a split, or someone else leaves it. Either way the
// split goes from their list straight away and the server catches up.
const EndSplit = ({ splitId, name, isOwner, myEmail, onCancel }: EndSplitProps) => {
  const end = () => {
    removeListedSplit(splitId);
    navigate('');
    void sendMySplitsChange(
      () => (isOwner ? api.deleteSplit(splitId) : api.removeMember(splitId, myEmail)),
      `Could not ${isOwner ? 'delete' : 'leave'} the split`,
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className={classes.endName}>{name}</div>
        <p className="sf-muted text-sm">
          {isOwner
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
          {isOwner ? 'Delete for everyone' : 'Leave split'}
        </Button>
      </div>
    </div>
  );
};

export default EndSplit;
