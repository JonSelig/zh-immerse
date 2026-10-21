# Wrong-meaning Swaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop graded levels swapping in a shorter, wrong meaning (on your
right → 是) by preferring the longest Chinese word the sentence uses, and add
a ⚑ Report action plus a "Reported swaps" tab to collect wrong swaps for later.

**Architecture:** The choice of word happens in `findSwaps`
(`src/shared/diglot.js`). It now collects every candidate for the English
word, including HSK "competitors" at 我的, and swaps only the first known
candidate among the longest present ones. Reports are cleaned and merged by
pure helpers in `src/shared/reports.js`. The background stores them in
`browser.storage.local` (`swapReports`) through `src/background/reports.js`.
The hover popup sends them, and the word list page shows, exports and
deletes them.

**Tech Stack:** Plain ES modules bundled by esbuild, WebExtension APIs
(`browser.*`), `node:test` unit tests (`npm test`).

**Spec:** `docs/superpowers/specs/2026-10-20-wrong-meaning-swaps-design.md`

## Global Constraints

- **Where to work:** the worktree `/Users/jons/zh-immersion/zh-immerse-d`, on branch `feature/wrong-meaning-swaps`. It is based on `fix/verb-preposition-swaps`.
- **Testing:**
  - run tests with `npm test` (= `node --experimental-sqlite --test 'test/unit/*.test.js'`);
  - build with `npm run build`;
  - every test must pass before each commit.
- **Scope:** no change at 全部 (level 7), and no extra translation calls.
- **Text limits:**
  - `swapEn` and `swapZh` up to 64 characters; `en` and `zh` up to 2,000;
  - longer text is cut, not rejected;
  - at most 500 reports, newest first;
  - the same `swapEn` + `swapZh` + `en` is stored once, with `ts` updated.
- **Report fields:** `{ id, ts, swapEn, swapZh, en, zh, level, url }`. `url` goes through `pageUrl()` (origin + path only).
- **Private windows** (`sender.tab.incognito`): nothing is stored. The reply is `{ stored: false }`, and the popup shows "Not saved in private windows".
- **Messages:**
  - `reportSwap` is allowed from content scripts;
  - `listSwapReports`, `deleteSwapReport` and `clearSwapReports` are page-only (`PAGE_ONLY`).
- **Exact copy:**
  - popup action "⚑ Report", with the tooltip "Report this as a wrong swap"; after a click, "Reported ✓";
  - tab "Reported swaps";
  - buttons "Export reports (JSON)" and "Clear all…";
  - export file `zh-immerse-swap-reports-YYYY-MM-DD.json` containing `{ version: 1, reports: [...] }`.
- **Clicks:** only trusted clicks (`e.isTrusted`) count, as for Save.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Style:** match the surrounding code. Short top-of-file comments, JSDoc on exported functions, no semicolon-free style, 2-space indent.

## Review Focus

1. **A blocked phrase.** When a 2–3 word phrase's longest present candidate is unknown, the English of the whole phrase stays. Its words must not be swapped one by one (Task 1 test "a blocked phrase keeps its words English").
2. **Hostile pages.** A page could send many `reportSwap` messages or huge fields. Expect the guard to refuse non-strings and fields over 20,000 characters, cleaning to cut the rest, and the cap to stay at 500 (Task 2 tests).
3. **Concurrent reports.** Two reports at once from two tabs must both be stored. Expect read-modify-write calls to be serialized in `src/background/reports.js` (Task 2, chained `update`).
4. **Report button on unswapped words.** At 全部, or on a word that wasn't swapped, there is no ⚑ Report. It shows only when the popup shows *replaces "…"* (Task 3, rendered only if `replaced`).
5. **Empty and bad stored data.** A missing or non-array `swapReports` value must read as `[]`, and the tab must show an empty message (Task 2 `listReports`, Task 4 render).

---

### Task 1: Better word wins

**Files:**
- Modify: `src/shared/diglot.js` (`findSwaps`, around lines 120–175)
- Modify: `src/background/graded.js` (`gradeItems`)
- Test: `test/unit/diglot.test.js` (append)

