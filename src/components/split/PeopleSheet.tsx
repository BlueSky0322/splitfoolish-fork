import { Autocomplete, Button, TextInput, UnstyledButton } from '@mantine/core';
import { CaretLeft, CaretRight, ListBullets, UserCheck, UserMinus } from '@phosphor-icons/react';
import { useState } from 'react';
import { SplitInvite, SplitMember } from '../../api';
import { removeBlocker, useSplitActions } from '../../hooks/useSplit';
import { AppReducerState, IPerson } from '../../interfaces/app-reducer';
import { nameFor } from '../../profile/ProfileContext';
import { SplitSummary } from '../../split/derive';
import { formatMoney } from '../../utils/money';
import PersonAvatar from './PersonAvatar';
import TransferRow from './TransferRow';
import classes from './PeopleSheet.module.css';

interface PeopleSheetProps {
  state: AppReducerState;
  summary: SplitSummary;
  currency: string;
  myEmail: string | null;
  members: SplitMember[];
  invites: SplitInvite[];
  /** Opens on this person's page */
  initialPersonId?: string | null;
  onShowItems: (personId: string) => void;
}

function BalanceText({ cents, currency }: { cents: number; currency: string }) {
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
  state,
  summary,
  currency,
  myEmail,
  meId,
  onBack,
  onShowItems,
}: {
  person: IPerson;
  state: AppReducerState;
  summary: SplitSummary;
  currency: string;
  myEmail: string | null;
  meId: string | null;
  onBack: () => void;
  onShowItems: (personId: string) => void;
}) {
  const actions = useSplitActions()!;
  const [name, setName] = useState(person.name);
  const [confirming, setConfirming] = useState<string | null>(null);
  const byId = new Map(state.people.map((p) => [p.id, p]));
  const balance = summary.balances.get(person.id);
  const theirs = summary.transfers.filter((t) => t.fromId === person.id || t.toId === person.id);
  const itemCount = state.items.filter(
    (i) => i.payer.id === person.id || i.participants.some((p) => p.id === person.id),
  ).length;
  const isMe = myEmail != null && person.memberEmail === myEmail;
  const hasAccount = person.memberEmail != null;

  const remove = () => {
    const plain = removeBlocker(state, person.id, false);
    if (plain == null) {
      if (actions.removePerson(person.id)) onBack();
      return;
    }
    // Can't go even from shared items (they paid, or it would empty an item): explain why
    if (removeBlocker(state, person.id, true) != null) {
      actions.removePerson(person.id, true);
      return;
    }
    setConfirming(plain);
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
      ) : (
        <TextInput
          label="Name"
          value={name}
          maxLength={80}
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
          <p className="text-sm">
            {confirming} Remove them from those splits? Everyone else's shares go up to cover it.
          </p>
          <div className="flex gap-2 justify-end">
            <Button
              variant="default"
              onClick={() => setConfirming(null)}
            >
              Cancel
            </Button>
            <Button
              color="red"
              onClick={() => actions.removePerson(person.id, true) && onBack()}
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
          <UnstyledButton
            className={`${classes.action} ${classes.danger}`}
            onClick={remove}
          >
            <UserMinus size={18} />
            <span className="flex-1">Remove from split</span>
          </UnstyledButton>
        </div>
      )}
    </div>
  );
}

// Everyone in the bill. People with an account go by their own name and picture;
// guests (no account) are named by whoever adds them. Tap someone for their page.
const PeopleSheet = ({
  state,
  summary,
  currency,
  myEmail,
  members,
  invites,
  initialPersonId,
  onShowItems,
}: PeopleSheetProps) => {
  const actions = useSplitActions()!;
  const [openId, setOpenId] = useState<string | null>(initialPersonId ?? null);
  const [newName, setNewName] = useState('');
  const meId = state.people.find((p) => myEmail != null && p.memberEmail === myEmail)?.id ?? null;
  const open = state.people.find((p) => p.id === openId);

  if (open) {
    return (
      <PersonPage
        key={open.id}
        person={open}
        state={state}
        summary={summary}
        currency={currency}
        myEmail={myEmail}
        meId={meId}
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
          maxLength={80}
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

      {ordered.length === 0 ? (
        <div className="sf-muted text-sm text-center py-4">
          Add everyone who's splitting, including yourself.
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
