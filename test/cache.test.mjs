import test from 'node:test';
import assert from 'node:assert/strict';

import { createAnswerCache } from '../src/cache.mjs';

test('returns a stored answer until it expires', () => {
  let clock = 1000;
  const cache = createAnswerCache({ ttlMs: 500, now: () => clock });

  cache.set('k', { code: 1, answer: 'A' });
  assert.equal(cache.get('k').answer, 'A');

  clock += 400;
  assert.equal(cache.get('k').answer, 'A');

  clock += 200;
  assert.equal(cache.get('k'), null);
});

test('evicts the oldest entry when the cache is full', () => {
  const cache = createAnswerCache({ ttlMs: 60000, maxEntries: 2 });

  cache.set('a', { answer: 'A' });
  cache.set('b', { answer: 'B' });
  cache.set('c', { answer: 'C' });

  assert.equal(cache.get('a'), null);
  assert.equal(cache.get('b').answer, 'B');
  assert.equal(cache.get('c').answer, 'C');
  assert.equal(cache.size, 2);
});
