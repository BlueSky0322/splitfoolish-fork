import { Button, CopyButton } from '@mantine/core';
import { Check, Copy } from '@phosphor-icons/react';
import { PaymentMethod } from '../../api';
import { formatMoney } from '../../utils/money';
import classes from './Settings.module.css';

interface PayHintProps {
  /** Who is being paid */
  name: string;
  amountCents: number;
  currency: string;
  /** Preferred first */
  methods: PaymentMethod[];
}

// How to pay someone: their preferred method with a copy button, then the others.
// Shown under your transfer in Settle up, and previewed in Settings.
const PayHint = ({ name, amountCents, currency, methods }: PayHintProps) => {
  const [preferred, ...others] = methods;
  if (preferred == null) return null;
  return (
    <div className={classes.payHint}>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm">
          Pay {name} <span className="sf-tabular">{formatMoney(amountCents, currency)}</span>
        </span>
        <CopyButton value={preferred.detail}>
          {({ copied, copy }) => (
            <Button
              size="compact-sm"
              variant="default"
              leftSection={copied ? <Check size={14} /> : <Copy size={14} />}
              onClick={copy}
            >
              {copied ? 'Copied' : 'Copy number'}
            </Button>
          )}
        </CopyButton>
      </div>
      <div className="text-sm">
        {preferred.type} <span className="sf-tabular">{preferred.detail}</span>
      </div>
      {others.length > 0 && (
        <div className="sf-muted text-xs">
          Also accepts {others.map((m) => `${m.type} (${m.detail})`).join(', ')}
        </div>
      )}
    </div>
  );
};

export default PayHint;
