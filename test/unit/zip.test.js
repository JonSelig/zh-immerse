import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readZip } from '../../src/shared/zip.js';
import { makeZip } from '../helpers/anki.js';

const text = (bytes) => new TextDecoder().decode(bytes);

test('reads stored and deflated entries', async () => {
  for (const method of [0, 8]) {
    const zip = readZip(makeZip({ 'a.txt': 'hello', 'dir/中.txt': '你好'.repeat(1000) }, { method }));
    assert.deepEqual([...zip.keys()], ['a.txt', 'dir/中.txt']);
    assert.equal(text(await zip.get('a.txt')()), 'hello');
    assert.equal(text(await zip.get('dir/中.txt')()), '你好'.repeat(1000));
  }
});

test('accepts an ArrayBuffer', async () => {
  const bytes = makeZip({ x: 'y' });
  const zip = readZip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.equal(text(await zip.get('x')()), 'y');
});

test('rejects files that are not zips', () => {
  assert.throws(() => readZip(new TextEncoder().encode('SQLite format 3\0 and more bytes here')), /Not a zip file/);
  assert.throws(() => readZip(new Uint8Array(0)), /Not a zip file/);
});

test('rejects zip64 archives', () => {
  const bytes = makeZip({ x: 'y' });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint16(bytes.length - 22 + 10, 0xffff, true); // entry count says "see zip64 record"
  assert.throws(() => readZip(bytes), /Zip64/);
});

test('rejects unknown compression methods and encrypted entries when read', async () => {
  const bytes = makeZip({ x: 'y' }, { method: 0 });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const central = bytes.length - 22 - 47; // one 46-byte entry + 1-byte name
  view.setUint16(central + 10, 12, true); // bzip2
  await assert.rejects(readZip(bytes).get('x')(), /unsupported compression method \(12\)/);
  view.setUint16(central + 10, 0, true);
  view.setUint16(central + 8, 1, true); // encrypted flag
  await assert.rejects(readZip(bytes).get('x')(), /encrypted/);
});

test('rejects entries that declare more than 256 MB uncompressed', async () => {
  for (const method of [0, 8]) {
    const bytes = makeZip({ x: 'y' }, { method });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const central = bytes.length - 22 - 47;
    view.setUint32(central + 24, 300 * 1024 * 1024, true);
    await assert.rejects(readZip(bytes).get('x')(), /too large/);
  }
});

test('stops inflating once an entry outgrows its declared size', async () => {
  const bytes = makeZip({ x: 'y'.repeat(5000) });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(bytes.length - 22 - 47 + 24, 10, true); // declared 10, really 5000
  await assert.rejects(readZip(bytes).get('x')(), /too large/);
});
