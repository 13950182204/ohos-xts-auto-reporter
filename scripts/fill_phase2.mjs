import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  assertOnlySafeSaveLabels,
  encodeVersionId,
  expectedSoftwareValues,
  derivePhase2AttachmentPaths,
  isAssessmentNumber,
  normalizeComparable,
  normalizeText,
  readPhase2Workbook,
  toWslPath,
  writeWorkbookState,
} from './phase2_logic.mjs';

const LOGIN_ENTRY_URL = 'https://compatibility.openharmony.cn/#/personal';
const VERIFICATION_MARKERS = /验证码|captcha|短信验证|手机验证|安全验证|人机验证/i;
// The report row is generated asynchronously after software definition enters
// step 4. The observed platform delay can exceed the old 10-second window.
const REPORT_RELATION_MAX_WAIT_MS = 2 * 60 * 1000;
const REPORT_RELATION_POLL_INTERVAL_MS = 1000;
const REPORT_RELATION_INITIALIZE_RETRY_MS = 30 * 1000;

function reportProgress(percent, stage, detail = '') {
  console.log(`PHASE2_PROGRESS=${JSON.stringify({ percent, stage, detail })}`);
}

class ApplicationError extends Error {
  constructor(code, message, { global = false } = {}) {
    super(message);
    this.code = code;
    this.global = global;
  }
}

