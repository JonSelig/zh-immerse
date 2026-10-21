import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_REPORTS, cleanReport, addReport, removeReport, exportReports } from '../../src/shared/reports.js';

const raw = {
  swapEn: 'right', swapZh: '是', en: 'Lockers are on your right.', zh: '储物柜在您的右边。',
  level: 1, url: 'https://example.com/station?ticket=123#map',
};

test('cleanReport keeps the fields, strips the query and cuts long text', () => {
  const r = cleanReport(raw, { id: 'a', now: 5 });
  assert.deepEqual(r, { id: 'a', ts: 5, swapEn: 'right', swapZh: '是', en: raw.en, zh: raw.zh, level: 1, url: 'https://example.com/station' });
  const long = cleanReport({ ...raw, swapEn: 'x'.repeat(100), en: 'y'.repeat(3000), zh: '中'.repeat(3000) }, { id: 'b', now: 1 });
  assert.equal(long.swapEn.length, 64);
  assert.equal(long.en.length, 2000);
  assert.equal(long.zh.length, 2000);
});

test('cleanReport rejects reports without a swap or with a bad level', () => {
  assert.equal(cleanReport({ ...raw, swapEn: '' }, { id: 'a', now: 1 }), null);
  assert.equal(cleanReport({ ...raw, swapZh: 5 }, { id: 'a', now: 1 }), null);
  assert.equal(cleanReport({ ...raw, level: 7 }, { id: 'a', now: 1 }), null);
  assert.equal(cleanReport({ ...raw, level: 1.5 }, { id: 'a', now: 1 }), null);
  assert.equal(cleanReport(null, { id: 'a', now: 1 }), null);
  assert.equal(cleanReport({ ...raw, url: 'javascript:alert(1)' }, { id: 'a', now: 1 }).url, '');
});

test('addReport puts the newest first and stores a repeat once', () => {
  const a = cleanReport(raw, { id: 'a', now: 1 });
  const b = cleanReport({ ...raw, swapEn: 'like' }, { id: 'b', now: 2 });
  let list = addReport(addReport([], a), b);
  assert.deepEqual(list.map((r) => r.id), ['b', 'a']);
  list = addReport(list, cleanReport(raw, { id: 'c', now: 3 }));
  assert.deepEqual(list.map((r) => [r.id, r.ts]), [['a', 3], ['b', 2]]); // same report: kept its id, new time
});

test('addReport keeps at most MAX_REPORTS', () => {
  let list = [];
  for (let i = 0; i < MAX_REPORTS + 5; i++) list = addReport(list, cleanReport({ ...raw, en: `s${i}` }, { id: `r${i}`, now: i }));
  assert.equal(list.length, MAX_REPORTS);
  assert.equal(list[0].id, `r${MAX_REPORTS + 4}`);
  assert.equal(list.at(-1).id, 'r5');
});

test('removeReport and exportReports', () => {
  const list = addReport([], cleanReport(raw, { id: 'a', now: 1 }));
  assert.deepEqual(removeReport(list, 'a'), []);
  assert.deepEqual(removeReport(list, 'zz'), list);
  assert.deepEqual(exportReports(list), { version: 1, reports: list });
});
