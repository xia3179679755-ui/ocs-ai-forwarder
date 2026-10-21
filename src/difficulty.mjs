const COMPLEXITY_SIGNALS = [
  { pattern: /计算|求解|推导|证明|分析|比较|综合|原因|过程|同时成立|多步骤/u, weight: 1 },
  { pattern: /[=+\-*/^√%]/u, weight: 1 },
  { pattern: /代码|函数|SQL|正则|算法|程序/u, weight: 1 },
  { pattern: /以下说法|下列.*正确|材料|情境/u, weight: 1 }
];

export function classifyQuestion(input = {}) {
  const title = String(input.title ?? '').trim();
  const type = String(input.type ?? '').trim().toLowerCase();
  const options = String(input.options ?? '').trim();
  const optionCount = options ? options.split(/\r?\n/u).filter(Boolean).length : 0;
  const signals = [];
  let score = 0;

  if (type === 'multiple' || type === 'completion') {
    score += 2;
    signals.push('question type needs more reasoning');
  }
  if (title.length > 160) {
    score += 2;
    signals.push('long question');
  } else if (title.length > 80) {
    score += 1;
    signals.push('medium length question');
  }
  if (options.length > 400) {
    score += 1;
    signals.push('long options');
  }
  if (optionCount >= 6) {
    score += 1;
    signals.push('many options');
  }
  for (const signal of COMPLEXITY_SIGNALS) {
    if (signal.pattern.test(title) || signal.pattern.test(options)) {
      score += signal.weight;
      signals.push(signal.pattern.source);
    }
  }

  const level = score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';
  return {
    level,
    reasoningEffort: level,
    score,
    signals
  };
}
