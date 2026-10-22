import test from 'node:test';
import assert from 'node:assert/strict';

import { answerQuestion } from '../src/gateway.mjs';

const question = {
  title: '1 + 2 = ?',
  type: 'single',
  options: 'A. 2\nB. 3\nC. 4\nD. 5'
};

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  });
}

test('returns the primary model answer in OCS format', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return jsonResponse({
      choices: [{ message: { content: '{"answer":"B"}' } }]
    });
  };

  const result = await answerQuestion(question, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    primaryModel: 'primary-model',
    fallbackModel: 'backup-model',
    primaryTimeoutMs: 100,
    totalTimeoutMs: 500
  });

  assert.deepEqual(result, {
    code: 1,
    question: '1 + 2 = ?',
    answer: 'B',
    model: 'primary-model',
    reasoningEffort: 'low'
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, 'primary-model');
  assert.equal(calls[0].body.reasoning_effort, 'low');
  assert.equal(calls[0].body.max_tokens, 64);
});

test('switches to the fallback model after a primary timeout', async () => {
  const calls = [];
  const fetchImpl = (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body.model);
    if (body.model === 'primary-model') {
      return new Promise(() => {});
    }
    return Promise.resolve(jsonResponse({
      choices: [{ message: { content: '{"answer":"B"}' } }]
    }));
  };

  const result = await answerQuestion(question, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    primaryModel: 'primary-model',
    fallbackModel: 'backup-model',
    primaryTimeoutMs: 20,
    totalTimeoutMs: 300
  });

  assert.equal(result.code, 1);
  assert.equal(result.answer, 'B');
  assert.equal(result.model, 'backup-model');
  assert.deepEqual(calls, ['primary-model', 'backup-model']);
});

test('uses a separate fallback timeout budget after the primary times out', async () => {
  const calls = [];
  const fetchImpl = (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body.model);
    if (body.model === 'primary-model') return new Promise(() => {});
    return new Promise((resolve) => {
      setTimeout(() => resolve(jsonResponse({
        choices: [{ message: { content: '{"answer":"B"}' } }]
      })), 30);
    });
  };

  const result = await answerQuestion(question, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    primaryModel: 'primary-model',
    fallbackModel: 'backup-model',
    primaryTimeoutMs: 20,
    fallbackTimeoutMs: 100,
    totalTimeoutMs: 200
  });

  assert.equal(result.code, 1);
  assert.equal(result.answer, 'B');
  assert.equal(result.model, 'backup-model');
  assert.deepEqual(calls, ['primary-model', 'backup-model']);
});

test('applies the timeout while reading the upstream response body', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: () => new Promise(() => {})
  });

  const result = await Promise.race([
    answerQuestion(question, {
      fetchImpl,
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      primaryModel: 'primary-model',
      fallbackModel: '',
      primaryTimeoutMs: 20,
      fallbackTimeoutMs: 20,
      totalTimeoutMs: 100
    }),
    new Promise((resolve) => setTimeout(() => resolve('test timeout'), 150))
  ]);

  assert.notEqual(result, 'test timeout');
  assert.equal(result.code, 0);
  assert.match(result.msg, /timeout/u);
});

test('normalizes multiple choice answers to the OCS separator', async () => {
  const fetchImpl = async () => jsonResponse({
    choices: [{ message: { content: '```json\n{"answer":["A","C"]}\n```' } }]
  });

  const result = await answerQuestion({
    title: '请选择正确选项',
    type: 'multiple',
    options: 'A. 一\nB. 二\nC. 三'
  }, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    primaryModel: 'primary-model',
    fallbackModel: 'backup-model',
    primaryTimeoutMs: 100,
    totalTimeoutMs: 500
  });

  assert.equal(result.answer, 'A#C');
});

