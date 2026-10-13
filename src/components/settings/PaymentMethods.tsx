import { ActionIcon, Autocomplete, Button, TextInput, UnstyledButton } from '@mantine/core';
import { PencilSimple, Plus, Trash } from '@phosphor-icons/react';
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
}

function MethodForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: PaymentMethod;
  onSave: (method: { type: string; detail: string }) => void;
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
      <div className="flex justify-end gap-2">
        <Button
          variant="default"
          onClick={onCancel}
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
const PaymentMethods = ({ methods, preferredId, onChange }: PaymentMethodsProps) => {
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  const save = async ({ type, detail }: { type: string; detail: string }) => {
    const next =
      editing === 'new'
        ? [...methods, { id: newId(), type, detail }]
        : methods.map((m) => (m.id === editing ? { ...m, type, detail } : m));
    // The first one added is preferred until another is picked
    const preferred = preferredId ?? next[0]?.id ?? null;
    if (await onChange(next, preferred)) setEditing(null);
  };

  const remove = (id: string) => {
    const next = methods.filter((m) => m.id !== id);
    onChange(next, preferredId === id ? next[0]?.id ?? null : preferredId);
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex flex-col gap-2"
        role="radiogroup"
        aria-label="Preferred payment method"
      >
        {methods.map((m) =>
          editing === m.id ? (
            <MethodForm
              key={m.id}
              initial={m}
              onSave={save}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div
              key={m.id}
              className={classes.method}
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
                  <span className={classes.methodType}>
                    {m.type}
                    {m.id === preferredId && <span className={classes.preferred}>Preferred</span>}
                  </span>
                  <span className={classes.methodDetail}>{m.detail}</span>
                </span>
              </UnstyledButton>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`Edit ${m.type}`}
                onClick={() => setEditing(m.id)}
              >
                <PencilSimple size={16} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`Remove ${m.type}`}
                onClick={() => remove(m.id)}
              >
                <Trash size={16} />
              </ActionIcon>
            </div>
          ),
        )}
      </div>
      {editing === 'new' ? (
        <MethodForm
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      ) : (
        methods.length < MAX_METHODS && (
          <Button
            variant="subtle"
            className="self-start"
            leftSection={<Plus size={16} />}
            onClick={() => setEditing('new')}
          >
            Add method
          </Button>
        )
      )}
    </div>
  );
};

export default PaymentMethods;
