import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lemmas, findSwaps, applySwaps, diglotItem, parseWordMap, translationWords, replacedAt } from '../../src/shared/diglot.js';

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

// Verb + 在/到/给/成 glued by the segmenter (住在 "live in"). `isWord` stands in
// for CC-CEDICT: real words like 现在 are never split.
const verbMap = parseWordMap(['live\t住:1', 'sit\t坐:1', 'put\t放:1', 'now\t现在:1', 'just\t正:1'].join('\n'));
const DICT_WORDS = new Set(['现在', '正在', '中国', '哪里', '桌子', '椅子']);
const isWord = (s) => DICT_WORDS.has(s);
const swapWith = (en, zh, level, opts) => applySwaps(en, findSwaps(en, verbMap, level, translationWords(zh, isWord), { isWord, ...opts })).text;

test('a verb glued to 在 by the segmenter still counts as a word', () => {
  const inTranslation = translationWords('我住在中国。', isWord);
  assert.ok(inTranslation('住'));
  assert.ok(!translationWords('我住在中国。')('住')); // without a dictionary, nothing is split
  assert.ok(!translationWords('他现在很忙。', isWord)('现')); // real words stay whole
  // Only verb + 在/到/给/成 pairs are split, not any non-word pair.
  assert.ok(!translationWords('他看书。', isWord)('看')); // 看书 isn't in the test dictionary either
});

// A word must be confirmed by its own sentence's translation when the
// English and Chinese have the same number of sentences.
const stopMap = parseWordMap(['live\t住:1', 'stop\t住:1'].join('\n'));
const BLOCK_EN = 'I live in China. She ran to the bus stop.';
const BLOCK_ZH = '我住在中国。她跑到了公交车站。';

test('each sentence is checked against its own translation', () => {
  const out = diglotItem(BLOCK_EN, BLOCK_ZH, stopMap, 1, { isWord });
  assert.deepEqual(out.segments, ['I 住在 China. She ran to the bus stop.']);
  assert.equal(out.full, BLOCK_ZH);
});

test('sentence matching works across segments', () => {
  const out = diglotItem(['I live in China. She ', 'ran', ' to the bus stop.'], ['我住在中国。她', '跑到了', '公交车站。'], stopMap, 1, { isWord });
  assert.deepEqual(out.segments, ['I 住在 China. She ', 'ran', ' to the bus stop.']);
  assert.deepEqual(out.ranges, [[[2, 4, 'live in']], [], []]);
});

test('different sentence counts fall back to the whole paragraph', () => {
  // One Chinese sentence for two English ones: no alignment, so 住 anywhere counts.
  const out = diglotItem(BLOCK_EN, '我住在中国，她跑到了公交车站住。', stopMap, 1, { isWord });
  assert.equal(out.segments[0], 'I 住在 China. She ran to the bus 住.');
});

test('verb + matching preposition becomes one Chinese phrase', () => {
  assert.equal(swapWith('I live in China.', '我住在中国。', 1), 'I 住在 China.');
  assert.equal(swapWith('She sat on the chair.', '她坐在椅子上。', 1), 'She 坐在 the chair.');
});

test('without a matching preposition only the verb is swapped', () => {
  assert.equal(swapWith('Where do you live?', '你住在哪里？', 1), 'Where do you 住?');
  assert.equal(swapWith('Put the book on the table.', '把书放在桌子上。', 1), '放 the book on the table.');
});

test('the phrase needs its preposition to be known at the level', () => {
  // Level 0 (My words): the map's candidates are level 0; 在 must be on the list.
  const mine = parseWordMap('live\t住:0');
  const swap0 = (knownPrep) => applySwaps('I live in China.',
    findSwaps('I live in China.', mine, 0, translationWords('我住在中国。', isWord), { isWord, knownPrep })).text;
  assert.equal(swap0(() => false), 'I 住 in China.');
  assert.equal(swap0((p) => p === '在'), 'I 住在 China.');
  assert.equal(swapWith('I live in China.', '我住在中国。', 0), 'I live in China.'); // HSK default: nothing at level 0
});

test('a phrase swap records the English it replaced', () => {
  const out = diglotItem('I live in China.', '我住在中国。', verbMap, 1, { isWord });
  assert.deepEqual(out.ranges, [[[2, 4, 'live in']]]);
});

test('a dictionary verb+preposition word takes its English preposition along', () => {
  // 来到 is a real word ("come to"); "to" must not be left dangling.
  const comeMap = parseWordMap('come\t来到:1');
  const out = diglotItem('He came to China.', '他来到了中国。', comeMap, 1, { isWord: (s) => s === '来到' || s === '中国' });
  assert.deepEqual(out.segments, ['He 来到 China.']);
  assert.deepEqual(out.ranges, [[[3, 5, 'came to']]]);
});

test('sentence matching handles a sentence start at a segment boundary and citations', () => {
  const split = diglotItem(['I live in China. ', 'She ran to the bus stop.'], ['我住在中国。', '她跑到了公交车站。'], stopMap, 1, { isWord });
  assert.deepEqual(split.segments, ['I 住在 China. ', 'She ran to the bus stop.']);
  // A Wikipedia-style citation after the full stop still ends the sentence.
  const cited = diglotItem('I live in China.[1] She ran to the bus stop.', BLOCK_ZH, stopMap, 1, { isWord });
  assert.equal(cited.segments[0], 'I 住在 China.[1] She ran to the bus stop.');
});
