import { MapPin } from '@phosphor-icons/react';
import { type Place, mapsUrl, placeLabel } from '@shared/places';
import classes from './PlaceLink.module.css';

/** Where something happened, opening in the phone's maps app (or Google Maps on the web) */
export function PlaceLink({ place }: { place: Place }) {
  return (
    <a
      className={classes.place}
      href={mapsUrl(place)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${placeLabel(place)}, open in Maps`}
      onClick={(e) => e.stopPropagation()}
    >
      <MapPin
        size={16}
        weight="fill"
        className={classes.pin}
      />
      <span className={classes.label}>{placeLabel(place)}</span>
    </a>
  );
}
