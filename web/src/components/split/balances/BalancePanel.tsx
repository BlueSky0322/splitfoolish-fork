import { Button, CopyButton, Select, UnstyledButton } from '@mantine/core';
import {
  CaretLeft,
  CaretRight,
  ChartBarHorizontal,
  ChartPieSlice,
  Check,
  Copy,
  QrCode,
  ShareNetwork,
} from '@phosphor-icons/react';
import { useState } from 'react';
import type { Person } from '@shared/types';
import { formatMoney } from '../../../utils/money';
import { isQr, methodName } from '../../../utils/payment-labels';
import QrViewer from '../../common/QrViewer';
import BalanceBars from './BalanceBars';
import Spending from './Spending';
import TransferRow from './TransferRow';
import { PaymentRow } from '../payments/PaymentRow';
import { deletePayment } from '../payments/delete-payment';
import { navigate, splitAddress } from '../../../hooks/useRoute';
import { HeroSkeleton, PanelSkeleton } from '../layout/SplitSkeletons';
import classes from './Balances.module.css';
import page from '../Split.module.css';
import type { PaymentMethod } from '@shared/payments';
import type { SplitMember } from '@shared/api';
import { useSplitState } from '../../../split/SplitStateContext';
import { useSplitActions } from '../../../split/useSplit';
import { useSplitPage } from '../SplitPageContext';

