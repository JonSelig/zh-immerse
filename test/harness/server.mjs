// Dev harness: serves test pages with the real content script and a stand-in
// for the WebExtension API, so page behaviour can be checked in any browser.
//
//   node test/harness/server.mjs [port]
//   open http://localhost:8787/
//
// Translation uses the real native host when the Chinese language pack is
// installed; otherwise a deterministic stand-in ("mock") so DOM logic can be
// tested without it. Word history is kept in memory, using the same shared
// logic as the extension's background script.

import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { startHost } from '../../scripts/host-client.mjs';
import { parseDict, longestMatch } from '../../src/shared/dict.js';
import { parseWordMap, diglotItem, FULL_LEVEL } from '../../src/shared/diglot.js';
import { shouldCount, applyLookup, applySaved, mergeRecords, cleanRecord, pageUrl } from '../../src/shared/history.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.argv[2] ?? 8787);
const hostBinary = resolve(root, 'native-host/build/zh-translate-host');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.json': 'application/json' };

// ---- translation ------------------------------------------------------

let hostState = 'mock';
try {
  hostState = execFileSync(hostBinary, ['--status']).toString().trim();
} catch { /* host not built */ }
const host = hostState === 'installed' ? startHost(hostBinary) : null;
console.log(`translator: ${host ? 'Apple Translation (native host)' : `mock (host status: ${hostState})`}`);

const MOCK_CHARS = '我们学习中文今天天气很好朋友时间工作问题世界生活知道发现重要开始希望喜欢电脑网络新闻音乐';
function mockText(text) {
  return text.replace(/[A-Za-z']+/g, (w) => {
    let h = 0;
    for (const c of w.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const i = (h % (MOCK_CHARS.length / 2)) * 2;
    return MOCK_CHARS.slice(i, i + 2);
  }).replace(/\s+(?=[一-鿿])|(?<=[一-鿿])\s+/g, '');
}
const mockItem = (item) => (Array.isArray(item) ? item.map(mockText) : mockText(item));

const hskWords = parseWordMap(await readFile(resolve(root, 'extension/data/hsk-words.txt'), 'utf8'));

async function translate(items, level = FULL_LEVEL) {
  let translations;
  if (host) {
    const reply = await host.send({ type: 'translate', texts: items });
    if (reply.error) return { error: reply.error, code: reply.code };
    translations = reply.translations;
  } else {
    translations = items.map(mockItem);
  }
  if (level >= FULL_LEVEL) return { translations };
  return { graded: items.map((item, i) => translations[i] == null ? null : diglotItem(item, translations[i], hskWords, level)) };
}

// ---- dictionary and history --------------------------------------------

const dict = parseDict(await readFile(resolve(root, 'extension/data/cedict.txt'), 'utf8'));
const words = new Map();
const recent = new Map();
const pick = ({ word, pinyin, defs, zh, en, url }) => ({ word, pinyin, defs, zh, en, url: pageUrl(url) });

const api = {
  translate: ({ items, level }) => translate(items, level),
  lookup({ text }) {
    const match = longestMatch(dict, text);
    if (!match) return null;
    const r = words.get(match.word);
    return { ...match, count: r?.count ?? 0, saved: !!r?.saved };
  },
  recordLookup(msg) {
    const existing = words.get(msg.word);
    if (!shouldCount(recent, `${msg.word}\0${msg.zh ?? ''}`, Date.now())) {
      return { count: existing?.count ?? 0, saved: !!existing?.saved, counted: false };
    }
    const next = applyLookup(existing, pick(msg), Date.now());
    words.set(next.word, next);
    return { count: next.count, saved: next.saved, counted: true };
  },
  setSaved(msg) {
    const next = applySaved(words.get(msg.word), pick(msg), !!msg.saved, Date.now());
    words.set(next.word, next);
    return { count: next.count, saved: next.saved };
  },
  listWords: () => [...words.values()],
  deleteWord: ({ word }) => { words.delete(word); return null; },
  importWords({ records }) {
    const valid = records.map(cleanRecord).filter(Boolean);
    for (const r of valid) words.set(r.word, mergeRecords(words.get(r.word), r));
    return { imported: valid.length, skipped: records.length - valid.length };
  },
  wordStats: () => ({ lookedUp: [...words.values()].filter((w) => w.count > 0).length, saved: [...words.values()].filter((w) => w.saved).length }),
  hostStatus: () => ({ status: 'installed', mock: !host }),
  clearCache: () => null,
};

// ---- HTTP ---------------------------------------------------------------

const INJECT = '<link rel="stylesheet" href="/ext/content.css"><script src="/harness/shim.js"></script><script src="/ext/dist/content.js"></script>';
const INJECT_PAGE = '<script src="/harness/shim.js"></script>';

async function serveFile(res, path, inject) {
  let body = await readFile(path);
  if (inject && extname(path) === '.html') {
    body = body.toString().replace(/(<\/body>)/i, `${inject}$1`).replace(/(<script src="\.\.\/dist\/)/, `${INJECT_PAGE}$1`);
  }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
}

function safeJoin(base, rel) {
  const full = normalize(join(base, rel));
  if (!full.startsWith(base + sep)) throw Object.assign(new Error('forbidden'), { status: 403 });
  return full;
}

// Only this machine, under its own name: the API drives the real translator
// and holds word history, so other hosts on the network and DNS-rebinding
// pages (which send their own Host header) are turned away.
const HOSTS = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);

createServer(async (req, res) => {
  try {
    if (!HOSTS.has(req.headers.host)) throw Object.assign(new Error('forbidden'), { status: 403 });
    const url = new URL(req.url, `http://localhost:${port}`);
    if (req.method === 'POST' && url.pathname === '/api') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const msg = JSON.parse(raw);
      const handler = api[msg?.type];
      const result = handler ? await handler(msg) : null;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result ?? null));
    } else if (url.pathname === '/') {
      const files = (await readdir(resolve(root, 'test/fixtures'))).filter((f) => f.endsWith('.html'));
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html><meta charset=utf-8><title>zh-immerse harness</title><body style="font:15px system-ui;padding:24px">
        <h1>zh-immerse harness</h1><p>Translator: ${host ? 'Apple Translation' : 'mock'}</p><ul>
        ${files.map((f) => `<li><a href="/fixtures/${f}">${f}</a></li>`).join('')}
        <li><a href="/ext/vocab/vocab.html">Word list page</a></li></ul>`);
    } else if (url.pathname.startsWith('/fixtures/')) {
      await serveFile(res, safeJoin(resolve(root, 'test/fixtures'), url.pathname.slice(10)), INJECT);
    } else if (url.pathname.startsWith('/ext/')) {
      await serveFile(res, safeJoin(resolve(root, 'extension'), url.pathname.slice(5)), url.pathname.includes('/vocab/') || url.pathname.includes('/popup/') ? INJECT_PAGE : null);
    } else if (url.pathname === '/harness/shim.js') {
      await serveFile(res, resolve(root, 'test/harness/shim.js'));
    } else {
      res.writeHead(404).end('not found');
    }
  } catch (err) {
    res.writeHead(err.status ?? (err.code === 'ENOENT' ? 404 : 500)).end(String(err.message));
  }
}).listen(port, '127.0.0.1', () => console.log(`harness: http://localhost:${port}/`));
