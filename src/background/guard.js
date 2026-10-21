// Checks on incoming messages before they reach a handler. Content scripts run
// inside web pages, so the background treats what they send as untrusted.

import { MAX_LOOKUP } from '../shared/dict.js';
import { MAX_MY_WORDS } from '../shared/mywords.js';

/** Handlers only extension pages (popup, word list, My words) may call: they
 * read, import or wipe the whole history or the swap reports, replace My
 * words, or clear the cache. */
export const PAGE_ONLY = new Set(['listWords', 'deleteWord', 'importWords', 'clearCache', 'setMyWords',
  'listSwapReports', 'deleteSwapReport', 'clearSwapReports']);

// Far above what the page translator sends (one block of the page per
// message, see content/translate.js); these only stop abuse.
const MAX_ITEMS = 2000;
const MAX_CHARS = 1_000_000;
const MAX_REPORT_FIELD = 20_000; // reports are cut to 2,000 characters; this only stops abuse

/** True when `sender` is one of this extension's own pages; `base` is runtime.getURL(''). */
export const fromExtensionPage = (sender, base) => typeof sender?.url === 'string' && sender.url.startsWith(base);

function itemChars(item) {
  if (typeof item === 'string') return item.length;
  if (Array.isArray(item) && item.every((s) => typeof s === 'string')) return item.reduce((n, s) => n + s.length, 0);
  return Infinity;
}

/** null if the message may be handled, otherwise why it was refused. */
export function refusal(msg, sender, base) {
  if (PAGE_ONLY.has(msg.type) && !fromExtensionPage(sender, base)) return 'only allowed from extension pages';
  if (msg.type === 'translate') {
    if (!Array.isArray(msg.items) || msg.items.length > MAX_ITEMS) return 'too many items';
    if (msg.items.reduce((n, item) => n + itemChars(item), 0) > MAX_CHARS) return 'too much text';
  }
  // MAX_LOOKUP characters, each up to two UTF-16 units.
  if (msg.type === 'lookup' && (typeof msg.text !== 'string' || msg.text.length > MAX_LOOKUP * 2)) return 'bad lookup text';
  if (msg.type === 'setMyWords' && (!Array.isArray(msg.words) || msg.words.length > MAX_MY_WORDS)) return 'bad word list';
  if (msg.type === 'reportSwap') {
    const fields = ['swapEn', 'swapZh', 'en', 'zh', 'url'].map((k) => msg[k]);
    if (!fields.every((s) => typeof s === 'string' && s.length <= MAX_REPORT_FIELD)
      || !Number.isInteger(msg.level) || msg.level < 0 || msg.level > 7) return 'bad report';
  }
  return null;
}