function parseArgs(argv) {
  const options = { mode: 'dry-run', workbook: null, artifacts: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--phase2') {
      continue;
    }
    if (argument === '--dry-run') {
      if (options.mode === 'save') {
        throw new Error('--dry-run cannot be combined with --save');
      }
      options.mode = 'dry-run';
    } else if (argument === '--save') {
      options.mode = 'save';
    } else if (argument === '--workbook' || argument === '--artifacts') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a value`);
      }
      options[argument.slice(2)] = value;
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.help && !options.workbook) {
    throw new Error('没有提供对应的申请表格文件，已停止执行。');
  }
  return options;
}

function usage() {
  return `Usage:
  OH_USERNAME='...' OH_PASSWORD='...' fill_phase2.mjs --phase2 --workbook ABSOLUTE_PATH [--dry-run|--save] [--artifacts DIR]

This tool saves phase-2 definitions, advances only to the report-upload stage when attachments are configured, saves XTS/PCS attachments and the selected mirror, and never submits or enters sample shipping.`;
}

function artifactDirectory(requested, workbookPath) {
  if (requested) {
    return path.resolve(requested);
  }
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  return path.join(path.dirname(workbookPath), `OpenHarmony兼容性申请_第二阶段_结果_${stamp}`);
}

async function writeResult(artifacts, result) {
  await fs.writeFile(path.join(artifacts, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
}

async function screenshot(page, artifacts, name, redact = false) {
  if (redact) {
    await page.locator('input[type="password"], input[autocomplete="username"], input[placeholder="用户账号"]').evaluateAll((inputs) => {
      for (const input of inputs) {
        input.value = '';
        input.placeholder = '[redacted]';
      }
    }).catch(() => {});
  }
  await page.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage: true }).catch(() => {});
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

async function throwIfVerificationRequired(page, artifacts) {
  const text = await page.locator('body').innerText().catch(() => '');
  if (VERIFICATION_MARKERS.test(text)) {
    await screenshot(page, artifacts, 'human-verification-required', true);
    throw new ApplicationError('HUMAN_VERIFICATION_REQUIRED', '检测到人工验证，未尝试绕过。', { global: true });
  }
}

async function clickExactText(page, value) {
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

async function signIn(page, artifacts, username, password) {
  await page.goto(LOGIN_ENTRY_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await throwIfVerificationRequired(page, artifacts);

  const passwordInput = await firstVisible(page, ['input[placeholder="用户密码"]', 'input[type="password"]']);
  if (!passwordInput) {
    return;
  }
  const usernameInput = await firstVisible(page, ['input[placeholder="用户账号"]', 'input[type="text"]', 'input:not([type])']);
  const loginButton = await firstVisible(page, ['button:has-text("用户登录")', 'button:has-text("登录")', 'input[type="submit"]']);
  if (!usernameInput || !loginButton) {
    throw new ApplicationError('LOGIN_FORM_UNRECOGNIZED', '无法识别账号密码登录控件。', { global: true });
  }
  await usernameInput.fill(username);
  await passwordInput.fill(password);
  await loginButton.click();
  await page.waitForTimeout(1500);
  await throwIfVerificationRequired(page, artifacts);
  if (await passwordInput.isVisible().catch(() => false)) {
    await screenshot(page, artifacts, 'login-failed', true);
    throw new ApplicationError('LOGIN_FAILED', '登录后仍停留在密码页面。', { global: true });
  }
  if (page.url().includes('legacy.openatom.cn/oauth/authorize')) {
    const authorize = page.getByRole('button', { name: '授权', exact: true }).first();
    if (!await authorize.isVisible().catch(() => false)) {
      await screenshot(page, artifacts, 'oauth-consent-unrecognized', true);
      throw new ApplicationError('OAUTH_CONSENT_UNRECOGNIZED', 'OAuth 授权控件不明确。', { global: true });
    }
    await authorize.click();
    await page.waitForTimeout(1500);
    await throwIfVerificationRequired(page, artifacts);
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const token = await page.evaluate(() => {
      try { return localStorage.getItem('Token') || ''; } catch { return ''; }
    }).catch(() => '');
    if (token) return;
    await page.waitForTimeout(500);
  }
  await screenshot(page, artifacts, 'login-token-missing', true);
  throw new ApplicationError('LOGIN_TOKEN_MISSING', '登录回调未返回平台会话令牌。', { global: true });
}

async function navigateToCertificationList(page, artifacts) {
  if (page.url().includes('#/index')) return;
  const menuTitle = page.getByText('兼容性测评', { exact: true });
  let expanded = false;
  for (let index = 0; index < await menuTitle.count(); index += 1) {
    const item = menuTitle.nth(index);
    if (!await item.isVisible().catch(() => false)) {
      continue;
    }
    const title = item.locator('xpath=ancestor::div[contains(@class, "el-submenu__title")][1]');
    if (await title.isVisible().catch(() => false)) {
      await title.click();
      expanded = true;
      break;
    }
  }
  if (!expanded) {
    throw new ApplicationError('COMPATIBILITY_MENU_NOT_FOUND', '无法展开兼容性测评菜单。', { global: true });
  }
  await page.waitForTimeout(300);
  const listEntry = page.locator('li.el-menu-item.d3:visible').first();
  if (!await listEntry.isVisible().catch(() => false)) {
    throw new ApplicationError('CERTIFICATION_LIST_NOT_FOUND', '未找到兼容性申请列表。', { global: true });
  }
  await listEntry.click();
  await page.waitForURL(/#\/index(?:\?|$)/, { timeout: 15_000 });
  await page.waitForTimeout(500);
  await throwIfVerificationRequired(page, artifacts);
}

async function navigateToNewApplication(page, artifacts) {
  await navigateToCertificationList(page, artifacts);
  if (!await clickExactText(page, '创建申请')) {
    throw new ApplicationError('CREATE_ACTION_NOT_FOUND', '未找到创建申请控件。');
  }
  await page.waitForURL(/#\/certification\/create/, { timeout: 15_000 });
  await page.waitForTimeout(500);
}

function platformUrl(page, endpoint) {
  return new URL(`/certificate${endpoint}`, page.url()).toString();
}

async function platformRequest(page, endpoint, options = {}) {
  const token = await page.evaluate(() => localStorage.getItem('Token') || '');
  const headers = { language: 'zh', ...(options.headers || {}) };
  if (token) headers['access-token'] = token;
  const requestOptions = {
    ...options,
    headers,
    // RK3568 report archives can exceed 250 MB; the default 30s request limit
    // is too short for the platform's multipart processing.
    timeout: options.timeout ?? (options.multipart ? 15 * 60 * 1000 : 30_000),
  };
  const response = await page.context().request.fetch(platformUrl(page, endpoint), requestOptions);
  const payload = await response.json().catch(() => null);
  if (!response.ok() || payload?.code !== 200) {
    const message = payload?.msg || `平台接口失败: ${endpoint}`;
    const detail = payload?.body?.message || payload?.body?.msg || payload?.body?.error || '';
    throw new ApplicationError('PLATFORM_REQUEST_FAILED', `${message}${detail ? ` (${detail})` : ''} [${endpoint}, HTTP ${response.status()}]`);
  }
  return payload.body;
}

async function findApplication(page, assessmentNumber) {
  const input = await firstVisible(page, ['input[placeholder="请输入测评编号"]']);
  if (!input) {
    throw new ApplicationError('ASSESSMENT_SEARCH_NOT_FOUND', '未找到测评编号查询框。');
  }
  await input.fill(assessmentNumber);
  if (!await clickExactText(page, '查询')) {
    throw new ApplicationError('ASSESSMENT_SEARCH_ACTION_NOT_FOUND', '未找到查询控件。');
  }
  await page.waitForTimeout(800);
  const rows = page.locator('table tbody tr');
  let targetRow = null;
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index);
    if (normalizeText(await row.innerText().catch(() => '')).includes(assessmentNumber)) {
      targetRow = row;
      break;
    }
  }
  if (!targetRow) {
    throw new ApplicationError('ASSESSMENT_NOT_FOUND', `未找到测评编号 ${assessmentNumber}。`);
  }
  const edit = targetRow.getByText('编辑', { exact: true }).first();
  if (!await edit.isVisible().catch(() => false)) {
    throw new ApplicationError('APPLICATION_NOT_EDITABLE', `${assessmentNumber} 当前不可编辑。`);
  }
  await edit.click();
  await page.waitForURL(/#\/certification\/create/, { timeout: 15_000 });
  await page.waitForTimeout(700);
  const applicationId = new URL(page.url()).searchParams.get('id');
  if (!applicationId) {
    throw new ApplicationError('APPLICATION_ID_MISSING', '编辑页未提供申请标识。');
  }
  return applicationId;
}

async function getApplication(page, applicationId) {
  return platformRequest(page, `/certification/getCertificationInfoById?id=${encodeURIComponent(applicationId)}`, { method: 'GET' });
}

async function contactInputForLabel(page, label) {
  const labels = page.getByText(`${label}：`, { exact: true });
  for (let index = 0; index < await labels.count(); index += 1) {
    const text = labels.nth(index);
    if (!await text.isVisible().catch(() => false)) continue;
    const item = text.locator('xpath=ancestor::div[contains(@class, "el-form-item")][1]');
    const input = item.locator('input').first();
    if (await input.isVisible().catch(() => false)) return input;
  }
  throw new ApplicationError('CONTACT_FIELD_NOT_FOUND', `未找到字段“${label}”。`);
}

async function saveContactForPhase2(page) {
  const contact = await contactInputForLabel(page, '企业联系人');
  if (!normalizeText(await contact.inputValue())) {
    throw new ApplicationError('CONTACT_PERSON_MISSING', '平台未预填企业联系人。');
  }
  const phone = await contactInputForLabel(page, '企业联系电话');
  const email = await contactInputForLabel(page, '企业邮箱');
  const contactPhone = process.env.OH_CONTACT_PHONE || '13950182204';
  const contactEmail = process.env.OH_CONTACT_EMAIL || '102438@dnake.com';
  await phone.fill(contactPhone);
  await email.fill(contactEmail);
  if (await phone.inputValue() !== contactPhone || await email.inputValue() !== contactEmail) {
    throw new ApplicationError('CONTACT_VALUE_MISMATCH', '联系人默认电话或邮箱未保留。');
  }
  const saveButton = await exactVisibleSaveButton(page);
  const responsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/certificate/certification/saveConnect') && response.request().method() === 'POST'
  ), { timeout: 15_000 });
  await saveButton.click();
  const response = await responsePromise.catch(() => null);
  const payload = await response?.json().catch(() => null);
  if (payload?.code !== 200 || !payload.body?.id) {
    throw new ApplicationError('CONTACT_SAVE_FAILED', '联系人保存未返回申请标识。');
  }
  if (!/保存成功/.test(await page.locator('body').innerText())) {
    throw new ApplicationError('CONTACT_SAVE_RESULT_UNCLEAR', '未看到联系人保存成功提示。');
  }
  return String(payload.body.id);
}

async function getDictionary(page, itemType) {
  const result = await platformRequest(page, '/dictController/getDict', {
    method: 'POST',
    data: { itemType, isDelete: '0' },
  });
  return Array.isArray(result) ? result : [];
}

async function resolveOption(page, itemType, label) {
  const options = await getDictionary(page, itemType);
  const matched = options.find((option) => normalizeComparable(option.itemName) === normalizeComparable(label));
  if (!matched) {
    throw new ApplicationError('LIVE_OPTION_MISMATCH', `网页没有“${label}”这一${itemType}选项。`);
  }
  return { id: String(matched.id), label: normalizeText(matched.itemName) };
}

function walkDeviceTypes(nodes, target) {
  for (const node of nodes || []) {
    if (normalizeComparable(node.itemName) === normalizeComparable(target)) {
      return node;
    }
    const found = walkDeviceTypes(node.children, target);
    if (found) {
      return found;
    }
  }
  return null;
}

async function resolveRecordOptions(page, record) {
  const [systemType, osVersion, frameworks] = await Promise.all([
    resolveOption(page, 'os_type', record.systemType),
    resolveOption(page, 'os_version', record.osVersion),
    getDictionary(page, 'os_framework'),
  ]);
  const resolveFramework = (label) => {
    const found = frameworks.find((item) => normalizeComparable(item.itemName) === normalizeComparable(label));
    if (!found) {
      throw new ApplicationError('LIVE_OPTION_MISMATCH', `网页没有“${label}”这一 CPU 架构选项。`);
    }
    return { id: String(found.id), label: normalizeText(found.itemName) };
  };
  const devices = record.type === 'release' ? record.devices : [record];
  const resolvedDevices = devices.map((device) => ({ ...device, framework: resolveFramework(device.cpuArchitecture) }));
  let category = null;
  if (record.type === 'commercial') {
    const tree = await platformRequest(page, '/dictController/getDeviceType', {
      method: 'POST', data: { itemType: 'device_type' },
    });
    category = walkDeviceTypes(tree, record.category);
    if (!category) {
      throw new ApplicationError('LIVE_OPTION_MISMATCH', `网页没有“${record.category}”这一设备类型。`);
    }
  }
  return { ...record, systemTypeOption: systemType, osVersionOption: osVersion, devices: resolvedDevices, categoryOption: category };
}

function publicizeValue(label) {
  return label === '不公示' ? 0 : label === '发证即公示' ? 1 : 2;
}

function imageMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
}

async function uploadAppearanceFile(page, filePath) {
  const body = await fs.readFile(filePath);
  const response = await platformRequest(page, '/fileUpload/uploadPic', {
    method: 'POST',
    multipart: {
      file: { name: path.basename(filePath), mimeType: imageMimeType(filePath), buffer: body },
    },
  });
  if (!response?.id) {
    throw new ApplicationError('APPEARANCE_UPLOAD_FAILED', `外观图上传未返回文件标识: ${path.basename(filePath)}`);
  }
  return String(response.id);
}

async function saveProductDefinition(page, applicationId, record) {
  reportProgress(35, '保存产品定义', '正在保存产品信息和外观图。');
  const appearanceIds = [];
  for (const filePath of record.appearancePaths) {
    appearanceIds.push(await uploadAppearanceFile(page, filePath));
  }
  const base = {
    isSave: true,
    id: applicationId,
    certificationType: record.type === 'board' ? '0' : record.type === 'commercial' ? '1' : '2',
    systemType: record.systemTypeOption.id,
    systemVersion: record.osVersionOption.id,
    desc: record.description,
    appearanceIds: appearanceIds.join(','),
    allowPublicize: publicizeValue(record.publicity),
    publicizeTime: record.publicizeDate,
  };
  if (record.type === 'board') {
    await platformRequest(page, '/certification/applyCertificationForDev', {
      method: 'POST',
      data: {
        ...base,
        systemFramework: record.devices[0].framework.id,
        name: record.name,
        moduleModel: record.moduleModel,
        chipModel: record.chipModel,
        isSupportApplication: record.supportsInstall === '支持应用安装' ? '1' : '0',
        withScreen: record.withScreen === '带屏' ? '1' : '0',
      },
    });
    return appearanceIds;
  }
  if (record.type === 'commercial') {
    await platformRequest(page, '/certification/applyCertificationForProduct', {
      method: 'POST',
      data: {
        ...base,
        systemFramework: record.devices[0].framework.id,
        nameZh: record.name,
        nameEn: '',
        deviceModel: record.deviceModel,
        moduleModel: record.moduleModel,
        category: record.categoryOption.id,
        brandName: record.brandName,
        brandNameEn: record.brandNameEn,
        chipModel: record.chipModel,
        hardwareVersion: record.hardwareVersion,
        isSupportApplication: record.supportsInstall === '支持应用安装' ? '1' : '0',
        withScreen: record.withScreen === '带屏' ? '1' : '0',
        authType: record.authType === '产线预置' ? '1' : record.authType === '一型一密' ? '4' : '5',
      },
    });
    return appearanceIds;
  }
  const devices = record.devices.map((device) => ({
    module: device.moduleModel,
    model: device.chipModel,
    systemFramework: device.framework.id,
    isSupportApplication: device.supportsInstall === '支持应用安装' ? '1' : '0',
    withScreen: device.withScreen === '带屏' ? '1' : '0',
  }));
  await platformRequest(page, '/certification/applyCertificationForRelease', {
    method: 'POST',
    data: {
      ...base,
      systemFramework: devices.map((device) => device.systemFramework).join(','),
      isSupportApplication: devices.map((device) => device.isSupportApplication).join(','),
      withScreen: devices.map((device) => device.withScreen).join(','),
      name: record.name,
      moduleAndChip: devices,
    },
  });
  return appearanceIds;
}

async function exactVisibleSaveButton(page, scope = page) {
  const matches = scope.locator('.floor4 .btn2:visible');
  const count = await matches.count();
  if (count !== 1) throw new Error(`保存控件语义不安全：找到 ${count} 个 .floor4 .btn2 控件。`);
  const label = normalizeText(await matches.first().innerText());
  if (label !== '保存') throw new Error(`保存控件语义不安全：.floor4 .btn2 文本为“${label}”。`);
  assertOnlySafeSaveLabels(['保存']);
  return matches.first();
}

async function uploadPcidFile(page, filePath) {
  if (!filePath) {
    return '';
  }
  const localPath = toWslPath(filePath);
  const body = await fs.readFile(localPath);
  const response = await platformRequest(page, '/fileUpload/uploadPCID', {
    method: 'POST',
    multipart: {
      file: { name: path.basename(localPath), mimeType: 'application/octet-stream', buffer: body },
      isMirror: 'false',
    },
  });
  if (!response?.pcidFileInfo?.id) {
    throw new ApplicationError('PCID_UPLOAD_FAILED', `PCID 上传未返回文件标识: ${path.basename(localPath)}`);
  }
  return { id: String(response.pcidFileInfo.id), jsonId: String(response.pcidJsonFileId || '') };
}

async function uploadTestReportFile(page, filePath, xts, systemType) {
  const localPath = toWslPath(filePath);
  const body = await fs.readFile(localPath);
  const response = await platformRequest(page, '/certification/uploadTestReport', {
    method: 'POST',
    multipart: {
      file: { name: path.basename(localPath), mimeType: 'application/octet-stream', buffer: body },
      xts: String(xts),
      valid: String(systemType === '标准系统'),
    },
  });
  if (!response?.id) throw new ApplicationError('TEST_REPORT_UPLOAD_FAILED', `测试报告上传未返回文件标识: ${path.basename(localPath)}`);
  return { id: String(response.id), fileName: response.fileName || path.basename(localPath) };
}

async function chooseMirrorFile(page, mirrorPath) {
  const expectedName = path.basename(toWslPath(mirrorPath));
  const response = await platformRequest(page, '/mirror/chooseMirrorList', {
    method: 'POST',
    data: { page: 1, limit: 100, sort: 'uploadTime' },
  });
  const mirrors = Array.isArray(response?.mirrorList) ? response.mirrorList : [];
  const match = mirrors.find((item) => normalizeText(item.fileName) === expectedName);
  if (!match?.id) throw new ApplicationError('MIRROR_NOT_FOUND', `平台镜像库中未找到 ${expectedName}，请先上传镜像后再选择。`);
  return { id: String(match.id), fileName: match.fileName };
}

async function savePhase2Attachments(page, applicationId, record) {
  const selfCheckPath = process.env.OH_SELF_CHECK_PATH;
  const reportPath = process.env.OH_REPORT_PATH;
  const mirrorPath = process.env.OH_MIRROR_PATH || '';
  if (!selfCheckPath || !reportPath) {
    throw new ApplicationError('PHASE2_ATTACHMENTS_MISSING', '缺少自检表或报告路径，已停止保存。');
  }
  const getReportRelation = async () => {
    const relations = await platformRequest(page, `/certification/getCertificationReportRel?id=${encodeURIComponent(applicationId)}`, { method: 'GET' });
    return Array.isArray(relations) ? relations[0] : null;
  };
  const initializeReportRelation = async () => {
    // This is the platform's draft-save endpoint for its per-device report row.
    // It does not upload a file or advance to sample shipping/submission.
    await platformRequest(page, '/certification/saveReport', {
      method: 'POST',
      data: { isSave: true, id: applicationId, mirrorFileId: '', testReportFileId: '' },
    });
  };

  let relation = await getReportRelation();
  if (!relation) {
    reportProgress(62, '等待报告关联', '正在等待平台生成第4步设备报告行。');
    await initializeReportRelation();
    const deadline = Date.now() + REPORT_RELATION_MAX_WAIT_MS;
    let nextInitializeAt = Date.now() + REPORT_RELATION_INITIALIZE_RETRY_MS;
    let nextProgressAt = Date.now() + 5000;
    while (!relation && Date.now() < deadline) {
      await page.waitForTimeout(REPORT_RELATION_POLL_INTERVAL_MS);
      relation = await getReportRelation();
      if (!relation && Date.now() >= nextProgressAt) {
        const elapsed = Math.round((REPORT_RELATION_MAX_WAIT_MS - (deadline - Date.now())) / 1000);
        reportProgress(62, '等待报告关联', `平台仍在生成报告行，已等待 ${elapsed} 秒。`);
        nextProgressAt = Date.now() + 5000;
      }
      if (!relation && Date.now() >= nextInitializeAt) {
        reportProgress(63, '初始化报告关联', '正在重试第4步草稿初始化。');
        await initializeReportRelation();
        nextInitializeAt = Date.now() + REPORT_RELATION_INITIALIZE_RETRY_MS;
      }
    }
  }
  if (!relation?.id) {
    throw new ApplicationError(
      'REPORT_RELATION_MISSING',
      '平台第4步设备报告关联在 2 分钟内仍未生成，未开始上传 PCS 自检表或 XTS 报告；请稍后重试。',
    );
  }
  reportProgress(70, '报告关联已就绪', '开始上传 XTS 报告和 PCS 自检表。');
  reportProgress(72, '上传 XTS 报告', '正在处理 report.zip，文件较大时可能需要几分钟。');
  const xts = await uploadTestReportFile(page, reportPath, true, record.systemType);
  reportProgress(84, '上传 PCS 自检表', '正在上传自检表文件。');
  const pcs = await uploadTestReportFile(page, selfCheckPath, false, record.systemType);
  reportProgress(92, '保存附件关联', '正在把 XTS 报告和 PCS 自检表写入申请。');
  await platformRequest(page, `/certification/saveTestReport?certificationId=${encodeURIComponent(applicationId)}&isSave=true`, {
    method: 'POST',
    data: [{ id: relation.id, xtsFileId: xts.id, pcsFileId: pcs.id }],
  });
  const mirror = mirrorPath ? await chooseMirrorFile(page, mirrorPath) : null;
  if (mirror) {
    await platformRequest(page, '/certification/saveReport', {
      method: 'POST',
      data: { isSave: true, id: applicationId, mirrorFileId: mirror.id, testReportFileId: '' },
    });
  }
  reportProgress(97, '回读附件结果', '正在核对平台返回的文件名和关联标识。');
  return {
    report: { fileName: xts.fileName, id: xts.id },
    xts: { fileName: xts.fileName, id: xts.id },
    pcs: { fileName: pcs.fileName, id: pcs.id },
    mirror: mirror ? { fileName: mirror.fileName, id: mirror.id } : undefined,
  };
}

async function phase2AttachmentDifferences(page, applicationId, record) {
  const expectedReport = path.basename(toWslPath(process.env.OH_REPORT_PATH || ''));
  const expectedSelfCheck = path.basename(toWslPath(process.env.OH_SELF_CHECK_PATH || ''));
  const expectedMirror = path.basename(toWslPath(process.env.OH_MIRROR_PATH || ''));
  const current = await getApplication(page, applicationId);
  const relations = await platformRequest(page, `/certification/getCertificationReportRel?id=${encodeURIComponent(applicationId)}`, { method: 'GET' });
  const relation = Array.isArray(relations) ? relations[0] : null;
  const differences = [];
  if (!relation || normalizeText(relation.xtsFileName) !== expectedReport) {
    differences.push({ field: 'XTS报告', expected: expectedReport, actual: relation?.xtsFileName || '未上传' });
  }
  if (!relation || normalizeText(relation.pcsFileName) !== expectedSelfCheck) {
    differences.push({ field: 'PCS自检表', expected: expectedSelfCheck, actual: relation?.pcsFileName || '未上传' });
  }
  if (expectedMirror && normalizeText(current.mirrorFileName) !== expectedMirror) {
    differences.push({ field: '镜像固件', expected: expectedMirror, actual: current.mirrorFileName || '未选择' });
  }
  return differences;
}

async function saveAndVerifyPhase2Attachments(page, applicationId, record) {
  const attachments = await savePhase2Attachments(page, applicationId, record);
  const differences = await phase2AttachmentDifferences(page, applicationId, record);
  if (differences.length) {
    throw new ApplicationError('ATTACHMENT_READBACK_MISMATCH', `附件保存后回读不一致: ${JSON.stringify(differences)}`);
  }
  return attachments;
}

async function saveSoftwareStep(page, applicationId, record, { advanceToReport = false } = {}) {
  const expected = expectedSoftwareValues(record);
  const scInfos = [];
  for (const filePath of expected.pcidScPaths) {
    scInfos.push(await uploadPcidFile(page, filePath));
  }
  await platformRequest(page, '/certification/saveSoftDefine', {
    method: 'POST',
    data: {
      // The platform creates report relations only when this moves from software definition to report upload.
      isSave: !advanceToReport,
      id: applicationId,
      softwareVersion: expected.softwareVersion,
      versionId: expected.versionIds.map(encodeVersionId).join(','),
      patchLevel: expected.securityPatch,
      versionHash: expected.versionHashes.join(','),
      pcidFileId: scInfos.map((item) => item.id).join(','),
      pcidJsonFileId: scInfos.map((item) => item.jsonId).join(','),
    },
  });
}

function publicizeLabel(value) {
  return { 0: '不公示', 1: '发证即公示', 2: '选择最早公示时间' }[String(value)] || normalizeText(value);
}

function diff(label, actual, expected, differences) {
  if (normalizeComparable(actual) !== normalizeComparable(expected)) {
    differences.push({ field: label, expected, actual: actual ?? '' });
  }
}

function splitVersionValue(value) {
  return normalizeText(value).split(',').map((item) => item.replaceAll('∑', ',')).filter(Boolean);
}

function productInfoFor(current, type) {
  if (type === 'board') {
    return current.boardInfo || {};
  }
  if (type === 'commercial') {
    return current.productInfo || {};
  }
  return current.releaseInfo || {};
}

function compareAppearance(record, current, info, differences, expectedAppearanceIds = []) {
  const actualIds = normalizeText(info.appearanceIds || current.appearanceIds).split(',').filter(Boolean);
  if (expectedAppearanceIds.length) {
    if (actualIds.length !== expectedAppearanceIds.length || expectedAppearanceIds.some((id) => !actualIds.includes(id))) {
      differences.push({ field: '外观图', expected: '本次上传的文件 ID', actual: actualIds.join(',') || '未上传' });
    }
    return;
  }
  if (actualIds.length) {
    if (actualIds.length !== record.appearancePaths.length) {
      differences.push({ field: '外观图', expected: `${record.appearancePaths.length} 张`, actual: `${actualIds.length} 张` });
    }
    return;
  }
  const rawUrls = info.picUrls || current.picUrls || [];
  const actualUrls = Array.isArray(rawUrls) ? rawUrls : Object.values(rawUrls || {});
  if (actualUrls.length !== record.appearancePaths.length) {
    differences.push({ field: '外观图', expected: record.appearancePaths.map(path.basename).join(','), actual: '无法完整回读' });
    return;
  }
  for (const localPath of record.appearancePaths) {
    const filename = path.basename(localPath);
    if (!actualUrls.some((url) => decodeURIComponent(String(url)).includes(filename))) {
      differences.push({ field: '外观图', expected: filename, actual: actualUrls.join(',') });
    }
  }
}

export function productDifferences(current, record, expectedAppearanceIds = []) {
  const differences = [];
  const info = productInfoFor(current, record.type);
  const typeCode = record.type === 'board' ? '0' : record.type === 'commercial' ? '1' : '2';
  diff('测评类型', current.certificationType, typeCode, differences);
  diff('操作系统类型', current.systemType, record.systemTypeOption.id, differences);
  diff('操作系统版本号', current.systemVersion, record.osVersionOption.id, differences);
  diff('基本信息描述', current.desc, record.description, differences);
  diff('是否允许公示', publicizeLabel(current.allowPublicize), record.publicity, differences);
  if (record.publicity === '选择最早公示时间') {
    diff('最早公示日期', current.publicizeTime, record.publicizeDate, differences);
  }
  if (record.type === 'board') {
    diff('模组/开发板名称(传播名)', info.name, record.name, differences);
    diff('模组/开发板型号', info.moduleModel, record.moduleModel, differences);
    diff('芯片型号', info.chipModel, record.chipModel, differences);
    diff('CPU架构', current.systemFramework, record.devices[0].framework.id, differences);
    diff('是否支持应用安装', current.isSupportApplication, record.supportsInstall === '支持应用安装' ? '1' : '0', differences);
    diff('是否带屏', current.withScreen, record.withScreen === '带屏' ? '1' : '0', differences);
  } else if (record.type === 'commercial') {
    diff('设备名称(传播名)', info.nameZh, record.name, differences);
    diff('设备类型', info.category, record.categoryOption.id, differences);
    diff('设备型号', info.deviceModel, record.deviceModel, differences);
    diff('硬件设备版本号', info.hardwareVersion, record.hardwareVersion, differences);
    diff('品牌', info.brandName, record.brandName, differences);
    diff('品牌英文名', info.brandNameEn, record.brandNameEn, differences);
    diff('模组型号', info.moduleModel, record.moduleModel, differences);
    diff('芯片型号', info.chipModel, record.chipModel, differences);
    diff('CPU架构', current.systemFramework, record.devices[0].framework.id, differences);
    diff('认证方式', current.authType, record.authType === '产线预置' ? '1' : record.authType === '一型一密' ? '4' : '5', differences);
  } else {
    diff('发行版名称(传播名)', info.name, record.name, differences);
    const pairs = normalizeText(info.moduleAndChip).split(';').filter(Boolean).map((item) => item.split(','));
    if (pairs.length !== 2) {
      differences.push({ field: '发行版关联硬件', expected: '2组', actual: `${pairs.length}组` });
    }
    for (const [index, device] of record.devices.entries()) {
      diff(`设备${index + 1}模组型号`, pairs[index]?.[0], device.moduleModel, differences);
      diff(`设备${index + 1}芯片型号`, pairs[index]?.[1], device.chipModel, differences);
      diff(`设备${index + 1}CPU架构`, normalizeText(current.systemFramework).split(',')[index], device.framework.id, differences);
      diff(`设备${index + 1}是否支持应用安装`, normalizeText(current.isSupportApplication).split(',')[index], device.supportsInstall === '支持应用安装' ? '1' : '0', differences);
      diff(`设备${index + 1}是否带屏`, normalizeText(current.withScreen).split(',')[index], device.withScreen === '带屏' ? '1' : '0', differences);
    }
  }
  compareAppearance(record, current, info, differences, expectedAppearanceIds);
  return differences;
}

export function softwareDifferences(current, record) {
  const differences = [];
  const expected = expectedSoftwareValues(record);
  diff('软件版本号', current.softwareVersion, expected.softwareVersion, differences);
  diff('安全补丁标签', current.patchLevel, expected.securityPatch, differences);
  const actualIds = splitVersionValue(current.versionId);
  const actualHashes = splitVersionValue(current.versionHash);
  for (const [index, expectedId] of expected.versionIds.entries()) {
    diff(`设备${index + 1}版本Id`, actualIds[index], expectedId, differences);
    diff(`设备${index + 1}版本Hash`, actualHashes[index], expected.versionHashes[index], differences);
  }
  if (expected.pcidScPaths.length && !normalizeText(current.pcidFileId)) {
    differences.push({ field: 'PCID.sc', expected: '已上传', actual: '未上传' });
  }
  return differences;
}

function hasProductData(current) {
  return Boolean(normalizeText(current.certificationType));
}

function hasSoftwareData(current) {
  return Boolean(normalizeText(current.softwareVersion) || normalizeText(current.versionId)
    || normalizeText(current.versionHash) || normalizeText(current.patchLevel));
}

function assertNoPcidJsonRequirement(current, record) {
  if (record.systemType === '轻量系统' && Number(current.requirePcid) === 1) {
    throw new ApplicationError('PCID_JSON_REQUIRED', '平台要求轻量系统 PCID JSON 文件，当前工作簿仅支持 PCID.sc，需人工处理。');
  }
}

async function applicationIdForRecord(page, artifacts, record, mode, workbookPath) {
  if (record.processingStatus === '需人工处理') {
    throw new ApplicationError('MANUAL_REVIEW_REQUIRED', '工作簿标记为需人工处理，未执行任何平台写入。');
  }
  if (record.processingStatus === '联系人创建中' && !record.applicationId) {
    throw new ApplicationError('CONTACT_CREATION_AMBIGUOUS', '联系人创建中但缺少申请标识，已停止以避免重复创建。');
  }
  if (record.applicationId) {
    return record.applicationId;
  }
  if (record.assessmentNumber) {
    await navigateToCertificationList(page, artifacts);
    return findApplication(page, record.assessmentNumber);
  }
  if (mode === 'dry-run') {
    return null;
  }
  await writeWorkbookState(workbookPath, { status: '联系人创建中', notes: '正在保存联系人，未取得申请标识前请勿重复执行。' });
  await navigateToNewApplication(page, artifacts);
  const applicationId = await saveContactForPhase2(page);
  await writeWorkbookState(workbookPath, { applicationId, status: '联系人已保存', notes: '联系人保存成功，正在处理产品和软件定义。' });
  return applicationId;
}

async function processRecord(page, artifacts, record, mode, workbookPath) {
  reportProgress(10, '读取申请工作簿', `正在处理${record.name || '当前设备'}。`);
  const applicationId = await applicationIdForRecord(page, artifacts, record, mode, workbookPath);
  const resolved = await resolveRecordOptions(page, record);
  if (!applicationId) {
    await screenshot(page, artifacts, 'new-application-ready');
    return { assessmentNumber: '', status: 'ready-to-save', applicationId: '', action: 'none' };
  }
  if (!page.url().includes('/certification/create')) {
    await page.goto(`${page.url().split('#')[0]}#/certification/create?id=${encodeURIComponent(applicationId)}&editType=1&upgrade=0&from=true`);
    await page.waitForTimeout(800);
  }
  let current = await getApplication(page, applicationId);
  reportProgress(25, '读取平台申请', '正在核对现有申请状态。');
  assertNoPcidJsonRequirement(current, resolved);
  const productAlreadySaved = hasProductData(current);
  if (productAlreadySaved) {
    const differences = productDifferences(current, resolved);
    if (differences.length) {
      return { assessmentNumber: record.assessmentNumber, status: 'blocked', applicationId, differences };
    }
  } else {
    await screenshot(page, artifacts, `${record.assessmentNumber}-product-ready`);
    if (mode === 'dry-run') {
      return { assessmentNumber: record.assessmentNumber, status: 'ready-to-save', applicationId, action: 'none' };
    }
    const appearanceIds = await saveProductDefinition(page, applicationId, resolved);
    await screenshot(page, artifacts, `${record.assessmentNumber}-product-saved`);
    current = await getApplication(page, applicationId);
    assertNoPcidJsonRequirement(current, resolved);
    const differences = productDifferences(current, resolved, appearanceIds);
    if (differences.length) {
      return { assessmentNumber: record.assessmentNumber, status: 'blocked', applicationId, differences };
    }
  }

  if (hasSoftwareData(current)) {
    const differences = softwareDifferences(current, resolved);
    if (differences.length) return { assessmentNumber: record.assessmentNumber, status: 'blocked', applicationId, differences };
    if (mode === 'dry-run') return { assessmentNumber: record.assessmentNumber, status: 'ready-to-save', applicationId, action: 'none' };
    const attachmentDifferences = await phase2AttachmentDifferences(page, applicationId, resolved);
    if (!attachmentDifferences.length) {
      return { assessmentNumber: current.certificationNumber || record.assessmentNumber, status: 'skipped', applicationId, action: 'none' };
    }
    if (Number(current.currentStep) < 4) {
      reportProgress(55, '保存软件定义', '正在保存软件版本、补丁和 PCID.sc。');
      await saveSoftwareStep(page, applicationId, resolved, { advanceToReport: true });
    }
    const attachments = await saveAndVerifyPhase2Attachments(page, applicationId, resolved);
    return { assessmentNumber: current.certificationNumber || record.assessmentNumber, status: 'saved', applicationId, action: 'phase2-attachments-saved', attachments };
  }
  if (mode === 'dry-run') {
    return { assessmentNumber: record.assessmentNumber, status: 'ready-to-save', applicationId, action: 'none' };
  }

  // The platform creates the report relation only when the software definition advances to report upload.
  reportProgress(55, '保存软件定义', '正在保存软件版本、补丁和 PCID.sc。');
  await saveSoftwareStep(page, applicationId, resolved, { advanceToReport: true });
  const attachments = await saveAndVerifyPhase2Attachments(page, applicationId, resolved);
  current = await getApplication(page, applicationId);
  const differences = softwareDifferences(current, resolved);
  if (differences.length) {
    return { assessmentNumber: record.assessmentNumber, status: 'blocked', applicationId, differences };
  }
  await screenshot(page, artifacts, `${record.assessmentNumber}-software-saved`);
  return { assessmentNumber: current.certificationNumber || record.assessmentNumber, status: 'saved', applicationId, action: 'phase2-save-with-report-and-mirror', attachments };
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
  let input;
  try {
    reportProgress(5, '读取申请工作簿', '正在读取第二阶段 Excel。');
    input = await readPhase2Workbook(options.workbook);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }
  if (!process.env.OH_USERNAME || !process.env.OH_PASSWORD) {
    console.error('没有填写对应账号密码，已停止执行。');
    process.exitCode = 2;
    return;
  }
  const derivedAttachments = derivePhase2AttachmentPaths(options.workbook);
  process.env.OH_SELF_CHECK_PATH = derivedAttachments.selfCheckPath;
  process.env.OH_REPORT_PATH = derivedAttachments.reportPath;
  process.env.OH_MIRROR_PATH = '';
  const artifacts = artifactDirectory(options.artifacts, input.sourcePath);
  await fs.mkdir(artifacts, { recursive: true });
  let browser;
  const results = [];
  try {
    const playwright = await import('playwright');
    browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    reportProgress(15, '登录平台', '正在登录兼容性测评平台。');
    await signIn(page, artifacts, process.env.OH_USERNAME, process.env.OH_PASSWORD);
    reportProgress(20, '登录成功', '正在进入兼容性申请流程。');
    const record = input.record;
    try {
      const result = await processRecord(page, artifacts, record, options.mode, input.sourcePath);
      results.push(result);
      if (options.mode === 'save' && ['saved', 'skipped'].includes(result.status)) {
        reportProgress(100, '处理完成', '第二阶段草稿和附件已保存并完成回读。');
        const assessmentNumberReady = isAssessmentNumber(result.assessmentNumber);
        await writeWorkbookState(input.sourcePath, {
          applicationId: result.applicationId,
          assessmentNumber: result.assessmentNumber,
          status: assessmentNumberReady ? '第二阶段已保存' : '第二阶段已保存，待编号回写',
          notes: assessmentNumberReady
            ? (result.status === 'saved' ? '产品定义、软件定义、XTS报告和PCS自检表已保存并回读校验；镜像上传暂未启用。' : '平台数据与工作簿一致，未重复保存。')
            : '产品定义、软件定义、XTS报告和PCS自检表已保存并回读校验；镜像上传暂未启用。',
        });
      }
    } catch (error) {
      const code = error instanceof ApplicationError ? error.code : 'UNEXPECTED_ERROR';
      const message = error instanceof Error ? error.message : String(error);
      await screenshot(page, artifacts, 'stopped', true);
      results.push({ assessmentNumber: record.assessmentNumber, status: 'blocked', code, message });
      if (options.mode === 'save') {
        await writeWorkbookState(input.sourcePath, { status: '需人工处理', notes: `${code}: ${message}` }).catch(() => {});
      }
    }
    await writeResult(artifacts, { mode: options.mode, workbook: input.sourcePath, results, artifacts });
    console.log(`第二阶段处理完成。Artifacts: ${artifacts}`);
    for (const result of results) console.log(`${result.assessmentNumber || '未生成测评编号'}: ${result.status}`);
    console.log(`PHASE2_RESULT_JSON=${JSON.stringify({ results })}`);
    if (results.some((result) => result.status === 'blocked')) {
      process.exitCode = 1;
    }
  } catch (error) {
    const code = error instanceof ApplicationError ? error.code : 'UNEXPECTED_ERROR';
    const message = error instanceof Error ? error.message : String(error);
    await writeResult(artifacts, { mode: options.mode, status: 'stopped', code, message, results, artifacts }).catch(() => {});
    console.error(`${code}: ${message}`);
    console.error(`Artifacts: ${artifacts}`);
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
