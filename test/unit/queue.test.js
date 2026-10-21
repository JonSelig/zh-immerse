import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lanes } from '../../src/shared/queue.js';

const len = (key) => key.length;
const takeAll = (lanes, max = 4, chars = 3000) => {
  const batches = [];
  while (lanes.size) batches.push(lanes.take(max, chars, len));
  return batches;
};

test('on-screen keys go before look-ahead keys, each lane in order', () => {
  const lanes = new Lanes();
  lanes.add('a1', false);
  lanes.add('a2', false);
  lanes.add('u1', true);
  lanes.add('u2', true);
  assert.deepEqual(takeAll(lanes, 2), [['u1', 'u2'], ['a1', 'a2']]);
});

test('a batch never mixes in look-ahead keys while on-screen ones wait', () => {
  const lanes = new Lanes();
  lanes.add('a1', false);
  lanes.add('u1', true);
  assert.deepEqual(lanes.take(4, 3000, len), ['u1']);
  assert.deepEqual(lanes.take(4, 3000, len), ['a1']);
});

test('adding a waiting look-ahead key as on-screen promotes it, without duplicates', () => {
  const lanes = new Lanes();
  lanes.add('a1', false);
  lanes.add('a2', false);
  lanes.add('a2', true);
  lanes.add('a2', false); // stays on-screen
  assert.equal(lanes.size, 2);
  assert.deepEqual(takeAll(lanes), [['a2'], ['a1']]);
});

test('promote moves a waiting key to the back of the on-screen lane', () => {
  const lanes = new Lanes();
  lanes.add('a1', false);
  lanes.add('a2', false);
  lanes.add('u1', true);
  assert.equal(lanes.promote('a2'), true);
  assert.equal(lanes.promote('u1'), false); // already on-screen
  assert.equal(lanes.promote('gone'), false);
  assert.deepEqual(takeAll(lanes), [['u1', 'a2'], ['a1']]);
});

test('take respects the item and character limits, but always takes one', () => {
  const lanes = new Lanes();
  for (const key of ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee']) lanes.add(key, true);
  assert.deepEqual(lanes.take(3, 3000, len), ['aaaa', 'bbbb', 'cccc']);
  assert.deepEqual(lanes.take(3, 6, len), ['dddd']);
  lanes.add('x'.repeat(50), true);
  assert.deepEqual(lanes.take(3, 6, len), ['eeee']);
  assert.deepEqual(lanes.take(3, 6, len), ['x'.repeat(50)]);
  assert.deepEqual(lanes.take(3, 6, len), []);
});

test('a waiting key can be checked and removed; a taken one cannot', () => {
  const lanes = new Lanes();
  lanes.add('a', true);
  lanes.add('b', false);
  assert.ok(lanes.has('a') && lanes.has('b'));
  assert.deepEqual(lanes.take(1, 1000, (k) => k.length), ['a']); // 'a' is now in flight
  assert.equal(lanes.has('a'), false);
  assert.equal(lanes.remove('a'), false);
  assert.equal(lanes.remove('b'), true);
  assert.equal(lanes.size, 0);
});
