// My words: the user's own list of Chinese words (imported from Anki decks or
// added by hand), and the English -> Chinese map that level 0 swaps with.
// Pure functions; the background and the My words page share them.
//
// A word stands for every meaning you could know it by, not only the ones
// its flashcard lists: the card's English plus every CC-CEDICT definition
// for the card's pronunciation (中 zhōng: middle, among, during…, but not
// zhòng: to hit). As at the HSK levels, a swap also needs the Chinese to
// appear in Apple's translation of the sentence (see diglot.js).

import { toMarks } from './pinyin.js';
import { glosses, SKIP_MEANING } from './gloss.js';
import { MY_LEVEL } from './diglot.js';

export const MAX_MY_WORDS = 20_000;
const MAX_TEXT = 200;
const HAN_WORD = /^\p{Script=Han}{1,16}$/u;

const text = (value) => (typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : '');

/** A stored word record, or null if `w` isn't one. */
export function cleanMyWord(w) {
  if (!w || typeof w !== 'object' || typeof w.zh !== 'string') return null;
  const zh = w.zh.trim();
  if (!HAN_WORD.test(zh)) return null;
  return { zh, pinyin: text(w.pinyin), en: text(w.en), source: text(w.source) };
}

/** Valid records only, first of each word kept, at most MAX_MY_WORDS. */
export function cleanMyWords(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const w of list) {
    const clean = cleanMyWord(w);
    if (!clean || seen.has(clean.zh)) continue;
    seen.add(clean.zh);
    out.push(clean);
    if (out.length === MAX_MY_WORDS) break;
  }
  return out;
}

/**
 * Imports `incoming` words. 'add' keeps every existing word as it is
 * (including edited English); 'replace' starts from an empty list.
 * -> { words, added, existing }
 */
export function mergeWords(list, incoming, mode) {
  const words = mode === 'replace' ? [] : [...list];
  const have = new Set(words.map((w) => w.zh));
  let added = 0;
  let existing = 0;
  for (const w of incoming) {
    if (have.has(w.zh)) {
      existing++;
      continue;
    }
    have.add(w.zh);
    words.push(w);
    added++;
  }
  return { words, added, existing };
}

/** Adds a word by hand, or updates its English if it's already listed. Null if `zh` isn't a word. */
export function addWord(list, { zh, en }) {
  const word = cleanMyWord({ zh, en });
  if (!word) return null;
  if (list.some((w) => w.zh === word.zh)) return editWord(list, word.zh, word.en);
  return [...list, word];
}

export const removeWord = (list, zh) => list.filter((w) => w.zh !== zh);

export const editWord = (list, zh, en) => list.map((w) => (w.zh === zh ? { ...w, en: text(en) } : w));

const normPinyin = (pinyin) => toMarks(pinyin).normalize('NFC').toLowerCase().replace(/[\s''·-]/g, '');

/**
 * CC-CEDICT entries for the card's pronunciation ("zhōng" or "zhong1").
 * All entries when there's no card pinyin or none matches (e.g. a typo).
 */
export function readingEntries(entries, pinyin) {
  if (!pinyin) return entries;
  const want = normPinyin(pinyin);
  const same = entries.filter((e) => normPinyin(e.pinyin) === want);
  return same.length ? same : entries;
}

/**
 * The level-0 word map, shaped like the HSK one (diglot.js parseWordMap):
 * lowercase English -> [{ zh, level: 0 }], longer Chinese words first.
 * `entriesFor(zh)` returns CC-CEDICT entries [{ pinyin, defs }].
 */
export function buildMyWordMap(words, entriesFor) {
  const map = new Map();
  const add = (en, zh) => {
    if (!map.has(en)) map.set(en, []);
    const list = map.get(en);
    if (!list.some((c) => c.zh === zh)) list.push({ zh, level: MY_LEVEL });
  };
  for (const w of words) {
    for (const en of glosses(w.en)) add(en, w.zh);
    for (const entry of readingEntries(entriesFor(w.zh), w.pinyin)) {
      for (const en of glosses(entry.defs, { skip: SKIP_MEANING })) add(en, w.zh);
    }
  }
  for (const list of map.values()) list.sort((a, b) => b.zh.length - a.zh.length);
  return map;
}
