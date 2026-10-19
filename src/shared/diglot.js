// Graded reading ("diglot weave"): at levels 1–6, only English words whose
// Chinese equivalent is an HSK 3.0 word at or below the level are swapped for
// Chinese; the rest of the sentence stays English. Level 0 (My words) does the
// same with a map built from the user's own list (shared/mywords.js). Level 7
// translates everything.
//
// Word data (built by scripts/build-hsk.mjs) is a text file of
// "english<TAB>candidates" lines, e.g. "like	喜欢:1,爱:1,像:2", candidates
// ordered by level, then frequency.
//
// A candidate is used only if it also appears in Apple's translation of the
// whole sentence. That picks the right sense and keeps context-sensitive
// words honest: "like" becomes 喜欢 in "I like apples" (我喜欢苹果) but stays
// English in "it looks like rain" (看起来要下雨了).

export const MY_LEVEL = 0;
export const FULL_LEVEL = 7;
export const LEVELS = [MY_LEVEL, 1, 2, 3, 4, 5, 6, FULL_LEVEL];
const MAX_PHRASE = 3;

/** -> Map of lowercase English (word or phrase) -> [{ zh, level }] */
export function parseWordMap(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    const [en, list] = line.split('\t');
    if (!en || !list) continue;
    map.set(en, list.split(',').map((c) => {
      const [zh, level] = c.split(':');
      return { zh, level: Number(level) };
    }));
  }
  return map;
}

const IRREGULAR = {
  went: 'go', gone: 'go', ate: 'eat', eaten: 'eat', saw: 'see', seen: 'see', bought: 'buy',
  thought: 'think', took: 'take', taken: 'take', came: 'come', made: 'make', said: 'say',
  got: 'get', gotten: 'get', gave: 'give', given: 'give', knew: 'know', known: 'know',
  found: 'find', told: 'tell', felt: 'feel', brought: 'bring', began: 'begin', begun: 'begin',
  kept: 'keep', held: 'hold', wrote: 'write', written: 'write', stood: 'stand', heard: 'hear',
  meant: 'mean', met: 'meet', ran: 'run', paid: 'pay', sat: 'sit', spoke: 'speak',
  spoken: 'speak', led: 'lead', grew: 'grow', grown: 'grow', lost: 'lose', fell: 'fall',
  fallen: 'fall', sent: 'send', built: 'build', understood: 'understand', drew: 'draw',
  drawn: 'draw', broke: 'break', broken: 'break', spent: 'spend', drove: 'drive',
  driven: 'drive', wore: 'wear', worn: 'wear', sold: 'sell', taught: 'teach', caught: 'catch',
  slept: 'sleep', won: 'win', flew: 'fly', flown: 'fly', swam: 'swim', sang: 'sing',
  sung: 'sing', drank: 'drink', drunk: 'drink', forgot: 'forget', forgotten: 'forget',
  chose: 'choose', chosen: 'choose', woke: 'wake', threw: 'throw', thrown: 'throw',
  became: 'become', rode: 'ride', ridden: 'ride', fought: 'fight',
  sought: 'seek', lent: 'lend', shot: 'shoot', hung: 'hang', bit: 'bite', bitten: 'bite',
  children: 'child', men: 'man', women: 'woman', feet: 'foot', teeth: 'tooth', mice: 'mouse',
  better: 'good', best: 'good', worse: 'bad', worst: 'bad',
};

const VOWEL = /[aeiou]/;
const doubled = (s) => s.length > 2 && s.at(-1) === s.at(-2) && !VOWEL.test(s.at(-1));

