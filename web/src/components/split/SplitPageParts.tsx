import { CloudCheck, CloudSlash } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type { Person } from '@shared/types';
import { useSplitState } from '../../split/SplitStateContext';
import { plural } from '../../utils/text';
import type { SelectionBarProps } from './items/ItemSelection';
import PersonAvatar from './PersonAvatar';
import { useSplitPage } from './SplitPageContext';
import classes from './Split.module.css';

// What the split page's desktop and phone layouts share: the pieces SplitScreen builds
// once, and the small parts both show

/** Built once by SplitScreen, and placed by each layout */
export interface SplitPageParts {
  /** The items, or what to do first when there are none */
  list: ReactNode;
  /** The balances and transfers */
  panel: ReactNode;
  /** The split's menu (People, Share, Photos...), opened from `target` */
  moreMenu: (target: ReactNode) => ReactNode;
  /** Cards or table */
  viewToggle: ReactNode;
  /** Showing one person's items, and a way back to all */
  filterChip: ReactNode;
  /** Converting, or not saved yet */
  notices: ReactNode;
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
  const { status, waiting, retry } = useSplitPage();
  const count = useSplitState().state.items.length;
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
