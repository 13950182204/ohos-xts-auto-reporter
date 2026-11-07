import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import {
  formatBytes,
  formatSpeed,
  overallPercent,
  parseMirrorArgs,
  parseUploadProgressText,
  resolveMirrorFile,
  validateMirrorFileName,
} from './mirror_logic.mjs';

/**
 * 镜像固件上传（Playwright）。
 *
 * 流程：登录 OpenHarmony 兼容性平台 → 企业空间 → 镜像管理 → 上传文件 →
 * 用页面里的隐藏 input[type=file].hidden-file-input 直接投递固件 →
 * 轮询 .upload-tip-dialog 内的「解析中 / 上传中」进度并按行输出协议。
 *
 * stdout 只有两类协议行（单行 JSON，无账号密码）：
 *   MIRROR_PROGRESS={"percent":…,"stage":…,"detail":…,"uploadedBytes":…,"totalBytes":…,"speedBytesPerSecond":…}
 *   MIRROR_RESULT_JSON={"ok":…,…}
 */

const LOGIN_ENTRY_URL = 'https://compatibility.openharmony.cn/#/personal';
const MIRROR_URL = 'https://compatibility.openharmony.cn/console/#/mirror';
const VERIFICATION_MARKERS = /验证码|captcha|短信验证|手机验证|安全验证|人机验证/i;
const FAILURE_MARKERS = /上传失败|解析失败|上传出错|上传异常|网络错误|服务器错误|上传超时|文件损坏/;
const DONE_TEXT_PATTERN = /已上传\s*\d+(?:\.\d+)?%|上传成功|上传完成/;
const DEFAULT_UPLOAD_TIMEOUT_MS = 45 * 60 * 1000;
const POLL_INTERVAL_MS = 500;
const HEARTBEAT_MS = 2000;
const VERIFICATION_CHECK_INTERVAL_MS = 5000;
const COMPLETION_GRACE_MS = 3 * 60 * 1000;
const MAX_UPLOAD_EVIDENCE_TEXT = 20000;

class MirrorUploadError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function usage() {
  return `Usage:
  OH_USERNAME='...' OH_PASSWORD='...' node scripts/mirror_upload.mjs --input <固件文件或目录> [--dry-run] [--rename] [--artifacts <目录>]

--dry-run    只做本地校验（扩展名、存在性、大小、平台文件名规则），不打开浏览器、不读取账号密码。
--rename     文件名不合规时，复制到系统临时目录并用净化后的文件名上传，结束后删除临时副本（原文件不动）。
--artifacts  截图与诊断输出目录，默认系统临时目录 oh-mirror-update-<时间戳>。
--upload     显式声明真实上传（与默认行为相同，供宿主调用）。

环境变量：
  OH_USERNAME / OH_PASSWORD　平台账号密码（真实上传必填，脚本绝不打印）
  OH_MIRROR_TIMEOUT_MS　　　　上传超时，默认 45 分钟
  OH_MIRROR_HEADLESS=0　　　　显示浏览器窗口（默认无头）
  OH_MIRROR_NAV_ONLY=1　　　　只登录并走到镜像管理页/上传提示框，不选择文件、不上传（排障用）`;
}

function artifactDirectory(requestedDirectory) {
  if (requestedDirectory) return path.resolve(requestedDirectory);
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  return path.join(os.tmpdir(), `oh-mirror-update-${stamp}`);
}

function uploadTimeoutMs() {
  const override = Number(process.env.OH_MIRROR_TIMEOUT_MS);
  if (Number.isFinite(override) && override > 0) return override;
  return DEFAULT_UPLOAD_TIMEOUT_MS;
}

function snippet(text, limit = 200) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function emitProgress(payload) {
  console.log(`MIRROR_PROGRESS=${JSON.stringify(payload)}`);
}

function emitResult(result) {
  console.log(`MIRROR_RESULT_JSON=${JSON.stringify(result)}`);
}

async function writeResult(artifacts, result) {
  if (!artifacts) return;
  await fs.writeFile(path.join(artifacts, 'result.json'), `${JSON.stringify(result, null, 2)}\n`).catch(() => {});
}

