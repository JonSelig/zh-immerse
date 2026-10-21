import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refusal, PAGE_ONLY } from '../../src/background/guard.js';

const BASE = 'chrome-extension://abcdefghijklmnop/';
const page = { url: `${BASE}vocab/vocab.html`, tab: { id: 1 } };
const content = { url: 'https://example.com/article', tab: { id: 2 } };

test('history and cache handlers only answer extension pages', () => {
  for (const type of PAGE_ONLY) {
    const msg = type === 'setMyWords' || type === 'dictEntries' ? { type, words: [] } : { type };
    assert.equal(refusal(msg, page, BASE), null, type);
    assert.match(refusal({ type }, content, BASE), /extension pages/, type);
    assert.match(refusal({ type }, {}, BASE), /extension pages/, type);
    // A web page whose address merely contains the extension URL doesn't count.
    assert.match(refusal({ type }, { url: `https://evil.example/?${BASE}` }, BASE), /extension pages/, type);
  }
  assert.equal(refusal({ type: 'recordLookup' }, content, BASE), null);
  assert.equal(refusal({ type: 'wordStats' }, content, BASE), null);
});

test('translate and lookup messages are size-checked', () => {
  assert.equal(refusal({ type: 'translate', items: ['Hello', ['Read the ', 'docs']] }, content, BASE), null);
  assert.match(refusal({ type: 'translate', items: 'Hello' }, content, BASE), /items/);
  assert.match(refusal({ type: 'translate', items: new Array(5000).fill('a') }, content, BASE), /items/);
  assert.match(refusal({ type: 'translate', items: ['a'.repeat(2_000_000)] }, content, BASE), /text/);
  assert.match(refusal({ type: 'translate', items: [{ toString: () => 'x' }] }, content, BASE), /text/);
  assert.equal(refusal({ type: 'lookup', text: '喜欢你们' }, content, BASE), null);
  assert.match(refusal({ type: 'lookup', text: '喜'.repeat(100) }, content, BASE), /lookup/);
  assert.match(refusal({ type: 'lookup', text: 5 }, content, BASE), /lookup/);
});

test('setMyWords is page-only and size-checked', () => {
  assert.ok(PAGE_ONLY.has('setMyWords'));
  assert.match(refusal({ type: 'setMyWords', words: [] }, content, BASE), /extension pages/);
  assert.equal(refusal({ type: 'setMyWords', words: [{ zh: '中' }] }, page, BASE), null);
  assert.match(refusal({ type: 'setMyWords', words: 'all' }, page, BASE), /word list/);
  assert.match(refusal({ type: 'setMyWords', words: new Array(20_001).fill({}) }, page, BASE), /word list/);
});

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

test('dictEntries is page-only and size-checked', () => {
  assert.ok(PAGE_ONLY.has('dictEntries'));
  assert.match(refusal({ type: 'dictEntries', words: ['中'] }, content, BASE), /extension pages/);
  assert.equal(refusal({ type: 'dictEntries', words: ['中', '中国人'] }, page, BASE), null);
  assert.match(refusal({ type: 'dictEntries', words: '中' }, page, BASE), /word list/);
  assert.match(refusal({ type: 'dictEntries', words: [5] }, page, BASE), /word list/);
  assert.match(refusal({ type: 'dictEntries', words: ['中'.repeat(40)] }, page, BASE), /word list/);
  assert.match(refusal({ type: 'dictEntries', words: new Array(20_001).fill('中') }, page, BASE), /word list/);
});

test('prioritize is allowed from pages and size-checked like translate', () => {
  assert.equal(refusal({ type: 'prioritize', items: ['Hello', ['Read the ', 'docs']] }, content, BASE), null);
  assert.match(refusal({ type: 'prioritize', items: 'Hello' }, content, BASE), /items/);
  assert.match(refusal({ type: 'prioritize', items: new Array(5000).fill('a') }, content, BASE), /items/);
  assert.match(refusal({ type: 'prioritize', items: ['a'.repeat(2_000_000)] }, content, BASE), /text/);
});