test('emits request, model, and result logs with elapsed time', async () => {
  const events = [];
  const fetchImpl = async () => jsonResponse({
    choices: [{ message: { content: '{"answer":"B"}' } }]
  });

  const result = await answerQuestion(question, {
    fetchImpl,
    logger: (event) => events.push(event),
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    primaryModel: 'primary-model',
    fallbackModel: 'backup-model',
    primaryTimeoutMs: 100,
    totalTimeoutMs: 500
  });

  assert.equal(result.code, 1);
  assert.deepEqual(events.map((event) => event.type), [
    'question_received',
    'model_started',
    'answer_parsed',
    'answer_received'
  ]);
  assert.equal(events[0].question, '1 + 2 = ?');
  assert.equal(events[0].questionType, 'single');
  assert.equal(events[1].model, 'primary-model');
  assert.equal(events[2].rawAnswer, 'B');
  assert.equal(events[2].answer, 'B');
  assert.equal(events[2].matched, 'yes');
  assert.equal(events[3].answer, 'B');
  assert.equal(typeof events[3].elapsedMs, 'number');
});

test('returns a single-choice letter that exists in the OCS options', async () => {
  const fetchImpl = async () => jsonResponse({
    choices: [{ message: { content: '答案：B。理由：该 SQL 只查询 id 列。' } }]
  });

  const result = await answerQuestion({
    title: '下列 SQL 语句中，只查询 id 列的是？',
    type: 'single',
    options: 'A. SELECT * FROM t\nB. SELECT id FROM t\nC. DELETE FROM t\nD. UPDATE t SET id = 1'
  }, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    primaryTimeoutMs: 100,
    totalTimeoutMs: 500
  });

  assert.equal(result.code, 1);
  assert.equal(result.answer, 'B');
});

test('returns A#C for a multiple-choice question', async () => {
  const fetchImpl = async () => jsonResponse({
    choices: [{ message: { content: '{"answer":"A、C。"}' } }]
  });

  const result = await answerQuestion({
    title: '以下哪些属于关系型数据库？',
    type: 'multiple',
    options: 'A. MySQL\nB. Redis\nC. PostgreSQL\nD. MongoDB'
  }, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    primaryTimeoutMs: 100,
    totalTimeoutMs: 500
  });

  assert.equal(result.answer, 'A#C');
});

test('returns a lettered judgement answer that OCS can select', async () => {
  const fetchImpl = async () => jsonResponse({
    choices: [{ message: { content: '{"answer":true}' } }]
  });

  const result = await answerQuestion({
    title: 'SQL 中 DELETE 语句可以删除表结构。',
    type: 'judge',
    options: 'A. 正确\nB. 错误'
  }, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    primaryTimeoutMs: 100,
    totalTimeoutMs: 500
  });

  assert.equal(result.answer, 'A');
});

test('answers the real OCS letterless-option question with the option text', async () => {
  let prompt = '';
  const fetchImpl = async (url, options) => {
    prompt = JSON.parse(options.body).messages[1].content;
    return jsonResponse({ choices: [{ message: { content: '{"answer":"A"}' } }] });
  };

  const result = await answerQuestion({
    title: '删除表stu内name（名字）为张三的数据，可以使用哪个选项？',
    type: 'single',
    options: "delete from stu where name = '张三'\ndelete from stu \ndelete from stu name = '张三'\ndelete name = '张三'"
  }, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    primaryTimeoutMs: 100,
    totalTimeoutMs: 500
  });

  assert.equal(result.code, 1);
  // 选项没有字母，OCS 按文字匹配，所以要回原文而不是 "A"。
  assert.equal(result.answer, "delete from stu where name = '张三'");
  // 模型仍然要看到带字母序号的选项，否则会直接回选项原文。
  assert.match(prompt, /A\. delete from stu where name = '张三'/u);
  assert.match(prompt, /D\. delete name = '张三'/u);
});

test('answers the real OCS judgement question with 对 or 错', async () => {
  const fetchImpl = async () => jsonResponse({
    choices: [{ message: { content: '{"answer":false}' } }]
  });

  const result = await answerQuestion({
    title: 'AI生成的简历是完美的，不需要检查。（）',
    type: 'judgement',
    options: '对\n错'
  }, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    primaryTimeoutMs: 100,
    totalTimeoutMs: 500
  });

  assert.equal(result.code, 1);
  assert.equal(result.answer, '错');
});

