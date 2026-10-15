import { useNetwork } from '@mantine/hooks';
import { CloudSlash } from '@phosphor-icons/react';
import classes from './OfflineNotice.module.css';

/** Shown while there's no connection, so it's clear why nothing new is loading */
const OfflineNotice = () => {
  const { online } = useNetwork();
  if (online) return null;
  return (
    <div
      className={classes.notice}
      role="status"
    >
      <CloudSlash size={16} />
      Offline. Changes are kept on this device and sync when you're back.
    </div>
  );
};

export default OfflineNotice;
