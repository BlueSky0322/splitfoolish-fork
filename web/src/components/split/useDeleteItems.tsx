import { Button } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import type { SplitActions } from '../../split/actions';
import { SplitItem, toApiItem } from '../../split/state';
import { plural } from '../../utils/text';

interface Photos {
  photosOf: (itemId: string | null) => unknown[];
  forgetItem: (itemId: string) => void;
}

/**
 * Deleting one item or several. Without photos it happens at once, with Undo; photos
 * go with their item and can't be brought back, so then it asks first (unless that was
 * asked already, as the item form does).
 */
export function useDeleteItems(actions: SplitActions, photos: Photos) {
  return (items: SplitItem[], { confirmed = false, onDeleted = () => {} } = {}) => {
    if (items.length === 0) return;
    const photoCount = items.reduce((n, i) => n + photos.photosOf(i.id).length, 0);
    const label = items.length === 1 ? items[0].name : plural(items.length, 'item');

    const remove = () => {
      const removed = items.filter((item) => actions.removeItem(item.id));
      if (removed.length === 0) return;
      for (const item of removed) photos.forgetItem(item.id);
      onDeleted();
      if (photoCount > 0) {
        notifications.show({ message: `Deleted ${label} and ${plural(photoCount, 'photo')}` });
        return;
      }
      const saved = removed.map(toApiItem);
      const id = notifications.show({
        message: (
          <div className="flex items-center justify-between gap-3">
            <span>Deleted {label}</span>
            <Button
              variant="subtle"
              size="compact-sm"
              onClick={() => {
                for (const item of saved) actions.restoreItem(item);
                notifications.hide(id);
              }}
            >
              Undo
            </Button>
          </div>
        ),
        autoClose: 6000,
      });
    };

    if (photoCount === 0 || confirmed) {
      remove();
      return;
    }
    modals.openConfirmModal({
      title: `Delete ${label}?`,
      children: (
        <p className="text-sm">
          {photoCount === 1 ? 'A photo' : `${photoCount} photos`} will be deleted too. This can't be
          undone.
        </p>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: remove,
    });
  };
}
