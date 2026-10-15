import { ActionIcon, Button, CopyButton, Tooltip, UnstyledButton } from '@mantine/core';
import { copyText, isShareCancelled } from '../../../utils/share';
import { ArrowClockwise, Check, Copy, LinkSimple, ShareNetwork } from '@phosphor-icons/react';
import { api, inviteUrl } from '../../../api';
import { useIsMobile } from '../../../hooks/useBreakpoints';
import type { MetaChanges } from '../../../split/state';
import type { SplitMeta } from '../../../split/state';
import { nameFor } from '../../../profile/ProfileContext';
import UserAvatar from '../../ui/UserAvatar';
import classes from './SplitMembers.module.css';
import type { SplitInvite } from '../../../../../shared/api';
import { reloadMySplits } from '../../../my-splits/my-splits';
import { canRemoveMember } from '../../../../../shared/rules';

interface SplitMembersProps {
  meta: SplitMeta;
  myEmail: string;
  /** Reloads members and invites after a change */
  onChange: () => Promise<void>;
  /** Shows a change straight away, before the server confirms it */
  changeMeta: MetaChanges['changeMeta'];
  /** Swaps this for the reset-link confirm */
  onReset: () => void;
}

const COPIED_MS = 1500;

const shortDate = (time: number) =>
  new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' });

// The link without its scheme, so more of it fits
const shortUrl = (url: string) => url.replace(/^https?:\/\//, '');

/** "Share split" with the split's name under it, kept short so it never crowds the close button */
export const ShareTitle = ({ name }: { name: string }) => (
  <span className={classes.titleBlock}>
    <span>Share split</span>
    <span className={classes.titleSub}>{name}</span>
  </span>
);

// Sharing: the share link, who's in the split, who's yet to
// accept, and deleting or leaving the split
const SplitMembers = ({ meta, myEmail, onChange, changeMeta, onReset }: SplitMembersProps) => {
  const isMobile = useIsMobile();
  const isOwner = meta.role === 'owner';
  const link = meta.shareToken ? inviteUrl(meta.shareToken) : null;
  const invites = (meta.invites ?? []).filter((i) => !i.needsApproval);
  const requests = (meta.invites ?? []).filter((i) => i.needsApproval);
  const owner = meta.members.find((m) => m.role === 'owner');
  const ownerName = owner ? nameFor(owner.email, owner.displayName) : 'the owner';

  // The phone's share sheet where there is one; otherwise copy it
  const shareLink = async (url: string) => {
    if (navigator.share) {
      try {
        await navigator.share({ title: meta.name, url });
        return;
      } catch (err) {
        if (isShareCancelled(err)) return;
      }
    }
    await copyText(url, 'Link copied');
  };

  const helper = (
    <p className={classes.help}>
      {isOwner
        ? 'Anyone with the link can ask to join and edit.'
        : `Your own link. People who open it ask ${ownerName} to let them in.`}
    </p>
  );

  const answerRequest = (invite: SplitInvite, approve: boolean) =>
    changeMeta(
      (x) => ({ ...x, invites: x.invites?.filter((y) => y.id !== invite.id) }),
      async () => {
        await (approve ? api.acceptInvite(invite.id) : api.declineInvite(invite.id));
        void reloadMySplits();
        // Approving adds them to the members list
        if (approve) await onChange();
      },
    );

  return (
    <div className={classes.panel}>
      {link && !isMobile && (
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
            {isOwner && (
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
            )}
          </div>
          {helper}
        </div>
      )}

      {link && isMobile && (
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
            {isOwner && (
              <Button
                variant="default"
                className={`${classes.half} flex-1`}
                leftSection={<ArrowClockwise size={16} />}
                onClick={onReset}
              >
                Reset
              </Button>
            )}
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
              {m.email !== myEmail &&
                canRemoveMember(m.email, { email: myEmail, role: meta.role }) && (
                  <UnstyledButton
                    className={classes.textAction}
                    aria-label={`Remove ${nameFor(m.email, m.displayName)}`}
                    onClick={() =>
                      changeMeta(
                        (x) => ({ ...x, members: x.members.filter((y) => y.email !== m.email) }),
                        // The share link changes too, so fetch the new one
                        async () => {
                          await api.removeMember(meta.id, m.email);
                          await onChange();
                        },
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

      {isOwner && requests.length > 0 && (
        <div className="flex flex-col gap-1">
          <h6 className="sf-label">Asking to join · {requests.length}</h6>
          <div className={classes.rows}>
            {requests.map((i) => (
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
                    Shared by {i.invitedByName ?? i.invitedBy} · expires {shortDate(i.expiresAt)}
                  </div>
                </div>
                <UnstyledButton
                  className={classes.textAction}
                  aria-label={`Decline ${i.email}`}
                  onClick={() => answerRequest(i, false)}
                >
                  Decline
                </UnstyledButton>
                <Button
                  size="compact-sm"
                  aria-label={`Approve ${i.email}`}
                  onClick={() => answerRequest(i, true)}
                >
                  Approve
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

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
                    changeMeta(
                      (x) => ({ ...x, invites: x.invites?.filter((y) => y.id !== i.id) }),
                      async () => void (await api.revokeInvite(meta.id, i.id)),
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
    </div>
  );
};

export default SplitMembers;
