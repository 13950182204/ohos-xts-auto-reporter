import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

export const DEFAULT_WORKBOOK_PATH = 'D:\\ohos\\XTS6.1\\OpenHarmony兼容性申请_第二阶段.xlsx';
export const SHEETS = Object.freeze({
  board: '模组开发板',
  release: '发行版',
  commercial: '商用设备',
});
export const SHEET_ORDER = Object.freeze([SHEETS.board, SHEETS.release, SHEETS.commercial]);
export const SAFE_SAVE_LABELS = new Set(['保存']);
export const PUBLICITY_VALUES = Object.freeze(['发证即公示', '选择最早公示时间', '不公示']);
export const INSTALL_VALUES = Object.freeze(['支持应用安装', '不支持应用安装']);
export const SCREEN_VALUES = Object.freeze(['带屏', '不带屏']);
export const AUTH_VALUES = Object.freeze(['产线预置', '一型一密', '不涉及']);

const STATUS_CELLS = Object.freeze({
  status: 'B3',
  applicationId: 'F3',
  assessmentNumber: 'B4',
  processedAt: 'F4',
  notes: 'B5',
});

const BOARD_FIELDS = Object.freeze([
  ['systemType', '操作系统类型', 'C8'],
  ['osVersion', '操作系统版本号', 'C9'],
  ['name', '模组/开发板名称(传播名)', 'C10'],
  ['moduleModel', '模组/开发板型号', 'C11'],
  ['chipModel', '芯片型号', 'C12'],
  ['cpuArchitecture', 'CPU架构', 'C13'],
  ['supportsInstall', '是否支持应用安装', 'C14'],
  ['withScreen', '是否带屏', 'C15'],
  ['description', '基本信息描述', 'C16'],
  ['appearancePaths', '外观图路径', 'C17'],
  ['publicity', '是否允许公示', 'C18'],
  ['publicizeDate', '最早公示日期', 'C19'],
  ['softwareVersion', '软件版本号', 'C22'],
  ['securityPatch', '安全补丁标签', 'C23'],
  ['versionId', '版本Id', 'C24'],
  ['versionHash', '版本Hash', 'C25'],
  ['pcidScPath', 'PCID.sc路径', 'C26'],
]);

const COMMERCIAL_FIELDS = Object.freeze([
  ['systemType', '操作系统类型', 'C8'],
  ['osVersion', '操作系统版本号', 'C9'],
  ['name', '设备名称(传播名)', 'C10'],
  ['category', '设备类型', 'C11'],
  ['deviceModel', '设备型号', 'C12'],
  ['hardwareVersion', '硬件设备版本号', 'C13'],
  ['brandName', '品牌', 'C14'],
  ['brandNameEn', '品牌英文名', 'C15'],
  ['moduleModel', '模组型号', 'C16'],
  ['chipModel', '芯片型号', 'C17'],
  ['cpuArchitecture', 'CPU架构', 'C18'],
  ['authType', '认证方式', 'C19'],
  ['supportsInstall', '是否支持应用安装', 'C20'],
  ['withScreen', '是否带屏', 'C21'],
  ['description', '基本信息描述', 'C22'],
  ['appearancePaths', '外观图路径', 'C23'],
  ['publicity', '是否允许公示', 'C24'],
  ['publicizeDate', '最早公示日期', 'C25'],
  ['softwareVersion', '软件版本号', 'C28'],
  ['securityPatch', '安全补丁标签', 'C29'],
  ['versionId', '版本Id', 'C30'],
  ['versionHash', '版本Hash', 'C31'],
  ['pcidScPath', 'PCID.sc路径', 'C32'],
]);

const RELEASE_FIELDS = Object.freeze([
  ['systemType', '操作系统类型', 'C8'],
  ['osVersion', '操作系统版本号', 'C9'],
  ['name', '发行版名称(传播名)', 'C10'],
  ['description', '基本信息描述', 'C11'],
  ['appearancePaths', '外观图路径', 'C12'],
  ['publicity', '是否允许公示', 'C13'],
  ['publicizeDate', '最早公示日期', 'C14'],
  ['device1ModuleModel', '设备1模组型号', 'B17'],
  ['device2ModuleModel', '设备2模组型号', 'F17'],
  ['device1ChipModel', '设备1芯片型号', 'B18'],
  ['device2ChipModel', '设备2芯片型号', 'F18'],
  ['device1CpuArchitecture', '设备1CPU架构', 'B19'],
  ['device2CpuArchitecture', '设备2CPU架构', 'F19'],
  ['device1SupportsInstall', '设备1是否支持应用安装', 'B20'],
  ['device2SupportsInstall', '设备2是否支持应用安装', 'F20'],
  ['device1WithScreen', '设备1是否带屏', 'B21'],
  ['device2WithScreen', '设备2是否带屏', 'F21'],
  ['softwareVersion', '软件版本号', 'C24'],
  ['securityPatch', '安全补丁标签', 'C25'],
  ['device1VersionId', '设备1版本Id', 'B27'],
  ['device2VersionId', '设备2版本Id', 'F27'],
  ['device1VersionHash', '设备1版本Hash', 'B28'],
  ['device2VersionHash', '设备2版本Hash', 'F28'],
  ['device1PcidScPath', '设备1PCID.sc路径', 'B29'],
  ['device2PcidScPath', '设备2PCID.sc路径', 'F29'],
]);

