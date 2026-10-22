import http from 'node:http';

import { answerQuestion, validateQuestion } from './gateway.mjs';

// 题目里可能带 base64 图片，1MB 根本不够，直接放到 20MB。
const MAX_BODY_BYTES = 20 * 1024 * 1024;

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,HEAD,POST,OPTIONS',
    'access-control-allow-origin': '*',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  response.end(body);
}

function sendEmpty(response, statusCode = 200) {
  response.writeHead(statusCode, {
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,HEAD,POST,OPTIONS',
    'access-control-allow-origin': '*',
    'content-length': '0'
  });
  response.end();
}

function questionKey(question) {
  return JSON.stringify([
    String(question.title ?? '').trim(),
    String(question.type ?? '').trim().toLowerCase(),
    String(question.options ?? '').replace(/\r\n?/gu, '\n').trim()
  ]);
}

// 图片是 base64，直接进日志会刷屏，这里只记数量和体积。
function payloadForLog(question) {
  const images = Array.isArray(question.images) ? question.images : null;
  if (!images) return JSON.stringify(question);
  const bytes = images.reduce((sum, item) => sum + String(item ?? '').length, 0);
  return JSON.stringify({
    ...question,
    images: `[${images.length} 张, 约 ${Math.round(bytes / 1024)} KB]`
  });
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body is too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('request body must be valid JSON');
  }
}

export function createServer({ answerer = answerQuestion, logger, cache = null } = {}) {
  const pendingAnswers = new Map();

  return http.createServer(async (request, response) => {
    if (typeof logger === 'function') {
      logger({
        type: 'request_received',
        method: request.method,
        url: request.url,
        remoteAddress: request.socket.remoteAddress
      });
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'GET,HEAD,POST,OPTIONS',
        'access-control-allow-origin': '*'
      });
      response.end();
      return;
    }
    if (request.method === 'HEAD') {
      logger?.({ type: 'latency_probe', method: request.method, url: request.url });
      sendEmpty(response);
      return;
    }
    if (request.method === 'GET' && request.url === '/health') {
      logger?.({ type: 'health_check' });
      sendJson(response, 200, { ok: true, service: 'ocs-ai-forwarder' });
      return;
    }
    if (request.method !== 'POST' || request.url !== '/answer') {
      logger?.({ type: 'request_rejected', method: request.method, url: request.url, error: 'not found' });
      sendJson(response, 404, { code: 0, msg: 'not found' });
      return;
    }

    try {
      const question = await readJson(request);
      const validationError = validateQuestion(question);
      if (validationError) {
        logger?.({
          type: 'request_rejected',
          method: request.method,
          url: request.url,
          error: validationError,
          question: question && typeof question === 'object' ? question.title : undefined
        });
        sendJson(response, 400, { code: 0, msg: validationError });
        return;
      }
      logger?.({
        type: 'question_payload',
        method: request.method,
        url: request.url,
        payload: payloadForLog(question)
      });
      const key = questionKey(question);

      const cached = cache?.get(key);
      if (cached) {
        logger?.({
          type: 'cache_hit',
          method: request.method,
          url: request.url,
          question: question.title,
          answer: cached.answer,
          model: cached.model
        });
        sendJson(response, 200, cached);
        return;
      }

      let pending = pendingAnswers.get(key);
      if (!pending) {
        // 即使 OCS 提前断开，这里也会继续算完并写入缓存，重试时直接命中。
        pending = Promise.resolve()
          .then(() => answerer(question))
          .then((result) => {
            if (result && result.code === 1) cache?.set(key, result);
            return result;
          });
        pendingAnswers.set(key, pending);
        pending.then(
          () => {
            if (pendingAnswers.get(key) === pending) pendingAnswers.delete(key);
          },
          () => {
            if (pendingAnswers.get(key) === pending) pendingAnswers.delete(key);
          }
        );
      } else {
        logger?.({
          type: 'request_coalesced',
          method: request.method,
          url: request.url,
          question: question.title
        });
      }
      const result = await pending;
      sendJson(response, 200, result);
    } catch (error) {
      logger?.({ type: 'request_rejected', method: request.method, url: request.url, error: error.message });
      sendJson(response, 400, { code: 0, msg: error.message });
    }
  });
}
