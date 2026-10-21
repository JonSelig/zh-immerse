import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/shared/sqlite.js';
import { sqliteBytes } from '../helpers/anki.js';

const INTS = [0, 1, -1, 127, -128, 300, -30000, 8_000_000, -8_000_000, 2_000_000_000, -2_000_000_000,
  100_000_000_000, -100_000_000_000, 1792362261505, 2 ** 53 - 1];
const series = (n) => `(with recursive s(value) as (select 1 union all select value + 1 from s where value < ${n}) select value from s)`;

function fixture(pageSize) {
  const long = 'x'.repeat(pageSize * 3 + 17) + '中';
  const nameTail = 'y'.repeat(pageSize > 512 ? 40 : 300); // big keys force index overflow at 512
  const bytes = sqliteBytes(`
    create table t (id integer primary key, a, b text);
    ${INTS.map((n, i) => `insert into t values (${i + 1}, ${n}, 'n${i}');`).join('\n')}
    insert into t values (100, 1.5, '${long}');
    insert into t values (101, null, x'00ff10');
    insert into t (a, b) select value, 'row ' || value from ${series(2000)};
    create table w (k integer, o integer, name text, primary key (k, o)) without rowid;
    insert into w select value % 7, value, 'name ' || value || '${nameTail}' from ${series(3000)};
    create index ti on t(b);
  `, { pageSize });
  return { db: openDb(bytes), long };
}

for (const pageSize of [512, 4096, 65536]) {
  test(`reads tables at page size ${pageSize}`, () => {
    const { db, long } = fixture(pageSize);
    assert.deepEqual(db.tables().sort(), ['t', 'w']); // indexes aren't tables
    const rows = db.rows('t');
    assert.equal(rows.length, INTS.length + 2 + 2000); // spans many pages
    INTS.forEach((n, i) => {
      assert.equal(rows[i].rowid, i + 1);
      assert.equal(rows[i].values[0], null); // INTEGER PRIMARY KEY lives in rowid
      assert.equal(rows[i].values[1], n, `integer ${n}`);
      assert.equal(rows[i].values[2], `n${i}`);
    });
    const big = rows.find((r) => r.rowid === 100);
    assert.equal(big.values[1], 1.5);
    assert.equal(big.values[2], long); // overflow pages
    const blob = rows.find((r) => r.rowid === 101);
    assert.equal(blob.values[1], null);
    assert.deepEqual([...blob.values[2]], [0, 255, 16]);
  });

  test(`reads WITHOUT ROWID tables at page size ${pageSize}`, () => {
    const w = fixture(pageSize).db.rows('w');
    assert.equal(w.length, 3000);
    assert.ok(w.every((r) => r.rowid === null));
    // In primary-key order: (0, 7), (0, 14), ...
    assert.deepEqual(w.slice(0, 2).map((r) => r.values.slice(0, 2)), [[0, 7], [0, 14]]);
    assert.ok(w.every((r) => r.values[2].startsWith(`name ${r.values[1]}y`)));
  });
}

test('rejects files that are not SQLite databases', () => {
  assert.throws(() => openDb(new TextEncoder().encode('PK\x03\x04 not a database at all, sorry')), /Not a SQLite database/);
});

test('rejects unknown tables', () => {
  assert.throws(() => openDb(sqliteBytes('create table a (x);')).rows('b'), /No table named b/);
});

test('rejects a B-tree that visits a page twice', () => {
  const bytes = sqliteBytes(`
    create table t (id integer primary key, b text);
    insert into t (b) select 'row ' || value from (with recursive s(value) as (select 1 union all select value + 1 from s where value < 500) select value from s);
  `, { pageSize: 512 });
  let page = -1;
  for (let n = 1; n * 512 < bytes.length; n++) if (bytes[n * 512] === 0x05) { page = n; break; }
  assert.ok(page > 0, 'fixture has an interior page');
  const view = new DataView(bytes.buffer);
  view.setUint32(page * 512 + 8, page + 1); // right-most child is the page itself (pages are numbered from 1)
  assert.throws(() => openDb(bytes).rows('t'), /visited twice/);
});

test('rejects a record whose header is larger than the record', () => {
  const bytes = sqliteBytes("create table a (x text); insert into a values ('ZZZZZZ');");
  const at = bytes.indexOf(0x5a);
  assert.deepEqual([...bytes.subarray(at - 2, at)], [2, 25]); // header size, text(6)
  bytes[at - 2] = 0x7f;
  assert.throws(() => openDb(bytes).rows('a'), /bad record header/);
});
