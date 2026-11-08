import fs from 'node:fs';
import path from 'node:path';

/**
 * 镜像固件上传的纯逻辑层（不联网、不启动浏览器）：
 * 本地文件解析、平台文件名规则、上传进度文本解析、进度映射与文案格式化。
 * 宿主、CLI 与测试共用这一份实现，避免三处各写一套规则。
 */

/** 平台「镜像管理」可接受的固件包扩展名（小写，最长后缀优先匹配）。 */
export const MIRROR_EXTENSIONS = ['.zip', '.7z', '.rar', '.tar', '.tar.gz', '.tar.bz2', '.tar.xz'];

/** 目录里挑候选文件时优先的扩展名（实测上传过的格式）。 */
export const PRIORITY_EXTENSIONS = ['.zip', '.7z'];

/**
 * 平台文件名规则：可使用 中文、英文、数字、以及 空格 _ - . ( )；
 * 不要出现顿号（、）、全角括号（（））等其它标点。
 */
export const ALLOWED_NAME_PATTERN = /^[\p{Script=Han}A-Za-z0-9 _\-.()]+$/u;

/** ALLOWED_NAME_PATTERN 的补集（连续多字符一次替换为空格）。 */
const ILLEGAL_NAME_CHARS = /[^\p{Script=Han}A-Za-z0-9 _\-.()]+/gu;

/** 上传进度里「正在做什么」的三个阶段（站点镜像上传：解析 md5 → 上传分片 → 服务端校验）。 */
const ACTIVE_STAGE_PATTERN = /(解析中|上传中|校验中)\s*[：:]?\s*(\d+(?:\.\d+)?)\s*%/g;

/** 完成类文案（对话框/文件列表都可能出现）。 */
const DONE_MARKER_PATTERN = /(?:上传成功|上传完毕|上传完成|成功上传|上传已完成|已上传)/;

/** 返回文件名对应的固件扩展名（小写、最长后缀优先）；不是固件返回空串。 */
export function detectMirrorExtension(fileName) {
  const name = String(fileName ?? '').trim().toLowerCase();
  if (!name) return '';
  let matched = '';
  for (const extension of MIRROR_EXTENSIONS) {
    if (name.endsWith(extension) && extension.length > matched.length) {
      matched = extension;
    }
  }
  return matched;
}

/**
 * 校验平台文件名规则。
 * 返回 { ok, problems, sanitized }：sanitized 是可直接用于 --rename 临时副本的净化名。
 */
export function validateMirrorFileName(fileName) {
  const name = String(fileName ?? '');
  const problems = [];
  if (!name.trim()) {
    problems.push('固件文件名为空。');
  } else {
    if (name !== path.basename(name)) {
      problems.push(`文件名不能包含路径分隔符：${name}`);
    }
    if (!ALLOWED_NAME_PATTERN.test(name)) {
      const illegal = Array.from(new Set(Array.from(name).filter((character) => !/[\p{Script=Han}A-Za-z0-9 _\-.()]/u.test(character))));
      const listed = illegal.map((character) => `「${character}」`).join('');
      problems.push(`文件名含平台不允许的字符：${listed}（仅允许中文、英文、数字、空格与 _ - . ( )）。`);
    }
    if (name.trim() !== name) {
      problems.push('文件名首尾不能有空白字符。');
    }
  }
  return { ok: problems.length === 0, problems, sanitized: sanitizeMirrorFileName(name) };
}

/**
 * 把文件名净化为平台允许的形态：非法字符替换为空格 → 折叠连续空格 → 去首尾空白，
 * 扩展名原样保留；净化后为空时用 firmware 兜底，保证结果永远可上传。
 */
