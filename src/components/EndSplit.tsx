import { Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { SignOut, Trash } from '@phosphor-icons/react';
import { api } from '../api';
import { reloadHomeData, updateHomeData } from '../hooks/useHomeData';
import { navigate } from '../hooks/useRoute';
import classes from './SplitMembers.module.css';

interface EndSplitProps {
  splitId: string;
  name: string;
  isOwner: boolean;
  myEmail: string;
  onCancel: () => void;
}

/** 3d's title: a red-tinted icon beside "Delete this split?" (or "Leave this split?") */
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
    updateHomeData((data) => ({ splits: data.splits?.filter((s) => s.id !== splitId) }));
    navigate('');
    (isOwner ? api.deleteSplit(splitId) : api.removeMember(splitId, myEmail))
      .then(() => reloadHomeData())
      .catch((err) => {
        notifications.show({
          color: 'red',
          message:
            err instanceof Error
              ? err.message
              : `Could not ${isOwner ? 'delete' : 'leave'} the split`,
        });
        void reloadHomeData();
      });
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
