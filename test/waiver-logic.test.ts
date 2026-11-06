import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// 豁免资料规范：一条申请 = 一个模块的一个 Testsuite（见 SKILL.md「豁免资料目录与提交模型（强制）」）
// 分类不再人工填写：由豁免资料目录结构识别，报告首部「测试报告：ACTS 全量报告 …」兜底。
// @ts-expect-error 纯 JS 模块，无类型声明
import {
  CATEGORY_FOLDERS,
  detectTestCategory,
  normalizeTestCategory,
  submissionPathFor,
  validateInput,
} from '../scripts/waiver_logic.mjs'

const base = {
  assessmentNumber: 'OHC-TEST-1',
  testCategory: 'ACTS',
  moduleName: 'ActsDemo',
  waiverReason: '测试侧断言容差',
  attachmentPath: '/tmp/ActsDemo/DemoSuite-豁免材料.zip',
}

describe('waiver input: one module + one testsuite per waiver', () => {
  it('accepts a single testsuite with bare case names', () => {
    const input = validateInput({ ...base, testsuite: 'DemoSuite', testcases: ['CaseA', 'CaseB'] })
    expect(input.testsuite).toBe('DemoSuite')
    expect(input.testcases).toEqual(['CaseA', 'CaseB'])
  })

  it('rejects a comma-joined testsuite (must be split into separate waivers)', () => {
    expect(() => validateInput({ ...base, testsuite: 'SuiteA,SuiteB', testcases: ['CaseA'] })).toThrow(/single test suite/)
  })

  it('requires testsuite when testcases are given', () => {
    expect(() => validateInput({ ...base, testcases: ['CaseA'] })).toThrow(/testsuite is required/)
  })

  it('rejects case entries that already contain a separator', () => {
    expect(() => validateInput({ ...base, testsuite: 'DemoSuite', testcases: ['CaseA,CaseB'] })).toThrow(/bare test case names/)
    expect(() => validateInput({ ...base, testsuite: 'DemoSuite', testcases: ['ActsDemo#DemoSuite#CaseA'] })).toThrow(/bare test case names/)
  })

  it('still requires a non-empty testCategory (filled by auto detection upstream)', () => {
    expect(() => validateInput({ ...base, testCategory: '  ', testsuite: 'DemoSuite' })).toThrow(/testCategory/)
    expect(() => validateInput({ ...base, testCategory: undefined, testsuite: 'DemoSuite' })).toThrow(/testCategory/)
  })
})

describe('test category mapping: folders, canonical values, reserved Hats/Dcts/Ssts', () => {
  it('maps every category folder to the platform dictionary value', () => {
    expect(CATEGORY_FOLDERS).toEqual({
      acts: 'ACTS',
      actsvalidator: 'ACTS-Validator',
      hats: 'HATS',
      dcts: 'DCTS',
      ssts: 'SSTS',
    })
  })

  it('normalizes folder names and canonical values case-insensitively', () => {
    expect(normalizeTestCategory('Acts')).toBe('ACTS')
    expect(normalizeTestCategory('ActsValidator')).toBe('ACTS-Validator')
    expect(normalizeTestCategory('acts_Validator')).toBe('ACTS-Validator')
    expect(normalizeTestCategory('ACTS')).toBe('ACTS')
    expect(normalizeTestCategory('ACTS-VALIDATOR')).toBe('ACTS-Validator')
    expect(normalizeTestCategory('acts-validator')).toBe('ACTS-Validator')
    expect(normalizeTestCategory('Hats')).toBe('HATS')
    expect(normalizeTestCategory('dcts')).toBe('DCTS')
    expect(normalizeTestCategory('SSTS')).toBe('SSTS')
    expect(normalizeTestCategory('  acts  ')).toBe('ACTS')
  })

  it('returns an empty string for unknown or empty values', () => {
    expect(normalizeTestCategory('ActsDemo')).toBe('')
    expect(normalizeTestCategory('ACTS 全量报告')).toBe('')
    expect(normalizeTestCategory('')).toBe('')
    expect(normalizeTestCategory(undefined)).toBe('')
    expect(normalizeTestCategory(null)).toBe('')
  })
})

