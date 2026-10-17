// Dictionary data (built by scripts/build-dict.mjs from CC-CEDICT) is a text
// file of "simplified<TAB>pinyin<TAB>definitions" lines, loaded into a Map of
// word -> [{ pinyin, defs }].

export const MAX_LOOKUP = 8;

export function parseDict(text) {
  const words = new Map();
  for (const line of text.split('\n')) {
    const tab1 = line.indexOf('\t');
    const tab2 = line.indexOf('\t', tab1 + 1);
    if (tab1 < 1 || tab2 < 0) continue;
    const word = line.slice(0, tab1);
    const entry = { pinyin: line.slice(tab1 + 1, tab2), defs: line.slice(tab2 + 1) };
    const list = words.get(word);
    if (list) list.push(entry);
    else words.set(word, [entry]);
  }
  return words;
}

/**
 * Longest-prefix match: finds the longest dictionary word that starts at the
 * beginning of `text`. Returns { word, entries: [{ pinyin, defs }] } or null.
 */
export function longestMatch(words, text, maxLength = MAX_LOOKUP) {
  for (let len = Math.min(maxLength, text.length); len > 0; len--) {
    const word = text.slice(0, len);
    const entries = words.get(word);
    if (entries) return { word, entries };
  }
  return null;
}
