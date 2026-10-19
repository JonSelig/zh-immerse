import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glosses, cleanGloss, SKIP_MEANING } from '../../src/shared/gloss.js';

test('cleanGloss drops parentheses, placeholders and leading articles', () => {
  assert.equal(cleanGloss('to hit (a target)'), 'hit');
  assert.equal(cleanGloss('to be fond of sth'), 'be fond of');
  assert.equal(cleanGloss('the middle'), 'middle');
});

test('glosses splits definitions into matchable English keys', () => {
  assert.deepEqual(glosses('to live; to stay'), ['live', 'stay']);
  assert.deepEqual(glosses('middle; center / Middle'), ['middle', 'center']);
  // Function words and long phrases can't be matched usefully.
  assert.deepEqual(glosses('in; to be in love with sb deeply'), []);
  assert.deepEqual(glosses(''), []);
  assert.deepEqual(glosses(undefined), []);
});

test('glosses can skip senses like surnames and dialect', () => {
  const defs = '(bound form) China; Chinese; surname Zhong';
  assert.deepEqual(glosses(defs), ['china', 'chinese', 'surname zhong']);
  assert.deepEqual(glosses(defs, { skip: SKIP_MEANING }), ['china', 'chinese']);
});

test('glosses applies skip to a whole definition, not to its comma parts', () => {
  assert.deepEqual(glosses('classifier for books, periodicals, files etc; root', { skip: SKIP_MEANING }), ['root']);
});
