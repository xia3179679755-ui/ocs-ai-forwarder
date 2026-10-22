import fs from 'node:fs';
import path from 'node:path';

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || match[1].startsWith('#')) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function numberValue(value, fallback, minimum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

// 阶梯链：每档写成 "模型:思考强度:超时毫秒"，用逗号分隔，可以写任意多档。
// 第一档失败或超时就自动切到下一档，所以第二档就是备用模型。
// 思考强度写 auto 表示按难度探针的结果自动选择。
// 不预设任何模型名，模型必须由使用者在自己的 .env 里配置。
function parseStep(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const [model = '', effort = '', timeout = ''] = text.split(':').map((part) => part.trim());
  if (!model) return null;
  return {
    model,
    effort: effort || 'medium',
    timeoutMs: numberValue(timeout, 20000, 100)
  };
}

function parseChain(value) {
  const text = String(value ?? '').trim();
  const steps = text
    .split(',')
    .map((item) => parseStep(item))
    .filter(Boolean);
  return steps;
}

// 带图题目单独一条链：实测并非每个模型都接受图片输入，
// 有的会在收到 image_url 后直接断开连接。
function parseChainImages(value, fallback) {
  const steps = parseChain(value);
  return steps.length ? steps : fallback;
}

export function loadConfig(env = process.env, envFile = path.resolve(process.cwd(), '.env')) {
  const fileValues = parseEnvFile(envFile);
  const values = { ...fileValues, ...env };
  const chain = parseChain(values.MOLLY_CHAIN);

  return {
    // 题目带图片时改用这条链（留空则复用主链）。
    chainImages: parseChainImages(values.MOLLY_CHAIN_IMAGES, []),
    apiKey: String(values.MOLLY_API_KEY ?? '').trim(),
    // 留空时必须由使用者在 .env 配置，代码里不预设任何具体服务商地址。
    baseUrl: String(values.MOLLY_BASE_URL ?? '').replace(/\/+$/u, ''),
    chatPath: String(values.MOLLY_CHAT_PATH ?? '/chat/completions'),
    // 阶梯链是唯一的调度来源：谁先跑、思考多深、等多久，全由它决定。
    chain,
    // 难度探针：先用快模型判断这题该想多深，再让正式模型按深度作答。
    // 写成 "模型:思考强度:超时毫秒"，留空表示关闭探针。
    probe: parseStep(values.MOLLY_PROBE),
    primaryModel: chain[0]?.model ?? '',
    fallbackModel: chain[1]?.model ?? chain[0]?.model ?? '',
    primaryTimeoutMs: chain[0]?.timeoutMs ?? 0,
    fallbackTimeoutMs: chain[1]?.timeoutMs ?? chain[0]?.timeoutMs ?? 0,
    extraModels: String(values.MOLLY_EXTRA_MODELS ?? '')
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean),
    race: String(values.MOLLY_RACE ?? '0') !== '0',
    // 1=把上游请求排成一条队（OCS 关不掉并发时用），0=不排队（默认，最快）。
    serialize: String(values.MOLLY_SERIALIZE ?? '0') !== '0',
    // 非空则强制所有档位使用这个思考强度；留空表示按链上每档自己的设置（auto 则看探针结果）。
    reasoningEffort: String(values.MOLLY_REASONING_EFFORT ?? '').trim(),
    // 总预算要装得下探针 + 每一档作答，并留出余量。
    totalTimeoutMs: numberValue(values.TOTAL_TIMEOUT_MS, 150000, 1000),
    maxTokens: numberValue(values.MOLLY_MAX_TOKENS, 64, 8),
    // 同题答案缓存时长：OCS 超时重试时可秒回，不再重复消耗 token。
    cacheTtlMs: numberValue(values.MOLLY_CACHE_TTL_MS, 30 * 60 * 1000, 0),
    port: numberValue(values.PORT, 8765, 1)
  };
}