test('does not let a network retry eat the fallback model budget', async () => {
  const starts = [];
  const fetchImpl = (url, options) => {
    const model = JSON.parse(options.body).model;
    starts.push({ model, at: Date.now() });
    if (model === 'primary') {
      return new Promise((_, reject) => {
        setTimeout(() => reject(new TypeError('fetch failed')), 50);
      });
    }
    return new Promise((resolve) => {
      setTimeout(() => resolve(jsonResponse({
        choices: [{ message: { content: '{"answer":"B"}' } }]
      })), 20);
    });
  };

  const began = Date.now();
  const result = await answerQuestion(question, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    primaryModel: 'primary',
    fallbackModel: 'fallback',
    primaryTimeoutMs: 80,
    fallbackTimeoutMs: 400,
    totalTimeoutMs: 800,
    retryNetworkErrors: true
  });

  assert.equal(result.code, 1);
  assert.equal(result.model, 'fallback');
  const fallbackStart = starts.find((entry) => entry.model === 'fallback').at - began;
  // 主模型总共只能占用 80ms 左右的预算，重试不能把它翻倍。
  assert.ok(fallbackStart < 130, `fallback started after ${fallbackStart}ms`);
});

test('retries the same model once when the upstream connection drops', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('fetch failed');
    return jsonResponse({ choices: [{ message: { content: '{"answer":"B"}' } }] });
  };

  const result = await answerQuestion(question, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    primaryTimeoutMs: 200,
    totalTimeoutMs: 600
  });

  assert.equal(result.code, 1);
  assert.equal(result.answer, 'B');
  assert.equal(calls, 2);
});

test('uses the configured reasoning effort for every question', async () => {
  const bodies = [];
  const fetchImpl = async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return jsonResponse({ choices: [{ message: { content: '{"answer":"B"}' } }] });
  };

  const result = await answerQuestion(question, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    reasoningEffort: 'max',
    primaryTimeoutMs: 100,
    totalTimeoutMs: 500
  });

  assert.equal(bodies[0].reasoning_effort, 'max');
  assert.equal(result.reasoningEffort, 'max');
});

test('returns the fastest answer when racing is enabled instead of waiting for the slow primary', async () => {
  const calls = [];
  const fetchImpl = (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body.model);
    if (body.model === 'slow-model') return new Promise(() => {});
    return new Promise((resolve) => {
      setTimeout(() => resolve(jsonResponse({
        choices: [{ message: { content: '{"answer":"B"}' } }]
      })), 20);
    });
  };

  const result = await Promise.race([
    answerQuestion(question, {
      fetchImpl,
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      primaryModel: 'slow-model',
      fallbackModel: 'fast-model',
      race: true,
      primaryTimeoutMs: 500,
      fallbackTimeoutMs: 500,
      totalTimeoutMs: 1000
    }),
    new Promise((resolve) => setTimeout(() => resolve('hung'), 3000))
  ]);

  assert.notEqual(result, 'hung');
  assert.equal(result.code, 1);
  assert.equal(result.answer, 'B');
  assert.equal(result.model, 'fast-model');
  assert.deepEqual(calls.sort(), ['fast-model', 'slow-model']);
});

test('includes the extra model in the race so a faster model can answer', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body.model);
    if (body.model === 'fast-extra') {
      return jsonResponse({ choices: [{ message: { content: '{"answer":"B"}' } }] });
    }
    return new Promise(() => {});
  };

  const result = await answerQuestion(question, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    primaryModel: 'slow-primary',
    fallbackModel: 'slow-fallback',
    extraModels: ['fast-extra'],
    race: true,
    primaryTimeoutMs: 500,
    fallbackTimeoutMs: 500,
    totalTimeoutMs: 1000
  });

  assert.equal(result.code, 1);
  assert.equal(result.model, 'fast-extra');
  assert.deepEqual(calls.sort(), ['fast-extra', 'slow-fallback', 'slow-primary']);
});

