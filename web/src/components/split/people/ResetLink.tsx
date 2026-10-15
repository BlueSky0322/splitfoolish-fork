import { Button } from '@mantine/core';
import { useState } from 'react';
import { api } from '../../../api';
import { showError } from '../../../utils/notify';

interface ResetLinkProps {
  splitId: string;
  /** Back to the share dialog, with the new link once it's made */
  onDone: () => void;
  onCancel: () => void;
}

// Confirm before the share link changes
const ResetLink = ({ splitId, onDone, onCancel }: ResetLinkProps) => {
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    setBusy(true);
    try {
      await api.resetInvite(splitId);
      onDone();
    } catch (err) {
      showError(err, 'Could not reset the link');
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="sf-muted text-sm">
        The current link stops working. People already in the split keep access.
      </p>
      <div className="flex gap-2 justify-end">
        <Button
          variant="default"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          loading={busy}
          onClick={reset}
        >
          Reset link
        </Button>
      </div>
    </div>
  );
};

export default ResetLink;
