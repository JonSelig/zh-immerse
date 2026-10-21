// Graded reading (levels 0–6): turns full translations into sentences where
// only some words are swapped into Chinese: HSK words up to the level (1–6),
// or the user's own words (0, My words). See shared/diglot.js.

import { parseWordMap, diglotItem, MY_LEVEL } from '../shared/diglot.js';
import { buildMyWordMap, cleanMyWords } from '../shared/mywords.js';
import { dictionary } from './dictionary.js';

let loading = null;
let mine = null; // My words { map, known }; rebuilt after the list changes

function load() {
  loading ??= fetch(browser.runtime.getURL('data/hsk-words.txt'))
    .then((res) => res.text())
    .then(parseWordMap)
    .catch((err) => { loading = null; throw err; });
  return loading;
}

function loadMine() {
  mine ??= Promise.all([browser.storage.local.get({ myWords: [] }), dictionary()])
    .then(([{ myWords }, dict]) => {
      const list = cleanMyWords(myWords);
      return { map: buildMyWordMap(list, (zh) => dict.get(zh) ?? []), known: new Set(list.map((w) => w.zh)) };
    })
    .catch((err) => { mine = null; throw err; });
  return mine;
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'myWords' in changes) mine = null;
});

/** items/translations as sent to and returned by the translator. */
export async function gradeItems(items, translations, level) {
  const [dict, words] = await Promise.all([
    dictionary().catch(() => null), // without it, swapping still works, just without 住在 phrases
    level === MY_LEVEL ? loadMine() : load(),
  ]);
  // A dictionary check lets 住在 count as 住 + 在 (and "live in" become 住在),
  // while real words like 现在 stay whole.
  const options = dict ? { isWord: (zh) => dict.has(zh) } : {};
  let map = words;
  if (level === MY_LEVEL) {
    map = words.map;
    options.knownPrep = (p) => words.known.has(p); // 在/到/给/成 only if they're on the list
  }
  return items.map((item, i) => (translations[i] == null ? null : diglotItem(item, translations[i], map, level, options)));
}
