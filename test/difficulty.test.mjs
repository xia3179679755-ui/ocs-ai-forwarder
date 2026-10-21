import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyQuestion } from '../src/difficulty.mjs';

test('simple single choice uses low reasoning', () => {
  const result = classifyQuestion({
    title: '中国的首都是？',
    type: 'single',
    options: 'A. 北京\nB. 上海\nC. 广州\nD. 深圳'
  });

  assert.equal(result.level, 'low');
  assert.equal(result.reasoningEffort, 'low');
});

test('multi-step multiple choice uses high reasoning', () => {
  const result = classifyQuestion({
    title: '结合材料分析下列说法，并判断哪些选项能够同时成立。请说明推导过程。',
    type: 'multiple',
    options: 'A. 选项一\nB. 选项二\nC. 选项三\nD. 选项四\nE. 选项五\nF. 选项六\nG. 选项七'
  });

  assert.equal(result.level, 'high');
  assert.equal(result.reasoningEffort, 'high');
});
