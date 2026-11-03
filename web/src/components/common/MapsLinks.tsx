import { MapPin } from '@phosphor-icons/react';
import { mapsLinksIn, positionInLink } from '@shared/links';
import { plusCodeLabel } from '@shared/places';
import { useQuery } from '@tanstack/react-query';
import { linkPreviewQuery } from '../../split/link-previews';
import { shortLink } from '../../utils/text';
import classes from './MapsLinks.module.css';

// Google Maps links in notes, read as the place each names: its name with a pin, from
// what Google says about the link (worker/links/preview.ts), or its plus code or short
// address until then

/** What Google says a link is */
const usePreview = (url: string) => useQuery(linkPreviewQuery(url));

/**
 * A Maps link in the notes: the place's name with a pin, else its address, short. Plain,
 * in the middle of a sentence, it's only the name, as any other link would be; the place
 * shows under the notes.
 */
export function MapsLinkName({
  url,
  className,
  plain = false,
  placeOnly = false,
}: {
  url: string;
  className?: string;
  plain?: boolean;
  /** Nothing unless it names a place */
  placeOnly?: boolean;
}) {
  // Drawn as a place once it's known which; until then, as any other link
  const known = (usePreview(url).data?.title ?? unnamed(url)) != null;
  if (placeOnly && !known) return null;
  return (
    <a
      className={className ?? classes.name}
      data-place={(known && !plain) || undefined}
      href={url}
      title={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      <MapsLinkLabel
        url={url}
        pin={!plain}
      />
    </a>
  );
}

/**
 * The places some notes link to, on a line of their own, each opening in Maps. A link
 * still in the text shown (`shown`) is here only once it's known to name a place.
 */
export function MapsLinkNames({
  notes,
  shown,
  className,
  linkClassName,
}: {
  notes: string;
  shown: string;
  className?: string;
  linkClassName?: string;
}) {
  const urls = mapsLinksIn(notes);
  if (urls.length === 0) return null;
  const inText = new Set(mapsLinksIn(shown));
  return (
    <div className={className ?? classes.names}>
      {urls.map((url) => (
        <MapsLinkName
          key={url}
          url={url}
          className={linkClassName}
          placeOnly={inText.has(url)}
        />
      ))}
    </div>
  );
}

/** The place a Maps link names, with a pin; until it's known, its plus code or address */
export function MapsLinkLabel({ url, pin = true }: { url: string; pin?: boolean }) {
  const title = usePreview(url).data?.title ?? unnamed(url);
  return (
    <>
      {pin && title != null && (
        <MapPin
          size={14}
          weight="fill"
          className={classes.namePin}
        />
      )}
      {title ?? shortLink(url)}
    </>
  );
}

/**
 * A link that says where it points (a dropped pin), before it's named or offline: its
 * plus code in full
 */
const unnamed = (url: string) => {
  const at = positionInLink(url, { pinOnly: true });
  return at && plusCodeLabel(at.lat, at.lng);
};
