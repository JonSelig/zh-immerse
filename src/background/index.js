// Background script: routes messages from content scripts, the popup and the
// vocab page to the translator, dictionary and word store.

import { translateItems, prioritize, clearCache } from './translator.js';
import { gradeItems } from './graded.js';
import { FULL_LEVEL, MY_LEVEL, ungradedItem } from '../shared/diglot.js';
import { hostStatus } from './native.js';
import { lookup, dictionary } from './dictionary.js';
import * as words from './words.js';
import { DEFAULT_SETTINGS } from '../shared/settings.js';
import { pageUrl } from '../shared/history.js';
import { refusal } from './guard.js';
import { onMessage, sendToTab } from '../shared/messaging.js';
import { cleanMyWords } from '../shared/mywords.js';

const wordInfo = ({ word, pinyin, defs, zh, en, url }) => ({ word, pinyin, defs, zh, en, url: pageUrl(url) });

// Private windows (when the extension is allowed in them): nothing from them
// is written to disk. Translations aren't cached, hovers aren't counted, and a
// word saved there keeps no example sentence or address.
const isPrivate = (sender) => !!sender?.tab?.incognito;

/** Hostname of the tab a message came from: the translation cache partition. */
function siteOf(sender) {
  try {
    return new URL(sender?.tab?.url ?? sender?.url).hostname;
  } catch {
    return '';
  }
}

const EXTENSION_BASE = browser.runtime.getURL('');

// Size of My words, cached for the empty-list check on every translate message.
let myCount = null;
const myWordCount = () => (myCount ??= browser.storage.local.get({ myWords: [] })
  .then(({ myWords }) => (Array.isArray(myWords) ? myWords.length : 0)));
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'myWords' in changes) myCount = null;
});

const handlers = {
  async translate({ items, level = FULL_LEVEL, urgent = true }, sender) {
    try {
      // 我的 with an empty list swaps nothing: don't translate at all.
      if (level === MY_LEVEL && !(await myWordCount())) {
        return { graded: items.map(ungradedItem) };
      }
      const translations = await translateItems(items, { site: siteOf(sender), persist: !isPrivate(sender), urgent: urgent !== false });
      if (level >= FULL_LEVEL) return { translations };
      return { graded: await gradeItems(items, translations, level) };
    } catch (err) {
      return { error: err.message, code: err.code ?? 'internal' };
    }
  },

  // Text the page asked for ahead of scrolling is now on screen.
  prioritize({ items }, sender) {
    prioritize(items, { site: siteOf(sender) });
    return null;
  },

  async lookup({ text }) {
    const match = await lookup(text);
    if (!match) return null;
    const record = await words.getWord(match.word);
    return { ...match, count: record?.count ?? 0, saved: !!record?.saved };
  },

  async recordLookup(msg, sender) {
    if (!isPrivate(sender)) return words.recordLookup(wordInfo(msg));
    const record = await words.getWord(msg.word);
    return { count: record?.count ?? 0, saved: !!record?.saved, counted: false };
  },
  setSaved(msg, sender) {
    const info = wordInfo(msg);
    return words.setSaved(isPrivate(sender) ? { ...info, zh: '', en: '', url: '' } : info, !!msg.saved);
  },
  listWords: () => words.listWords(),
  deleteWord: ({ word }) => words.deleteWord(word),
  importWords: ({ records }) => words.importWords(records),
  async setMyWords({ words: list }) {
    const myWords = cleanMyWords(list);
    await browser.storage.local.set({ myWords });
    return { count: myWords.length };
  },
  // CC-CEDICT entries for many words at once (the My words page).
  async dictEntries({ words: list }) {
    const dict = await dictionary();
    return Object.fromEntries(list.map((w) => [w, dict.get(w) ?? []]));
  },
  wordStats: () => words.stats(),
  hostStatus: () => hostStatus(),
  clearCache: () => clearCache(),
};

onMessage((msg, sender) => {
  const handler = handlers[msg?.type];
  if (!handler) return undefined;
  const refused = refusal(msg, sender, EXTENSION_BASE);
  if (refused) return Promise.reject(new Error(`${msg.type} refused: ${refused}`));
  return Promise.resolve(handler(msg, sender));
});

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

browser.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-page') {
    const tab = await activeTab();
    if (tab?.id != null) sendToTab(tab.id, { type: 'togglePage' }).catch(() => {});
  } else if (command === 'toggle-pinyin') {
    const { pinyin } = await browser.storage.local.get({ pinyin: DEFAULT_SETTINGS.pinyin });
    await browser.storage.local.set({ pinyin: !pinyin });
  }
});

browser.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') await browser.storage.local.set(DEFAULT_SETTINGS);
});
