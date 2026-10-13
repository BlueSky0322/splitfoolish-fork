import { Button, CopyButton, TextInput, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Check, Copy } from '@phosphor-icons/react';
import { useState } from 'react';
import { api, inviteUrl } from '../api';
import { reloadHomeData } from '../hooks/useHomeData';
import { navigate } from '../hooks/useRoute';
import { SplitMeta } from '../hooks/useSplit';
import { nameFor } from '../profile/ProfileContext';
import UserAvatar from './ui/UserAvatar';
import classes from './SplitMembers.module.css';

interface SplitMembersProps {
  meta: SplitMeta;
  myEmail: string;
  /** Reloads members and invites after a change */
  onChange: () => Promise<void>;
  /** Shows a change straight away, before the server confirms it */
  setMeta: (update: (meta: SplitMeta | null) => SplitMeta | null) => void;
}

const shortDate = (time: number) =>
  new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' });

const showError = (err: unknown) =>
  notifications.show({
    color: 'red',
    message: err instanceof Error ? err.message : 'Something went wrong',
  });

// Sharing and members (F8): the share link, who has access, and
// deleting or leaving the split
const SplitMembers = ({ meta, myEmail, onChange, setMeta }: SplitMembersProps) => {
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const isOwner = meta.role === 'owner';

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await onChange();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  // Shown straight away; reloaded from the server if it says no
  const optimistic = (show: (m: SplitMeta) => SplitMeta, request: () => Promise<unknown>) => {
    setMeta((m) => (m ? show(m) : m));
    request().catch((err) => {
      showError(err);
      onChange();
    });
  };

  // Leaving or deleting ends access, so go home instead of reloading
  const exit = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      reloadHomeData();
      navigate('');
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {isOwner && meta.inviteToken && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2 items-end">
            <TextInput
              className="flex-1"
              readOnly
              label="Share link"
              description="Anyone who opens it and signs in can view and edit this split."
              value={inviteUrl(meta.inviteToken)}
              onFocus={(e) => e.currentTarget.select()}
            />
            <CopyButton value={inviteUrl(meta.inviteToken)}>
              {({ copied, copy }) => (
                <Button
                  variant="default"
                  onClick={copy}
                  leftSection={copied ? <Check size={16} /> : <Copy size={16} />}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              )}
            </CopyButton>
          </div>
          <UnstyledButton
            className={`${classes.textAction} self-start`}
            disabled={busy}
            onClick={() => run(() => api.resetInvite(meta.id))}
          >
            Reset link (the old one stops working)
          </UnstyledButton>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <h6 className="sf-label">People with access</h6>
        <div className={classes.rows}>
          {meta.members.map((m) => (
            <div
              key={m.email}
              className={classes.row}
            >
              <UserAvatar
                name={nameFor(m.email, m.displayName)}
                email={m.email}
                avatarVersion={m.avatarVersion}
                size={30}
                preview
              />
              <div className="min-w-0 flex-1">
                <div className={classes.email}>
                  {m.displayName ? `${m.displayName} · ${m.email}` : m.email}
                  {m.email === myEmail && <span className="sf-muted"> (you)</span>}
                </div>
                <div className={classes.role}>{m.role === 'owner' ? 'Owner' : 'Editor'}</div>
              </div>
              {isOwner && m.role !== 'owner' && (
                <UnstyledButton
                  className={classes.textAction}
                  disabled={busy}
                  aria-label={`Remove ${m.email}`}
                  onClick={() =>
                    optimistic(
                      (x) => ({ ...x, members: x.members.filter((y) => y.email !== m.email) }),
                      () => api.removeMember(meta.id, m.email),
                    )
                  }
                >
                  Remove
                </UnstyledButton>
              )}
            </div>
          ))}
          {meta.invites?.map((i) => (
            <div
              key={i.id}
              className={classes.row}
            >
              <UserAvatar
                name={i.email}
                size={30}
              />
              <div className="min-w-0 flex-1">
                <div className={classes.email}>{i.email}</div>
                <div className={classes.role}>Invited · expires {shortDate(i.expiresAt)}</div>
              </div>
              <UnstyledButton
                className={classes.textAction}
                disabled={busy}
                aria-label={`Revoke invite for ${i.email}`}
                onClick={() =>
                  optimistic(
                    (x) => ({ ...x, invites: x.invites?.filter((y) => y.id !== i.id) }),
                    () => api.revokeInvite(meta.id, i.id),
                  )
                }
              >
                Revoke
              </UnstyledButton>
            </div>
          ))}
        </div>
      </div>

      {confirmEnd ? (
        <div
          className={classes.confirm}
          role="alertdialog"
          aria-label={isOwner ? 'Delete split?' : 'Leave split?'}
        >
          <p className="text-sm">
            {isOwner
              ? `Delete "${meta.name}" for everyone? Its items and photos go too. This can't be undone.`
              : `Leave "${meta.name}"? You'll need a new invite to get back in.`}
          </p>
          <div className="flex gap-2 justify-end">
            <Button
              variant="default"
              onClick={() => setConfirmEnd(false)}
            >
              Cancel
            </Button>
            <Button
              color="red"
              loading={busy}
              onClick={() =>
                exit(() =>
                  isOwner ? api.deleteSplit(meta.id) : api.removeMember(meta.id, myEmail),
                )
              }
            >
              {isOwner ? 'Delete for everyone' : 'Leave split'}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="default"
          disabled={busy}
          onClick={() => setConfirmEnd(true)}
        >
          {isOwner ? 'Delete split for everyone' : 'Leave split'}
        </Button>
      )}
    </div>
  );
};

export default SplitMembers;
