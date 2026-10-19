import { Fragment } from 'react';
import Key from '../ui/Key';
import ResponsiveDialog from '../ui/ResponsiveDialog';
import classes from './ShortcutsDialog.module.css';

/** Each group of shortcuts: what it does, and the keys pressed together */
const GROUPS: { title: string; keys: [label: string, keys: string[]][] }[] = [
  {
    title: 'Anywhere',
    keys: [
      ['Show shortcuts', ['?']],
      ['Collapse sidebar', ['[']],
      ['Close or cancel', ['Esc']],
    ],
  },
  {
    title: 'In a split',
    keys: [
      ['Add item', ['N']],
      ['Items tab', ['I']],
      ['Photos tab', ['P']],
      ['Share', ['S']],
    ],
  },
  {
    title: 'Items',
    keys: [
      ['Select items', ['X']],
      ['Select all', ['Ctrl', 'A']],
      ['Move selected to a day', ['D']],
      ['Delete selected', ['Del']],
    ],
  },
  {
    title: 'Photo viewer',
    keys: [
      ['Previous, next', ['←', '→']],
      ['Close viewer', ['Esc']],
    ],
  },
];

// The keyboard shortcuts on a computer, opened with "?"
const ShortcutsDialog = ({ opened, onClose }: { opened: boolean; onClose: () => void }) => (
  <ResponsiveDialog
    opened={opened}
    onClose={onClose}
    title="Keyboard shortcuts"
    width={640}
  >
    <div className={classes.groups}>
      {GROUPS.map((group) => (
        <section
          key={group.title}
          aria-label={group.title}
        >
          <h3 className={classes.title}>{group.title}</h3>
          <dl className={classes.list}>
            {group.keys.map(([label, keys]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd aria-label={keys.join(' ')}>
                  {keys.map((k) => (
                    <Key key={k}>{k}</Key>
                  ))}
                </dd>
              </Fragment>
            ))}
          </dl>
        </section>
      ))}
    </div>
    <p className={classes.footer}>
      Shortcuts don't fire while you're typing in a field. On a Mac, Ctrl is ⌘.
    </p>
  </ResponsiveDialog>
);

export default ShortcutsDialog;
