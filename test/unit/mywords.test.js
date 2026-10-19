import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MY_WORDS, cleanMyWord, cleanMyWords, mergeWords, addWord, removeWord, editWord,
  readingEntries, buildMyWordMap,
} from '../../src/shared/mywords.js';
import { MY_LEVEL, LEVELS, findSwaps, applySwaps, translationWords } from '../../src/shared/diglot.js';

const DICT = new Map([
  ['中', [
    { pinyin: 'zhong1', defs: 'within; among; in; middle; center; while (doing sth); during; (dialect) OK; all right' },
    { pinyin: 'zhong4', defs: 'to hit (a target); to be struck by (a bullet, illness etc); to win (a prize or lottery)' },
    { pinyin: 'Zhong1', defs: '(bound form) China; Chinese; surname Zhong' },
  ]],
  ['大', [{ pinyin: 'da4', defs: 'big; large; great' }]],
  ['喜欢', [{ pinyin: 'xi3 huan5', defs: 'to like; to be fond of' }]],
  ['他的', [{ pinyin: 'ta1 de5', defs: 'his' }]],
  ['中国人', [{ pinyin: 'Zhong1 guo2 ren2', defs: 'Chinese person' }]],
  ['西安', [{ pinyin: 'Xi1 an1', defs: "Xi'an, capital of Shaanxi" }, { pinyin: 'xi1 an4', defs: 'made-up second reading' }]],
]);
const entriesFor = (zh) => DICT.get(zh) ?? [];
const keysFor = (map, zh) => [...map].filter(([, list]) => list.some((c) => c.zh === zh)).map(([en]) => en).sort();

test('MY_LEVEL is level 0 and comes first', () => {
  assert.equal(MY_LEVEL, 0);
  assert.equal(LEVELS[0], MY_LEVEL);
});

test('cleanMyWord keeps valid words and trims fields', () => {
  assert.deepEqual(cleanMyWord({ zh: ' 中国 ', en: ' China ', pinyin: 'Zhōngguó', source: 'Chinese 1', extra: 1 }),
    { zh: '中国', pinyin: 'Zhōngguó', en: 'China', source: 'Chinese 1' });
  assert.deepEqual(cleanMyWord({ zh: '中', en: 5 }), { zh: '中', pinyin: '', en: '', source: '' });
  assert.equal(cleanMyWord({ zh: 'hello' }), null);
  assert.equal(cleanMyWord({ zh: '中a' }), null);
  assert.equal(cleanMyWord({ zh: '中'.repeat(17) }), null);
  assert.equal(cleanMyWord(null), null);
  assert.equal(cleanMyWord({ zh: '中', en: 'x'.repeat(500) }).en.length, 200);
});

test('cleanMyWords drops invalid and repeated words and caps the list', () => {
  assert.deepEqual(cleanMyWords([{ zh: '中' }, { zh: 'x' }, { zh: '中', en: 'again' }]).map((w) => w.zh), ['中']);
  assert.deepEqual(cleanMyWords('nope'), []);
  const many = Array.from({ length: MAX_MY_WORDS + 5 }, (_, i) => ({ zh: String.fromCodePoint(0x4e00 + (i % 20000)) + String.fromCodePoint(0x4e00 + Math.floor(i / 20000)) }));
  assert.equal(cleanMyWords(many).length, MAX_MY_WORDS);
});

test('mergeWords add keeps existing words (and your edits) and counts', () => {
  const list = [{ zh: '中', pinyin: 'zhōng', en: 'my edit', source: 'Chinese 1' }];
  const incoming = [{ zh: '中', pinyin: 'zhōng', en: 'middle', source: 'Chinese 1' }, { zh: '大', pinyin: 'dà', en: 'big', source: 'Chinese 1' }];
  const { words, added, existing } = mergeWords(list, incoming, 'add');
  assert.deepEqual(words.map((w) => [w.zh, w.en]), [['中', 'my edit'], ['大', 'big']]);
  assert.equal(added, 1);
  assert.equal(existing, 1);
});

