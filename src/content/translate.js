// Finds English text on the page and replaces it with Chinese.
//
// Design notes:
// - Text is grouped into "units": the nearest ancestor of a text node whose CSS
//   display isn't inline (a paragraph, list item, button, table cell...). A
//   unit is translated as a whole so the translator sees full sentences.
// - Text nodes are edited in place (node.data = 中文) instead of being
//   replaced by new elements, so frameworks like React that hold references to
//   those nodes keep working. Originals are kept in memory for restoring.
// - A unit with several text nodes (e.g. a sentence containing a link) is sent
//   as an array of segments; the host returns the Chinese split back into the
//   same segments, so each link keeps its own (translated) text.
// - Units are translated when they come near the viewport, and a
//   MutationObserver picks up content that appears or changes later. Units
//   on screen are sent as urgent; a unit sent ahead of scrolling that comes
//   on screen while still waiting is moved up (prioritize).

import { looksEnglish, collapseSpace } from '../shared/text.js';
import { makeRuby, RUBY_CLASS } from './ruby.js';
import { FULL_LEVEL } from '../shared/diglot.js';

export const OWN_ATTR = 'data-zhi';

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
  'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'TT', 'IFRAME', 'OBJECT', 'CANVAS',
  'SVG', 'MATH', 'RT', 'RP', 'HEAD', 'TITLE',
]);
const MAX_ITEM_CHARS = 1500;
const ROOT_MARGIN = '800px 0px';
const SCAN_BUDGET_MS = 12;

const isElement = (n) => n.nodeType === Node.ELEMENT_NODE;
const isText = (n) => n.nodeType === Node.TEXT_NODE;

function skipElement(el) {
  return SKIP_TAGS.has(el.tagName.toUpperCase())
    || el.hasAttribute(OWN_ATTR)
    || el.getAttribute('translate') === 'no'
    || el.classList.contains('notranslate')
    || el.isContentEditable;
}

/** True if a rect (from getBoundingClientRect) is at least partly in the
 * viewport of a tab the user is looking at (hidden tabs report rects too). */
function onScreen(rect) {
  return document.visibilityState === 'visible'
    && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
}

function insideSkipped(node) {
  for (let el = isElement(node) ? node : node.parentElement; el; el = el.parentElement) {
    if (skipElement(el)) return true;
  }
  return false;
}

export class PageTranslator {
  /**
   * @param {object} opts
   * @param {(items: Array<string|string[]>, level: number, urgent: boolean) => Promise<Array<string|string[]|object|null>>} opts.translate
   *   Resolves with one result per item: the full translation (level 7), or at
   *   levels 0–6 { segments, ranges, full } with only HSK (or My words) words swapped in.
   *   urgent: the unit is on screen (not just near it).
   * @param {(items: Array<string|string[]>) => void} [opts.prioritize]
   *   Asks for items already sent (not urgent) to go first: they're on screen now.
   * @param {(err: Error) => void} [opts.onError]
   */
  constructor({ translate, prioritize = () => {}, onError = () => {} }) {
    this.translateFn = translate;
    this.prioritizeFn = prioritize;
    this.onError = onError;
    this.active = false;
    this.pinyin = false;
    this.level = FULL_LEVEL;
    this.blocked = null; // error code that stopped translation (host missing, etc.)
    this.reset();
  }

  reset() {
    this.blockCache = new WeakMap(); // element -> boolean (non-inline display)
    this.units = new WeakMap(); // unit element -> { status, seq, segs, en, zh, full, dirty, items (while pending) }
    this.segs = new WeakMap(); // text node -> seg { node, en, zh, unit, ruby, swaps, marks }
    this.allSegs = new Set();
    this.rubyOwner = new WeakMap(); // ruby span -> seg
    this.scanQueue = [];
    this.scanTimer = null;
    this.retranslateSet = new Set();
  }

  // ---- lifecycle -------------------------------------------------------

