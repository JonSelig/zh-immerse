# Wrong-meaning swaps: better word wins, and reporting mistakes

Date: 2026-10-20
Status: approved design, awaiting spec review
Builds on: `fix/verb-preposition-swaps` (per-sentence matching, 住在 phrases)

## Problem

At graded levels (1–6 and 我的), an English word is swapped for a Chinese
word if that Chinese word appears in the translation. Common Chinese words
have many English glosses, so a word can be confirmed by a *different*
meaning in the same sentence:

> "…you can find a bank of lockers on your **right** opposite the Central
> Ticket Office." → "…on your **是**…"

The data maps "right" to 是, 对, 正, 右, 右边, …. Apple translated the
sentence as "…您的右边是一排储物柜…", which contains both 右边 ("right side")
and 是 (here meaning "is"). 是 is listed first, so it won.

`fix/verb-preposition-swaps` already stops a word being confirmed by another
*sentence*. This spec handles a wrong meaning within the same sentence. It
also gives the user a way to collect mistakes so the rules can be tuned from
real examples.

## Goals

- When the sentence shows a more specific Chinese word for the English word,
  use it, or leave the English. Never use a shorter, likely wrong one.
- Let the user report a wrong swap with one click. The report changes
  nothing on the page and is saved for later study and export.

## Non-goals

- No blocking or "never swap this pair". The user rejected it, because many
  pairs are right in some sentences and wrong in others.
- No extra translation calls and no word alignment from Apple.
- No change at 全部 (full translation).

## 1. Better word wins

Applies at every graded level, in `findSwaps` (`src/shared/diglot.js`).

For an English word or phrase (after lemmas, as today), collect its
**candidates**:

- at levels 1–6, every entry in the HSK map for that key, at **any** level;
- at 我的, the entries in the My words map, plus every HSK-map entry for the
  same key (as competitors).

A candidate is **present** if `inTranslation(zh)` is true for the sentence,
using the same test as today: a segmented word, or a substring for words of
two or more characters. A candidate is **known** if it may be shown at this
level:

- levels 1–6: `level <= current level`;
- 我的: it comes from the My words map. An HSK competitor is known only if
  the same Chinese word is also in the My words map.

Rule:

1. If no candidate is present, don't swap (as today).
2. Let `L` be the length (in characters) of the longest present candidate.
3. Swap the first **known** present candidate of length `L`, in today's
   order: level, then frequency for HSK; list order for 我的.
4. If no known candidate has length `L`, **don't swap**: the sentence uses a
   meaning the reader hasn't learned, so the English stays.

Examples:

- Locker sentence, level 1: present are 是 and 右边 (length 2), and 右边 is
  HSK 1, so you get "on your **右边**". At 我的 without 右边 on the list, the
  English "right" stays.
- "I like apples" (我喜欢苹果): present is 喜欢 only, so 喜欢 (unchanged).
- "That's right" (对): present is 对 only, so 对 (unchanged).
- Ties keep today's order, so "like" with both 喜欢 and 一样 present still
  picks 喜欢.

The verb+preposition phrase step from `fix/verb-preposition-swaps` runs after
the choice and uses the chosen word.

A rule this simple can misjudge sentences where the longer candidate belongs
to a *different* English word in the same sentence. Section 2 exists to find
those cases.

## 2. Report a wrong swap (hover popup)

- When the hovered word is a swapped word (the popup already shows
  *replaces "…"*), the footer gets a **⚑ Report** action, with the tooltip
  "Report this as a wrong swap". After a click it reads **Reported ✓** for
  that word until the popup closes.
- Only trusted clicks count (`e.isTrusted`, like Save), and the popup lives
  in the existing closed shadow root, so a web page can't file reports.
- Clicking sends `{ type: 'reportSwap', … }` to the background with:
  - `swapEn`: the English as written ("right");
  - `swapZh`: the Chinese shown (是);
  - `en`: the item's English paragraph;
  - `zh`: the item's full Chinese (`state.full`);
  - `level`;
  - `url`: the page's address.
