import { MapPin } from '@phosphor-icons/react';
import { positionInLink } from '@shared/links';
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

/** A Maps link in the notes' text: the place's name with a pin, else its address, short */
export function MapsLinkName({ url, className }: { url: string; className?: string }) {
  // Drawn as a place once it's known which; until then, as any other link
  const known = (usePreview(url).data?.title ?? unnamed(url)) != null;
  return (
    <a
      className={className ?? classes.name}
      data-place={known || undefined}
      href={url}
      title={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      <MapsLinkLabel url={url} />
    </a>
  );
}

/** The place a Maps link names, with a pin; until it's known, its plus code or address */
export function MapsLinkLabel({ url }: { url: string }) {
  const title = usePreview(url).data?.title ?? unnamed(url);
  return (
    <>
      {title != null && (
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