  start() {
    if (this.active || !document.body) return;
    this.active = true;
    this.blocked = null;
    this.io = new IntersectionObserver((entries) => this.onIntersect(entries), { rootMargin: ROOT_MARGIN });
    this.seen = new IntersectionObserver((entries) => this.onSeen(entries));
    this.mo = new MutationObserver((records) => this.onMutations(records));
    this.mo.observe(document.body, { subtree: true, childList: true, characterData: true });
    this.queueScan(document.body);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.io.disconnect();
    this.seen.disconnect();
    this.mo.disconnect();
    clearTimeout(this.scanTimer);
    for (const seg of this.allSegs) {
      this.detachRuby(seg);
      if (seg.node.isConnected && seg.node.data === seg.zh) seg.node.data = seg.en;
    }
    this.swapHighlight()?.clear();
    this.reset();
  }

  /** 0: swap only My words; 1–6: swap only HSK words up to that level; 7: translate everything. */
  setLevel(level) {
    if (this.level === level) return;
    this.level = level;
    if (this.active) {
      this.stop();
      this.start(); // translations are cached, so redoing the page is quick
    }
  }

  setPinyin(on) {
    if (this.pinyin === on) return;
    this.pinyin = on;
    this.withoutObserver(() => {
      for (const seg of this.allSegs) on ? this.attachRuby(seg) : this.detachRuby(seg);
    });
  }

  get translatedCount() {
    return this.allSegs.size;
  }

  // ---- scanning --------------------------------------------------------

  queueScan(root) {
    this.scanQueue.push(root);
    this.scanTimer ??= setTimeout(() => this.runScan(), 50);
  }

  runScan() {
    this.scanTimer = null;
    if (!this.active) return;
    const deadline = performance.now() + SCAN_BUDGET_MS;
    while (this.scanQueue.length) {
      const item = this.scanQueue[0];
      // A queue entry is either a root node or an in-progress walker.
      if (!item.walker) {
        this.scanQueue[0] = { walker: this.candidates(item) };
        continue;
      }
      let step;
      while (!(step = item.walker.next()).done) {
        this.register(step.value);
        if (performance.now() > deadline) {
          this.scanTimer = setTimeout(() => this.runScan(), 0);
          return;
        }
      }
      this.scanQueue.shift();
    }
  }

