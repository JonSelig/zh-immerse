// Graded reading (levels 1–6): turns full translations into sentences where
// only HSK words up to the level are swapped into Chinese. See shared/diglot.js.

import { parseWordMap, diglotItem } from '../shared/diglot.js';

let loading = null;

function load() {
  loading ??= fetch(browser.runtime.getURL('data/hsk-words.txt'))
    .then((res) => res.text())
    .then(parseWordMap)
    .catch((err) => { loading = null; throw err; });
  return loading;
}

/** items/translations as sent to and returned by the translator. */
export async function gradeItems(items, translations, level) {
  const map = await load();
  return items.map((item, i) => (translations[i] == null ? null : diglotItem(item, translations[i], map, level)));
}
