// CC-CEDICT, loaded once into the background page on first lookup.

import { parseDict, longestMatch } from '../shared/dict.js';

let loading = null;

function load() {
  loading ??= fetch(browser.runtime.getURL('data/cedict.txt'))
    .then((res) => res.text())
    .then(parseDict)
    .catch((err) => { loading = null; throw err; });
  return loading;
}

/** Longest dictionary word at the start of `text`, or null. */
export async function lookup(text) {
  return longestMatch(await load(), text);
}

/** The whole dictionary: Map of word -> [{ pinyin, defs }]. */
export function dictionary() {
  return load();
}