const FIELD_LAYOUTS = Object.freeze({
  [SHEETS.board]: BOARD_FIELDS,
  [SHEETS.release]: RELEASE_FIELDS,
  [SHEETS.commercial]: COMMERCIAL_FIELDS,
});

const LEGACY_HEADERS = Object.freeze({
  [SHEETS.board]: [
    '测评编号', '操作系统类型', '操作系统版本号', '模组/开发板名称(传播名)', '模组/开发板型号',
    '芯片型号', 'CPU架构', '是否支持应用安装', '是否带屏', '基本信息描述', '外观图路径',
    '是否允许公示', '最早公示日期', '软件版本号', '安全补丁标签', '版本Id', '版本Hash', 'PCID.sc路径',
  ],
  [SHEETS.commercial]: [
    '测评编号', '操作系统类型', '操作系统版本号', '设备名称(传播名)', '设备类型', '设备型号',
    '硬件设备版本号', '品牌', '品牌英文名', '模组型号', '芯片型号', 'CPU架构', '认证方式',
    '是否支持应用安装', '是否带屏', '基本信息描述', '外观图路径', '是否允许公示', '最早公示日期',
    '软件版本号', '安全补丁标签', '版本Id', '版本Hash', 'PCID.sc路径',
  ],
  [SHEETS.release]: [
    '测评编号', '操作系统类型', '操作系统版本号', '发行版名称(传播名)', '基本信息描述', '外观图路径',
    '是否允许公示', '最早公示日期', '软件版本号', '安全补丁标签',
    '设备1模组型号', '设备1芯片型号', '设备1CPU架构', '设备1是否支持应用安装', '设备1是否带屏',
    '设备1版本Id', '设备1版本Hash', '设备1PCID.sc路径',
    '设备2模组型号', '设备2芯片型号', '设备2CPU架构', '设备2是否支持应用安装', '设备2是否带屏',
    '设备2版本Id', '设备2版本Hash', '设备2PCID.sc路径',
  ],
});

export class WorkbookValidationError extends Error {
  constructor(errors) {
    super(errors.join('\n'));
    this.code = 'WORKBOOK_VALIDATION_FAILED';
    this.errors = errors;
  }
}

export function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeComparable(value) {
  return normalizeText(value).replace(/\s/g, '').toLowerCase();
}

export function isSafeSaveLabel(label) {
  return SAFE_SAVE_LABELS.has(normalizeText(label));
}

export function assertOnlySafeSaveLabels(labels) {
  if (!Array.isArray(labels) || labels.length !== 1 || !isSafeSaveLabel(labels[0])) {
    throw new Error('保存控件语义不安全，已停止执行。');
  }
}

export function toWslPath(value) {
  const input = normalizeText(value).replaceAll('\\', '/');
  const windowsPath = /^([a-zA-Z]):\/(.+)$/.exec(input);
  return windowsPath ? `/mnt/${windowsPath[1].toLowerCase()}/${windowsPath[2]}` : input;
}

export const PHASE2_SELF_CHECK_NAME = 'OpenHarmony设备兼容性规范5.x自检表_标准系统.xlsx';
export const PHASE2_REPORT_NAME = 'report.zip';

export function derivePhase2AttachmentPaths(workbookPath) {
  const input = normalizeText(workbookPath);
  const windows = /^([a-zA-Z]:[\\/])/.test(input);
  if (windows) {
    const directory = path.win32.dirname(input.replaceAll('/', '\\'));
    return {
      selfCheckPath: path.win32.join(directory, PHASE2_SELF_CHECK_NAME),
      reportPath: path.win32.join(directory, 'report', PHASE2_REPORT_NAME),
      mirrorPath: '',
    };
  }
  const directory = path.dirname(toWslPath(input));
  return {
    selfCheckPath: path.join(directory, PHASE2_SELF_CHECK_NAME),
    reportPath: path.join(directory, 'report', PHASE2_REPORT_NAME),
    mirrorPath: '',
  };
}

export function isAbsoluteLocalPath(value) {
  return path.posix.isAbsolute(toWslPath(value));
}

export function isAssessmentNumber(value) {
  return /^OHC\d+$/.test(normalizeText(value));
}

