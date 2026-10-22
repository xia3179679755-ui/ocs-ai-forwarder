import { classifyQuestion } from './difficulty.mjs';
import { alignAnswerToOptions, extractAnswer, parseOptions } from './response.mjs';

// 探针只回答「该想多深」，正式作答的模型按这个深度设置 reasoning_effort。
const EFFORT_BY_LEVEL = { low: 'low', medium: 'medium', high: 'max' };
const SYSTEM_PROMPT = 'You are a reliable quiz answer extraction engine.';

function endpointFor(config) {
  return `${config.baseUrl.replace(/\/+$/u, '')}/${String(config.chatPath).replace(/^\/+/, '')}`;
}

function emitLog(logger, event) {
  if (typeof logger !== 'function') return;
  try {
    logger({ ...event, at: new Date().toISOString() });
  } catch {
    // Logging must never interrupt an answer request.
  }
}

// OCS 有时不发送选项字母，这里统一补成 A/B/C/D，模型才会稳定回答字母。
function optionBlock(question) {
  const entries = parseOptions(question.options);
  if (entries.length >= 2) return entries.map((entry) => `${entry.letter}. ${entry.text}`).join('\n');
  return String(question.options ?? '').trim() || '(none)';
}

// OCS 新版会把题目里的图片抽出来单独传，题干里留下 [图片1] 这样的占位符。
// 这里统一补成 data URL，顺序与占位符编号一一对应。
function imageEntries(question) {
  const list = Array.isArray(question.images) ? question.images : [];
  return list
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .map((data) => (/^data:/iu.test(data) ? data : `data:image/png;base64,${data}`));
}

function questionPrompt(question, difficulty, imageCount = 0) {
  const lines = [
    'Answer the question accurately.',
    'Return only a JSON object with this exact shape: {"answer":"..."}.',
    'The answer must be the option letter only, for example "B".',
    'Do not include markdown, explanations, option text, or extra fields.',
    'For multiple choice, join option letters with #, for example A#C.',
    `Question type: ${question.type || 'unknown'}`,
    `Difficulty level: ${difficulty.level}`,
    `Question: ${question.title}`,
    `Options:\n${optionBlock(question)}`
  ];
  if (imageCount > 0) {
    lines.push(
      `The question and options use [图片N] placeholders. ${imageCount} image(s) are attached below in order:`,
      'the 1st attached image corresponds to [图片1], the 2nd to [图片2], and so on.'
    );
  }
  return lines.join('\n');
}

// 有图时按 OpenAI 兼容的多模态格式发送：文字一段，图片依次追加。
function userContent(text, images) {
  if (!images.length) return text;
  return [
    { type: 'text', text },
    ...images.map((url) => ({ type: 'image_url', image_url: { url } }))
  ];
}

// 探针不答题，只判断这题需要多深的思考，输出越短越省时间。
function probePrompt(question) {
  return [
    'Judge how much reasoning this question needs. Do not answer it.',
    'Return only JSON, one of: {"difficulty":"low"} {"difficulty":"medium"} {"difficulty":"high"}',
    'low = 常识、直接事实、是非判断；medium = 需要比较或一步计算；high = 多步推理、计算、代码或算法。',
    `Question: ${question.title}`,
    `Options:\n${optionBlock(question)}`
  ].join('\n');
}

function parseDifficulty(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return '';
  const match = content.match(/\b(low|medium|high)\b/iu);
  return match ? match[1].toLowerCase() : '';
}

// 把配置展开成一条可执行的阶梯：每档自带模型、思考强度和超时预算。
// 前档超时才轮到后档，任何时刻只有一个请求在跑，token 只花一份。
function resolveChain(config, difficulty, autoEffort) {
  const forced = String(config.reasoningEffort ?? '').trim();
  const fallbackAuto = autoEffort || 'max';
  const raw = Array.isArray(config.chain) && config.chain.length
    ? config.chain
    : [
      { model: config.primaryModel, effort: '', timeoutMs: config.primaryTimeoutMs },
      { model: config.fallbackModel, effort: '', timeoutMs: config.fallbackTimeoutMs }
    ];

  const chain = [];
  for (const step of raw) {
    const model = String(step?.model ?? '').trim();
    if (!model || chain.some((entry) => entry.model === model)) continue;
    const own = String(step?.effort ?? '').trim();
    chain.push({
      model,
      effort: forced || (own === 'auto' ? fallbackAuto : own) || difficulty.reasoningEffort,
      timeoutMs: Number(step?.timeoutMs) > 0 ? Number(step.timeoutMs) : config.fallbackTimeoutMs
    });
  }
  // 额外模型接在链尾，沿用最后一档的预算，保证越往后等得越久。
  for (const model of config.extraModels ?? []) {
    const name = String(model ?? '').trim();
    if (!name || chain.some((entry) => entry.model === name)) continue;
    chain.push({
      model: name,
      effort: forced || fallbackAuto,
      timeoutMs: chain.at(-1)?.timeoutMs ?? config.fallbackTimeoutMs
    });
  }
  return chain;
}