- Nothing on the page changes.

Background (`src/background/reports.js`, new):

- **Private windows** (`sender.tab.incognito`): nothing is stored. The reply
  is `{ stored: false }`, and the popup shows "Not saved in private windows"
  instead of "Reported ✓".
- **Stored record:** `{ id, ts, swapEn, swapZh, en, zh, level, url }`, where
  `url` passes through `pageUrl()` (origin + path only).
- **Text limits:** `swapEn` and `swapZh` up to 64 characters; `en` and `zh`
  up to 2,000 characters each. Longer text is cut, not rejected.
- **Storage:** `browser.storage.local` key `swapReports`, newest first, at
  most 500 (the oldest are dropped). The same report (same `swapEn`,
  `swapZh` and `en`) is stored once, with its `ts` updated.

## 3. Reported swaps tab (word list page)

- A third tab on the word list page: **Reported swaps** with a count pill,
  next to *Looked up* and *Saved*.
- Rows, newest first:
  - the English paragraph with `swapEn` highlighted (`<mark>`);
  - "right → 是";
  - the level (我的 or HSK n);
  - the date and the page host as a link (like example sentences);
  - a ✕ that deletes the row.
- The toolbar on this tab shows **Export reports (JSON)**, which downloads
  `zh-immerse-swap-reports-YYYY-MM-DD.json` as
  `{ version: 1, reports: [...] }`, and **Clear all…** (with a
  confirmation). The other tabs' toolbar controls are hidden on this tab.
- Messages:
  - `listSwapReports` returns the array;
  - `deleteSwapReport { id }`;
  - `clearSwapReports`.

  All three are page-only (`PAGE_ONLY`). `reportSwap` is allowed from content
  scripts, but `refusal()` caps its field types and sizes: strings only,
  `level` an integer 0–7.

## Data and privacy

- Reports hold page text, the same kind of data as saved example sentences.
  The README's privacy paragraph gets one clause: reported swaps are stored
  locally and leave the machine only if you export them.
- The JSON backup of the word list is unchanged; reports have their own
  export.

## Testing

Unit tests:

- **`diglot.test.js`, better word wins:**
  - the locker sentence at level 1 gives 右边;
  - at level 0 with only 是 known, nothing is swapped;
  - a tie keeps today's order (喜欢 over 一样);
  - a single present candidate is unchanged;
  - an HSK competitor at 我的 that is also on the list is known;
  - verb+preposition phrases still work.
- **`reports.test.js`** (pure helpers in `src/shared/reports.js`):
  - `cleanReport` cuts and validates text;
  - `addReport` dedupes, orders newest first and caps at 500;
  - the export shape.
- **`guard.test.js`:**
  - `reportSwap` is allowed from content, with sizes and types checked;
  - the list, delete and clear messages are page-only.

Browser check (headless Chromium, real translator):

- the locker sentence at level 1 and at 我的;
- Report from the popup adds a row on the Reported swaps tab;
- export downloads the JSON;
- ✕ and Clear all work;
- nothing is stored in a private window (if Playwright can open one; otherwise
  by unit test only).

## Files

New:

- `src/shared/reports.js`
- `src/background/reports.js`
- `test/unit/reports.test.js`

Changed:

- `src/shared/diglot.js` (`findSwaps` candidate choice, `competitors` option)
- `src/background/graded.js` (passes the HSK map as competitors at 我的)
- `src/background/index.js`, `src/background/guard.js`
- `src/content/hover.js`, `src/content/overlay.css`
- `extension/vocab/vocab.html`, `src/vocab/vocab.js`, `extension/vocab/vocab.css`
- `test/unit/diglot.test.js`, `test/unit/guard.test.js`
- `README.md`, `docs/manual-checks.md` (once `chore/icons-and-checklist` is
  merged)
