import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syllable, toMarks, plain } from '../../src/shared/pinyin.js';
import { looksEnglish, sentenceAround, collapseSpace } from '../../src/shared/text.js';
import { parseDict, longestMatch } from '../../src/shared/dict.js';
import {
  shouldCount, applyLookup, applySaved, mergeRecords, filterWords, sortWords, toAnkiTSV, DEDUPE_MS,
  pageUrl, cleanRecord,
} from '../../src/shared/history.js';

test('tone marks follow standard placement', () => {
  assert.equal(toMarks('ni3 hao3'), 'nǐ hǎo');
  assert.equal(toMarks('xue2 xi2'), 'xué xí');
  assert.equal(toMarks('gou3'), 'gǒu'); // "ou" -> o
  assert.equal(toMarks('lu:4'), 'lǜ');
  assert.equal(toMarks('shui3'), 'shuǐ'); // last vowel
  assert.equal(toMarks('liu2'), 'liú');
  assert.equal(toMarks('le5'), 'le');
  assert.equal(toMarks('Bei3 jing1'), 'Běi jīng');
  assert.equal(toMarks('3D'), '3D');
  assert.deepEqual(syllable('ma1'), { text: 'mā', tone: 1 });
  assert.equal(plain('Ni3 hao3'), 'nihao');
});

test('English detection', () => {
  assert.ok(looksEnglish('Hello world'));
  assert.ok(looksEnglish('Sign in'));
  assert.ok(!looksEnglish('42'));
  assert.ok(!looksEnglish('a'));
  assert.ok(!looksEnglish('这是中文 OK'));
  assert.ok(!looksEnglish('https://example.com/path'));
  assert.ok(!looksEnglish('someone@example.com'));
  assert.equal(collapseSpace('  a \n\t b '), ' a b ');
});

test('sentenceAround picks the containing sentence', () => {
  const text = '今天天气很好。我们去公园散步吧！明天见。';
  assert.equal(sentenceAround(text, text.indexOf('公园')), '我们去公园散步吧！');
  assert.equal(sentenceAround(text, 0), '今天天气很好。');
  assert.equal(sentenceAround(text, text.length - 2), '明天见。');
  const long = '字'.repeat(300);
  assert.ok(sentenceAround(long, 150, 40).length <= 42);
});

test('dictionary parse and longest match', () => {
  const words = parseDict('学\txue2\tto learn\n学习\txue2 xi2\tto study\n行\thang2\trow\n行\txing2\tto walk\n');
  assert.equal(longestMatch(words, '学习中文').word, '学习');
  assert.equal(longestMatch(words, '学校').word, '学');
  assert.equal(longestMatch(words, '行人').entries.length, 2);
  assert.equal(longestMatch(words, '猫'), null);
});

test('lookups dedupe per word+sentence within the window', () => {
  const recent = new Map();
  const t0 = 1_000_000;
  assert.ok(shouldCount(recent, '学习\0我在学习。', t0));
  assert.ok(!shouldCount(recent, '学习\0我在学习。', t0 + 1000));
  assert.ok(shouldCount(recent, '学习\0另一句话学习。', t0 + 2000), 'different sentence counts');
  assert.ok(shouldCount(recent, '学习\0我在学习。', t0 + DEDUPE_MS), 'counts again after the window');
});

test('records accumulate counts and recent examples', () => {
  const info = (zh, extra = {}) => ({ word: '学习', pinyin: 'xue2 xi2', defs: 'to study', zh, en: 'I study', url: 'https://a.example', ...extra });
  let r = applyLookup(undefined, info('句一。'), 1);
  r = applyLookup(r, info('句二。'), 2);
  r = applyLookup(r, info('句一。'), 3);
  assert.equal(r.count, 3);
  assert.equal(r.firstSeen, 1);
  assert.equal(r.lastSeen, 3);
  assert.deepEqual(r.examples.map((e) => e.zh), ['句一。', '句二。']);
  for (let i = 0; i < 10; i++) r = applyLookup(r, info(`句${i}x。`), 10 + i);
  assert.equal(r.examples.length, 5);

  const saved = applySaved(undefined, info('句。'), true, 5);
  assert.equal(saved.count, 0);
  assert.ok(saved.saved);
});

