// Hover dictionary: shows pinyin, meanings and the original English for the
// Chinese word under the pointer, and counts a lookup once the pointer has
// rested on the same word for DWELL_MS.

import { isCJK, sentenceAround } from '../shared/text.js';
import { syllables } from '../shared/pinyin.js';
import { MAX_LOOKUP } from '../shared/dict.js';
import { replacedAt } from '../shared/diglot.js';
import { speak, canSpeak } from './speech.js';
import { createOverlay } from './overlay.js';

const DWELL_MS = 600;
const HIDE_DELAY_MS = 250;
const MAX_ENTRIES = 4;
const MAX_DEFS_CHARS = 180;
const MAX_EN_CHARS = 320;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const NO_VOICE_HINT = 'No Chinese voice installed. Add one in System Settings → Accessibility → '
  + 'Spoken Content → System Voice → Manage Voices (e.g. Tingting, Chinese (China mainland)).';

const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

const isEditable = (t) => t instanceof Element
  && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

function pinyinNode(numbered) {
  const span = el('span', 'zhi-pop-py');
  syllables(numbered).forEach((s, i) => {
    if (i) span.append(' ');
    span.append(el('span', `zhi-t${s.tone || 5}`, s.text));
  });
  return span;
}

/** Text nodes of a ruby span that hold the Chinese characters (not the pinyin). */
function baseTextNodes(span) {
  const nodes = [];
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!node.parentElement.closest('rt, rp')) nodes.push(node);
  }
  return nodes;
}

export class Hover {
  /**
   * @param {object} opts
   * @param {import('./translate.js').PageTranslator} opts.translator
   * @param {(msg: object) => Promise<any>} opts.send  message to the background
   */
  constructor({ translator, send }) {
    this.translator = translator;
    this.send = send;
    this.enabled = false;
    this.matches = new Map(); // 8-char window -> dictionary match (or null)
    this.wordState = new Map(); // word -> { count, saved }
    this.current = null;
    this.token = 0;
    this.onMove = this.onMove.bind(this);
    this.onKey = this.onKey.bind(this);
    this.onScroll = () => this.hide();
    this.onDown = (e) => { if (e.isTrusted && !this.inCard(e)) this.hide(); };
  }

  /** Events from inside the closed shadow root reach document listeners
   * retargeted to the overlay host. */
  inCard(e) {
    return !!this.overlay && e.target === this.overlay.host;
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    document.addEventListener('mousemove', this.onMove, { capture: true, passive: true });
    document.addEventListener('keydown', this.onKey, true);
    document.addEventListener('mousedown', this.onDown, true);
    window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    window.addEventListener('blur', this.onScroll);
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    document.removeEventListener('mousemove', this.onMove, true);
    document.removeEventListener('keydown', this.onKey, true);
    document.removeEventListener('mousedown', this.onDown, true);
    window.removeEventListener('scroll', this.onScroll, true);
    window.removeEventListener('blur', this.onScroll);
    this.hide();
  }

  // ---- pointer tracking ------------------------------------------------

  onMove(e) {
    // Only real pointer movement: a page could otherwise fake hovers to read
    // the user's lookup counts from the popup or add lookups to the history.
    if (!e.isTrusted) return;
    if (this.inCard(e)) {
      clearTimeout(this.hideTimer);
      return;
    }
    this.pointer = { x: e.clientX, y: e.clientY };
    this.frame ??= requestAnimationFrame(() => {
      this.frame = null;
      this.process();
    });
  }

  /** The Chinese character under (x, y), or null. */
  hitTest(x, y) {
    const pos = document.caretPositionFromPoint(x, y);
    const node = pos?.offsetNode;
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    if (node.parentElement?.closest('rt, rp')) return null;
    for (const offset of [pos.offset, pos.offset - 1]) {
      if (offset < 0 || offset >= node.data.length || !isCJK(node.data[offset])) continue;
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      for (const r of range.getClientRects()) {
        if (x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1) {
          return { node, offset, rect: r };
        }
      }
    }
    return null;
  }

  inCurrentWord(hit) {
    return this.current?.positions
      .slice(0, this.current.match.word.length)
      .some(([n, o]) => n === hit.node && o === hit.offset);
  }

