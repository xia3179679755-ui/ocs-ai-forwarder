import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createServer } from '../src/server.mjs';
import { createAnswerCache } from '../src/cache.mjs';

test('POST /answer returns the OCS response and CORS headers', async (t) => {
  const server = createServer({
    answerer: async (question) => ({
      code: 1,
      question: question.title,
      answer: 'B',
      model: 'test-model',
      reasoningEffort: 'low'
    })
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '1 + 2 = ?', type: 'single', options: 'A. 2\nB. 3' })
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await response.json(), {
    code: 1,
    question: '1 + 2 = ?',
    answer: 'B',
    model: 'test-model',
    reasoningEffort: 'low'
  });
});

test('POST /answer rejects malformed question input', async (t) => {
  const server = createServer({ answerer: async () => ({ code: 1 }) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '', type: 'single', options: '' })
  });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 0);
});

test('logs the request path and malformed question reason', async (t) => {
  const events = [];
  const server = createServer({
    logger: (event) => events.push(event),
    answerer: async () => ({ code: 1 })
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const address = server.address();
  await fetch(`http://127.0.0.1:${address.port}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '', type: 'single', options: '' })
  });

  assert.equal(events[0].type, 'request_received');
  assert.equal(events[0].url, '/answer');
  assert.equal(events.at(-1).type, 'request_rejected');
  assert.equal(events.at(-1).error, 'title is required');
});

test('accepts OCS HEAD latency probes on any path', async (t) => {
  const events = [];
  const server = createServer({ logger: (event) => events.push(event) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/?t=1790800522294`, {
    method: 'HEAD'
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(await response.text(), '');
  assert.equal(events.at(-1).type, 'latency_probe');
});

test('logs the raw question payload so the OCS format can be inspected', async (t) => {
  const events = [];
  const server = createServer({
    logger: (event) => events.push(event),
    answerer: async (question) => ({ code: 1, question: question.title, answer: 'A' })
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const address = server.address();
  await fetch(`http://127.0.0.1:${address.port}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '原始请求记录', type: '是非题', options: 'A. 正确 B. 错误' })
  });

  const payloadEvent = events.find((event) => event.type === 'question_payload');
  assert.ok(payloadEvent);
  assert.equal(payloadEvent.payload, '{"title":"原始请求记录","type":"是非题","options":"A. 正确 B. 错误"}');
});

test('serves a repeated question from cache without calling the model again', async (t) => {
  let calls = 0;
  const events = [];
  const server = createServer({
    logger: (event) => events.push(event),
    cache: createAnswerCache({ ttlMs: 60000 }),
    answerer: async (question) => {
      calls += 1;
      return { code: 1, question: question.title, answer: 'B' };
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const address = server.address();
  const body = JSON.stringify({ title: '缓存题', type: 'single', options: 'A. 一\nB. 二' });
  const post = () => fetch(`http://127.0.0.1:${address.port}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  });

  const first = await (await post()).json();
  const second = await (await post()).json();

  assert.equal(first.answer, 'B');
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
  assert.equal(events.filter((event) => event.type === 'cache_hit').length, 1);
});

test('still caches the answer when the OCS client disconnects before it arrives', async (t) => {
  let calls = 0;
  let release;
  const started = new Promise((resolve) => {
    t.after(() => release?.());
    resolve();
  });
  const server = createServer({
    cache: createAnswerCache({ ttlMs: 60000 }),
    answerer: async (question) => {
      calls += 1;
      await new Promise((resolve) => { release = resolve; });
      return { code: 1, question: question.title, answer: 'A' };
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  await started;

  const address = server.address();
  const body = JSON.stringify({ title: '断线题', type: 'single', options: 'A. 对\nB. 错' });
  const controller = new AbortController();
  const pending = fetch(`http://127.0.0.1:${address.port}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: controller.signal
  }).catch(() => 'aborted');
  await new Promise((resolve) => setTimeout(resolve, 30));
  controller.abort();
  await pending;
  release();
  await new Promise((resolve) => setTimeout(resolve, 60));

  const retry = await fetch(`http://127.0.0.1:${address.port}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  });

  assert.equal((await retry.json()).answer, 'A');
  assert.equal(calls, 1);
});

test('coalesces duplicate answer requests while one answer is in flight', async (t) => {
  let calls = 0;
  let release;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const server = createServer({
    answerer: async (question) => {
      calls += 1;
      markStarted();
      await new Promise((resolve) => { release = resolve; });
      return { code: 1, question: question.title, answer: 'A' };
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const address = server.address();
  const request = () => fetch(`http://127.0.0.1:${address.port}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '重复题', type: 'single', options: 'A. 正确\nB. 错误' })
  });
  const first = request();
  await started;
  const second = request();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls, 1);
  release();

  const responses = await Promise.all([first, second]);
  assert.deepEqual(await Promise.all(responses.map((response) => response.json())), [
    { code: 1, question: '重复题', answer: 'A' },
    { code: 1, question: '重复题', answer: 'A' }
  ]);
});
