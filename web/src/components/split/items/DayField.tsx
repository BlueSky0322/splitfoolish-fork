import { TextInput, UnstyledButton } from '@mantine/core';
import type { ReactNode } from 'react';
import { isPastDay, toDateInput } from '../../../utils/date-input';
import classes from './DayField.module.css';

/**
 * Which day something goes on: Today and Yesterday a tap away, or any earlier day in the
 * date input. `value` is the date input's text ("2026-10-14").
 */
export function DayField({
  value,
  onChange,
  label = 'Date',
  description,
  error,
  highlighted,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: ReactNode;
  description?: ReactNode;
  /** Shown under it; by default, when the day hasn't come yet */
  error?: ReactNode;
  /** Picked out with an accent ring, as when it came from where the person tapped */
  highlighted?: boolean;
}) {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  return (
    <div className={classes.field}>
      <TextInput
        type="date"
        label={label}
        description={description}
        value={value}
        max={toDateInput(today)}
        min="2000-01-01"
        onChange={(e) => onChange(e.target.value)}
        error={
          error ?? (value && !isPastDay(value) ? 'Pick a day that has already come' : undefined)
        }
        classNames={highlighted ? { input: classes.highlighted } : undefined}
      />
      <div className={classes.chips}>
        {(
          [
            ['Today', today],
            ['Yesterday', yesterday],
          ] as const
        ).map(([name, d]) => (
          <UnstyledButton
            key={name}
            className={classes.chip}
            data-selected={value === toDateInput(d) || undefined}
            onClick={() => onChange(toDateInput(d))}
          >
            {name}
          </UnstyledButton>
        ))}
      </div>
    </div>
  );
}