test('switches models when the answer letter is not in the OCS options', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body.model);
    return jsonResponse({
      choices: [{ message: { content: body.model === 'primary-model' ? '{"answer":"E"}' : '{"answer":"B"}' } }]
    });
  };

  const result = await answerQuestion(question, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    primaryModel: 'primary-model',
    fallbackModel: 'backup-model',
    primaryTimeoutMs: 100,
    totalTimeoutMs: 500
  });

  assert.equal(result.code, 1);
  assert.equal(result.answer, 'B');
  assert.equal(result.model, 'backup-model');
  assert.deepEqual(calls, ['primary-model', 'backup-model']);
});

test('reports an unmatched answer instead of returning a fake letter', async () => {
  const events = [];
  const fetchImpl = async () => jsonResponse({
    choices: [{ message: { content: '{"answer":"E"}' } }]
  });

  const result = await answerQuestion(question, {
    fetchImpl,
    logger: (event) => events.push(event),
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    primaryModel: 'primary-model',
    fallbackModel: 'backup-model',
    primaryTimeoutMs: 100,
    totalTimeoutMs: 500
  });

  assert.equal(result.code, 0);
  assert.match(result.msg, /does not match the listed options/u);
  assert.equal(events.filter((event) => event.type === 'answer_parsed').every((event) => event.matched === 'no'), true);
});

test('tries the fast model first and gives the next step a longer budget', async () => {
  const started = [];
  const fetchImpl = (url, options) => {
    const body = JSON.parse(options.body);
    started.push({ model: body.model, at: Date.now() });
    if (body.model === 'fast-model') return new Promise(() => {});
    // 强模型需要 120ms 才答完：第一档只给 40ms 会超时，第二档给 600ms 才来得及。
    return new Promise((resolve) => {
      setTimeout(() => resolve(jsonResponse({
        choices: [{ message: { content: '{"answer":"B"}' } }]
      })), 120);
    });
  };

  const began = Date.now();
  const result = await answerQuestion(question, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    chain: [
      { model: 'fast-model', effort: 'medium', timeoutMs: 40 },
      { model: 'strong-model', effort: 'max', timeoutMs: 600 }
    ],
    totalTimeoutMs: 900
  });

  assert.equal(result.code, 1);
  assert.equal(result.model, 'strong-model');
  assert.equal(result.reasoningEffort, 'max');
  assert.deepEqual(started.map((entry) => entry.model), ['fast-model', 'strong-model']);
  const secondStart = started[1].at - began;
  assert.ok(secondStart >= 35, `second step started after ${secondStart}ms`);
});

test('follows the chain instead of guessing a model from the question type', async () => {
  const models = [];
  const fetchImpl = async (url, options) => {
    models.push(JSON.parse(options.body).model);
    return jsonResponse({ choices: [{ message: { content: '{"answer":"A"}' } }] });
  };

  const result = await answerQuestion({
    title: '结合材料分析下列 SQL 语句的执行过程，并推导每一步的结果，说明原因。'.repeat(3),
    type: 'multiple',
    options: 'A. 一\nB. 二\nC. 三\nD. 四\nE. 五\nF. 六'
  }, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    chain: [
      { model: 'fast-model', effort: 'medium', timeoutMs: 500 },
      { model: 'strong-model', effort: 'max', timeoutMs: 500 }
    ],
    totalTimeoutMs: 1000
  });

  assert.equal(result.code, 1);
  // 难度再高也从第一档开始：模型选择只看时间，不看题型。
  assert.deepEqual(models, ['fast-model']);
});

test('lets a global reasoning override replace every step effort', async () => {
  const efforts = [];
  const fetchImpl = async (url, options) => {
    efforts.push(JSON.parse(options.body).reasoning_effort);
    return jsonResponse({ choices: [{ message: { content: '{"answer":"B"}' } }] });
  };

  await answerQuestion(question, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    reasoningEffort: 'max',
    chain: [{ model: 'fast-model', effort: 'low', timeoutMs: 200 }],
    totalTimeoutMs: 500
  });

  assert.deepEqual(efforts, ['max']);
});

