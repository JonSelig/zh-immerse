// CC-CEDICT stores pinyin with tone numbers ("ni3 hao3", "lu:4"). These helpers
// turn that into tone-marked pinyin ("nǐ hǎo", "lǜ") for display.

const MARKS = {
  a: 'āáǎà',
  e: 'ēéěè',
  i: 'īíǐì',
  o: 'ōóǒò',
  u: 'ūúǔù',
  ü: 'ǖǘǚǜ',
};

const VOWELS = 'aeiouü';

/** "hao3" -> { text: "hǎo", tone: 3 }. Non-pinyin tokens pass through with tone 0. */
export function syllable(token) {
  const m = /^([a-zA-ZüÜ:]+)([1-5])$/.exec(token);
  if (!m) return { text: token.replace(/u:/g, 'ü').replace(/U:/g, 'Ü'), tone: 0 };
  const letters = m[1].replace(/u:/g, 'ü').replace(/U:/g, 'Ü');
  const tone = Number(m[2]);
  if (tone === 5) return { text: letters, tone: 5 };

  const lower = letters.toLowerCase();
  // Standard placement: a or e takes the mark; in "ou" the o does; otherwise the last vowel.
  let index = lower.search(/[ae]/);
  if (index < 0) index = lower.indexOf('ou');
  if (index < 0) {
    for (let i = lower.length - 1; i >= 0; i--) {
      if (VOWELS.includes(lower[i])) { index = i; break; }
    }
  }
  if (index < 0) return { text: letters, tone }; // e.g. "m2", "r5"

  const marked = MARKS[lower[index]][tone - 1];
  const out = letters[index] === lower[index] ? marked : marked.toUpperCase();
  return { text: letters.slice(0, index) + out + letters.slice(index + 1), tone };
}

/** "ni3 hao3" -> [{ text: "nǐ", tone: 3 }, { text: "hǎo", tone: 3 }] */
export function syllables(numbered) {
  return numbered.trim().split(/\s+/).filter(Boolean).map(syllable);
}

/** "ni3 hao3" -> "nǐ hǎo" */
export function toMarks(numbered) {
  return syllables(numbered).map((s) => s.text).join(' ');
}

/** Lowercase, tone-free pinyin for search ("Ni3 hao3" -> "nihao"). */
export function plain(numbered) {
  return numbered.toLowerCase().replace(/u:/g, 'v').replace(/[1-5\s]/g, '');
}
