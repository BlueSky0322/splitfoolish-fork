import { Autocomplete, Button, TextInput, UnstyledButton } from '@mantine/core';
import { CaretLeft, CaretRight, ListBullets, UserCheck, UserMinus } from '@phosphor-icons/react';
import { useState } from 'react';
import { useSplitActions } from '../../split/useSplit';
import { Person } from '../../split/state';
import { nameFor } from '../../profile/ProfileContext';
import { SplitTotals } from '../../split/derive';
import { formatMoney } from '../../utils/money';
import PersonAvatar from './PersonAvatar';
import TransferRow from './TransferRow';
import classes from './PeopleSheet.module.css';
import { MAX_NAME_LENGTH } from '../../../../shared/types';
import type { SplitInvite, SplitMember } from '../../../../shared/api';
import { showRefusal } from '../../utils/notify';
import { removeBlocker } from '../../split/rules';
import { useSplitState } from '../../split/SplitStateContext';

interface PeopleSheetProps {
  summary: SplitTotals;
  currency: string;
  myEmail: string | null;
  members: SplitMember[];
  invites: SplitInvite[];
  /** Only the owner adds, renames and removes people */
  isOwner: boolean;
  /** Opens on this person's page */
  initialPersonId?: string | null;
  onShowItems: (personId: string) => void;
}

function BalanceText({
  cents,
  currency,
  hasItems,
}: {
  cents: number;
  currency: string;
  hasItems: boolean;
}) {
  // Before anything is added nobody owes anything, but they aren't "settled" either
  if (!hasItems) return <span className={`${classes.balance} sf-muted`}>{'\u2014'}</span>;
  return (
    <span
      className={`${classes.balance} ${
        cents > 0 ? 'sf-positive' : cents < 0 ? 'sf-negative' : 'sf-muted'
      }`}
    >
      {cents === 0 ? 'Settled' : `${cents > 0 ? 'Gets' : 'Owes'} ${formatMoney(cents, currency)}`}
    </span>
  );
}