  /** Characters from the hit onward, plus the sentence context for history. */
  context(hit) {
    const info = this.translator.segmentFor(hit.node);
    let nodes = [hit.node];
    let index = 0;
    if (info?.seg.ruby) {
      nodes = baseTextNodes(info.seg.ruby);
      index = Math.max(0, nodes.indexOf(hit.node));
    }

    let text = '';
    const positions = [];
    for (let i = index, start = hit.offset; i < nodes.length && text.length < MAX_LOOKUP; i++, start = 0) {
      const data = nodes[i].data;
      for (let j = start; j < data.length && text.length < MAX_LOOKUP; j++) {
        text += data[j];
        positions.push([nodes[i], j]);
      }
    }

    let zh = hit.node.data;
    let offset = hit.offset;
    let en = '';
    let replaced = '';
    if (info) {
      const { seg, state } = info;
      const inSeg = nodes.slice(0, index).reduce((n, t) => n + t.data.length, 0) + hit.offset;
      const before = state?.segs ?? [];
      const segIndex = before.indexOf(seg);
      zh = state?.zh || seg.zh;
      offset = (segIndex > 0 ? before.slice(0, segIndex).reduce((n, s) => n + s.zh.length, 0) : 0) + inSeg;
      en = state?.en || seg.en;
      // At graded levels: the English word this Chinese word was swapped in for.
      replaced = replacedAt(seg.swaps, inSeg);
    }
    // At graded levels the page shows mixed English/Chinese; the example
    // sentence (saved with lookups and read aloud) is the full Chinese.
    const full = info?.state?.full ?? null;
    return { text, positions, rect: hit.rect, sentence: sentenceAround(zh, offset), en, full, replaced };
  }

  async lookup(text) {
    if (this.matches.has(text)) return this.matches.get(text);
    const result = await this.send({ type: 'lookup', text });
    if (result) {
      this.wordState.set(result.word, { count: result.count, saved: result.saved });
    }
    const match = result && { word: result.word, entries: result.entries };
    this.matches.set(text, match);
    if (this.matches.size > 1000) this.matches.delete(this.matches.keys().next().value);
    return match;
  }

  async process() {
    if (!this.pointer) return;
    const hit = this.hitTest(this.pointer.x, this.pointer.y);
    if (this.inCurrentWord(hit ?? {})) {
      clearTimeout(this.hideTimer);
      return;
    }
    // The pointer left the word: it no longer counts as a lookup, even though
    // the popup lingers briefly so it can be reached with the mouse.
    clearTimeout(this.dwellTimer);
    const token = ++this.token;
    if (!hit) {
      this.scheduleHide();
      return;
    }
    const ctx = this.context(hit);
    let match;
    try {
      match = await this.lookup(ctx.text);
    } catch {
      return; // background unavailable (e.g. extension reloading)
    }
    if (token !== this.token) return;
    if (!match) {
      this.scheduleHide();
      return;
    }
    if (ctx.full) ctx.sentence = sentenceAround(ctx.full, Math.max(0, ctx.full.indexOf(match.word)));
    this.show({ ...ctx, match });
  }

  // ---- popup -----------------------------------------------------------

