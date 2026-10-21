import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.mjs';

const NO_ENV_FILE = 'C:\\path\\that\\does\\not\\exist\\.env';

test('loads the escalating chain from MOLLY_CHAIN', () => {
  const config = loadConfig({
    MOLLY_API_KEY: 'secret',
    MOLLY_BASE_URL: 'https://api.example.test/v1/',
    MOLLY_CHAIN: 'fast-model:low:5000,strong-model:max:60000',
    TOTAL_TIMEOUT_MS: '70000',
    MOLLY_MAX_TOKENS: '96',
    MOLLY_CACHE_TTL_MS: '600000',
    PORT: '9876'
  }, NO_ENV_FILE);

  assert.deepEqual(config.chain, [
    { model: 'fast-model', effort: 'low', timeoutMs: 5000 },
    { model: 'strong-model', effort: 'max', timeoutMs: 60000 }
  ]);
  assert.equal(config.apiKey, 'secret');
  assert.equal(config.baseUrl, 'https://api.example.test/v1');
  assert.equal(config.totalTimeoutMs, 70000);
  assert.equal(config.maxTokens, 96);
  assert.equal(config.cacheTtlMs, 600000);
  assert.equal(config.port, 9876);
});

test('has no built-in model names, so the chain must be configured', () => {
  const config = loadConfig({}, NO_ENV_FILE);

  // 代码里不预设任何模型，避免把具体的模型名写进仓库。
  assert.deepEqual(config.chain, []);
  assert.equal(config.probe, null);
});

test('treats the second step as the backup model with its own timeout', () => {
  const config = loadConfig({
    MOLLY_CHAIN: 'strong-model:max:90000,fast-model:medium:30000'
  }, NO_ENV_FILE);

  assert.deepEqual(config.chain, [
    { model: 'strong-model', effort: 'max', timeoutMs: 90000 },
    { model: 'fast-model', effort: 'medium', timeoutMs: 30000 }
  ]);
  assert.equal(config.primaryModel, 'strong-model');
  assert.equal(config.fallbackModel, 'fast-model');
  assert.equal(config.primaryTimeoutMs, 90000);
  assert.equal(config.fallbackTimeoutMs, 30000);
});

test('parses the difficulty probe from MOLLY_PROBE', () => {
  const config = loadConfig({
    MOLLY_PROBE: 'fast-model:minimal:12000',
    MOLLY_CHAIN: 'strong-model:auto:90000'
  }, NO_ENV_FILE);

  assert.deepEqual(config.probe, { model: 'fast-model', effort: 'minimal', timeoutMs: 12000 });
  assert.deepEqual(config.chain, [{ model: 'strong-model', effort: 'auto', timeoutMs: 90000 }]);
});

test('supports a single-step chain without a backup model', () => {
  const config = loadConfig({ MOLLY_CHAIN: 'fast-model:medium:15000' }, NO_ENV_FILE);

  assert.deepEqual(config.chain, [{ model: 'fast-model', effort: 'medium', timeoutMs: 15000 }]);
  assert.equal(config.primaryModel, 'fast-model');
  assert.equal(config.fallbackModel, 'fast-model');
  assert.equal(config.primaryTimeoutMs, 15000);
});

test('drops empty chain segments and fills in a default effort', () => {
  const config = loadConfig({ MOLLY_CHAIN: ' , fast-model , strong-model:max:30000 ,' }, NO_ENV_FILE);

  assert.deepEqual(config.chain, [
    { model: 'fast-model', effort: 'medium', timeoutMs: 20000 },
    { model: 'strong-model', effort: 'max', timeoutMs: 30000 }
  ]);
});

test('keeps a strict sequential chain with an empty global reasoning override', () => {
  const config = loadConfig({}, NO_ENV_FILE);

  assert.equal(config.race, false);
  assert.deepEqual(config.extraModels, []);
  // 留空表示每档用自己的思考强度，不做全局强制。
  assert.equal(config.reasoningEffort, '');
});

test('keeps the answer short so slow upstream replies still land inside the timeout', () => {
  const config = loadConfig({}, NO_ENV_FILE);

  assert.equal(config.maxTokens, 64);
  // 总预算要装得下探针 + 主模型 90s + 备用模型 30s。
  assert.equal(config.totalTimeoutMs, 150000);
});
