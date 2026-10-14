import { Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';
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
        reloadHomeData();
      });
  };

  return (
    <div
      className={classes.confirm}
      role="alertdialog"
      aria-label={isOwner ? 'Delete split?' : 'Leave split?'}
    >
      <p className="text-sm">
        {isOwner
          ? `Delete "${name}" for everyone? Its items and photos go too. This can't be undone.`
          : `Leave "${name}"? You'll need the share link to get back in.`}
      </p>
      <div className="flex gap-2 justify-end">
        <Button
          variant="default"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          color="red"
          onClick={end}
        >
          {isOwner ? 'Delete for everyone' : 'Leave split'}
        </Button>
      </div>
    </div>
  );
};

export default EndSplit;
