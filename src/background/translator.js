// Translation queue shared by all tabs: memory cache -> IndexedDB cache ->
// batched requests to the native host. Identical texts requested while a
// translation is in flight share one request.

import { request } from './native.js';
import * as db from './db.js';

const BATCH_ITEMS = 16;
const BATCH_CHARS = 3000;
const MAX_IN_FLIGHT = 2;
const MEMORY_CAP = 5000;

const memory = new Map(); // key -> translation (insertion order = LRU order)
const waiting = new Map(); // key -> { item, callbacks: [{ resolve, reject }] }
const queue = []; // keys, FIFO
let inFlight = 0;
let flushTimer = null;

const keyOf = (item) => (typeof item === 'string' ? item : JSON.stringify(item));

function remember(key, value) {
  memory.delete(key);
  memory.set(key, value);
  if (memory.size > MEMORY_CAP) memory.delete(memory.keys().next().value);
}

/**
 * Translates items (strings or segment arrays). Resolves with one result per
 * item; null where the host could not translate. Rejects (with err.code) when
 * the host itself is unavailable.
 */
export async function translateItems(items) {
  const keys = items.map(keyOf);
  const results = new Array(items.length).fill(null);
  const misses = [];
  keys.forEach((key, i) => {
    if (memory.has(key)) {
      results[i] = memory.get(key);
      remember(key, results[i]);
    } else {
      misses.push(i);
    }
  });
  if (!misses.length) return results;

  const stored = await db.getMany('translations', misses.map((i) => keys[i])).catch(() => []);
  const remaining = [];
  misses.forEach((i, j) => {
    const row = stored[j];
    if (row) {
      results[i] = row.value;
      remember(keys[i], row.value);
    } else {
      remaining.push(i);
    }
  });

  await Promise.all(remaining.map((i) => enqueue(keys[i], items[i]).then((value) => { results[i] = value; })));
  return results;
}

function enqueue(key, item) {
  return new Promise((resolve, reject) => {
    let entry = waiting.get(key);
    if (!entry) {
      entry = { item, callbacks: [] };
      waiting.set(key, entry);
      queue.push(key);
    }
    entry.callbacks.push({ resolve, reject });
    flushTimer ??= setTimeout(() => { flushTimer = null; pump(); }, 15);
  });
}

function pump() {
  while (inFlight < MAX_IN_FLIGHT && queue.length) {
    const batch = [];
    let chars = 0;
    while (queue.length && batch.length < BATCH_ITEMS) {
      const len = queue[0].length;
      if (batch.length && chars + len > BATCH_CHARS) break;
      batch.push(queue.shift());
      chars += len;
    }
    inFlight++;
    sendBatch(batch).finally(() => { inFlight--; pump(); });
  }
}

async function sendBatch(keys) {
  const items = keys.map((key) => waiting.get(key).item);
  const finish = (key, fn) => {
    const entry = waiting.get(key);
    waiting.delete(key);
    entry?.callbacks.forEach(fn);
  };
  try {
    const { translations } = await request({ type: 'translate', texts: items });
    const rows = [];
    const now = Date.now();
    keys.forEach((key, i) => {
      const value = translations?.[i] ?? null;
      if (value !== null) {
        remember(key, value);
        rows.push({ key, value, ts: now });
      }
      finish(key, ({ resolve }) => resolve(value));
    });
    if (rows.length) db.putMany('translations', rows).catch((err) => console.warn('zh-immerse cache write failed', err));
  } catch (err) {
    keys.forEach((key) => finish(key, ({ reject }) => reject(err)));
  }
}
