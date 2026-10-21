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