**Interfaces:**
- Produces: `findSwaps(text, map, level, inTranslation, { isWord, knownPrep, competitors })`. `competitors` is an optional `Map` in the same shape as `map` (`english -> [{ zh, level }]`). Its entries compete but are known only when the same `zh` is also in `map` for that key; they're deduplicated with `map`'s entries first. `diglotItem` passes `options` through unchanged.

- [ ] **Step 1: Write the failing tests** (append to `test/unit/diglot.test.js`)

```js
const rightMap = parseWordMap([
  'right\t是:1,对:1,正:1,右:1,右边:1,当:2,不错:2,正确:2,权利:4,权:6',
  'right side\t右边:1',
].join('\n'));
const LOCKER_EN = 'You can find a bank of lockers on your right opposite the Central Ticket Office.';
const LOCKER_ZH = '在中央售票处对面，您的右边是一排储物柜。';
const pairs = (swaps) => swaps.map((s) => [s.en, s.zh]);

test('the longest Chinese word for an English word wins (right -> 右边, not 是)', () => {
  assert.deepEqual(pairs(findSwaps(LOCKER_EN, rightMap, 1, translationWords(LOCKER_ZH))), [['right', '右边']]);
});

test('a longer word above the level keeps the English', () => {
  const zh = '你的答案是正确的。';
  assert.deepEqual(pairs(findSwaps('Your answer is right.', rightMap, 1, translationWords(zh))), []);
  assert.deepEqual(pairs(findSwaps('Your answer is right.', rightMap, 2, translationWords(zh))), [['right', '正确']]);
});

test('equal lengths keep the list order', () => {
  const like = parseWordMap(['like\t爱:1,喜欢:1,一样:1', 'apple\t苹果:1'].join('\n'));
  assert.deepEqual(pairs(findSwaps('I like apples.', like, 1, translationWords('我喜欢一样的苹果。'))),
    [['like', '喜欢'], ['apples', '苹果']]);
});

test('at 我的, HSK competitors block a shorter word from the list', () => {
  const mine = new Map([['right', [{ zh: '是', level: 0 }]]]);
  const test = translationWords(LOCKER_ZH);
  // The list alone would pick 是; the sentence uses the more specific 右边.
  assert.deepEqual(pairs(findSwaps(LOCKER_EN, mine, 0, test)), [['right', '是']]);
  assert.deepEqual(pairs(findSwaps(LOCKER_EN, mine, 0, test, { competitors: rightMap })), []);
});

test('at 我的, a competitor that is also on the list is known', () => {
  const mine = new Map([['right', [{ zh: '右边', level: 0 }, { zh: '是', level: 0 }]]]);
  assert.deepEqual(pairs(findSwaps(LOCKER_EN, mine, 0, translationWords(LOCKER_ZH), { competitors: rightMap })),
    [['right', '右边']]);
});

test('a blocked phrase keeps its words English', () => {
  const map2 = parseWordMap(['bus stop\t公交车站:3', 'bus\t公交车:2', 'stop\t站:1'].join('\n'));
  const zh = '他在公交车站等。';
  assert.deepEqual(pairs(findSwaps('He waits at the bus stop.', map2, 2, translationWords(zh))), []);
  assert.deepEqual(pairs(findSwaps('He waits at the bus stop.', map2, 3, translationWords(zh))), [['bus stop', '公交车站']]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | grep -E "^not ok|^ℹ (pass|fail)"`
Expected: FAIL in "the longest Chinese word … wins" (gets 是), "a longer word above the level" (gets 是 at level 1), "HSK competitors block" (the second assertion gets 是). "a blocked phrase" may already pass or fail, depending on segmentation; it pins the behavior either way. "equal lengths" passes (guard against regression).

- [ ] **Step 3: Implement the candidate choice in `findSwaps`**

In `src/shared/diglot.js`, update the JSDoc and the signature, and replace the `entry` lookup. The current code is:

```js
      let entry = null;
      for (const form of lemmas(last)) {
        entry = map.get([...head, form].join(' '))
          ?.find((c) => c.level <= level && inTranslation(c.zh));
        if (entry) break;
      }
      if (!entry) continue;
```

Replace it with:

