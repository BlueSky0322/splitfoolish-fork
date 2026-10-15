import { Autocomplete, Button, Loader, Select, TextInput, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Camera, Image, PencilSimple, Plus, QrCode, UploadSimple } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { api, paymentQrUrl } from '../../api';
import {
  BANK_TRANSFER,
  COMMON_BANKS,
  MAX_ACCOUNT_NAME,
  MAX_BANK,
  MAX_METHOD_DETAIL,
  MAX_METHOD_TYPE,
  PAYMENT_TYPES,
  QR_CODE,
  needsDetail,
  MAX_METHODS,
  type PaymentMethod,
} from '../../../../shared/payments';
import { newId } from '../../split/useSplit';
import { prepareQrCode } from '../../utils/image';
import { isQr, methodLine, methodName } from '../../utils/payments';
import classes from './Settings.module.css';

const OTHER = 'Other';

/** What the details field asks for, by type */
const DETAIL_LABELS: Record<string, { label: string; placeholder: string }> = {
  'DuitNow': { label: 'Phone number or DuitNow ID', placeholder: '012-345 6789' },
  [BANK_TRANSFER]: { label: 'Account number', placeholder: '5140 1234 5678' },
  "Touch 'n Go eWallet": { label: 'Phone number', placeholder: '012-345 6789' },
  'PayNow': { label: 'Phone number or UEN', placeholder: '+65 9123 4567' },
  'PayPal': { label: 'Email or PayPal.me link', placeholder: 'paypal.me/you' },
};
const DEFAULT_DETAIL = { label: 'Details', placeholder: 'How to pay you' };

interface PaymentMethodsProps {
  methods: PaymentMethod[];
  preferredId: string | null;
  onChange: (methods: PaymentMethod[], preferredId: string | null) => Promise<boolean>;
  /** On phones the list is one grouped card */
  grouped: boolean;
  /** Already inside a card: the list runs edge to edge without one of its own */
  bare?: boolean;
}

/** A QR code picked on this device, ready to upload */
interface PickedQr {
  blob: Blob;
  url: string;
  fileName: string;
  cropped: boolean;
}

