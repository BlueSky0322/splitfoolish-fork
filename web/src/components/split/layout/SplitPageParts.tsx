import { Button, Menu } from '@mantine/core';
import {
  ArrowsClockwise,
  ArrowsLeftRight,
  CloudCheck,
  CloudSlash,
  Export,
  GearSix,
  Images,
  UserPlus,
  UsersThree,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type { Person } from '@shared/types';
import { otherCurrencyCount } from '../../../split/derive';
import { useSplitState } from '../../../split/SplitStateContext';
import { plural } from '../../../utils/text';
import type { SelectionBarProps } from '../items/ItemSelection';
import Skeleton from '../../ui/Skeleton';
import PersonAvatar from '../PersonAvatar';
import { useSplitPage } from '../SplitPageContext';
import classes from '../Split.module.css';

// What the split page's desktop and phone layouts share: the pieces SplitScreen builds
// once, and the small parts both show

/** Built once by SplitScreen, and placed by each layout */
export interface SplitPageParts {
  /** The items, or what to do first when there are none */
  list: ReactNode;
  /** The balances and transfers */
  panel: ReactNode;
  /** Cards or table */
  viewToggle: ReactNode;
  /** Showing one person's items, and a way back to all */
  filterChip: ReactNode;
  dialogs: ReactNode;
}

/** Picking several items at once */
export interface SelectionUi {
  active: boolean;
  start: () => void;
  clear: () => void;
  bar: SelectionBarProps;
  /** Moving the picked items to another day */
  moveDialog: ReactNode;
}

export function AvatarStack({
  people,
  size,
  max,
}: {
  people: Person[];
  size: number;
  max: number;
}) {
  const shown = people.slice(0, max);
  return (
    <div
      className={classes.avatarStack}
      data-size={size >= 30 ? 'lg' : undefined}
    >
      {shown.map((p) => (
        <PersonAvatar
          preview={false}
          key={p.id}
          person={p}
          size={size}
        />
      ))}
      {people.length > max && <span className={classes.moreCount}>+{people.length - max}</span>}
    </div>
  );
}

/** Whether changes are saved, or waiting on a connection */
export function SaveStatus() {
  const { status, waiting, retry, meta } = useSplitPage();
  const count = useSplitState().state.items.length;
  if (status === 'loading' && meta == null) {
    return (
      <div className={classes.status}>
        <Skeleton
          width={110}
          height={10}
          style={{ margin: '5px 0' }}
        />
      </div>
    );
  }
  if (status === 'offline') {
    return (
      <div className={classes.status}>
        <CloudSlash size={14} />
        {waiting === 0 ? 'Offline' : `Offline · ${plural(waiting, 'change')} waiting`}
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className={classes.status}>
        <CloudSlash size={14} />
        Not saved yet, retrying ·{' '}
        <button
          type="button"
          className={classes.linkButton}
          onClick={retry}
        >
          Retry now
        </button>
      </div>
    );
  }
  const label =
    status === 'loading'
      ? 'Loading'
      : status === 'refreshing'
        ? 'Updating'
        : status === 'saving'
          ? 'Saving'
          : 'Saved';
  return (
    <div className={classes.status}>
      <CloudCheck size={14} />
      {label} · {plural(count, 'item')}
    </div>
  );
}

/** The split's menu (People, Share, Photos, Export...), opened from `target` */
export function SplitMoreMenu({ target, onPhotos }: { target: ReactNode; onPhotos: () => void }) {
  const { meta, openDialog } = useSplitPage();
  const { state } = useSplitState();
  const photoCount = meta?.attachments.length ?? 0;
  const otherCurrencies = otherCurrencyCount(state.items);
  return (
    <Menu
      position="bottom-end"
      withinPortal
    >
      <Menu.Target>{target}</Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<UsersThree size={16} />}
          onClick={() => openDialog({ kind: 'people' })}
        >
          People
        </Menu.Item>
        <Menu.Item
          leftSection={<UserPlus size={16} />}
          onClick={() => openDialog({ kind: 'members' })}
        >
          Share split
        </Menu.Item>
        <Menu.Item
          leftSection={<Images size={16} />}
          onClick={onPhotos}
        >
          Photos
          {photoCount > 0 && <span className="sf-muted"> ({photoCount})</span>}
        </Menu.Item>
        {otherCurrencies > 0 && (
          <Menu.Item
            leftSection={<ArrowsLeftRight size={16} />}
            rightSection={<span className="sf-tag">{otherCurrencies}</span>}
            onClick={() => openDialog({ kind: 'currencies' })}
          >
            Currencies
          </Menu.Item>
        )}
        <Menu.Item
          leftSection={<Export size={16} />}
          onClick={() => openDialog({ kind: 'export' })}
        >
          Export
        </Menu.Item>
        <Menu.Item
          leftSection={<GearSix size={16} />}
          onClick={() => openDialog({ kind: 'settings' })}
        >
          Split settings
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/** Converting the split's amounts, or changes not saved yet */
export function SplitNotices() {
  const { meta, status, retry, currency } = useSplitPage();
  return (
    <>
      {meta?.converting && (
        <div
          className={classes.banner}
          role="status"
        >
          <ArrowsClockwise
            size={18}
            className="animate-spin"
          />
          <span className="flex-1">
            Converting amounts to {currency}. Items keep what was originally paid.
          </span>
        </div>
      )}
      {status === 'error' && (
        <div className={classes.banner}>
          <CloudSlash size={18} />
          <span className="flex-1">
            Couldn't save your latest changes. They're kept here and we keep retrying.
          </span>
          <Button
            variant="default"
            size="compact-sm"
            onClick={retry}
          >
            Retry now
          </Button>
        </div>
      )}
    </>
  );
}
