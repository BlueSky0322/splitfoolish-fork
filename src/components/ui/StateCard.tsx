import { ReactNode } from 'react';
import classes from './StateCard.module.css';

interface StateCardProps {
  icon: ReactNode;
  title: string;
  body?: ReactNode;
  /** The button at the bottom */
  action?: ReactNode;
  /** A small accent label above, such as "Invite link" */
  tag?: string;
}

// A whole-screen message: loading a join link, a missing split, being signed out
const StateCard = ({ icon, title, body, action, tag }: StateCardProps) => (
  <div className={classes.wrap}>
    <div
      className={classes.card}
      role="status"
    >
      {tag && <div className={classes.tag}>{tag}</div>}
      <div className={classes.icon}>{icon}</div>
      <h2 className={classes.title}>{title}</h2>
      {body && <div className={classes.body}>{body}</div>}
      {action && <div className={classes.action}>{action}</div>}
    </div>
  </div>
);

export default StateCard;