/** Where you stand, in large type; until you've picked yourself, the total */
export function BalanceHero({ size }: { size: number }) {
  const { totals, currency, me, meta, status, openDialog } = useSplitPage();
  if (meta == null && status === 'loading') return <HeroSkeleton size={size} />;
  if (me == null) {
    return (
      <div className="flex flex-col gap-1">
        <div className="sf-muted text-[13px]">Total</div>
        <div
          className={classes.heroAmount}
          style={{ fontSize: size }}
        >
          {formatMoney(totals.totalCents, currency)}
        </div>
        <button
          type="button"
          className={page.linkButton}
          onClick={() => openDialog({ kind: 'people' })}
        >
          Which one is you? Pick yourself to see your balance
        </button>
      </div>
    );
  }
  const cents = totals.balances.get(me.id)?.balanceCents ?? 0;
  const label = !totals.hasItems
    ? 'Nothing spent yet'
    : cents > 0
      ? "You're owed"
      : cents < 0
        ? 'You owe'
        : "You're settled";
  return (
    <div className="flex flex-col gap-1">
      <div className="sf-muted text-[13px]">{label}</div>
      <div
        className={`${classes.heroAmount} ${cents > 0 ? 'sf-positive' : cents < 0 ? 'sf-negative' : ''}`}
        style={{ fontSize: size }}
      >
        {formatMoney(cents, currency)}
      </div>
    </div>
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
  to: Person;
  member: SplitMember | undefined;
  amountCents: number;
  currency: string;
}) {
  const [showQr, setShowQr] = useState(false);
  const [preferred] = methods;
  if (preferred == null) return <span className={classes.payMethod}>No payment details yet</span>;
  // Their preferred way is a QR code: show it, with the amount, to scan
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

/**
 * The balances and who pays whom. variant 'sheet' is Settle up on phones: larger rows
 * and no outer card.
 */
/** How many of the latest payments Settle up shows; the rest are on the Payments page */
const LATEST_PAYMENTS = 3;

const BalancePanel = ({ variant = 'panel' }: { variant?: 'panel' | 'sheet' }) => {
  const { splitId, totals, currency, me, distributorId, meta, status, openDialog } = useSplitPage();
  const { people, payments } = useSplitState().state;
  const actions = useSplitActions();
  const onDistributorChange = (id: string | null) => actions.setDistributor(id);
  const onShareImage = () => openDialog({ kind: 'share' });
  // The split's accounts: when you owe someone linked to one, show how they like to be paid
  const members = meta?.members ?? [];
  const memberFor = (person: Person) => members.find((m) => m.email === person.memberEmail);
  const methodsFor = (person: Person) => memberFor(person)?.paymentMethods ?? [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const mine = me ? totals.balances.get(me.id) : null;
  const count = totals.transfers.length;
  const isSheet = variant === 'sheet';
  // The sheet keeps balances and routing, and the spending chart, on views of their own
  const [view, setView] = useState<'transfers' | 'balances' | 'spending'>('transfers');

  const bars = people.length > 0 && totals.hasItems && (
    <section className={classes.panelSection}>
      <h6 className="sf-label">Balances</h6>
      <BalanceBars
        people={people}
        balances={totals.balances}
      />
    </section>
  );
  // Where the money went, once anything was spent
  const spending = totals.hasItems && (
    <section className={classes.panelSection}>
      <h6 className="sf-label">Spending</h6>
      <Spending />
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

  if (meta == null && status === 'loading') {
    return (
      <div className={variant === 'panel' ? classes.panel : classes.sheetPanel}>
        {variant === 'panel' && (
          <>
            <HeroSkeleton size={42} />
            <hr className="sf-rule" />
          </>
        )}
        <PanelSkeleton />
      </div>
    );
  }

  if (isSheet && view !== 'transfers') {
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
        {view === 'spending' ? (
          spending
        ) : (
          <>
            {bars}
            <hr className="sf-rule" />
            {route}
          </>
        )}
      </div>
    );
  }

  return (
    <div className={variant === 'panel' ? classes.panel : classes.sheetPanel}>
      {variant === 'panel' && (
        <>
          <BalanceHero size={42} />
          {mine && totals.hasItems && (
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
            {totals.hasItems
              ? 'Everyone is settled up.'
              : 'No items yet. Add what was bought and who paid, and who pays who appears here.'}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {totals.transfers.map((t) => {
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
                    action={
                      <UnstyledButton
                        className={classes.payChip}
                        onClick={() =>
                          openDialog({
                            kind: 'payment',
                            prefill: { fromId: t.fromId, toId: t.toId, amountCents: t.amountCents },
                          })
                        }
                      >
                        <Check size={13} />
                        Mark as paid
                      </UnstyledButton>
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className={classes.panelSection}>
        <h6 className="sf-label">Payments</h6>
        {payments.length === 0 ? (
          <div className="sf-muted text-sm">No payments yet.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {[...payments]
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, LATEST_PAYMENTS)
              .map((p) => (
                <PaymentRow
                  key={p.id}
                  payment={p}
                  currency={currency}
                  onEdit={() => openDialog({ kind: 'payment', payment: p })}
                  onDelete={() => deletePayment(actions, p)}
                />
              ))}
            <button
              type="button"
              className={page.linkButton}
              onClick={() => navigate(splitAddress(splitId, 'payments'))}
            >
              {payments.length > LATEST_PAYMENTS
                ? `See all ${payments.length} payments`
                : 'All payments'}
            </button>
          </div>
        )}
      </section>

      {isSheet ? (
        <>
          <UnstyledButton
            className={classes.sheetRow}
            onClick={() => setView('balances')}
          >
            <ChartBarHorizontal size={18} />
            <span className="flex-1">Balances and routing</span>
            <CaretRight size={16} />
          </UnstyledButton>
          {totals.hasItems && (
            <UnstyledButton
              className={classes.sheetRow}
              onClick={() => setView('spending')}
            >
              <ChartPieSlice size={18} />
              <span className="flex-1">Spending</span>
              <span className="sf-muted">{formatMoney(totals.totalCents, currency)}</span>
              <CaretRight size={16} />
            </UnstyledButton>
          )}
        </>
      ) : (
        <>
          {bars}
          {spending}
          {route}
        </>
      )}
      <Button
        variant="default"
        leftSection={<ShareNetwork size={16} />}
        onClick={onShareImage}
        disabled={!totals.hasItems}
      >
        Share as image
      </Button>
    </div>
  );
};

export default BalancePanel;
