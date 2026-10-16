import { useNetwork } from '@mantine/hooks';
import { CloudSlash, WarningCircle } from '@phosphor-icons/react';
import { useKeepingWork } from '../../offline/storage-health';
import classes from './OfflineNotice.module.css';

/**
 * Shown while there's no connection, so it's clear why nothing new is loading, or
 * while this device can't keep unsent changes, so they aren't lost by closing the app:
 * a pill floating at the bottom, or (inline, on phones) a strip at the top of the page
 */
const OfflineNotice = ({ inline = false }: { inline?: boolean }) => {
  const { online } = useNetwork();
  const keeping = useKeepingWork();
  if (online && keeping) return null;
  return (
    <div
      className={inline ? classes.strip : classes.notice}
      role="status"
    >
      {keeping ? <CloudSlash size={16} /> : <WarningCircle size={16} />}
      {keeping
        ? "Offline. Changes are kept on this device and sync when you're back."
        : "This device's storage is full or blocked. Keep the app open until your changes and photos are saved."}
    </div>
  );
};

export default OfflineNotice;