```js
      // Every candidate for this English, the map's first, then competitors.
      const candidates = [];
      for (const form of lemmas(last)) {
        const key = [...head, form].join(' ');
        for (const c of [...(map.get(key) ?? []), ...(competitors?.get(key) ?? [])]) {
          if (!candidates.some((x) => x.zh === c.zh)) candidates.push(c);
        }
      }
      const present = candidates.filter((c) => inTranslation(c.zh));
      if (!present.length) continue;
      // The sentence's most specific word for it decides: swap it if it's
      // known, otherwise leave the English (right -> 右边, never 是 "is").
      const longest = Math.max(...present.map((c) => c.zh.length));
      const entry = present.find((c) => c.zh.length === longest && c.level <= level);
      if (!entry) {
        i += n - 1; // the whole phrase stays English
        break;
      }
```

Signature and JSDoc:

```js
/**
 * Finds English words/phrases in `text` to swap at `level`.
 * -> [{ start, end, zh, en }] in text order, non-overlapping.
 * Of the candidates the translation contains, only the longest count: the
 * first known one of that length is swapped in, or none (the sentence uses a
 * meaning the reader hasn't learned).
 * Options: `isWord` (dictionary check) enables verb + preposition phrases
 * (live in -> 住在) when the translation has them as a non-word segment;
 * `knownPrep(p)` says whether 在/到/给/成 may be shown (default: by HSK level);
 * `competitors` (at 我的, the HSK map) adds candidates that compete but are
 * never shown unless the same word is also in `map`.
 */
export function findSwaps(text, map, level, inTranslation, {
  isWord = null,
  knownPrep = (p) => VERB_PREPS[p].level <= level,
  competitors = null,
} = {}) {
```

Also update the module's top comment. Add one sentence after "A candidate is used only if it also appears in Apple's translation…":

```js
// When the translation has several candidates, the longest wins: "on your
// right" (您的右边是…) gives 右边, not 是 ("is").
```

- [ ] **Step 4: Pass the HSK map as competitors at 我的** (`src/background/graded.js`)

Replace the body of `gradeItems` with:

```js
export async function gradeItems(items, translations, level) {
  const [dict, words, hsk] = await Promise.all([
    dictionary().catch(() => null), // without it, swapping still works, just without 住在 phrases
    level === MY_LEVEL ? loadMine() : load(),
    level === MY_LEVEL ? load().catch(() => null) : null,
  ]);
  // A dictionary check lets 住在 count as 住 + 在 (and "live in" become 住在),
  // while real words like 现在 stay whole.
  const options = dict ? { isWord: (zh) => dict.has(zh) } : {};
  let map = words;
  if (level === MY_LEVEL) {
    map = words.map;
    options.knownPrep = (p) => words.known.has(p); // 在/到/给/成 only if they're on the list
    if (hsk) options.competitors = hsk; // a more specific HSK word in the sentence keeps the English
  }
  return items.map((item, i) => (translations[i] == null ? null : diglotItem(item, translations[i], map, level, options)));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test 2>&1 | grep -E "^not ok|^ℹ (pass|fail)"`
Expected: no `not ok`. All earlier tests still pass (the verb+preposition, sentence-matching and replaced-word tests in the same file).

- [ ] **Step 6: Build and commit**

```bash
npm run build
git add src/shared/diglot.js src/background/graded.js test/unit/diglot.test.js
git commit -m "Swap the sentence's most specific word, or keep the English

When Apple's translation has several Chinese words for an English word, only
the longest count: on your right (您的右边是…) gives 右边, not 是. If that
word isn't known at the level, the English stays. At 我的 the HSK map
competes, so a list word isn't used for a meaning the reader hasn't learned.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Report storage and messages

**Files:**
- Create: `src/shared/reports.js`
- Create: `src/background/reports.js`
- Modify: `src/background/guard.js`
- Modify: `src/background/index.js` (handlers)
- Modify: `README.md` (privacy paragraph)
- Test: `test/unit/reports.test.js` (new), `test/unit/guard.test.js` (append)

**Interfaces:**
- Produces, from `src/shared/reports.js`:
  - `MAX_REPORTS = 500`
  - `cleanReport(raw, { id, now })`, which returns `{ id, ts, swapEn, swapZh, en, zh, level, url }` or `null`
  - `addReport(list, report)`, which returns a new list
  - `removeReport(list, id)`, which returns a new list
  - `exportReports(list)`, which returns `{ version: 1, reports }`
- Produces these background message handlers:
  - `reportSwap { swapEn, swapZh, en, zh, level, url }` → `{ stored: boolean }`;
  - `listSwapReports` → `report[]`;
  - `deleteSwapReport { id }` → `report[]`;
  - `clearSwapReports` → `[]`.

- [ ] **Step 1: Write the failing tests**

Create `test/unit/reports.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_REPORTS, cleanReport, addReport, removeReport, exportReports } from '../../src/shared/reports.js';

