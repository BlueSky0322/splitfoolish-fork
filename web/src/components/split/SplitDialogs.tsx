import { BalanceHero } from './BalancePanel';
import CurrenciesSheet from './CurrenciesSheet';
import EndSplit, { EndSplitTitle } from './EndSplit';
import ItemForm from './ItemForm';
import PeopleSheet from './PeopleSheet';
import ResetLink from './ResetLink';
import ShareImage from './ShareImage';
import SplitMembers, { ShareTitle } from './SplitMembers';
import SplitSettings from './SplitSettings';
import PhotoStrip from '../photos/PhotoStrip';
import ResponsiveDialog from '../ui/ResponsiveDialog';
import { ReactNode } from 'react';
import { ItemInput } from '../../api';
import { updateHomeData } from '../../home-data';
import type { SplitTotals } from '../../split/derive';
import { SplitItem, toApiItem } from '../../split/state';
import { useSplitState } from '../../split/SplitStateContext';
import { useSplitActions } from '../../split/useSplit';
import { newId } from '../../utils/id';
import { notifications } from '@mantine/notifications';
import { type Dialog, useSplitPage } from './SplitPageContext';
import type { useDeleteItems } from './useDeleteItems';

/** Under Settle up's title: how many transfers settle everyone */
const settleNote = (totals: SplitTotals) => {
  const n = totals.transfers.length;
  if (n > 0) return `${n} ${n === 1 ? 'transfer clears' : 'transfers clear'} every balance`;
  return totals.hasItems ? 'Everyone is settled up' : 'No items yet';
};

interface SplitDialogsProps {
  /** The one open, if any */
  dialog: Dialog | null;
  /** The balances and transfers, shown in Settle up */
  panel: ReactNode;
  deleteItems: ReturnType<typeof useDeleteItems>;
  /** Shows only this person's items */
  onShowItems: (personId: string) => void;
}

