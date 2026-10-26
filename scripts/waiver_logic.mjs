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
