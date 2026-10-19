import { type ReactNode, createContext, useContext } from 'react';
import type { Attachment } from '@shared/api';
import type { Person } from '@shared/types';
import type { SplitTotals } from '../../split/derive';
import type { SplitItem, SplitMeta } from '../../split/state';
import type { MetaChanges, SyncStatus } from '../../split/state';
import type { usePhotos } from '../../split/usePhotos';
import type { Prefill } from './useConvertPrefill';
import type { DeleteConfirmation } from './items/delete-items';

// What the split page has loaded and worked out, for the components on it to read
// rather than have it handed down through each one in between. The bill itself (people
// and items) is in SplitStateContext, and the changes to it in SplitActionsContext.

/** Everything the split page opens over itself: one at a time, each a sheet on phones */
export type Dialog =
  /** prefill: an amount and currency from Convert; day: added from that day's heading */
  | { kind: 'add'; prefill?: Prefill; day?: number }
  | { kind: 'edit'; item: SplitItem }
  /** An item as it stands, on phones, with Edit to open the form */
  | { kind: 'item'; itemId: string }
  | { kind: 'people'; personId?: string }
  | { kind: 'settle' }
  | { kind: 'share' }
  /** Saving the split as a CSV or a PDF */
  | { kind: 'export' }
  | { kind: 'members' }
  /** Opened from Split settings, where Cancel goes back to */
  | { kind: 'end' }
  | { kind: 'settings' }
  /** The split's menu, as a sheet on phones (computers use a dropdown) */
  | { kind: 'menu' }
  | { kind: 'currencies' }
  /** Deleting items would delete their photos too */
  | ({ kind: 'confirmDelete' } & DeleteConfirmation);

export interface SplitPage {
  splitId: string;
  myEmail: string | null;
  /** Everything about the split besides its bill; null until it has loaded */
  meta: SplitMeta | null;
  metaChanges: MetaChanges;
  /** Fetches the split's details again, after a change made elsewhere */
  refreshMeta: () => Promise<void>;
  status: SyncStatus;
  /** Changes kept on this device until they're sent */
  waiting: number;
  /** Tries a failed save again now */
  retry: () => void;
  currency: string;
  totals: SplitTotals;
  /** The person in the bill linked to the signed-in account, if anyone */
  me: Person | null;
  /** Who everyone settles up through, if anyone */
  distributorId: string | null;
  pictureVersion: number | null;
  photos: ReturnType<typeof usePhotos>;
  canRemovePhoto: (photo: Attachment) => boolean;
  openDialog: (dialog: Dialog | null) => void;
}

const SplitPageContext = createContext<SplitPage | null>(null);

export const SplitPageProvider = ({ page, children }: { page: SplitPage; children: ReactNode }) => (
  <SplitPageContext.Provider value={page}>{children}</SplitPageContext.Provider>
);

export function useSplitPage(): SplitPage {
  const value = useContext(SplitPageContext);
  if (value == null) throw new Error('useSplitPage is only for inside the split page');
  return value;
}
