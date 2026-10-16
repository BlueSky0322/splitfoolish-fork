import { Button } from '@mantine/core';
import { useCallback, useState } from 'react';
import { countUnsentSplits } from '../../offline/sync';
import { signOut } from '../../profile/ProfileContext';
import ResponsiveDialog from '../ui/ResponsiveDialog';

/**
 * Signs out, first asking if this device has changes or photos the server hasn't got yet, since
 * signing out removes them. `askToSignOut()` starts; render `dialog` alongside.
 */
export function useConfirmSignOut() {
  const [unsent, setUnsent] = useState(0);
  const [asking, setAsking] = useState(false);

  const askToSignOut = useCallback(async () => {
    const count = await countUnsentSplits();
    if (count === 0) return signOut();
    setUnsent(count);
    setAsking(true);
  }, []);
  const cancel = () => setAsking(false);

  const dialog = (
    <ResponsiveDialog
      opened={asking}
      onClose={cancel}
      title="Sign out with unsaved changes?"
      width={400}
    >
      <div className="flex flex-col gap-4">
        <p className="sf-muted text-sm">
          {unsent === 1 ? 'A split has' : `${unsent} splits have`} changes or photos that haven't
          reached the server yet. Signing out removes them from this device. To keep them, stay
          signed in until you're online and they're saved.
        </p>
        <div className="flex gap-2 justify-end">
          <Button
            variant="default"
            onClick={cancel}
          >
            Stay signed in
          </Button>
          <Button
            color="red"
            onClick={() => {
              setAsking(false);
              void signOut();
            }}
          >
            Sign out anyway
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
  return { askToSignOut, dialog };
}
