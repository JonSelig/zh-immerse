// Lookup-history records and the pure logic around them. The background script
// persists records in IndexedDB; the vocab page filters, sorts and exports them.
//
// Record: { word, pinyin, defs, count, firstSeen, lastSeen,
//           examples: [{ zh, en, url, ts }], saved }

import { toMarks, plain } from './pinyin.js';

export const DEDUPE_MS = 10 * 60 * 1000;
export const MAX_EXAMPLES = 5;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Decides whether a hover should count. The same word in the same sentence
 * counts once per `windowMs`. `recent` is a Map of key -> timestamp that this
 * function prunes and updates.
 */
export function shouldCount(recent, key, now, windowMs = DEDUPE_MS) {
  for (const [k, t] of recent) if (now - t >= windowMs) recent.delete(k);
  if (recent.has(key)) return false;
  recent.set(key, now);
  return true;
}

function blank(info, now) {
  return {
    word: info.word,
    pinyin: info.pinyin ?? '',
    defs: info.defs ?? '',
    count: 0,
    firstSeen: now,
    lastSeen: now,
    examples: [],
    saved: false,
  };
}

function withExample(record, { zh, en, url }, now) {
  if (!zh) return record;
  const examples = record.examples.filter((e) => e.zh !== zh);
  examples.unshift({ zh, en: en ?? '', url: url ?? '', ts: now });
  return { ...record, examples: examples.slice(0, MAX_EXAMPLES) };
}

/** Returns the record after one counted lookup. */
export function applyLookup(record, info, now) {
  const base = record ?? blank(info, now);
  const next = {
    ...base,
    pinyin: info.pinyin || base.pinyin,
    defs: info.defs || base.defs,
    count: base.count + 1,
    lastSeen: now,
  };
  return withExample(next, info, now);
}

/** Returns the record with its saved flag set, creating it if needed. */
export function applySaved(record, info, saved, now) {
  const base = record ?? blank(info, now);
  return withExample({ ...base, saved }, info, now);
}

/** Combines two records for the same word (used when importing a backup). */
export function mergeRecords(a, b) {
  if (!a) return b;
  if (!b) return a;
  const examples = [...a.examples, ...b.examples]
    .sort((x, y) => y.ts - x.ts)
    .filter((e, i, all) => all.findIndex((o) => o.zh === e.zh) === i)
    .slice(0, MAX_EXAMPLES);
  return {
    word: a.word,
    pinyin: a.pinyin || b.pinyin,
    defs: a.defs || b.defs,
    count: Math.max(a.count, b.count),
    firstSeen: Math.min(a.firstSeen, b.firstSeen),
    lastSeen: Math.max(a.lastSeen, b.lastSeen),
    examples,
    saved: a.saved || b.saved,
  };
}

/** Basic shape check for imported records. */
export function isRecord(r) {
  return r && typeof r.word === 'string' && r.word.length > 0
    && Number.isFinite(r.count) && Number.isFinite(r.firstSeen) && Number.isFinite(r.lastSeen)
    && Array.isArray(r.examples);
}

/**
 * The page address kept with an example: origin and path only, since query
 * strings and fragments can carry tokens. '' for anything but http(s).
 */
export function pageUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin + u.pathname : '';
  } catch {
    return '';
  }
}

const MAX_WORD = 32;
const MAX_TEXT = 2000;
const str = (s, max = MAX_TEXT) => (typeof s === 'string' ? s.slice(0, max) : '');
const num = (n, fallback = 0) => (Number.isFinite(n) ? n : fallback);

/**
 * A record from an imported backup, rebuilt from known fields with the right
 * types, or null if it isn't usable. Backups are files from anywhere, and the
 * word list renders every field.
 */
export function cleanRecord(r) {
  if (!isRecord(r) || r.word.length > MAX_WORD) return null;
  const examples = r.examples
    .filter((e) => e && typeof e.zh === 'string' && e.zh)
    .slice(0, MAX_EXAMPLES)
    .map((e) => ({ zh: str(e.zh), en: str(e.en), url: pageUrl(e.url), ts: num(e.ts, r.lastSeen) }));
  return {
    word: r.word,
    pinyin: str(r.pinyin),
    defs: str(r.defs),
    count: Math.max(0, Math.floor(r.count)),
    firstSeen: r.firstSeen,
    lastSeen: r.lastSeen,
    examples,
    saved: r.saved === true,
  };
}

/**
 * Filters for the vocab page.
 * opts: { tab: 'lookups' | 'saved', minCount, sinceDays, query, now }
 */
export function filterWords(words, { tab = 'lookups', minCount = 1, sinceDays = 0, query = '', now = Date.now() } = {}) {
  const q = query.trim().toLowerCase();
  const qPlain = q.replace(/[\s1-5]/g, '');
  return words.filter((w) => {
    if (tab === 'saved' ? !w.saved : w.count < Math.max(1, minCount)) return false;
    if (tab === 'saved' && minCount > 1 && w.count < minCount) return false;
    if (sinceDays > 0 && now - w.lastSeen > sinceDays * DAY) return false;
    if (q && !(w.word.includes(q)
      || (qPlain && plain(w.pinyin).includes(qPlain))
      || w.defs.toLowerCase().includes(q))) return false;
    return true;
  });
}

const SORTS = {
  count: (a, b) => b.count - a.count || b.lastSeen - a.lastSeen,
  recent: (a, b) => b.lastSeen - a.lastSeen,
  first: (a, b) => b.firstSeen - a.firstSeen,
};

export function sortWords(words, by = 'count') {
  return [...words].sort(SORTS[by] ?? SORTS.count);
}

const cell = (s) => String(s ?? '').replace(/[\t\r\n]+/g, ' ').trim();

/** Tab-separated export with Anki's file headers (Anki 2.1.55+). */
export function toAnkiTSV(words) {
  const lines = [
    '#separator:tab',
    '#html:false',
    '#columns:word\tpinyin\tdefinition\tcount\texample_zh\texample_en',
  ];
  for (const w of words) {
    const ex = w.examples[0] ?? {};
    lines.push([w.word, toMarks(w.pinyin), w.defs, w.count, ex.zh, ex.en].map(cell).join('\t'));
  }
  return lines.join('\n') + '\n';
}
