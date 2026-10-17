import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickVoice } from '../../src/content/speech.js';

const v = (name, lang, localService = true) => ({ name, lang, localService });

test('prefers a natural Mainland Mandarin voice', () => {
  const voices = [
    v('Eddy (Chinese (China mainland))', 'zh-CN'),
    v('Meijia', 'zh-TW'),
    v('Tingting', 'zh-CN'),
    v('Samantha', 'en-US'),
  ];
  assert.equal(pickVoice(voices).name, 'Tingting');
  assert.equal(pickVoice([...voices, v('Lili (Premium)', 'zh-CN')]).name, 'Lili (Premium)');
  assert.equal(pickVoice([v('Meijia', 'zh-TW'), v('Samantha', 'en-US')]).name, 'Meijia');
  assert.equal(pickVoice([v('Samantha', 'en-US')]), null);
});
