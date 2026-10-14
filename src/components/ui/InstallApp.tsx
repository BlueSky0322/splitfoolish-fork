import { Button, CloseButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { DownloadSimple, Export, PlusSquare } from '@phosphor-icons/react';
import { useState } from 'react';
import { useInstall } from '../../hooks/useInstall';
import ResponsiveDialog from './ResponsiveDialog';
import classes from './InstallApp.module.css';

// Getting people to install Splitfoolish as an app: a card on My splits they can put
// off for a while, and an App section in Settings that's always there

const DISMISSED_KEY = 'sf-install-dismissed';
/** "Not now" hides the card this long */
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

const snoozed = () => {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISSED_KEY) ?? 0) < SNOOZE_MS;
  } catch {
    return false;
  }
};

/** Safari on iPhone and iPad has no install button: the steps, with its own icons */
function IosSteps({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  return (
    <ResponsiveDialog
      opened={opened}
      onClose={onClose}
      title="Add Splitfoolish to your Home Screen"
      width={400}
    >
      <ol className={classes.steps}>
        <li>
          <span className={classes.stepIcon}>
            <Export size={18} />
          </span>
          <span>
            Tap <strong>Share</strong> in Safari's toolbar
          </span>
        </li>
        <li>
          <span className={classes.stepIcon}>
            <PlusSquare size={18} />
          </span>
          <span>
            Choose <strong>Add to Home Screen</strong>
          </span>
        </li>
        <li>
          <span className={classes.stepIcon}>
            <img
              src="/icon-192.png"
              alt=""
            />
          </span>
          <span>
            Tap <strong>Add</strong>, then open Splitfoolish from your Home Screen
          </span>
        </li>
      </ol>
    </ResponsiveDialog>
  );
}

/** Installs straight away where the browser can, else shows the iOS steps */
function useInstallAction() {
  const install = useInstall();
  const [showSteps, setShowSteps] = useState(false);
  const run = async () => {
    if (install.canPrompt) {
      if (await install.prompt()) {
        notifications.show({ message: 'Installed. Open Splitfoolish from your home screen.' });
      }
    } else if (install.ios) {
      setShowSteps(true);
    }
  };
  const steps = (
    <IosSteps
      opened={showSteps}
      onClose={() => setShowSteps(false)}
    />
  );
  return { install, run, steps };
}

/** On My splits, until it's installed or put off */
export function InstallCard() {
  const { install, run, steps } = useInstallAction();
  const [hidden, setHidden] = useState(snoozed);
  if (!install.available || hidden) return steps;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      // Hidden for this visit only
    }
    setHidden(true);
  };
  return (
    <div
      className={classes.card}
      role="region"
      aria-label="Get the app"
    >
      <img
        src="/icon-192.png"
        alt=""
        className={classes.icon}
      />
      <div className="min-w-0 flex-1">
        <div className={classes.title}>Get the Splitfoolish app</div>
        <div className={classes.body}>
          Opens from your home screen, full screen, and keeps working offline.
        </div>
        <div className={classes.actions}>
          <Button
            size="compact-md"
            leftSection={<DownloadSimple size={16} />}
            onClick={() => void run()}
          >
            {install.canPrompt ? 'Install' : 'How to install'}
          </Button>
          <Button
            variant="subtle"
            color="gray"
            size="compact-md"
            onClick={dismiss}
          >
            Not now
          </Button>
        </div>
      </div>
      <CloseButton
        size="sm"
        aria-label="Not now"
        onClick={dismiss}
        className={classes.close}
      />
      {steps}
    </div>
  );
}

/** Settings: install it, or how, or that it already is */
export function InstallField() {
  const { install, run, steps } = useInstallAction();
  if (install.installed) {
    return (
      <p className={classes.note}>
        Installed on this device. Open Splitfoolish from your home screen or app list.
      </p>
    );
  }
  if (!install.available) {
    return (
      <p className={classes.note}>
        To install, open your browser's menu and choose Install app or Add to Home screen.
      </p>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <p className={classes.note}>
        Open Splitfoolish from your home screen, full screen, and keep working offline.
      </p>
      <Button
        variant="default"
        size="compact-md"
        leftSection={<DownloadSimple size={16} />}
        onClick={() => void run()}
      >
        {install.canPrompt ? 'Install app' : 'How to install'}
      </Button>
      {steps}
    </div>
  );
}
