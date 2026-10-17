// Background script: routes messages from content scripts, the popup and the
// vocab page to the translator, dictionary and word store.

import { translateItems } from './translator.js';
import { gradeItems } from './graded.js';
import { FULL_LEVEL } from '../shared/diglot.js';
import { hostStatus } from './native.js';
import { lookup } from './dictionary.js';
import * as words from './words.js';
import { DEFAULT_SETTINGS } from '../shared/settings.js';

const wordInfo = ({ word, pinyin, defs, zh, en, url }) => ({ word, pinyin, defs, zh, en, url });

const handlers = {
  async translate({ items, level = FULL_LEVEL }) {
    try {
      const translations = await translateItems(items);
      if (level >= FULL_LEVEL) return { translations };
      return { graded: await gradeItems(items, translations, level) };
    } catch (err) {
      return { error: err.message, code: err.code ?? 'internal' };
    }
  },

  async lookup({ text }) {
    const match = await lookup(text);
    if (!match) return null;
    const record = await words.getWord(match.word);
    return { ...match, count: record?.count ?? 0, saved: !!record?.saved };
  },

  recordLookup: (msg) => words.recordLookup(wordInfo(msg)),
  setSaved: (msg) => words.setSaved(wordInfo(msg), !!msg.saved),
  listWords: () => words.listWords(),
  deleteWord: ({ word }) => words.deleteWord(word),
  importWords: ({ records }) => words.importWords(records),
  wordStats: () => words.stats(),
  hostStatus: () => hostStatus(),
};

browser.runtime.onMessage.addListener((msg) => {
  const handler = handlers[msg?.type];
  return handler ? Promise.resolve(handler(msg)) : undefined;
});

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

browser.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-page') {
    const tab = await activeTab();
    if (tab?.id != null) browser.tabs.sendMessage(tab.id, { type: 'togglePage' }).catch(() => {});
  } else if (command === 'toggle-pinyin') {
    const { pinyin } = await browser.storage.local.get({ pinyin: DEFAULT_SETTINGS.pinyin });
    await browser.storage.local.set({ pinyin: !pinyin });
  }
});

browser.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') await browser.storage.local.set(DEFAULT_SETTINGS);
});
