import fs from 'node:fs';

/**
 * 兼容性平台「考试」的纯逻辑层（不联网、不启动浏览器）：
 * 题库加载、题干归一化与匹配、选项定位、接口应答解析。
 * CLI（exam_pass.mjs）、宿主与测试共用这一份实现。
 */

/** 题库文件（与脚本同目录）。 */
export const EXAM_BANK_PATH = new URL('./exam_bank.json', import.meta.url);

/** 平台考试的两个题类型。 */
export const EXAM_TYPE_CHOICE = 1;
export const EXAM_TYPE_JUDGE = 2;

/** 判断题在没有 options 时使用的兜底选项（与平台前端一致）。 */
export const JUDGE_OPTIONS = [
  { key: '对', text: '正确' },
  { key: '错', text: '错误' },
];

/**
 * 题干归一化：全角/半角标点、空白、零宽字符都可能被平台改动，
 * 匹配前统一成「去掉所有空白 + 中文标点转半角 + 小写」。
 */
export function normalizeQuestionText(text) {
  return String(text ?? '')
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。、；：？！“”‘’（）《》〈〉【】]/g, (ch) => ({
      '，': ',', '。': '.', '、': ',', '；': ';', '：': ':', '？': '?', '！': '!',
      '“': '"', '”': '"', '‘': "'", '’': "'", '（': '(', '）': ')',
      '《': '<', '》': '>', '〈': '<', '〉': '>', '【': '[', '】': ']',
    }[ch] ?? ch))
    .toLowerCase();
}

/** 读取题库（默认读同目录 exam_bank.json，可传路径覆盖）。 */
export function loadExamBank(bankPath = EXAM_BANK_PATH) {
  const raw = fs.readFileSync(bankPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('题库文件格式不对：顶层应为数组。');
  return parsed.map((item) => ({
    n: Number(item.n),
    type: item.type,
    question: String(item.question ?? '').trim(),
    options: Array.isArray(item.options) ? item.options.map((option) => ({
      key: String(option.key ?? '').trim(),
      text: String(option.text ?? '').trim(),
    })) : [],
    answerKey: String(item.answerKey ?? '').trim(),
    answerText: String(item.answerText ?? '').trim(),
    analysis: String(item.analysis ?? '').trim(),
  }));
}

/** 建「归一化题干 → 条目」索引，供考试时快速匹配。 */
export function buildExamIndex(bank) {
  const index = new Map();
  for (const item of bank) {
    const key = normalizeQuestionText(item.question);
    if (key && !index.has(key)) index.set(key, item);
  }
  return index;
}

/** 平台返回的题目 → 统一形状。 */
export function normalizeExamQuestion(raw) {
  const type = Number(raw?.type) === EXAM_TYPE_JUDGE ? EXAM_TYPE_JUDGE : EXAM_TYPE_CHOICE;
  const rawOptions = Array.isArray(raw?.options) ? raw.options : [];
  const options = (type === EXAM_TYPE_JUDGE && rawOptions.length === 0 ? JUDGE_OPTIONS : rawOptions)
    .map((option) => ({
      key: String(option?.label ?? option?.key ?? '').trim(),
      text: String(option?.content ?? option?.value ?? option?.text ?? '').trim(),
    }))
    .filter((option) => option.key && option.text);
  return {
    id: String(raw?.id ?? '').trim(),
    type,
    isJudge: type === EXAM_TYPE_JUDGE,
    content: String(raw?.content ?? '').trim(),
    options,
  };
}

/**
 * 在题库里找这道题，并给出应选的选项 key。
 * 先按题干精确匹配；题干匹配不到时退回「选项文本完全一致」的比对（题干被平台改写时的兜底）。
 * 返回 { entry, answerKey, reason }，找不到返回 null（调用方决定是否中止）。
 */
export function resolveExamAnswer(question, index, bank = []) {
  const text = normalizeQuestionText(question?.content);
  if (!text) return null;
  const entry = index.get(text);
  if (entry) {
    const key = pickOptionKey(question, entry.answerKey, entry.answerText);
    if (key) return { entry, answerKey: key, reason: '题干命中' };
    return { entry, answerKey: entry.answerKey, reason: '题干命中（按题库 key 作答）' };
  }
  // 题干被改写过：用「正确答案文本 + 选项集合」反查题库条目
  for (const candidate of bank) {
    const sameOptions = candidate.options.length === question.options.length
      && candidate.options.every((option) => question.options.some((q) => q.text === option.text));
    if (!sameOptions) continue;
    const key = pickOptionKey(question, candidate.answerKey, candidate.answerText);
    if (key) return { entry: candidate, answerKey: key, reason: '选项命中' };
  }
  return null;
}

/** 把题库里的答案（key 或文本）映射到当前题目的选项 key。 */
function pickOptionKey(question, answerKey, answerText) {
  const byKey = question.options.find((option) => option.key === answerKey
    || option.key.toUpperCase() === String(answerKey).toUpperCase());
  if (byKey) return byKey.key;
  const text = String(answerText ?? '').trim();
  if (!text) return '';
  const byText = question.options.find((option) => option.text === text);
  return byText ? byText.key : '';
}

/** 平台 /exam/checkStatus 应答 → { ok, canExam, lastExamTime, message }。 */
export function parseExamStatus(payload) {
  const code = Number(payload?.code);
  const body = payload?.body ?? {};
  return {
    ok: code === 200,
    canExam: body.canExam === true,
    lastExamTime: body.lastExamTime ?? null,
    message: String(payload?.msg ?? ''),
  };
}

/** 平台 /exam/start 应答 → { ok, total, currentIndex, question, message }。 */
export function parseExamStart(payload) {
  const code = Number(payload?.code);
  const body = payload?.body ?? {};
  return {
    ok: code === 200 && Boolean(body.currentQuestion),
    code,
    total: Number(body.total ?? 0),
    currentIndex: Number(body.currentIndex ?? 0),
    question: body.currentQuestion ? normalizeExamQuestion(body.currentQuestion) : null,
    message: String(payload?.msg ?? ''),
  };
}

/** 平台 /exam/answer 应答 → 判定/解析/下一题/结束。 */
export function parseExamAnswer(payload) {
  const code = Number(payload?.code);
  const body = payload?.body ?? {};
  return {
    ok: code === 200 && Boolean(body),
    correct: body.correct === true,
    correctAnswer: String(body.correctAnswer ?? ''),
    analysis: String(body.analysis ?? ''),
    examEnded: body.examEnded === true,
    nextQuestion: body.nextQuestion ? normalizeExamQuestion(body.nextQuestion) : null,
    pass: body.pass === true,
    correctCount: Number(body.correctCount ?? 0),
    total: Number(body.total ?? 0),
    resultMessage: String(body.pass ? (body.passMsg ?? '') : (body.failMsg ?? '')),
    results: Array.isArray(body.results) ? body.results : [],
    message: String(payload?.msg ?? ''),
  };
}
