import { ActionIcon, Button, CopyButton, Loader, TextInput, Title, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import IconMinus from '~icons/tabler/minus';
import { useCallback, useEffect, useState } from 'react';
import { SplitInvite, api, invitesPageUrl, inviteUrl } from '../api';
import { navigate } from '../hooks/useRoute';
import { SplitMeta } from '../hooks/useRemoteSync';

interface SplitMembersProps {
  splitId: string;
  myEmail: string;
  onChange: () => Promise<void>;
}

// Owners send this themselves until the app can email invites
const inviteMessage = (splitName: string) =>
  `I've invited you to "${splitName}" on Splitfoolish. Sign in with this email to accept: ${invitesPageUrl()}`;

// Modal contents: invites (owner) and who has access. Loads its own copy of
// the split's sharing details, since modal contents don't re-render with the page.
const SplitMembers = ({ splitId, myEmail, onChange }: SplitMembersProps) => {
  const [meta, setMeta] = useState<SplitMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [justInvited, setJustInvited] = useState<SplitInvite | null>(null);

  const load = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { people, items, ...rest } = await api.getSplit(splitId);
    setMeta(rest);
  }, [splitId]);

  useEffect(() => {
    load().catch((err) => alert(err instanceof Error ? err.message : err));
  }, [load]);

  if (meta == null) return <Loader size="sm" />;
  const isOwner = meta.role === 'owner';

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await Promise.all([load(), onChange()]);
    } catch (err) {
      alert(err instanceof Error ? err.message : err);
    } finally {
      setBusy(false);
    }
  };

  // Leaving or deleting ends access, so go home instead of reloading
  const exit = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      modals.closeAll();
      navigate('');
    } catch (err) {
      alert(err instanceof Error ? err.message : err);
      setBusy(false);
    }
  };

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    setBusy(true);
    try {
      const invite = await api.inviteByEmail(meta.id, inviteEmail);
      setJustInvited(invite);
      setInviteEmail('');
      await load();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const leave = () => exit(() => api.removeMember(meta.id, myEmail));

  const deleteSplit = () => {
    if (!confirm(`Delete "${meta.name}" for everyone? This cannot be undone.`)) return;
    exit(() => api.deleteSplit(meta.id));
  };

  return (
    <div className="flex flex-col gap-4">
      {isOwner && (
        <form
          className="flex flex-col gap-2"
          onSubmit={sendInvite}
        >
          <Title order={5}>Invite by email</Title>
          <div className="text-xs text-gray-500">
            They'll see the invite after signing in with that email, and can accept or decline.
          </div>
          <div className="flex gap-2 items-start">
            <TextInput
              className="flex-1"
              type="email"
              placeholder="friend@example.com"
              aria-label="Email to invite"
              value={inviteEmail}
              error={inviteError}
              onChange={(e) => setInviteEmail(e.currentTarget.value)}
            />
            <Button
              type="submit"
              disabled={busy || inviteEmail.trim() === ''}
            >
              Invite
            </Button>
          </div>
          {justInvited && (
            <div className="text-xs bg-gray-50 rounded p-2 flex flex-wrap gap-2 items-center justify-between">
              <span>Invited {justInvited.email}. We don't send emails yet, so let them know:</span>
              <CopyButton value={inviteMessage(meta.name)}>
                {({ copied, copy }) => (
                  <Button
                    size="compact-xs"
                    variant="light"
                    onClick={copy}
                  >
                    {copied ? 'Copied' : 'Copy message'}
                  </Button>
                )}
              </CopyButton>
            </div>
          )}
          {meta.invites != null && meta.invites.length > 0 && (
            <ul className="flex flex-col gap-1">
              {meta.invites.map((i) => (
                <li
                  key={i.id}
                  className="flex justify-between items-center"
                >
                  <span>
                    {i.email}
                    <span className="text-xs text-gray-500">
                      {' '}
                      · invited, expires {new Date(i.expiresAt).toLocaleDateString()}
                    </span>
                  </span>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    disabled={busy}
                    aria-label={`Revoke invite for ${i.email}`}
                    onClick={() => run(() => api.revokeInvite(meta.id, i.id))}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </form>
      )}

      {isOwner && meta.inviteToken && (
        <div className="flex flex-col gap-2">
          <Title order={5}>Or share a link</Title>
          <div className="text-xs text-gray-500">
            Anyone who opens this link and signs in can view and edit this split.
          </div>
          <div className="flex gap-2">
            <TextInput
              className="flex-1"
              readOnly
              value={inviteUrl(meta.inviteToken)}
              aria-label="Invite link"
            />
            <CopyButton value={inviteUrl(meta.inviteToken)}>
              {({ copied, copy }) => (
                <Button
                  onClick={copy}
                  color={copied ? 'teal' : 'blue'}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              )}
            </CopyButton>
          </div>
          <Button
            variant="subtle"
            size="compact-sm"
            className="self-start"
            disabled={busy}
            onClick={() => run(() => api.resetInvite(meta.id))}
          >
            Reset link (the old one stops working)
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Title order={5}>People with access</Title>
        <ul className="flex flex-col gap-1">
          {meta.members.map((m) => (
            <li
              key={m.email}
              className="flex justify-between items-center"
            >
              <span>
                {m.email}
                {m.email === myEmail && ' (you)'}
                <span className="text-xs text-gray-500"> · {m.role}</span>
              </span>
              {isOwner && m.role !== 'owner' && (
                <Tooltip label="Remove access">
                  <ActionIcon
                    color="red"
                    disabled={busy}
                    aria-label={`Remove ${m.email}`}
                    onClick={() => run(() => api.removeMember(meta.id, m.email))}
                  >
                    <IconMinus />
                  </ActionIcon>
                </Tooltip>
              )}
            </li>
          ))}
        </ul>
      </div>

      {isOwner ? (
        <Button
          color="red"
          variant="light"
          disabled={busy}
          onClick={deleteSplit}
        >
          Delete split
        </Button>
      ) : (
        <Button
          color="red"
          variant="light"
          disabled={busy}
          onClick={leave}
        >
          Leave split
        </Button>
      )}
    </div>
  );
};

export default SplitMembers;
