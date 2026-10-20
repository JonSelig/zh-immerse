// My words page: import Anki decks, and add, edit and remove the words that
// the 我的 reading level swaps into Chinese.

import { readApkg } from '../shared/anki.js';
import { MAX_MY_WORDS, cleanMyWord, mergeWords, addWord, removeWord, editWord, readingEntries } from '../shared/mywords.js';
import { syllables } from '../shared/pinyin.js';
import { sendMessage as send } from '../shared/messaging.js';

const $ = (id) => document.getElementById(id);
const MAX_ROWS = 500; // rows drawn at once; search narrows the rest
const LOOKUP_BATCH = 2000; // words per dictEntries message

let words = [];
let autoEn = ''; // English text the page filled in via #addZh lookup
let searchTimer = null;
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

/** Fetches CC-CEDICT entries for the words not looked up yet, in batches. */
async function fetchEntries(list) {
  const missing = [...new Set(list)].filter((zh) => !dict.has(zh) && zh.length <= 16);
  for (let i = 0; i < missing.length; i += LOOKUP_BATCH) {
    const batch = missing.slice(i, i + LOOKUP_BATCH);
    const found = await send({ type: 'dictEntries', words: batch }).catch(() => ({}));
    for (const zh of batch) dict.set(zh, found?.[zh] ?? []);
  }
}

async function entries(zh) {
  await fetchEntries([zh]);
  return dict.get(zh) ?? [];
}

const editing = () => !!document.querySelector('#rows input');

/** Lowercase text without tone marks, for search. */
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** First non-surname entry, or the first entry if none match. */
const firstMeaning = (found) => found.find((e) => !/^surname/i.test(e.defs)) ?? found[0];

function haystack(w) {
  const py = (dict.get(w.zh) ?? []).map((e) => e.pinyin.replace(/\d/g, '')).join(' ');
  return fold(`${w.zh} ${w.pinyin} ${py} ${w.en}`);
}

async function save(next) {
  try {
    const reply = await send({ type: 'setMyWords', words: next });
    if (typeof reply?.count !== 'number') throw new Error('the extension didn\'t save the list. Reload the extension (chrome://extensions or about:debugging) and try again');
    words = next;
  } catch (err) {
    $('importNote').textContent = `Couldn't save: ${err.message}`;
    render();
    return false;
  }
  // Clear earlier "Couldn't save" message on success.
  if ($('importNote').textContent.startsWith('Couldn\'t save')) {
    $('importNote').textContent = '';
  }
  render();
  return true;
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
    else td.textContent = w.en || '—';
  });
  td.replaceChildren(input);
  input.focus();
}

function row(w) {
  const entry = readingEntries(dict.get(w.zh) ?? [], w.pinyin)[0];
  const en = h('td', { className: 'en', textContent: w.en || '—', title: 'Click to edit' });
  en.addEventListener('click', () => editCell(en, w));
  const remove = h('button', { className: 'icon', textContent: '✕', title: `Remove ${w.zh}` });
  remove.addEventListener('click', async () => { await save(removeWord(words, w.zh)); });
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
  $('rows').replaceChildren(...list.slice(0, MAX_ROWS).map(row));
  const total = `${words.length.toLocaleString('en-US')} word${words.length === 1 ? '' : 's'}`;
  let count = list.length === words.length ? total : `${list.length.toLocaleString('en-US')} of ${total}`;
  if (list.length > MAX_ROWS) count += ` · showing the first ${MAX_ROWS}, search to narrow`;
  $('count').textContent = count;
  $('removeAll').disabled = !words.length;
  const empty = $('empty');
  empty.hidden = list.length > 0;
  empty.textContent = words.length ? 'No words match.' : 'No words yet. Import an Anki deck or add words above.';
}

async function load() {
  ({ myWords: words = [] } = await browser.storage.local.get('myWords'));
  render();
  await fetchEntries(words.map((w) => w.zh)); // pinyin and search
  if (!editing()) render();
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
    // The same cleaning the background applies, so "Added" counts only words that stay.
    const clean = [];
    const rejected = [];
    for (const w of deck.words) {
      const kept = cleanMyWord({ ...w, source });
      if (kept) clean.push(kept);
      else rejected.push(w.zh);
    }
    const merged = mergeWords(words, clean, mode);
    if (merged.words.length > MAX_MY_WORDS) {
      note.textContent = `Import failed: My words holds at most ${MAX_MY_WORDS.toLocaleString('en-US')} words (this would make ${merged.words.length.toLocaleString('en-US')}).`;
      return;
    }
    if (await save(merged.words)) {
      const parts = [`Added ${merged.added} new word${merged.added === 1 ? '' : 's'} from ${source}`];
      if (merged.existing) parts.push(`${merged.existing} already in your list`);
      if (deck.skipped.length) {
        parts.push(`${deck.skipped.length} skipped (no Chinese): ${deck.skipped.slice(0, 5).join(', ')}${deck.skipped.length > 5 ? ', …' : ''}`);
      }
      if (rejected.length) {
        parts.push(`${rejected.length} skipped (too long): ${rejected.slice(0, 5).join(', ')}${rejected.length > 5 ? ', …' : ''}`);
      }
      note.textContent = parts.join(' · ');
      load();
    }
  } catch (err) {
    note.textContent = `Import failed: ${err.message}`;
  }
});

$('addZh').addEventListener('change', async () => {
  const zh = $('addZh').value.trim();
  const found = zh ? await entries(zh) : [];
  // Ignore stale lookups from previous Chinese input.
  if ($('addZh').value.trim() !== zh) return;
  const first = firstMeaning(found);
  $('addPinyin').replaceChildren(first ? pinyinNode(first.pinyin) : '');
  if (first && (!$('addEn').value.trim() || $('addEn').value === autoEn)) {
    $('addEn').value = first.defs;
    autoEn = first.defs;
  } else if (!first && $('addEn').value === autoEn) {
    $('addEn').value = '';
    autoEn = '';
  }
});

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const zh = $('addZh').value.trim();
  let en = $('addEn').value;
  if (zh && !en) {
    const found = await entries(zh);
    en = firstMeaning(found)?.defs ?? '';
  }
  const next = addWord(words, { zh, en });
  if (!next) {
    $('addNote').textContent = 'Enter a word in Chinese characters (up to 16).';
    return;
  }
  const updated = words.some((w) => w.zh === zh);
  if (await save(next)) {
    $('addNote').textContent = updated ? `Updated ${zh}.` : `Added ${zh}.`;
    $('addZh').value = '';
    $('addEn').value = '';
    $('addPinyin').replaceChildren();
    autoEn = '';
    load();
  }
});

$('removeAll').addEventListener('click', async () => {
  if (!confirm(`Remove all ${words.length} words from My words?`)) return;
  await save([]);
});

$('query').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 150);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && !editing()) load(); });

// Another My words tab (or window) changed the list: follow it, so a save
// here starts from the latest list instead of overwriting that change.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('myWords' in changes)) return;
  words = changes.myWords.newValue ?? [];
  if (!editing()) render();
  fetchEntries(words.map((w) => w.zh)).then(() => { if (!editing()) render(); });
});

load();