/** The picture of a QR code method (7a, 7b): empty with ways to add one, or the code */
function QrField({
  existing,
  picked,
  busy,
  onPick,
  onRemove,
}: {
  existing: string | null;
  picked: PickedQr | null;
  busy: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const choose = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const src = picked?.url ?? existing;
  const inputs = (
    <>
      <input
        ref={choose}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onPick(file);
        }}
      />
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onPick(file);
        }}
      />
    </>
  );

  if (src == null) {
    return (
      <div className={classes.qrEmpty}>
        {inputs}
        <span className={classes.qrIcon}>{busy ? <Loader size={20} /> : <QrCode size={24} />}</span>
        <span className={classes.qrTitle}>Add your QR code</span>
        <span className="sf-muted text-xs">A screenshot from your banking app works</span>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <Button
            variant="default"
            size="sm"
            leftSection={<Image size={16} />}
            onClick={() => choose.current?.click()}
            disabled={busy}
          >
            Choose image
          </Button>
          <Button
            variant="default"
            size="sm"
            leftSection={<Camera size={16} />}
            onClick={() => camera.current?.click()}
            disabled={busy}
          >
            Take photo
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={classes.qrPicked}>
      {inputs}
      <div className={classes.qrTile}>
        <img
          src={src}
          alt="Your QR code"
        />
        {busy && (
          <span className={classes.qrBusy}>
            <Loader size={20} />
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <span className="truncate text-sm">{picked?.fileName ?? 'Your QR code'}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="compact-sm"
            leftSection={<UploadSimple size={14} />}
            onClick={() => choose.current?.click()}
            disabled={busy}
          >
            Replace
          </Button>
          <UnstyledButton
            className={classes.textAction + ' ' + classes.quiet}
            onClick={onRemove}
            disabled={busy}
          >
            Remove
          </UnstyledButton>
        </div>
        <span className="sf-muted text-xs">
          A screenshot from your banking app works.
          {picked?.cropped && ' We cropped it to the code.'}
        </span>
      </div>
    </div>
  );
}

function MethodForm({
  initial,
  onSave,
  onRemove,
  onCancel,
}: {
  initial?: PaymentMethod;
  onSave: (method: PaymentMethod) => Promise<void>;
  onRemove?: () => void;
  onCancel: () => void;
}) {
  // A type not on the list (saved before there was one) is edited as Other
  const listed = (PAYMENT_TYPES as readonly string[]).includes(initial?.type ?? '');
  const [kind, setKind] = useState<string>(initial ? (listed ? initial.type : OTHER) : 'DuitNow');
  const [otherType, setOtherType] = useState(initial && !listed ? initial.type : '');
  const [detail, setDetail] = useState(initial?.detail ?? '');
  const [bank, setBank] = useState(initial?.bank ?? '');
  const [accountName, setAccountName] = useState(initial?.accountName ?? '');
  // A new method's id is made here, so its QR code can be uploaded before it's saved
  const [id] = useState(() => initial?.id ?? newId());
  const [picked, setPicked] = useState<PickedQr | null>(null);
  // The saved code, until it's removed or replaced
  const [keepSaved, setKeepSaved] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(
    () => () => {
      if (picked) URL.revokeObjectURL(picked.url);
    },
    [picked],
  );

  const isBank = kind === BANK_TRANSFER;
  const qr = kind === QR_CODE;
  const type = kind === OTHER ? otherType.trim() : kind;
  const asksDetail = needsDetail(type);
  const savedQr =
    keepSaved && initial && isQr(initial) && initial.qrVersion != null
      ? paymentQrUrl(initial.id, initial.qrVersion)
      : null;
  const hasCode = picked != null || savedQr != null;
  const valid =
    type !== '' &&
    (!asksDetail || detail.trim() !== '') &&
    (!isBank || bank.trim() !== '') &&
    (!qr || hasCode);
  const detailText = DETAIL_LABELS[kind] ?? DEFAULT_DETAIL;

  const pick = async (file: File) => {
    setBusy(true);
    try {
      const { blob, cropped } = await prepareQrCode(file);
      setPicked({ blob, url: URL.createObjectURL(blob), fileName: file.name, cropped });
    } catch (err) {
      notifications.show({
        color: 'red',
        message: err instanceof Error ? err.message : 'Could not read that picture',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={classes.methodForm}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid || busy) return;
        setBusy(true);
        try {
          // The code goes up first; the method is saved with its version
          let qrVersion = qr && initial?.qrVersion != null && keepSaved ? initial.qrVersion : null;
          if (qr && picked) qrVersion = (await api.setPaymentQr(id, picked.blob)).qrVersion;
          await onSave({
            id,
            type,
            detail: asksDetail || qr ? detail.trim() : '',
            bank: isBank ? bank.trim() : null,
            accountName: isBank ? accountName.trim() || null : null,
            qrVersion,
          });
        } catch (err) {
          notifications.show({
            color: 'red',
            message: err instanceof Error ? err.message : 'Could not save the QR code',
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Select
        label="Type"
        data={[...PAYMENT_TYPES, OTHER]}
        value={kind}
        onChange={(v) => v && setKind(v)}
        allowDeselect={false}
        comboboxProps={{ withinPortal: false }}
        data-autofocus
      />
      {kind === OTHER && (
        <TextInput
          label="Method name"
          placeholder="GrabPay"
          value={otherType}
          onChange={(e) => setOtherType(e.target.value)}
          maxLength={MAX_METHOD_TYPE}
        />
      )}
      {isBank && (
        <Autocomplete
          label="Bank"
          placeholder="Maybank, or any other bank"
          data={[...COMMON_BANKS]}
          value={bank}
          onChange={setBank}
          maxLength={MAX_BANK}
          comboboxProps={{ withinPortal: false }}
        />
      )}
      {qr ? (
        <>
          <QrField
            existing={savedQr}
            picked={picked}
            busy={busy}
            onPick={(file) => void pick(file)}
            onRemove={() => {
              setPicked(null);
              setKeepSaved(false);
            }}
          />
          <TextInput
            label="Label"
            placeholder="e.g. DuitNow QR"
            description="Shown above the code, so people know which app to scan with."
            inputWrapperOrder={['label', 'input', 'description']}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            maxLength={MAX_METHOD_DETAIL}
          />
        </>
      ) : asksDetail ? (
        <TextInput
          label={detailText.label}
          placeholder={detailText.placeholder}
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          maxLength={MAX_METHOD_DETAIL}
        />
      ) : (
        <p className="sf-muted text-sm">People pay you in person; nothing else is needed.</p>
      )}
      {isBank && (
        <TextInput
          label="Account name"
          description="Optional. The name on the account, so they know it's you."
          placeholder="Ben Lim"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          maxLength={MAX_ACCOUNT_NAME}
        />
      )}
      <div className="flex gap-2">
        {onRemove && (
          <Button
            variant="subtle"
            color="red"
            onClick={onRemove}
            className="sf-danger mr-auto"
          >
            Remove
          </Button>
        )}
        <Button
          variant="default"
          onClick={onCancel}
          className={onRemove ? undefined : 'ml-auto'}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!valid}
          loading={busy && hasCode}
        >
          {initial ? 'Save' : 'Add'}
        </Button>
      </div>
    </form>
  );
}

// The ways someone can pay you, one marked preferred. People who owe you see them
// next to their transfer in Settle up.
const PaymentMethods = ({
  methods,
  preferredId,
  onChange,
  grouped,
  bare = false,
}: PaymentMethodsProps) => {
  // A method's id, or 'new' while adding one
  const [editing, setEditing] = useState<string | null>(null);

  const save = async (method: PaymentMethod) => {
    const next =
      editing === 'new'
        ? [...methods, method]
        : methods.map((m) => (m.id === editing ? method : m));
    // The first one added is preferred until another is picked
    const preferred = preferredId ?? next[0]?.id ?? null;
    if (await onChange(next, preferred)) setEditing(null);
  };

  const remove = async (id: string) => {
    const next = methods.filter((m) => m.id !== id);
    if (await onChange(next, preferredId === id ? next[0]?.id ?? null : preferredId)) {
      setEditing(null);
    }
  };

  const addButton =
    editing === 'new' ? (
      <MethodForm
        onSave={save}
        onCancel={() => setEditing(null)}
      />
    ) : (
      methods.length < MAX_METHODS && (
        <UnstyledButton
          className={grouped ? classes.addRow : classes.addLink}
          onClick={() => setEditing('new')}
        >
          <Plus size={16} />
          Add method
        </UnstyledButton>
      )
    );

  return (
    <div
      className={
        grouped ? `${classes.methodGroup} ${bare ? classes.bare : ''}` : 'flex flex-col gap-2'
      }
    >
      <div
        className={grouped ? 'contents' : 'flex flex-col gap-2'}
        role="radiogroup"
        aria-label="Preferred payment method"
      >
        {methods.map((m) =>
          editing === m.id ? (
            <MethodForm
              key={m.id}
              initial={m}
              onSave={save}
              onRemove={() => remove(m.id)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div
              key={m.id}
              className={grouped ? classes.methodRow : classes.method}
              data-selected={m.id === preferredId || undefined}
            >
              <UnstyledButton
                className={classes.methodMain}
                role="radio"
                aria-checked={m.id === preferredId}
                onClick={() => m.id !== preferredId && onChange(methods, m.id)}
              >
                <span
                  className={classes.radio}
                  aria-hidden
                />
                {isQr(m) && m.qrVersion != null && (
                  <img
                    className={classes.qrThumb}
                    src={paymentQrUrl(m.id, m.qrVersion)}
                    alt=""
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className={classes.methodType}>{isQr(m) ? methodName(m) : m.type}</span>
                  <span className={classes.methodDetail}>{methodLine(m) || 'In person'}</span>
                </span>
                {m.id === preferredId && <span className={classes.preferred}>Preferred</span>}
              </UnstyledButton>
              <UnstyledButton
                className={classes.edit}
                aria-label={`Edit ${m.type}`}
                onClick={() => setEditing(m.id)}
              >
                <PencilSimple size={16} />
              </UnstyledButton>
            </div>
          ),
        )}
      </div>
      {addButton}
    </div>
  );
};

export default PaymentMethods;
