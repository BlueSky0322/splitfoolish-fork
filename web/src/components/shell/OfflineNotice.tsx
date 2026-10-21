import { Button } from '@mantine/core';
import { useNetwork } from '@mantine/hooks';
import { CloudSlash, SignIn, WarningCircle } from '@phosphor-icons/react';
import { useKeepingWork } from '../../offline/storage-health';
import { signIn, useProfile } from '../../profile/ProfileContext';
import classes from './OfflineNotice.module.css';

/**
 * Shown while there's no connection, so it's clear why nothing new is loading; while
 * Cloudflare Access wants them to sign in again, with the way to; or while this device
 * can't keep unsent changes, so they aren't lost by closing the app: a pill floating at
 * the bottom, or (inline, on phones) a strip at the top of the page
 */
const OfflineNotice = ({ inline = false }: { inline?: boolean }) => {
  const { online } = useNetwork();
  const keeping = useKeepingWork();
  const { signInToSync } = useProfile();
  if (online && keeping && !signInToSync) return null;
  // Offline, signing in can't work yet: say so once the connection is back
  const toSignIn = signInToSync && online;
  return (
    <div
      className={inline ? classes.strip : classes.notice}
      role="status"
    >
      {toSignIn ? (
        <SignIn size={16} />
      ) : keeping ? (
        <CloudSlash size={16} />
      ) : (
        <WarningCircle size={16} />
      )}
      {toSignIn
        ? 'Signed out. Changes are kept on this device until you sign in.'
        : keeping
          ? "Offline. Changes are kept on this device and sync when you're back."
          : "This device's storage is full or blocked. Keep the app open until your changes and photos are saved."}
      {toSignIn && (
        <Button
          size="compact-sm"
          onClick={signIn}
          className={classes.action}
        >
          Sign in
        </Button>
      )}
    </div>
  );
};

export default OfflineNotice;
