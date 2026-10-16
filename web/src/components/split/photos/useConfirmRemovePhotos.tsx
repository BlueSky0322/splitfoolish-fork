import { Button } from '@mantine/core';
import { useCallback, useState } from 'react';
import ResponsiveDialog from '../../ui/ResponsiveDialog';

/**
 * Asks before removing photos, which goes for everyone in the split and can't be
 * undone. `confirm(count, remove)` opens the question; render `dialog` alongside.
 */
export function useConfirmRemovePhotos() {
  const [asking, setAsking] = useState<{ count: number; remove: () => void } | null>(null);
  // Kept while the dialog closes, so its wording doesn't change as it fades
  const [shown, setShown] = useState({ count: 1 });
  const confirm = useCallback((count: number, remove: () => void) => {
    setAsking({ count, remove });
    setShown({ count });
  }, []);
  const cancel = () => setAsking(null);

  const dialog = (
    <ResponsiveDialog
      opened={asking != null}
      onClose={cancel}
      title={shown.count === 1 ? 'Remove this photo?' : `Remove ${shown.count} photos?`}
      width={400}
    >
      <div className="flex flex-col gap-4">
        <p className="sf-muted text-sm">
          {shown.count === 1 ? "It's" : "They're"} removed for everyone in the split. This can't be
          undone.
        </p>
        <div className="flex gap-2 justify-end">
          <Button
            variant="default"
            onClick={cancel}
          >
            Cancel
          </Button>
          <Button
            color="red"
            onClick={() => {
              asking?.remove();
              setAsking(null);
            }}
          >
            Remove
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
  return { confirm, dialog };
}
