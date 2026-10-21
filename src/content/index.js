// Content script entry: wires settings to the page translator and hover popup.

import { PageTranslator } from './translate.js';
import { Hover } from './hover.js';
import { SelectionSpeaker } from './selection.js';
import { DEFAULT_SETTINGS, loadSettings } from '../shared/settings.js';
import { MY_LEVEL } from '../shared/diglot.js';
import { onMessage, sendMessage as send } from '../shared/messaging.js';

let settings = { ...DEFAULT_SETTINGS };
let pageOff = false; // per-tab "show English" toggle (Alt+Shift+Z)
let lastError = null;

const translator = new PageTranslator({
  async translate(items, level) {
    const reply = await send({ type: 'translate', items, level });
    if (reply?.error) throw Object.assign(new Error(reply.error), { code: reply.code });
    return reply.graded ?? reply.translations;
  },
  onError(err) {
    lastError = { message: err.message, code: err.code };
  },
});
const hover = new Hover({ translator, send });
const selectionSpeaker = new SelectionSpeaker();

// The test harness sets this to inspect state; it is never set in the extension.
if (globalThis.__zhiDebug) globalThis.__zhi = { translator, hover };

const siteDisabled = () => settings.disabledSites.includes(location.hostname);
const chinesePage = () => /^zh\b/i.test(document.documentElement.lang);

function apply() {
  const on = settings.enabled && !siteDisabled();
  translator.setLevel(settings.level);
  if (on && !pageOff && !chinesePage()) translator.start();
  else translator.stop();
  translator.setPinyin(settings.pinyin);
  // The hover dictionary also works on pages that are already in Chinese.
  if (on) {
    hover.enable();
    selectionSpeaker.enable();
  } else {
    hover.disable();
    selectionSpeaker.disable();
  }
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key in DEFAULT_SETTINGS) settings[key] = newValue ?? DEFAULT_SETTINGS[key];
  }
  // At 我的, redo the page when the word list changes (e.g. the first words
  // are added). Translations are cached, so this is quick.
  if ('myWords' in changes && settings.level === MY_LEVEL) translator.stop();
  apply();
});

onMessage((msg) => {
  if (msg?.type === 'togglePage') {
    pageOff = !pageOff;
    lastError = null;
    apply();
  }
  if (msg?.type === 'togglePage' || msg?.type === 'pageState') {
    return {
      pageOff,
      active: translator.active,
      translated: translator.translatedCount,
      blocked: translator.blocked,
      error: lastError,
      host: location.hostname,
    };
  }
  return undefined;
});

loadSettings().then((loaded) => {
  settings = loaded;
  apply();
});
