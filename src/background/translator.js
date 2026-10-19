// Translation queue shared by all tabs: memory cache -> IndexedDB cache ->
// batched requests to the native host. Identical texts requested while a
// translation is in flight share one request. The IndexedDB cache holds the
// text of pages the user has read, so it is capped and can be cleared.

import { request } from './native.js';
import * as db from './db.js';

const BATCH_ITEMS = 16;
const BATCH_CHARS = 3000;
const MAX_IN_FLIGHT = 2;
const MEMORY_CAP = 5000;
const STORED_CAP = 50_000; // rows kept in IndexedDB, oldest dropped first
const PRUNE_EVERY = 500; // stored rows between prunes (and once after startup)

const memory = new Map(); // key -> translation (insertion order = LRU order)
const waiting = new Map(); // key -> { item, persist, callbacks: [{ resolve, reject }] }
const queue = []; // keys, FIFO
let inFlight = 0;
let flushTimer = null;
let writesSincePrune = PRUNE_EVERY;

const keyOf = (item) => (typeof item === 'string' ? item : JSON.stringify(item));

function remember(key, value) {
  memory.delete(key);
  memory.set(key, value);
  if (memory.size > MEMORY_CAP) memory.delete(memory.keys().next().value);
}

/**
 * Translates items (strings or segment arrays). Resolves with one result per
 * item; null where the host could not translate. Rejects (with err.code) when
 * the host itself is unavailable. With persist: false (private windows), new
 * translations aren't kept in either cache.
 */
export async function translateItems(items, { persist = true } = {}) {
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

  await Promise.all(remaining.map((i) => enqueue(keys[i], items[i], persist).then((value) => { results[i] = value; })));
  return results;
}

/** Empties both caches. */
export function clearCache() {
  memory.clear();
  return db.clear('translations');
}

function enqueue(key, item, persist) {
  return new Promise((resolve, reject) => {
    let entry = waiting.get(key);
    if (!entry) {
      entry = { item, persist: false, callbacks: [] };
      waiting.set(key, entry);
      queue.push(key);
    }
    entry.persist ||= persist; // kept if any tab asking for it may keep it
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
      if (value !== null && waiting.get(key)?.persist) {
        remember(key, value);
        rows.push({ key, value, ts: now });
      }
      finish(key, ({ resolve }) => resolve(value));
    });
    if (rows.length) store(rows);
  } catch (err) {
    keys.forEach((key) => finish(key, ({ reject }) => reject(err)));
  }
}

function store(rows) {
  writesSincePrune += rows.length;
  const prune = writesSincePrune >= PRUNE_EVERY;
  if (prune) writesSincePrune = 0;
  db.putMany('translations', rows)
    .then(() => prune && db.pruneOldest('translations', STORED_CAP))
    .catch((err) => console.warn('zh-immerse cache write failed', err));
}
