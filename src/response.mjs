function stripCodeFence(value) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim();
}

function contentFromPayload(payload) {
  const messageContent = payload?.choices?.[0]?.message?.content;
  if (messageContent !== undefined) return messageContent;
  const textContent = payload?.choices?.[0]?.text;
  if (textContent !== undefined) return textContent;
  if (payload?.output_text !== undefined) return payload.output_text;
  return payload;
}

function answerFromValue(value) {
  if (Array.isArray(value)) return value.flat(Infinity).map((item) => String(item).trim()).filter(Boolean).join('#');
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  return '';
}

function normalizedType(type) {
  return String(type ?? '').trim().toLowerCase();
}

const MULTIPLE_TYPES = new Set([
  'multiple', 'multi', 'multiple-choice', 'multiple_choice',
  '多选', '多选题', '多项选择', '多项选择题', '不定项', '不定项选择', '不定项选择题', '复选', '复选题'
]);

const JUDGE_TYPES = new Set([
  'judge', 'judgement', 'judgment', 'true-false', 'true_false',
  '判断', '判断题', '是非', '是非题', '对错', '对错题', '正误', '正误题'
]);

function isMultipleType(type) {
  return MULTIPLE_TYPES.has(normalizedType(type));
}

function isJudgeType(type) {
  return JUDGE_TYPES.has(normalizedType(type));
}

function cleanAnswerText(value) {
  return answerFromValue(value)
    .normalize('NFKC')
    .replace(/^(?:最终|正确)?(?:答案|answer|选项)\s*(?:是|为|应为|应该是)?\s*[:：=]?\s*/iu, '')
    .trim();
}

function choicePrefix(text) {
  return text.match(/^[A-Za-z](?:(?:\s*#\s*|\s*[,，、/;]\s*|\s+(?:and|和)\s+|\s+)[A-Za-z])*/iu)?.[0] ?? '';
}

function normalizeChoiceAnswer(value, multiple) {
  const text = cleanAnswerText(value);
  const prefix = choicePrefix(text);
  // Keep the raw text so the caller can still align it against the option texts.
  if (!prefix) return text.slice(0, 80);
  const letters = prefix.match(/[A-Za-z]/gu)?.map((letter) => letter.toUpperCase()) ?? [];
  if (!letters.length) return text.slice(0, 80);
  if (multiple && letters.length > 1) return [...new Set(letters)].join('#');
  return letters[0];
}

function normalizeJudgeAnswer(value) {
  const text = cleanAnswerText(value);
  if (/^(?:true|t|正确|对|是|1)(?:$|[\s.,;:!?。；：，、)】])/iu.test(text)) return 'TRUE';
  if (/^(?:false|f|错误|错|否|0)(?:$|[\s.,;:!?。；：，、)】])/iu.test(text)) return 'FALSE';
  return normalizeChoiceAnswer(text, false);
}

export function normalizeAnswer(value, type = '') {
  if (isJudgeType(type)) return normalizeJudgeAnswer(value);
  return normalizeChoiceAnswer(value, isMultipleType(type));
}

const TRUE_OPTION_TEXT = /^(?:正确|对|是|真|√|true|t|yes|y)(?:$|[\s.、,，;；:：)）】]|的)/iu;
const FALSE_OPTION_TEXT = /^(?:错误|错|否|假|×|x|false|f|no|n)(?:$|[\s.、,，;；:：)）】]|的)/iu;
const LETTER_ANSWER = /^[A-Z](?:#[A-Z])*$/u;

function letterAt(index) {
  return String.fromCharCode(65 + index);
}

// 只有 A、B、C… 这样的连续字母才算真正的选项编号，
// 否则 "delete from ..." 会被误读成 "D + elete from ..."。
function isLetterSequence(entries) {
  return entries.length > 0 && entries.every((entry, index) => entry.letter === letterAt(index));
}

function implicitOptions(lines) {
  return lines.map((line, index) => ({ letter: letterAt(index), text: line, implicit: true }));
}

export function parseOptions(options) {
  const text = String(options ?? '').replace(/\r\n?/gu, '\n').trim();
  if (!text) return [];

  const byLine = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([A-Za-z])\s*(?:[.、)．:：]\s*|\s+)(\S.*)$/u);
    if (!match) continue;
    byLine.push({ letter: match[1].toUpperCase(), text: match[2].trim() });
  }
  if (byLine.length >= 2 && isLetterSequence(byLine)) return byLine;

  // OCS 有时把全部选项放在一行："A. 正确 B. 错误"。
  const markers = [...text.matchAll(/(?:^|[\s;；|])([A-H])\s*[.、)．:：]\s*/gu)];
  if (markers.length >= 2) {
    const inline = [];
    for (const [index, marker] of markers.entries()) {
      const start = marker.index + marker[0].length;
      const end = index + 1 < markers.length ? markers[index + 1].index : text.length;
      const optionText = text.slice(start, end).trim().replace(/[\s;；|]+$/u, '');
      inline.push({ letter: marker[1].toUpperCase(), text: optionText });
    }
    if (isLetterSequence(inline)) return inline;
  }

  // 选项本身没有字母前缀（OCS 常见）：按行号补 A、B、C…
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2) return implicitOptions(lines);
  return [];
}

