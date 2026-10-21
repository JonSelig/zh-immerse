// Lookup history and saved words, persisted in IndexedDB.

import * as db from './db.js';
import { shouldCount, applyLookup, applySaved, mergeRecords, cleanRecord } from '../shared/history.js';

const recent = new Map(); // "word\0sentence" -> last counted time
let chain = Promise.resolve();

// Read-modify-write updates go through one chain so concurrent hovers from
// different tabs can't overwrite each other's counts.
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

export const getWord = (word) => db.get('words', word);

/** info: { word, pinyin, defs, zh, en, url } -> { count, saved, counted } */
export function recordLookup(info) {
  return serial(async () => {
    const existing = await db.get('words', info.word);
    if (!shouldCount(recent, `${info.word}\0${info.zh ?? ''}`, Date.now())) {
      return { count: existing?.count ?? 0, saved: !!existing?.saved, counted: false };
    }
    const next = applyLookup(existing, info, Date.now());
    await db.put('words', next);
    return { count: next.count, saved: next.saved, counted: true };
  });
}

export function setSaved(info, saved) {
  return serial(async () => {
    const next = applySaved(await db.get('words', info.word), info, saved, Date.now());
    await db.put('words', next);
    return { count: next.count, saved: next.saved };
  });
}

export const listWords = () => db.getAll('words');

export const deleteWord = (word) => serial(() => db.remove('words', word));

export function importWords(records) {
  return serial(async () => {
    const valid = (Array.isArray(records) ? records : []).map(cleanRecord).filter(Boolean);
    const existing = await db.getMany('words', valid.map((r) => r.word));
    await db.putMany('words', valid.map((r, i) => mergeRecords(existing[i], r)));
    return { imported: valid.length, skipped: (records?.length ?? 0) - valid.length };
  });
}

export async function stats() {
  const all = await db.getAll('words');
  return {
    lookedUp: all.filter((w) => w.count > 0).length,
    saved: all.filter((w) => w.saved).length,
  };
}