describe('test category detection: folder structure first, report header as fallback', () => {
  const root = '/scan/exemption'

  it('detects the category from the exemption folder and returns the folder path', () => {
    const detected = detectTestCategory({ reportPath: `${root}/Acts/ActsAceEtsModuleAnimation1Test/AnimatorEase.txt`, rootPath: root })
    expect(detected).toEqual({
      testCategory: 'ACTS',
      categoryFolder: 'Acts',
      categoryDirectory: `${root}/Acts`,
    })
  })

  it('detects ActsValidator from the folder name', () => {
    const detected = detectTestCategory({ reportPath: `${root}/ActsValidator/ActsAudioTest/ActsAudioTest.txt`, rootPath: root })
    expect(detected.testCategory).toBe('ACTS-Validator')
    expect(detected.categoryFolder).toBe('ActsValidator')
  })

  it('detects the reserved Hats/Dcts/Ssts folders too', () => {
    expect(detectTestCategory({ reportPath: '/scan/Hats/ModuleA/SuiteA.txt', rootPath: '/scan' }).testCategory).toBe('HATS')
    expect(detectTestCategory({ reportPath: '/scan/Dcts/ModuleA/SuiteA.txt', rootPath: '/scan' }).testCategory).toBe('DCTS')
    expect(detectTestCategory({ reportPath: '/scan/Ssts/ModuleA/SuiteA.txt', rootPath: '/scan' }).testCategory).toBe('SSTS')
  })

  it('still detects the category from deeper directories below the module', () => {
    const detected = detectTestCategory({ reportPath: `${root}/Acts/ModuleA/rerun/SuiteA.txt`, rootPath: root })
    expect(detected.testCategory).toBe('ACTS')
    expect(detected.categoryDirectory).toBe(`${root}/Acts`)
  })

  it('falls back to the report header when no folder maps', () => {
    const detected = detectTestCategory({
      reportPath: '/scan/upload/SuiteA.txt',
      rootPath: '/scan',
      reportText: [
        '1. 失败用例',
        '',
        '测试报告：ACTS 全量报告 2026-11-05-08-52-28（4731 用例 / 44 失败）',
        '正文里的平台提交路径 Acts/<模块名>/<套件名>.txt 是模板占位符。',
      ].join('\n'),
    })
    expect(detected.testCategory).toBe('ACTS')
    expect(detected.categoryFolder).toBe('')
    expect(detected.categoryDirectory).toBe('')
  })

  it('accepts a full-width or ASCII colon in the header and reserved categories', () => {
    const text = '测试报告: DCTS 报告 2026-11-05-08-52-28'
    expect(detectTestCategory({ reportPath: '/scan/upload/SuiteA.txt', rootPath: '/scan', reportText: text }).testCategory).toBe('DCTS')
    expect(detectTestCategory({ reportPath: '/scan/upload/SuiteA.txt', rootPath: '/scan', reportText: '测试报告：HATS 全量报告' }).testCategory).toBe('HATS')
  })

  it('prefers the folder structure over a contradictory header', () => {
    const detected = detectTestCategory({
      reportPath: `${root}/Acts/ModuleA/SuiteA.txt`,
      rootPath: root,
      reportText: '测试报告：DCTS 全量报告 2026-11-05-08-52-28',
    })
    expect(detected.testCategory).toBe('ACTS')
  })

  it('does not walk above rootPath', () => {
    const detected = detectTestCategory({ reportPath: '/scan/Acts/ModuleA/SuiteA.txt', rootPath: '/scan/Acts/ModuleA' })
    expect(detected.testCategory).toBe('')
  })

  it('returns an empty category when neither the folder nor the header matches', () => {
    const detected = detectTestCategory({ reportPath: '/scan/upload/SuiteA.txt', rootPath: '/scan', reportText: '1. 失败用例' })
    expect(detected).toEqual({ testCategory: '', categoryFolder: '', categoryDirectory: '' })
  })
})

