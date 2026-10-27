// End-to-end test of the Chrome build in a real (headless) Google Chrome with
// a throwaway profile: loads build/chrome, then checks translation through
// the native host, graded levels, the hover dictionary and the word list.
//
//   npm run build && npm run install:host && node test/chrome-e2e.mjs
//
// Uses the DevTools protocol over a pipe (Extensions.loadUnpacked needs it).

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The extension ID Chrome derives from the public key in scripts/build.mjs.
const CHROME_KEY = /const CHROME_KEY = '([^']+)'/.exec(readFileSync(join(root, 'scripts/build.mjs'), 'utf8'))[1];
const CHROME_ID = createHash('sha256').update(Buffer.from(CHROME_KEY, 'base64')).digest('hex')
  .slice(0, 32).replace(/[0-9a-f]/g, (c) => 'abcdefghijklmnop'[parseInt(c, 16)]);
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8790;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- setup ----------------------------------------------------------------

const profile = mkdtempSync(join(tmpdir(), 'zhi-chrome-'));
// With a custom profile, Chrome reads native hosts from <profile>/NativeMessagingHosts.
mkdirSync(join(profile, 'NativeMessagingHosts'));
const hostBinary = join(homedir(), 'Library/Application Support/zh-immerse/zh-translate-host');
assert.ok(existsSync(hostBinary), 'run `npm run install:host` first');
writeFileSync(join(profile, 'NativeMessagingHosts/zh_immerse.json'), JSON.stringify({
  name: 'zh_immerse', description: 'zh-immerse test', path: hostBinary, type: 'stdio',
  allowed_origins: [`chrome-extension://${CHROME_ID}/`],
}));

const server = spawn(process.execPath, [join(root, 'test/harness/server.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => server.stdout.on('data', (d) => { if (String(d).includes('harness:')) r(); }));

const chrome = spawn(CHROME, [
  '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-pipe',
  '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check',
  '--disable-features=DisableLoadExtensionCommandLineSwitch', 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

// ---- DevTools protocol over the pipe (NUL-delimited JSON) ----------------

let nextId = 1;
const pending = new Map();
let buffer = '';
chrome.stdio[4].on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buffer.slice(0, i));
    buffer = buffer.slice(i + 1);
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(`${p.method}: ${msg.error.message}`)) : p.resolve(msg.result);
    }
  }
});
function cdp(method, params = {}, sessionId) {
  const id = nextId++;
  chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}
async function open(url) {
  const { targetId } = await cdp('Target.createTarget', { url });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  return {
    targetId,
    sessionId,
    async eval(expression) {
      const { result, exceptionDetails } = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    },
  };
}
async function until(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const value = await fn().catch(() => null); // page may still be loading
    if (value) return { value, ms: Date.now() - t0 };
    if (Date.now() - t0 > ms) return { value, ms: null };
    await sleep(100);
  }
}
// The hover popup ignores synthetic events (page scripts can't drive it), so
// hover with real input events through DevTools.
async function hoverFirstChar(page, selector) {
  const { x, y } = await page.eval(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)}).firstChild;
    const r = document.createRange(); r.setStart(node, 0); r.setEnd(node, 1);
    const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  })()`);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 }, page.sessionId);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, page.sessionId);
}

// The popup lives in a closed shadow root, which page scripts can't read but
// DevTools can (pierce: true). Returns { word, en, count } from its elements.
async function popupTexts(page) {
  const { root: doc } = await cdp('DOM.getDocument', { depth: -1, pierce: true }, page.sessionId);
  const out = {};
  const text = (n) => (n.nodeType === 3 ? n.nodeValue : (n.children ?? []).map(text).join(''));
  const walk = (n) => {
    const attrs = n.attributes ?? [];
    const i = attrs.indexOf('class');
    const cls = i >= 0 ? attrs[i + 1] : '';
    if (/^zhi-pop-(word|en|count)$/.test(cls)) out[cls.slice(8)] = text(n);
    [...(n.children ?? []), ...(n.shadowRoots ?? [])].forEach(walk);
  };
  walk(doc);
  return out;
}

async function worker() {
  const { targetInfos } = await cdp('Target.getTargets');
  const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(CHROME_ID));
  assert.ok(sw, 'extension service worker is running');
  const { sessionId } = await cdp('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
  return (expression) => cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId).then((r) => r.result.value);
}

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`); };

