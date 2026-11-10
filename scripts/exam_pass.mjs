import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import {
  loadExamBank, buildExamIndex, resolveExamAnswer, parseExamStatus, parseExamStart, parseExamAnswer,
} from './exam_logic.mjs';

/**
 * 兼容性平台「准入考试」自动作答 CLI。
 *
 * 用法：
 *   node scripts/exam_pass.mjs --dry-run                     # 只查考试状态，不消耗当天名额
 *   node scripts/exam_pass.mjs --phone 13950182204 --email a@b.com
 *   node scripts/exam_pass.mjs --phone ... --email ... --artifacts /tmp/exam-xxx
 *
 * 输出协议（宿主据此渲染进度；人类可读文案走 stderr）：
 *   EXAM_PROGRESS={"stage":"...","index":1,"total":56,"percent":2,"correct":1,"detail":"..."}
 *   EXAM_RESULT_JSON={"ok":true,"skipped":false,"passed":true,"correctCount":56,"total":56,...}
 *
 * 平台约束：每人每 24 小时只能考一次，且必须全部答对才算通过，提交后不可修改。
 * 因此脚本在开考前会先用题库做覆盖检查：凡是题库里找不到的题，都记为 unknown 并如实上报，
 * 不会因为「猜一个」而静默把一次机会用掉。
 */

const PLATFORM_ORIGIN = 'https://compatibility.openharmony.cn';
const LOGIN_ENTRY_URL = `${PLATFORM_ORIGIN}/#/personal`;
const EXAM_API_BASE = `${PLATFORM_ORIGIN}/certificate`;
const VERIFICATION_MARKERS = /验证码|captcha|短信验证|手机验证|安全验证|人机验证/i;

class ExamError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExamError';
    this.code = code;
  }
}

function parseArgs(argv) {
  const options = { phone: '', email: '', dryRun: false, artifacts: '', username: '', password: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--phone') options.phone = argv[++index] ?? '';
    else if (arg === '--email') options.email = argv[++index] ?? '';
    else if (arg === '--artifacts') options.artifacts = argv[++index] ?? '';
    else if (arg === '--username') options.username = argv[++index] ?? '';
    else if (arg === '--password') options.password = argv[++index] ?? '';
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new ExamError('BAD_ARGS', `未知参数：${arg}`);
  }
  return options;
}

function settingsFile() {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  return path.join(home, '.dsh', 'ohos-xts-auto-reporter.json');
}

function loadCredentials(options) {
  let stored = {};
  try {
    stored = JSON.parse(readFileSync(settingsFile(), 'utf8'));
  } catch {
    stored = {};
  }
  const username = options.username || process.env.OH_USERNAME || stored.username || '';
  const password = options.password || process.env.OH_PASSWORD || stored.password || '';
  if (!username || !password) {
    throw new ExamError('CREDENTIALS_MISSING', '缺少平台账号或密码：请先在插件设置里保存，或设置 OH_USERNAME / OH_PASSWORD。');
  }
  return { username, password };
}

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function progress(payload) {
  emit({ kind: 'progress', ...payload });
}

