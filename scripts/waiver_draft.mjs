import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { isSafeSaveLabel, normalizeText, parseArgs, validateInput, waiverMatchForInput } from './waiver_logic.mjs';

const LOGIN_ENTRY_URL = 'https://compatibility.openharmony.cn/#/personal';
const PERSONAL_URL = 'https://compatibility.openharmony.cn/console/#/personal';
const VERIFICATION_MARKERS = /验证码|captcha|短信验证|手机验证|安全验证|人机验证/i;
const execFileAsync = promisify(execFile);

class WaiverError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function usage() {
  return `Usage:
  OH_USERNAME='...' OH_PASSWORD='...' node scripts/waiver_draft.mjs --input /absolute/input.json [--dry-run|--save] [--artifacts /absolute/dir]

--dry-run 只做查重预检、不打开创建申请；--save 只点击精确“保存/暂存”按钮。系统类型/操作系统版本号由测评编号反查，输入 JSON 不需要提供。`;
}

function artifactDirectory(requestedDirectory) {
  if (requestedDirectory) {
    return path.resolve(requestedDirectory);
  }
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  return path.join(os.tmpdir(), `oh-waiver-${stamp}`);
}

async function writeResult(artifacts, result) {
  await fs.writeFile(path.join(artifacts, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
}

async function safeScreenshot(page, artifacts, name, redact = false) {
  if (redact) {
    await page.locator('input[type="password"], input[name*="password" i]').evaluateAll((inputs) => {
      for (const input of inputs) {
        input.value = '';
        input.placeholder = '[redacted]';
      }
    }).catch(() => {});
  }
  await page.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage: true }).catch(() => {});
}

async function throwIfVerificationRequired(page, artifacts) {
  const text = await page.locator('body').innerText().catch(() => '');
  if (VERIFICATION_MARKERS.test(text)) {
    await safeScreenshot(page, artifacts, 'human-verification-required', true);
    throw new WaiverError(
      'HUMAN_VERIFICATION_REQUIRED',
      'A captcha, SMS, or other human verification was detected. Screenshot saved; no bypass was attempted.',
    );
  }
}

