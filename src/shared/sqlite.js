// Minimal read-only SQLite reader, enough to read Anki collections: walks
// table and index B-trees (WITHOUT ROWID tables are index B-trees), follows
// overflow pages and decodes records. No SQL, no indexes: callers scan tables.
// Format: https://www.sqlite.org/fileformat2.html

const decoder = new TextDecoder();

/** Big-endian varint at bytes[pos] -> [value, length]. Exact up to 2^53. */
function varint(bytes, pos) {
  let value = 0;
  for (let i = 0; i < 8; i++) {
    const b = bytes[pos + i];
    value = value * 128 + (b & 0x7f);
    if (b < 0x80) return [value, i + 1];
  }
  return [value * 256 + bytes[pos + 8], 9];
}

// Bytes taken by serial types 0–9.
const SIZES = [0, 1, 2, 3, 4, 6, 8, 8, 0, 0];

/** A record (row payload) -> array of column values. */
function decodeRecord(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const [headerSize, n] = varint(buf, 0);
  const types = [];
  for (let p = n; p < headerSize;) {
    const [type, k] = varint(buf, p);
    types.push(type);
    p += k;
  }
  let off = headerSize;
  return types.map((type) => {
    const at = off;
    if (type >= 12) {
      const size = (type - (type % 2 ? 13 : 12)) / 2;
      off += size;
      const data = buf.subarray(at, at + size);
      return type % 2 ? decoder.decode(data) : data.slice();
    }
    off += SIZES[type] ?? 0;
    switch (type) {
      case 0: return null;
      case 1: return view.getInt8(at);
      case 2: return view.getInt16(at);
      case 3: return view.getInt8(at) * 0x10000 + view.getUint16(at + 1);
      case 4: return view.getInt32(at);
      case 5: return view.getInt16(at) * 0x100000000 + view.getUint32(at + 2);
      case 6: {
        const big = view.getBigInt64(at);
        return big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big;
      }
      case 7: return view.getFloat64(at);
      case 8: return 0;
      case 9: return 1;
      default: throw new Error(`Corrupt database: serial type ${type}`);
    }
  });
}

/**
 * Opens a database held in memory.
 * -> { tables(): string[], rows(name): Array<{ rowid, values }> }
 * `values` are in the stored column order: declaration order for ordinary
 * tables (an INTEGER PRIMARY KEY column is null there; use `rowid`), and
 * primary-key columns first for WITHOUT ROWID tables (whose `rowid` is null).
 */
export function openDb(bytes) {
  if (bytes.length < 100 || decoder.decode(bytes.subarray(0, 16)) !== 'SQLite format 3\0') {
    throw new Error('Not a SQLite database');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rawSize = view.getUint16(16);
  const pageSize = rawSize === 1 ? 65536 : rawSize;
  const usable = pageSize - bytes[20];
  const encoding = view.getUint32(56);
  if (encoding !== 0 && encoding !== 1) throw new Error('Only UTF-8 databases are supported');

  const pageStart = (n) => {
    const start = (n - 1) * pageSize;
    if (n < 1 || start + pageSize > bytes.length) throw new Error(`Corrupt database: no page ${n}`);
    return start;
  };

  // A cell's payload of `size` bytes starting at `pos`, joined with its overflow pages.
  function payload(pos, size, index) {
    const maxLocal = index ? Math.floor(((usable - 12) * 64) / 255) - 23 : usable - 35;
    if (size <= maxLocal) return bytes.subarray(pos, pos + size);
    const minLocal = Math.floor(((usable - 12) * 32) / 255) - 23;
    let local = minLocal + ((size - minLocal) % (usable - 4));
    if (local > maxLocal) local = minLocal;
    const out = new Uint8Array(size);
    out.set(bytes.subarray(pos, pos + local));
    let filled = local;
    let next = view.getUint32(pos + local);
    while (filled < size) {
      if (!next) throw new Error('Corrupt database: overflow chain too short');
      const start = pageStart(next);
      const n = Math.min(usable - 4, size - filled);
      out.set(bytes.subarray(start + 4, start + 4 + n), filled);
      filled += n;
      next = view.getUint32(start);
    }
    return out;
  }

  function* walk(n, depth = 0) {
    if (depth > 64) throw new Error('Corrupt database: B-tree too deep');
    const start = pageStart(n);
    const header = n === 1 ? 100 : start; // page 1 starts with the 100-byte file header
    const type = bytes[header];
    const cells = view.getUint16(header + 3);
    const interior = type === 0x02 || type === 0x05;
    const pointers = header + (interior ? 12 : 8);
    for (let i = 0; i < cells; i++) {
      const cell = start + view.getUint16(pointers + 2 * i);
      if (type === 0x0d) { // table leaf: size, rowid, payload
        const [size, a] = varint(bytes, cell);
        const [rowid, b] = varint(bytes, cell + a);
        yield { rowid, values: decodeRecord(payload(cell + a + b, size, false)) };
      } else if (type === 0x05) { // table interior: left child, key
        yield* walk(view.getUint32(cell), depth + 1);
      } else if (type === 0x0a) { // index leaf: size, payload
        const [size, a] = varint(bytes, cell);
        yield { rowid: null, values: decodeRecord(payload(cell + a, size, true)) };
      } else if (type === 0x02) { // index interior: left child, then this cell's own row
        yield* walk(view.getUint32(cell), depth + 1);
        const [size, a] = varint(bytes, cell + 4);
        yield { rowid: null, values: decodeRecord(payload(cell + 4 + a, size, true)) };
      } else {
        throw new Error(`Corrupt database: page ${n} has type ${type}`);
      }
    }
    if (interior) yield* walk(view.getUint32(header + 8), depth + 1);
  }

  const tables = new Map();
  for (const { values: [type, name, , rootpage] } of walk(1)) {
    if (type === 'table' && rootpage > 0) tables.set(name, rootpage);
  }
  return {
    tables: () => [...tables.keys()],
    rows(name) {
      if (!tables.has(name)) throw new Error(`No table named ${name}`);
      return [...walk(tables.get(name))];
    },
  };
}
