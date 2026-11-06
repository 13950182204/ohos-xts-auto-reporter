import path from 'node:path';

export const REQUIRED_FIELDS = [
  'assessmentNumber',
  'testCategory',
  'moduleName',
  'waiverReason',
  'attachmentPath',
];

export const SAFE_SAVE_LABELS = new Set(['保存', '暂存']);

export function parseArgs(argv) {
  const options = { dryRun: true, save: false, artifacts: null, input: null };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      if (options.save) {
        throw new Error('--dry-run cannot be combined with --save');
      }
      options.dryRun = true;
      options.save = false;
    } else if (argument === '--save') {
      options.dryRun = false;
      options.save = true;
    } else if (argument === '--input' || argument === '--artifacts') {
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

  if (!options.help && !options.input) {
    throw new Error('--input is required');
  }
  return options;
}

/**
 * 测试套分类：一级目录名 → 平台字典 test_type。
 * 现网豁免资料只有 Acts / ActsValidator；Hats / Dcts / Ssts 是按用户要求预留的检测，
 * 资料里一旦出现同名目录即可自动识别，无需再改代码。
 */
export const CATEGORY_FOLDERS = {
  acts: 'ACTS',
  actsvalidator: 'ACTS-Validator',
  hats: 'HATS',
  dcts: 'DCTS',
  ssts: 'SSTS',
};

/**
 * 归一化测试套分类：目录名（Acts / ActsValidator）与平台规范值
 * （ACTS / ACTS-VALIDATOR / HATS / DCTS / SSTS，大小写不敏感）都归一到平台字典值；
 * 识别不到返回空串。
 */
export function normalizeTestCategory(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  // 只忽略大小写与分隔符差异（ActsValidator / ACTS-VALIDATOR / acts_validator 同一个键）；
  // 其它字符保留，避免把「ACTS 全量报告」这类整句误判成分类值。
  const key = text.toLowerCase().replace(/[\s_-]+/g, '');
  return CATEGORY_FOLDERS[key] ?? '';
}

const REPORT_HEADER_RE = /^测试报告[：:]\s*([A-Za-z][A-Za-z0-9_-]*)/m;

