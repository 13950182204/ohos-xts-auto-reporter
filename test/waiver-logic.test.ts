import { describe, expect, it } from 'vitest'

// 豁免资料规范：一条申请 = 一个模块的一个 Testsuite（见 SKILL.md「豁免资料目录与提交模型（强制）」）
// @ts-expect-error 纯 JS 模块，无类型声明
import { validateInput } from '../scripts/waiver_logic.mjs'

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
})