const raw = {
  swapEn: 'right', swapZh: '是', en: 'Lockers are on your right.', zh: '储物柜在您的右边。',
  level: 1, url: 'https://example.com/station?ticket=123#map',
};

test('cleanReport keeps the fields, strips the query and cuts long text', () => {
  const r = cleanReport(raw, { id: 'a', now: 5 });
  assert.deepEqual(r, { id: 'a', ts: 5, swapEn: 'right', swapZh: '是', en: raw.en, zh: raw.zh, level: 1, url: 'https://example.com/station' });
  const long = cleanReport({ ...raw, swapEn: 'x'.repeat(100), en: 'y'.repeat(3000), zh: '中'.repeat(3000) }, { id: 'b', now: 1 });
  assert.equal(long.swapEn.length, 64);
  assert.equal(long.en.length, 2000);
  assert.equal(long.zh.length, 2000);
});

test('cleanReport rejects reports without a swap or with a bad level', () => {
  assert.equal(cleanReport({ ...raw, swapEn: '' }, { id: 'a', now: 1 }), null);
  assert.equal(cleanReport({ ...raw, swapZh: 5 }, { id: 'a', now: 1 }), null);
  assert.equal(cleanReport({ ...raw, level: 7 }, { id: 'a', now: 1 }), null);
  assert.equal(cleanReport({ ...raw, level: 1.5 }, { id: 'a', now: 1 }), null);
  assert.equal(cleanReport(null, { id: 'a', now: 1 }), null);
  assert.equal(cleanReport({ ...raw, url: 'javascript:alert(1)' }, { id: 'a', now: 1 }).url, '');
});

test('addReport puts the newest first and stores a repeat once', () => {
  const a = cleanReport(raw, { id: 'a', now: 1 });
  const b = cleanReport({ ...raw, swapEn: 'like' }, { id: 'b', now: 2 });
  let list = addReport(addReport([], a), b);
  assert.deepEqual(list.map((r) => r.id), ['b', 'a']);
  list = addReport(list, cleanReport(raw, { id: 'c', now: 3 }));
  assert.deepEqual(list.map((r) => [r.id, r.ts]), [['a', 3], ['b', 2]]); // same report: kept its id, new time
});

test('addReport keeps at most MAX_REPORTS', () => {
  let list = [];
  for (let i = 0; i < MAX_REPORTS + 5; i++) list = addReport(list, cleanReport({ ...raw, en: `s${i}` }, { id: `r${i}`, now: i }));
  assert.equal(list.length, MAX_REPORTS);
  assert.equal(list[0].id, `r${MAX_REPORTS + 4}`);
  assert.equal(list.at(-1).id, 'r5');
});

test('removeReport and exportReports', () => {
  const list = addReport([], cleanReport(raw, { id: 'a', now: 1 }));
  assert.deepEqual(removeReport(list, 'a'), []);
  assert.deepEqual(removeReport(list, 'zz'), list);
  assert.deepEqual(exportReports(list), { version: 1, reports: list });
});
```

Append to `test/unit/guard.test.js`:

```js
test('reportSwap is allowed from pages but type- and size-checked', () => {
  const ok = { type: 'reportSwap', swapEn: 'right', swapZh: '是', en: 'On your right.', zh: '在右边。', level: 1, url: 'https://a.example/' };
  assert.equal(refusal(ok, content, BASE), null);
  assert.match(refusal({ ...ok, swapEn: 5 }, content, BASE), /report/);
  assert.match(refusal({ ...ok, en: 'x'.repeat(20_001) }, content, BASE), /report/);
  assert.match(refusal({ ...ok, level: 8 }, content, BASE), /report/);
  assert.match(refusal({ ...ok, level: '1' }, content, BASE), /report/);
});

