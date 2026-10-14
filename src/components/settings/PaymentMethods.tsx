import { Autocomplete, Button, Select, TextInput, UnstyledButton } from '@mantine/core';
import { PencilSimple, Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { PaymentMethod } from '../../api';
import {
  BANK_TRANSFER,
  COMMON_BANKS,
  MAX_ACCOUNT_NAME,
  MAX_BANK,
  MAX_METHOD_DETAIL,
  MAX_METHOD_TYPE,
  PAYMENT_TYPES,
  needsDetail,
} from '../../../shared/payments';
import { newId } from '../../hooks/useSplit';
import { methodLine } from '../../utils/payments';
import classes from './Settings.module.css';

const OTHER = 'Other';
const MAX_METHODS = 10;

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
}

interface MethodValues {
  type: string;
  detail: string;
  bank: string | null;
  accountName: string | null;
}

function MethodForm({
  initial,
  onSave,
  onRemove,
  onCancel,
}: {
  initial?: PaymentMethod;
  onSave: (method: MethodValues) => void;
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

  const isBank = kind === BANK_TRANSFER;
  const type = kind === OTHER ? otherType.trim() : kind;
  const asksDetail = needsDetail(type);
  const valid =
    type !== '' && (!asksDetail || detail.trim() !== '') && (!isBank || bank.trim() !== '');
  const detailText = DETAIL_LABELS[kind] ?? DEFAULT_DETAIL;

  return (
    <form
      className={classes.methodForm}
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSave({
          type,
          detail: asksDetail ? detail.trim() : '',
          bank: isBank ? bank.trim() : null,
          accountName: isBank ? accountName.trim() || null : null,
        });
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
      {asksDetail ? (
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
        >
          {initial ? 'Save' : 'Add'}
        </Button>
      </div>
    </form>
  );
}

// The ways someone can pay you, one marked preferred. People who owe you see them
// next to their transfer in Settle up.
const PaymentMethods = ({ methods, preferredId, onChange, grouped }: PaymentMethodsProps) => {
  // A method's id, or 'new' while adding one
  const [editing, setEditing] = useState<string | null>(null);

  const save = async (values: MethodValues) => {
    const next =
      editing === 'new'
        ? [...methods, { id: newId(), ...values }]
        : methods.map((m) => (m.id === editing ? { ...m, ...values } : m));
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
    <div className={grouped ? classes.methodGroup : 'flex flex-col gap-2'}>
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
                <span className="min-w-0 flex-1">
                  <span className={classes.methodType}>{m.type}</span>
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