export function sanitizeMirrorFileName(fileName) {
  const name = String(fileName ?? '').trim();
  if (!name) return '';
  const lowerExtension = detectMirrorExtension(name);
  let extension = lowerExtension ? name.slice(name.length - lowerExtension.length) : path.extname(name);
  if (extension === '.') extension = '';
  const baseRaw = extension ? name.slice(0, name.length - extension.length) : name;
  const base = baseRaw
    .replace(ILLEGAL_NAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  return `${base || 'firmware'}${extension}`;
}

/**
 * 解析固件输入路径。
 *
 * - 文件：校验扩展名、存在性、大小 > 0。
 * - 目录：只看直接子文件；.zip/.7z 优先；优先级池里只剩唯一一个才采用，
 *   多于一个给 problems 并列出候选名（不猜），没有候选也报错。
 *
 * 返回 { ok, path, fileName, extension, sizeBytes, problems, code, inputPath, candidates }。
 * code 供 CLI 映射成错误码，problems 是给用户看的中文说明。
 */
export function resolveMirrorFile(inputPath) {
  const result = {
    ok: false,
    path: '',
    fileName: '',
    extension: '',
    sizeBytes: 0,
    problems: [],
    code: '',
    inputPath: '',
    candidates: [],
  };

  const text = String(inputPath ?? '').trim();
  if (!text) {
    result.code = 'INPUT_REQUIRED';
    result.problems.push('固件路径为空：请指定固件文件，或包含固件的目录。');
    return result;
  }

  const absolute = path.resolve(text);
  result.inputPath = absolute;

  let stats;
  try {
    stats = fs.statSync(absolute);
  } catch {
    result.code = 'NOT_FOUND';
    result.problems.push(`路径不存在或不可访问：${absolute}`);
    return result;
  }

  let filePath = absolute;
  if (stats.isDirectory()) {
    let entries;
    try {
      entries = fs.readdirSync(absolute, { withFileTypes: true });
    } catch (error) {
      result.code = 'FOLDER_UNREADABLE';
      result.problems.push(`目录不可读：${absolute}（${error?.message ?? String(error)}）`);
      return result;
    }
    const candidates = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => detectMirrorExtension(name) !== '')
      .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
    result.candidates = candidates;
    if (candidates.length === 0) {
      result.code = 'FOLDER_EMPTY';
      result.problems.push(`目录内没有可上传的固件文件（支持 ${MIRROR_EXTENSIONS.join('、')}）：${absolute}`);
      return result;
    }
    const preferred = candidates.filter((name) => PRIORITY_EXTENSIONS.includes(detectMirrorExtension(name)));
    const pool = preferred.length > 0 ? preferred : candidates;
    if (pool.length > 1) {
      result.code = 'FOLDER_AMBIGUOUS';
      result.problems.push(`目录内有多个候选固件文件，请明确指定要上传的其中一个：${pool.join('、')}`);
      return result;
    }
    filePath = path.join(absolute, pool[0]);
  } else if (!stats.isFile()) {
    result.code = 'NOT_A_FILE';
    result.problems.push(`路径既不是文件也不是目录：${absolute}`);
    return result;
  }

  let fileStats = stats;
  if (filePath !== absolute) {
    try {
      fileStats = fs.statSync(filePath);
    } catch {
      result.code = 'NOT_FOUND';
      result.problems.push(`候选固件文件不可访问：${filePath}`);
      return result;
    }
  }

  const fileName = path.basename(filePath);
  const extension = detectMirrorExtension(fileName);
  result.path = filePath;
  result.fileName = fileName;
  result.extension = extension;
  result.sizeBytes = fileStats.size;

  if (!extension) {
    result.code = 'UNSUPPORTED_EXTENSION';
    result.problems.push(`不是支持的固件格式：${fileName}（支持 ${MIRROR_EXTENSIONS.join('、')}）`);
    return result;
  }
  if (fileStats.size <= 0) {
    result.code = 'EMPTY_FILE';
    result.problems.push(`固件文件为空（0 字节）：${filePath}`);
    return result;
  }

  result.ok = true;
  return result;
}

/**
 * 解析上传进度文本（对话框/工具栏进度区都可能出现）。
 * 例：`DH-76AM-KS11C-20261104.7z解析中：12.40%`、`…上传中：35.57%`、`校验中100.00%`、完成类文案。
 * 文本里同时出现多行时取最后一条阶段信息（最新状态）。
 */
/**
 * 平台镜像列表里是否已经存在同名文件。
 * 平台「镜像管理」按文件名去重不严（同名可以传多条），所以上传前先自己判一次：
 * 已经有同名且已完成的记录就不再传，避免把同一条固件重复刷进列表。
 * 返回 { matched, row, sizeMismatch, notCompleted }，方便调用方给出可读原因。
 */
