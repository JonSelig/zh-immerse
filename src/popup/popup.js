import { loadSettings } from '../shared/settings.js';
import { sendMessage, sendToTab } from '../shared/messaging.js';

const $ = (id) => document.getElementById(id);
const ALL_SITES = { origins: ['<all_urls>'] };

let settings;
let tab;
let page = null; // state reported by the tab's content script, if any

/** Small DOM builder: h('b', {}, 'text', child, ...) */
function h(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function showStatus(parts, ok = false) {
  const box = $('status');
  box.hidden = false;
  box.className = ok ? 'status ok' : 'status';
  box.replaceChildren(...parts);
}

async function checkStatus() {
  if (!(await browser.permissions.contains(ALL_SITES))) {
    const grant = h('button', {}, 'Allow on all websites');
    grant.addEventListener('click', async () => {
      if (await browser.permissions.request(ALL_SITES)) checkStatus();
    });
    showStatus(['zh-immerse needs access to websites to translate them.', h('br'), grant]);
    return;
  }
  const host = await sendMessage({ type: 'hostStatus' });
  if (host.code === 'hostMissing') {
    showStatus(['The translation helper isn’t installed. In the project folder run ',
      h('code', {}, 'npm run install:host'), ', then restart your browser.']);
  } else if (host.error) {
    showStatus([`Translation helper error: ${host.error}`]);
  } else if (host.status === 'supported') {
    showStatus(['Download ', h('b', {}, 'Chinese (Simplified)'), ' and ', h('b', {}, 'English'),
      ' in System Settings → General → Language & Region → Translation Languages.']);
  } else if (host.status === 'unsupported') {
    showStatus(['This Mac’s translator doesn’t support English → Chinese (Simplified).']);
  } else if (page?.blocked) {
    showStatus(['Translation stopped on this tab. Reload the page to retry.']);
  } else {
    const count = page?.translated ? ` · ${page.translated} passages on this page` : '';
    showStatus([`● Translator ready${count}`], true);
  }
}

const levelHint = (level) => (level >= 7 ? 'Translate everything' : level === 1 ? 'Swap HSK 1 words' : `Swap HSK 1–${level} words`);

function render() {
  const site = page?.host;
  for (const b of document.querySelectorAll('#levels button')) {
    b.setAttribute('aria-checked', String(Number(b.dataset.level) === settings.level));
    b.disabled = !settings.enabled;
  }
  $('levelHint').textContent = levelHint(settings.level);
  $('enabled').checked = settings.enabled;
  $('pinyin').checked = settings.pinyin;
  $('site').textContent = site || 'this site';
  $('siteEnabled').checked = !site || !settings.disabledSites.includes(site);
  $('siteEnabled').disabled = !site || !settings.enabled;
  $('togglePage').hidden = !page || !settings.enabled || !$('siteEnabled').checked;
  $('togglePage').firstChild.textContent = page?.pageOff ? 'Show Chinese on this tab ' : 'Show English on this tab ';
}

async function save(patch) {
  Object.assign(settings, patch);
  await browser.storage.local.set(patch);
  render();
}

async function refreshWords() {
  const { lookedUp, saved } = await sendMessage({ type: 'wordStats' });
  if (lookedUp || saved) $('wordStats').textContent = `${lookedUp} word${lookedUp === 1 ? '' : 's'} looked up · ${saved} saved`;
}

async function init() {
  settings = await loadSettings();
  [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  page = await sendToTab(tab.id, { type: 'pageState' }).catch(() => null);
  render();
  checkStatus();
  refreshWords();

  $('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));
  $('pinyin').addEventListener('change', (e) => save({ pinyin: e.target.checked }));
  for (const b of document.querySelectorAll('#levels button')) {
    b.addEventListener('click', () => save({ level: Number(b.dataset.level) }));
  }
  $('siteEnabled').addEventListener('change', (e) => {
    const others = settings.disabledSites.filter((s) => s !== page.host);
    save({ disabledSites: e.target.checked ? others : [...others, page.host] });
  });
  $('togglePage').addEventListener('click', async () => {
    page = await sendToTab(tab.id, { type: 'togglePage' });
    render();
  });
  $('openVocab').addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL('vocab/vocab.html') });
    window.close();
  });
}

init();
