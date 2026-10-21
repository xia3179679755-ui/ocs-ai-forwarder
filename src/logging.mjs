function clean(value, maxLength = 320) {
  return String(value ?? '')
    .replace(/Bearer\s+[^\s,;]+/giu, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|key)-[A-Za-z0-9_-]{8,}\b/giu, '[REDACTED]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength);
}

function clock(value = new Date()) {
  return value.toLocaleTimeString('zh-CN', { hour12: false });
}

export function formatLogEvent(event = {}) {
  const prefix = `[${clock(event.at ? new Date(event.at) : new Date())}]`;
  switch (event.type) {
    case 'difficulty_probe_started':
      return `${prefix} [探针] 模型=${clean(event.model)} 思考=${clean(event.reasoningEffort)} 超时=${event.timeoutMs}ms 正在判断难度`;
    case 'difficulty_probe':
      return `${prefix} [探针] 模型=${clean(event.model)} 判定难度=${clean(event.level)} → 作答思考强度=${clean(event.effort)} 耗时=${event.elapsedMs}ms`;
    case 'difficulty_probe_failed':
      return `${prefix} [探针] 模型=${clean(event.model)} 判断失败(${clean(event.error)})，改用默认思考强度 耗时=${event.elapsedMs}ms`;
    case 'question_received':
      return `${prefix} [题目] 类型=${clean(event.questionType)} 难度=${clean(event.difficulty)} 链=${clean(event.chain, 200)} 题目=${clean(event.question)}${event.options ? ` 选项=${clean(event.options, 180)}` : ''}`;
    case 'model_started':
      return `${prefix} [请求] 第${event.step ?? 1}/${event.totalSteps ?? 1}档 模型=${clean(event.model)} 思考=${clean(event.reasoningEffort)} 输出上限=${event.maxTokens ?? '-'} 超时=${event.timeoutMs}ms`;
    case 'model_retry':
      return `${prefix} [重试] 模型=${clean(event.model)} 连接中断，立即重发 原因=${clean(event.error)}`;
    case 'model_failed':
      return `${prefix} [失败] 模型=${clean(event.model)} 原因=${clean(event.error)} 耗时=${event.elapsedMs}ms`;
    case 'question_payload':
      return `${prefix} [原始] ${clean(event.payload, 1200)}`;
    case 'answer_parsed':
      return `${prefix} [解析] 模型=${clean(event.model)} 原始=${clean(event.rawAnswer) || '(空)'} 采用=${clean(event.answer) || '(空)'} 选项=${clean(event.optionLetters) || '(无)'} 可匹配=${event.matched === 'yes' ? '是' : '否'}`;
    case 'answer_received':
      return `${prefix} [返回] 题目=${clean(event.question)} 模型=${clean(event.model)} 答案=${clean(event.answer)} 耗时=${event.elapsedMs}ms`;
    case 'answer_failed':
      return `${prefix} [失败] 所有模型均失败 原因=${clean(event.error)} 总耗时=${event.elapsedMs}ms`;
    case 'request_received':
      return `${prefix} [本地] ${clean(event.method)} ${clean(event.url)} 来源=${clean(event.remoteAddress || 'unknown')}`;
    case 'cache_hit':
      return `${prefix} [缓存] 命中同题答案 题目=${clean(event.question)} 答案=${clean(event.answer)} 模型=${clean(event.model)}`;
    case 'request_coalesced':
      return `${prefix} [合并] 同题并发请求复用同一上游结果 题目=${clean(event.question)}`;
    case 'health_check':
      return `${prefix} [状态] 收到健康检查`;
    case 'latency_probe':
      return `${prefix} [探测] ${clean(event.method)} ${clean(event.url)} 延迟测试已接受`;
    case 'request_rejected':
      return `${prefix} [拒绝] ${clean(event.method)} ${clean(event.url)} 原因=${clean(event.error)}${event.question ? ` 题目=${clean(event.question)}` : ''}`;
    case 'server_started': {
      const chain = event.chain
        || [event.primaryModel, event.fallbackModel, ...(event.extraModels ?? [])].filter(Boolean).join(' → ');
      return `${prefix} [启动] OCS 本地转发 http://127.0.0.1:${event.port} 难度探针=${clean(event.probe, 120) || '关闭'} 阶梯链=${clean(chain, 240)} 模式=${event.race ? '并发竞速' : '串行切换'} 总预算=${event.totalTimeoutMs}ms 输出上限=${event.maxTokens ?? '-'}`;
    }
    case 'server_stopped':
      return `${prefix} [停止] OCS 本地转发已停止`;
    default:
      return `${prefix} [日志] ${clean(JSON.stringify(event))}`;
  }
}

export function createConsoleLogger(write = console.log) {
  return (event) => {
    try {
      write(formatLogEvent(event));
    } catch {
      // Logging must never interrupt an answer request.
    }
  };
}