function safeArtifacts(options) {
  const dir = options.artifacts || path.join(os.tmpdir(), `oh-exam-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function loadPlaywright() {
  try {
    const mod = await import('playwright');
    return mod;
  } catch {
    const require = createRequire(import.meta.url);
    return require('playwright');
  }
}

async function launchChromium(playwright) {
  try {
    return await playwright.chromium.launch({ headless: true });
  } catch (error) {
    const channel = process.env.OH_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chrome');
    try {
      return await playwright.chromium.launch({ headless: true, channel });
    } catch {
      throw new ExamError('BROWSER_LAUNCH_FAILED', `无法启动浏览器：${error?.message ?? String(error)}`);
    }
  }
}

async function throwIfVerificationRequired(page, artifacts) {
  const body = await page.evaluate(() => document.body.innerText).catch(() => '');
  if (VERIFICATION_MARKERS.test(body)) {
    await page.screenshot({ path: path.join(artifacts, 'verification-required.png'), fullPage: true }).catch(() => {});
    throw new ExamError('VERIFICATION_REQUIRED', '检测到验证码/短信验证/人机验证，已中止；脚本不会尝试绕过验证。');
  }
}

async function signIn(page, artifacts, username, password) {
  await page.goto(LOGIN_ENTRY_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await throwIfVerificationRequired(page, artifacts);
  const passwordInput = page.locator('input[type="password"]').first();
  if (!await passwordInput.isVisible().catch(() => false)) {
    if (page.url().includes('/console/')) return;
    throw new ExamError('LOGIN_FORM_UNRECOGNIZED', '登录页没有出现账号密码表单。');
  }
  await page.locator('input[placeholder="用户账号"]').first().fill(username);
  await passwordInput.fill(password);
  await throwIfVerificationRequired(page, artifacts);
  await page.locator('button:has-text("登录")').first().click();
  await page.waitForTimeout(1500);
  await throwIfVerificationRequired(page, artifacts);
  if (await passwordInput.isVisible().catch(() => false)) {
    throw new ExamError('LOGIN_FAILED', '登录后仍停留在密码页，账号或密码可能不正确。');
  }
  if (page.url().includes('legacy.openatom.cn/oauth/authorize')) {
    const authorize = page.getByRole('button', { name: '授权', exact: true }).first();
    if (!await authorize.isVisible().catch(() => false)) {
      throw new ExamError('OAUTH_CONSENT_UNRECOGNIZED', 'OAuth 授权页没有出现「授权」按钮。');
    }
    await authorize.click();
    await page.waitForTimeout(1500);
  }
  // 登录后跳到 console，等 SPA 稳定再调用接口，避免上下文被路由销毁。
  await page.waitForURL(/compatibility\.openharmony\.cn\/console/, { timeout: 20000 }).catch(() => {});
  await page.locator('#app').first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

/** 用页面里的登录态调平台接口（token 在 localStorage.Token，请求头 access-token）。 */
async function callApi(page, method, endpoint, body) {
  // 登录完成/路由跳转会销毁执行上下文，这里重试几次再失败。
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await evaluateApi(page, method, endpoint, body);
    } catch (error) {
      if (!/Execution context was destroyed|navigat/i.test(error?.message ?? '')) throw error;
      await page.waitForTimeout(1200);
    }
  }
  return await evaluateApi(page, method, endpoint, body);
}

async function evaluateApi(page, method, endpoint, body) {
  return await page.evaluate(async ([method, url, body]) => {
    const token = localStorage.getItem('Token') || '';
    const response = await fetch(url, {
      method,
      headers: { 'access-token': token, 'Content-Type': 'application/json' },
      body: body === null ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    try {
      return { status: response.status, payload: JSON.parse(text) };
    } catch {
      return { status: response.status, payload: null, raw: text.slice(0, 400) };
    }
  }, [method, `${EXAM_API_BASE}${endpoint}`, body ?? null]);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stderr.write('用法：node scripts/exam_pass.mjs [--dry-run] [--phone 手机号] [--email 邮箱] [--artifacts 目录]\n');
    return 0;
  }
  const startedAt = Date.now();
  const artifacts = safeArtifacts(options);
  const { username, password } = loadCredentials(options);
  const bank = loadExamBank();
  const index = buildExamIndex(bank);
  const playwright = await loadPlaywright();
  const browser = await launchChromium(playwright);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const unknown = [];
  let answered = 0;
  let correct = 0;
  let total = 0;

  try {
    await signIn(page, artifacts, username, password);
    progress({ stage: '已登录', percent: 2, detail: '正在查询考试状态' });

    const query = `?phone=${encodeURIComponent(options.phone)}&email=${encodeURIComponent(options.email)}`;
    const statusRaw = await callApi(page, 'GET', `/exam/checkStatus${query}`);
    const status = parseExamStatus(statusRaw.payload);
    if (!status.ok) {
      throw new ExamError('EXAM_STATUS_FAILED', `查询考试状态失败：${status.message || statusRaw.status}`);
    }
    progress({
      stage: '考试状态',
      percent: 4,
      detail: status.canExam ? '今天还没考，可以开始' : `当前不能考试（上次：${status.lastExamTime ?? '无记录'}）`,
    });
    if (options.dryRun) {
      emit({
        kind: 'result',
        ok: true,
        skipped: true,
        dryRun: true,
        canExam: status.canExam,
        lastExamTime: status.lastExamTime,
        bankSize: bank.length,
        message: status.canExam ? '可以开始考试（未消耗名额）' : '当前不能考试',
      });
      return 0;
    }
    if (!status.canExam) {
      emit({
        kind: 'result',
        ok: true,
        skipped: true,
        canExam: false,
        lastExamTime: status.lastExamTime,
        bankSize: bank.length,
        message: '平台显示 24 小时内已考过或暂不可考，跳过本次考试。',
      });
      return 0;
    }

    const startRaw = await callApi(page, 'POST', '/exam/start', { phone: options.phone, email: options.email });
    const start = parseExamStart(startRaw.payload);
    if (!start.ok || !start.question) {
      throw new ExamError('EXAM_START_FAILED', `开始考试失败：${start.message || startRaw.status}`);
    }
    total = start.total || bank.length;
    let question = start.question;
    progress({ stage: '开始考试', index: 1, total, percent: 5, detail: `${total} 道题，全部答对才通过` });

    for (let step = 0; step < total + 5; step += 1) {
      const resolved = resolveExamAnswer(question, index, bank);
      let answerKey;
      if (resolved) {
        answerKey = resolved.answerKey;
      } else {
        unknown.push({ id: question.id, content: question.content });
        answerKey = question.options[0]?.key ?? '';
        progress({
          stage: '题库缺题',
          index: answered + 1,
          total,
          percent: Math.round(((answered + 1) / total) * 100),
          detail: `题库里没有这道题，按第一个选项作答：${question.content.slice(0, 40)}`,
        });
      }
      if (!answerKey) {
        throw new ExamError('ANSWER_UNRESOLVED', `第 ${answered + 1} 题没有可用选项：${question.content.slice(0, 60)}`);
      }
      const answerRaw = await callApi(page, 'POST', '/exam/answer', { questionId: question.id, userAnswer: answerKey });
      const result = parseExamAnswer(answerRaw.payload);
      if (!result.ok) {
        throw new ExamError('EXAM_ANSWER_FAILED', `提交第 ${answered + 1} 题失败：${result.message || answerRaw.status}`);
      }
      answered += 1;
      if (result.correct) correct += 1;
      const percent = Math.min(99, Math.round((answered / Math.max(total, answered)) * 100));
      progress({
        stage: '作答中',
        index: answered,
        total: total || answered,
        percent,
        correct,
        detail: `${result.correct ? '正确' : '错误'}｜正确答案 ${result.correctAnswer}｜已答 ${answered}`,
      });

      if (result.examEnded) {
        const passed = result.pass === true;
        emit({
          kind: 'result',
          ok: true,
          skipped: false,
          passed,
          correctCount: result.correctCount || correct,
          total: result.total || total,
          unknownCount: unknown.length,
          unknown: unknown.slice(0, 20),
          resultMessage: result.resultMessage,
          bankSize: bank.length,
          artifacts,
          durationMs: Date.now() - startedAt,
        });
        await page.screenshot({ path: path.join(artifacts, 'exam-result.png'), fullPage: true }).catch(() => {});
        writeFileSync(path.join(artifacts, 'exam-result.json'), JSON.stringify({ answered, correct, unknown, results: result.results }, null, 2));
        return passed ? 0 : 3;
      }
      if (!result.nextQuestion) {
        throw new ExamError('EXAM_NEXT_MISSING', '平台没有返回下一题，考试流程中断。');
      }
      question = result.nextQuestion;
    }
    throw new ExamError('EXAM_LOOP_OVERFLOW', '答题次数超过题量，已中止。');
  } finally {
    await browser.close().catch(() => {});
  }
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    const code = error instanceof ExamError ? error.code : 'UNEXPECTED_ERROR';
    emit({ kind: 'result', ok: false, errorCode: code, message: error?.message ?? String(error) });
    process.stderr.write(`考试失败：${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