  /** Yields text nodes under root that might contain English. */
  *candidates(root) {
    if (!root.isConnected || insideSkipped(root)) return;
    if (isText(root)) {
      if (/[A-Za-z]{2}/.test(root.data)) yield root;
      return;
    }
    if (!isElement(root)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (isElement(node)) return skipElement(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        return /[A-Za-z]{2}/.test(node.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    let node;
    while ((node = walker.nextNode())) yield node;
  }

  isBlock(el) {
    let block = this.blockCache.get(el);
    if (block === undefined) {
      const display = getComputedStyle(el).display;
      block = display !== 'inline' && display !== 'contents';
      this.blockCache.set(el, block);
    }
    return block;
  }

  unitOf(node) {
    let el = node.parentElement;
    while (el && el !== document.body && !this.isBlock(el)) el = el.parentElement;
    return el;
  }

  register(textNode) {
    if (this.segs.has(textNode)) return;
    const unit = this.unitOf(textNode);
    if (!unit) return;
    const state = this.units.get(unit);
    if (!state) {
      this.units.set(unit, { status: 'observed', seq: 0, segs: [], en: '', zh: '' });
      this.io.observe(unit);
    } else if (state.status === 'done') {
      this.scheduleRetranslate(unit); // new English appeared inside a translated unit
    } else if (state.status === 'pending') {
      state.dirty = true;
    }
  }

  onIntersect(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      this.io.unobserve(entry.target);
      this.translateUnit(entry.target, onScreen(entry.boundingClientRect));
    }
  }

  /** A unit sent ahead of scrolling came on screen. */
  onSeen(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      this.seen.unobserve(entry.target);
      const state = this.units.get(entry.target);
      if (state?.status === 'pending') this.prioritizeFn(state.items);
    }
  }

  // ---- translating -----------------------------------------------------

  /** The English currently represented by a text node (its original if we translated it). */
  englishOf(node) {
    const seg = this.segs.get(node);
    const ours = seg && (node.data === seg.zh || (seg.ruby && node.data === ''));
    return ours ? seg.en : node.data;
  }

  /**
   * Splits a unit's text nodes into translation items. Text nodes that belong
   * to a nested unit are left for that unit; <br> starts a new item.
   */
  collect(unit) {
    const groups = [[]];
    const self = this;
    const walker = document.createTreeWalker(unit, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (isElement(node)) {
          if (node.tagName === 'BR') { groups.push([]); return NodeFilter.FILTER_SKIP; }
          if (skipElement(node) || self.isBlock(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      const en = this.englishOf(node);
      if (!en.trim()) continue;
      const group = groups[groups.length - 1];
      const size = group.reduce((n, s) => n + s.en.length, 0);
      if (group.length && size + en.length > MAX_ITEM_CHARS) groups.push([]);
      groups[groups.length - 1].push({ node, en });
    }
    return groups.filter((g) => g.length && looksEnglish(g.map((s) => s.en).join('')));
  }

  async translateUnit(unit, urgent = null) {
    const state = this.units.get(unit);
    if (!this.active || !state || this.blocked || !unit.isConnected) return;
    urgent ??= onScreen(unit.getBoundingClientRect());
    const groups = this.collect(unit);
    if (!groups.length) { state.status = 'done'; return; }

    state.status = 'pending';
    state.dirty = false;
    const seq = ++state.seq;
    const items = groups.map((group) => {
      const texts = group.map((s) => collapseSpace(s.en));
      texts[0] = texts[0].trimStart();
      texts[texts.length - 1] = texts[texts.length - 1].trimEnd();
      return texts.length === 1 ? texts[0] : texts;
    });

    state.items = items;
    if (!urgent) this.seen.observe(unit);

    // Superseded by a newer request for this unit, or by stop()/start()
    // (a level change), which made new units and a new `seen` observer.
    const stale = () => !this.active || this.units.get(unit) !== state || state.seq !== seq;

    let results;
    try {
      results = await this.translateFn(items, this.level, urgent);
    } catch (err) {
      if (['hostMissing', 'notInstalled', 'unsupported'].includes(err.code)) this.blocked = err.code;
      this.onError(err);
      if (stale()) return;
      this.seen.unobserve(unit);
      state.status = 'observed';
      state.items = null;
      return;
    }
    if (stale()) return;
    this.seen.unobserve(unit);
    state.items = null;

    const fulls = [];
    this.withoutObserver(() => {
      groups.forEach((group, g) => {
        const result = results[g];
        if (result == null) return;
        if (result.segments) {
          // Graded: only text nodes with swapped words change.
          if (result.full != null) fulls.push(result.full);
          group.forEach((s, i) => {
            if (result.ranges[i]?.length) this.applySegment(s.node, s.en, result.segments[i], unit, result.ranges[i]);
          });
          return;
        }
        const parts = Array.isArray(result) ? result : [result];
        group.forEach((s, i) => this.applySegment(s.node, s.en, parts[i] ?? '', unit));
      });
    });
    state.segs = groups.flat().map((s) => this.segs.get(s.node)).filter(Boolean);
    state.en = collapseSpace(groups.flat().map((s) => s.en).join('')).trim();
    state.zh = state.segs.map((s) => s.zh).join('');
    state.full = fulls.length ? fulls.join('') : null; // full Chinese, for graded levels
    state.status = 'done';
    if (state.dirty) this.scheduleRetranslate(unit);
  }

  applySegment(node, en, zh, unit, swaps = null) {
    if (!node.isConnected || this.englishOf(node) !== en) return; // changed meanwhile
    let seg = this.segs.get(node);
    if (seg) {
      this.detachRuby(seg);
      this.unmarkSwaps(seg);
    } else {
      seg = { node, en, zh, unit, ruby: null, swaps: null, marks: [] };
      this.segs.set(node, seg);
      this.allSegs.add(seg);
    }
    seg.en = en;
    seg.zh = zh;
    seg.unit = unit;
    seg.swaps = swaps;
    node.data = zh;
    this.markSwaps(seg);
    if (this.pinyin) this.attachRuby(seg);
  }

  // ---- swapped-word underline (graded levels) ---------------------------

  // Drawn with the CSS Custom Highlight API, so no elements are added.

  swapHighlight() {
    if (this.highlight === undefined) {
      try {
        this.highlight = new Highlight();
        CSS.highlights.set('zhi-swap', this.highlight);
      } catch {
        this.highlight = null; // not supported: swapped words just aren't underlined
      }
    }
    return this.highlight;
  }

  markSwaps(seg) {
    const highlight = seg.swaps?.length && this.swapHighlight();
    if (!highlight || seg.node.data !== seg.zh) return;
    for (const [start, end] of seg.swaps) {
      const range = document.createRange();
      range.setStart(seg.node, start);
      range.setEnd(seg.node, end);
      highlight.add(range);
      seg.marks.push(range);
    }
  }

  unmarkSwaps(seg) {
    for (const range of seg.marks) this.highlight?.delete(range);
    seg.marks = [];
  }

  scheduleRetranslate(unit) {
    if (this.retranslateSet.has(unit)) return;
    this.retranslateSet.add(unit);
    setTimeout(() => {
      this.retranslateSet.delete(unit);
      this.translateUnit(unit);
    }, 100);
  }

  // ---- pinyin (ruby) ---------------------------------------------------

  // With pinyin on, the text node is emptied (but kept in place, so the page's
  // own DOM updates still find it) and a ruby span is inserted right after it.

  attachRuby(seg) {
    if (seg.ruby || !seg.zh || !seg.node.isConnected || seg.node.data !== seg.zh) return;
    const span = makeRuby(seg.zh);
    span.setAttribute(OWN_ATTR, '');
    this.unmarkSwaps(seg);
    seg.node.after(span);
    seg.node.data = '';
    seg.ruby = span;
    this.rubyOwner.set(span, seg);
  }

  detachRuby(seg) {
    if (!seg.ruby) return;
    seg.ruby.remove();
    seg.ruby = null;
    if (seg.node.data === '') {
      seg.node.data = seg.zh;
      this.markSwaps(seg);
    }
  }

  // ---- page changes ----------------------------------------------------

  withoutObserver(fn) {
    if (!this.mo) return fn();
    this.handle(this.mo.takeRecords());
    try {
      fn();
    } finally {
      this.mo.takeRecords(); // drop records caused by our own edits
    }
  }

  onMutations(records) {
    if (this.active) this.handle(records);
  }

  handle(records) {
    let removed = false;
    for (const r of records) {
      if (r.type === 'characterData') {
        const node = r.target;
        const seg = this.segs.get(node);
        if (seg) {
          if (node.data === seg.zh || (seg.ruby && node.data === '')) continue; // ours
          // The page replaced text we translated: forget it and re-translate.
          this.detachRuby(seg);
          this.unmarkSwaps(seg);
          this.segs.delete(node);
          this.allSegs.delete(seg);
          if (seg.unit.isConnected) this.scheduleRetranslate(seg.unit);
        } else if (/[A-Za-z]{2}/.test(node.data)) {
          this.queueScan(node);
        }
        continue;
      }
      for (const node of r.addedNodes) {
        if (isElement(node) && node.hasAttribute(OWN_ATTR)) continue;
        this.queueScan(node);
      }
      if (r.removedNodes.length) removed = true;
    }
    if (removed) this.schedulePrune();
  }

  schedulePrune() {
    this.pruneTimer ??= setTimeout(() => {
      this.pruneTimer = null;
      for (const seg of this.allSegs) {
        if (seg.node.isConnected) continue;
        seg.ruby?.remove();
        this.unmarkSwaps(seg);
        this.allSegs.delete(seg);
      }
    }, 2000);
  }

  // ---- hover support ---------------------------------------------------

  /** Returns { seg, state } for a text node we translated (directly or via ruby). */
  segmentFor(node) {
    const span = node.parentElement?.closest(`.${RUBY_CLASS}`);
    const seg = span ? this.rubyOwner.get(span) : this.segs.get(node);
    if (!seg) return null;
    return { seg, state: this.units.get(seg.unit) };
  }
}
