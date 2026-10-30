import { ActionIcon, Loader, TextInput, UnstyledButton } from '@mantine/core';
import { Crosshair, MagnifyingGlass, MapPin, X } from '@phosphor-icons/react';
import { type Place, mapsUrl, placeLabel, toPlace } from '@shared/places';
import { isMapsLink } from '@shared/links';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { linkPreviewQuery } from '../../../split/link-previews';
import { currentPosition } from '../../../utils/here';
import { MIN_PLACE_SEARCH, usePlaceName, usePlaceSearch } from '../../../split/place-names';
import classes from './PlaceField.module.css';

/**
 * Where an item was paid for: the place, opening in Maps, with a way to take it off; or,
 * without one, a search for it by name (places near `near` first) and Use my current
 * location. A Google Maps link pasted into the search is the place it points at, where
 * the link says exactly; one that only names it searches for that name. A receipt photo,
 * a Maps link in the notes or, for a new item, where the phone is fill it in by
 * themselves (see ItemForm).
 */
export function PlaceField({
  place,
  near,
  onChange,
}: {
  place: Place | null;
  near: { lat: number; lng: number } | null;
  onChange: (place: Place | null) => void;
}) {
  const name = usePlaceName(place);
  const [text, setText] = useState('');
  const pasted = isMapsLink(text.trim()) ? text.trim() : null;
  const linked = useQuery({ ...linkPreviewQuery(pasted ?? ''), enabled: pasted != null });
  const linkedAt = linked.data?.position;
  const fromLink =
    pasted != null && linkedAt
      ? toPlace(linkedAt.lat, linkedAt.lng, linked.data?.title ?? null)
      : null;
  // A link that only names its place: that name, searched for
  const searched = pasted == null ? text : linkedAt ? '' : linked.data?.title ?? '';
  const search = usePlaceSearch(place ? '' : searched, near);
  const [finding, setFinding] = useState(false);
  const [failed, setFailed] = useState(false);
  const choose = (chosen: Place | null) => {
    setText('');
    setFailed(false);
    onChange(chosen);
  };
  const takeMine = async () => {
    setFinding(true);
    setFailed(false);
    const here = await currentPosition();
    setFinding(false);
    if (here) choose(toPlace(here.lat, here.lng));
    else setFailed(true);
  };
  const typed = searched.trim().length >= MIN_PLACE_SEARCH;
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
            onClick={() => choose(null)}
          >
            <X size={14} />
          </ActionIcon>
        </div>
      ) : (
        <div className={classes.search}>
          <TextInput
            aria-label="Search for a place"
            placeholder="Search for a place"
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            // Enter picks the best match rather than sending the form
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const best = search.places[0];
              if (fromLink) choose(fromLink);
              else if (best) choose(toPlace(best.lat, best.lng, best.name));
            }}
            leftSection={<MagnifyingGlass size={16} />}
            rightSection={search.searching ? <Loader size={14} /> : null}
            autoComplete="off"
            enterKeyHint="search"
          />
          <ul
            className={classes.options}
            aria-label="Places"
          >
            <li>
              <UnstyledButton
                className={classes.option}
                onClick={() => void takeMine()}
                disabled={finding}
              >
                {finding ? (
                  <Loader size={16} />
                ) : (
                  <Crosshair
                    size={16}
                    className={classes.here}
                  />
                )}
                <span className={classes.optionName}>Use my current location</span>
              </UnstyledButton>
            </li>
            {fromLink && (
              <li>
                <UnstyledButton
                  className={classes.option}
                  onClick={() => choose(fromLink)}
                >
                  <MapPin
                    size={16}
                    weight="fill"
                    className={classes.pin}
                  />
                  <span className={classes.optionText}>
                    <span className={classes.optionName}>{placeLabel(fromLink)}</span>
                    <span className={classes.address}>From the link</span>
                  </span>
                </UnstyledButton>
              </li>
            )}
            {search.places.map((p) => (
              <li key={`${p.lat},${p.lng},${p.name}`}>
                <UnstyledButton
                  className={classes.option}
                  onClick={() => choose(toPlace(p.lat, p.lng, p.name))}
                >
                  <MapPin
                    size={16}
                    className={classes.pin}
                  />
                  <span className={classes.optionText}>
                    <span className={classes.optionName}>{p.name}</span>
                    {p.address && <span className={classes.address}>{p.address}</span>}
                  </span>
                </UnstyledButton>
              </li>
            ))}
          </ul>
          {typed && search.failed && (
            <div className={classes.hint}>
              Search isn't answering right now. Try again, or use your current location.
            </div>
          )}
          {typed && search.searched && !search.searching && search.places.length === 0 && (
            <div className={classes.hint}>No places found. Try the town or street as well.</div>
          )}
          {pasted != null && !linkedAt && linked.data?.title != null && (
            <div className={classes.hint}>
              This link doesn't say exactly where {linked.data.title} is. Pick it from the list, or
              search with its street or town.
            </div>
          )}
          {pasted != null && linked.isSuccess && linked.data.title == null && (
            <div className={classes.hint}>This link doesn't say which place it is.</div>
          )}
        </div>
      )}
      {failed && (
        <div className={classes.hint}>
          Couldn't get your location. Allow it for this app in your browser's settings.
        </div>
      )}
    </div>
  );
}