export function splitPaths(value) {
  return normalizeText(value).split(/[;；\n]/).map(toWslPath).filter(Boolean);
}

async function validateAttachment(errors, label, value, extensions, fileExists) {
  const input = normalizeText(value);
  if (!input) {
    errors.push(`缺少${label}`);
    return;
  }
  const localPath = toWslPath(input);
  if (!isAbsoluteLocalPath(localPath)) {
    errors.push(`${label}必须为绝对路径`);
    return;
  }
  if (!extensions.includes(path.extname(localPath).toLowerCase())) {
    errors.push(`${label}格式不正确`);
    return;
  }
  if (!await fileExists(localPath)) errors.push(`${label}不存在: ${localPath}`);
}

export async function validatePhase2Attachments({ selfCheckPath, reportPath, mirrorPath }, { fileExists = async (filePath) => {
  try { return (await fs.stat(filePath)).isFile(); } catch { return false; }
} } = {}) {
  const errors = [];
  await validateAttachment(errors, 'PCS自检表路径', selfCheckPath, ['.xlsx'], fileExists);
  await validateAttachment(errors, 'XTS报告路径', reportPath, ['.zip'], fileExists);
  if (normalizeText(mirrorPath)) await validateAttachment(errors, '镜像固件路径', mirrorPath, ['.7z', '.zip'], fileExists);
  return errors;
}

export function loadExcelJs() {
  const runtime = process.env.OH_AUTOMATION_TOOL_DIR || process.env.OH_WAIVER_TOOL_DIR;
  if (runtime) return createRequire(path.join(runtime, 'package.json'))('exceljs');
  return createRequire(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'package.json'))('exceljs');
}

function cellText(cell) {
  if (cell.value instanceof Date) {
    return cell.value.toISOString().slice(0, 10);
  }
  return normalizeText(cell.text || cell.value);
}

function typeForSheet(sheetName) {
  if (sheetName === SHEETS.board) return 'board';
  if (sheetName === SHEETS.release) return 'release';
  if (sheetName === SHEETS.commercial) return 'commercial';
  throw new Error(`Unsupported worksheet: ${sheetName}`);
}

function recordFromValues(sheetName, values, state = {}) {
  const common = {
    type: typeForSheet(sheetName),
    sheetName,
    applicationId: normalizeText(state.applicationId),
    assessmentNumber: normalizeText(state.assessmentNumber),
    processingStatus: normalizeText(state.status) || '待处理',
    processedAt: normalizeText(state.processedAt),
    notes: normalizeText(state.notes),
    systemType: normalizeText(values.systemType),
    osVersion: normalizeText(values.osVersion),
    description: normalizeText(values.description),
    appearancePaths: splitPaths(values.appearancePaths),
    publicity: normalizeText(values.publicity) || '发证即公示',
    publicizeDate: normalizeText(values.publicizeDate),
    softwareVersion: normalizeText(values.softwareVersion),
    securityPatch: normalizeText(values.securityPatch),
  };
  if (sheetName === SHEETS.release) {
    return {
      ...common,
      name: normalizeText(values.name),
      devices: [1, 2].map((number) => ({
        moduleModel: normalizeText(values[`device${number}ModuleModel`]),
        chipModel: normalizeText(values[`device${number}ChipModel`]),
        cpuArchitecture: normalizeText(values[`device${number}CpuArchitecture`]),
        supportsInstall: normalizeText(values[`device${number}SupportsInstall`]),
        withScreen: normalizeText(values[`device${number}WithScreen`]),
        versionId: normalizeText(values[`device${number}VersionId`]),
        versionHash: normalizeText(values[`device${number}VersionHash`]),
        pcidScPath: toWslPath(values[`device${number}PcidScPath`]),
      })),
    };
  }
  return {
    ...common,
    name: normalizeText(values.name),
    moduleModel: normalizeText(values.moduleModel),
    chipModel: normalizeText(values.chipModel),
    cpuArchitecture: normalizeText(values.cpuArchitecture),
    supportsInstall: normalizeText(values.supportsInstall),
    withScreen: normalizeText(values.withScreen),
    versionId: normalizeText(values.versionId),
    versionHash: normalizeText(values.versionHash),
    pcidScPath: toWslPath(values.pcidScPath),
    ...(sheetName === SHEETS.commercial ? {
      category: normalizeText(values.category),
      deviceModel: normalizeText(values.deviceModel),
      hardwareVersion: normalizeText(values.hardwareVersion),
      brandName: normalizeText(values.brandName),
      brandNameEn: normalizeText(values.brandNameEn),
      authType: normalizeText(values.authType),
    } : {}),
  };
}

