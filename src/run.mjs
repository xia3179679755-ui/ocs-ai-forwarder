import fs from 'node:fs';
import path from 'node:path';

import { createServer } from './server.mjs';
import { answerQuestion } from './gateway.mjs';
import { loadConfig } from './config.mjs';
import { createConsoleLogger } from './logging.mjs';
import { createAnswerCache } from './cache.mjs';

const config = loadConfig();

// 日志同时写进终端和 logs 目录，关掉窗口也不会丢。
let logFile = '';
let appendToFile = () => {};
try {
  const logDir = path.resolve('logs');
  fs.mkdirSync(logDir, { recursive: true });
  logFile = path.join(logDir, `${new Date().toISOString().slice(0, 10)}.log`);
  appendToFile = (line) => fs.appendFileSync(logFile, `${line}\n`);
} catch {
  logFile = '';
}

const logger = createConsoleLogger((line) => {
  console.log(line);
  try {
    appendToFile(line);
  } catch {
    // 写文件失败不能影响答题。
  }
});

// 上游并发会互相拖慢：实测同一道题单独跑 11.9s 就出结果，两道题同时进来时
// 65s 都超时。OCS 侧关掉并发就不需要它；万一关不干净，可用 MOLLY_SERIALIZE=1 强制排队。
let upstreamQueue = Promise.resolve();
const runAnswer = (question) => answerQuestion(question, { ...config, logger });
const answerer = config.serialize
  ? (question) => {
    const run = upstreamQueue.then(() => runAnswer(question), () => runAnswer(question));
    upstreamQueue = run.then(() => {}, () => {});
    return run;
  }
  : runAnswer;

const cache = config.cacheTtlMs > 0 ? createAnswerCache({ ttlMs: config.cacheTtlMs }) : null;

const server = createServer({ logger, cache, answerer });

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger({
      type: 'request_rejected',
      method: 'STARTUP',
      url: `127.0.0.1:${config.port}`,
      error: '端口已被占用，可能已经有一个转发服务在运行。请先关闭旧的窗口。'
    });
  } else {
    logger({ type: 'request_rejected', method: 'STARTUP', url: 'server', error: error.message });
  }
  process.exit(1);
});

server.listen(config.port, '127.0.0.1', () => {
  logger({
    type: 'server_started',
    port: config.port,
    chain: config.chain.map((step) => `${step.model}/${step.effort}/${step.timeoutMs}ms`).join(' → '),
    probe: config.probe ? `${config.probe.model}/${config.probe.effort}/${config.probe.timeoutMs}ms` : '',
    primaryModel: config.primaryModel,
    fallbackModel: config.fallbackModel,
    extraModels: config.extraModels,
    race: config.race,
    primaryTimeoutMs: config.primaryTimeoutMs,
    fallbackTimeoutMs: config.fallbackTimeoutMs,
    totalTimeoutMs: config.totalTimeoutMs,
    maxTokens: config.maxTokens,
    cacheTtlMs: config.cacheTtlMs
  });
  if (logFile) console.log(`日志文件：${logFile}`);
  if (!config.apiKey) logger({ type: 'request_rejected', method: 'STARTUP', url: '.env', error: 'MOLLY_API_KEY is not configured' });
  if (!config.baseUrl) logger({ type: 'request_rejected', method: 'STARTUP', url: '.env', error: 'MOLLY_BASE_URL is not configured' });
  if (!config.chain.length) {
    logger({
      type: 'request_rejected',
      method: 'STARTUP',
      url: '.env',
      error: 'MOLLY_CHAIN 未配置。请在 .env 里至少填写一个模型，格式 = 模型名:思考强度:超时毫秒'
    });
  }
});

function shutdown() {
  server.close(() => {
    logger({ type: 'server_stopped' });
    process.exit(0);
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
