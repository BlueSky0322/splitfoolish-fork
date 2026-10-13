import { Button, Select } from '@mantine/core';
import { ShareNetwork } from '@phosphor-icons/react';
import { IPerson } from '../../interfaces/app-reducer';
import { SplitSummary } from '../../split/derive';
import { formatMoney } from '../../utils/money';
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
  const label = cents > 0 ? "you're owed" : cents < 0 ? 'you owe' : "you're settled";
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

const BalancePanel = ({
  people,
  summary,
  currency,
  me,
  distributorId,
  onDistributorChange,
  onShareImage,
  onLinkMe,
  variant = 'panel',
}: BalancePanelProps) => {
  const byId = new Map(people.map((p) => [p.id, p]));
  const mine = me ? summary.balances.get(me.id) : null;
  const count = summary.transfers.length;

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
          {mine && (
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
          <div className="sf-muted text-sm">Everyone is settled up.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {summary.transfers.map((t) => (
              <TransferRow
                key={`${t.fromId}-${t.toId}`}
                from={byId.get(t.fromId)!}
                to={byId.get(t.toId)!}
                amountCents={t.amountCents}
                currency={currency}
                size={variant === 'sheet' ? 'lg' : 'md'}
              />
            ))}
          </div>
        )}
      </section>

      {people.length > 0 && (
        <section className={classes.panelSection}>
          <h6 className="sf-label">Balances</h6>
          <BalanceBars
            people={people}
            balances={summary.balances}
          />
        </section>
      )}

      <Select
        label="Route payments through"
        data={[
          { value: '', label: 'Nobody, fewest transfers' },
          ...people.map((p) => ({ value: p.id, label: p.name })),
        ]}
        value={distributorId ?? ''}
        onChange={(v) => onDistributorChange(v || null)}
        allowDeselect={false}
        // Inside a dialog, so screen readers can reach the options (the dialog hides other popups)
        comboboxProps={{ withinPortal: variant === 'panel' }}
      />
      <Button
        variant="default"
        leftSection={<ShareNetwork size={16} />}
        onClick={onShareImage}
        disabled={people.length === 0}
      >
        Share as image
      </Button>
    </div>
  );
};

export default BalancePanel;