export function recordToValues(record) {
  const values = {
    systemType: record.systemType,
    osVersion: record.osVersion,
    name: record.name,
    description: record.description,
    appearancePaths: record.appearancePaths?.join('; ') || '',
    publicity: record.publicity,
    publicizeDate: record.publicizeDate,
    softwareVersion: record.softwareVersion,
    securityPatch: record.securityPatch,
  };
  if (record.type === 'release') {
    for (const [index, device] of record.devices.entries()) {
      const number = index + 1;
      values[`device${number}ModuleModel`] = device.moduleModel;
      values[`device${number}ChipModel`] = device.chipModel;
      values[`device${number}CpuArchitecture`] = device.cpuArchitecture;
      values[`device${number}SupportsInstall`] = device.supportsInstall;
      values[`device${number}WithScreen`] = device.withScreen;
      values[`device${number}VersionId`] = device.versionId;
      values[`device${number}VersionHash`] = device.versionHash;
      values[`device${number}PcidScPath`] = device.pcidScPath;
    }
    return values;
  }
  return {
    ...values,
    moduleModel: record.moduleModel,
    chipModel: record.chipModel,
    cpuArchitecture: record.cpuArchitecture,
    supportsInstall: record.supportsInstall,
    withScreen: record.withScreen,
    versionId: record.versionId,
    versionHash: record.versionHash,
    pcidScPath: record.pcidScPath,
    ...(record.type === 'commercial' ? {
      category: record.category,
      deviceModel: record.deviceModel,
      hardwareVersion: record.hardwareVersion,
      brandName: record.brandName,
      brandNameEn: record.brandNameEn,
      authType: record.authType,
    } : {}),
  };
}

function recordState(record) {
  return {
    applicationId: record.applicationId,
    assessmentNumber: record.assessmentNumber,
    status: record.processingStatus,
    processedAt: record.processedAt,
    notes: record.notes,
  };
}

function valuesFromFormSheet(sheet, sheetName) {
  const values = {};
  for (const [key, , cell] of FIELD_LAYOUTS[sheetName]) {
    values[key] = cellText(sheet.getCell(cell));
  }
  const state = Object.fromEntries(Object.entries(STATUS_CELLS).map(([key, cell]) => [key, cellText(sheet.getCell(cell))]));
  return recordFromValues(sheetName, values, state);
}

function headersMatch(sheet, expected) {
  return expected.every((header, index) => cellText(sheet.getRow(1).getCell(index + 1)) === header);
}

function valuesFromLegacyRow(sheet, headers) {
  const row = sheet.getRow(2);
  return Object.fromEntries(headers.map((header, index) => [header, cellText(row.getCell(index + 1))]));
}

function legacyRecord(sheet, sheetName) {
  const row = valuesFromLegacyRow(sheet, LEGACY_HEADERS[sheetName]);
  const values = {};
  if (sheetName === SHEETS.board) {
    Object.assign(values, {
      systemType: row['操作系统类型'], osVersion: row['操作系统版本号'], name: row['模组/开发板名称(传播名)'],
      moduleModel: row['模组/开发板型号'], chipModel: row['芯片型号'], cpuArchitecture: row['CPU架构'],
      supportsInstall: row['是否支持应用安装'], withScreen: row['是否带屏'], description: row['基本信息描述'],
      appearancePaths: row['外观图路径'], publicity: row['是否允许公示'], publicizeDate: row['最早公示日期'],
      softwareVersion: row['软件版本号'], securityPatch: row['安全补丁标签'], versionId: row['版本Id'],
      versionHash: row['版本Hash'], pcidScPath: row['PCID.sc路径'],
    });
  } else if (sheetName === SHEETS.commercial) {
    Object.assign(values, {
      systemType: row['操作系统类型'], osVersion: row['操作系统版本号'], name: row['设备名称(传播名)'],
      category: row['设备类型'], deviceModel: row['设备型号'], hardwareVersion: row['硬件设备版本号'],
      brandName: row['品牌'], brandNameEn: row['品牌英文名'], moduleModel: row['模组型号'], chipModel: row['芯片型号'],
      cpuArchitecture: row['CPU架构'], authType: row['认证方式'], supportsInstall: row['是否支持应用安装'],
      withScreen: row['是否带屏'], description: row['基本信息描述'], appearancePaths: row['外观图路径'],
      publicity: row['是否允许公示'], publicizeDate: row['最早公示日期'], softwareVersion: row['软件版本号'],
      securityPatch: row['安全补丁标签'], versionId: row['版本Id'], versionHash: row['版本Hash'], pcidScPath: row['PCID.sc路径'],
    });
  } else {
    Object.assign(values, {
      systemType: row['操作系统类型'], osVersion: row['操作系统版本号'], name: row['发行版名称(传播名)'],
      description: row['基本信息描述'], appearancePaths: row['外观图路径'], publicity: row['是否允许公示'],
      publicizeDate: row['最早公示日期'], softwareVersion: row['软件版本号'], securityPatch: row['安全补丁标签'],
    });
    for (const number of [1, 2]) {
      values[`device${number}ModuleModel`] = row[`设备${number}模组型号`];
      values[`device${number}ChipModel`] = row[`设备${number}芯片型号`];
      values[`device${number}CpuArchitecture`] = row[`设备${number}CPU架构`];
      values[`device${number}SupportsInstall`] = row[`设备${number}是否支持应用安装`];
      values[`device${number}WithScreen`] = row[`设备${number}是否带屏`];
      values[`device${number}VersionId`] = row[`设备${number}版本Id`];
      values[`device${number}VersionHash`] = row[`设备${number}版本Hash`];
      values[`device${number}PcidScPath`] = row[`设备${number}PCID.sc路径`];
    }
  }
  const assessmentNumber = normalizeText(row['测评编号']);
  return recordFromValues(sheetName, values, {
    assessmentNumber,
    status: assessmentNumber ? '待平台核验' : '待处理',
    notes: assessmentNumber ? '由旧版表格迁移，需回读平台核验。' : '',
  });
}

