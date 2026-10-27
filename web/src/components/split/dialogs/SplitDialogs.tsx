import CurrenciesSheet from './CurrenciesSheet';
import EndSplit, { EndSplitTitle } from './EndSplit';
import ExportDialog from './ExportDialog';
import ItemDetail from '../items/ItemDetail';
import ItemForm from '../items/ItemForm';
import PaymentForm from '../payments/PaymentForm';
import PeopleSheet from '../people/PeopleSheet';
import ShareImage from './ShareImage';
import SplitMembers, { ShareTitle } from '../people/SplitMembers';
import SplitMenuSheet from './SplitMenuSheet';
import SplitSettings from './SplitSettings';
import ResponsiveDialog from '../../ui/ResponsiveDialog';
import { Button } from '@mantine/core';
import { useRef, useState } from 'react';
import { useIsMobile } from '../../../hooks/useBreakpoints';
import type { ItemInput, PaymentInput } from '../../../api';
import type { SplitItem } from '../../../split/state';
import { toApiItem } from '../../../split/state';
import { payBack } from '../../../split/derive';
import { useSplitState } from '../../../split/SplitStateContext';
import { useSplitActions } from '../../../split/useSplit';
import { newId } from '../../../utils/id';
import { notifications } from '@mantine/notifications';
import { type Dialog, useSplitPage } from '../SplitPageContext';
import type { DeleteItems } from '../items/delete-items';
import { canDeleteSplit, canEditSplitSettings } from '@shared/rules';
import { atTimeNow } from '../../../utils/date-input';

interface SplitDialogsProps {
  /** The one open, if any */
  dialog: Dialog | null;
  deleteItems: DeleteItems;
  /** Shows only this person's items */
  onShowItems: (personId: string) => void;
}

/** A sheet's title, with a line under it on phones */
const SheetTitle = ({ title, under }: { title: string; under?: string }) =>
  under ? (
    <span className="flex flex-col gap-0.5">
      <span>{title}</span>
      <span className="sf-muted text-[13px] font-normal truncate">{under}</span>
    </span>
  ) : (
    title
  );