test('merge keeps the larger count and union of examples', () => {
  const a = { word: 'x', pinyin: '', defs: 'd', count: 3, firstSeen: 5, lastSeen: 9, saved: false, examples: [{ zh: 'a', ts: 9 }] };
  const b = { word: 'x', pinyin: 'p', defs: '', count: 2, firstSeen: 1, lastSeen: 7, saved: true, examples: [{ zh: 'a', ts: 7 }, { zh: 'b', ts: 6 }] };
  const m = mergeRecords(a, b);
  assert.equal(m.count, 3);
  assert.equal(m.firstSeen, 1);
  assert.equal(m.lastSeen, 9);
  assert.ok(m.saved);
  assert.equal(m.pinyin, 'p');
  assert.deepEqual(m.examples.map((e) => e.zh), ['a', 'b']);
});

test('filter, sort and Anki export', () => {
  const now = 100 * 86_400_000;
  const words = [
    { word: '学习', pinyin: 'xue2 xi2', defs: 'to study', count: 5, firstSeen: now - 50 * 86_400_000, lastSeen: now - 1000, saved: false, examples: [{ zh: '我\t学习', en: 'I\nstudy' }] },
    { word: '你好', pinyin: 'ni3 hao3', defs: 'hello', count: 1, firstSeen: now - 1000, lastSeen: now - 40 * 86_400_000, saved: true, examples: [] },
    { word: '猫', pinyin: 'mao1', defs: 'cat', count: 0, firstSeen: now, lastSeen: now, saved: true, examples: [] },
  ];
  assert.deepEqual(filterWords(words, { now }).map((w) => w.word), ['学习', '你好']);
  assert.deepEqual(filterWords(words, { now, minCount: 3 }).map((w) => w.word), ['学习']);
  assert.deepEqual(filterWords(words, { now, sinceDays: 30 }).map((w) => w.word), ['学习']);
  assert.deepEqual(filterWords(words, { now, tab: 'saved' }).map((w) => w.word), ['你好', '猫']);
  assert.deepEqual(filterWords(words, { now, query: 'nihao' }).map((w) => w.word), ['你好']);
  assert.deepEqual(filterWords(words, { now, query: 'STUDY' }).map((w) => w.word), ['学习']);
  assert.deepEqual(sortWords(words, 'recent').map((w) => w.word), ['猫', '学习', '你好']);
  assert.deepEqual(sortWords(words, 'count').map((w) => w.word), ['学习', '你好', '猫']);

  const tsv = toAnkiTSV(words.slice(0, 1)).trim().split('\n');
  assert.equal(tsv[0], '#separator:tab');
  assert.equal(tsv[3], ['学习', 'xué xí', 'to study', '5', '我 学习', 'I study'].join('\t'));
});

test('pageUrl keeps origin and path of http(s) pages only', () => {
  assert.equal(pageUrl('https://example.com/news/a?token=secret#top'), 'https://example.com/news/a');
  assert.equal(pageUrl('http://localhost:8787/x'), 'http://localhost:8787/x');
  assert.equal(pageUrl('javascript:alert(1)'), '');
  assert.equal(pageUrl('data:text/html,hi'), '');
  assert.equal(pageUrl('file:///Users/me/a.html'), '');
  assert.equal(pageUrl('not a url'), '');
  assert.equal(pageUrl(undefined), '');
});

test('cleanRecord rebuilds imported records with safe types', () => {
  const base = { word: '喜欢', count: 3.7, firstSeen: 1, lastSeen: 2, examples: [] };
  assert.equal(cleanRecord(null), null);
  assert.equal(cleanRecord({ ...base, word: '' }), null);
  assert.equal(cleanRecord({ ...base, word: 'x'.repeat(40) }), null);
  assert.equal(cleanRecord({ ...base, examples: 'nope' }), null);
  const r = cleanRecord({
    ...base,
    pinyin: 42,
    defs: { evil: true },
    saved: 'yes',
    extra: '<img src=x onerror=alert(1)>',
    examples: [
      { zh: '我喜欢', en: 'I like', url: 'javascript:alert(1)', ts: 'soon' },
      { zh: 7 },
      null,
      { zh: '你喜欢吗', url: 'https://a.example/p?session=1' },
    ],
  });
  assert.deepEqual(r, {
    word: '喜欢',
    pinyin: '',
    defs: '',
    count: 3,
    firstSeen: 1,
    lastSeen: 2,
    examples: [
      { zh: '我喜欢', en: 'I like', url: '', ts: 2 },
      { zh: '你喜欢吗', en: '', url: 'https://a.example/p', ts: 2 },
    ],
    saved: false,
  });
});