function businessValueCount(record) {
  if (record.type === 'release') {
    return [record.name, record.devices[0]?.moduleModel, record.devices[1]?.moduleModel]
      .filter((value) => normalizeText(value)).length;
  }
  return [record.name, record.moduleModel, record.chipModel, record.description]
    .filter((value) => normalizeText(value)).length;
}

async function readWorkbook(sourcePath) {
  const ExcelJS = loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(sourcePath);
  } catch (error) {
    throw new WorkbookValidationError([`无法读取工作簿: ${sourcePath}`, error.message]);
  }
  const candidates = [];
  for (const sheetName of SHEET_ORDER) {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) {
      throw new WorkbookValidationError([`缺少工作表: ${sheetName}`]);
    }
    let record;
    if (normalizeText(sheet.getCell('A1').value).startsWith('OpenHarmony兼容性申请')) {
      record = valuesFromFormSheet(sheet, sheetName);
    } else if (headersMatch(sheet, LEGACY_HEADERS[sheetName])) {
      record = legacyRecord(sheet, sheetName);
    } else {
      throw new WorkbookValidationError([`${sheetName} 格式不受支持，请使用技能生成的单设备工作簿。`]);
    }
    if (businessValueCount(record)) {
      candidates.push(record);
    }
  }
  if (!candidates.length) {
    throw new WorkbookValidationError(['请在且仅在一个设备类型工作表中填写设备信息。']);
  }
  if (candidates.length > 1) {
    throw new WorkbookValidationError(['一个工作簿只能填写一个设备类型，检测到多个已填写工作表。']);
  }
  return { sourcePath, record: candidates[0] };
}

function requireText(errors, label, value) {
  if (!normalizeText(value)) errors.push(`缺少${label}`);
}

function validateSelections(errors, device) {
  if (!INSTALL_VALUES.includes(device.supportsInstall)) errors.push('“是否支持应用安装”无效');
  if (!SCREEN_VALUES.includes(device.withScreen)) errors.push('“是否带屏”无效');
  if (device.supportsInstall === '不支持应用安装' && device.withScreen !== '不带屏') {
    errors.push('不支持应用安装时必须选择“不带屏”');
  }
}

async function checkFile(errors, label, filePath, extensions, fileExists) {
  if (!filePath) {
    errors.push(`缺少${label}`);
    return;
  }
  if (!isAbsoluteLocalPath(filePath)) {
    errors.push(`${label}必须为绝对路径`);
    return;
  }
  if (!extensions.includes(path.extname(filePath).toLowerCase())) {
    errors.push(`${label}格式不正确`);
    return;
  }
  if (!await fileExists(filePath)) errors.push(`${label}不存在: ${filePath}`);
}

async function validateDeviceFiles(errors, record, device, label, fileExists) {
  if (['标准系统', '小型系统'].includes(record.systemType)) {
    await checkFile(errors, `${label}PCID.sc路径`, device.pcidScPath, ['.sc'], fileExists);
  }
}

