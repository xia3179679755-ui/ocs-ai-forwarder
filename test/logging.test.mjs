import test from 'node:test';
import assert from 'node:assert/strict';

import { formatLogEvent } from '../src/logging.mjs';

test('formats an answer log with question, model, answer, and elapsed time', () => {
  const line = formatLogEvent({
    type: 'answer_received',
    question: '1 + 2 = ?',
    answer: 'B',
    model: 'backup-model',
    elapsedMs: 1234
  });

  assert.match(line, /1 \+ 2 = \?/u);
  assert.match(line, /backup-model/u);
  assert.match(line, /答案=B/u);
  assert.match(line, /耗时=1234ms/u);
});

test('formats request errors without exposing credentials', () => {
  const line = formatLogEvent({
    type: 'model_failed',
    model: 'strong-model',
    error: '401 Authorization: Bearer secret-key',
    elapsedMs: 42
  });

  assert.match(line, /失败/u);
  assert.match(line, /strong-model/u);
  assert.doesNotMatch(line, /secret-key/u);
});
