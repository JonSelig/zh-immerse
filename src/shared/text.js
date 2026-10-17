// Text classification helpers shared by the content script and tests.

// CJK Unified Ideographs (+ Extension A and compatibility block). BMP only,
// which covers everything Apple's translator emits for Simplified Chinese.
const CJK = /[㐀-䶿一-鿿豈-﫿]/;
const LATIN = /[A-Za-z]/;
const URLISH = /^\s*(?:https?:\/\/|www\.)\S+\s*$|^\s*\S+@\S+\.\S+\s*$/;

export const isCJK = (ch) => CJK.test(ch);

/** True when a run of text is worth sending to the translator. */
export function looksEnglish(text) {
  if (!/[A-Za-z]{2}/.test(text) || URLISH.test(text)) return false;
  let latin = 0;
  let cjk = 0;
  for (const ch of text) {
    if (LATIN.test(ch)) latin++;
    else if (CJK.test(ch)) cjk++;
  }
  return latin > cjk * 2;
}

/** Collapses whitespace runs to one space without trimming. */
export const collapseSpace = (s) => s.replace(/\s+/g, ' ');

const SENTENCE_END = /[。！？!?；;\n]/;

/**
 * Returns the sentence of `text` that contains position `index`, used as the
 * example sentence for a looked-up word. Capped at `max` characters.
 */
export function sentenceAround(text, index, max = 120) {
  let start = index;
  while (start > 0 && !SENTENCE_END.test(text[start - 1])) start--;
  let end = index;
  while (end < text.length && !SENTENCE_END.test(text[end])) end++;
  if (end < text.length) end++; // keep the closing punctuation
  let sentence = text.slice(start, end).trim();
  if (sentence.length > max) {
    const from = Math.max(0, index - start - Math.floor(max / 2));
    sentence = '…' + sentence.slice(from, from + max).trim() + '…';
  }
  return sentence;
}