// Everything the split page opens over itself
const SplitDialogs = ({ dialog, panel, deleteItems, onShowItems }: SplitDialogsProps) => {
  const {
    splitId,
    myEmail,
    meta,
    metaChanges,
    refreshMeta,
    status,
    totals,
    currency,
    me,
    pictureVersion,
    photos,
    canRemovePhoto,
    openDialog: setDialog,
  } = useSplitPage();
  const { state } = useSplitState();
  const actions = useSplitActions();
  const close = () => setDialog(null);

  const saveItem = (input: ItemInput, newPhotos: File[]) => {
    if (dialog?.kind === 'edit') {
      const ok = actions.updateItem(dialog.item.id, input);
      if (ok) close();
      return ok;
    }
    const id = newId();
    const ok = actions.addItem(input, id);
    if (ok) {
      close();
      if (newPhotos.length > 0) void photos.upload(newPhotos, id);
    }
    return ok;
  };

  // A copy of a saved item (not edits still in the form), as of its date or today.
  // Receipts stay with the original.
  const duplicateItem = (item: SplitItem, keepDate: boolean) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, createdAt, ...input } = toApiItem(item);
    close();
    if (actions.addItem(input, newId(), keepDate ? createdAt : undefined)) {
      notifications.show({ message: `Duplicated ${item.name}` });
    }
  };

  return (
    <>
      <ResponsiveDialog
        opened={dialog?.kind === 'add' || dialog?.kind === 'edit'}
        onClose={close}
        title={dialog?.kind === 'edit' ? 'Edit item' : 'Add item'}
        width={520}
      >
        {(dialog?.kind === 'add' || dialog?.kind === 'edit') && (
          <ItemForm
            key={dialog.kind === 'edit' ? dialog.item.id : 'new'}
            people={state.people}
            currency={currency}
            item={dialog.kind === 'edit' ? dialog.item : undefined}
            defaultPayerId={me?.id}
            initialAmount={dialog.kind === 'add' ? dialog.prefill?.amount : undefined}
            initialCurrency={dialog.kind === 'add' ? dialog.prefill?.currency : undefined}
            splitId={splitId}
            onSave={saveItem}
            photos={dialog.kind === 'edit' ? photos.photosOf(dialog.item.id) : []}
            uploading={dialog.kind === 'edit' ? photos.uploading[dialog.item.id] ?? [] : []}
            canRemovePhoto={canRemovePhoto}
            onAddPhotos={(files) => dialog.kind === 'edit' && photos.upload(files, dialog.item.id)}
            onRemovePhoto={photos.remove}
            onDelete={
              dialog.kind === 'edit'
                ? () => {
                    close();
                    // The form has asked already when photos would go too
                    deleteItems([dialog.item], { confirmed: true });
                  }
                : undefined
            }
            onDuplicate={
              dialog.kind === 'edit'
                ? (keepDate) => duplicateItem(dialog.item, keepDate)
                : undefined
            }
            onCancel={close}
          />
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={dialog?.kind === 'people'}
        onClose={close}
        title="People"
        width={520}
      >
        {dialog?.kind === 'people' && (
          <PeopleSheet
            initialPersonId={dialog.personId}
            onShowItems={(personId) => {
              onShowItems(personId);
              close();
            }}
          />
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={dialog?.kind === 'settle'}
        onClose={close}
        title={
          <BalanceHero
            size={36}
            prefix="Settle up"
          />
        }
      >
        <div className="sf-muted text-sm mb-4">{settleNote(totals)}</div>
        {panel}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={dialog?.kind === 'share'}
        onClose={close}
        title="Share as image"
        width={520}
      >
        {dialog?.kind === 'share' && meta && (
          <ShareImage
            name={meta.name}
            currency={currency}
            people={state.people}
            items={state.items}
            totals={totals}
          />
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={dialog?.kind === 'members'}
        onClose={close}
        title={<ShareTitle name={meta?.name ?? ''} />}
        width={460}
      >
        {dialog?.kind === 'members' && myEmail && meta && (
          <SplitMembers
            meta={meta}
            myEmail={myEmail}
            onChange={refreshMeta}
            changeSharing={metaChanges.changeSharing}
            onReset={() => setDialog({ kind: 'reset' })}
          />
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={dialog?.kind === 'reset'}
        onClose={() => setDialog({ kind: 'members' })}
        title="Reset share link?"
        width={400}
      >
        {dialog?.kind === 'reset' && (
          <ResetLink
            splitId={splitId}
            onDone={() => {
              refreshMeta().catch((err) => console.error(err));
              setDialog({ kind: 'members' });
            }}
            onCancel={() => setDialog({ kind: 'members' })}
          />
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={dialog?.kind === 'end'}
        onClose={close}
        title={<EndSplitTitle isOwner={meta?.role === 'owner'} />}
        width={420}
      >
        {dialog?.kind === 'end' && myEmail && meta && (
          <EndSplit
            splitId={splitId}
            name={meta.name}
            isOwner={meta.role === 'owner'}
            myEmail={myEmail}
            onCancel={() => setDialog({ kind: 'settings' })}
          />
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={dialog?.kind === 'photos'}
        onClose={close}
        title="Photos"
        width={560}
      >
        {dialog?.kind === 'photos' && (
          <div className="flex flex-col gap-3">
            <p className="sf-muted text-sm">
              Photos of the trip or anything else for everyone in the split. Receipts for an item
              are added on the item.
            </p>
            <PhotoStrip
              splitId={splitId}
              photos={photos.photosOf(null)}
              uploading={photos.uploading[''] ?? []}
              canRemove={canRemovePhoto}
              onAdd={(files) => photos.upload(files, null)}
              onRemove={photos.remove}
              layout="gallery"
            />
          </div>
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={dialog?.kind === 'currencies'}
        onClose={close}
        title="Currencies"
        width={460}
      >
        {dialog?.kind === 'currencies' && (
          <CurrenciesSheet
            currency={currency}
            items={state.items}
            saving={status === 'saving'}
            onRefresh={actions.refreshRates}
            onSetRate={actions.setRate}
          />
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={dialog?.kind === 'settings'}
        onClose={close}
        title="Split settings"
      >
        {dialog?.kind === 'settings' && meta && (
          <SplitSettings
            splitId={splitId}
            name={meta.name}
            currency={meta.currency}
            pictureVersion={pictureVersion}
            canEdit={meta.role === 'owner'}
            onEnd={() => setDialog({ kind: 'end' })}
            onSaved={(changes) => {
              metaChanges.patchSettings(changes);
              updateHomeData((data) => ({
                splits: data.splits?.map((x) => (x.id === splitId ? { ...x, ...changes } : x)),
              }));
            }}
            onClose={close}
          />
        )}
      </ResponsiveDialog>
    </>
  );
};

export default SplitDialogs;
