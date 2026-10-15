import { Button, CopyButton, UnstyledButton } from '@mantine/core';
import { copyText } from '../../utils/share';
import {
  Bank,
  CaretRight,
  Check,
  Copy,
  DownloadSimple,
  QrCode,
  Wallet,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { paymentQrUrl } from '../../api';
import { BANK_TRANSFER, type PaymentMethod } from '@shared/payments';
import { formatMoney } from '../../utils/money';
import { isQr, methodLine, methodName } from '../../utils/payments';
import ResponsiveDialog from './ResponsiveDialog';
import UserAvatar from './UserAvatar';
import classes from './QrViewer.module.css';

interface QrViewerProps {
  opened: boolean;
  onClose: () => void;
  /** Who is being paid */
  name: string;
  email: string | null;
  avatarVersion: number | null;
  amountCents: number;
  currency: string;
  /** All their methods, preferred first; the first QR code shows unless another is picked */
  methods: PaymentMethod[];
}

const COPIED_MS = 1500;

const methodIcon = (m: PaymentMethod) =>
  isQr(m) ? (
    <QrCode size={18} />
  ) : m.type === BANK_TRANSFER ? (
    <Bank size={18} />
  ) : (
    <Wallet size={18} />
  );

// Pay someone by their QR code: the code on a light card in both themes, so it
// scans from another phone, then their other ways to be paid
const QrViewer = ({
  opened,
  onClose,
  name,
  email,
  avatarVersion,
  amountCents,
  currency,
  methods,
}: QrViewerProps) => {
  const codes = methods.filter(
    (m): m is PaymentMethod & { qrVersion: number } => isQr(m) && m.qrVersion != null,
  );
  const [shownId, setShownId] = useState<string | null>(null);
  useEffect(() => {
    if (opened) setShownId(null);
  }, [opened]);
  const shown = codes.find((m) => m.id === shownId) ?? codes[0];
  const amount = formatMoney(amountCents, currency);
  // The amount as a banking app takes it: digits and a decimal point
  const plainAmount = (amountCents / 100).toFixed(2);
  const others = methods.filter((m) => m.id !== shown?.id);

  return (
    <ResponsiveDialog
      opened={opened}
      onClose={onClose}
      width={400}
      title={
        <span className={classes.head}>
          <UserAvatar
            name={name}
            email={email}
            avatarVersion={avatarVersion}
            size={40}
            preview={false}
          />
          <span className="min-w-0">
            <span className={classes.payWho}>Pay {name}</span>
            <span className={classes.amount}>{amount}</span>
          </span>
        </span>
      }
    >
      {shown && (
        <div className="flex flex-col gap-3">
          <div className={classes.card}>
            {shown.detail && <div className={classes.label}>{shown.detail}</div>}
            <img
              className={classes.code}
              src={paymentQrUrl(shown.id, shown.qrVersion)}
              alt={`${methodName(shown)} for ${name}`}
            />
            <div className={classes.hint}>Scan with your banking app, then enter {amount}</div>
          </div>
          <div className={classes.actions}>
            <Button
              component="a"
              href={paymentQrUrl(shown.id, shown.qrVersion)}
              download={`${methodName(shown)} - ${name}`}
              variant="default"
              size="md"
              leftSection={<DownloadSimple size={18} />}
            >
              Save image
            </Button>
            <CopyButton
              value={plainAmount}
              timeout={COPIED_MS}
            >
              {({ copied, copy }) => (
                <Button
                  variant="default"
                  size="md"
                  leftSection={copied ? <Check size={18} /> : <Copy size={18} />}
                  onClick={copy}
                >
                  {copied ? 'Copied' : 'Copy amount'}
                </Button>
              )}
            </CopyButton>
          </div>
          {others.length > 0 && (
            <div className={classes.others}>
              {others.map((m) => (
                <UnstyledButton
                  key={m.id}
                  className={classes.other}
                  onClick={() => {
                    // Another code shows here; anything else is copied to paste in
                    if (isQr(m) && m.qrVersion != null) {
                      setShownId(m.id);
                    } else if (m.detail) {
                      void copyText(m.detail, `Copied ${m.detail}`);
                    }
                  }}
                >
                  {methodIcon(m)}
                  <span className="min-w-0 flex-1 truncate">
                    {isQr(m) ? methodName(m) : m.type} instead
                  </span>
                  {!isQr(m) && <span className={classes.otherDetail}>{methodLine(m)}</span>}
                  <CaretRight size={14} />
                </UnstyledButton>
              ))}
            </div>
          )}
        </div>
      )}
    </ResponsiveDialog>
  );
};

export default QrViewer;
