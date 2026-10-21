import test from 'node:test';
import assert from 'node:assert/strict';

import { alignAnswerToOptions, extractAnswer, parseOptions } from '../src/response.mjs';

test('parses a single-choice letter and drops punctuation and explanation', () => {
  const payload = {
    choices: [{
      message: { content: '{"answer":"答案：A。因为该选项正确。"}' }
    }]
  };

  assert.equal(extractAnswer(payload, 'single'), 'A');
});

test('parses multiple-choice letters and converts separators to #', () => {
  const payload = {
    choices: [{
      message: { content: '{"answer":"A、C。正确答案为 A 和 C。"}' }
    }]
  };

  assert.equal(extractAnswer(payload, 'multiple'), 'A#C');
});

test('parses judgement answers as TRUE or FALSE', () => {
  const truePayload = {
    choices: [{ message: { content: '{"answer":true}' } }]
  };
  const falsePayload = {
    choices: [{ message: { content: '答案：错误。理由见题干。' } }]
  };

  assert.equal(extractAnswer(truePayload, 'judge'), 'TRUE');
  assert.equal(extractAnswer(falsePayload, 'judge'), 'FALSE');
});

test('keeps a lettered judgement option compatible with OCS choices', () => {
  const payload = {
    choices: [{ message: { content: '{"answer":"A. 正确"}' } }]
  };

  assert.equal(extractAnswer(payload, 'judge'), 'A');
});

test('accepts a plain single-choice answer from an otherwise concise model reply', () => {
  const payload = {
    choices: [{ message: { content: 'A' } }]
  };

  assert.equal(extractAnswer(payload, 'single'), 'A');
});

test('parses the option letters OCS sends so answers can be validated against them', () => {
  assert.deepEqual(parseOptions('A. 2\nB、3\nC) 4\nD．5'), [
    { letter: 'A', text: '2' },
    { letter: 'B', text: '3' },
    { letter: 'C', text: '4' },
    { letter: 'D', text: '5' }
  ]);
});

test('maps a judgement TRUE to the matching lettered option', () => {
  const question = { type: 'judge', options: 'A. 正确\nB. 错误' };
  assert.equal(alignAnswerToOptions('TRUE', question), 'A');
  assert.equal(alignAnswerToOptions('FALSE', question), 'B');
});

test('answers a letterless judgement question with the option text OCS matches on', () => {
  // OCS 真实请求：type=judgement, options="对\n错"，回字母选不中。
  const question = { type: 'judgement', options: '对\n错' };
  assert.deepEqual(parseOptions(question.options).map((entry) => entry.letter), ['A', 'B']);
  assert.equal(alignAnswerToOptions('TRUE', question), '对');
  assert.equal(alignAnswerToOptions('FALSE', question), '错');
  assert.equal(alignAnswerToOptions('B', question), '错');
});

test('keeps letters when the options already carry their own letters', () => {
  const question = { type: 'judgement', options: 'A. 对\nB. 错' };
  assert.equal(alignAnswerToOptions('FALSE', question), 'B');
  assert.equal(alignAnswerToOptions('B', question), 'B');
});

test('keeps TRUE or FALSE when the judgement question has no options at all', () => {
  assert.equal(alignAnswerToOptions('TRUE', { type: 'judge', options: '' }), 'TRUE');
  assert.equal(alignAnswerToOptions('FALSE', { type: 'judge', options: '' }), 'FALSE');
});

test('does not mistake the real letterless OCS options for a letter D', () => {
  // 这条来自 OCS 真实请求：每行都以 delete 开头，曾被误判成 "D"。
  const options = "delete from stu where name = '张三'\ndelete from stu \ndelete from stu name = '张三'\ndelete name = '张三'";

  const entries = parseOptions(options);
  assert.deepEqual(entries.map((entry) => entry.letter), ['A', 'B', 'C', 'D']);
  assert.equal(entries[0].text, "delete from stu where name = '张三'");
  assert.equal(alignAnswerToOptions('A', { type: 'single', options }), "delete from stu where name = '张三'");
  assert.equal(alignAnswerToOptions('C', { type: 'single', options }), "delete from stu name = '张三'");
  assert.equal(alignAnswerToOptions('E', { type: 'single', options }), '');
});

