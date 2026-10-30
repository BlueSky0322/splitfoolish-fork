import { MapPin } from '@phosphor-icons/react';
import { mapsLinksIn } from '@shared/links';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { linkPreviewQuery } from '../../split/link-previews';
import { shortLink } from '../../utils/text';
import { MiniMap } from '../ui/MiniMap';
import classes from './MapsLinkCards.module.css';

/**
 * The Google Maps links in some notes as cards, as a chat app shows them: the place's
 * picture (or a small map of where it is), name and address, opening the link. Until the
 * place is known (or without a connection) the card is the link with a pin. Several
 * sit side by side, to swipe through.
 */
export function MapsLinkCards({ text }: { text: string | null }) {
  const links = useMemo(() => mapsLinksIn(text ?? ''), [text]);
  if (links.length === 0) return null;
  return (
    <div
      className={classes.cards}
      data-many={links.length > 1 || undefined}
    >
      {links.map((url) => (
        <MapsLinkCard
          key={url}
          url={url}
        />
      ))}
    </div>
  );
}

/** What Google says a link is: shared by its card and its place in the notes */
const usePreview = (url: string) => useQuery(linkPreviewQuery(url));

/** A Maps link in the notes' text: the place's name with a pin, else its address, short */
export function MapsLinkName({ url }: { url: string }) {
  const title = usePreview(url).data?.title;
  return (
    <a
      className={classes.name}
      href={url}
      title={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      {title != null && (
        <MapPin
          size={14}
          weight="fill"
          className={classes.namePin}
        />
      )}
      {title ?? shortLink(url)}
    </a>
  );
}

function MapsLinkCard({ url }: { url: string }) {
  const preview = usePreview(url);
  const place = preview.data?.title != null ? preview.data : null;
  // Something shared from Google that turned out not to be a place has no card
  if (place == null && preview.isSuccess && /^https?:\/\/share\.google\//i.test(url)) return null;
  const site = preview.data?.site ?? siteOf(url);
  return (
    <a
      className={classes.card}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={place ? `${place.title}, on Google Maps` : 'Open in Google Maps'}
      onClick={(e) => e.stopPropagation()}
      data-loading={preview.isPending || undefined}
    >
      {place?.image ? (
        <img
          className={classes.image}
          src={place.image}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : place?.position ? (
        <MiniMap
          className={classes.image}
          lat={place.position.lat}
          lng={place.position.lng}
          width={112}
          height={120}
        />
      ) : (
        <span className={classes.pin}>
          <MapPin
            size={22}
            weight="fill"
          />
        </span>
      )}
      <span className={classes.text}>
        <span className={classes.title}>{place?.title ?? 'Google Maps'}</span>
        {place?.address && <span className={classes.address}>{place.address}</span>}
        {place?.detail && <span className={classes.detail}>{place.detail}</span>}
        <span className={classes.site}>{site}</span>
      </span>
    </a>
  );
}

/** "maps.app.goo.gl" from the link itself, while its card is still loading */
const siteOf = (url: string) => /^https?:\/\/(?:www\.)?([^/?#]+)/i.exec(url)?.[1] ?? url;
