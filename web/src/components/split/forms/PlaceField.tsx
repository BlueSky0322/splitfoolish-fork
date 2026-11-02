import { ActionIcon, Button } from '@mantine/core';
import { Crosshair, MapPin, X } from '@phosphor-icons/react';
import { type Place, mapsUrl, placeLabel, toPlace } from '@shared/places';
import { useState } from 'react';
import { currentPosition } from '../../../utils/here';
import { usePlaceName } from '../../../split/place-names';
import classes from './PlaceField.module.css';

/**
 * Where an item was paid for: the place, opening in Maps, with a way to take it off; or,
 * without one, Use my current location. A receipt photo or a Maps link in the notes fill
 * it in by themselves (see ItemForm).
 */
export function PlaceField({
  place,
  onChange,
}: {
  place: Place | null;
  onChange: (place: Place | null) => void;
}) {
  const name = usePlaceName(place);
  const [finding, setFinding] = useState(false);
  const [failed, setFailed] = useState(false);
  const takeMine = async () => {
    setFinding(true);
    setFailed(false);
    const here = await currentPosition();
    setFinding(false);
    if (here) onChange(toPlace(here.lat, here.lng));
    else setFailed(true);
  };
  return (
    <div className={classes.field}>
      <div className={classes.label}>Location</div>
      {place ? (
        <div className={classes.place}>
          <MapPin
            size={16}
            weight="fill"
            className={classes.pin}
          />
          <a
            className={classes.name}
            href={mapsUrl(place)}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in Maps"
          >
            {placeLabel({ ...place, name })}
          </a>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label="Remove location"
            onClick={() => {
              setFailed(false);
              onChange(null);
            }}
          >
            <X size={14} />
          </ActionIcon>
        </div>
      ) : (
        <Button
          variant="default"
          size="sm"
          leftSection={<Crosshair size={16} />}
          loading={finding}
          onClick={() => void takeMine()}
        >
          Use my current location
        </Button>
      )}
      {failed && (
        <div className={classes.hint}>
          Couldn't get your location. Allow it for this app in your browser's settings.
        </div>
      )}
    </div>
  );
}
