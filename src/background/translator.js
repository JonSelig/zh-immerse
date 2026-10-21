// Translation queue shared by all tabs: memory cache -> IndexedDB cache ->
// batched requests to the native host. Identical texts requested while a
// translation is in flight share one request. Text on screen goes before
// text near it (see shared/queue.js). The IndexedDB cache holds the
// text of pages the user has read, so it is capped and can be cleared.
//
// Both caches are kept per site. With one shared cache, a page could insert
// another site's exact text and time how fast it turns into Chinese: a cache
// hit would show the user had read that text before.

import { request } from './native.js';
import * as db from './db.js';
import { Lanes } from '../shared/queue.js';

// Apple's translator works through items one at a time (about 0.35 s per
// sentence) and a batch's results come back together, so batching saves
// nothing: one item per request shows each paragraph as soon as it's done.
// One request in flight, so each next item is picked from the latest
// on-screen requests.
const BATCH_ITEMS = 1;
const BATCH_CHARS = 3000;
const MAX_IN_FLIGHT = 1;
const MEMORY_CAP = 5000;
const STORED_CAP = 50_000; // rows kept in IndexedDB, oldest dropped first
const PRUNE_EVERY = 500; // stored rows between prunes (and once after startup)

const memory = new Map(); // key -> translation (insertion order = LRU order)
const waiting = new Map(); // key -> { item, persist, callbacks: [{ resolve, reject }] }
const lanes = new Lanes(); // waiting keys, on screen first
let inFlight = 0;
let flushTimer = null;
let writesSincePrune = PRUNE_EVERY;

const keyOf = (site, item) => `${site}\n${typeof item === 'string' ? item : JSON.stringify(item)}`;

function remember(key, value) {
  memory.delete(key);
  memory.set(key, value);
  if (memory.size > MEMORY_CAP) memory.delete(memory.keys().next().value);
}

/**
 * Translates items (strings or segment arrays). Resolves with one result per
 * item; null where the host could not translate. Rejects (with err.code) when
 * the host itself is unavailable. `site` is the hostname of the tab asking,
 * which selects the cache partition. With persist: false (private windows),
 * new translations aren't kept in either cache. urgent: the text is on screen.
 */
export async function translateItems(items, { site = '', persist = true, urgent = true } = {}) {
  const keys = items.map((item) => keyOf(site, item));
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

  await Promise.all(remaining.map((i) => enqueue(keys[i], items[i], persist, urgent).then((value) => { results[i] = value; })));
  return results;
}

/** Moves waiting items (now on screen) ahead of text near the screen. */
export function prioritize(items, { site = '' } = {}) {
  for (const item of items) lanes.promote(keyOf(site, item));
}

/** Empties both caches. */
export function clearCache() {
  memory.clear();
  return db.clear('translations');
}

function enqueue(key, item, persist, urgent) {
  return new Promise((resolve, reject) => {
    let entry = waiting.get(key);
    if (!entry) {
      entry = { item, persist: false, callbacks: [] };
      waiting.set(key, entry);
      lanes.add(key, urgent);
    } else if (urgent) {
      lanes.promote(key); // no-op once it's in flight
    }
    entry.persist ||= persist; // kept if any tab asking for it may keep it
    entry.callbacks.push({ resolve, reject });
    flushTimer ??= setTimeout(() => { flushTimer = null; pump(); }, 15);
  });
}

function pump() {
  while (inFlight < MAX_IN_FLIGHT && lanes.size) {
    const batch = lanes.take(BATCH_ITEMS, BATCH_CHARS, (key) => key.length);
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