test('joins letterless multiple-choice options with # using their text', () => {
  const options = '指定身份\n背景说明\n任务要求\n输出规则';
  assert.equal(
    alignAnswerToOptions('A#B#C#D', { type: 'multiple', options }),
    '指定身份#背景说明#任务要求#输出规则'
  );
});

test('rejects a letter that OCS does not offer as an option', () => {
  const question = { type: 'single', options: 'A. 2\nB. 3\nC. 4\nD. 5' };
  assert.equal(alignAnswerToOptions('E', question), '');
  assert.equal(alignAnswerToOptions('A', question), 'A');
});

test('keeps every multiple-choice letter when all of them exist in the options', () => {
  const question = { type: 'multiple', options: 'A. 一\nB. 二\nC. 三\nD. 四' };
  assert.equal(alignAnswerToOptions('A#C', question), 'A#C');
  assert.equal(alignAnswerToOptions('A#E', question), '');
});

test('converts an option text answer into the option letter', () => {
  const question = { type: 'single', options: 'A. 数据库\nB. 编译器' };
  assert.equal(alignAnswerToOptions('数据库', question), 'A');
});

test('parses a real SQL single-choice reply end to end', () => {
  const payload = {
    choices: [{
      message: {
        content: '{"answer":"B"}'
      }
    }]
  };
  const question = {
    type: 'single',
    options: 'A. SELECT * FROM t WHERE id = 1;\nB. SELECT id FROM t;\nC. DELETE FROM t;\nD. UPDATE t SET id = 1;'
  };
  const raw = extractAnswer(payload, question.type);
  assert.equal(raw, 'B');
  assert.equal(alignAnswerToOptions(raw, question), 'B');
});

test('parses a real multiple-choice reply into the OCS A#C format', () => {
  const payload = {
    choices: [{
      message: {
        content: '答案为 A、C，因为这两项都满足题意。'
      }
    }]
  };
  const question = { type: 'multiple', options: 'A. 一\nB. 二\nC. 三\nD. 四' };
  const raw = extractAnswer(payload, question.type);
  assert.equal(raw, 'A#C');
  assert.equal(alignAnswerToOptions(raw, question), 'A#C');
});

test('reduces the live upstream "B. SELECT" shape to the bare letter', () => {
  const payload = {
    choices: [{ message: { content: ' {"answer":"B. SELECT"}' } }]
  };
  const question = {
    type: 'single',
    options: 'A. INSERT\nB. SELECT\nC. UPDATE\nD. DELETE'
  };

  assert.equal(extractAnswer(payload, question.type), 'B');
});

test('parses options that OCS sends on a single line', () => {
  assert.deepEqual(parseOptions('A. 正确 B. 错误'), [
    { letter: 'A', text: '正确' },
    { letter: 'B', text: '错误' }
  ]);
});

test('maps TRUE to a letter even when the judge options share one line', () => {
  const question = { type: 'judge', options: 'A. 正确 B. 错误' };
  assert.equal(alignAnswerToOptions('TRUE', question), 'A');
  assert.equal(alignAnswerToOptions('FALSE', question), 'B');
});

test('recognises the Chinese question type aliases OCS can send', () => {
  assert.equal(extractAnswer({ choices: [{ message: { content: 'A#C' } }] }, '不定项选择题'), 'A#C');
  assert.equal(extractAnswer({ choices: [{ message: { content: 'A#C' } }] }, '多项选择题'), 'A#C');
  assert.equal(extractAnswer({ choices: [{ message: { content: '正确' } }] }, '是非题'), 'TRUE');
  assert.equal(extractAnswer({ choices: [{ message: { content: '错误' } }] }, '对错题'), 'FALSE');
});
