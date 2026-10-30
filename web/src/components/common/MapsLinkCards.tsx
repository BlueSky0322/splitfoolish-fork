import { MapPin } from '@phosphor-icons/react';
import { isMapsLink } from '@shared/links';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../../api';
import { MiniMap } from '../ui/MiniMap';
import { findLinks } from '../../utils/text';
import classes from './MapsLinkCards.module.css';

/** Side by side, a few more fit; past that they'd bury the notes they come from */
const MAX_CARDS = 5;

/**
 * The Google Maps links in some notes as cards, as a chat app shows them: the place's
 * picture (or a small map of where it is), name and address, opening the link. Until the
 * place is known (or without a connection) the card is the link with a pin. Several
 * sit side by side, to swipe through.
 */
export function MapsLinkCards({ text }: { text: string | null }) {
  const links = useMemo(
    () =>
      [...new Set(findLinks(text ?? '').flatMap((p) => (p.href ? [p.href] : [])))]
        .filter(isMapsLink)
        .slice(0, MAX_CARDS),
    [text],
  );
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
const usePreview = (url: string) =>
  useQuery({
    queryKey: ['link-preview', url],
    queryFn: () => api.linkPreview(url),
    // A place's name and address don't change while the app is open
    staleTime: Infinity,
    retry: 1,
  });

/** A Maps link in the notes' text: the place's name with a pin, not its address */
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
      <MapPin
        size={14}
        weight="fill"
        className={classes.namePin}
      />
      {title ?? 'Google Maps'}
    </a>
  );
}

function MapsLinkCard({ url }: { url: string }) {
  const preview = usePreview(url);
  const place = preview.data?.title != null ? preview.data : null;
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
