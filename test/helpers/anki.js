// Builds small Anki-like files for tests: zips, zstd frames and SQLite
// databases shaped like Anki collections.

import { deflateRawSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const encoder = new TextEncoder();
const bytesOf = (content) => (typeof content === 'string' ? encoder.encode(content) : content);

/** A zip with each entry stored (method 0) or deflated (method 8). CRCs are left 0. */
export function makeZip(files, { method = 8 } = {}) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = bytesOf(content);
    const data = method === 8 ? deflateRawSync(raw) : Buffer.from(raw);
    const nameBytes = Buffer.from(encoder.encode(name));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const count = Object.keys(files).length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(central.reduce((n, b) => n + b.length, 0), 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, ...central, end]));
}

/** A SQLite database file made by running `sql`, as bytes. */
export function sqliteBytes(sql, { pageSize = 4096 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'zhi-sqlite-'));
  try {
    const file = join(dir, 'db.sqlite');
    const db = new DatabaseSync(file);
    db.exec(`pragma page_size = ${pageSize};`);
    db.exec(sql);
    db.close();
    return new Uint8Array(readFileSync(file));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A zstd frame holding `data` in raw (uncompressed) blocks: valid input for any zstd decoder. */
export function zstdRaw(data) {
  const MAX = 128 * 1024;
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  // Magic, then a header: single segment, 4-byte content size.
  const parts = [Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xa0]), size];
  for (let i = 0; i === 0 || i < data.length; i += MAX) {
    const chunk = data.subarray(i, i + MAX);
    const header = (chunk.length << 3) | (i + MAX >= data.length ? 1 : 0); // block type 0 = raw
    parts.push(Buffer.from([header & 0xff, (header >> 8) & 0xff, (header >> 16) & 0xff]), chunk);
  }
  return new Uint8Array(Buffer.concat(parts));
}

export const STUB_TEXT = 'Please update to the latest Anki version, then import the .colpkg/.apkg file again.';

const MID = 1700000000001; // notetype
const DID = 1700000000002; // deck
const SUB = 1700000000003; // subdeck holding the cards

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * An Anki collection database. `modern` puts field names in a `fields` table
 * and decks in a `decks` table (Anki 2.1.50+); otherwise they're JSON in `col`.
 * Columns are in Anki's order; unused trailing columns are left out.
 */
export function makeCollection({ modern = false, deck = 'Chinese 1', fields = ['Hanzi', 'Pinyin', 'Meaning'], notes = [] } = {}) {
  const models = modern ? '' : JSON.stringify({ [MID]: { id: MID, name: 'Vocab', flds: fields.map((name, ord) => ({ name, ord })) } });
  const decks = modern ? '' : JSON.stringify({ 1: { id: 1, name: 'Default' }, [DID]: { id: DID, name: deck }, [SUB]: { id: SUB, name: `${deck}::L01` } });
  const sql = [
    'create table col (id integer primary key, crt integer, mod integer, scm integer, ver integer, dty integer, usn integer, ls integer, conf text, models text, decks text, dconf text, tags text);',
    'create table notes (id integer primary key, guid text, mid integer, mod integer, usn integer, tags text, flds text, sfld integer, csum integer, flags integer, data text);',
    'create table cards (id integer primary key, nid integer, did integer, ord integer);',
    `insert into col values (1, 0, 0, 0, 11, 0, 0, 0, '{}', ${q(models)}, ${q(decks)}, '{}', '{}');`,
  ];
  if (modern) {
    sql.push(
      'create table fields (ntid integer not null, ord integer not null, name text not null, config blob not null, primary key (ntid, ord)) without rowid;',
      'create table decks (id integer primary key not null, name text not null, mtime_secs integer, usn integer, common blob, kind blob);',
      ...fields.map((name, ord) => `insert into fields values (${MID}, ${ord}, ${q(name)}, x'');`),
      `insert into decks values (1, 'Default', 0, 0, x'', x''), (${DID}, ${q(deck)}, 0, 0, x'', x''), (${SUB}, ${q(`${deck}\x1fL01`)}, 0, 0, x'', x'');`,
    );
  }
  notes.forEach((values, i) => {
    sql.push(
      `insert into notes values (${i + 1}, 'g${i}', ${MID}, 0, 0, '', ${q(values.join('\x1f'))}, ${q(values[0])}, 0, 0, '');`,
      `insert into cards values (${i + 1}, ${i + 1}, ${SUB}, 0);`,
    );
  });
  return sqliteBytes(sql.join('\n'));
}

/**
 * An .apkg. Modern: zstd collection.anki21b plus the stub collection.anki2,
 * like current Anki exports. Legacy: a plain collection.anki2.
 * stubOnly: just the stub, as if the real collection were missing.
 */
export function makeApkg({ modern = false, stubOnly = false, ...collection } = {}) {
  const stub = () => makeCollection({ fields: ['Front', 'Back'], notes: [[STUB_TEXT, '']] });
  const files = {};
  if (stubOnly) {
    files['collection.anki2'] = stub();
  } else if (modern) {
    files['collection.anki2'] = stub();
    files['collection.anki21b'] = zstdRaw(makeCollection({ ...collection, modern: true }));
    files.meta = new Uint8Array([8, 3]);
  } else {
    files['collection.anki2'] = makeCollection(collection);
  }
  files.media = '{}';
  return makeZip(files);
}