/** Possible dictionary forms of an English word, most likely first. */
export function lemmas(word) {
  const w = word.toLowerCase();
  const out = [w];
  const add = (s) => { if (s.length > 1 && !out.includes(s)) out.push(s); };
  if (IRREGULAR[w]) add(IRREGULAR[w]);
  if (w.endsWith('ies')) add(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) add(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss')) add(w.slice(0, -1));
  if (w.endsWith('ied')) add(w.slice(0, -3) + 'y');
  for (const suffix of ['ed', 'ing', 'er', 'est']) {
    if (!w.endsWith(suffix) || w.length - suffix.length < 2) continue;
    const base = w.slice(0, -suffix.length);
    add(base);
    add(base + 'e');
    if (doubled(base)) add(base.slice(0, -1));
    if (base.endsWith('i')) add(base.slice(0, -1) + 'y'); // easier -> easy
    if (suffix === 'ing' && base.endsWith('y')) add(base.slice(0, -1) + 'ie'); // dying -> die
  }
  return out;
}

const PARTICLES = '了过着的得地';
const PRONOUNS = '我你他她它';

/**
 * Builds a membership test for Chinese words in a translated sentence. Uses
 * word segmentation, so a single-character word like 学 doesn't match inside
 * 大学; longer words also match as plain substrings, in case the segmenter
 * splits them differently.
 */
export function translationWords(full) {
  const words = new Set();
  if (typeof Intl.Segmenter === 'function') {
    for (const { segment, isWordLike } of new Intl.Segmenter('zh', { granularity: 'word' }).segment(full)) {
      if (!isWordLike) continue;
      words.add(segment);
      // The segmenter glues particles and pronouns onto one-character words
      // (去了, 我在); count the character on its own too.
      if (segment.length === 2) {
        if (PARTICLES.includes(segment[1])) words.add(segment[0]);
        if (PRONOUNS.includes(segment[0])) words.add(segment[1]);
      }
    }
  }
  return (zh) => words.has(zh) || (zh.length > 1 && full.includes(zh));
}

const TOKEN = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;

/**
 * Finds English words/phrases in `text` to swap at `level`.
 * -> [{ start, end, zh, en }] in text order, non-overlapping.
 */
export function findSwaps(text, map, level, inTranslation) {
  const tokens = [...text.matchAll(TOKEN)].map((m) => {
    let word = m[0];
    if (/['’]s$/i.test(word)) word = word.slice(0, -2); // friend's -> friend
    return { word, start: m.index, end: m.index + word.length };
  });
  const swaps = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let n = Math.min(MAX_PHRASE, tokens.length - i); n >= 1; n--) {
      const span = tokens.slice(i, i + n);
      // Phrase words must be separated by a single space or hyphen.
      if (span.some((t, k) => k > 0 && !/^[ -]$/.test(text.slice(span[k - 1].end, t.start)))) continue;
      const head = span.slice(0, -1).map((t) => t.word.toLowerCase());
      const last = span.at(-1).word;
      let entry = null;
      for (const form of lemmas(last)) {
        entry = map.get([...head, form].join(' '))
          ?.find((c) => c.level <= level && inTranslation(c.zh));
        if (entry) break;
      }
      if (!entry) continue;
      const start = span[0].start;
      const end = span.at(-1).end;
      swaps.push({ start, end, zh: entry.zh, en: text.slice(start, end) });
      i += n - 1;
      break;
    }
  }
  return swaps;
}

/** Applies swaps -> { text, ranges: [[start, end], ...] } (ranges in the new text). */
export function applySwaps(text, swaps) {
  let out = '';
  let cursor = 0;
  const ranges = [];
  for (const s of swaps) {
    out += text.slice(cursor, s.start);
    ranges.push([out.length, out.length + s.zh.length]);
    out += s.zh;
    cursor = s.end;
  }
  return { text: out + text.slice(cursor), ranges };
}

/**
 * Graded version of one translation item. `item` is the English (a string or
 * an array of segments), `translation` its full Chinese translation in the
 * same shape. -> { segments: [mixed text], ranges: [[[s, e], ...]], full }
 */
export function diglotItem(item, translation, map, level) {
  const segments = Array.isArray(item) ? item : [item];
  const full = Array.isArray(translation) ? translation.join('') : translation;
  const inTranslation = translationWords(full);
  const out = { segments: [], ranges: [], full };
  for (const text of segments) {
    const { text: mixed, ranges } = applySwaps(text, findSwaps(text, map, level, inTranslation));
    out.segments.push(mixed);
    out.ranges.push(ranges);
  }
  return out;
}
