// Converts CC-CEDICT into extension/data/cedict.txt, keyed by simplified form.
// Format: one line per reading, "simplified<TAB>pinyin<TAB>definitions", with
// readings of the same word adjacent and best-first. (Plain text rather than
// JSON: addons.mozilla.org rejects JSON files over 5 MB.)
//
//   node scripts/build-dict.mjs [path/to/cedict.txt.gz]
//
// Source: https://www.mdbg.net/chinese/dictionary?page=cc-cedict (CC BY-SA 4.0)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toMarks } from '../src/shared/pinyin.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2] ?? resolve(root, 'data-src/cedict.txt.gz');
const output = resolve(root, 'extension/data/cedict.txt');

const raw = readFileSync(input);
const text = (input.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8');

const LINE = /^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/\s*$/;
// Cross-references like "個|个[ge4]" or "个[ge4]" -> "个 (gè)"
const XREF = /(?:[^\s|,;()[\]/]+\|)?([^\s|,;()[\]/]+)\[([a-zA-Z0-9: ]+)\]/g;

function cleanDef(def) {
  if (def.startsWith('CL:')) {
    const words = def.slice(3).split(',').map((d) => d.replace(XREF, '$1').trim());
    return `measure word: ${words.join(', ')}`;
  }
  return def.replace(XREF, (_, simp, py) => `${simp} (${toMarks(py)})`);
}

// Readings that are rarely what a reader needs go last.
function rank([pinyin, defs]) {
  let score = 0;
  if (/^[A-Z]/.test(pinyin)) score += 2; // proper nouns
  if (/^(surname |(old )?variant of |see |used in |archaic)/i.test(defs)) score += 1;
  return score;
}

const words = Object.create(null);
let entries = 0;
let maxLength = 1;
for (const line of text.split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const m = LINE.exec(line);
  if (!m) continue;
  const [, , simp, pinyin, defList] = m;
  const defs = defList.split('/').filter(Boolean).map(cleanDef).join('; ').replace(/[\t\n]/g, ' ');
  (words[simp] ??= []).push([pinyin, defs]);
  maxLength = Math.max(maxLength, [...simp].length);
  entries++;
}
for (const list of Object.values(words)) {
  list.sort((a, b) => rank(a) - rank(b));
}

const lines = [];
for (const [word, list] of Object.entries(words)) {
  for (const [pinyin, defs] of list) lines.push(`${word}\t${pinyin}\t${defs}`);
}
mkdirSync(dirname(output), { recursive: true });
const body = lines.join('\n') + '\n';
writeFileSync(output, body);
console.log(`cedict: ${entries} entries, ${Object.keys(words).length} words, ` +
  `longest ${maxLength}, ${(Buffer.byteLength(body) / 1e6).toFixed(1)} MB -> ${output}`);
