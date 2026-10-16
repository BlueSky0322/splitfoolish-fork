import { Button } from '@mantine/core';
import { useState } from 'react';
import { api } from '../../../api';
import { showError } from '../../../utils/notify';
import classes from './SplitMembers.module.css';

interface ResetLinkProps {
  splitId: string;
  /** The link was reset; resolves once the new one is shown */
  onDone: () => Promise<void>;
  onCancel: () => void;
}

// Asks before the share link changes, in place under the link, so the share dialog
// stays open around it
const ResetLink = ({ splitId, onDone, onCancel }: ResetLinkProps) => {
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    setBusy(true);
    try {
      await api.resetShareLinks(splitId);
      await onDone();
    } catch (err) {
      showError(err, 'Could not reset the link');
      setBusy(false);
    }
  };

  return (
    <div
      className={classes.confirm}
      role="group"
      aria-labelledby="reset-link-title"
    >
      <p
        id="reset-link-title"
        className={classes.confirmTitle}
      >
        Reset the share link?
      </p>
      <p className={classes.help}>
        The current link stops working. People already in the split keep access.
      </p>
      <div className="flex gap-2 justify-end">
        <Button
          variant="default"
          size="xs"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          size="xs"
          loading={busy}
          onClick={() => void reset()}
        >
          Reset link
        </Button>
      </div>
    </div>
  );
};

export default ResetLink;
