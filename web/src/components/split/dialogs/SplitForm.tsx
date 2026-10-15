import { Avatar, Button, FileButton, Select, TextInput, UnstyledButton } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { listCurrencies } from '../../../utils/money';
import SplitAvatar from '../../common/SplitAvatar';
import classes from './SplitForm.module.css';
import { MAX_NAME_LENGTH } from '@shared/types';

export interface SplitFormValues {
  name: string;
  currency: string;
  /** A new picture, 'remove' to take it away, or undefined to leave it as it is */
  picture?: File | 'remove';
}

interface SplitFormProps {
  /** The split being edited; absent for a new one */
  splitId?: string;
  initial: { name: string; currency: string; pictureVersion?: number | null };
  canEdit?: boolean;
  submitLabel: string;
  currencyHelp: string;
  onSubmit: (values: SplitFormValues) => void;
  onCancel: () => void;
}

// One form for New split and Split settings: a picture, the name and the currency
const SplitForm = ({
  splitId,
  initial,
  canEdit = true,
  submitLabel,
  currencyHelp,
  onSubmit,
  onCancel,
}: SplitFormProps) => {
  const [name, setName] = useState(initial.name);
  const [currency, setCurrency] = useState(initial.currency);
  const [picture, setPicture] = useState<File | 'remove' | undefined>(undefined);
  const [pictureUrl, setPictureUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currencies = useMemo(listCurrencies, []);

  useEffect(() => {
    if (!(picture instanceof File)) {
      setPictureUrl(null);
      return;
    }
    const url = URL.createObjectURL(picture);
    setPictureUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [picture]);

  const hasPicture =
    picture instanceof File || (picture !== 'remove' && Boolean(initial.pictureVersion));
  const letter = name.trim() || initial.name || '?';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Give the split a name');
      return;
    }
    onSubmit({ name: name.trim(), currency, picture });
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-[18px]"
    >
      <div className={classes.pictureRow}>
        {pictureUrl ? (
          <Avatar
            src={pictureUrl}
            alt=""
            size={56}
            radius={14}
          />
        ) : splitId && picture !== 'remove' ? (
          <SplitAvatar
            splitId={splitId}
            name={letter}
            pictureVersion={initial.pictureVersion}
            size={56}
          />
        ) : (
          <Avatar
            size={56}
            radius={14}
            styles={{ placeholder: { background: 'var(--sf-tag)', color: 'var(--sf-text)' } }}
          >
            {letter.charAt(0).toUpperCase()}
          </Avatar>
        )}
        {canEdit && (
          <div className="flex gap-3">
            <FileButton
              onChange={(file) => file && setPicture(file)}
              accept="image/*"
            >
              {(props) => (
                <UnstyledButton
                  className={classes.textAction}
                  {...props}
                >
                  {hasPicture ? 'Change picture' : 'Add picture'}
                </UnstyledButton>
              )}
            </FileButton>
            {hasPicture && (
              <UnstyledButton
                className={`${classes.textAction} ${classes.quiet}`}
                onClick={() => setPicture(initial.pictureVersion ? 'remove' : undefined)}
              >
                Remove
              </UnstyledButton>
            )}
          </div>
        )}
      </div>

      <TextInput
        label="Name"
        placeholder="Langkawi trip"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        maxLength={MAX_NAME_LENGTH}
        disabled={!canEdit}
        error={error}
        data-autofocus
      />
      <Select
        label="Currency"
        searchable
        allowDeselect={false}
        data={currencies}
        value={currency}
        onChange={(v) => v && setCurrency(v)}
        disabled={!canEdit}
        description={currencyHelp}
        // Inside a dialog, so screen readers can reach the options
        comboboxProps={{ withinPortal: false }}
      />
      {!canEdit && <div className="sf-muted text-sm">Only the owner can change these.</div>}
      <div className="flex justify-end gap-2">
        <Button
          variant="default"
          onClick={onCancel}
        >
          {canEdit ? 'Cancel' : 'Close'}
        </Button>
        {canEdit && <Button type="submit">{submitLabel}</Button>}
      </div>
    </form>
  );
};

export default SplitForm;
