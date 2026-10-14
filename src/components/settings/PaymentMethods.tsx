import { Autocomplete, Button, TextInput, UnstyledButton } from '@mantine/core';
import { PencilSimple, Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { PaymentMethod } from '../../api';
import { newId } from '../../hooks/useSplit';
import classes from './Settings.module.css';

const TYPES = ['DuitNow', 'Bank transfer', "Touch 'n Go eWallet", 'PayNow', 'PayPal', 'Cash'];
const MAX_METHODS = 10;

interface PaymentMethodsProps {
  methods: PaymentMethod[];
  preferredId: string | null;
  onChange: (methods: PaymentMethod[], preferredId: string | null) => Promise<boolean>;
  /** On phones the list is one grouped card */
  grouped: boolean;
}

function MethodForm({
  initial,
  onSave,
  onRemove,
  onCancel,
}: {
  initial?: PaymentMethod;
  onSave: (method: { type: string; detail: string }) => void;
  onRemove?: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState(initial?.type ?? '');
  const [detail, setDetail] = useState(initial?.detail ?? '');
  const valid = type.trim() !== '' && detail.trim() !== '';
  return (
    <form
      className={classes.methodForm}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave({ type: type.trim(), detail: detail.trim() });
      }}
    >
      <Autocomplete
        label="Type"
        placeholder="DuitNow"
        data={TYPES}
        value={type}
        onChange={setType}
        maxLength={32}
        comboboxProps={{ withinPortal: false }}
        data-autofocus
      />
      <TextInput
        label="Details"
        placeholder="012-345 6789, or bank, account number and name"
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        maxLength={120}
      />
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

  const save = async ({ type, detail }: { type: string; detail: string }) => {
    const next =
      editing === 'new'
        ? [...methods, { id: newId(), type, detail }]
        : methods.map((m) => (m.id === editing ? { ...m, type, detail } : m));
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
                  <span className={classes.methodDetail}>{m.detail}</span>
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