test('asks the probe model for difficulty and applies that effort to the answer model', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ model: body.model, effort: body.reasoning_effort, prompt: body.messages[1].content });
    if (body.model === 'probe-model') {
      return jsonResponse({ choices: [{ message: { content: '{"difficulty":"high"}' } }] });
    }
    return jsonResponse({ choices: [{ message: { content: '{"answer":"B"}' } }] });
  };

  const result = await answerQuestion(question, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    probe: { model: 'probe-model', effort: 'minimal', timeoutMs: 500 },
    chain: [{ model: 'answer-model', effort: 'auto', timeoutMs: 500 }],
    totalTimeoutMs: 2000
  });

  assert.equal(result.code, 1);
  assert.equal(result.model, 'answer-model');
  assert.equal(result.reasoningEffort, 'max');
  assert.deepEqual(calls.map((call) => call.model), ['probe-model', 'answer-model']);
  // 探针只判难度，正式作答才真正答题。
  assert.match(calls[0].prompt, /Do not answer it/u);
  assert.equal(calls[1].effort, 'max');
});

test('uses low effort when the probe says the question is easy', async () => {
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.model === 'probe-model') {
      return jsonResponse({ choices: [{ message: { content: '{"difficulty":"low"}' } }] });
    }
    return jsonResponse({ choices: [{ message: { content: '{"answer":"B"}' } }] });
  };

  const result = await answerQuestion(question, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    probe: { model: 'probe-model', effort: 'minimal', timeoutMs: 500 },
    chain: [{ model: 'answer-model', effort: 'auto', timeoutMs: 500 }],
    totalTimeoutMs: 2000
  });

  assert.equal(result.reasoningEffort, 'low');
});

test('falls back to max effort when the probe times out', async () => {
  const efforts = [];
  const fetchImpl = (url, options) => {
    const body = JSON.parse(options.body);
    if (body.model === 'probe-model') return new Promise(() => {});
    efforts.push(body.reasoning_effort);
    return Promise.resolve(jsonResponse({
      choices: [{ message: { content: '{"answer":"B"}' } }]
    }));
  };

  const result = await answerQuestion(question, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    probe: { model: 'probe-model', effort: 'minimal', timeoutMs: 30 },
    chain: [{ model: 'answer-model', effort: 'auto', timeoutMs: 500 }],
    totalTimeoutMs: 2000
  });

  assert.equal(result.code, 1);
  assert.equal(result.reasoningEffort, 'max');
  assert.deepEqual(efforts, ['max']);
});

test('sends question images as multimodal content in the same order', async () => {
  let content = null;
  const fetchImpl = async (url, options) => {
    content = JSON.parse(options.body).messages[1].content;
    return jsonResponse({ choices: [{ message: { content: '{"answer":"A"}' } }] });
  };

  const result = await answerQuestion({
    title: '下列哪个是 [图片1] 表示的运算？',
    type: 'single',
    // OCS 的图片选项通常不带字母前缀，这里按原文匹配。
    options: '[图片1]\n[图片2]',
    images: ['AAAABBBB', 'data:image/jpeg;base64,CCCC']
  }, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    chain: [{ model: 'vision-model', effort: 'medium', timeoutMs: 200 }],
    totalTimeoutMs: 500
  });

  assert.equal(result.code, 1);
  assert.equal(result.answer, '[图片1]');
  assert.ok(Array.isArray(content), '有图时 content 应该是数组');
  assert.equal(content[0].type, 'text');
  assert.match(content[0].text, /\[图片1\]/u);
  assert.match(content[0].text, /1st attached image corresponds to \[图片1\]/u);
  assert.deepEqual(content.slice(1), [
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAABBBB' } },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,CCCC' } }
  ]);
});

