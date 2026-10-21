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