try {
  const { id } = await cdp('Extensions.loadUnpacked', { path: join(root, 'build/chrome') });
  check('extension loads with the fixed ID', id === CHROME_ID, id);
  await sleep(500);

  // 1. Full translation through the service worker and native host.
  const page = await open(`http://localhost:${PORT}/raw/basic.html`);
  const plain = await until(() => page.eval(`/[\\u4e00-\\u9fff]/.test(document.getElementById('plain').textContent) && document.getElementById('plain').textContent`));
  check('page is translated', !!plain.value, `${plain.ms} ms: ${plain.value}`);
  const link = (await until(() => page.eval(`(() => { const a = document.getElementById('doclink');
    return /[\\u4e00-\\u9fff]/.test(a.textContent) && a.textContent + ' -> ' + a.getAttribute('href'); })()`))).value;
  check('link keeps its own translated text', !!link && link.endsWith('#docs'), link);
  const pre = await page.eval(`document.getElementById('pre').textContent`);
  check('code stays in English', pre === 'npm install --save-dev web-ext');

  // 2. Hover dictionary (dictionary loads in the service worker).
  await hoverFirstChar(page, '#plain');
  await until(async () => (await popupTexts(page)).word, 5000);
  await sleep(900); // rest on it so it counts
  const hover = await popupTexts(page);
  check('hover popup shows word and original English', !!hover.word && !!hover.en, `${hover.word} · ${hover.count}`);
  check('resting on a word counts a lookup', /looked up 1×/.test(hover.count ?? ''), hover.count);

  // 3. Word list page reads history from IndexedDB.
  const vocab = await open(`chrome-extension://${CHROME_ID}/vocab/vocab.html`);
  const rows = await until(() => vocab.eval(`document.querySelectorAll('#rows tr.word').length`));
  check('word list shows the lookup', rows.value >= 1, `${rows.value} row(s)`);

  // 4. Graded level, set the way the popup does (storage.local).
  // Opening the word list put the page in a background tab, and hidden tabs
  // (by design) don't translate until shown, so bring it back first.
  await cdp('Target.activateTarget', { targetId: page.targetId });
  const sw = await worker();
  await sw(`chrome.storage.local.set({ level: 2 })`);
  const graded = await until(() => page.eval(`(() => { const t = document.getElementById('plain').textContent; return /[A-Za-z]{3}/.test(t) && /[\\u4e00-\\u9fff]/.test(t) && t; })()`));
  check('level 2 mixes English and HSK words', !!graded.value, graded.value);
  const underline = await page.eval(`CSS.highlights.get('zhi-swap')?.size ?? 0`);
  check('swapped words are underlined', underline > 0, `${underline} ranges`);
  await sw(`chrome.storage.local.set({ level: 7 })`);

  // 5. Chrome stops idle service workers; everything must recover after that.
  await cdp('ServiceWorker.enable', {}, page.sessionId);
  await cdp('ServiceWorker.stopAllWorkers', {}, page.sessionId);
  const stopped = await until(async () => {
    const { targetInfos } = await cdp('Target.getTargets');
    return !targetInfos.some((t) => t.type === 'service_worker' && t.url.includes(CHROME_ID));
  }, 5000);
  check('service worker can be stopped', !!stopped.value);
  const fresh = await open(`http://localhost:${PORT}/raw/dynamic.html`);
  const after = await until(() => fresh.eval(`(() => { const t = document.querySelector('.post p')?.textContent ?? ''; return /[\\u4e00-\\u9fff]/.test(t) && t; })()`));
  check('translation works after the worker restarts', !!after.value, `${after.ms} ms: ${after.value}`);
  await hoverFirstChar(fresh, '.post p');
  const rehover = (await until(async () => (await popupTexts(fresh)).word, 5000)).value;
  check('hover dictionary works after the worker restarts', !!rehover, rehover);

  // 6. In-app navigation while text is queued: if the browser reports it as
  // a page load, the tab's queued text is cancelled, and the page translator
  // must ask again so nothing on screen stays English.
  const thread = await open(`http://localhost:${PORT}/raw/thread.html`);
  await sleep(300);
  await thread.eval(`history.pushState({}, '', '?spa=1'); true`);
  const onScreenDone = await until(() => thread.eval(`(() => {
    const els = [...document.querySelectorAll('.comment p, h1')].filter((p) => { const r = p.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
    return els.length > 0 && els.every((p) => /[\u4e00-\u9fff]/.test(p.textContent)) && els.length;
  })()`), 40000);
  check('on-screen text still translates after an in-app navigation', !!onScreenDone.value, `${onScreenDone.value} passages in ${onScreenDone.ms} ms`);

  // 7. Best quality: switching redoes the page with the high-fidelity model.
  await cdp('Target.activateTarget', { targetId: thread.targetId });
  const sw2 = await worker();
  await sw2(`chrome.storage.local.set({ quality: 'best' })`);
  const best = await until(() => thread.eval(`(() => {
    const p = document.querySelector('.comment p');
    return /[\\u4e00-\\u9fff]/.test(p.textContent) && p.textContent;
  })()`), 30000);
  check('Best quality switch redoes the page', !!best.value, `${best.ms} ms: ${best.value}`);
  await sw2(`chrome.storage.local.set({ quality: 'fast' })`);

  // 8. Popup page renders and reports the translator as ready.
  const popup = await open(`chrome-extension://${CHROME_ID}/popup/popup.html`);
  const status = await until(() => popup.eval(`document.getElementById('status').textContent`));
  check('popup reports translator status', /ready/i.test(status.value ?? ''), status.value);
} catch (err) {
  check('run', false, err.message);
} finally {
  chrome.kill();
  server.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