// Everything the split page opens over itself
const SplitDialogs = ({ dialog, deleteItems, onShowItems }: SplitDialogsProps) => {
  const {
    splitId,
    myEmail,
    meta,
    metaChanges,
    refreshMeta,
    totals,
    currency,
    me,
    pictureVersion,
    photos,
    openDialog: setDialog,
  } = useSplitPage();
  const { state } = useSplitState();
  const actions = useSplitActions();
  const isMobile = useIsMobile();
  // What the item form has that closing it would lose; phones ask first (10d)
  const unsaved = useRef<string | null>(null);
  const [discarding, setDiscarding] = useState<string | null>(null);
  const close = () => {
    unsaved.current = null;
    setDialog(null);
  };
  /** Closes the item form, unless that would lose what's in it; then it asks */
  const closeItemForm = () => {
    if (!isMobile || unsaved.current == null) {
      close();
      return;
    }
    setDiscarding(unsaved.current);
    return false;
  };
  // The item shown, kept current with changes to it
  const shown = dialog?.kind === 'item' ? state.items.find((i) => i.id === dialog.itemId) : null;
  // The item being edited, when the item form is open for one
  const editing = dialog?.kind === 'edit' ? dialog.item : null;

  const saveItem = (input: ItemInput, newPhotos: File[], day: Date | null) => {
    if (dialog?.kind === 'edit') {
      const ok = actions.updateItem(dialog.item.id, input, day ? { day } : {});
      if (ok) close();
      return ok;
    }
    const id = newId();
    const ok = actions.addItem(input, day == null ? { id } : { id, createdAt: atTimeNow(day) });
    if (ok) {
      close();
      if (newPhotos.length > 0) void photos.upload(newPhotos, id);
    }
    return ok;
  };

  const savePayment = (input: PaymentInput) => {
    if (dialog?.kind !== 'payment') return false;
    const ok = dialog.payment
      ? actions.updatePayment(dialog.payment.id, input)
      : actions.addPayment(input);
    if (ok) close();
    return ok;
  };

  // Someone's part of the item being edited, paid back: you, if you still owe for it,
  // else the first who does; the form lets that be changed. Not offered when nobody on
  // it still owes money (see payBack).
  const recordPaymentFor = (item: SplitItem) => {
    const owing = item.participants
      .map((p) => ({ person: p, ...payBack(item, p.id, totals, state.payments) }))
      .filter((o) => o.dueCents > 0);
    if (owing.length === 0) return undefined;
    const from = owing.find((o) => o.person.id === me?.id) ?? owing[0];
    return () =>
      setDialog({
        kind: 'payment',
        prefill: {
          fromId: from.person.id,
          toId: item.payer.id,
          amountCents: from.dueCents,
          itemId: item.id,
        },
      });
  };

  // A copy of a saved item (not edits still in the form), as of its date or today.
  // Receipts stay with the original.
  const duplicateItem = (item: SplitItem, keepDate: boolean) => {
    const { id, createdAt, ...input } = toApiItem(item);
    close();
    if (actions.addItem(input, keepDate ? { createdAt } : {})) {
      notifications.show({ message: `Duplicated ${item.name}` });
    }
  };

  return (
    <>
      <ResponsiveDialog
        opened={dialog?.kind === 'add' || dialog?.kind === 'edit'}
        onClose={() => void closeItemForm()}
        onBack={closeItemForm}
        title={
          <SheetTitle
            title={dialog?.kind === 'edit' ? 'Edit item' : 'Add item'}
            // Phones say which split it's going in
            under={isMobile ? meta?.name : undefined}
          />
        }
        width={520}
      >
        {editing ? (
          <ItemForm
            key={editing.id}
            item={editing}
            onSave={saveItem}
            onDelete={() => {
              close();
              // The form has asked already when photos would go too
              deleteItems([editing], { confirmed: true });
            }}
            onDuplicate={(keepDate) => duplicateItem(editing, keepDate)}
            onRecordPayment={recordPaymentFor(editing)}
            onCancel={close}
            onDirtyChange={(u) => {
              unsaved.current = u;
            }}
          />
        ) : (
          dialog?.kind === 'add' && (
            <ItemForm
              key="new"
              initialAmount={dialog.prefill?.amount}
              initialCurrency={dialog.prefill?.currency}
              initialDay={dialog.day}
              onSave={saveItem}
              onCancel={close}
              onDirtyChange={(u) => {
                unsaved.current = u;
              }}
            />
          )
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={discarding != null}
        onClose={() => setDiscarding(null)}
        title="Discard this item?"
        floating
      >
        <p className="sf-muted text-sm mb-4">{discarding}</p>
        <div className="flex flex-col gap-2">
          <Button
            variant="default"
            size="lg"
            className="sf-danger-outline"
            onClick={() => {
              setDiscarding(null);
              close();
            }}
          >
            Discard
          </Button>
          <Button
            variant="subtle"
            color="gray"
            size="lg"
            onClick={() => setDiscarding(null)}
          >
            Keep editing
          </Button>
        </div>
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={shown != null}
        onClose={close}
        title={shown?.name}
      >
        {shown && (
          <ItemDetail
            item={shown}
            onEdit={() => setDialog({ kind: 'edit', item: shown })}
            onDuplicate={(keepDate) => duplicateItem(shown, keepDate)}
            onDelete={() => {
              close();
              deleteItems([shown]);
            }}
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
        opened={dialog?.kind === 'payment'}
        onClose={close}
        title={dialog?.kind === 'payment' && dialog.payment ? 'Edit payment' : 'Record payment'}
        width={440}
      >
        {dialog?.kind === 'payment' && (
          <PaymentForm
            key={dialog.payment?.id ?? 'new'}
            payment={dialog.payment}
            prefill={dialog.prefill}
            onSave={savePayment}
            onCancel={close}
          />
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={dialog?.kind === 'menu'}
        onClose={close}
        title={null}
      >
        {dialog?.kind === 'menu' && <SplitMenuSheet />}
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
        opened={dialog?.kind === 'export'}
        onClose={close}
        title="Export"
        width={420}
      >
        {dialog?.kind === 'export' && <ExportDialog onDone={close} />}
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
            changeMeta={metaChanges.changeMeta}
            splitId={splitId}
          />
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={dialog?.kind === 'end'}
        onClose={close}
        title={<EndSplitTitle canDelete={meta != null && canDeleteSplit(meta.role)} />}
        width={420}
      >
        {dialog?.kind === 'end' && myEmail && meta && (
          <EndSplit
            splitId={splitId}
            name={meta.name}
            canDelete={canDeleteSplit(meta.role)}
            myEmail={myEmail}
            onCancel={() => setDialog({ kind: 'settings' })}
          />
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
            onSetRate={actions.setRate}
          />
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        opened={dialog?.kind === 'confirmDelete'}
        onClose={close}
        title={dialog?.kind === 'confirmDelete' ? `Delete ${dialog.label}?` : ''}
        width={400}
      >
        {dialog?.kind === 'confirmDelete' && (
          <div className="flex flex-col gap-4">
            <p className="sf-muted text-sm">
              {dialog.photoCount === 1 ? 'A photo' : `${dialog.photoCount} photos`} will be deleted
              too. This can't be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <Button
                variant="default"
                onClick={close}
              >
                Cancel
              </Button>
              <Button
                color="red"
                onClick={() => {
                  close();
                  dialog.remove();
                }}
              >
                Delete
              </Button>
            </div>
          </div>
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
            canEdit={canEditSplitSettings(meta.role)}
            onEnd={() => setDialog({ kind: 'end' })}
            changeMeta={metaChanges.changeMeta}
            onPictureSaved={(version) => metaChanges.patchSettings({ pictureVersion: version })}
            onClose={close}
          />
        )}
      </ResponsiveDialog>
    </>
  );
};

export default SplitDialogs;
