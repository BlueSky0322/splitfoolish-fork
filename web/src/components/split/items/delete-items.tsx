import { Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import type { SplitActions } from '../../../split/actions';
import type { SplitItem } from '../../../split/state';
import { toApiItem } from '../../../split/state';
import { plural } from '../../../utils/text';

interface DeleteDeps {
  actions: SplitActions;
  /** An item's photos */
  photosOf: (itemId: string) => unknown[];
  /** The server deletes an item's photos with it; this drops them here too */
  forgetItemAttachments: (itemId: string) => void;
  /** Asks first, when photos would go too */
  confirm: (confirmation: DeleteConfirmation) => void;
}

/** Asking before items go with their photos */
export interface DeleteConfirmation {
  /** "Dinner", or "3 items" */
  label: string;
  photoCount: number;
  remove: () => void;
}

/** Deletes items; `confirmed` when photos going too was asked about already */
export type DeleteItems = (
  items: SplitItem[],
  options?: { confirmed?: boolean; onDeleted?: () => void },
) => void;

/**
 * Deleting one item or several. Without photos it happens at once, with Undo; photos
 * go with their item and can't be brought back, so then it asks first (unless that was
 * asked already, as the item form does).
 */
export function makeDeleteItems({
  actions,
  photosOf,
  forgetItemAttachments,
  confirm,
}: DeleteDeps): DeleteItems {
  return (items, { confirmed = false, onDeleted = () => {} } = {}) => {
    if (items.length === 0) return;
    const photoCount = items.reduce((n, i) => n + photosOf(i.id).length, 0);
    const label = items.length === 1 ? items[0].name : plural(items.length, 'item');

    const remove = () => {
      const removed = items.filter((item) => actions.removeItem(item.id));
      if (removed.length === 0) return;
      for (const item of removed) forgetItemAttachments(item.id);
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
    confirm({ label, photoCount, remove });
  };
}