  ensureCard() {
    if (this.overlay?.host.isConnected) return;
    this.overlay = createOverlay();
    this.card = el('div', 'zhi-pop');
    this.card.hidden = true;
    this.card.addEventListener('mouseleave', () => this.scheduleHide());
    this.card.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      if (e.target.closest('.zhi-pop-save')) this.toggleSave();
      else if (e.target.closest('.zhi-pop-say-word')) this.say('word');
      else if (e.target.closest('.zhi-pop-say-sentence')) this.say('sentence');
    });
    this.overlay.root.append(this.card);
  }

  show(current) {
    clearTimeout(this.hideTimer);
    clearTimeout(this.dwellTimer);
    this.current = current;
    this.ensureCard();
    this.render();
    this.place(current.rect);
    this.highlight();
    this.dwellTimer = setTimeout(() => this.countLookup(current), DWELL_MS);
  }

  render() {
    const { match, en, replaced } = this.current;
    const state = this.wordState.get(match.word) ?? { count: 0, saved: false };
    const card = this.card;
    card.replaceChildren();

    const head = el('div', 'zhi-pop-head');
    head.append(el('span', 'zhi-pop-word', match.word));
    if (canSpeak()) {
      const sayWord = el('span', 'zhi-pop-say zhi-pop-say-word', '🔊');
      sayWord.title = 'Play word (P)';
      head.append(sayWord);
    }
    head.append(pinyinNode(match.entries[0].pinyin));
    card.append(head);
    if (replaced) {
      const line = el('div', 'zhi-pop-replaced', 'replaces ');
      line.append(el('b', null, `“${replaced}”`));
      card.append(line);
    }

    const multi = new Set(match.entries.map((e) => e.pinyin.toLowerCase())).size > 1;
    const list = el('div', 'zhi-pop-entries');
    for (const entry of match.entries.slice(0, MAX_ENTRIES)) {
      const row = el('div', 'zhi-pop-entry');
      if (multi) row.append(pinyinNode(entry.pinyin), ' ');
      row.append(el('span', 'zhi-pop-defs', truncate(entry.defs, MAX_DEFS_CHARS)));
      list.append(row);
    }
    card.append(list);

    if (en) card.append(el('div', 'zhi-pop-en', truncate(en, MAX_EN_CHARS)));
    if (this.noVoice) card.append(el('div', 'zhi-pop-note', NO_VOICE_HINT));

    const foot = el('div', 'zhi-pop-foot');
    const actions = el('span', 'zhi-pop-actions');
    if (canSpeak() && this.current.sentence) {
      const saySentence = el('span', 'zhi-pop-say-sentence', '🔊 Sentence ');
      saySentence.title = 'Play the whole sentence (Shift+P)';
      saySentence.append(el('span', 'zhi-pop-key', '⇧P'));
      actions.append(saySentence);
    }
    const save = el('span', 'zhi-pop-save', state.saved ? '★ Saved ' : '☆ Save ');
    save.append(el('span', 'zhi-pop-key', 'S'));
    actions.append(save);
    foot.append(actions, el('span', 'zhi-pop-count', state.count ? `looked up ${state.count}×` : 'new word'));
    card.append(foot);
    card.hidden = false;
  }

  place(rect) {
    const card = this.card;
    card.style.left = '0px';
    card.style.top = '0px';
    const { width, height } = card.getBoundingClientRect();
    const gap = 6;
    let top = rect.bottom + gap;
    if (top + height > innerHeight - 8 && rect.top - gap - height > 8) top = rect.top - gap - height;
    const left = Math.max(8, Math.min(rect.left - 8, innerWidth - width - 8));
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  }

  highlight() {
    if (typeof Highlight === 'undefined' || !CSS.highlights) return;
    try {
      const { positions, match } = this.current;
      const [startNode, startOffset] = positions[0];
      const [endNode, endOffset] = positions[match.word.length - 1];
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset + 1);
      CSS.highlights.set('zhi-word', new Highlight(range));
    } catch {
      // Highlight API unavailable in this context; the popup still works.
    }
  }

  scheduleHide() {
    if (!this.current) return;
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), HIDE_DELAY_MS);
  }

  hide() {
    clearTimeout(this.hideTimer);
    clearTimeout(this.dwellTimer);
    this.current = null;
    if (this.card) this.card.hidden = true;
    try { CSS.highlights?.delete('zhi-word'); } catch { /* not supported */ }
  }

  // ---- history ---------------------------------------------------------

  wordInfo(current) {
    const entry = current.match.entries[0];
    return {
      word: current.match.word,
      pinyin: entry.pinyin,
      defs: entry.defs,
      zh: current.sentence,
      en: truncate(current.en, 500),
      url: location.href,
    };
  }

  async countLookup(current) {
    if (this.current !== current) return;
    try {
      const { count, saved } = await this.send({ type: 'recordLookup', ...this.wordInfo(current) });
      this.wordState.set(current.match.word, { count, saved });
      if (this.current === current) this.render();
    } catch {
      // background unavailable; nothing to update
    }
  }

  async toggleSave() {
    const current = this.current;
    if (!current) return;
    const word = current.match.word;
    const saved = !this.wordState.get(word)?.saved;
    const result = await this.send({ type: 'setSaved', saved, ...this.wordInfo(current) });
    this.wordState.set(word, result);
    if (this.current === current) this.render();
  }

  /** Reads the hovered word, or the sentence it's in, aloud. */
  async say(what) {
    const current = this.current;
    if (!current) return;
    const text = what === 'sentence' ? current.sentence : current.match.word;
    const { voice } = await speak(text);
    if (!voice !== !!this.noVoice) {
      this.noVoice = !voice;
      if (this.current === current) this.render();
    }
  }

  onKey(e) {
    if (!e.isTrusted || !this.current || this.card?.hidden) return;
    if (e.key === 'Escape') {
      this.hide();
    } else if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditable(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      this.say(e.shiftKey ? 'sentence' : 'word');
    } else if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditable(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      this.toggleSave();
    }
  }
}
