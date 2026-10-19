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
