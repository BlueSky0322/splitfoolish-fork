import { ActionIcon, Button } from '@mantine/core';
import { Check, X } from '@phosphor-icons/react';
import { useMySplits } from '../../my-splits/useMySplits';
import SplitAvatar from '../common/SplitAvatar';
import { describeInvite, linkedInviteId, useAnswerInvite } from './invite-answers';
import { InviteRowsSkeleton } from './HomeSkeletons';
import classes from './MobileHome.module.css';

/** The Invites tab on phones (10f): splits you're invited to, and people asking to join yours */
const MobileInvites = () => {
  const { invites, error } = useMySplits();
  const { busy, respond } = useAnswerInvite();
  const highlight = linkedInviteId();
  const asksToJoin = invites?.some((i) => i.kind === 'request') ?? false;

  return (
    <div className={classes.page}>
      <h1 className={classes.title}>Invites</h1>
      {error && <div className="sf-negative">{error}</div>}
      {invites == null && error == null && <InviteRowsSkeleton phone />}
      {invites?.length === 0 && (
        <p className="sf-muted text-center py-10">
          No invites right now. Open a share link from a split to get one.
        </p>
      )}
      {invites != null && invites.length > 0 && (
        <div className={classes.group}>
          {invites.map((invite) => {
            const { title, meta } = describeInvite(invite, { short: true });
            const verb = invite.kind === 'request' ? 'Approve' : 'Accept';
            return (
              <div
                key={invite.id}
                className={classes.inviteRow}
                data-highlight={invite.id === highlight || undefined}
              >
                <SplitAvatar
                  splitId={invite.splitId}
                  name={invite.splitName}
                  size={44}
                />
                <div className="min-w-0 flex-1">
                  <div className={classes.rowName}>{title}</div>
                  <div className={classes.rowMeta}>{meta}</div>
                </div>
                {invite.kind === 'sent' ? (
                  <Button
                    variant="default"
                    disabled={busy != null}
                    onClick={() => respond(invite, false)}
                  >
                    Withdraw
                  </Button>
                ) : (
                  <>
                    <ActionIcon
                      variant="default"
                      size={44}
                      radius="xl"
                      aria-label={`Decline ${title}`}
                      disabled={busy != null}
                      onClick={() => respond(invite, false)}
                    >
                      <X size={18} />
                    </ActionIcon>
                    <ActionIcon
                      variant="outline"
                      size={44}
                      radius="xl"
                      aria-label={`${verb} ${title}`}
                      loading={busy === invite.id}
                      disabled={busy != null && busy !== invite.id}
                      onClick={() => respond(invite, true)}
                    >
                      <Check size={18} />
                    </ActionIcon>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className={classes.helper}>
        Accepting adds you to the split. Declining tells the sender.
        {asksToJoin && ' Approving someone lets them into your split.'} Invites expire after 14
        days.
      </p>
    </div>
  );
};

export default MobileInvites;
