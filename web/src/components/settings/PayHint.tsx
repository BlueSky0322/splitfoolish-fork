import { Button, CopyButton } from '@mantine/core';
import { Check, Copy, QrCode } from '@phosphor-icons/react';
import { useState } from 'react';
import { formatMoney } from '../../utils/money';
import { isQr, methodLine, methodName } from '../../utils/payments';
import QrViewer from './QrViewer';
import classes from './Settings.module.css';
import type { PaymentMethod } from '../../../../shared/payments';

interface PayHintProps {
  /** Who is being paid */
  name: string;
  amountCents: number;
  currency: string;
  /** Preferred first */
  methods: PaymentMethod[];
  /** Their account, for the picture in the QR code viewer */
  email?: string | null;
  avatarVersion?: number | null;
}

// How to pay someone: their preferred method with a copy button, then the others.
// Shown under your transfer in Settle up, and previewed in Settings.
const PayHint = ({
  name,
  amountCents,
  currency,
  methods,
  email = null,
  avatarVersion = null,
}: PayHintProps) => {
  const [showQr, setShowQr] = useState(false);
  const [preferred, ...others] = methods;
  if (preferred == null) return null;
  const qr = isQr(preferred) && preferred.qrVersion != null;
  return (
    <div className={classes.payHint}>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm">
          Pay {name} <span className="sf-tabular">{formatMoney(amountCents, currency)}</span>
        </span>
        {qr ? (
          <Button
            size="compact-sm"
            variant="default"
            leftSection={<QrCode size={14} />}
            onClick={() => setShowQr(true)}
          >
            Show QR
          </Button>
        ) : (
          preferred.detail && (
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
          )
        )}
      </div>
      <div className="text-sm">
        {qr ? (
          methodName(preferred)
        ) : (
          <>
            {preferred.type} <span className="sf-tabular">{methodLine(preferred)}</span>
          </>
        )}
      </div>
      <QrViewer
        opened={showQr}
        onClose={() => setShowQr(false)}
        name={name}
        email={email}
        avatarVersion={avatarVersion}
        amountCents={amountCents}
        currency={currency}
        methods={methods}
      />
      {others.length > 0 && (
        <div className="sf-muted text-xs">
          Also accepts{' '}
          {others
            .map((m) => (methodLine(m) ? `${methodName(m)} (${methodLine(m)})` : methodName(m)))
            .join(', ')}
        </div>
      )}
    </div>
  );
};

export default PayHint;