/** 截图到 artifacts；redact 时先把密码框内容清空，避免把密码截进图里。 */
async function safeScreenshot(page, artifacts, name, redact = false) {
  if (!page || !artifacts) return;
  if (redact) {
    await page.locator('input[type="password"], input[name*="password" i]').evaluateAll((inputs) => {
      for (const input of inputs) {
        input.value = '';
        input.placeholder = '[redacted]';
      }
    }).catch(() => {});
  }
  await page.screenshot({ path: path.join(artifacts, `${name}.png`) }).catch(() => {});
}

async function captureFailureState(page, artifacts) {
  if (!page || !artifacts) return;
  await safeScreenshot(page, artifacts, 'error-state', true);
  const stateText = await page.locator('body').innerText().catch(() => '');
  await fs.writeFile(path.join(artifacts, 'error-state.txt'), String(stateText).slice(0, MAX_UPLOAD_EVIDENCE_TEXT)).catch(() => {});
}

async function throwIfVerificationRequired(page, artifacts) {
  const text = await page.locator('body').innerText().catch(() => '');
  if (VERIFICATION_MARKERS.test(text)) {
    await safeScreenshot(page, artifacts, 'human-verification-required', true);
    throw new MirrorUploadError(
      'HUMAN_VERIFICATION_REQUIRED',
      '检测到验证码/短信验证/人机验证，已中止并保存截图；脚本不会尝试绕过验证。',
    );
  }
}

async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) return locator;
  }
  return null;
}

/** 点击文本精确匹配的可见元素；若是菜单项则点击其 li / el-submenu__title 祖先。 */
async function clickExactText(page, value) {
  const matches = page.getByText(value, { exact: true });
  for (let index = 0; index < await matches.count(); index += 1) {
    const exact = matches.nth(index);
    if (!await exact.isVisible().catch(() => false)) continue;
    const menuTarget = exact.locator(
      'xpath=ancestor-or-self::*[self::li or contains(@class, "el-submenu__title")][1]',
    );
    if (await menuTarget.isVisible().catch(() => false)) {
      await menuTarget.click();
    } else {
      await exact.click();
    }
    return true;
  }
  return false;
}

