// A zip file made in the browser, for downloading several photos as one file. Photos
// are compressed already (JPEG, PNG, WebP), so they go in as they are: squeezing them
// again would take time and save almost nothing.

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** When the file was made, shown by the zip tool */
  modified: Date;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The checksum every zip entry carries */
export function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Dates in the old DOS form zips use: local time, to two seconds, from 1980 */
function dosTime(d: Date) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Names are UTF-8, so any language's letters survive */
const UTF8_NAMES = 0x0800;
const VERSION = 20;

export function makeZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;
    const { time, date } = dosTime(entry.modified);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, VERSION, true);
    local.setUint16(6, UTF8_NAMES, true);
    local.setUint16(8, 0, true); // stored as is
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, entry.data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, VERSION, true);
    central.setUint16(6, VERSION, true);
    central.setUint16(8, UTF8_NAMES, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true);
    central.setUint32(24, size, true);
    central.setUint16(28, name.length, true);
    // Extra field, comment, disk, and file attributes all stay zero
    central.setUint32(42, offset, true);
    directory.push(new Uint8Array(central.buffer), name);

    offset += 30 + name.length + size;
  }

  const directorySize = directory.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...directory, new Uint8Array(end.buffer)], {
    type: 'application/zip',
  });
}