async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function signIn(page, artifacts, username, password) {
  await page.goto(LOGIN_ENTRY_URL, { waitUntil: 'domcontentloaded' });
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
      throw new WaiverError('LOGIN_FORM_UNRECOGNIZED', 'The OpenAtom login page did not expose an account/password form.');
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
    throw new WaiverError('LOGIN_FORM_UNRECOGNIZED', 'Password field found but no username field was found.');
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
    throw new WaiverError('LOGIN_BUTTON_UNRECOGNIZED', 'Username and password fields were found but no login button was found.');
  }
  await loginButton.click();
  await page.waitForTimeout(1500);
  await throwIfVerificationRequired(page, artifacts);

  if (await passwordInput.isVisible().catch(() => false)) {
    await safeScreenshot(page, artifacts, 'login-failed', true);
    throw new WaiverError('LOGIN_FAILED', 'Login did not leave the password screen. Screenshot saved.');
  }

  if (page.url().includes('legacy.openatom.cn/oauth/authorize')) {
    const authorizeButton = page.getByRole('button', { name: '授权', exact: true }).first();
    if (!await authorizeButton.isVisible().catch(() => false)) {
      await safeScreenshot(page, artifacts, 'oauth-consent-unrecognized');
      throw new WaiverError('OAUTH_CONSENT_UNRECOGNIZED', 'OAuth consent page did not expose an exact 授权 button.');
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

async function clickExactText(page, value) {
  const matches = page.getByText(value, { exact: true });
  for (let index = 0; index < await matches.count(); index += 1) {
    const exact = matches.nth(index);
    if (await exact.isVisible().catch(() => false)) {
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
  }
  return false;
}

async function hasVisibleText(page, value) {
  const matches = page.getByText(value, { exact: false });
  for (let index = 0; index < await matches.count(); index += 1) {
    if (await matches.nth(index).isVisible().catch(() => false)) {
      return true;
    }
  }
  return false;
}

async function clickVisibleExactText(page, value) {
  const matches = page.getByText(value, { exact: true });
  for (let index = 0; index < await matches.count(); index += 1) {
    const match = matches.nth(index);
    if (await match.isVisible().catch(() => false)) {
      await match.click();
      return true;
    }
  }
  return false;
}

async function findExistingWaiver(page, input) {
  // 不预选状态筛选（默认查询全部状态），避免只查“待提交”而漏掉已提交/已通过的同键记录。
  const search = page.locator('input[placeholder="测评编号、模块名称、测试套名称、测试用例名称"]').first();
  await search.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
  if (!await search.isVisible().catch(() => false)) {
    throw new WaiverError('DUPLICATE_LOOKUP_UNAVAILABLE', 'Could not find the waiver-list search field.');
  }
  await search.fill(input.assessmentNumber);
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/certificate/exempt/list')
      && response.request().method() === 'POST'
      && (response.request().postData() || '').includes(input.assessmentNumber),
    { timeout: 15_000 },
  );
  if (!await clickExactText(page, '查询')) {
    throw new WaiverError('DUPLICATE_LOOKUP_UNAVAILABLE', 'Could not find the waiver-list query action.');
  }
  const response = await responsePromise.catch(() => null);
  const payload = await response?.json().catch(() => null);
  if (payload?.code !== 200 || !Array.isArray(payload.body?.rows)) {
    throw new WaiverError('DUPLICATE_LOOKUP_FAILED', 'The waiver-list query did not return a valid result.');
  }
  const total = Number(payload.body.total) || payload.body.rows.length;
  if (total > payload.body.rows.length) {
    throw new WaiverError('DUPLICATE_LOOKUP_INCOMPLETE', 'The waiver-list query returned more rows than one page; no application was created.');
  }
  const matching = payload.body.rows.filter((row) => waiverMatchForInput(row, input));
  if (matching.length === 0) return null;
  const statuses = matching.map((row) => Number(row.status)).filter((value) => Number.isFinite(value));
  // status: 0=待提交 1=审核中 2=豁免成功 3=豁免失败。0/1/2 都不再创建；只有 3 允许重新申请。
  if (statuses.some((status) => status === 0 || status === 1 || status === 2)) {
    return { rows: matching, statuses };
  }
  return null;
}
async function navigateToApplication(page, artifacts, input, dryRun) {
  if (!page.url().includes('/console/')) {
    await page.goto(PERSONAL_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
  }
  await throwIfVerificationRequired(page, artifacts);

  if (await hasVisibleText(page, '豁免原因')) {
    return;
  }
  const search = page.locator('input[placeholder="测评编号、模块名称、测试套名称、测试用例名称"]').first();
  if (!await search.isVisible().catch(() => false)) {
    if (!await hasVisibleText(page, '豁免申请')) {
      await clickExactText(page, '兼容性测评');
      await page.waitForTimeout(500);
    }
    if (!await hasVisibleText(page, '豁免申请') || !await clickExactText(page, '豁免申请')) {
      throw new WaiverError('WAIVER_MENU_NOT_FOUND', 'Could not find the visible 豁免申请 menu item.');
    }
  }
  await search.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  if (!await search.isVisible().catch(() => false)) {
    await safeScreenshot(page, artifacts, 'waiver-list-not-found');
    throw new WaiverError('WAIVER_LIST_NOT_FOUND', 'The waiver-list search field did not become visible.');
  }
  const existing = await findExistingWaiver(page, input);
  if (existing) {
    await safeScreenshot(page, artifacts, 'existing-waiver-found');
    const ids = existing.rows.map((row) => String(row.id)).join(', ');
    if (existing.statuses.includes(0)) {
      throw new WaiverError('PENDING_DUPLICATE_FOUND', 'Matching 待提交 waiver found: ' + ids + '. No new application was created.');
    }
    if (existing.statuses.includes(1)) {
      throw new WaiverError('EXISTING_WAIVER_UNDER_REVIEW', 'Matching waiver already submitted for review: ' + ids + '. No new application was created.');
    }
    throw new WaiverError('EXISTING_WAIVER_APPROVED', 'Matching waiver already approved: ' + ids + '. No new application was created.');
  }
  if (dryRun) {
    await safeScreenshot(page, artifacts, 'waiver-list-preflight');
    return false;
  }
  if (!await clickExactText(page, '创建申请')) {
    throw new WaiverError('CREATE_ACTION_NOT_FOUND', 'Could not find the visible 创建申请 action.');
  }
  await page.waitForTimeout(800);
  await throwIfVerificationRequired(page, artifacts);

  if (!await hasVisibleText(page, '豁免原因')) {
    await safeScreenshot(page, artifacts, 'application-form-not-found');
    throw new WaiverError('APPLICATION_FORM_NOT_FOUND', 'Could not reach the Create Waiver Application form.');
  }
  return true;
}

async function inputByPlaceholder(page, placeholder) {
  const input = page.locator(`input[placeholder="${placeholder}"], textarea[placeholder="${placeholder}"]`).first();
  if (!await input.isVisible().catch(() => false)) {
    throw new WaiverError('FIELD_NOT_FOUND', `Could not find form field: ${placeholder}`);
  }
  return input;
}

async function fillByPlaceholder(page, placeholder, value) {
  const input = await inputByPlaceholder(page, placeholder);
  if (await input.isDisabled().catch(() => false) || await input.getAttribute('readonly').catch(() => null) !== null) {
    const actual = await input.inputValue();
    if (actual !== value) {
      throw new WaiverError('FIELD_VALUE_MISMATCH', `Read-only field ${placeholder} does not match its requested value.`);
    }
    return;
  }
  await input.fill(value);
  const actual = await input.inputValue();
  if (actual !== value) {
    throw new WaiverError('FIELD_VALUE_MISMATCH', `Field ${placeholder} did not retain its value.`);
  }
}

async function selectByPlaceholder(page, placeholder, value) {
  const input = await inputByPlaceholder(page, placeholder);
  if (await input.inputValue().catch(() => '') === value) {
    return;
  }
  let lastOptions = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await input.click().catch(() => {});
    await page.waitForTimeout(400);
    const options = page.locator('li.el-select-dropdown__item:visible');
    const count = await options.count();
    lastOptions = [];
    for (let index = 0; index < count; index += 1) {
      const option = options.nth(index);
      const text = normalizeText(await option.innerText().catch(() => ''));
      lastOptions.push(text);
      if (text === normalizeText(value)) {
        await option.click();
        await page.waitForTimeout(400);
        if (await input.inputValue().catch(() => '') === value) {
          return;
        }
      }
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(600);
  }
  throw new WaiverError('OPTION_NOT_FOUND', 'Option ' + value + ' was not available for ' + placeholder + '. Visible options: ' + lastOptions.slice(0, 60).join(' | '));
}

async function selectChipModel(page, value) {
  const input = page.locator('input[placeholder="请选择芯片型号"]').first();
  if (!await input.isVisible().catch(() => false)) {
    return false;
  }
  let lastOptions = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await input.click().catch(() => {});
    await page.waitForTimeout(400);
    const options = page.locator('li.el-select-dropdown__item:visible');
    const count = await options.count();
    lastOptions = [];
    for (let index = 0; index < count; index += 1) {
      const option = options.nth(index);
      const text = normalizeText(await option.innerText().catch(() => ''));
      lastOptions.push(text);
      if (text === normalizeText(value)) {
        await option.click();
        await page.waitForTimeout(400);
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
        return true;
      }
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(600);
  }
  throw new WaiverError('CHIP_SELECTION_FAILED', 'Chip model ' + value + ' was not available. Visible options: ' + lastOptions.slice(0, 60).join(' | '));
}

async function fillApplication(page, artifacts, input) {
  const assessment = await inputByPlaceholder(page, '请输入测评编号');
  await assessment.fill(input.assessmentNumber);
  await assessment.press('Tab');
  await page.waitForTimeout(500);
  await selectByPlaceholder(page, '请选择操作系统类型', input.systemType);
  await selectByPlaceholder(page, '请选择操作系统版本号', input.osVersion);
  if (input.chipModel) {
    await selectChipModel(page, input.chipModel);
  }
  await selectByPlaceholder(page, '请选择测试套分类', input.testCategory);
  await fillByPlaceholder(page, '请输入模块名称，仅可输入一个', input.moduleName);
  if (input.testsuite) {
    await fillByPlaceholder(page, '请输入测试套名称，若输入仅可输入一个，不输入则默认为整个模块豁免', input.testsuite);
  }
  if (input.testcases?.length) {
    await fillByPlaceholder(page, '支持输入多条测试用例名称，需用英文逗号隔开，不输入则默认为整个测试套豁免', input.testcases.join(','));
  }
  await fillByPlaceholder(page, '请输入豁免原因', input.waiverReason);

  const attachment = page.locator('input[type="file"]').first();
  if (!await attachment.count()) {
    throw new WaiverError('ATTACHMENT_FIELD_NOT_FOUND', 'Could not find the attachment upload control.');
  }
  const uploadPromise = page.waitForResponse(
    (response) => response.url().endsWith('/certificate/fileUpload/upload') && response.request().method() === 'POST',
    { timeout: 20_000 },
  );
  await attachment.setInputFiles(input.attachmentPath);
  const uploadResponse = await uploadPromise.catch(() => null);
  const upload = await uploadResponse?.json().catch(() => null);
  if (upload?.code !== 200) {
    throw new WaiverError('ATTACHMENT_UPLOAD_FAILED', 'The attachment upload did not return success.');
  }
  await throwIfVerificationRequired(page, artifacts);
}

async function findSafeSaveButton(page) {
  const controls = page.locator('button, [role="button"], input[type="button"], input[type="submit"]');
  const count = await controls.count();
  const unsafeLabels = [];
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    if (!await control.isVisible().catch(() => false)) {
      continue;
    }
    const label = normalizeText((await control.getAttribute('value')) || (await control.innerText().catch(() => '')));
    if (isSafeSaveLabel(label)) {
      return control;
    }
    if (/提交|确认|申请/.test(label)) {
      unsafeLabels.push(label);
    }
  }
  const detail = unsafeLabels.length ? ` Unsafe controls: ${unsafeLabels.join(', ')}.` : '';
  throw new WaiverError('SAFE_SAVE_ACTION_NOT_FOUND', `No exact 保存 or 暂存 action was found.${detail}`);
}

async function verifySaved(page) {
  const text = await page.locator('body').innerText().catch(() => '');
  if (!/保存成功|暂存成功|草稿保存成功|操作成功/.test(text)) {
    throw new WaiverError('SAVE_RESULT_UNCLEAR', 'The save control was clicked but no unambiguous save-success message was found.');
  }
  return text.match(/(?:保存成功|暂存成功|草稿保存成功|操作成功)/)?.[0] ?? 'success';
}

async function loadInput(inputPath) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(path.resolve(inputPath), 'utf8'));
  } catch (error) {
    throw new WaiverError('INPUT_READ_FAILED', `Could not read input JSON: ${error.message}`);
  }
  try {
    return validateInput(parsed);
  } catch (error) {
    throw new WaiverError('INPUT_INVALID', error.message);
  }
}

