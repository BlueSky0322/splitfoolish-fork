import { MapPin } from '@phosphor-icons/react';
import { isMapsLink } from '@shared/links';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../../api';
import { findLinks } from '../../utils/text';
import classes from './MapsLinkCards.module.css';

/** More than a few cards would bury the notes they come from */
const MAX_CARDS = 3;

/**
 * The Google Maps links in some notes as cards, as a chat app shows them: the place's
 * picture, name and address, opening the link. Until the place is known (or without a
 * connection) the card is the link with a pin.
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
    <div className={classes.cards}>
      {links.map((url) => (
        <MapsLinkCard
          key={url}
          url={url}
        />
      ))}
    </div>
  );
}

function MapsLinkCard({ url }: { url: string }) {
  const preview = useQuery({
    queryKey: ['link-preview', url],
    queryFn: () => api.linkPreview(url),
    // A place's name and address don't change while the app is open
    staleTime: Infinity,
    retry: 1,
  });
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
