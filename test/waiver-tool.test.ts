import { describe, expect, it } from 'vitest'
import {
  buildWaiverArgs,
  normalizeWaiverInput,
  parseWaiverOutput,
  toWaiverResult,
  waiverChildEnv,
  WAIVER_RESULT_PREFIX,
} from '../src/waiver-tool.ts'

const baseInput = {
  assessmentNumber: 'OHC007500008641',
  testCategory: 'ACTS-Validator',
  moduleName: 'ActsValidator',
  testsuite: 'ActsPCSTest',
  testcases: ['RebootScreenUnlock'],
  waiverReason: '设备除了口令认证外不支持其他认证方式',
  attachmentPath: '/mnt/d/ohos/evidence.txt',
}

describe('normalizeWaiverInput', () => {
  it('保留必需字段并规整 testcases', () => {
    const input = normalizeWaiverInput({ ...baseInput, testcases: [' A ', '', 'B'] })
    expect(input.assessmentNumber).toBe('OHC007500008641')
    expect(input.testcases).toEqual(['A', 'B'])
    expect(input.dryRun).toBe(false)
  })

  it('忽略 systemType / osVersion（必须按测评编号反查）', () => {
    const input = normalizeWaiverInput({ ...baseInput, systemType: '标准系统', osVersion: 'OpenHarmony 6.1 Release' }) as unknown as Record<string, unknown>
    expect(input.systemType).toBeUndefined()
    expect(input.osVersion).toBeUndefined()
  })

  it('缺少测评编号时立即报错', () => {
    expect(() => normalizeWaiverInput({ ...baseInput, assessmentNumber: '  ' })).toThrow('assessmentNumber')
  })

  it('缺少测试套分类时立即报错', () => {
    expect(() => normalizeWaiverInput({ ...baseInput, testCategory: '' })).toThrow('testCategory')
  })

  it('附件必须是绝对路径', () => {
    expect(() => normalizeWaiverInput({ ...baseInput, attachmentPath: 'relative/evidence.txt' })).toThrow('绝对路径')
  })

  it('dryRun 透传为布尔值', () => {
    expect(normalizeWaiverInput({ ...baseInput, dryRun: true }).dryRun).toBe(true)
  })
})

describe('buildWaiverArgs', () => {
  const input = normalizeWaiverInput(baseInput)
  it('默认走 --save（只保存草稿）', () => {
    expect(buildWaiverArgs(input, '/tmp/input.json')).toEqual(['--input', '/tmp/input.json', '--save'])
  })
  it('dryRun=true 走 --dry-run', () => {
    const dry = normalizeWaiverInput({ ...baseInput, dryRun: true })
    expect(buildWaiverArgs(dry, '/tmp/input.json')).toEqual(['--input', '/tmp/input.json', '--dry-run'])
  })
})

describe('waiverChildEnv', () => {
  it('凭据只走环境变量，且不把 Electron 之外的变量污染进来', () => {
    const env = waiverChildEnv('user', 'secret', { PATH: '/usr/bin' })
    expect(env.OH_USERNAME).toBe('user')
    expect(env.OH_PASSWORD).toBe('secret')
    expect(env.PATH).toBe('/usr/bin')
  })
})

describe('parseWaiverOutput', () => {
  it('取最后一条结构化结果', () => {
    const output = [
      `${WAIVER_RESULT_PREFIX}{"status":"preflight-complete"}`,
      'some log line',
      `${WAIVER_RESULT_PREFIX}{"status":"saved","message":"保存成功"}`,
    ].join('\n')
    expect(parseWaiverOutput(output)?.status).toBe('saved')
  })

  it('忽略畸形标记并继续向前查找', () => {
    const output = [
      `${WAIVER_RESULT_PREFIX}{"status":"saved"}`,
      `${WAIVER_RESULT_PREFIX}not-json`,
    ].join('\n')
    expect(parseWaiverOutput(output)?.status).toBe('saved')
  })

  it('没有标记时返回 undefined', () => {
    expect(parseWaiverOutput('plain log only')).toBeUndefined()
  })
})

describe('toWaiverResult', () => {
  it('把 derived 里的反查字段摊平到工具输出', () => {
    const result = toWaiverResult({
      status: 'saved',
      message: '保存成功',
      assessmentNumber: 'OHC007500008641',
      moduleName: 'ActsValidator',
      testcases: ['RebootScreenUnlock'],
      derived: {
        systemTypeName: '标准系统',
        systemVersionName: 'OpenHarmony 6.1 LTS',
        certificationId: 'b6d5c5b24a374acd8a3bf54148444d81',
      },
    })
    expect(result.status).toBe('saved')
    expect(result.systemTypeName).toBe('标准系统')
    expect(result.systemVersionName).toBe('OpenHarmony 6.1 LTS')
    expect(result.certificationId).toBe('b6d5c5b24a374acd8a3bf54148444d81')
    expect(result.testcases).toEqual(['RebootScreenUnlock'])
  })

  it('缺少 derived 时不报错', () => {
    const result = toWaiverResult({ status: 'stopped', code: 'PENDING_DUPLICATE_FOUND', message: 'duplicate' })
    expect(result.status).toBe('stopped')
    expect(result.systemVersionName).toBeUndefined()
  })
})