export function findMirrorMatch(rows, fileName, { sizeBytes = 0 } = {}) {
  const target = typeof fileName === 'string' ? fileName.trim() : '';
  if (!target || !Array.isArray(rows)) return { matched: false };
  const candidates = rows.filter((row) => {
    const name = typeof row?.fileName === 'string' ? row.fileName.trim() : '';
    return name === target;
  });
  if (!candidates.length) return { matched: false };
  const completed = candidates.find((row) => isCompletedMirrorRow(row));
  const row = completed || candidates[0];
  const rowSize = Number(row?.fileSize);
  const localSize = Number(sizeBytes);
  const tolerance = Number.isFinite(localSize) && localSize > 0 ? Math.max(4096, localSize * 0.005) : 0;
  const sizeMismatch = Number.isFinite(rowSize) && rowSize > 0 && localSize > 0
    ? Math.abs(rowSize - localSize) > tolerance
    : false;
  return {
    matched: true,
    row,
    sizeMismatch,
    notCompleted: !completed,
  };
}

/** 平台用 isCompleted=1 表示这条镜像已经传完；老接口有的返回布尔/字符串，一并兼容。 */
export function isCompletedMirrorRow(row) {
  const value = row?.isCompleted;
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  return String(value).trim() === '1' || String(value).trim().toLowerCase() === 'true';
}

export function parseUploadProgressText(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) return { stage: null, percent: null };

  let latest = null;
  for (const match of raw.matchAll(ACTIVE_STAGE_PATTERN)) {
    const percent = Math.min(100, Math.max(0, Number(match[2])));
    if (Number.isFinite(percent)) {
      const stage = match[1] === '解析中' ? 'parsing' : match[1] === '校验中' ? 'validating' : 'uploading';
      latest = { stage, percent };
    }
  }
  if (latest) return latest;
  if (DONE_MARKER_PATTERN.test(raw)) return { stage: 'done', percent: 100 };
  return { stage: null, percent: null };
}

/**
 * 阶段内百分比 → 总进度（0–100）：
 * 解析阶段映射 0–10，上传阶段映射 10–99，服务端校验阶段映射 99–99.9，done 为 100。
 */
export function overallPercent(stage, percent) {
  if (stage === 'done') return 100;
  if (stage !== 'parsing' && stage !== 'uploading' && stage !== 'validating') return 0;
  const raw = Number(percent);
  if (!Number.isFinite(raw)) {
    if (stage === 'parsing') return 0;
    return stage === 'uploading' ? 10 : 99;
  }
  const clamped = Math.min(100, Math.max(0, raw));
  let mapped;
  if (stage === 'uploading') mapped = 10 + clamped * 0.89;
  else if (stage === 'validating') mapped = 99 + clamped * 0.009;
  else mapped = clamped * 0.1;
  return Math.round(mapped * 10) / 10;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 人类可读的大小，如 646.6 MB；非正数/非法值统一给 0 B。 */
export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < BYTE_UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const number = unit === 0 ? String(Math.round(size)) : size.toFixed(1).replace(/\.0$/, '');
  return `${number} ${BYTE_UNITS[unit]}`;
}

/** 人类可读的速度，如 3.1 MB/s。 */
export function formatSpeed(bytesPerSecond) {
  const rate = Number(bytesPerSecond);
  if (!Number.isFinite(rate) || rate <= 0) return '0 B/s';
  return `${formatBytes(rate)}/s`;
}

/**
 * CLI 参数解析。
 * --upload 是宿主显式传的「真实上传」开关（与默认行为等价，接受它以免宿主调用失败）。
 */
export function parseMirrorArgs(argv) {
  const options = { input: null, artifacts: null, dryRun: false, upload: false, rename: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--upload') {
      options.upload = true;
    } else if (argument === '--rename') {
      options.rename = true;
    } else if (argument === '--input' || argument === '--artifacts') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} 需要一个值`);
      }
      options[argument.slice(2)] = value;
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }
  if (!options.help && !options.input) {
    throw new Error('缺少 --input <固件文件或目录>');
  }
  return options;
}
