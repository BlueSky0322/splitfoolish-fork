import { Button, CopyButton, Select, UnstyledButton } from '@mantine/core';
import {
  CaretLeft,
  CaretRight,
  ChartBarHorizontal,
  Copy,
  QrCode,
  ShareNetwork,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { PaymentMethod, SplitMember } from '../../api';
import { IPerson } from '../../interfaces/app-reducer';
import { SplitSummary } from '../../split/derive';
import { formatMoney } from '../../utils/money';
import { isQr, methodName } from '../../utils/payments';
import QrViewer from '../settings/QrViewer';
import BalanceBars from './BalanceBars';
import TransferRow from './TransferRow';
import classes from './Split.module.css';

interface BalancePanelProps {
  people: IPerson[];
  summary: SplitSummary;
  currency: string;
  me: IPerson | null;
  distributorId: string | null;
  onDistributorChange: (id: string | null) => void;
  onShareImage: () => void;
  onLinkMe: () => void;
  /** The split's accounts, for showing how to pay someone you owe */
  members: SplitMember[];
  /** Settle up sheet on phones: larger rows and no outer card */
  variant?: 'panel' | 'sheet';
}

export function BalanceHero({
  summary,
  currency,
  me,
  onLinkMe,
  size,
  prefix,
}: {
  summary: SplitSummary;
  currency: string;
  me: IPerson | null;
  onLinkMe: () => void;
  size: number;
  prefix?: string;
}) {
  if (me == null) {
    return (
      <div className="flex flex-col gap-1">
        <div className="sf-muted text-[13px]">{prefix ? `${prefix} · total` : 'Total'}</div>
        <div
          className={classes.heroAmount}
          style={{ fontSize: size }}
        >
          {formatMoney(summary.totalCents, currency)}
        </div>
        <button
          type="button"
          className={classes.linkButton}
          onClick={onLinkMe}
        >
          Which one is you? Pick yourself to see your balance
        </button>
      </div>
    );
  }
  const cents = summary.balances.get(me.id)?.balanceCents ?? 0;
  const label = !summary.hasItems
    ? 'nothing spent yet'
    : cents > 0
      ? "you're owed"
      : cents < 0
        ? 'you owe'
        : "you're settled";
  return (
    <div className="flex flex-col gap-1">
      <div className="sf-muted text-[13px]">
        {prefix ? `${prefix} · ${label}` : label.charAt(0).toUpperCase() + label.slice(1)}
      </div>
      <div
        className={`${classes.heroAmount} ${cents > 0 ? 'sf-positive' : cents < 0 ? 'sf-negative' : ''}`}
        style={{ fontSize: size }}
      >
        {formatMoney(cents, currency)}
      </div>
    </div>
  );
}

/** Where you stand in one line, for the phone's bar once the big figure scrolls away */
export function BalanceLine({
  summary,
  currency,
  me,
}: {
  summary: SplitSummary;
  currency: string;
  me: IPerson | null;
}) {
  if (me == null) {
    return (
      <span className={classes.balanceLine}>
        <span className="sf-muted">Total</span> {formatMoney(summary.totalCents, currency)}
      </span>
    );
  }
  const cents = summary.balances.get(me.id)?.balanceCents ?? 0;
  const label = !summary.hasItems
    ? 'Nothing spent yet'
    : cents > 0
      ? "You're owed"
      : cents < 0
        ? 'You owe'
        : 'Settled';
  return (
    <span className={classes.balanceLine}>
      <span className="sf-muted">{label}</span>{' '}
      <span className={cents > 0 ? 'sf-positive' : cents < 0 ? 'sf-negative' : ''}>
        {formatMoney(cents, currency)}
      </span>
    </span>
  );
}

const COPIED_MS = 1500;

/** Under a transfer you make: how they like to be paid, and their number to copy */
function PayLine({
  methods,
  to,
  member,
  amountCents,
  currency,
}: {
  methods: PaymentMethod[];
  to: IPerson;
  member: SplitMember | undefined;
  amountCents: number;
  currency: string;
}) {
  const [showQr, setShowQr] = useState(false);
  const [preferred] = methods;
  if (preferred == null) return <span className={classes.payMethod}>No payment details yet</span>;
  // Their preferred way is a QR code: show it, with the amount, to scan (7c, 7d)
  if (isQr(preferred) && preferred.qrVersion != null) {
    return (
      <>
        <span className={classes.payMethod}>{methodName(preferred)}</span>
        <UnstyledButton
          className={classes.payChip}
          onClick={() => setShowQr(true)}
        >
          <QrCode size={13} />
          Show QR
        </UnstyledButton>
        <QrViewer
          opened={showQr}
          onClose={() => setShowQr(false)}
          name={to.name}
          email={member?.email ?? null}
          avatarVersion={member?.avatarVersion ?? null}
          amountCents={amountCents}
          currency={currency}
          methods={methods}
        />
      </>
    );
  }
  const holder = preferred.accountName ? `, ${preferred.accountName}` : '';
  if (!preferred.detail) {
    return <span className={classes.payMethod}>{methodName(preferred)}</span>;
  }
  return (
    <>
      <span className={classes.payMethod}>
        {methodName(preferred)}
        {holder}
      </span>
      <CopyButton
        value={preferred.detail}
        timeout={COPIED_MS}
      >
        {({ copied, copy }) => (
          <UnstyledButton
            className={classes.payChip}
            onClick={copy}
            aria-label={copied ? 'Copied' : `Copy ${preferred.detail}`}
          >
            {copied ? 'Copied' : preferred.detail}
            <Copy size={13} />
          </UnstyledButton>
        )}
      </CopyButton>
    </>
  );
}

const ROUTE_HELP =
  'Pick someone to collect and pay out for the group. Everyone then pays, or is paid by, just that person.';

const BalancePanel = ({
  people,
  summary,
  currency,
  me,
  distributorId,
  onDistributorChange,
  onShareImage,
  onLinkMe,
  members,
  variant = 'panel',
}: BalancePanelProps) => {
  // When you owe someone linked to an account, show how they like to be paid
  const memberFor = (person: IPerson) => members.find((m) => m.email === person.memberEmail);
  const methodsFor = (person: IPerson) => memberFor(person)?.paymentMethods ?? [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const mine = me ? summary.balances.get(me.id) : null;
  const count = summary.transfers.length;
  const isSheet = variant === 'sheet';
  // The sheet keeps balances and routing on a second view (4f)
  const [view, setView] = useState<'transfers' | 'balances'>('transfers');

  const bars = people.length > 0 && summary.hasItems && (
    <section className={classes.panelSection}>
      <h6 className="sf-label">Balances</h6>
      <BalanceBars
        people={people}
        balances={summary.balances}
      />
    </section>
  );
  const route = (
    <Select
      label="Route payments through"
      description={isSheet ? ROUTE_HELP : undefined}
      inputWrapperOrder={['label', 'input', 'description']}
      data={[
        { value: '', label: 'Nobody, fewest transfers' },
        ...people.map((p) => ({ value: p.id, label: p.name })),
      ]}
      value={distributorId ?? ''}
      onChange={(v) => {
        onDistributorChange(v || null);
        if (isSheet) setView('transfers');
      }}
      allowDeselect={false}
      // Inside a dialog, so screen readers can reach the options (the dialog hides other popups)
      comboboxProps={{ withinPortal: !isSheet }}
    />
  );

  if (isSheet && view === 'balances') {
    return (
      <div className={classes.sheetPanel}>
        <Button
          variant="subtle"
          color="gray"
          className={classes.sheetBack}
          leftSection={<CaretLeft size={16} />}
          onClick={() => setView('transfers')}
        >
          Settle up
        </Button>
        {bars}
        <hr className="sf-rule" />
        {route}
      </div>
    );
  }

  return (
    <div className={variant === 'panel' ? classes.panel : classes.sheetPanel}>
      {variant === 'panel' && (
        <>
          <BalanceHero
            summary={summary}
            currency={currency}
            me={me}
            onLinkMe={onLinkMe}
            size={42}
          />
          {mine && summary.hasItems && (
            <div className={classes.stats}>
              <div>
                <div className={classes.statLabel}>You paid</div>
                <div className={classes.statValue}>{formatMoney(mine.paidCents, currency)}</div>
              </div>
              <div>
                <div className={classes.statLabel}>Your share</div>
                <div className={classes.statValue}>{formatMoney(mine.shareCents, currency)}</div>
              </div>
            </div>
          )}
          <hr className="sf-rule" />
        </>
      )}

      <section className={classes.panelSection}>
        <h6 className="sf-label">Who pays who</h6>
        {count === 0 ? (
          <div className="sf-muted text-sm">
            {summary.hasItems
              ? 'Everyone is settled up.'
              : 'No items yet. Add what was bought and who paid, and who pays who appears here.'}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {summary.transfers.map((t) => {
              const to = byId.get(t.toId)!;
              const yours = me != null && t.fromId === me.id;
              return (
                <div
                  key={`${t.fromId}-${t.toId}`}
                  className="flex flex-col gap-2"
                >
                  <TransferRow
                    from={byId.get(t.fromId)!}
                    to={to}
                    amountCents={t.amountCents}
                    currency={currency}
                    size={isSheet ? 'lg' : 'md'}
                    fromMe={yours}
                    payLine={
                      yours ? (
                        <PayLine
                          methods={methodsFor(to)}
                          to={to}
                          member={memberFor(to)}
                          amountCents={t.amountCents}
                          currency={currency}
                        />
                      ) : undefined
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {isSheet ? (
        <UnstyledButton
          className={classes.sheetRow}
          onClick={() => setView('balances')}
        >
          <ChartBarHorizontal size={18} />
          <span className="flex-1">Balances and routing</span>
          <CaretRight size={16} />
        </UnstyledButton>
      ) : (
        <>
          {bars}
          {route}
        </>
      )}
      <Button
        variant="default"
        leftSection={<ShareNetwork size={16} />}
        onClick={onShareImage}
        disabled={!summary.hasItems}
      >
        Share as image
      </Button>
    </div>
  );
};

export default BalancePanel;
