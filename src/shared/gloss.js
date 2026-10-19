// English glosses from dictionary definitions ("to live (somewhere); to stay"
// -> "live", "stay"). Shared by the HSK build (scripts/build-hsk.mjs) and My
// words (src/shared/mywords.js), so both clean definitions the same way.

// Function words: a sentence with these swapped is harder to read, not easier.
export const STOP = new Set(`a an the to of in on at by for with from and or but not no yes it its this that these
those he she they we you i me him her them us my your his our their is am are was were be been
being do does did have has had will would can could should may might must shall if so as than then
there here what which who whom whose when where why how all any some very just also too up down
out about into over after before again more most other such only own same few each both many much
one ok okay well get got make let`.split(/\s+/));

// Dictionary senses that aren't meanings a reader would know the word by.
export const SKIP_MEANING = /surname|variant of|abbr\.|used in|classifier|old name|archaic|dialect|literary|Taiwan pr/i;

/** English that can be matched in text: one to three plain words. */
export const GLOSS = /^[a-z]+(?:[ -][a-z]+){0,2}$/;

export function cleanGloss(gloss) {
  return gloss
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(sth|sb|one's|oneself|someone|something)\b/g, ' ')
    .replace(/^\s*(to|a|an|the)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Usable lowercase English keys in a definition list, in order, no repeats. */
export function glosses(text, { skip = null } = {}) {
  const out = [];
  for (const meaning of String(text ?? '').split(';')) {
    if (skip?.test(meaning)) continue;
    for (const part of meaning.split(/[,/]/)) {
      const en = cleanGloss(part).toLowerCase();
      if (GLOSS.test(en) && !STOP.has(en) && !out.includes(en)) out.push(en);
    }
  }
  return out;
}
