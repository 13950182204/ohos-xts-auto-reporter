import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// 纯 JS 模块，无类型声明；测试只覆盖本地纯逻辑，不联网、不启动浏览器。
// @ts-expect-error 纯 JS 模块，无类型声明
import {
  ALLOWED_NAME_PATTERN,
  MIRROR_EXTENSIONS,
  detectMirrorExtension,
  formatBytes,
  formatSpeed,
  overallPercent,
  parseMirrorArgs,
  parseUploadProgressText,
  resolveMirrorFile,
  sanitizeMirrorFileName,
  validateMirrorFileName,
} from '../scripts/mirror_logic.mjs'

/** 建一个临时目录跑用例，结束后无条件删除。 */
function withTempDir(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'mirror-logic-'))
  try {
    run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function writeFile(directory: string, name: string, bytes: number, content = 'x'): string {
  const filePath = join(directory, name)
  writeFileSync(filePath, content.repeat(Math.max(bytes, 0)))
  return filePath
}

describe('firmware extension detection', () => {
  it('keeps the documented extension list and matches the longest suffix case-insensitively', () => {
    expect(MIRROR_EXTENSIONS).toEqual(['.zip', '.7z', '.rar', '.tar', '.tar.gz', '.tar.bz2', '.tar.xz'])
    expect(detectMirrorExtension('DH-76AM.7z')).toBe('.7z')
    expect(detectMirrorExtension('备份.TAR.GZ')).toBe('.tar.gz')
    expect(detectMirrorExtension('readme.txt')).toBe('')
    expect(detectMirrorExtension('')).toBe('')
  })
})

describe('mirror firmware file resolution', () => {
  it('accepts an existing non-empty firmware file and reports its metadata', () => {
    withTempDir((directory) => {
      const filePath = writeFile(directory, 'DH-76AM-KS11C-20261104.7z', 2048)
      const result = resolveMirrorFile(filePath)
      expect(result.ok).toBe(true)
      expect(result.code).toBe('')
      expect(result.path).toBe(filePath)
      expect(result.fileName).toBe('DH-76AM-KS11C-20261104.7z')
      expect(result.extension).toBe('.7z')
      expect(result.sizeBytes).toBe(2048)
      expect(result.problems).toEqual([])
    })
  })

  it('matches the longest known extension (.tar.gz before .tar)', () => {
    withTempDir((directory) => {
      const filePath = writeFile(directory, 'firmware-20261104.tar.gz', 16)
      const result = resolveMirrorFile(filePath)
      expect(result.ok).toBe(true)
      expect(result.extension).toBe('.tar.gz')
    })
  })

  it('rejects a missing path, an unsupported suffix and an empty file', () => {
    withTempDir((directory) => {
      const missing = resolveMirrorFile(join(directory, 'missing.zip'))
      expect(missing.ok).toBe(false)
      expect(missing.code).toBe('NOT_FOUND')

      const unsupported = resolveMirrorFile(writeFile(directory, 'readme.txt', 16))
      expect(unsupported.ok).toBe(false)
      expect(unsupported.code).toBe('UNSUPPORTED_EXTENSION')
      expect(unsupported.problems.join(' ')).toContain('.7z')

      const empty = resolveMirrorFile(writeFile(directory, 'empty.zip', 0))
      expect(empty.ok).toBe(false)
      expect(empty.code).toBe('EMPTY_FILE')
    })
  })

  it('resolves a directory holding exactly one candidate firmware file', () => {
    withTempDir((directory) => {
      const firmware = writeFile(directory, 'firmware.zip', 32)
      writeFile(directory, 'readme.txt', 8)
      mkdirSync(join(directory, 'nested'))
      writeFile(join(directory, 'nested'), 'other.7z', 32)
      const result = resolveMirrorFile(directory)
      expect(result.ok).toBe(true)
      expect(result.path).toBe(firmware)
      expect(result.fileName).toBe('firmware.zip')
      expect(result.candidates).toEqual(['firmware.zip'])
    })
  })

  it('prefers .zip/.7z when a directory also contains other archives', () => {
    withTempDir((directory) => {
      writeFile(directory, 'a.rar', 10)
      const preferred = writeFile(directory, 'b.zip', 20)
      const result = resolveMirrorFile(directory)
      expect(result.ok).toBe(true)
      expect(result.path).toBe(preferred)
    })
  })

  it('refuses to guess when several candidates remain and lists their names', () => {
    withTempDir((directory) => {
      writeFile(directory, 'a.zip', 10)
      writeFile(directory, 'b.7z', 10)
      const result = resolveMirrorFile(directory)
      expect(result.ok).toBe(false)
      expect(result.code).toBe('FOLDER_AMBIGUOUS')
      expect(result.problems.join(' ')).toContain('a.zip')
      expect(result.problems.join(' ')).toContain('b.7z')
    })
  })

  it('reports a directory without firmware candidates', () => {
    withTempDir((directory) => {
      writeFile(directory, 'readme.txt', 8)
      const result = resolveMirrorFile(directory)
      expect(result.ok).toBe(false)
      expect(result.code).toBe('FOLDER_EMPTY')
    })
  })
})

describe('platform firmware file name rule', () => {
  it('accepts Chinese, ASCII letters/digits, spaces and _ - . ( )', () => {
    for (const name of ['DH-76AM-KS11C-20261104.7z', '固件 2026 (正式版)_v1.2.7z', 'a_b-c (1).tar.gz']) {
      expect(ALLOWED_NAME_PATTERN.test(name)).toBe(true)
      expect(validateMirrorFileName(name).ok).toBe(true)
    }
  })

  it('rejects the ideographic comma and full-width brackets with a usable suggestion', () => {
    const comma = validateMirrorFileName('固件、测试.7z')
    expect(comma.ok).toBe(false)
    expect(comma.problems.join(' ')).toContain('不允许的字符')
    expect(comma.sanitized).toBe('固件 测试.7z')

    const brackets = validateMirrorFileName('固件（测试）.7z')
    expect(brackets.ok).toBe(false)
    expect(brackets.sanitized).toBe('固件 测试.7z')

    const symbol = validateMirrorFileName('固件&测试.7z')
    expect(symbol.ok).toBe(false)
    expect(symbol.sanitized).toBe('固件 测试.7z')
  })

  it('rejects empty names and surrounding whitespace', () => {
    expect(validateMirrorFileName('   ').ok).toBe(false)
    expect(validateMirrorFileName('').ok).toBe(false)
    expect(validateMirrorFileName('a.zip ').ok).toBe(false)
    expect(validateMirrorFileName('a.zip ').problems.join(' ')).toContain('空白')
  })
})

describe('file name sanitising', () => {
  it('replaces illegal characters with a single space and keeps the extension', () => {
    expect(sanitizeMirrorFileName('固件（测试）、v1.7z')).toBe('固件 测试 v1.7z')
    expect(sanitizeMirrorFileName('固件！版本#2.tar.gz')).toBe('固件 版本 2.tar.gz')
    expect(sanitizeMirrorFileName('固件 .7z')).toBe('固件.7z')
  })

  it('leaves an already valid name untouched', () => {
    expect(sanitizeMirrorFileName('DH-76AM (正式) _v1.2.7z')).toBe('DH-76AM (正式) _v1.2.7z')
    expect(sanitizeMirrorFileName('  a_b-c (1).zip  ')).toBe('a_b-c (1).zip')
  })

  it('falls back to a non-empty base when only illegal characters remain', () => {
    expect(sanitizeMirrorFileName('、、.zip')).toBe('firmware.zip')
    expect(sanitizeMirrorFileName('')).toBe('')
  })
})

describe('upload progress text parsing', () => {
  it('parses the parsing stage', () => {
    expect(parseUploadProgressText('DH-76AM-KS11C-20261104.7z解析中：12.40%')).toEqual({ stage: 'parsing', percent: 12.4 })
  })

  it('parses the uploading stage', () => {
    expect(parseUploadProgressText('DH-76AM-KS11C-20261104.7z上传中：35.57%')).toEqual({ stage: 'uploading', percent: 35.57 })
  })

  it('parses the server-side validating stage (tag and number may be adjacent)', () => {
    // 站点里「校验中」标签后没有冒号，innerText 会拼成「校验中100.00%」
    expect(parseUploadProgressText('DH-76AM-KS11C-20261104.7z校验中100.00%')).toEqual({ stage: 'validating', percent: 100 })
    expect(parseUploadProgressText('校验中：42.50%')).toEqual({ stage: 'validating', percent: 42.5 })
  })

  it('parses the real toolbar progress block', () => {
    const progressText = ['上传文件', 'DH-76AM-KS11C-20261104.7z', '上传中：34.03%'].join('\n')
    expect(parseUploadProgressText(progressText)).toEqual({ stage: 'uploading', percent: 34.03 })
  })

  it('finds the progress line inside the whole dialog text', () => {
    const dialogText = [
      '提示',
      '文件名可使用 中文、英文、数字、以及 空格 _ - . ( )',
      'DH-76AM-KS11C-20261104.7z上传中：35.57%',
      '取消',
      '选择文件',
    ].join('\n')
    expect(parseUploadProgressText(dialogText)).toEqual({ stage: 'uploading', percent: 35.57 })
  })

  it('uses the latest stage line when parsing and uploading lines coexist', () => {
    const text = 'DH-76AM-KS11C-20261104.7z解析中：100.00%\nDH-76AM-KS11C-20261104.7z上传中：0.00%'
    expect(parseUploadProgressText(text)).toEqual({ stage: 'uploading', percent: 0 })
  })

  it('detects done text but not a finished parsing stage', () => {
    expect(parseUploadProgressText('上传成功')).toEqual({ stage: 'done', percent: 100 })
    expect(parseUploadProgressText('DH-76AM-KS11C-20261104.7z 已上传 100.00%')).toEqual({ stage: 'done', percent: 100 })
    expect(parseUploadProgressText('DH-76AM-KS11C-20261104.7z解析中：100.00%')).toEqual({ stage: 'parsing', percent: 100 })
  })

  it('returns null for empty or unrelated text', () => {
    expect(parseUploadProgressText('')).toEqual({ stage: null, percent: null })
    expect(parseUploadProgressText('正在准备')).toEqual({ stage: null, percent: null })
    expect(parseUploadProgressText(undefined)).toEqual({ stage: null, percent: null })
  })
})

describe('overall progress mapping', () => {
  it('maps parsing to 0-10, uploading to 10-99 and done to 100', () => {
    expect(overallPercent(null, null)).toBe(0)
    expect(overallPercent('parsing', 0)).toBe(0)
    expect(overallPercent('parsing', 50)).toBe(5)
    expect(overallPercent('parsing', 100)).toBe(10)
    expect(overallPercent('uploading', 0)).toBe(10)
    expect(overallPercent('uploading', 50)).toBe(54.5)
    expect(overallPercent('uploading', 100)).toBe(99)
    expect(overallPercent('done', null)).toBe(100)
    expect(overallPercent('done', 100)).toBe(100)
  })

  it('clamps out-of-range stage percentages', () => {
    expect(overallPercent('parsing', -5)).toBe(0)
    expect(overallPercent('uploading', 250)).toBe(99)
  })

  it('maps the server-side validating stage to 99-99.9', () => {
    expect(overallPercent('validating', 0)).toBe(99)
    expect(overallPercent('validating', 50)).toBe(99.5)
    expect(overallPercent('validating', 100)).toBe(99.9)
  })
})

describe('byte and speed formatting', () => {
  it('formats sizes with binary units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-1024)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(677966057)).toBe('646.6 MB')
    expect(formatBytes(1073741824)).toBe('1 GB')
  })

  it('formats transfer speed', () => {
    expect(formatSpeed(0)).toBe('0 B/s')
    expect(formatSpeed(1536)).toBe('1.5 KB/s')
    expect(formatSpeed(3228410)).toBe('3.1 MB/s')
  })
})

describe('CLI argument parsing', () => {
  it('accepts --input, --dry-run, --rename, --artifacts and the host --upload flag', () => {
    expect(parseMirrorArgs(['--input', '/a/b.7z', '--dry-run'])).toMatchObject({
      input: '/a/b.7z', dryRun: true, upload: false, rename: false,
    })
    expect(parseMirrorArgs(['--input', '/a', '--artifacts', '/tmp/x', '--rename', '--upload'])).toMatchObject({
      input: '/a', artifacts: '/tmp/x', rename: true, upload: true, dryRun: false,
    })
  })

  it('rejects unknown arguments and a missing --input', () => {
    expect(() => parseMirrorArgs(['--nope'])).toThrow(/未知参数/)
    expect(() => parseMirrorArgs([])).toThrow(/--input/)
    expect(() => parseMirrorArgs(['--input'])).toThrow(/需要一个值/)
  })
})
