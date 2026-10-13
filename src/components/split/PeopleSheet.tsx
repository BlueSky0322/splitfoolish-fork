import { Autocomplete, Button, TextInput, UnstyledButton } from '@mantine/core';
import { CaretDown, CaretRight, UserCheck } from '@phosphor-icons/react';
import { useState } from 'react';
import { SplitMember, SplitInvite } from '../../api';
import { removeBlocker, useSplitActions } from '../../hooks/useSplit';
import { AppReducerState, IPerson } from '../../interfaces/app-reducer';
import { nameFor } from '../../profile/ProfileContext';
import { SplitSummary } from '../../split/derive';
import { formatMoney } from '../../utils/money';
import UserAvatar from '../ui/UserAvatar';
import TransferRow from './TransferRow';
import classes from './Split.module.css';

interface PeopleSheetProps {
  state: AppReducerState;
  summary: SplitSummary;
  currency: string;
  myEmail: string | null;
  members: SplitMember[];
  invites: SplitInvite[];
  /** Opens with this person's details showing */
  initialPersonId?: string | null;
  onShowItems: (personId: string) => void;
}

function PersonDetail({
  person,
  state,
  summary,
  currency,
  myEmail,
  meId,
  onShowItems,
}: {
  person: IPerson;
  state: AppReducerState;
  summary: SplitSummary;
  currency: string;
  myEmail: string | null;
  meId: string | null;
  onShowItems: (personId: string) => void;
}) {
  const actions = useSplitActions()!;
  const [name, setName] = useState(person.name);
  const byId = new Map(state.people.map((p) => [p.id, p]));
  const theirs = summary.transfers.filter((t) => t.fromId === person.id || t.toId === person.id);
  const itemCount = state.items.filter(
    (i) => i.payer.id === person.id || i.participants.some((p) => p.id === person.id),
  ).length;
  const isMe = myEmail != null && person.memberEmail === myEmail;

  // Set when they're on items they only share, to confirm taking them off those
  const [confirming, setConfirming] = useState<string | null>(null);

  const remove = () => {
    const plain = removeBlocker(state, person.id, false);
    if (plain == null) {
      actions.removePerson(person.id);
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
    <div className={classes.personDetail}>
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

      {myEmail != null &&
        (isMe ? (
          <div className="flex items-center gap-2 text-sm">
            <UserCheck
              size={16}
              className="sf-muted"
            />
            <span className="flex-1">This is you</span>
            <Button
              variant="subtle"
              size="compact-sm"
              onClick={() => actions.linkPerson(person.id, null)}
            >
              Not me
            </Button>
          </div>
        ) : (
          meId == null &&
          person.memberEmail == null && (
            <Button
              variant="default"
              leftSection={<UserCheck size={16} />}
              onClick={() => actions.linkPerson(person.id, myEmail)}
            >
              This is me
            </Button>
          )
        ))}
      {!isMe && person.memberEmail && (
        <div className="sf-muted text-xs">Linked to {person.memberEmail}</div>
      )}

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
              onClick={() => actions.removePerson(person.id, true)}
            >
              Remove {person.name}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {itemCount > 0 && (
            <Button
              variant="default"
              onClick={() => onShowItems(person.id)}
            >
              Show their items ({itemCount})
            </Button>
          )}
          <Button
            variant="subtle"
            color="red"
            onClick={remove}
          >
            Remove from split
          </Button>
        </div>
      )}
    </div>
  );
}

// Everyone in the bill: who they are, what they paid and owe, and editing them
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
  const [open, setOpen] = useState<string | null>(initialPersonId ?? null);
  const [newName, setNewName] = useState('');
  const meId = state.people.find((p) => myEmail != null && p.memberEmail === myEmail)?.id ?? null;

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
          placeholder="Name"
          value={newName}
          onChange={setNewName}
          onOptionSubmit={add}
          data={suggestions.map((s) => s.label)}
          maxLength={80}
          // Inside a dialog, so screen readers can reach the options (the dialog hides other popups)
          comboboxProps={{ withinPortal: false }}
        />
        <Button
          type="submit"
          disabled={!newName.trim()}
        >
          Add
        </Button>
      </form>

      {state.people.length === 0 ? (
        <div className="sf-muted text-sm text-center py-4">
          Add everyone who's splitting, including yourself.
        </div>
      ) : (
        <div className={`sf-card ${classes.peopleList}`}>
          {state.people.map((p) => {
            const b = summary.balances.get(p.id);
            const cents = b?.balanceCents ?? 0;
            const expanded = open === p.id;
            return (
              <div key={p.id}>
                <UnstyledButton
                  className={classes.personRow}
                  onClick={() => setOpen(expanded ? null : p.id)}
                  aria-expanded={expanded}
                >
                  <UserAvatar
                    name={p.name}
                    size={30}
                    active={p.id === meId}
                  />
                  <div className="min-w-0 flex-1">
                    <div className={classes.personName}>
                      {p.name}
                      {p.id === meId && <span className="sf-muted"> (you)</span>}
                    </div>
                    <div className={classes.personMeta}>
                      Paid {formatMoney(b?.paidCents ?? 0, currency)} · share{' '}
                      {formatMoney(b?.shareCents ?? 0, currency)}
                    </div>
                  </div>
                  <span
                    className={`${classes.personBalance} ${
                      cents > 0 ? 'sf-positive' : cents < 0 ? 'sf-negative' : 'sf-muted'
                    }`}
                  >
                    {cents === 0
                      ? 'Settled'
                      : `${cents > 0 ? 'Gets' : 'Owes'} ${formatMoney(cents, currency)}`}
                  </span>
                  {expanded ? <CaretDown size={16} /> : <CaretRight size={16} />}
                </UnstyledButton>
                {expanded && (
                  <PersonDetail
                    person={p}
                    state={state}
                    summary={summary}
                    currency={currency}
                    myEmail={myEmail}
                    meId={meId}
                    onShowItems={onShowItems}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PeopleSheet;