/** target 是否位于 rootPath 之内（rootPath 为空表示不限定范围）。 */
function withinRoot(rootPath, target) {
  if (!rootPath) return true;
  const relative = path.relative(rootPath, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * 识别一份豁免报告的测试套分类（分类不再人工填写）。
 *
 * 优先级：
 * ① 从报告所在目录向上、最多到 rootPath，找第一个能映射的目录名——目录结构是豁免资料
 *    的事实来源，平台提交路径也由它推导；
 * ② 报告首部 `测试报告：ACTS 全量报告 …` 作为二级兜底（正文里的
 *    「平台提交路径 Acts/<模块名>/<套件名>.txt」是模板占位符，不解析）；
 * ③ 都没有时 testCategory 为空串，由调用方报「无法识别测试套分类」。
 *
 * 返回 { testCategory, categoryFolder, categoryDirectory }；仅靠首部识别时后两者为空串。
 */
export function detectTestCategory({ reportPath, rootPath, reportText } = {}) {
  if (!reportPath) return { testCategory: '', categoryFolder: '', categoryDirectory: '' };
  const report = path.resolve(reportPath);
  const boundary = rootPath ? path.resolve(rootPath) : '';
  const bounded = boundary !== '' && withinRoot(boundary, report);
  let current = path.dirname(report);
  while (true) {
    const folder = path.basename(current);
    const testCategory = normalizeTestCategory(folder);
    if (testCategory) return { testCategory, categoryFolder: folder, categoryDirectory: current };
    const parent = path.dirname(current);
    if (parent === current) break;
    if (bounded && current === boundary) break;
    current = parent;
  }
  const header = REPORT_HEADER_RE.exec(String(reportText ?? ''));
  if (header) {
    const testCategory = normalizeTestCategory(header[1]);
    if (testCategory) return { testCategory, categoryFolder: '', categoryDirectory: '' };
  }
  return { testCategory: '', categoryFolder: '', categoryDirectory: '' };
}

/**
 * 平台提交路径：报告相对扫描根的 POSIX 路径（如 `Acts/<模块>/<套件>.txt`）。
 * 单文件输入时 rootPath 传「识别到的分类目录的父目录」，结果仍是 `Acts/<模块>/<套件>.txt`。
 * 报告不在 rootPath 之内时退化为文件名，避免产出 `../` 这种不可提交的路径。
 */
export function submissionPathFor({ rootPath, reportPath } = {}) {
  if (!reportPath) return '';
  const report = path.resolve(reportPath);
  const root = rootPath ? path.resolve(rootPath) : path.dirname(report);
  const relative = path.relative(root, report);
  const posix = relative.split(path.sep).join('/');
  if (!posix || posix.startsWith('../') || path.isAbsolute(relative)) return path.basename(report);
  return posix;
}

export function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Input must be a JSON object');
  }

  for (const field of REQUIRED_FIELDS) {
    if (typeof input[field] !== 'string' || !input[field].trim()) {
      throw new Error(`Input field ${field} must be a non-empty string`);
    }
  }
  if (input.testsuite !== undefined && typeof input.testsuite !== 'string') {
    throw new Error('Input field testsuite must be a string when provided');
  }
  if (input.testcases !== undefined && (!Array.isArray(input.testcases)
    || input.testcases.some((testcase) => typeof testcase !== 'string' || !testcase.trim()))) {
    throw new Error('Input field testcases must be a non-empty string array when provided');
  }
  // 豁免资料规范（与闭环插件一致）：一条申请 = 一个模块的一个 Testsuite。
  // 平台 Testsuit 只接受单个套件名，Testcase 是英文逗号分隔的裸用例名；
  // 有 testcases 就必须给 testsuite，否则平台会退化成「整个模块/整个套件豁免」，扩大豁免范围。
  const testsuite = input.testsuite?.trim() || '';
  const testcases = input.testcases?.map((testcase) => testcase.trim()) || [];
  if (testsuite.includes(',')) {
    throw new Error('Input field testsuite must be a single test suite name (no comma); split it into separate waivers');
  }
  if (testcases.length > 0 && !testsuite) {
    throw new Error('Input field testsuite is required when testcases is provided');
  }
  if (testcases.some((testcase) => testcase.includes(',') || testcase.includes('#'))) {
    throw new Error('Input field testcases must contain bare test case names (split by comma outside, not inside an entry)');
  }
  if (!path.isAbsolute(input.attachmentPath)) {
    throw new Error('attachmentPath must be an absolute path');
  }
  return {
    ...input,
    testsuite: input.testsuite?.trim() || '',
    testcases: input.testcases?.map((testcase) => testcase.trim()) || [],
    assessmentNumber: input.assessmentNumber.trim(),
    testCategory: input.testCategory.trim(),
    moduleName: input.moduleName.trim(),
    waiverReason: input.waiverReason.trim(),
    attachmentPath: input.attachmentPath.trim(),
  };
}

export function isSafeSaveLabel(label) {
  return SAFE_SAVE_LABELS.has(normalizeText(label));
}

export function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, '').trim();
}

/** 同键匹配（不区分状态）：测评编号 + 模块 + 测试套 + 用例。 */
export function waiverMatchForInput(row, input) {
  return normalizeText(row.certificationNumber) === normalizeText(input.assessmentNumber)
    && normalizeText(row.module) === normalizeText(input.moduleName)
    && normalizeText(row.testSuite) === normalizeText(input.testsuite)
    && normalizeText(row.testCase) === normalizeText(input.testcases.join(','));
}

/** 已存在的“待提交”同键草稿。 */
export function isPendingDraftForInput(row, input) {
  return Number(row.status) === 0 && waiverMatchForInput(row, input);
}