function optionLetterByText(entries, pattern) {
  for (const entry of entries) {
    if (pattern.test(entry.text)) return entry.letter;
  }
  return '';
}

export function alignAnswerToOptions(answer, question = {}) {
  const value = String(answer ?? '').trim();
  if (!value) return '';

  const entries = parseOptions(question.options);
  // Without a parseable option list there is nothing to align against.
  if (entries.length < 2) return value;

  // OCS 的选项若本身没有字母（例如 "对\n错"），它按文字匹配，
  // 这时必须回选项原文，回字母 B 是选不中的。
  const implicit = entries.every((entry) => entry.implicit);
  const byLetter = new Map(entries.map((entry) => [entry.letter, entry]));
  const render = (letters) => (implicit
    ? letters.map((letter) => byLetter.get(letter).text).join('#')
    : letters.join('#'));

  if (value === 'TRUE' || value === 'FALSE') {
    const letter = optionLetterByText(entries, value === 'TRUE' ? TRUE_OPTION_TEXT : FALSE_OPTION_TEXT);
    return letter ? render([letter]) : value;
  }
  if (LETTER_ANSWER.test(value)) {
    const letters = value.split('#');
    if (!letters.every((letter) => byLetter.has(letter))) return '';
    return render(letters);
  }

  const normalized = value.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
  for (const entry of entries) {
    const optionText = entry.text.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
    if (optionText && (optionText === normalized || optionText.startsWith(normalized))) {
      return implicit ? entry.text : entry.letter;
    }
  }
  return '';
}

export function extractAnswer(payload, type = '') {
  const content = contentFromPayload(payload);
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    return normalizeAnswer(content.answer, type);
  }
  if (Array.isArray(content)) {
    const text = content.map((part) => part?.text ?? '').join('');
    return extractAnswer(text, type);
  }
  if (typeof content !== 'string') return '';

  const cleaned = stripCodeFence(content);
  try {
    const parsed = JSON.parse(cleaned);
    const fromJson = normalizeAnswer(parsed?.answer, type);
    if (fromJson) return fromJson;
  } catch {
    // Not JSON: fall through to the plain answer formats below.
  }
  const objectMatch = cleaned.match(/\{[\s\S]*\}/u);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      const answer = normalizeAnswer(parsed?.answer, type);
      if (answer) return answer;
    } catch {
      // Try the plain answer format below.
    }
  }
  const answerMatch = cleaned.match(/(?:answer|答案)\s*(?:是|为|应为)?\s*[:：=]?\s*([^\n]+)/iu);
  return normalizeAnswer(answerMatch ? answerMatch[1] : cleaned, type);
}