test('mergeWords replace drops the old list', () => {
  const { words, added, existing } = mergeWords([{ zh: '中', pinyin: '', en: '', source: '' }], [{ zh: '大', pinyin: '', en: 'big', source: 'D' }], 'replace');
  assert.deepEqual(words.map((w) => w.zh), ['大']);
  assert.equal(added, 1);
  assert.equal(existing, 0);
});

test('addWord, editWord and removeWord', () => {
  let list = addWord([], { zh: '咖啡', en: 'coffee' });
  assert.deepEqual(list, [{ zh: '咖啡', pinyin: '', en: 'coffee', source: '' }]);
  list = addWord(list, { zh: '咖啡', en: 'coffee; café' }); // adding again updates the English
  assert.deepEqual(list.map((w) => w.en), ['coffee; café']);
  assert.equal(addWord(list, { zh: 'coffee', en: '' }), null);
  list = editWord(list, '咖啡', ' java ');
  assert.equal(list[0].en, 'java');
  assert.deepEqual(removeWord(list, '咖啡'), []);
});

test('readingEntries keeps the dictionary entries for the card pronunciation', () => {
  const zh = DICT.get('中');
  assert.deepEqual(readingEntries(zh, 'zhōng').map((e) => e.pinyin), ['zhong1', 'Zhong1']);
  assert.deepEqual(readingEntries(zh, 'zhong1').map((e) => e.pinyin), ['zhong1', 'Zhong1']); // tone numbers
  assert.deepEqual(readingEntries(zh, '').map((e) => e.pinyin), ['zhong1', 'zhong4', 'Zhong1']); // no card pinyin
  assert.deepEqual(readingEntries(zh, 'zhóng').map((e) => e.pinyin), ['zhong1', 'zhong4', 'Zhong1']); // no match: all
  assert.equal(readingEntries(DICT.get('他的'), 'tāde').length, 1); // neutral tone, no space
  assert.equal(readingEntries(DICT.get('中国人'), 'Zhōngguó rén').length, 1);
  assert.deepEqual(readingEntries(DICT.get('西安'), 'Xī’ān').map((e) => e.pinyin), ['Xi1 an1']);
});

test('buildMyWordMap: card English plus every meaning of the card pronunciation', () => {
  const map = buildMyWordMap([{ zh: '中', pinyin: 'zhōng', en: 'middle; centre' }], entriesFor);
  assert.deepEqual(keysFor(map, '中'), ['all right', 'among', 'center', 'centre', 'china', 'chinese', 'during', 'middle', 'while', 'within']);
  assert.ok(!map.has('hit')); // zhòng, not the card's reading
  assert.ok(buildMyWordMap([{ zh: '中', pinyin: '', en: '' }], entriesFor).has('hit')); // no card pinyin: all readings
});

test('buildMyWordMap prefers longer words for the same English', () => {
  const map = buildMyWordMap([
    { zh: '中', pinyin: 'zhōng', en: '' },
    { zh: '中国人', pinyin: 'Zhōngguó rén', en: 'Chinese' },
  ], entriesFor);
  assert.deepEqual(map.get('chinese').map((c) => c.zh), ['中国人', '中']);
  assert.ok(map.get('chinese').every((c) => c.level === MY_LEVEL));
});

test('an empty list swaps nothing', () => {
  const map = buildMyWordMap([], entriesFor);
  assert.equal(map.size, 0);
  assert.deepEqual(findSwaps('We like big apples.', map, MY_LEVEL, translationWords('我们喜欢大苹果。')), []);
});

test('at level 0 only list words are swapped, by any of their meanings', () => {
  const map = buildMyWordMap([{ zh: '喜欢', pinyin: 'xǐhuan', en: 'to like' }, { zh: '大', pinyin: 'dà', en: 'big' }], entriesFor);
  const swap = (en, zh) => applySwaps(en, findSwaps(en, map, MY_LEVEL, translationWords(zh))).text;
  assert.equal(swap('We like big apples.', '我们喜欢大苹果。'), 'We 喜欢 大 apples.');
  assert.equal(swap('They have a large house.', '他们有一栋大房子。'), 'They have a 大 house.'); // "large" isn't on the card
});