async function signIn(page, artifacts, username, password) {
  try {
    await page.goto(LOGIN_ENTRY_URL, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    throw new MirrorUploadError('LOGIN_PAGE_UNREACHABLE', `无法打开兼容性平台登录页：${error?.message ?? String(error)}`);
  }
  await page.waitForTimeout(800);
  await throwIfVerificationRequired(page, artifacts);

  const passwordInput = await firstVisible(page, [
    'input[type="password"]',
    'input[name*="password" i]',
    'input[placeholder="用户密码"]',
    '#password',
  ]);
  if (!passwordInput) {
    if (page.url().includes('signin-oAuth')) {
      await safeScreenshot(page, artifacts, 'login-form-unrecognized', true);
      throw new MirrorUploadError('LOGIN_FORM_UNRECOGNIZED', 'OpenAtom 登录页没有出现账号密码表单。');
    }
    return;
  }
  const usernameInput = await firstVisible(page, [
    'input[placeholder="用户账号"]',
    'input[name="username"]',
    'input[name="account"]',
    '#username',
    '#account',
    'input[type="email"]',
    'input[type="text"]',
    'input:not([type])',
  ]);
  if (!usernameInput) {
    throw new MirrorUploadError('LOGIN_FORM_UNRECOGNIZED', '找到密码框但没有找到账号输入框。');
  }

  await usernameInput.fill(username);
  await passwordInput.fill(password);
  await throwIfVerificationRequired(page, artifacts);

  const loginButton = await firstVisible(page, [
    'button:has-text("登录")',
    'button:has-text("登 录")',
    'button:has-text("Login")',
    'input[type="submit"]',
  ]);
  if (!loginButton) {
    throw new MirrorUploadError('LOGIN_BUTTON_UNRECOGNIZED', '账号密码已填写，但没有找到「登录」按钮。');
  }
  await loginButton.click();
  await page.waitForTimeout(1500);
  await throwIfVerificationRequired(page, artifacts);

  if (await passwordInput.isVisible().catch(() => false)) {
    await safeScreenshot(page, artifacts, 'login-failed', true);
    throw new MirrorUploadError('LOGIN_FAILED', '登录后仍停留在密码页，账号或密码可能不正确。');
  }

  if (page.url().includes('legacy.openatom.cn/oauth/authorize')) {
    const authorizeButton = page.getByRole('button', { name: '授权', exact: true }).first();
    if (!await authorizeButton.isVisible().catch(() => false)) {
      await safeScreenshot(page, artifacts, 'oauth-consent-unrecognized');
      throw new MirrorUploadError('OAUTH_CONSENT_UNRECOGNIZED', 'OAuth 授权页没有出现精确的「授权」按钮。');
    }
    await authorizeButton.click();
    await page.waitForURL(/compatibility\.openharmony\.cn\/console\//, { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await throwIfVerificationRequired(page, artifacts);
  }
  if (page.url().includes('/console/')) {
    await page.getByText('兼容性平台', { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  }
}

/** 登录后从控制台进入「企业空间 → 镜像管理」，返回时页面已有「上传文件」按钮。 */
async function openMirrorPage(page, artifacts) {
  const mirrorMenuItem = page.locator('li.el-menu-item').filter({ hasText: '镜像管理' }).first();
  if (!await mirrorMenuItem.isVisible().catch(() => false)) {
    const enterpriseMenu = page.locator('div.el-submenu__title').filter({ hasText: '企业空间' }).first();
    if (await enterpriseMenu.isVisible().catch(() => false)) {
      await enterpriseMenu.click().catch(() => {});
      await page.waitForTimeout(800);
    }
  }
  if (await mirrorMenuItem.isVisible().catch(() => false)) {
    await mirrorMenuItem.click().catch(() => {});
  } else {
    await page.goto(MIRROR_URL, { waitUntil: 'domcontentloaded' }).catch((error) => {
      throw new MirrorUploadError('MIRROR_PAGE_UNREACHABLE', `无法打开镜像管理页：${error?.message ?? String(error)}`);
    });
  }
  await page.waitForURL(/\/console\/#\/mirror/, { timeout: 15_000 }).catch(async () => {
    await page.goto(MIRROR_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(1200);
  });
  if (!/\/console\/#\/mirror/.test(page.url())) {
    await safeScreenshot(page, artifacts, 'mirror-page-not-found');
    throw new MirrorUploadError('MIRROR_MENU_NOT_FOUND', `没有进入镜像管理页（当前地址：${page.url()}）。`);
  }
  await throwIfVerificationRequired(page, artifacts);

  const uploadButton = page.locator('button:has-text("上传文件"), .el-button:has-text("上传文件")').first();
  await uploadButton.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  if (!await uploadButton.isVisible().catch(() => false)) {
    await safeScreenshot(page, artifacts, 'upload-button-not-found');
    throw new MirrorUploadError('MIRROR_PAGE_NOT_READY', `镜像管理页没有出现「上传文件」按钮（当前地址：${page.url()}）。`);
  }
  await safeScreenshot(page, artifacts, 'mirror-page');
}

/** 点「上传文件」，必要时点掉公告中心弹窗，等到文件名规则提示框出现。 */
async function openUploadTip(page, artifacts) {
  if (!await clickExactText(page, '上传文件')) {
    const uploadButton = page.locator('button:has-text("上传文件"), .el-button:has-text("上传文件")').first();
    if (!await uploadButton.isVisible().catch(() => false)) {
      throw new MirrorUploadError('UPLOAD_ACTION_NOT_FOUND', '找不到可点击的「上传文件」按钮。');
    }
    await uploadButton.click();
  }

  const tipDialog = page.locator('.upload-tip-dialog').first();
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (await clickExactText(page, '已阅读')) {
      await page.waitForTimeout(600);
      continue;
    }
    if (await tipDialog.isVisible().catch(() => false)) return tipDialog;
    await page.waitForTimeout(400);
  }
  await safeScreenshot(page, artifacts, 'upload-dialog-not-found');
  throw new MirrorUploadError('UPLOAD_DIALOG_NOT_FOUND', '点击「上传文件」后没有出现文件名规则提示框（.upload-tip-dialog）。');
}

/** 直接往隐藏 file input 塞文件（不触发原生选择对话框）。 */
async function startUpload(page, filePath) {
  const hiddenInput = page.locator('input.hidden-file-input').first();
  let input = hiddenInput;
  if (await hiddenInput.count() === 0) {
    const fallback = page.locator('input[type="file"]').first();
    if (await fallback.count() === 0) {
      throw new MirrorUploadError('UPLOAD_INPUT_NOT_FOUND', '页面里没有隐藏的 input[type=file].hidden-file-input 上传控件。');
    }
    input = fallback;
  }
  try {
    await input.setInputFiles(filePath);
  } catch (error) {
    throw new MirrorUploadError('UPLOAD_START_FAILED', `无法把固件交给上传控件：${error?.message ?? String(error)}`);
  }
}

/** 取最后一条匹配的文本行（用于从文件列表/对话框里提取平台状态文案）。 */
function lastLineMatching(text, pattern) {
  const lines = String(text ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (pattern.test(lines[index])) return lines[index].slice(0, 160);
  }
  return '';
}

class ProgressReporter {
  constructor({ fileName, totalBytes }) {
    this.fileName = fileName;
    this.totalBytes = totalBytes;
    this.lastEmittedAt = 0;
    this.lastStage = null;
    this.lastPercent = -1;
  }

  report({ stage, percent, detail, uploadedBytes, speedBytesPerSecond, force = false }) {
    const now = Date.now();
    const roundedPercent = Math.round(Math.min(100, Math.max(0, Number(percent) || 0)) * 10) / 10;
    const changed = stage !== this.lastStage || roundedPercent !== this.lastPercent;
    const heartbeat = now - this.lastEmittedAt >= HEARTBEAT_MS;
    if (!force && !changed && !heartbeat) return;
    this.lastEmittedAt = now;
    this.lastStage = stage;
    this.lastPercent = roundedPercent;
    emitProgress({
      percent: roundedPercent,
      stage,
      detail,
      uploadedBytes: Math.max(0, Math.round(Number(uploadedBytes) || 0)),
      totalBytes: this.totalBytes,
      speedBytesPerSecond: Math.max(0, Math.round(Number(speedBytesPerSecond) || 0)),
    });
  }
}

/** 读取平台 toast 文本（上传成功/失败提示是 element-ui 的 .el-message，约 3 秒后自动消失）。 */
async function readToastText(page) {
  const toasts = page.locator('.el-message');
  const count = await toasts.count().catch(() => 0);
  if (count === 0) return '';
  const texts = await toasts.allInnerTexts().catch(() => []);
  return texts
    .map((text) => String(text ?? '').trim())
    .filter(Boolean)
    .join(' | ');
}

/**
 * 轮询平台上传进度，直到完成/失败/超时。
 * 进度渲染在工具栏 `.progress-box` 的 `.progress-line` 里（不在文件名规则提示框内），
 * 且进度行消失后的成功/失败信号是 `.el-message` toast + 文件列表行。
 * 不能用「上传中 100%」当完成信号：上传阶段开始的瞬间显示的是解析阶段的 Parsingprogress=100%，是假象。
 * 返回 { platformStatus, completionSource, startedAt }。
 */
async function pollUpload(page, { uploadFileName, totalBytes, artifacts, timeoutMs }) {
  const reporter = new ProgressReporter({ fileName: uploadFileName, totalBytes });
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  const progressBox = page.locator('.progress-box').first();
  const rejectionPattern = /文件名含不支持的字符|请上传正确的镜像文件格式|空间不足|校验失败|合并失败|分片缺失/;
  let speed = 0;
  let lastSampleAt = 0;
  let lastSamplePercent = 0;
  let lastStage = null;
  let lastPercent = 0;
  let sawUploadProgress = false;
  let lastActivityAt = startedAt;
  let lastVerificationCheckAt = 0;

  while (Date.now() < deadline) {
    const now = Date.now();
    if (now - lastVerificationCheckAt >= VERIFICATION_CHECK_INTERVAL_MS) {
      lastVerificationCheckAt = now;
      await throwIfVerificationRequired(page, artifacts);
    }

    // 显式 1 秒超时：进度行随时会被移除，innerText 不能按全局超时干等。
    const progressText = await progressBox.innerText({ timeout: 1000 }).catch(() => '');
    const parsed = parseUploadProgressText(progressText);

    if (parsed.stage === 'parsing' || parsed.stage === 'uploading' || parsed.stage === 'validating') {
      lastActivityAt = now;
      const numeric = Math.min(100, Math.max(0, Number(parsed.percent) || 0));
      if (parsed.stage === 'uploading' && !sawUploadProgress) {
        // 上传阶段刚开始时页面仍显示解析阶段的 100.00%（此时 Uploadprogress 还是 0），不是真实上传进度；
        // 跳过它，等第一个真实分片进度出现，否则宿主进度条会从 10% 跳到 99% 再掉回来。
        if (numeric >= 99.9) {
          lastStage = parsed.stage;
          await page.waitForTimeout(POLL_INTERVAL_MS);
          continue;
        }
        sawUploadProgress = true;
      }
      if (parsed.stage === 'uploading') {
        if (lastSampleAt > 0) {
          const seconds = (now - lastSampleAt) / 1000;
          const deltaBytes = ((numeric - lastSamplePercent) / 100) * totalBytes;
          if (seconds >= 0.3 && deltaBytes > 0) {
            const instant = deltaBytes / seconds;
            speed = speed > 0 ? speed * 0.6 + instant * 0.4 : instant;
          }
        }
        lastSampleAt = now;
        lastSamplePercent = numeric;
      }
      let uploadedBytes = 0;
      let detail = '';
      let stageLabel = '解析固件';
      if (parsed.stage === 'parsing') {
        detail = `${uploadFileName} 解析中：${numeric.toFixed(2)}%`;
      } else if (parsed.stage === 'uploading') {
        uploadedBytes = Math.round((totalBytes * numeric) / 100);
        stageLabel = '上传固件';
        detail = `${uploadFileName} 上传中：${numeric.toFixed(2)}% · ${formatBytes(uploadedBytes)}/${formatBytes(totalBytes)} · ${formatSpeed(speed)}`;
      } else {
        uploadedBytes = totalBytes;
        stageLabel = '校验固件';
        detail = `${uploadFileName} 校验中：${numeric.toFixed(2)}%`;
      }
      reporter.report({
        stage: stageLabel,
        percent: overallPercent(parsed.stage, numeric),
        detail,
        uploadedBytes,
        speedBytesPerSecond: parsed.stage === 'uploading' ? speed : 0,
      });
      lastPercent = numeric;
      lastStage = parsed.stage;
    } else if (lastStage !== null) {
      // 进度行消失 = 平台收尾：成功会移除 .progress-line 并弹「文件上传成功」toast、刷新文件列表；
      // 失败会弹错误 toast（如「文件上传失败」「签名校验失败」）。
      const quietMs = now - lastActivityAt;
      if (quietMs >= 400) {
        const toastText = await readToastText(page);
        const bodyText = await page.locator('body').innerText().catch(() => '');
        if (FAILURE_MARKERS.test(toastText) || rejectionPattern.test(toastText)) {
          throw new MirrorUploadError('UPLOAD_FAILED', `平台提示上传失败：${snippet(toastText || bodyText)}`);
        }
        if (DONE_TEXT_PATTERN.test(toastText) || DONE_TEXT_PATTERN.test(bodyText)) {
          reporter.report({
            stage: '完成',
            percent: 100,
            detail: `${uploadFileName} 上传完成`,
            uploadedBytes: totalBytes,
            speedBytesPerSecond: 0,
            force: true,
          });
          return {
            platformStatus: lastLineMatching(toastText, /上传成功|上传完成/) || '',
            completionSource: 'toast-success',
            startedAt,
          };
        }
        if (quietMs >= 15_000 && lastPercent >= 99) {
          // 兜底：toast 可能已消失，但进度确实走到 99%+ 且平台没有报错，按成功处理，平台行状态由后续查询确认。
          reporter.report({
            stage: '完成',
            percent: 100,
            detail: `${uploadFileName} 上传完成`,
            uploadedBytes: totalBytes,
            speedBytesPerSecond: 0,
            force: true,
          });
          return {
            platformStatus: '',
            completionSource: 'progress-gone',
            startedAt,
          };
        }
        if (quietMs >= 120_000) {
          throw new MirrorUploadError(
            'UPLOAD_FAILED',
            `上传进度在 ${lastPercent.toFixed(2)}% 后消失，页面上也没有找到完成提示。`,
          );
        }
      }
    } else {
      // 还没出现任何进度：平台遇到文件名/格式/空间问题时只弹 toast，不会产生进度行。
      const toastText = await readToastText(page);
      if (rejectionPattern.test(toastText)) {
        throw new MirrorUploadError('UPLOAD_FAILED', `平台拒绝上传：${snippet(toastText)}`);
      }
      if (now - startedAt >= 90_000) {
        throw new MirrorUploadError('UPLOAD_NOT_STARTED', '选择文件后 90 秒内没有出现上传进度，上传可能没有开始。');
      }
    }

    await page.waitForTimeout(POLL_INTERVAL_MS);
  }

  throw new MirrorUploadError(
    'UPLOAD_TIMEOUT',
    `固件上传超过 ${Math.round(timeoutMs / 60000)} 分钟仍未完成（文件 ${formatBytes(totalBytes)}）。`,
  );
}

/** 读取文件列表的表格行（按 td 拆分；整页 innerText 会把单元格混在一起，无法判断「已上传」是哪一行）。 */
async function readMirrorRows(page) {
  return page
    .evaluate(() => Array.from(document.querySelectorAll('tr'))
      .map((row) => Array.from(row.querySelectorAll('td')).map((cell) => String(cell.innerText ?? '').trim()))
      .filter((cells) => cells.length >= 6))
    .catch(() => []);
}

/** 解析平台的上传时间（形如 2026-11-08 00:08:53，平台时区与本机一致，按本地时间理解）。 */
function parseUploadTime(text) {
  const match = String(text ?? '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return NaN;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  ).getTime();
}

/**
 * 上传结束后在文件列表里按文件名过滤，确认平台侧确实出现了本次上传的记录行。
 * 列表每页 10 条、按上传时间升序；同名旧记录可能不止一条，所以既要按文件名过滤，
 * 也要按「本次上传开始时间之后」挑出本次那一行，避免把旧记录的 100.00% 误当成本次结果。
 * 另外平台对同名文件会「续传/沿用」已有的未完成记录（不新增行、上传时间也不变），
 * 这时没有新行可挑，但能观察到同名未完成行全部变成 100.00%，同样算本次确认成功。
 * 返回 { found, ok, platformStatus }：found=找到本次记录行，ok=已上传 100%（且没有「重新上传」按钮）。
 */
async function confirmUploadedRow(page, uploadFileName, uploadedAfter) {
  // 我们绕过「选择文件」直接往隐藏 input 塞文件，文件名规则提示框（带遮罩）会一直开着，先关掉它。
  const cancelButton = page.locator('.upload-tip-dialog').getByText('取消', { exact: true }).first();
  if (await cancelButton.isVisible().catch(() => false)) {
    await cancelButton.click({ timeout: 3000 }).catch(async () => {
      await page.keyboard.press('Escape').catch(() => {});
    });
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
  await page.locator('.upload-tip-dialog').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);

  const keyword = String(uploadFileName).replace(/\.(?:tar\.gz|tar\.bz2|tar\.xz|zip|7z|rar|tar)$/i, '');
  const searchInput = page.locator('input[placeholder="请输入文件名称"]').first();
  const cutoff = (Number(uploadedAfter) || Date.now()) - 120_000;
  let completedFallback = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await searchInput.count() === 0) return { found: false, ok: false, platformStatus: '' };
    await searchInput.fill(keyword).catch(() => {});
    await page.locator('div.btn3').filter({ hasText: '查询' }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1800);
    const rows = await readMirrorRows(page);
    const matched = rows.filter((cells) => {
      const name = String(cells[1] ?? '');
      return name === uploadFileName || name.includes(uploadFileName);
    });
    const incomplete = matched.filter((cells) => percentFromCell(cells[5]) < 100);
    if (incomplete.length > 0) {
      const row = incomplete[incomplete.length - 1];
      const uploaded = String(row[5] ?? '').replace(/\s+/g, ' ').trim();
      const uploadTime = String(row[3] ?? '').trim();
      return { found: true, ok: false, platformStatus: `同名记录仍未完成（${uploaded}，上传时间 ${uploadTime}）` };
    }
    const fresh = matched.filter((cells) => {
      const at = parseUploadTime(cells[3]);
      return Number.isFinite(at) && at >= cutoff;
    });
    if (fresh.length > 0) {
      const row = fresh[fresh.length - 1];
      const uploadTime = String(row[3] ?? '').trim();
      return {
        found: true,
        ok: true,
        platformStatus: `已上传 ${percentFromCell(row[5]).toFixed(2)}%（上传时间 ${uploadTime}）`,
      };
    }
    // 没有新行、但同名旧行全部已 100%：平台沿用了已有记录（续传），留到最后兜底。
    if (matched.length > 0) completedFallback = matched[matched.length - 1];
  }
  if (completedFallback) {
    const uploadTime = String(completedFallback[3] ?? '').trim();
    return {
      found: true,
      ok: true,
      platformStatus: `已上传 ${percentFromCell(completedFallback[5]).toFixed(2)}%（上传时间 ${uploadTime}，平台沿用了该文件已有的记录）`,
    };
  }
  return { found: false, ok: false, platformStatus: '' };
}

/** 从「已上传」单元格文本（形如 `100.00%` 或 `0.00% 重新上传`）取百分比数字；解析不到返回 0。 */
function percentFromCell(text) {
  const match = String(text ?? '').replace(/\s+/g, ' ').trim().match(/(\d+(?:\.\d+)?)%/);
  return match ? Number(match[1]) : 0;
}

/**
 * 启动浏览器。优先用 Playwright 自带 Chromium；没有下载浏览器时
 * fallback 到系统 Edge/Chrome（channel），避免第一次使用就卡在 BROWSER_LAUNCH_FAILED。
 */
async function launchBrowser() {
  const headless = process.env.OH_MIRROR_HEADLESS !== '0';
  try {
    return await chromium.launch({ headless });
  } catch (primaryError) {
    const channels = process.platform === 'win32' ? ['msedge', 'chrome'] : ['chrome'];
    for (const channel of channels) {
      try {
        return await chromium.launch({ headless, channel });
      } catch {
        // 继续尝试下一个通道
      }
    }
    throw new MirrorUploadError(
      'BROWSER_LAUNCH_FAILED',
      `无法启动浏览器（请先执行 pnpm exec playwright install chromium，或安装 Edge/Chrome）：${primaryError?.message ?? String(primaryError)}`,
    );
  }
}

function failureResult(error, { artifacts, resolution, uploadFileName, originalFileName, startedAt }) {
  return {
    ok: false,
    errorCode: error.code ?? 'UNEXPECTED_ERROR',
    message: error.message,
    artifacts: artifacts || '',
    fileName: uploadFileName || resolution?.fileName || '',
    originalFileName: originalFileName || resolution?.fileName || '',
    fileSize: resolution?.sizeBytes || 0,
    percent: 0,
    stage: '失败',
    durationMs: startedAt ? Date.now() - startedAt : 0,
  };
}

async function failEarly(error, context) {
  const result = failureResult(error, context);
  emitResult(result);
  console.error(`${result.errorCode}: ${result.message}`);
  if (result.artifacts) console.error(`Artifacts: ${result.artifacts}`);
  process.exitCode = 1;
}

async function main() {
  let options;
  try {
    options = parseMirrorArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  const resolution = resolveMirrorFile(options.input);
  if (!resolution.ok) {
    await failEarly(new MirrorUploadError(resolution.code || 'FILE_INVALID', resolution.problems.join(' ')), { resolution });
    return;
  }

  const originalFileName = resolution.fileName;
  const nameCheck = validateMirrorFileName(originalFileName);
  let renamedFileName = '';
  if (!nameCheck.ok) {
    if (!options.rename) {
      await failEarly(
        new MirrorUploadError(
          'INVALID_FILE_NAME',
          `${nameCheck.problems.join(' ')}请先重命名固件文件，或加 --rename 让脚本复制一份净化后的临时副本再上传。`,
        ),
        { resolution },
      );
      return;
    }
    renamedFileName = String(nameCheck.sanitized || '').trim();
    const sanitizedCheck = validateMirrorFileName(renamedFileName);
    if (!renamedFileName || !sanitizedCheck.ok) {
      await failEarly(
        new MirrorUploadError(
          'RENAME_FAILED',
          `无法把文件名净化为平台允许的格式：${originalFileName} → ${renamedFileName || '（空）'}`,
        ),
        { resolution },
      );
      return;
    }
  }
  const uploadFileName = renamedFileName || originalFileName;

  if (options.dryRun) {
    const notes = [`本地校验通过：${originalFileName}（${formatBytes(resolution.sizeBytes)}）`];
    if (renamedFileName) notes.push(`文件名不合规，上传时会用临时副本「${renamedFileName}」`);
    notes.push('未上传（--dry-run）');
    const result = {
      ok: true,
      dryRun: true,
      fileName: uploadFileName,
      originalFileName,
      fileSize: resolution.sizeBytes,
      extension: resolution.extension,
      percent: 0,
      stage: '校验通过',
      platformStatus: '',
      message: notes.join('；'),
      problems: [],
      artifacts: '',
      renamed: Boolean(renamedFileName),
    };
    emitResult(result);
    console.error(result.message);
    return;
  }

  const artifacts = artifactDirectory(options.artifacts);
  await fs.mkdir(artifacts, { recursive: true });

  const username = process.env.OH_USERNAME;
  const password = process.env.OH_PASSWORD;
  if (!username || !password) {
    await failEarly(
      new MirrorUploadError('CREDENTIALS_MISSING', '缺少平台账号密码：请设置 OH_USERNAME 与 OH_PASSWORD 环境变量后再上传。'),
      { artifacts, resolution, uploadFileName, originalFileName },
    );
    return;
  }

  const timeoutMs = uploadTimeoutMs();
  const startedAt = Date.now();
  let browser;
  let page;
  let temporaryDirectory = '';
  let uploadPath = resolution.path;
  try {
    if (renamedFileName) {
      temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-mirror-rename-'));
      uploadPath = path.join(temporaryDirectory, renamedFileName);
      try {
        await fs.copyFile(resolution.path, uploadPath);
      } catch (error) {
        throw new MirrorUploadError('RENAME_FAILED', `无法创建净化文件名的临时副本：${error?.message ?? String(error)}`);
      }
    }
    emitProgress({
      percent: 0,
      stage: '准备',
      detail: `准备上传 ${uploadFileName}（${formatBytes(resolution.sizeBytes)}）`,
      uploadedBytes: 0,
      totalBytes: resolution.sizeBytes,
      speedBytesPerSecond: 0,
    });

    browser = await launchBrowser();
    const context = await browser.newContext();
    page = await context.newPage();
    page.setDefaultTimeout(20_000);

    await signIn(page, artifacts, username, password);
    await openMirrorPage(page, artifacts);
    await openUploadTip(page, artifacts);

    if (process.env.OH_MIRROR_NAV_ONLY === '1') {
      await safeScreenshot(page, artifacts, 'mirror-upload-ready');
      const result = {
        ok: true,
        navOnly: true,
        fileName: uploadFileName,
        originalFileName,
        fileSize: resolution.sizeBytes,
        percent: 0,
        stage: '预检通过',
        platformStatus: '',
        message: '已登录并到达镜像管理页，文件名规则提示框已出现（未选择文件、未上传）。',
        artifacts,
        durationMs: Date.now() - startedAt,
      };
      await writeResult(artifacts, result);
      emitResult(result);
      console.error(result.message);
      return;
    }

    const uploadStartedAt = Date.now();
    await startUpload(page, uploadPath);
    const completion = await pollUpload(page, {
      uploadFileName,
      totalBytes: resolution.sizeBytes,
      artifacts,
      timeoutMs,
    });
    // 完成判定之后再回到文件列表按文件名过滤，确认平台侧确实出现了本次上传的记录行（新文件在最后一页，必须搜索）。
    const confirmation = await confirmUploadedRow(page, uploadFileName, uploadStartedAt);
    await safeScreenshot(page, artifacts, 'upload-complete');
    if (confirmation.found && !confirmation.ok) {
      throw new MirrorUploadError('UPLOAD_FAILED', `平台文件列表里本次记录没有完成：${confirmation.platformStatus}`);
    }
    const platformStatus = confirmation.platformStatus || completion.platformStatus || '上传进度已到 100%';
    const result = {
      ok: true,
      fileName: uploadFileName,
      originalFileName,
      fileSize: resolution.sizeBytes,
      extension: resolution.extension,
      percent: 100,
      stage: '完成',
      platformStatus,
      message: `固件上传完成：${platformStatus}`,
      artifacts,
      renamed: Boolean(renamedFileName),
      completionSource: completion.completionSource,
      recordConfirmed: confirmation.ok,
      durationMs: Date.now() - startedAt,
    };
    await writeResult(artifacts, result);
    emitResult(result);
    console.error(`[mirror] ${result.message}（耗时 ${(result.durationMs / 1000).toFixed(1)}s，截图：${artifacts}）`);
  } catch (error) {
    const failure = error instanceof MirrorUploadError ? error : new MirrorUploadError('UNEXPECTED_ERROR', error?.message ?? String(error));
    await captureFailureState(page, artifacts);
    const result = failureResult(failure, { artifacts, resolution, uploadFileName, originalFileName, startedAt });
    await writeResult(artifacts, result);
    emitResult(result);
    console.error(`${result.errorCode}: ${result.message}`);
    console.error(`Artifacts: ${artifacts}`);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
    if (temporaryDirectory) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }
}

await main();
