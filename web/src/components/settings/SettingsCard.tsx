import type { ReactNode } from 'react';
import classes from './SettingsLayout.module.css';

/** One card on a settings page: a title, a line saying what it's for, then its fields */
const SettingsCard = ({
  title,
  help,
  action,
  flush,
  children,
}: {
  title?: string;
  help?: ReactNode;
  /** Top right, beside the title */
  action?: ReactNode;
  /** Lists run to the card's edges */
  flush?: boolean;
  children: ReactNode;
}) => (
  <section
    className={classes.card}
    data-flush={flush || undefined}
  >
    {(title || action) && (
      <div className={classes.cardHead}>
        <div className="min-w-0 flex-1">
          {title && <h2 className={classes.cardTitle}>{title}</h2>}
          {help && <p className={classes.cardHelp}>{help}</p>}
        </div>
        {action}
      </div>
    )}
    {children}
  </section>
);

export default SettingsCard;
