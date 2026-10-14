import { ActionIcon, Button, CopyButton, Tooltip, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  ArrowClockwise,
  Check,
  Copy,
  LinkSimple,
  ShareNetwork,
  SignOut,
  Trash,
} from '@phosphor-icons/react';
import { api, inviteUrl } from '../api';
import { useIsMobile } from '../hooks/useBreakpoints';
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
  /** Swaps this for the reset-link confirm (3b) */
  onReset: () => void;
  /** Swaps this for the delete or leave confirm (3d) */
  onEnd: () => void;
}

const COPIED_MS = 1500;

const shortDate = (time: number) =>
  new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' });

// The link without its scheme, so more of it fits
const shortUrl = (url: string) => url.replace(/^https?:\/\//, '');

const showError = (err: unknown) =>
  notifications.show({
    color: 'red',
    message: err instanceof Error ? err.message : 'Something went wrong',
  });

/** "Share split" with the split's name under it, kept short so it never crowds the close button */
export const ShareTitle = ({ name }: { name: string }) => (
  <span className={classes.titleBlock}>
    <span>Share split</span>
    <span className={classes.titleSub}>{name}</span>
  </span>
);

// Sharing (3a desktop, 3c phone): the share link, who's in the split, who's yet to
// accept, and deleting or leaving the split
const SplitMembers = ({ meta, myEmail, onChange, setMeta, onReset, onEnd }: SplitMembersProps) => {
  const isMobile = useIsMobile();
  const isOwner = meta.role === 'owner';
  const link = meta.inviteToken ? inviteUrl(meta.inviteToken) : null;
  const invites = meta.invites ?? [];

  // Shown straight away; reloaded from the server if it says no
  const optimistic = (show: (m: SplitMeta) => SplitMeta, request: () => Promise<unknown>) => {
    setMeta((m) => (m ? show(m) : m));
    request().catch((err) => {
      showError(err);
      onChange().catch((e) => console.error(e));
    });
  };

  // The phone's share sheet where there is one; otherwise copy it
  const shareLink = async (url: string) => {
    if (navigator.share) {
      try {
        await navigator.share({ title: meta.name, url });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    await navigator.clipboard.writeText(url);
    notifications.show({ message: 'Link copied' });
  };

  const helper = <p className={classes.help}>Anyone with the link can ask to join and edit.</p>;

  return (
    <div className={classes.panel}>
      {isOwner && link && !isMobile && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className={classes.linkBox}>
              <LinkSimple
                size={16}
                className={classes.linkIcon}
              />
              <span className={classes.linkText}>{shortUrl(link)}</span>
              <CopyButton
                value={link}
                timeout={COPIED_MS}
              >
                {({ copied, copy }) => (
                  <>
                    {copied && <span className={classes.copied}>Copied</span>}
                    <Tooltip label="Copy link">
                      <ActionIcon
                        variant="subtle"
                        size={28}
                        aria-label={copied ? 'Copied' : 'Copy link'}
                        onClick={copy}
                      >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                      </ActionIcon>
                    </Tooltip>
                  </>
                )}
              </CopyButton>
            </div>
            <Tooltip label="Reset link">
              <ActionIcon
                variant="subtle"
                size={36}
                className={classes.reset}
                aria-label="Reset link"
                onClick={onReset}
              >
                <ArrowClockwise size={18} />
              </ActionIcon>
            </Tooltip>
          </div>
          {helper}
        </div>
      )}

      {isOwner && link && isMobile && (
        <div className="flex flex-col gap-2">
          <Button
            className={classes.tall}
            leftSection={<ShareNetwork size={18} />}
            onClick={() => shareLink(link)}
          >
            Share invite link
          </Button>
          <div className="flex gap-2">
            <CopyButton
              value={link}
              timeout={COPIED_MS}
            >
              {({ copied, copy }) => (
                <Button
                  variant="default"
                  className={`${classes.half} flex-1`}
                  leftSection={copied ? <Check size={16} /> : <Copy size={16} />}
                  onClick={copy}
                >
                  {copied ? 'Copied' : 'Copy link'}
                </Button>
              )}
            </CopyButton>
            <Button
              variant="default"
              className={`${classes.half} flex-1`}
              leftSection={<ArrowClockwise size={16} />}
              onClick={onReset}
            >
              Reset
            </Button>
          </div>
          {helper}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <h6 className="sf-label">People · {meta.members.length}</h6>
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
                size={isMobile ? 36 : 32}
                preview
              />
              <div className="min-w-0 flex-1">
                <div className={classes.name}>
                  {nameFor(m.email, m.displayName)}
                  {m.email === myEmail && ' (you)'}
                </div>
                <div className={classes.email}>{m.email}</div>
              </div>
              <span className="sf-tag">{m.role === 'owner' ? 'Owner' : 'Editor'}</span>
              {isOwner && m.role !== 'owner' && (
                <UnstyledButton
                  className={classes.textAction}
                  aria-label={`Remove ${nameFor(m.email, m.displayName)}`}
                  onClick={() =>
                    optimistic(
                      (x) => ({ ...x, members: x.members.filter((y) => y.email !== m.email) }),
                      // The share link changes too, so fetch the new one
                      () => api.removeMember(meta.id, m.email).then(onChange),
                    )
                  }
                >
                  Remove
                </UnstyledButton>
              )}
            </div>
          ))}
        </div>
      </div>

      {isOwner && invites.length > 0 && (
        <div className="flex flex-col gap-1">
          <h6 className="sf-label">Waiting to accept · {invites.length}</h6>
          <div className={classes.rows}>
            {invites.map((i) => (
              <div
                key={i.id}
                className={classes.row}
              >
                <UserAvatar
                  name={nameFor(i.email)}
                  size={isMobile ? 36 : 32}
                />
                <div className="min-w-0 flex-1">
                  <div className={classes.name}>{i.email}</div>
                  <div className={classes.email}>
                    Opened the link · expires {shortDate(i.expiresAt)}
                  </div>
                </div>
                <UnstyledButton
                  className={classes.textAction}
                  aria-label={`Withdraw invite for ${i.email}`}
                  onClick={() =>
                    optimistic(
                      (x) => ({ ...x, invites: x.invites?.filter((y) => y.id !== i.id) }),
                      () => api.revokeInvite(meta.id, i.id),
                    )
                  }
                >
                  Withdraw
                </UnstyledButton>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={classes.footer}>
        <Button
          variant="default"
          fullWidth
          className={`sf-danger-outline ${isMobile ? classes.tall : ''}`}
          leftSection={isOwner ? <Trash size={16} /> : <SignOut size={16} />}
          onClick={onEnd}
        >
          {isOwner ? 'Delete split' : 'Leave split'}
        </Button>
      </div>
    </div>
  );
};

export default SplitMembers;
