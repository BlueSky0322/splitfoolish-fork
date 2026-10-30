import { MapPin } from '@phosphor-icons/react';
import { type Place, mapsUrl, placeLabel } from '@shared/places';
import { usePlaceName } from '../../split/place-names';
import { MiniMap } from '../ui/MiniMap';
import classes from './PlaceLink.module.css';

/**
 * Where something happened, opening in the phone's maps app (or Google Maps on the web);
 * with `map`, a small map of the spot above its name
 */
export function PlaceLink({ place, map = false }: { place: Place; map?: boolean }) {
  const label = placeLabel({ ...place, name: usePlaceName(place) });
  return (
    <a
      className={map ? `${classes.place} ${classes.withMap}` : classes.place}
      href={mapsUrl(place)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label}, open in Maps`}
      onClick={(e) => e.stopPropagation()}
    >
      {map && (
        <MiniMap
          className={classes.map}
          lat={place.lat}
          lng={place.lng}
          width={640}
          height={128}
        />
      )}
      <span className={classes.line}>
        <MapPin
          size={16}
          weight="fill"
          className={classes.pin}
        />
        <span className={classes.label}>{label}</span>
      </span>
    </a>
  );
}