test('uses a separate image chain when the question carries images', async () => {
  const models = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    models.push({ model: body.model, withImage: Array.isArray(body.messages[1].content) });
    return jsonResponse({ choices: [{ message: { content: '{"answer":"A"}' } }] });
  };

  const base = {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    chain: [{ model: 'text-model', effort: 'max', timeoutMs: 200 }],
    chainImages: [{ model: 'vision-model', effort: 'medium', timeoutMs: 200 }],
    totalTimeoutMs: 800
  };

  // 无图：走主链
  const plain = await answerQuestion(question, { ...base });
  assert.equal(plain.model, 'text-model');
  assert.equal(models.at(-1).withImage, false);

  // 有图：自动切到图片链，并把图片发出去
  const withImage = await answerQuestion({
    title: '下面哪个是 [图片1]？',
    type: 'single',
    options: '[图片1]\n[图片2]',
    images: ['AAAABBBB']
  }, { ...base });

  assert.equal(withImage.model, 'vision-model');
  assert.equal(withImage.reasoningEffort, 'medium');
  assert.equal(models.at(-1).model, 'vision-model');
  assert.equal(models.at(-1).withImage, true);
});

test('keeps the main chain for images when no image chain is configured', async () => {
  const fetchImpl = async () => jsonResponse({
    choices: [{ message: { content: '{"answer":"A"}' } }]
  });

  const result = await answerQuestion({
    title: '下面哪个是 [图片1]？',
    type: 'single',
    options: '[图片1]\n[图片2]',
    images: ['AAAABBBB']
  }, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    chain: [{ model: 'text-model', effort: 'max', timeoutMs: 200 }],
    totalTimeoutMs: 500
  });

  assert.equal(result.model, 'text-model');
});

test('sends plain text content when the question has no images', async () => {
  let content = null;
  const fetchImpl = async (url, options) => {
    content = JSON.parse(options.body).messages[1].content;
    return jsonResponse({ choices: [{ message: { content: '{"answer":"B"}' } }] });
  };

  await answerQuestion(question, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    chain: [{ model: 'text-model', effort: 'medium', timeoutMs: 200 }],
    totalTimeoutMs: 500
  });

  assert.equal(typeof content, 'string');
  assert.doesNotMatch(content, /attached image/u);
});

test('falls back to the backup model when the primary step fails', async () => {
  const calls = [];
  const fetchImpl = (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ model: body.model, effort: body.reasoning_effort });
    if (body.model === 'strong-model') return new Promise(() => {});
    return Promise.resolve(jsonResponse({
      choices: [{ message: { content: '{"answer":"B"}' } }]
    }));
  };

  const result = await answerQuestion(question, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    chain: [
      { model: 'strong-model', effort: 'max', timeoutMs: 30 },
      { model: 'backup-model', effort: 'medium', timeoutMs: 300 }
    ],
    totalTimeoutMs: 800
  });

  assert.equal(result.code, 1);
  assert.equal(result.model, 'backup-model');
  assert.equal(result.reasoningEffort, 'medium');
  // 备用模型有自己的思考强度和完整预算，不是主模型剩下的时间。
  assert.deepEqual(calls, [
    { model: 'strong-model', effort: 'max' },
    { model: 'backup-model', effort: 'medium' }
  ]);
});

test('reports a clear error when no model is configured', async () => {
  const result = await answerQuestion(question, {
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: '{"answer":"B"}' } }]
    }),
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    chain: [],
    primaryModel: '',
    fallbackModel: '',
    totalTimeoutMs: 500
  });

  assert.equal(result.code, 0);
  assert.match(result.msg, /no model configured/u);
});

test('still answers when the probe returns an unusable reply', async () => {
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.model === 'probe-model') {
      return jsonResponse({ choices: [{ message: { content: 'no idea' } }] });
    }
    return jsonResponse({ choices: [{ message: { content: '{"answer":"B"}' } }] });
  };

  const result = await answerQuestion(question, {
    fetchImpl,
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    probe: { model: 'probe-model', effort: 'minimal', timeoutMs: 500 },
    chain: [{ model: 'answer-model', effort: 'auto', timeoutMs: 500 }],
    totalTimeoutMs: 2000
  });

  assert.equal(result.code, 1);
  assert.equal(result.answer, 'B');
  assert.equal(result.reasoningEffort, 'max');
});


