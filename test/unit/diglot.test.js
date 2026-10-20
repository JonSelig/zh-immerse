import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lemmas, findSwaps, applySwaps, diglotItem, parseWordMap, translationWords, replacedAt, ungradedItem } from '../../src/shared/diglot.js';

const map = parseWordMap([
  'like\t爱:1,喜欢:1,一样:1',
  'apple\t苹果:1',
  'study\t学习:1',
  'go\t去:1,走:1',
  'weather\t天气:1',
  'ice cream\t冰淇淋:3',
  'friend\t朋友:1',
  'run\t跑:2',
  'easy\t容易:2',
  'school\t学校:1',
  'university\t大学:3',
  'learn\t学:1',
].join('\n'));

test('lemmas cover common inflections', () => {
  assert.ok(lemmas('studies').includes('study'));
  assert.ok(lemmas('studied').includes('study'));
  assert.ok(lemmas('running').includes('run'));
  assert.ok(lemmas('went').includes('go'));
  assert.ok(lemmas('easier').includes('easy'));
  assert.ok(lemmas('liked').includes('like'));
  assert.ok(lemmas('apples').includes('apple'));
  assert.equal(lemmas('apple')[0], 'apple');
});

test('a word is swapped only when its Chinese appears in the sentence translation', () => {
  const swap = (en, zh, level = 6) => applySwaps(en, findSwaps(en, map, level, translationWords(zh))).text;
  assert.equal(swap('I like apples.', '我喜欢苹果。'), 'I 喜欢 苹果.');
  assert.equal(swap('It looks like rain.', '看起来要下雨了。'), 'It looks like rain.');
  assert.equal(swap('We went to school.', '我们去了学校。'), 'We 去 to 学校.');
  assert.equal(swap("My friend's ice cream", '我朋友的冰淇淋'), "My 朋友's 冰淇淋");
});

test('level limits which words are swapped', () => {
  const zh = '我喜欢冰淇淋。';
  const en = 'I like ice cream.';
  assert.equal(applySwaps(en, findSwaps(en, map, 1, translationWords(zh))).text, 'I 喜欢 ice cream.');
  assert.equal(applySwaps(en, findSwaps(en, map, 3, translationWords(zh))).text, 'I 喜欢 冰淇淋.');
});

test('single characters must be whole words in the translation', () => {
  // 学 (learn) appears inside 大学 but is not a word there.
  const en = 'I learn at the university.';
  const swaps = findSwaps(en, map, 1, translationWords('我在大学学习。'));
  assert.deepEqual(swaps.map((s) => s.zh), []);
});

test('ranges point at the swapped words', () => {
  const { text, ranges } = applySwaps('I study and run.', [
    { start: 2, end: 7, zh: '学习' }, { start: 12, end: 15, zh: '跑' },
  ]);
  assert.equal(text, 'I 学习 and 跑.');
  assert.deepEqual(ranges.map(([s, e]) => text.slice(s, e)), ['学习', '跑']);
});

test('segmented items keep their shape', () => {
  const out = diglotItem(['I like ', 'the weather', ' today.'], ['我喜欢', '今天的天气', '。'], map, 1);
  assert.deepEqual(out.segments, ['I 喜欢 ', 'the 天气', ' today.']);
  assert.equal(out.full, '我喜欢今天的天气。');
  assert.deepEqual(out.ranges.map((r) => r.length), [1, 1, 0]);
});

test('ranges keep the English each swap replaced, as written on the page', () => {
  const out = diglotItem(["My friend's ice cream ", 'went'], ['我朋友的冰淇淋', '走了'], map, 3);
  assert.deepEqual(out.segments, ["My 朋友's 冰淇淋 ", '走']);
  assert.deepEqual(out.ranges, [[[3, 5, 'friend'], [8, 11, 'ice cream']], [[0, 1, 'went']]]);
});

test('replacedAt finds the English behind the character at an offset', () => {
  const swaps = [[2, 4, 'like'], [5, 7, 'apples']];
  assert.equal(replacedAt(swaps, 2), 'like');
  assert.equal(replacedAt(swaps, 3), 'like');
  assert.equal(replacedAt(swaps, 6), 'apples');
  assert.equal(replacedAt(swaps, 4), '');
  assert.equal(replacedAt(swaps, 7), '');
  assert.equal(replacedAt(null, 0), '');
});

test('ungradedItem leaves the English as it is', () => {
  assert.deepEqual(ungradedItem('Hello there.'), { segments: ['Hello there.'], ranges: [[]], full: null });
  assert.deepEqual(ungradedItem(['Read the ', 'docs', '.']), { segments: ['Read the ', 'docs', '.'], ranges: [[], [], []], full: null });
});
