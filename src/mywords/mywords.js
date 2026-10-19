// My words page: import Anki decks, and add, edit and remove the words that
// the 我的 reading level swaps into Chinese.

import { readApkg } from '../shared/anki.js';
import { mergeWords, addWord, removeWord, editWord, readingEntries } from '../shared/mywords.js';
import { syllables } from '../shared/pinyin.js';
import { sendMessage as send } from '../shared/messaging.js';

const $ = (id) => document.getElementById(id);

let words = [];
const dict = new Map(); // zh -> CC-CEDICT entries [{ pinyin, defs }] ([] if not found)

function h(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
}

function pinyinNode(numbered) {
  const span = h('span');
  syllables(numbered).forEach((s, i) => {
    if (i) span.append(' ');
    span.append(h('span', { className: `zhi-t${s.tone || 5}`, textContent: s.text }));
  });
  return span;
}

async function entries(zh) {
  if (!dict.has(zh)) {
    const match = await send({ type: 'lookup', text: zh }).catch(() => null);
    dict.set(zh, match?.word === zh ? match.entries : []);
  }
  return dict.get(zh);
}

/** Lowercase text without tone marks, for search. */
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function haystack(w) {
  const py = (dict.get(w.zh) ?? []).map((e) => e.pinyin.replace(/\d/g, '')).join(' ');
  return fold(`${w.zh} ${w.pinyin} ${py} ${w.en}`);
}

async function save(next) {
  await send({ type: 'setMyWords', words: next });
  words = next;
  render();
}

function editCell(td, w) {
  if (td.querySelector('input')) return;
  const input = h('input', { value: w.en });
  input.setAttribute('aria-label', `English for ${w.zh}`);
  let cancelled = false;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      cancelled = true;
      input.blur();
    }
  });
  input.addEventListener('blur', () => {
    if (!cancelled && input.value.trim() !== w.en) save(editWord(words, w.zh, input.value));
    else render();
  });
  td.replaceChildren(input);
  input.focus();
}

function row(w) {
  const entry = readingEntries(dict.get(w.zh) ?? [], w.pinyin)[0];
  const en = h('td', { className: 'en', textContent: w.en || '—', title: 'Click to edit' });
  en.addEventListener('click', () => editCell(en, w));
  const remove = h('button', { className: 'icon', textContent: '✕', title: `Remove ${w.zh}` });
  remove.addEventListener('click', () => save(removeWord(words, w.zh)));
  return h('tr', {},
    h('td', { className: 'w', textContent: w.zh }),
    h('td', { className: 'py' }, entry ? pinyinNode(entry.pinyin) : w.pinyin),
    en,
    h('td', { className: 'src', textContent: w.source || 'added by you' }),
    h('td', { className: 'act' }, remove));
}

function render() {
  const query = fold($('query').value.trim());
  const list = query ? words.filter((w) => haystack(w).includes(query)) : words;
  $('rows').replaceChildren(...list.map(row));
  const total = `${words.length} word${words.length === 1 ? '' : 's'}`;
  $('count').textContent = list.length === words.length ? total : `${list.length} of ${total}`;
  $('removeAll').disabled = !words.length;
  const empty = $('empty');
  empty.hidden = list.length > 0;
  empty.textContent = words.length ? 'No words match.' : 'No words yet. Import an Anki deck or add words above.';
}

async function load() {
  ({ myWords: words = [] } = await browser.storage.local.get('myWords'));
  render();
  await Promise.all(words.map((w) => entries(w.zh))); // pinyin and search
  render();
}

$('importApkg').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const mode = document.querySelector('input[name=mode]:checked').value;
  const note = $('importNote');
  note.textContent = `Reading ${file.name}…`;
  try {
    const deck = await readApkg(await file.arrayBuffer());
    const source = deck.deck || file.name.replace(/\.apkg$/i, '');
    if (mode === 'replace' && words.length
      && !confirm(`Replace all ${words.length} words, including words you added by hand?`)) {
      note.textContent = '';
      return;
    }
    const merged = mergeWords(words, deck.words.map((w) => ({ ...w, source })), mode);
    await save(merged.words);
    const parts = [`Added ${merged.added} new word${merged.added === 1 ? '' : 's'} from ${source}`];
    if (merged.existing) parts.push(`${merged.existing} already in your list`);
    if (deck.skipped.length) {
      parts.push(`${deck.skipped.length} skipped (no Chinese): ${deck.skipped.slice(0, 5).join(', ')}${deck.skipped.length > 5 ? ', …' : ''}`);
    }
    note.textContent = parts.join(' · ');
    load();
  } catch (err) {
    note.textContent = `Import failed: ${err.message}`;
  }
});

$('addZh').addEventListener('change', async () => {
  const zh = $('addZh').value.trim();
  const found = zh ? await entries(zh) : [];
  // Prefer a real meaning over a "surname X" entry.
  const first = found.find((e) => !/^surname/i.test(e.defs)) ?? found[0];
  $('addPinyin').replaceChildren(first ? pinyinNode(first.pinyin) : '');
  if (first && !$('addEn').value.trim()) $('addEn').value = first.defs;
});

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const zh = $('addZh').value.trim();
  const next = addWord(words, { zh, en: $('addEn').value });
  if (!next) {
    $('addNote').textContent = 'Enter a word in Chinese characters (up to 16).';
    return;
  }
  const updated = words.some((w) => w.zh === zh);
  await save(next);
  $('addNote').textContent = updated ? `Updated ${zh}.` : `Added ${zh}.`;
  $('addZh').value = '';
  $('addEn').value = '';
  $('addPinyin').replaceChildren();
  load();
});

$('removeAll').addEventListener('click', () => {
  if (!confirm(`Remove all ${words.length} words from My words?`)) return;
  save([]);
});

$('query').addEventListener('input', render);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

load();
