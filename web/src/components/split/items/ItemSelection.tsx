import { ActionIcon, Button, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { CalendarBlank, Check, Trash, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import type { RowSelection } from './useItemSelection';
import ResponsiveDialog from '../../ui/ResponsiveDialog';
import classes from './ItemSelection.module.css';
import { plural } from '../../../utils/text';
import { fromDateInput, isPastDay, toDateInput } from '../../../utils/date-input';

// Picking several items at once to delete them or move them to another day. Phones
// start with a long press on an item; computers with the checkbox that shows on hover.

/** The tick in front of an item: shown on hover on a computer, always while selecting */
export function RowCheck({
  id,
  name,
  selection,
}: {
  id: string;
  name: string;
  selection: RowSelection;
}) {
  const checked = selection.selected.has(id);
  return (
    <UnstyledButton
      role="checkbox"
      aria-checked={checked}
      aria-label={`Select ${name}`}
      className={classes.check}
      data-checked={checked || undefined}
      data-active={selection.active || undefined}
      onClick={(e) => {
        e.stopPropagation();
        selection.toggle(id, e.shiftKey);
      }}
    >
      {checked && (
        <Check
          size={12}
          weight="bold"
        />
      )}
    </UnstyledButton>
  );
}

export interface SelectionBarProps {
  count: number;
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  onMove: () => void;
  onDelete: () => void;
}

/** Phones: replaces the top bar while selecting */
export function MobileSelectionBar({
  count,
  total,
  onSelectAll,
  onClear,
  onMove,
  onDelete,
}: SelectionBarProps) {
  return (
    <div
      className={classes.mobileBar}
      role="toolbar"
      aria-label="Selected items"
    >
      <ActionIcon
        variant="subtle"
        color="gray"
        size={44}
        aria-label="Stop selecting"
        onClick={onClear}
      >
        <X size={20} />
      </ActionIcon>
      <span className={classes.count}>{count} selected</span>
      <Button
        variant="subtle"
        size="compact-md"
        onClick={count === total ? onClear : onSelectAll}
      >
        {count === total ? 'None' : 'All'}
      </Button>
      <ActionIcon
        variant="subtle"
        color="gray"
        size={44}
        aria-label="Change date"
        onClick={onMove}
      >
        <CalendarBlank size={20} />
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        size={44}
        aria-label={`Delete ${plural(count, 'item')}`}
        className={classes.danger}
        onClick={onDelete}
      >
        <Trash size={20} />
      </ActionIcon>
    </div>
  );
}

/** Computers: floats at the bottom of the list while picking is on */
export function DesktopSelectionBar({
  count,
  total,
  onSelectAll,
  onClear,
  onMove,
  onDelete,
}: SelectionBarProps) {
  return (
    <div className={classes.desktopDock}>
      <div
        className={classes.desktopBar}
        role="toolbar"
        aria-label="Selected items"
      >
        <span className={classes.count}>{count === 0 ? 'Pick items' : `${count} selected`}</span>
        {count < total && (
          <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            onClick={onSelectAll}
          >
            Select all {total}
          </Button>
        )}
        <span className={classes.divider} />
        <Button
          variant="subtle"
          color="gray"
          size="compact-sm"
          leftSection={<CalendarBlank size={16} />}
          onClick={onMove}
          disabled={count === 0}
        >
          Change date
        </Button>
        <Button
          variant="subtle"
          size="compact-sm"
          leftSection={<Trash size={16} />}
          className="sf-danger"
          onClick={onDelete}
          disabled={count === 0}
        >
          Delete
        </Button>
        <Tooltip label="Done (Esc)">
          <ActionIcon
            variant="subtle"
            color="gray"
            size={28}
            aria-label="Done selecting"
            onClick={onClear}
          >
            <X size={16} />
          </ActionIcon>
        </Tooltip>
      </div>
    </div>
  );
}

/** Which day to move the selected items to: today, yesterday, or any earlier day */
export function MoveDateDialog({
  opened,
  count,
  onMove,
  onClose,
}: {
  opened: boolean;
  count: number;
  onMove: (day: Date) => void;
  onClose: () => void;
}) {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const [value, setValue] = useState(toDateInput(today));
  useEffect(() => {
    if (opened) setValue(toDateInput(new Date()));
  }, [opened]);
  const day = fromDateInput(value);
  const valid = day != null && isPastDay(value);

  return (
    <ResponsiveDialog
      opened={opened}
      onClose={onClose}
      title={`Move ${plural(count, 'item')} to`}
      width={380}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onMove(day);
        }}
      >
        <div className="flex gap-2">
          {(
            [
              ['Today', today],
              ['Yesterday', yesterday],
            ] as const
          ).map(([label, d]) => (
            <UnstyledButton
              key={label}
              className={classes.chip}
              data-selected={value === toDateInput(d) || undefined}
              onClick={() => setValue(toDateInput(d))}
            >
              {label}
            </UnstyledButton>
          ))}
        </div>
        <TextInput
          type="date"
          label="Date"
          value={value}
          max={toDateInput(today)}
          min="2000-01-01"
          onChange={(e) => setValue(e.target.value)}
          error={value && !valid ? 'Pick a day that has already come' : undefined}
        />
        <p className="sf-muted text-xs">Each item keeps its time of day.</p>
        <div className="flex justify-end gap-2">
          <Button
            variant="default"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!valid}
          >
            Move
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