export async function validateRecord(record, { fileExists = async (filePath) => {
  try { return (await fs.stat(filePath)).isFile(); } catch { return false; }
} } = {}) {
  const errors = [];
  if (record.assessmentNumber && !isAssessmentNumber(record.assessmentNumber)) {
    errors.push('测评编号格式不正确');
  }
  for (const [label, value] of [
    ['操作系统类型', record.systemType], ['操作系统版本号', record.osVersion], ['基本信息描述', record.description],
    ['软件版本号', record.softwareVersion], ['安全补丁标签', record.securityPatch],
  ]) requireText(errors, label, value);
  if (!PUBLICITY_VALUES.includes(record.publicity)) errors.push('“是否允许公示”无效');
  if (record.publicity === '选择最早公示时间' && !record.publicizeDate) errors.push('缺少最早公示日期');
  if (!record.appearancePaths.length) errors.push('缺少外观图路径');
  if (record.appearancePaths.length > 10) errors.push('外观图最多10张');
  for (const filePath of record.appearancePaths) {
    await checkFile(errors, '外观图路径', filePath, ['.png', '.jpg', '.jpeg', '.webp'], fileExists);
  }
  if (record.type === 'release') {
    for (const [index, device] of record.devices.entries()) {
      const label = `设备${index + 1}`;
      for (const [field, value] of [
        ['模组型号', device.moduleModel], ['芯片型号', device.chipModel], ['CPU架构', device.cpuArchitecture],
        ['版本Id', device.versionId], ['版本Hash', device.versionHash],
      ]) requireText(errors, `${label}${field}`, value);
      validateSelections(errors, device);
      await validateDeviceFiles(errors, record, device, label, fileExists);
    }
    if (record.devices.length !== 2) errors.push('发行版必须填写两套关联硬件配置');
  } else {
    for (const [label, value] of [
      [record.type === 'board' ? '模组/开发板名称(传播名)' : '设备名称(传播名)', record.name],
      ['模组型号', record.moduleModel], ['芯片型号', record.chipModel], ['CPU架构', record.cpuArchitecture],
      ['版本Id', record.versionId], ['版本Hash', record.versionHash],
    ]) requireText(errors, label, value);
    validateSelections(errors, record);
    await validateDeviceFiles(errors, record, record, '', fileExists);
    if (record.type === 'commercial') {
      for (const [label, value] of [
        ['设备类型', record.category], ['设备型号', record.deviceModel], ['硬件设备版本号', record.hardwareVersion],
        ['品牌', record.brandName], ['品牌英文名', record.brandNameEn], ['认证方式', record.authType],
      ]) requireText(errors, label, value);
      if (!AUTH_VALUES.includes(record.authType)) errors.push('“认证方式”无效');
      if (/[\u4e00-\u9fff]/.test(record.brandNameEn)) errors.push('品牌英文名不能包含中文');
    }
  }
  if (record.processingStatus === '联系人创建中' && !record.applicationId) {
    errors.push('联系人创建中但缺少申请标识，已停止以避免重复创建。');
  }
  if (record.processingStatus === '需人工处理') {
    errors.push('工作簿标记为需人工处理，已停止执行。');
  }
  return errors;
}

export async function readPhase2Workbook(workbookPath, options = {}) {
  if (!workbookPath) throw new WorkbookValidationError(['没有提供对应的申请表格文件，已停止执行。']);
  const sourcePath = toWslPath(workbookPath);
  if (!isAbsoluteLocalPath(sourcePath) || path.extname(sourcePath).toLowerCase() !== '.xlsx') {
    throw new WorkbookValidationError(['申请表格文件必须为绝对路径的 .xlsx 文件。']);
  }
  try { await fs.access(sourcePath); } catch { throw new WorkbookValidationError([`申请表格文件不存在: ${sourcePath}`]); }
  const input = await readWorkbook(sourcePath);
  const errors = await validateRecord(input.record, options);
  if (errors.length) throw new WorkbookValidationError(errors);
  return input;
}

function applyCellStyle(cell, style = {}) {
  cell.font = { name: 'Microsoft YaHei', size: 10, ...style.font };
  cell.alignment = { vertical: 'center', wrapText: true, ...style.alignment };
  if (style.fill) cell.fill = style.fill;
  if (style.border) cell.border = style.border;
}

const BORDER = Object.freeze({
  top: { style: 'thin', color: { argb: 'FFD9E1F0' } }, bottom: { style: 'thin', color: { argb: 'FFD9E1F0' } },
  left: { style: 'thin', color: { argb: 'FFD9E1F0' } }, right: { style: 'thin', color: { argb: 'FFD9E1F0' } },
});

