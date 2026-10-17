// Word list page: every looked-up word with its count, sortable and
// filterable, plus saved words and Anki / JSON export.

import { filterWords, sortWords, toAnkiTSV } from '../shared/history.js';
import { syllables } from '../shared/pinyin.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => browser.runtime.sendMessage(msg);

let words = [];
let tab = 'lookups';
const expanded = new Set();

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

function relativeDay(ts) {
  const days = Math.floor((startOfToday() - startOfDay(ts)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(ts).toLocaleDateString();
}
const startOfDay = (ts) => new Date(ts).setHours(0, 0, 0, 0);
const startOfToday = () => startOfDay(Date.now());

/** Highlights `word` inside an example sentence. */
function markWord(sentence, word) {
  const out = h('span', { className: 'zh' });
  const parts = sentence.split(word);
  parts.forEach((part, i) => {
    if (i) out.append(h('mark', { textContent: word }));
    out.append(part);
  });
  return out;
}

function filters() {
  return {
    tab,
    query: $('query').value,
    minCount: Number($('minCount').value) || 1,
    sinceDays: Number($('since').value),
  };
}

function visibleWords() {
  return sortWords(filterWords(words, filters()), $('sort').value);
}

function row(w) {
  const star = h('button', {
    className: `icon${w.saved ? ' on' : ''}`,
    title: w.saved ? 'Unsave' : 'Save',
    textContent: w.saved ? '★' : '☆',
  });
  star.addEventListener('click', async (e) => {
    e.stopPropagation();
    const result = await send({ type: 'setSaved', word: w.word, saved: !w.saved });
    Object.assign(w, result);
    render();
  });

  const del = h('button', { className: 'icon', title: 'Delete from history', textContent: '✕' });
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete ${w.word} and its ${w.count} lookups from your history?`)) return;
    await send({ type: 'deleteWord', word: w.word });
    words = words.filter((x) => x !== w);
    render();
  });

  const tr = h('tr', { className: 'word' },
    h('td', { className: 'star' }, star),
    h('td', { className: 'w', textContent: w.word }),
    h('td', { className: 'py' }, pinyinNode(w.pinyin)),
    h('td', { className: 'defs', textContent: w.defs }),
    h('td', { className: 'num' }, h('b', { textContent: String(w.count) }), '×'),
    h('td', { className: 'seen', textContent: relativeDay(w.lastSeen), title: new Date(w.lastSeen).toLocaleString() }),
    h('td', { className: 'act' }, del),
  );
  tr.addEventListener('click', () => {
    expanded.has(w.word) ? expanded.delete(w.word) : expanded.add(w.word);
    render();
  });

  if (!expanded.has(w.word)) return [tr];
  const examples = w.examples.length
    ? w.examples.map((ex) => h('div', { className: 'example' },
      markWord(ex.zh, w.word),
      ex.en ? h('div', { className: 'en', textContent: ex.en }) : null,
      ex.url ? h('a', { href: ex.url, target: '_blank', rel: 'noreferrer', textContent: hostOf(ex.url) }) : null))
    : [h('div', { className: 'muted', textContent: 'No example sentences yet.' })];
  const detail = h('tr', { className: 'examples' },
    h('td', { colSpan: 7 },
      h('div', { className: 'muted', textContent: `First seen ${new Date(w.firstSeen).toLocaleDateString()}` }),
      ...examples));
  return [tr, detail];
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function render() {
  const lookups = words.filter((w) => w.count > 0);
  const saved = words.filter((w) => w.saved);
  $('countLookups').textContent = lookups.length;
  $('countSaved').textContent = saved.length;
  const total = lookups.reduce((n, w) => n + w.count, 0);
  $('summary').textContent = words.length
    ? `${lookups.length} words, ${total} lookups in total. Click a row to see the sentences you met it in.`
    : '';

  for (const b of document.querySelectorAll('.tabs button')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  }

  const list = visibleWords();
  $('rows').replaceChildren(...list.flatMap(row));
  const empty = $('empty');
  empty.hidden = list.length > 0;
  if (!words.length) {
    empty.textContent = 'Nothing yet. Hover over Chinese words on any page; words you rest on are counted here.';
  } else if (!list.length) {
    empty.textContent = tab === 'saved' && !saved.length
      ? 'No saved words. Press S while a word’s popup is open, or click ☆ here.'
      : 'No words match these filters.';
  }
  $('exportTsv').textContent = `Export ${list.length} for Anki`;
  $('exportTsv').disabled = !list.length;
}

function download(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const today = () => new Date().toISOString().slice(0, 10);

async function load() {
  words = await send({ type: 'listWords' });
  render();
}

for (const b of document.querySelectorAll('.tabs button')) {
  b.addEventListener('click', () => { tab = b.dataset.tab; render(); });
}
for (const id of ['query', 'sort', 'minCount', 'since']) $(id).addEventListener('input', render);

$('exportTsv').addEventListener('click', () => {
  const list = visibleWords();
  download(`zh-immerse-anki-${today()}.tsv`, 'text/tab-separated-values', toAnkiTSV(list));
  $('exportNote').textContent = `Exported ${list.length} words. In Anki: File → Import, pick the file; fields map to word, pinyin, definition, count, example.`;
});
$('exportJson').addEventListener('click', () => {
  download(`zh-immerse-backup-${today()}.json`, 'application/json', JSON.stringify({ version: 1, words }, null, 1));
});
$('importJson').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const { imported, skipped } = await send({ type: 'importWords', records: data.words ?? data });
    $('exportNote').textContent = `Imported ${imported} words${skipped ? `, skipped ${skipped} invalid` : ''}.`;
    await load();
  } catch (err) {
    $('exportNote').textContent = `Import failed: ${err.message}`;
  }
  e.target.value = '';
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

load();
