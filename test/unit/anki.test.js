import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readApkg, cleanField } from '../../src/shared/anki.js';
import { makeApkg, makeZip } from '../helpers/anki.js';

const NOTES = [
  ['中', 'zhōng', 'middle; center'],
  ['住', 'zhù', 'to live'],
  ['<b>中</b>国', 'Zhōngguó', 'China'],
  ['爷爷', 'yéye', 'grandpa (father&#x27;s side) [sound:c1-abc.mp3]'],
];
const WORDS = [
  { zh: '中', pinyin: 'zhōng', en: 'middle; center' },
  { zh: '住', pinyin: 'zhù', en: 'to live' },
  { zh: '中国', pinyin: 'Zhōngguó', en: 'China' },
  { zh: '爷爷', pinyin: 'yéye', en: "grandpa (father's side)" },
];

test('cleanField strips HTML, entities and sound references', () => {
  assert.equal(cleanField('<b>中</b>国 [sound:x.mp3]'), '中国');
  assert.equal(cleanField('grandpa (father&#x27;s side)'), "grandpa (father's side)");
  assert.equal(cleanField('to live<br>to stay'), 'to live; to stay');
  assert.equal(cleanField('<div>a</div><div>b</div>'), 'a; b');
  assert.equal(cleanField('x&nbsp;y &amp; z &bogus;'), 'x y & z &bogus;');
  assert.equal(cleanField(undefined), '');
  assert.equal(cleanField('meaning<br>'), 'meaning');
  assert.equal(cleanField('a<br><br>b'), 'a; b');
  assert.equal(cleanField('<div>a</div><div><br></div>'), 'a');
  // Only separators made from tags are collapsed or trimmed; the field's own text is kept.
  assert.equal(cleanField('a; ; b'), 'a; ; b');
  assert.equal(cleanField('meaning; '), 'meaning;');
  assert.equal(cleanField('a&#59; '), 'a;');
  assert.equal(cleanField('a;<br>b'), 'a;; b');
  assert.equal(cleanField('a\u0000b'), 'ab');
});

test('reads a legacy deck (collection.anki2, field names in col.models)', async () => {
  const deck = await readApkg(makeApkg({ notes: NOTES }));
  assert.deepEqual(deck, { deck: 'Chinese 1', words: WORDS, skipped: [] });
});

test('reads a current Anki export (zstd collection.anki21b, fields table, stub anki2)', async () => {
  const deck = await readApkg(makeApkg({ modern: true, notes: NOTES }));
  assert.deepEqual(deck, { deck: 'Chinese 1', words: WORDS, skipped: [] });
});

test('a file holding only the "please update" stub is an error', async () => {
  await assert.rejects(readApkg(makeApkg({ stubOnly: true })), /No Anki collection/);
});

test('files that are not Anki decks are errors', async () => {
  await assert.rejects(readApkg(new TextEncoder().encode('just some text, definitely not a zip')), /Not a zip file/);
  await assert.rejects(readApkg(makeZip({ 'notes.txt': 'hello' })), /No Anki collection/);
});

test('notes without Chinese are skipped and reported; repeats are merged', async () => {
  const deck = await readApkg(makeApkg({
    notes: [['你好', 'nǐ hǎo', 'hello'], ['hello', '', 'a Basic card'], ['你好', 'nǐhǎo', 'hi']],
  }));
  assert.deepEqual(deck.words, [{ zh: '你好', pinyin: 'nǐ hǎo', en: 'hello' }]);
  assert.deepEqual(deck.skipped, ['hello']);
});

test('fields are found by content when their names are unknown', async () => {
  const deck = await readApkg(makeApkg({ fields: ['Front', 'Back'], notes: [['hello', '你好']] }));
  // Front is a Chinese-sounding name but holds no Chinese; Back is mostly Han.
  // Back is also an English-sounding name, but it's the Chinese field, so English stays empty.
  assert.deepEqual(deck.words, [{ zh: '你好', pinyin: '', en: '' }]);
});
