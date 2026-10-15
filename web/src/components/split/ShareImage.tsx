import { Button, Loader, useComputedColorScheme } from '@mantine/core';
import { ArrowsSplit, DownloadSimple, ShareNetwork } from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SplitItem, Person } from '../../split/state';
import { SplitSummary } from '../../split/derive';
import { useProfile } from '../../profile/ProfileContext';
import { ACCENTS, Accent, isAccent } from '../../theme/accents';
import { formatMoney } from '../../utils/money';
import TransferRow from './TransferRow';
import classes from './ShareImage.module.css';

interface ShareImageProps {
  name: string;
  currency: string;
  people: Person[];
  items: SplitItem[];
  summary: SplitSummary;
}

/** a mixed into b by amount (0-1), as plain hex */
function mix(a: string, b: string, amount: number) {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [ca, cb] = [channels(a), channels(b)];
  return `#${ca
    .map((v, i) => Math.round(v * amount + cb[i] * (1 - amount)))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** The theme's colours in plain hex, so the picture matches what's on screen */
export function shareImagePalette(scheme: 'dark' | 'light', accent: Accent) {
  const dark = scheme === 'dark';
  const bg = dark ? '#161826' : '#eceef6';
  const surface = dark ? '#232532' : '#f8f9fd';
  const text = dark ? '#e9e9ed' : '#1e202b';
  const accentColour = ACCENTS[accent].ramp[dark ? 4 : 6];
  return {
    '--sf-bg': bg,
    '--sf-surface': surface,
    '--sf-text': text,
    '--sf-accent': accentColour,
    '--sf-tint': mix(text, bg, 0.05),
    '--sf-avatar': mix(accentColour, surface, 0.24),
    '--sf-text-muted': mix(text, bg, 0.58),
    '--sf-text-label': mix(text, bg, 0.5),
    '--sf-rule': mix(text, bg, 0.16),
  } as React.CSSProperties;
}

const WIDTH = 1080;
const HEIGHT = 1350;

function dateRange(items: SplitItem[]) {
  const times = items.map((i) => i.createdAt).filter((t) => t > 0);
  if (times.length === 0) return null;
  const fmt = (t: number) =>
    new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const first = fmt(Math.min(...times));
  const last = fmt(Math.max(...times));
  return first === last ? first : `${first} – ${last}`;
}

// The settle-up summary as a 1080x1350 picture to post in a group chat. Drawn from a
// hidden copy of the card, in the theme and accent on screen.
const ShareImage = ({ name, currency, people, items, summary }: ShareImageProps) => {
  const scheme = useComputedColorScheme('dark');
  const { profile } = useProfile();
  const accent = isAccent(profile?.settings.accent) ? profile.settings.accent : 'blurple';
  const palette = shareImagePalette(scheme, accent);
  const cardRef = useRef<HTMLDivElement>(null);
  const [showItems, setShowItems] = useState(true);
  const [image, setImage] = useState<{ url: string; blob: Blob } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(people.map((p) => [p.id, p]));
  const range = dateRange(items);

  // If everything doesn't fit, the item list goes first
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (card && showItems && card.scrollHeight > HEIGHT) setShowItems(false);
  }, [showItems]);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    const card = cardRef.current;
    if (card == null) return;
    import('html2canvas')
      .then(({ default: html2canvas }) =>
        html2canvas(card, {
          width: WIDTH,
          height: HEIGHT,
          scale: 1,
          backgroundColor: (palette as Record<string, string>)['--sf-bg'],
        }),
      )
      .then(
        (canvas) =>
          new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png')),
      )
      .then((blob) => {
        if (cancelled) return;
        if (blob == null) throw new Error('No image');
        url = URL.createObjectURL(blob);
        setImage({ url, blob });
      })
      .catch(() => !cancelled && setError('Could not make the image.'));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // palette is a new object each render, so depending on it would redraw in a loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showItems]);

  const fileName = `${name.replace(/[^\w-]+/g, '-').toLowerCase() || 'split'}.png`;

  const share = async () => {
    if (image == null) return;
    const file = new File([image.blob], fileName, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }
    download();
  };

  const download = () => {
    if (image == null) return;
    const a = document.createElement('a');
    a.href = image.url;
    a.download = fileName;
    a.click();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className={classes.preview}>
        {image ? (
          <img
            src={image.url}
            alt={`Who pays who in ${name}`}
            className={classes.previewImage}
          />
        ) : error ? (
          <div className="sf-negative text-sm p-6 text-center">{error}</div>
        ) : (
          <Loader size="sm" />
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="default"
          leftSection={<DownloadSimple size={16} />}
          disabled={image == null}
          onClick={download}
        >
          Save
        </Button>
        <Button
          leftSection={<ShareNetwork size={16} />}
          disabled={image == null}
          onClick={share}
        >
          Share
        </Button>
      </div>

      {/* The card the picture is drawn from, kept off screen */}
      <div
        className={classes.offscreen}
        aria-hidden
      >
        <div
          ref={cardRef}
          className={classes.card}
          style={{ width: WIDTH, height: HEIGHT, ...palette }}
        >
          <div className={classes.brand}>
            <ArrowsSplit size={28} />
            Splitfoolish
          </div>
          <div className={classes.title}>{name}</div>
          <div className={classes.meta}>
            {[
              range,
              `${people.length} ${people.length === 1 ? 'person' : 'people'}`,
              formatMoney(summary.totalCents, currency),
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>

          <div className={classes.heading}>Who pays who</div>
          <div className={classes.transfers}>
            {summary.transfers.length === 0 && (
              <div className={classes.meta}>
                {items.length > 0 ? 'Everyone is settled up.' : 'No items yet.'}
              </div>
            )}
            {summary.transfers.map((t) => (
              <TransferRow
                key={`${t.fromId}-${t.toId}`}
                from={byId.get(t.fromId)!}
                to={byId.get(t.toId)!}
                amountCents={t.amountCents}
                currency={currency}
                size="xl"
              />
            ))}
          </div>

          {showItems && items.length > 0 && (
            <>
              <div className={classes.rule} />
              <div className={classes.items}>
                {items.map((i) => (
                  <div
                    key={i.id}
                    className={classes.itemRow}
                  >
                    <span className={classes.itemName}>{i.name}</span>
                    <span className={classes.itemPayer}>{i.payer.name} paid</span>
                    <span className={classes.itemAmount}>
                      {formatMoney(Math.round(i.cost * 100), currency)}
                      {i.original && (
                        <span className={classes.itemOriginal}>
                          {formatMoney(Math.round(i.original.amount * 100), i.original.currency)}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShareImage;
