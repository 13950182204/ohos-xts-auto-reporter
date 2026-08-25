import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { Config, Phase2Settings } from '../src/config.ts'
import { apply as applyClient } from '../src/client.tsx'
import { registerPhase2Settings } from '../src/phase2-routes.ts'

describe('phase2 settings', () => {
  it('marks username and password as DSH secrets and keeps contact defaults', () => {
    const json = Phase2Settings.toJSON() as { refs: Record<string, { meta?: Record<string, unknown> }> }
    const refs = Object.values(json.refs)
    expect(refs.some((ref) => ref.meta?.role === 'secret')).toBe(true)
    expect(JSON.stringify(Phase2Settings.toJSON())).toContain('13950182204')
    expect(JSON.stringify(Config.toJSON())).toContain('phase2')
    expect(JSON.stringify(Config.toJSON())).toContain('selfCheckPath')
  })

  it('registers the phase2 namespace through the Host settings service', () => {
    let captured: any
    const ctx = { settings: { register: (namespace: unknown, schema: unknown, options: unknown) => {
      captured = { namespace, schema, options }
      return { get: () => ({}) }
    } } } as any
    registerPhase2Settings(ctx, {})
    expect(String(captured.namespace)).toContain('ohos-xts-auto-reporter')
    expect(captured.options.base.contactPhone).toBe('13950182204')
    expect(captured.options.base.contactEmail).toBe('102438@dnake.com')
  })
})

describe('phase2 client card registration', () => {
  it('registers a settings section with a settings scope face', () => {
    const registrations: any[] = []
    const scope = { getSnapshot: () => ({ status: 'ready', writable: true, value: {}, user: {}, base: {}, revision: 1, mode: 'host' }) }
    const ctx = {
      settingsScope: { bind: () => scope },
      slots: {
        inject: (_name: string, callback: () => unknown) => callback(),
        register: (definition: unknown) => { registrations.push(definition); return () => {} },
      },
    } as any
    applyClient(ctx)
    expect(registrations[0].name).toBe('settings.section')
    expect(registrations[0].id).toBe('ohos-xts-auto-reporter')
    expect(registrations[0].label()).toBe('XTS报告上传')
    expect(registrations[0].order).toBe(35)
    expect(registrations[0].inject().scope).toBe(scope)
  })
})

describe('phase2 safety boundary', () => {
  it('does not contain a formal submission endpoint or action', async () => {
    const source = readFileSync(join(process.cwd(), 'scripts', 'fill_phase2.mjs'), 'utf8')
    const client = readFileSync(join(process.cwd(), 'src', 'client.tsx'), 'utf8')
    expect(source).not.toMatch(/\/submit(?:["'`]|\b)/)
    expect(source).not.toContain('确认提交')
    expect(source).toContain('isSave: true')
    expect(source).toContain('PHASE2_RESULT_JSON=')
    expect(client).toContain('申请标识')
    expect(client).toContain('测评编号')
    expect(client).toContain('PCS 自检表')
    expect(client).toContain('XTS 报告 ZIP')
  })

  it('rejects a missing workbook before any browser action', async () => {
    const result = await import('../scripts/phase2_logic.mjs')
    const directory = await mkdtemp(join(tmpdir(), 'ohos-phase2-'))
    try {
      await expect(result.readPhase2Workbook(join(directory, 'missing.xlsx'))).rejects.toThrow('申请表格文件不存在')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('derives attachments from the workbook directory and leaves mirror deferred', async () => {
    const logic = await import('../scripts/phase2_logic.mjs')
    expect(logic.derivePhase2AttachmentPaths('D:\\ohos\\XTS6.1\\DHong\\A537\\OpenHarmony兼容性申请_第二阶段.xlsx')).toEqual({
      selfCheckPath: 'D:\\ohos\\XTS6.1\\DHong\\A537\\OpenHarmony设备兼容性规范5.x自检表_标准系统.xlsx',
      reportPath: 'D:\\ohos\\XTS6.1\\DHong\\A537\\report\\report.zip',
      mirrorPath: '',
    })
  })

  it('validates report and self-check paths while allowing deferred mirror upload', async () => {
    const logic = await import('../scripts/phase2_logic.mjs')
    const errors = await logic.validatePhase2Attachments({
      selfCheckPath: '/tmp/missing.xlsx', reportPath: '/tmp/missing.zip', mirrorPath: '',
    }, { fileExists: async () => false })
    expect(errors).toHaveLength(2)
    expect(errors.join('\n')).toContain('PCS自检表路径不存在')
  })

  it('rejects a workbook with more than one filled device sheet', async () => {
    const logic = await import('../scripts/phase2_logic.mjs')
    const directory = await mkdtemp(join(tmpdir(), 'ohos-phase2-'))
    const file = join(directory, 'application.xlsx')
    try {
      await logic.createPhase2Workbook(file)
      const ExcelJS = logic.loadExcelJs()
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.readFile(file)
      workbook.getWorksheet('模组开发板').getCell('C10').value = 'A333'
      workbook.getWorksheet('商用设备').getCell('C10').value = '设备'
      await workbook.xlsx.writeFile(file)
      await expect(logic.readPhase2Workbook(file)).rejects.toThrow('一个工作簿只能填写一个设备类型')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('requires real appearance and PCID.sc files for a filled board', async () => {
    const logic = await import('../scripts/phase2_logic.mjs')
    const directory = await mkdtemp(join(tmpdir(), 'ohos-phase2-'))
    const file = join(directory, 'application.xlsx')
    try {
      await logic.createPhase2Workbook(file)
      const ExcelJS = logic.loadExcelJs()
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.readFile(file)
      const sheet = workbook.getWorksheet('模组开发板')
      for (const [cell, value] of Object.entries({
        C8: '标准系统', C9: 'OpenHarmony 6.1 Release', C10: 'A333', C11: '76A', C12: 'A333',
        C13: 'arm64', C14: '支持应用安装', C15: '带屏', C16: '描述', C17: join(directory, 'missing.png'),
        C18: '发证即公示', C22: '1.0.0', C23: '2026/01/01', C24: 'release', C25: 'hash', C26: join(directory, 'missing.sc'),
      })) sheet.getCell(cell).value = value
      await workbook.xlsx.writeFile(file)
      await expect(logic.readPhase2Workbook(file)).rejects.toThrow('不存在')
      await writeFile(join(directory, 'missing.png'), 'not-an-image')
      await writeFile(join(directory, 'missing.sc'), 'pcid')
      const { record } = await logic.readPhase2Workbook(file)
      expect(record.type).toBe('board')
      expect(record.pcidScPath).toContain('missing.sc')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