describe('platform submission path: POSIX path relative to the category folder parent', () => {
  it('builds Acts/<module>/<suite>.txt from a directory scan root', () => {
    expect(submissionPathFor({
      rootPath: '/scan/exemption',
      reportPath: '/scan/exemption/Acts/ActsAceEtsModuleAnimation1Test/AnimatorEase.txt',
    })).toBe('Acts/ActsAceEtsModuleAnimation1Test/AnimatorEase.txt')
  })

  it('keeps the category prefix for a single-file input (root is the category parent)', () => {
    expect(submissionPathFor({
      rootPath: '/scan/exemption',
      reportPath: '/scan/exemption/ActsValidator/ActsAudioTest/ActsAudioTest.txt',
    })).toBe('ActsValidator/ActsAudioTest/ActsAudioTest.txt')
  })

  it('falls back to the file name when the report is outside the scan root', () => {
    expect(submissionPathFor({ rootPath: '/scan/exemption', reportPath: '/elsewhere/SuiteA.txt' })).toBe('SuiteA.txt')
  })
})

const BATCH_SCRIPT = fileURLToPath(new URL('../scripts/waiver_batch.mjs', import.meta.url))

function runScan(input: string) {
  // 扫描模式只读本地文件、不联网：直接跑 CLI，验证 script 层与 unit 层一致。
  const result = spawnSync(process.execPath, [BATCH_SCRIPT, '--scan', '--input', input], { encoding: 'utf8' })
  expect(result.status).toBe(0)
  const lines = String(result.stdout).trimEnd().split(/\r?\n/)
  const last = lines[lines.length - 1]
  const prefix = 'WAIVER_SCAN_JSON='
  expect(last.startsWith(prefix)).toBe(true)
  const scan = JSON.parse(last.slice(prefix.length))
  expect(scan.ok).toBe(true)
  return scan
}

describe('scan layout: <category>/<testsuite>/<testsuite>.txt (ActsValidator 实况)', () => {
  it('accepts directory name == testsuite and only reports the missing suite zip', () => {
    const root = mkdtempSync(join(tmpdir(), 'waiver-scan-'))
    try {
      const suiteDir = join(root, 'ActsValidator', 'ActsScreenTest')
      mkdirSync(suiteDir, { recursive: true })
      writeFileSync(join(suiteDir, 'ActsScreenTest.txt'), [
        '1. 失败用例',
        '',
        '- ActsValidator#ActsScreenTest#ScreenPick',
        '',
        '2. 失败原因',
        '',
        '设备不支持该能力。',
        '',
        '3. 申请豁免理由',
        '',
        '设备不支持该能力，申请豁免。',
      ].join('\n'))

      const missingZip = runScan(root)
      expect(missingZip.items).toHaveLength(1)
      expect(missingZip.items[0]).toMatchObject({
        testCategory: 'ACTS-Validator',
        categoryFolder: 'ActsValidator',
        moduleName: 'ActsValidator',
        testsuite: 'ActsScreenTest',
        submissionPath: 'ActsValidator/ActsScreenTest/ActsScreenTest.txt',
        ready: false,
      })
      // 父目录不再误报「应为模块名」；缺附件仍然阻塞（平台草稿必须带 zip）。
      expect(missingZip.items[0].problems).toEqual([
        '缺少套件附件 ActsScreenTest-豁免材料.zip（平台只收单文件，需含本套件 txt 与 evidence/）',
      ])

      // 附件补齐后即可提交。
      writeFileSync(join(suiteDir, 'ActsScreenTest-豁免材料.zip'), '')
      const withZip = runScan(root)
      expect(withZip.items[0].ready).toBe(true)
      expect(withZip.items[0].problems).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
