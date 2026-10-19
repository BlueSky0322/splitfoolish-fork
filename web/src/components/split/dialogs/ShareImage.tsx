import { Button, Loader } from '@mantine/core';
import { ArrowsSplit, DownloadSimple, ShareNetwork } from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SplitItem } from '../../../split/state';
import type { Person } from '@shared/types';
import { type SplitTotals, dateRange } from '../../../split/derive';
import { deliverFile, saveFile } from '../../../utils/deliver-file';
import { formatMoney } from '../../../utils/money';
import TransferRow from '../balances/TransferRow';
import { PersonName } from '../PersonAvatar';
import classes from './ShareImage.module.css';
import { toCents } from '@shared/rates';
import { plural } from '../../../utils/text';

interface ShareImageProps {
  name: string;
  currency: string;
  people: Person[];
  items: SplitItem[];
  totals: SplitTotals;
}

const WIDTH = 1080;
const HEIGHT = 1350;

// The settle-up summary as a 1080x1350 picture to post in a group chat. Drawn from a
// hidden copy of the card, in the theme and accent on screen.
const ShareImage = ({ name, currency, people, items, totals }: ShareImageProps) => {
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
    // Drawn by the browser itself, so the card looks as it does on screen
    import('modern-screenshot')
      .then(({ domToBlob }) =>
        domToBlob(card, { width: WIDTH, height: HEIGHT, scale: 1, type: 'image/png' }),
      )
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setImage({ url, blob });
      })
      .catch(() => !cancelled && setError('Could not make the image.'));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [showItems]);

  const fileName = `${name.replace(/[^\w-]+/g, '-').toLowerCase() || 'split'}.png`;

  const share = async () => {
    if (image == null) return;
    const file = new File([image.blob], fileName, { type: 'image/png' });
    await deliverFile(file, { title: name, save: download });
  };

  const download = () => {
    if (image == null) return;
    saveFile(image.url, fileName);
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
          style={{ width: WIDTH, height: HEIGHT }}
        >
          <div className={classes.brand}>
            <ArrowsSplit size={28} />
            Splitfoolish
          </div>
          <div className={classes.title}>{name}</div>
          <div className={classes.meta}>
            {[
              range,
              plural(people.length, 'person', 'people'),
              formatMoney(totals.totalCents, currency),
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>

          <div className={classes.heading}>Who pays who</div>
          <div className={classes.transfers}>
            {totals.transfers.length === 0 && (
              <div className={classes.meta}>
                {items.length > 0 ? 'Everyone is settled up.' : 'No items yet.'}
              </div>
            )}
            {totals.transfers.map((t) => (
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
                    <span className={classes.itemPayer}>
                      <PersonName person={i.payer} /> paid
                    </span>
                    <span className={classes.itemAmount}>
                      {formatMoney(toCents(i.cost), currency)}
                      {i.original && (
                        <span className={classes.itemOriginal}>
                          {formatMoney(toCents(i.original.amount), i.original.currency)}
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