function PersonPage({
  person,
  summary,
  currency,
  myEmail,
  meId,
  isOwner,
  onBack,
  onShowItems,
}: {
  person: Person;
  summary: SplitTotals;
  currency: string;
  myEmail: string | null;
  meId: string | null;
  isOwner: boolean;
  onBack: () => void;
  onShowItems: (personId: string) => void;
}) {
  const actions = useSplitActions()!;
  const { state } = useSplitState();
  const [name, setName] = useState(person.name);
  // What removing them would do, while waiting for a yes
  const [confirming, setConfirming] = useState<{ text: string; fromItems: boolean } | null>(null);
  const byId = new Map(state.people.map((p) => [p.id, p]));
  const balance = summary.balances.get(person.id);
  const theirs = summary.transfers.filter((t) => t.fromId === person.id || t.toId === person.id);
  const itemCount = state.items.filter(
    (i) => i.payer.id === person.id || i.participants.some((p) => p.id === person.id),
  ).length;
  const isMe = myEmail != null && person.memberEmail === myEmail;
  const hasAccount = person.memberEmail != null;

  // Someone else with an account loses access along with their place in the bill
  const losesAccess = hasAccount && !isMe;

  const remove = () => {
    const plain = removeBlocker(state, person.id, false);
    // Can't go even from shared items (they paid, or it would empty an item): explain why
    const blocker = plain == null ? null : removeBlocker(state, person.id, true);
    if (blocker != null) {
      showRefusal(blocker);
      return;
    }
    if (plain == null && !losesAccess) {
      if (actions.removePerson(person.id)) onBack();
      return;
    }
    setConfirming({
      text: [
        plain && `${plain} Remove them from those items? Everyone else's shares go up to cover it.`,
        losesAccess && `They'll lose access to this split, and the share link will change.`,
      ]
        .filter(Boolean)
        .join(' '),
      fromItems: plain != null,
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <UnstyledButton
        className={classes.back}
        onClick={onBack}
      >
        <CaretLeft size={14} /> People
      </UnstyledButton>

      <div className={classes.hero}>
        <PersonAvatar
          person={person}
          size={56}
          active={isMe}
          preview
        />
        <div className="min-w-0 flex-1">
          <div className={classes.heroName}>
            {person.name}
            {isMe && <span className="sf-tag">You</span>}
          </div>
          <div className={classes.heroSub}>
            {hasAccount ? person.memberEmail : 'Guest, without an account'}
          </div>
        </div>
      </div>

      <div className={classes.stats}>
        <div>
          <div className={classes.statLabel}>Paid</div>
          <div className={classes.statValue}>{formatMoney(balance?.paidCents ?? 0, currency)}</div>
        </div>
        <div>
          <div className={classes.statLabel}>Share</div>
          <div className={classes.statValue}>{formatMoney(balance?.shareCents ?? 0, currency)}</div>
        </div>
        <div>
          <div className={classes.statLabel}>Balance</div>
          <BalanceText
            cents={balance?.balanceCents ?? 0}
            currency={currency}
            hasItems={summary.hasItems}
          />
        </div>
      </div>

      {theirs.length > 0 && (
        <div className="flex flex-col gap-2">
          {theirs.map((t) => (
            <TransferRow
              key={`${t.fromId}-${t.toId}`}
              from={byId.get(t.fromId)!}
              to={byId.get(t.toId)!}
              amountCents={t.amountCents}
              currency={currency}
            />
          ))}
        </div>
      )}

      {hasAccount ? (
        <p className="sf-muted text-sm">
          {isMe
            ? 'Your name and picture come from your Settings.'
            : 'Their name and picture come from their account.'}
        </p>
      ) : !isOwner ? (
        <p className="sf-muted text-sm">A guest, added by the owner.</p>
      ) : (
        <TextInput
          label="Name"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (!actions.renamePerson(person.id, name)) setName(person.name);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      )}

      {confirming ? (
        <div
          className={classes.confirm}
          role="alertdialog"
          aria-label={`Remove ${person.name}?`}
        >
          <p className="text-sm">{confirming.text}</p>
          <div className="flex gap-2 justify-end">
            <Button
              variant="default"
              onClick={() => setConfirming(null)}
            >
              Cancel
            </Button>
            <Button
              color="red"
              onClick={() => actions.removePerson(person.id, confirming.fromItems) && onBack()}
            >
              Remove {person.name}
            </Button>
          </div>
        </div>
      ) : (
        <div className={classes.actionList}>
          {isMe && (
            <UnstyledButton
              className={classes.action}
              onClick={() => actions.linkPerson(person.id, null)}
            >
              <UserCheck size={18} />
              <span className="flex-1">This isn't me</span>
            </UnstyledButton>
          )}
          {myEmail != null && meId == null && !hasAccount && (
            <UnstyledButton
              className={classes.action}
              onClick={() => actions.linkPerson(person.id, myEmail)}
            >
              <UserCheck size={18} />
              <span className="flex-1">This is me</span>
            </UnstyledButton>
          )}
          {itemCount > 0 && (
            <UnstyledButton
              className={classes.action}
              onClick={() => onShowItems(person.id)}
            >
              <ListBullets size={18} />
              <span className="flex-1">Show their items</span>
              <span className="sf-muted">{itemCount}</span>
            </UnstyledButton>
          )}
          {isOwner && (
            <UnstyledButton
              className={`${classes.action} ${classes.danger}`}
              onClick={remove}
            >
              <UserMinus size={18} />
              <span className="flex-1">Remove from split</span>
            </UnstyledButton>
          )}
        </div>
      )}
    </div>
  );
}

// Everyone in the bill. People with an account go by their own name and picture;
// guests (no account) are named by whoever adds them. Tap someone for their page.
const PeopleSheet = ({
  summary,
  currency,
  myEmail,
  members,
  invites,
  isOwner,
  initialPersonId,
  onShowItems,
}: PeopleSheetProps) => {
  const actions = useSplitActions()!;
  const { state } = useSplitState();
  const [openId, setOpenId] = useState<string | null>(initialPersonId ?? null);
  const [newName, setNewName] = useState('');
  const meId = state.people.find((p) => myEmail != null && p.memberEmail === myEmail)?.id ?? null;
  const open = state.people.find((p) => p.id === openId);

  if (open) {
    return (
      <PersonPage
        key={open.id}
        person={open}
        summary={summary}
        currency={currency}
        myEmail={myEmail}
        meId={meId}
        isOwner={isOwner}
        onBack={() => setOpenId(null)}
        onShowItems={onShowItems}
      />
    );
  }

  // Members and invitees not yet in the bill, offered first when adding someone
  const linked = new Set(state.people.map((p) => p.memberEmail).filter(Boolean));
  const names = new Set(state.people.map((p) => p.name));
  const suggestions = [
    ...members
      .filter((m) => !linked.has(m.email))
      .map((m) => ({ label: nameFor(m.email, m.displayName), email: m.email })),
    ...invites.map((i) => ({ label: nameFor(i.email), email: null })),
  ].filter((s) => !names.has(s.label));

  const add = (value: string) => {
    const match = suggestions.find((s) => s.label === value);
    if (actions.addPerson(value, match?.email ?? undefined)) setNewName('');
  };

  // You first, then everyone in the order they were added
  const ordered = [
    ...state.people.filter((p) => p.id === meId),
    ...state.people.filter((p) => p.id !== meId),
  ];

  return (
    <div className="flex flex-col gap-4">
      {!isOwner && <p className="sf-muted text-sm">Only the owner can add or remove people.</p>}
      {isOwner && (
        <form
          className="flex gap-2 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            add(newName);
          }}
        >
          <Autocomplete
            className="flex-1"
            label="Add someone"
            placeholder="Name, or pick someone in the split"
            value={newName}
            onChange={setNewName}
            onOptionSubmit={add}
            data={suggestions.map((s) => s.label)}
            maxLength={MAX_NAME_LENGTH}
            // Inside a dialog, so screen readers can reach the options
            comboboxProps={{ withinPortal: false }}
          />
          <Button
            type="submit"
            disabled={!newName.trim()}
          >
            Add
          </Button>
        </form>
      )}

      {ordered.length === 0 ? (
        <div className="sf-muted text-sm text-center py-4">
          {isOwner
            ? "Add everyone who's splitting, including yourself."
            : 'Nobody has been added yet.'}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="sf-label">In this split · {ordered.length}</div>
          <div className={classes.list}>
            {ordered.map((p) => (
              <UnstyledButton
                key={p.id}
                className={classes.row}
                onClick={() => setOpenId(p.id)}
              >
                <PersonAvatar
                  preview={false}
                  person={p}
                  size={34}
                  active={p.id === meId}
                />
                <div className="min-w-0 flex-1">
                  <div className={classes.name}>
                    {p.name}
                    {p.id === meId && <span className="sf-tag">You</span>}
                  </div>
                  <div className={classes.sub}>{p.memberEmail ?? 'Guest'}</div>
                </div>
                <BalanceText
                  cents={summary.balances.get(p.id)?.balanceCents ?? 0}
                  currency={currency}
                  hasItems={summary.hasItems}
                />
                <CaretRight
                  size={14}
                  className="sf-muted"
                />
              </UnstyledButton>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PeopleSheet;
