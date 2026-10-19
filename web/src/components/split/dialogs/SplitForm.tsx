import { Avatar, Button, FileButton, Select, TextInput, UnstyledButton } from '@mantine/core';
import ViewablePicture from '../../ui/ViewablePicture';
import { Camera } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useIsMobile } from '../../../hooks/useBreakpoints';
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
  // Phones (10k, 10q): the code as a tag beside the currency's name, the main button at the bottom
  const isMobile = useIsMobile();
  const size = isMobile ? 64 : 56;

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
          <ViewablePicture
            src={pictureUrl}
            label="View the new picture"
          >
            <Avatar
              src={pictureUrl}
              alt=""
              size={size}
              radius={14}
            />
          </ViewablePicture>
        ) : splitId && picture !== 'remove' ? (
          <SplitAvatar
            splitId={splitId}
            name={letter}
            pictureVersion={initial.pictureVersion}
            size={size}
            preview
          />
        ) : (
          <Avatar
            size={size}
            radius={14}
            styles={{ placeholder: { background: 'var(--sf-tag)', color: 'var(--sf-text)' } }}
          >
            {isMobile && splitId == null ? <Camera size={22} /> : letter.charAt(0).toUpperCase()}
          </Avatar>
        )}
        {canEdit && (
          <div className={isMobile ? 'flex flex-col gap-1' : 'flex gap-3'}>
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
            {isMobile && !hasPicture && <span className="sf-muted text-[13px]">Optional</span>}
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
        data={isMobile ? currencies.map((c) => ({ value: c.value, label: c.detail })) : currencies}
        // Phones find a currency by its code too, which shows as a tag
        filter={
          isMobile
            ? ({ options, search }) => {
                const q = search.trim().toLowerCase();
                return options.filter(
                  (o) =>
                    'value' in o &&
                    (o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)),
                );
              }
            : undefined
        }
        leftSection={isMobile ? <span className="sf-tag font-medium">{currency}</span> : undefined}
        leftSectionWidth={isMobile ? 64 : undefined}
        value={currency}
        onChange={(v) => v && setCurrency(v)}
        disabled={!canEdit}
        description={currencyHelp}
        // Inside a dialog, so screen readers can reach the options
        comboboxProps={{ withinPortal: false }}
      />
      {!canEdit && <div className="sf-muted text-sm">Only the owner can change these.</div>}
      {isMobile ? (
        // The sheet's X closes it, so the main button gets the room
        canEdit && (
          <div className={classes.mainAction}>
            <Button
              type="submit"
              size="lg"
              fullWidth
            >
              {submitLabel}
            </Button>
          </div>
        )
      ) : (
        <div className="flex justify-end gap-2">
          <Button
            variant="default"
            onClick={onCancel}
          >
            {canEdit ? 'Cancel' : 'Close'}
          </Button>
          {canEdit && <Button type="submit">{submitLabel}</Button>}
        </div>
      )}
    </form>
  );
};

export default SplitForm;