function mergeValueRow(sheet, row, label, valueCell, value) {
  sheet.mergeCells(`A${row}:B${row}`);
  sheet.mergeCells(`C${row}:H${row}`);
  sheet.getCell(`A${row}`).value = label;
  sheet.getCell(valueCell).value = value || '';
  applyCellStyle(sheet.getCell(`A${row}`), { font: { bold: true, color: { argb: 'FF334155' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6FB' } }, border: BORDER });
  applyCellStyle(sheet.getCell(valueCell), { border: BORDER });
  sheet.getRow(row).height = label.includes('描述') || label.includes('路径') || label.includes('版本Id') ? 36 : 25;
}

function mergePairRow(sheet, row, leftLabel, leftCell, leftValue, rightLabel, rightCell, rightValue) {
  sheet.mergeCells(`B${row}:D${row}`);
  sheet.mergeCells(`F${row}:H${row}`);
  sheet.getCell(`A${row}`).value = leftLabel;
  sheet.getCell(leftCell).value = leftValue || '';
  sheet.getCell(`E${row}`).value = rightLabel;
  sheet.getCell(rightCell).value = rightValue || '';
  for (const cell of [`A${row}`, `E${row}`]) {
    applyCellStyle(sheet.getCell(cell), { font: { bold: true, color: { argb: 'FF334155' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6FB' } }, border: BORDER });
  }
  applyCellStyle(sheet.getCell(leftCell), { border: BORDER });
  applyCellStyle(sheet.getCell(rightCell), { border: BORDER });
  sheet.getRow(row).height = 26;
}

function section(sheet, row, title) {
  sheet.mergeCells(`A${row}:H${row}`);
  sheet.getCell(`A${row}`).value = title;
  applyCellStyle(sheet.getCell(`A${row}`), { font: { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3478F6' } }, alignment: { horizontal: 'left' } });
  sheet.getRow(row).height = 28;
}

function addListValidation(sheet, cell, values) {
  sheet.dataValidations.add(cell, {
    type: 'list',
    allowBlank: true,
    formulae: [`"${values.join(',')}"`],
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: '选项无效',
    error: '请从下拉选项中选择。',
  });
}

function addStableValidations(sheet, sheetName) {
  for (const [key, , cell] of FIELD_LAYOUTS[sheetName]) {
    if (key.endsWith('SupportsInstall') || key === 'supportsInstall') addListValidation(sheet, cell, INSTALL_VALUES);
    if (key.endsWith('WithScreen') || key === 'withScreen') addListValidation(sheet, cell, SCREEN_VALUES);
    if (key === 'publicity') addListValidation(sheet, cell, PUBLICITY_VALUES);
    if (key === 'authType') addListValidation(sheet, cell, AUTH_VALUES);
  }
}

function setupSheet(sheet, sheetName, values = {}, state = {}) {
  sheet.views = [{ state: 'frozen', ySplit: 6 }];
  sheet.properties.defaultRowHeight = 22;
  [16, 20, 19, 19, 16, 20, 19, 19].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.mergeCells('A1:H1');
  sheet.getCell('A1').value = `OpenHarmony兼容性申请 - ${sheetName}`;
  applyCellStyle(sheet.getCell('A1'), { font: { bold: true, size: 15, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }, alignment: { horizontal: 'left' } });
  sheet.getRow(1).height = 32;
  sheet.mergeCells('B3:D3'); sheet.mergeCells('F3:H3'); sheet.mergeCells('B4:D4'); sheet.mergeCells('F4:H4'); sheet.mergeCells('B5:H5');
  for (const [labelCell, valueCell, label, value] of [
    ['A3', STATUS_CELLS.status, '处理状态', state.status || (Object.values(values).some((item) => normalizeText(item)) ? '待处理' : '')],
    ['E3', STATUS_CELLS.applicationId, '申请标识', state.applicationId],
    ['A4', STATUS_CELLS.assessmentNumber, '测评编号', state.assessmentNumber],
    ['E4', STATUS_CELLS.processedAt, '最近处理时间', state.processedAt],
    ['A5', STATUS_CELLS.notes, '处理说明', state.notes],
  ]) {
    sheet.getCell(labelCell).value = label;
    sheet.getCell(valueCell).value = value || '';
    applyCellStyle(sheet.getCell(labelCell), { font: { bold: true, color: { argb: 'FF334155' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FA' } }, border: BORDER });
    applyCellStyle(sheet.getCell(valueCell), { border: BORDER });
  }
  sheet.getRow(5).height = 34;
  if (sheetName === SHEETS.board) {
    section(sheet, 7, '产品定义');
    const fields = BOARD_FIELDS.filter(([key]) => !['softwareVersion', 'securityPatch', 'versionId', 'versionHash', 'pcidScPath'].includes(key));
    for (const [key, label, cell] of fields) mergeValueRow(sheet, Number(cell.slice(1)), label, cell, values[key]);
    section(sheet, 21, '软件定义');
    for (const [key, label, cell] of BOARD_FIELDS.filter(([key]) => ['softwareVersion', 'securityPatch', 'versionId', 'versionHash', 'pcidScPath'].includes(key))) mergeValueRow(sheet, Number(cell.slice(1)), label, cell, values[key]);
  } else if (sheetName === SHEETS.commercial) {
    section(sheet, 7, '产品定义');
    const fields = COMMERCIAL_FIELDS.filter(([key]) => !['softwareVersion', 'securityPatch', 'versionId', 'versionHash', 'pcidScPath'].includes(key));
    for (const [key, label, cell] of fields) mergeValueRow(sheet, Number(cell.slice(1)), label, cell, values[key]);
    section(sheet, 27, '软件定义');
    for (const [key, label, cell] of COMMERCIAL_FIELDS.filter(([key]) => ['softwareVersion', 'securityPatch', 'versionId', 'versionHash', 'pcidScPath'].includes(key))) mergeValueRow(sheet, Number(cell.slice(1)), label, cell, values[key]);
  } else {
    section(sheet, 7, '产品定义');
    for (const [key, label, cell] of RELEASE_FIELDS.filter(([, , fieldCell]) => Number(fieldCell.match(/\d+/)[0]) < 17)) mergeValueRow(sheet, Number(cell.slice(1)), label, cell, values[key]);
    section(sheet, 16, '关联硬件配置（固定两套）');
    for (const row of [17, 18, 19, 20, 21]) {
      const fields = RELEASE_FIELDS.filter(([, , cell]) => Number(cell.match(/\d+/)[0]) === row);
      mergePairRow(sheet, row, fields[0][1], fields[0][2], values[fields[0][0]], fields[1][1], fields[1][2], values[fields[1][0]]);
    }
    section(sheet, 23, '软件定义');
    for (const [key, label, cell] of RELEASE_FIELDS.filter(([, , cell]) => Number(cell.match(/\d+/)[0]) === 24 || Number(cell.match(/\d+/)[0]) === 25)) mergeValueRow(sheet, Number(cell.slice(1)), label, cell, values[key]);
    section(sheet, 26, '关联硬件软件信息');
    for (const row of [27, 28, 29]) {
      const fields = RELEASE_FIELDS.filter(([, , cell]) => Number(cell.match(/\d+/)[0]) === row);
      mergePairRow(sheet, row, fields[0][1], fields[0][2], values[fields[0][0]], fields[1][1], fields[1][2], values[fields[1][0]]);
    }
  }
  for (const [key, , cell] of FIELD_LAYOUTS[sheetName]) {
    const cellRef = sheet.getCell(cell);
    if (key.includes('appearancePaths') || key.includes('versionId') || key.includes('PcidScPath')) cellRef.alignment = { vertical: 'center', wrapText: true };
  }
  addStableValidations(sheet, sheetName);
}

function blankRecord(sheetName) {
  return recordFromValues(sheetName, {}, { status: '' });
}

async function writeSingleDeviceWorkbook(destination, record) {
  const ExcelJS = loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OpenHarmony Compatibility Application Skill';
  workbook.created = new Date();
  workbook.modified = new Date();
  for (const sheetName of SHEET_ORDER) {
    const sheet = workbook.addWorksheet(sheetName);
    const current = sheetName === record.sheetName ? record : blankRecord(sheetName);
    setupSheet(sheet, sheetName, recordToValues(current), recordState(current));
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await workbook.xlsx.writeFile(destination);
}

export async function createPhase2Workbook(outputPath = DEFAULT_WORKBOOK_PATH) {
  const destination = toWslPath(outputPath);
  if (!isAbsoluteLocalPath(destination) || path.extname(destination).toLowerCase() !== '.xlsx') throw new Error('输出路径必须为绝对路径的 .xlsx 文件');
  let record = blankRecord(SHEETS.board);
  try {
    await fs.access(destination);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (await fs.access(destination).then(() => true).catch(() => false)) {
    ({ record } = await readWorkbook(destination));
  }
  if (record.assessmentNumber && !record.applicationId) {
    record.processingStatus = '待平台核验';
    record.notes = '由旧格式迁移，运行时将回读平台避免重复申请。';
  }
  await writeSingleDeviceWorkbook(destination, record);
  return destination;
}

export async function writeWorkbookState(workbookPath, patch) {
  const { sourcePath, record } = await readWorkbook(toWslPath(workbookPath));
  Object.assign(record, {
    applicationId: patch.applicationId ?? record.applicationId,
    assessmentNumber: patch.assessmentNumber ?? record.assessmentNumber,
    processingStatus: patch.status ?? record.processingStatus,
    processedAt: patch.processedAt ?? new Date().toISOString().replace('T', ' ').slice(0, 19),
    notes: patch.notes ?? record.notes,
  });
  await writeSingleDeviceWorkbook(sourcePath, record);
  return { sourcePath, record };
}

export function encodeVersionId(value) {
  return normalizeText(value).replaceAll(',', '∑');
}

export function expectedSoftwareValues(record) {
  const devices = record.type === 'release' ? record.devices : [record];
  return {
    softwareVersion: record.softwareVersion,
    securityPatch: record.securityPatch,
    versionIds: devices.map((device) => device.versionId),
    versionHashes: devices.map((device) => device.versionHash),
    pcidScPaths: devices.map((device) => device.pcidScPath).filter(Boolean),
  };
}