test('swap report list, delete and clear are page-only', () => {
  for (const type of ['listSwapReports', 'deleteSwapReport', 'clearSwapReports']) {
    assert.ok(PAGE_ONLY.has(type), type);
    assert.match(refusal({ type }, content, BASE), /extension pages/, type);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | grep -E "^not ok|^ℹ (pass|fail)|ERR_MODULE"`
Expected: `ERR_MODULE_NOT_FOUND` for `src/shared/reports.js`, and the two guard tests fail.

- [ ] **Step 3: Create `src/shared/reports.js`**

```js
// Reported swaps: words the user flagged as swapped in with the wrong
// meaning, kept so the matching rules can be tuned from real examples. Pure
// helpers; the background stores the list (background/reports.js).

import { LEVELS, FULL_LEVEL } from './diglot.js';
import { pageUrl } from './history.js';

export const MAX_REPORTS = 500;
const MAX_SWAP = 64;
const MAX_TEXT = 2000;

const cut = (s, max) => (typeof s === 'string' ? s.slice(0, max) : '');

/** A report as stored, or null if it doesn't describe a swap. */
export function cleanReport(raw, { id, now }) {
  if (!raw || typeof raw.swapEn !== 'string' || typeof raw.swapZh !== 'string') return null;
  if (!raw.swapEn.trim() || !raw.swapZh.trim()) return null;
  if (!Number.isInteger(raw.level) || !LEVELS.includes(raw.level) || raw.level === FULL_LEVEL) return null;
  return {
    id,
    ts: now,
    swapEn: cut(raw.swapEn, MAX_SWAP),
    swapZh: cut(raw.swapZh, MAX_SWAP),
    en: cut(raw.en, MAX_TEXT),
    zh: cut(raw.zh, MAX_TEXT),
    level: raw.level,
    url: pageUrl(raw.url),
  };
}

const same = (a, b) => a.swapEn === b.swapEn && a.swapZh === b.swapZh && a.en === b.en;

/** Adds a report, newest first; a repeat keeps its id and gets the new time. */
export function addReport(list, report) {
  const old = list.find((r) => same(r, report));
  const entry = old ? { ...report, id: old.id } : report;
  return [entry, ...list.filter((r) => r !== old)].slice(0, MAX_REPORTS);
}

export function removeReport(list, id) {
  return list.filter((r) => r.id !== id);
}

/** The export file's contents. */
export function exportReports(list) {
  return { version: 1, reports: list };
}
```

- [ ] **Step 4: Create `src/background/reports.js`**

```js
// Stores reported swaps in storage.local (swapReports). Changes are applied
// one at a time, so two tabs reporting at once both land.

import { cleanReport, addReport, removeReport } from '../shared/reports.js';

const KEY = 'swapReports';
let queue = Promise.resolve();

async function read() {
  const { [KEY]: list } = await browser.storage.local.get(KEY);
  return Array.isArray(list) ? list : [];
}

function update(change) {
  const run = queue.then(async () => {
    const next = change(await read());
    await browser.storage.local.set({ [KEY]: next });
    return next;
  });
  queue = run.catch(() => {});
  return run;
}

/** -> { stored }. Private windows: nothing is kept. */
export async function reportSwap(msg, { incognito = false } = {}) {
  if (incognito) return { stored: false };
  const report = cleanReport(msg, { id: crypto.randomUUID(), now: Date.now() });
  if (!report) throw new Error('not a swap report');
  await update((list) => addReport(list, report));
  return { stored: true };
}

export const listReports = () => read();
export const deleteReport = (id) => update((list) => removeReport(list, id));
export const clearReports = () => update(() => []);
```

- [ ] **Step 5: Guard** (`src/background/guard.js`)

Add the three page-only types to `PAGE_ONLY` (keep the existing entries) and update its comment:

```js
/** Handlers only extension pages (popup, word list, My words) may call: they
 * read, import or wipe the whole history or the swap reports, replace My
 * words, or clear the cache. */
export const PAGE_ONLY = new Set(['listWords', 'deleteWord', 'importWords', 'clearCache', 'setMyWords',
  'listSwapReports', 'deleteSwapReport', 'clearSwapReports']);
```

Add the constant after `MAX_CHARS`:

```js
const MAX_REPORT_FIELD = 20_000; // reports are cut to 2,000 characters; this only stops abuse
```

Add this check to `refusal()`, before `return null;`:

```js
  if (msg.type === 'reportSwap') {
    const fields = ['swapEn', 'swapZh', 'en', 'zh', 'url'].map((k) => msg[k]);
    if (!fields.every((s) => typeof s === 'string' && s.length <= MAX_REPORT_FIELD)
      || !Number.isInteger(msg.level) || msg.level < 0 || msg.level > 7) return 'bad report';
  }
```

- [ ] **Step 6: Handlers** (`src/background/index.js`)

Add the import:

```js
import * as reports from './reports.js';
```

Add these handlers to the `handlers` object, right after `importWords`:

```js
  reportSwap: (msg, sender) => reports.reportSwap(msg, { incognito: isPrivate(sender) }),
  listSwapReports: () => reports.listReports(),
  deleteSwapReport: ({ id }) => reports.deleteReport(id),
  clearSwapReports: () => reports.clearReports(),
```

- [ ] **Step 7: README privacy clause**

In `README.md`, in the privacy paragraph, after the sentence "Saved example sentences keep the page's address without its query string.", add:

```
Reported swaps (⚑ Report in the popup) are stored the same way, and leave the
machine only if you export them.
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test 2>&1 | grep -E "^not ok|^ℹ (pass|fail)"`
Expected: no `not ok`.

- [ ] **Step 9: Build and commit**

```bash
npm run build
git add src/shared/reports.js src/background/reports.js src/background/guard.js src/background/index.js README.md test/unit/reports.test.js test/unit/guard.test.js
git commit -m "Store reported swaps

reportSwap (allowed from pages, type- and size-checked) keeps up to 500
reports in storage.local, newest first, a repeat once; nothing in private
windows. List, delete and clear are page-only.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: ⚑ Report in the hover popup

**Files:**
- Modify: `src/shared/diglot.js` (add `swapAt`; `replacedAt` uses it)
- Modify: `src/content/hover.js`
- Modify: `src/content/overlay.css`
- Test: `test/unit/diglot.test.js` (append)

**Interfaces:**
- Consumes: the `reportSwap` message from Task 2.
- Produces: `swapAt(ranges, offset)`, which returns the `[start, end, en]` range covering `offset`, or `null`.

- [ ] **Step 1: Write the failing test** (append to `test/unit/diglot.test.js`, and add `swapAt` to the import at the top)

```js
test('swapAt finds the swapped word under an offset', () => {
  const ranges = [[2, 4, 'like'], [5, 7, 'apples']];
  assert.deepEqual(swapAt(ranges, 3), [2, 4, 'like']);
  assert.equal(swapAt(ranges, 4), null);
  assert.equal(swapAt(null, 0), null);
  assert.equal(replacedAt(ranges, 5), 'apples');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test 2>&1 | grep -E "^not ok|^ℹ (pass|fail)"`
Expected: FAIL, because `swapAt` is not exported.

- [ ] **Step 3: Implement `swapAt`** (`src/shared/diglot.js`, replacing `replacedAt`)

```js
/** The swap range [start, end, en] covering `offset`, or null. */
export function swapAt(ranges, offset) {
  return ranges?.find(([start, end]) => offset >= start && offset < end) ?? null;
}

/** The English replaced by the swapped word covering `offset`, or ''. */
export function replacedAt(ranges, offset) {
  return swapAt(ranges, offset)?.[2] ?? '';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | grep -E "^not ok|^ℹ (pass|fail)"`
Expected: no `not ok`.

- [ ] **Step 5: Popup action** (`src/content/hover.js`)

1. Import: change `import { replacedAt } from '../shared/diglot.js';` to `import { swapAt } from '../shared/diglot.js';`.
2. In `context(hit)`, replace

```js
    let replaced = '';
```

with

```js
    let replaced = '';
    let swapZh = '';
```

and replace

```js
      // At graded levels: the English word this Chinese word was swapped in for.
      replaced = replacedAt(seg.swaps, inSeg);
```

with

```js
      // At graded levels: the English word this Chinese word was swapped in
      // for, and the Chinese shown (for ⚑ Report).
      const swap = swapAt(seg.swaps, inSeg);
      if (swap) {
        replaced = swap[2];
        swapZh = seg.zh.slice(swap[0], swap[1]);
      }
```

and the return value to

```js
    return { text, positions, rect: hit.rect, sentence: sentenceAround(zh, offset), en, full, replaced, swapZh };
```

3. In `ensureCard()`, add a branch to the click handler:

```js
      else if (e.target.closest('.zhi-pop-report')) this.report();
```

4. In `render()`, after `actions.append(save);`:

```js
    if (this.current.replaced) {
      const done = this.current.reported;
      const report = el('span', done ? 'zhi-pop-reported' : 'zhi-pop-report', done ?? '⚑ Report');
      if (!done) report.title = 'Report this as a wrong swap';
      actions.append(report);
    }
```

5. Add a method after `toggleSave()`:

```js
  /** Saves this swap as wrong, for later study (word list → Reported swaps). */
  async report() {
    const current = this.current;
    if (!current?.replaced || current.reported) return;
    let label;
    try {
      const { stored } = await this.send({
        type: 'reportSwap',
        swapEn: current.replaced,
        swapZh: current.swapZh,
        en: (current.en ?? '').slice(0, 2000),
        zh: (current.full ?? '').slice(0, 2000),
        level: this.translator.level,
        url: location.href,
      });
      label = stored ? 'Reported ✓' : 'Not saved in private windows';
    } catch {
      label = 'Couldn’t report';
    }
    current.reported = label;
    if (this.current === current) this.render();
  }
```

- [ ] **Step 6: Styles** (`src/content/overlay.css`, after the `.zhi-pop-save` rules)

```css
.zhi-pop .zhi-pop-report { cursor: pointer; color: var(--muted); }
.zhi-pop .zhi-pop-report:hover { color: var(--fg); text-decoration: underline; }
.zhi-pop .zhi-pop-reported { color: var(--muted); }
```

(If `overlay.css` doesn't define `--muted`, use the variable it uses for the count text, `.zhi-pop-count`.)

- [ ] **Step 7: Build, test and commit**

```bash
npm test 2>&1 | grep -E "^not ok|^ℹ (pass|fail)"
npm run build
git add src/shared/diglot.js src/content/hover.js src/content/overlay.css test/unit/diglot.test.js
git commit -m "Add ⚑ Report to the popup of a swapped word

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Reported swaps tab on the word list page

**Files:**
- Modify: `extension/vocab/vocab.html`
- Modify: `src/vocab/vocab.js`
- Modify: `extension/vocab/vocab.css`

**Interfaces:**
- Consumes: `listSwapReports`, `deleteSwapReport { id }` and `clearSwapReports` (Task 2), and `exportReports` (Task 2).

- [ ] **Step 1: HTML** (`extension/vocab/vocab.html`)

Add a third tab after the Saved button:

```html
      <button role="tab" data-tab="reports" aria-selected="false">Reported swaps <span id="countReports" class="pill">0</span></button>
```

Give the existing word toolbar an id. Change `<section class="toolbar">` to `<section id="wordBar" class="toolbar">`. Directly after that section's closing tag, add:

```html
    <section id="reportBar" class="toolbar" hidden>
      <span class="muted">Swaps you flagged with ⚑ Report in the popup.</span>
      <span class="spacer"></span>
      <button id="exportReports" class="primary">Export reports (JSON)</button>
      <button id="clearReports">Clear all…</button>
    </section>
```

Wrap the existing `<table>…</table>` in `<div id="wordTable">…</div>`. After it, before `<p id="empty"`, add:

```html
    <div id="reports" hidden></div>
```

- [ ] **Step 2: Script** (`src/vocab/vocab.js`)

1. Import: `import { exportReports } from '../shared/reports.js';`.
2. State, next to `let words = [];`: `let reports = [];`.
3. Generalize `markWord` so it can highlight English too. Change its signature to `function markWord(sentence, word, className = 'zh')` and its first line to `const out = h('span', { className });`. Guard an empty word: `if (!word) return h('span', { className, textContent: sentence });` as the first line.
4. Add a report row builder before `render()`:

```js
const levelName = (level) => (level === 0 ? '我的' : `HSK ${level}`);

function reportRow(r) {
  const del = h('button', { className: 'icon', title: 'Delete this report', textContent: '✕' });
  del.addEventListener('click', async () => {
    reports = await send({ type: 'deleteSwapReport', id: r.id });
    render();
  });
  const href = pageUrl(r.url);
  return h('div', { className: 'report' },
    h('div', { className: 'report-head' },
      h('span', { className: 'pair' }, `${r.swapEn} → `, h('span', { className: 'zh', textContent: r.swapZh })),
      h('span', { className: 'muted', textContent: ` · ${levelName(r.level)} · ${relativeDay(r.ts)}` }),
      href ? h('a', { href, target: '_blank', rel: 'noreferrer', textContent: hostOf(href) }) : null,
      h('span', { className: 'spacer' }),
      del),
    r.en ? h('div', { className: 'en' }, markWord(r.en, r.swapEn, 'en-text')) : null,
    r.zh ? h('div', { className: 'zh muted', textContent: r.zh }) : null);
}
```

5. In `render()`, set the count right after `$('countSaved').textContent = saved.length;`:

```js
  $('countReports').textContent = reports.length;
```

Then, after the tab `aria-selected` loop, insert:

```js
  const onReports = tab === 'reports';
  $('wordBar').hidden = onReports;
  $('wordTable').hidden = onReports;
  $('reportBar').hidden = !onReports;
  $('reports').hidden = !onReports;
  if (onReports) {
    $('reports').replaceChildren(...reports.map(reportRow));
    $('empty').hidden = reports.length > 0;
    $('empty').textContent = 'No reported swaps. On a page at a graded level, hover a swapped word and click ⚑ Report.';
    $('exportReports').disabled = !reports.length;
    $('clearReports').disabled = !reports.length;
    return;
  }
```

6. `load()`:

```js
async function load() {
  [words, reports] = await Promise.all([send({ type: 'listWords' }), send({ type: 'listSwapReports' })]);
  render();
}
```

7. Buttons, after the `exportJson` listener:

```js
$('exportReports').addEventListener('click', () => {
  download(`zh-immerse-swap-reports-${today()}.json`, 'application/json', JSON.stringify(exportReports(reports), null, 1));
});
$('clearReports').addEventListener('click', async () => {
  if (!confirm(`Delete all ${reports.length} reported swaps?`)) return;
  reports = await send({ type: 'clearSwapReports' });
  render();
});
```

- [ ] **Step 3: Styles** (`extension/vocab/vocab.css`, before the `@media (max-width: 720px)` block)

```css
.report { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; }
.report-head { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.report-head .pair { font-weight: 600; }
.report-head .pair .zh { font-size: 18px; }
.report-head a { color: var(--muted); font-size: 12px; }
.report-head .spacer { flex: 1; }
.report .en { margin-top: 4px; }
.report .zh.muted { font-size: 13px; margin-top: 2px; }
```

- [ ] **Step 4: Build, test and commit**

```bash
npm test 2>&1 | grep -E "^not ok|^ℹ (pass|fail)"
npm run build
git add extension/vocab/vocab.html src/vocab/vocab.js extension/vocab/vocab.css
git commit -m "Add a Reported swaps tab to the word list page

Lists reports newest first with the English highlighted, deletes one or all,
and exports them as JSON.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### After the tasks (controller, not a subagent task)

**Browser check.** Use headless Chrome for Testing with the real native host, as in the earlier e2e scripts in the session scratchpad:
- the locker sentence at level 1 shows 右边, and at 我的 (with the user's deck) shows English;
- ⚑ Report adds a row on the Reported swaps tab;
- the export downloads the JSON;
- ✕ and Clear all work;
- a re-report updates rather than duplicates.

**Corpus comparison.** Count the swaps before and after on the session's earlier spike sentences at levels 1–3, and list every changed swap for the user.

**Checklist line.** `docs/manual-checks.md` arrives with `chore/icons-and-checklist`. When D is brought up to date with `main` for its PR, add this line under *Both browsers*:

```
- [ ] **Report a swap:** at a graded level, hover a swapped word → ⚑ Report;
      it appears under *Word list → Reported swaps* and exports as JSON.
```
