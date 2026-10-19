// Builds extension/data/hsk-words.txt: English words/phrases and the HSK 3.0
// (levels 1–6) Chinese words they can stand for, one line per English entry:
//   "like<TAB>喜欢:1,爱:1,像:2"   (candidates ordered by level, then frequency)
//
//   node scripts/build-hsk.mjs
//
// Input: data-src/hsk3/{1..6}.min.json from
// https://github.com/drkameleon/complete-hsk-vocabulary (MIT),
// wordlists/exclusive/new (words new at each level).
//
// The pairs come from each HSK word's English meanings, which are noisy
// (surnames, rare senses). That's fine: at runtime a candidate is used only if
// it appears in Apple's translation of the actual sentence, which picks the
// right sense and rejects the noise (see src/shared/diglot.js).

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STOP, SKIP_MEANING, GLOSS, cleanGloss } from '../src/shared/gloss.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'extension/data/hsk-words.txt');

// Content words only: nouns, verbs, adjectives, numerals, time and place words.
// Pronouns, prepositions, particles, conjunctions and most adverbs make
// mixed sentences ungrammatical rather than readable.
const POS = new Set(['n', 'v', 'vn', 'a', 'an', 'ad', 'b', 't', 's', 'f', 'm', 'ns', 'nz', 'nr', 'l', 'g', 'qt']);

const candidates = new Map(); // english -> Map(zh -> { level, rank })
let words = 0;
for (let level = 1; level <= 6; level++) {
  for (const w of JSON.parse(readFileSync(resolve(root, `data-src/hsk3/${level}.min.json`), 'utf8'))) {
    words++;
    if (!w.p.some((p) => POS.has(p))) continue;
    for (const form of w.f) {
      for (const meaning of form.m) {
        if (SKIP_MEANING.test(meaning)) continue;
        for (const gloss of meaning.split(/[;,]/)) {
          const en = cleanGloss(gloss).toLowerCase();
          if (!GLOSS.test(en) || STOP.has(en)) continue;
          if (!candidates.has(en)) candidates.set(en, new Map());
          const known = candidates.get(en).get(w.s);
          if (!known || level < known.level) candidates.get(en).set(w.s, { level, rank: w.q ?? 1e9 });
        }
      }
    }
  }
}

const lines = [...candidates]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([en, zhs]) => {
    const list = [...zhs].sort(([, a], [, b]) => a.level - b.level || a.rank - b.rank);
    return `${en}\t${list.map(([zh, { level }]) => `${zh}:${level}`).join(',')}`;
  });
writeFileSync(output, lines.join('\n') + '\n');
const covered = new Set([...candidates.values()].flatMap((m) => [...m.keys()]));
console.log(`hsk-words: ${lines.length} English entries covering ${covered.size} of ${words} HSK words -> ${output}`);