async function fetchJsonWithTimeout(fetchImpl, url, requestOptions, timeoutMs, externalSignal) {
  const timeoutController = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);
  const signal = externalSignal
    ? AbortSignal.any([timeoutController.signal, externalSignal])
    : timeoutController.signal;

  const request = Promise.resolve()
    .then(async () => {
      const response = await fetchImpl(url, { ...requestOptions, signal });
      if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
      return response.json();
    });
  // 竞速失败的一方会被丢弃，这里先吞掉它的 rejection，避免未处理异常。
  request.catch(() => {});

  const timeout = new Promise((_, reject) => {
    timeoutController.signal.addEventListener('abort', () => {
      const error = new Error(timedOut ? 'request timed out' : 'request cancelled');
      error.name = timedOut ? 'AbortError' : 'CancelError';
      reject(error);
    }, { once: true });
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function validateQuestion(question) {
  if (!question || typeof question !== 'object') return 'request body must be an object';
  if (!String(question.title ?? '').trim()) return 'title is required';
  if (!String(question.type ?? '').trim()) return 'type is required';
  return '';
}

export async function answerQuestion(question, options = {}) {
  const validationError = validateQuestion(question);
  if (validationError) return { code: 0, msg: validationError };

  const config = {
    apiKey: '',
    baseUrl: '',
    chatPath: '/chat/completions',
    chain: [],
    probe: null,
    // 占位名，真实模型必须由调用方通过 chain 传入，避免把具体模型写进代码。
    primaryModel: 'test-model',
    fallbackModel: 'test-backup',
    extraModels: [],
    race: false,
    reasoningEffort: '',
    retryNetworkErrors: true,
    primaryTimeoutMs: 90000,
    fallbackTimeoutMs: 30000,
    totalTimeoutMs: 150000,
    maxTokens: 64,
    ...options
  };
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { code: 0, msg: 'fetch is unavailable' };
  if (!config.apiKey) return { code: 0, msg: 'MOLLY_API_KEY is not configured' };

  // 本地规则算出的难度只作为提示写进 prompt，不参与选模型。
  const difficulty = classifyQuestion(question);

  const startedAt = Date.now();
  const failures = [];
  const controller = new AbortController();
  let winner = null;
  let markWinner;
  const winnerSignal = new Promise((resolve) => {
    markWinner = resolve;
  });

  // 连接被上游中断（fetch failed）不等于模型答不出来，立刻重发一次往往就好了。
  const isNetworkError = (error) => error?.name === 'TypeError'
    || /fetch failed|socket|ECONN|other side closed|terminated/iu.test(String(error?.message ?? ''));

  // content 可以是纯文本，也可以是多模态的 [{type:'text'},{type:'image_url'}] 数组。
  const callUpstream = (model, effort, content, maxTokens, timeoutMs) => fetchJsonWithTimeout(
    fetchImpl,
    endpointFor(config),
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        reasoning_effort: effort,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content }
        ]
      })
    },
    timeoutMs,
    controller.signal
  );

  const images = imageEntries(question);

  // 第一步：让快模型用最低思考档判断这题该想多深，只花几秒。
  let autoEffort = '';
  let probeLevel = '';
  if (config.probe?.model) {
    const remaining = config.totalTimeoutMs - (Date.now() - startedAt);
    const timeoutMs = Math.min(config.probe.timeoutMs, remaining);
    emitLog(config.logger, {
      type: 'difficulty_probe_started',
      model: config.probe.model,
      reasoningEffort: config.probe.effort,
      timeoutMs
    });
    try {
      const payload = await callUpstream(
        config.probe.model,
        config.probe.effort,
        probePrompt(question),
        24,
        timeoutMs
      );
      probeLevel = parseDifficulty(payload);
      autoEffort = EFFORT_BY_LEVEL[probeLevel] || '';
      emitLog(config.logger, {
        type: 'difficulty_probe',
        model: config.probe.model,
        level: probeLevel || '(unknown)',
        effort: autoEffort || '(fallback max)',
        elapsedMs: Date.now() - startedAt
      });
    } catch (error) {
      const reason = error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error));
      emitLog(config.logger, {
        type: 'difficulty_probe_failed',
        model: config.probe.model,
        error: reason,
        elapsedMs: Date.now() - startedAt
      });
    }
  }

  // 第二步：按探针给出的深度，让正式模型作答。
  // 带图题目走专门的链：不是所有模型都接受图片输入。
  const useImageChain = images.length > 0 && Array.isArray(config.chainImages) && config.chainImages.length > 0;
  const chain = resolveChain(
    useImageChain ? { ...config, chain: config.chainImages } : config,
    difficulty,
    autoEffort
  );
  if (!chain.length) return { code: 0, msg: 'no model configured' };

  emitLog(config.logger, {
    type: 'question_received',
    question: String(question.title),
    questionType: String(question.type),
    options: String(question.options ?? ''),
    difficulty: probeLevel || difficulty.level,
    images: images.length,
    imageChain: useImageChain ? 'yes' : 'no',
    chain: chain.map((step) => `${step.model}/${step.effort}/${step.timeoutMs}ms`).join(' → '),
    models: chain.map((step) => step.model).join(','),
    model: chain[0].model,
    reasoningEffort: chain[0].effort,
    timeoutMs: chain[0].timeoutMs,
    race: config.race ? 'yes' : 'no'
  });

  const requestWithRetry = async (step, timeoutMs) => {
    const maxAttempts = config.retryNetworkErrors ? 2 : 1;
    // 重试不能吃掉这个模型的预算，否则下一档会被挤到没有时间。
    const modelDeadline = Date.now() + timeoutMs;
    let lastError;
    for (let index = 0; index < maxAttempts; index += 1) {
      const remaining = Math.min(
        modelDeadline - Date.now(),
        config.totalTimeoutMs - (Date.now() - startedAt)
      );
      if (remaining <= 0) break;
      try {
        return await callUpstream(
          step.model,
          step.effort,
          // 图片随题发送，占位符顺序与 images 数组一一对应。
          userContent(questionPrompt(question, difficulty, images.length), images),
          config.maxTokens,
          remaining
        );
      } catch (error) {
        lastError = error;
        if (winner || error?.name === 'CancelError') throw error;
        if (!isNetworkError(error) || index + 1 >= maxAttempts) throw error;
        emitLog(config.logger, {
          type: 'model_retry',
          model: step.model,
          error: error.message,
          elapsedMs: Date.now() - startedAt
        });
      }
    }
    throw lastError ?? new Error('total timeout reached');
  };

  const attempt = async (step, index) => {
    const remaining = config.totalTimeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) throw new Error('total timeout reached');
    // 每一档用自己的预算：前档超时后，后档还能拿到完整的等待时间。
    const timeoutMs = Math.min(step.timeoutMs, remaining);
    emitLog(config.logger, {
      type: 'model_started',
      model: step.model,
      step: index + 1,
      totalSteps: chain.length,
      reasoningEffort: step.effort,
      maxTokens: config.maxTokens,
      timeoutMs
    });

    try {
      const payload = await requestWithRetry(step, timeoutMs);

      if (winner) return winner;

      const rawAnswer = extractAnswer(payload, question.type);
      const answer = alignAnswerToOptions(rawAnswer, question);
      const optionLetters = parseOptions(question.options).map((entry) => entry.letter).join(',');
      emitLog(config.logger, {
        type: 'answer_parsed',
        question: String(question.title),
        model: step.model,
        rawAnswer,
        answer,
        optionLetters,
        matched: answer ? 'yes' : 'no'
      });
      if (!answer) {
        throw new Error(
          `answer ${JSON.stringify(rawAnswer)} does not match the listed options [${optionLetters || 'none'}]`
        );
      }

      winner = { model: step.model, answer, effort: step.effort };
      emitLog(config.logger, {
        type: 'answer_received',
        question: String(question.title),
        model: step.model,
        answer,
        elapsedMs: Date.now() - startedAt
      });
      markWinner(winner);
      // 已经有答案，取消其它还在跑的模型，避免继续计费。
      controller.abort();
      return winner;
    } catch (error) {
      if (winner) return winner;
      if (error?.name === 'CancelError') throw error;
      const reason = error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error));
      failures.push(`${step.model}: ${reason}`);
      emitLog(config.logger, {
        type: 'model_failed',
        model: step.model,
        error: reason,
        elapsedMs: Date.now() - startedAt
      });
      throw error;
    }
  };

  if (config.race && chain.length > 1) {
    // 竞速：全部同时发起，第一个给出可用答案的模型胜出。
    const racers = chain.map((step, index) => attempt(step, index).catch(() => {}));
    await Promise.race([winnerSignal, Promise.all(racers)]);
  } else {
    for (const [index, step] of chain.entries()) {
      try {
        await attempt(step, index);
      } catch {
        // 串行模式下继续尝试下一档。
      }
      if (winner) break;
    }
  }

  if (winner) {
    return {
      code: 1,
      question: String(question.title),
      answer: winner.answer,
      model: winner.model,
      reasoningEffort: winner.effort
    };
  }

  const message = failures.length ? failures.join('; ') : 'answer request timed out';
  emitLog(config.logger, {
    type: 'answer_failed',
    error: message,
    elapsedMs: Date.now() - startedAt
  });
  return {
    code: 0,
    question: String(question.title),
    msg: message
  };
}

export { validateQuestion };