async function prepareAttachment(sourcePath, artifacts) {
  const source = await fs.stat(sourcePath).catch(() => null);
  if (!source) {
    throw new WaiverError('ATTACHMENT_INVALID', 'attachmentPath does not point to a readable file or directory.');
  }
  if (!source.isFile()) {
    throw new WaiverError('ATTACHMENT_INVALID', 'attachmentPath 必须是可读文件（目录附件请先归档为 zip 再传入）。');
  }
  return sourcePath;
}

async function lookupAssessment(page, assessmentNumber) {
  const result = await page.evaluate(async ({ assessment }) => {
    const token = localStorage.getItem('Token') || '';
    const headers = { language: 'zh', 'access-token': token, 'Content-Type': 'application/json' };
    const certResponse = await fetch('/certificate/exempt/checkCertification?number=' + encodeURIComponent(assessment), { headers });
    const certification = await certResponse.json();
    const dicts = {};
    for (const itemType of ['os_type', 'os_version', 'test_type']) {
      const dictResponse = await fetch('/certificate/dictController/getDict', {
        method: 'POST', headers, body: JSON.stringify({ itemType, isDelete: '0' }),
      });
      const payload = await dictResponse.json();
      dicts[itemType] = Array.isArray(payload && payload.body) ? payload.body : [];
    }
    return { certification: certification, dicts: dicts };
  }, { assessment: assessmentNumber });
  const cert = result && result.certification && result.certification.body;
  if (!cert || !cert.id) {
    throw new WaiverError('ASSESSMENT_LOOKUP_FAILED', '测评编号 ' + assessmentNumber + ' 反查失败（checkCertification 未返回可用记录）。');
  }
  const labelOf = function (itemType, id) {
    const options = result.dicts[itemType] || [];
    const found = options.find(function (item) { return String(item.id) === String(id); });
    return found ? found.itemName : null;
  };
  const systemTypeName = labelOf('os_type', cert.systemType);
  const systemVersionName = labelOf('os_version', cert.systemVersion);
  if (!systemTypeName || !systemVersionName) {
    throw new WaiverError('ASSESSMENT_DICT_MISMATCH', '测评编号 ' + assessmentNumber + ' 的系统类型/版本在平台字典中无对应项。');
  }
  const testTypes = (result.dicts.test_type || []).map(function (item) { return item.itemName; });
  return { systemTypeName: systemTypeName, systemVersionName: systemVersionName, certificationId: cert.id, chipList: cert.chipList, testTypes: testTypes };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
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

  const artifacts = artifactDirectory(options.artifacts);
  await fs.mkdir(artifacts, { recursive: true });
  let browser;
  try {
    const input = await loadInput(options.input);
    const attachmentPath = await prepareAttachment(input.attachmentPath, artifacts);
    let preparedInput = { ...input, attachmentPath };
    const username = process.env.OH_USERNAME;
    const password = process.env.OH_PASSWORD;
    if (!username || !password) {
      throw new WaiverError('CREDENTIALS_MISSING', 'OH_USERNAME and OH_PASSWORD must be set as temporary environment variables.');
    }

    browser = await chromium.launch({ headless: process.env.OH_WAIVER_HEADLESS !== '0' });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);

    await signIn(page, artifacts, username, password);
    const derived = await lookupAssessment(page, input.assessmentNumber);
    console.log('ASSESSMENT_DERIVED: ' + JSON.stringify({ systemType: derived.systemTypeName, systemVersion: derived.systemVersionName, certificationId: derived.certificationId }));
    preparedInput = { ...preparedInput, systemType: derived.systemTypeName, osVersion: derived.systemVersionName };
    if (Array.isArray(derived.testTypes) && derived.testTypes.length > 0 && !derived.testTypes.includes(input.testCategory)) {
      throw new WaiverError('TEST_CATEGORY_NOT_AVAILABLE', '测试套分类 ' + input.testCategory + ' 不在平台字典中，可用值：' + derived.testTypes.join(' / '));
    }
    if (process.env.OH_LOOKUP_ONLY === '1') {
      await writeResult(artifacts, { status: 'assessment-lookup', derived: derived, artifacts: artifacts });
      console.log('Lookup only: no draft created. Artifacts: ' + artifacts);
      return;
    }
    const formOpened = await navigateToApplication(page, artifacts, input, options.dryRun);
    if (!formOpened) {
      const preflightSummary = { status: 'preflight-complete', action: 'none', artifacts: artifacts, assessmentNumber: input.assessmentNumber, moduleName: input.moduleName, derived: derived };
      await writeResult(artifacts, preflightSummary);
      console.log('WAIVER_RESULT_JSON=' + JSON.stringify(preflightSummary));
      console.log(`Dry run completed. No application was created. Artifacts: ${artifacts}`);
      return;
    }
    await fillApplication(page, artifacts, preparedInput);
    await safeScreenshot(page, artifacts, 'before-save');
    if (process.env.OH_FILL_ONLY === '1') {
      const filledSummary = { status: 'filled', action: 'none', artifacts: artifacts, derived: derived };
      await writeResult(artifacts, filledSummary);
      console.log('WAIVER_RESULT_JSON=' + JSON.stringify(filledSummary));
      console.log('Fill only: form filled but save was NOT clicked. Artifacts: ' + artifacts);
      return;
    }

    const saveButton = await findSafeSaveButton(page);
    await saveButton.click();
    await page.waitForTimeout(800);
    await throwIfVerificationRequired(page, artifacts);
    const statusText = await verifySaved(page);
    await safeScreenshot(page, artifacts, 'saved');
    const savedSummary = { status: 'saved', action: 'save-draft', message: statusText, artifacts: artifacts, assessmentNumber: input.assessmentNumber, moduleName: input.moduleName, testsuite: input.testsuite, testcases: input.testcases, derived: derived };
    await writeResult(artifacts, savedSummary);
    console.log('WAIVER_RESULT_JSON=' + JSON.stringify(savedSummary));
    console.log(`Draft saved. Artifacts: ${artifacts}`);
  } catch (error) {
    try {
      const pages = browser?.contexts().flatMap((context) => context.pages()) ?? [];
      const failedPage = pages[0];
      if (failedPage) {
        await failedPage.screenshot({ path: path.join(artifacts, 'error-state.png'), fullPage: true }).catch(() => {});
        const stateText = await failedPage.locator('body').innerText().catch(() => '');
        await fs.writeFile(path.join(artifacts, 'error-state.txt'), stateText.slice(0, 20000)).catch(() => {});
      }
    } catch {}
    const code = error instanceof WaiverError ? error.code : 'UNEXPECTED_ERROR';
    const message = error instanceof Error ? error.message : String(error);
    const stoppedSummary = { status: 'stopped', code: code, message: message, artifacts: artifacts };
    await writeResult(artifacts, stoppedSummary).catch(() => {});
    console.log('WAIVER_RESULT_JSON=' + JSON.stringify(stoppedSummary));
    console.error(`${code}: ${message}`);
    console.error(`Artifacts: ${artifacts}`);
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
}

await main();
