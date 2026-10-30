import { MapPin } from '@phosphor-icons/react';
import classes from './MiniMap.module.css';

/** About a few streets across: enough to see where, close enough to know the spot */
const ZOOM = 16;
/** Tiles are 256 pixels; on sharp screens the next zoom's tiles are drawn at half size */
const TILE = 256;

interface MiniMapProps {
  lat: number;
  lng: number;
  /** As wide and tall as the map can be drawn, so enough tiles are loaded to fill it */
  width: number;
  height: number;
  className?: string;
}

/**
 * A small map with a pin on a position, from OpenStreetMap's tiles, as a photos app
 * shows where a picture was taken. Only a picture: what's around it says where it opens.
 */
export function MiniMap({ lat, lng, width, height, className }: MiniMapProps) {
  const sharp = typeof window !== 'undefined' && window.devicePixelRatio > 1;
  const zoom = sharp ? ZOOM + 1 : ZOOM;
  const size = sharp ? TILE / 2 : TILE;
  const tiles = 2 ** zoom;
  // Where the position falls on the world's map at this zoom, in tiles
  const x = ((lng + 180) / 360) * tiles;
  const rad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * tiles;
  const [col, row] = [Math.floor(x), Math.floor(y)];
  // The position's tile and enough around it to fill the map either side
  const across = Math.ceil(width / 2 / size);
  const down = Math.ceil(height / 2 / size);
  const shown: { key: string; src: string; left: number; top: number }[] = [];
  for (let dy = -down; dy <= down; dy++) {
    for (let dx = -across; dx <= across; dx++) {
      const ty = row + dy;
      if (ty < 0 || ty >= tiles) continue;
      // Across the date line the map carries on round the world
      const tx = (((col + dx) % tiles) + tiles) % tiles;
      shown.push({
        key: `${dx},${dy}`,
        src: `https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`,
        left: (col + dx - x) * size,
        top: (row + dy - y) * size,
      });
    }
  }
  return (
    <span
      className={className ? `${classes.map} ${className}` : classes.map}
      aria-hidden
    >
      <span className={classes.tiles}>
        {shown.map((t) => (
          <img
            key={t.key}
            className={classes.tile}
            src={t.src}
            alt=""
            loading="lazy"
            draggable={false}
            style={{
              width: size,
              height: size,
              left: `calc(50% + ${t.left.toFixed(1)}px)`,
              top: `calc(50% + ${t.top.toFixed(1)}px)`,
            }}
          />
        ))}
      </span>
      <MapPin
        className={classes.pin}
        size={26}
        weight="fill"
      />
      <span className={classes.credit}>© OpenStreetMap</span>
    </span>
  );
}
