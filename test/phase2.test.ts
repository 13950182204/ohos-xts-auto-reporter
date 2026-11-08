import { describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execFile as execFileCallback } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { Config, Phase2Settings } from '../src/config.ts'
import { apply as applyClient, inject } from '../src/client.tsx'
import { registerPhase2Settings } from '../src/phase2-routes.ts'

const execFile = promisify(execFileCallback)

type SheetLike = { getCell: (ref: string) => { value: unknown } }
function fillSheet(sheet: SheetLike, values: Record<string, string>) {
  for (const [cell, value] of Object.entries(values)) sheet.getCell(cell).value = value
}

function labelRow(sheet: SheetLike & { eachRow: (callback: (row: SheetLike, rowNumber: number) => void) => void }, label: string): number {
  let found = 0
  sheet.eachRow((row, rowNumber) => {
    const value = (row.getCell('A') as { value?: unknown }).value
    if (!found && value === label) found = rowNumber
  })
  return found
}

// 新模板「模组开发板」sheet 的有效填值（内核在 C10，快递单号在 C26，均按标签定位）。
const BOARD_VALUES: Record<string, string> = {
  C8: '标准系统', C9: 'OpenHarmony 6.1 Release', C10: 'LiteOS-A',
  C11: 'A333', C12: 'A333', C13: 'A333', C14: 'arm64',
  C15: '支持应用安装', C16: '带屏', C17: '描述', C18: '发证即公示',
  C21: '1.0.0', C22: '2026/08/28', C23: 'release', C24: 'hash',
}

describe('phase2 settings', () => {
  it('marks username and password as DSH secrets and keeps contact defaults', () => {
    const json = Phase2Settings.toJSON() as { refs: Record<string, { meta?: Record<string, unknown> }> }
    const refs = Object.values(json.refs)
    expect(refs.some((ref) => ref.meta?.role === 'secret')).toBe(true)
    expect(JSON.stringify(Phase2Settings.toJSON())).toContain('13950182204')
    expect(JSON.stringify(Config.toJSON())).toContain('phase2')
    expect(JSON.stringify(Config.toJSON())).toContain('selfCheckPath')
  })

  it('keeps the settings plane self-hosted so no dsh-settings runtime import survives', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'phase2-routes.ts'), 'utf8')
    // 值导入 `settingsNamespace` 会在 0.1.2-rc.1 / 0.2.0-rc.2 上让插件链接期失败；
    // 只允许类型导入（会被擦除）。
    expect(source).not.toMatch(/^import \{[^}]*\} from '@deepseek-ai\/dsh-settings'$/m)
    expect(source).toContain("import type { Phase2Settings as Phase2SettingsValue }")
  })

  it('seeds the store from settings.yaml, then lets user values win', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ohos-settings-'))
    const file = join(directory, 'settings.json')
    const legacy = join(directory, 'settings.yaml')
    try {
      // 旧版把同一批字段写在 ~/.dsh/settings.yaml 的 ohos-xts-auto-reporter section 下。
      await writeFile(legacy, 'ohos-xts-auto-reporter:\n  workbookPath: D:\\ohos\\legacy\n  username: legacy@example.com\n  password: legacy-secret\n', 'utf8')
      const ctx = { logger: { info: () => {}, warn: () => {} } } as any
      const plane = registerPhase2Settings(ctx, { contactPhone: '13950182204', contactEmail: 'a@b.c', workbookPath: 'D:/ohos/config' }, { settingsFile: file, legacyFile: legacy })
      // settings.yaml 的值优先于 cordis 配置默认值。
      expect(plane.get().workbookPath).toBe('D:\\ohos\\legacy')
      expect(plane.get().username).toBe('legacy@example.com')
      expect(plane.get().password).toBe('legacy-secret')
      // 配置里的默认值补齐 settings.yaml 没有的字段。
      expect(plane.get().contactPhone).toBe('13950182204')
      await plane.merge({ workbookPath: 'D:/ohos/y', password: 'secret' })
      expect(plane.get().workbookPath).toBe('D:/ohos/y')
      expect(plane.get().password).toBe('secret')
      // 存储已存在：重新注册不得被旧来源或 config 默认值覆盖。
      const again = registerPhase2Settings(ctx, { workbookPath: 'D:/other' }, { settingsFile: file, legacyFile: legacy })
      expect(again.get().workbookPath).toBe('D:/ohos/y')
      expect(again.get().password).toBe('secret')
      const mode = (await import('node:fs')).statSync(file).mode & 0o777
      expect(mode & 0o077).toBe(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('phase2 client card registration', () => {
  it('registers a settings section without requiring services rc.2 no longer has', () => {
    const registrations: any[] = []
    const ctx = {
      slots: {
        inject: (_name: string, callback: () => unknown) => callback(),
        register: (definition: unknown) => { registrations.push(definition); return () => {} },
      },
    } as any
    applyClient(ctx)
    expect(inject).toEqual(['slots'])
    expect(registrations[0].name).toBe('settings.section')
    expect(registrations[0].id).toBe('ohos-xts-auto-reporter')
    expect(registrations[0].label()).toBe('XTS报告上传')
    expect(registrations[0].order).toBe(35)
    // 数据面走自有路由，注册时不应再注入 settingsScope 之类的业务 props。
    expect(registrations[0].inject).toBeUndefined()
  })
})

describe('phase2 safety boundary', () => {
  it('does not contain a formal submission endpoint or action', async () => {
    const source = readFileSync(join(process.cwd(), 'scripts', 'fill_phase2.mjs'), 'utf8')
    const batchSource = readFileSync(join(process.cwd(), 'scripts', 'phase2_batch.mjs'), 'utf8')
    // 设置卡片拆成「状态层 src/client.tsx + 视觉层 src/settings-view.ts」，安全边界要两处一起看。
    const client = [
      readFileSync(join(process.cwd(), 'src', 'client.tsx'), 'utf8'),
      readFileSync(join(process.cwd(), 'src', 'settings-view.ts'), 'utf8'),
    ].join('\n')
    expect(source).not.toContain('/submit')
    expect(source).not.toContain('确认提交')
    expect(source).toContain('isSave: true')
    expect(source).toContain('PHASE2_RESULT_JSON=')
    expect(batchSource).not.toContain('/submit')
    expect(batchSource).not.toContain('确认提交')
    expect(batchSource).toContain('processRecord')
    expect(batchSource).toContain('PHASE2_BATCH_ITEM_RESULT=')
    expect(client).toContain('申请标识')
    expect(client).toContain('测评编号')
    expect(client).not.toContain('PCS 自检表（自动获取）')
    expect(client).not.toContain('XTS 报告 ZIP（自动获取）')
    // 镜像上传从「预留占位」变成真功能：字段与按钮必须存在，旧占位文案必须消失。
    expect(client).not.toContain('镜像固件路径（预留）')
    expect(client).toContain('镜像固件上传')
    expect(client).toContain('上传固件')
    expect(client).toContain('mirror/upload')
    expect(client).toContain('评测资料提交')
    expect(client).toContain('批量评测进度')
    // 分类改为按豁免资料目录自动识别：设置卡片不得再出现人工「测试套分类」输入。
    expect(client).not.toContain('测试套分类（')
    expect(client).not.toContain("waiverTestCategory")
    expect(client).toContain('识别目录')
    expect(client).toContain('waiver/scan')
    // 宿主半区未重启（接口未注册，DSH 回纯文本 401/404）时，提示必须可执行，
    // 不能只说「无法连接」——否则用户无法判断是重启没做还是网络问题。
    expect(client).toContain('重启 DSH Desktop 后重试')
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

  it('derives attachments from the workbook directory, falling back to scanned files', async () => {
    const logic = await import('../scripts/phase2_logic.mjs')
    expect(await logic.derivePhase2AttachmentPaths('D:\\ohos\\XTS6.1\\DHong\\A537\\OpenHarmony兼容性申请资料.xlsx')).toEqual({
      selfCheckPath: '/mnt/d/ohos/XTS6.1/DHong/A537/OpenHarmony设备兼容性规范5.x自检表_标准系统.xlsx',
      reportPath: '/mnt/d/ohos/XTS6.1/DHong/A537/report/report.zip',
      mirrorPath: '',
      layoutMigrated: false,
      layoutWarning: '',
    })

    const directory = await mkdtemp(join(tmpdir(), 'ohos-phase2-attach-'))
    try {
      await writeFile(join(directory, 'OpenHarmony兼容性申请资料.xlsx'), 'placeholder')
      await writeFile(join(directory, 'OpenHarmony设备兼容性规范6.x自检表_标准系统.xlsx'), 'pcs')
      await mkdir(join(directory, 'report'), { recursive: true })
      await writeFile(join(directory, 'report', 'report-20261106.zip'), 'zip')
      const derived = await logic.derivePhase2AttachmentPaths(join(directory, 'OpenHarmony兼容性申请资料.xlsx'))
      expect(derived.selfCheckPath).toBe(join(directory, 'OpenHarmony设备兼容性规范6.x自检表_标准系统.xlsx'))
      expect(derived.reportPath).toBe(join(directory, 'report', 'report-20261106.zip'))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('treats a directory that itself contains the exact workbook as one task', async () => {
    const logic = await import('../scripts/phase2_logic.mjs')
    const root = await mkdtemp(join(tmpdir(), 'ohos-phase2-batch-dir-'))
    try {
      await logic.createPhase2Workbook(join(root, 'OpenHarmony兼容性申请资料.xlsx'))
      const discovery = await logic.discoverPhase2Workbooks(root)
      expect(discovery.mode).toBe('single')
      expect(discovery.items).toHaveLength(1)
      expect(discovery.items[0].workbookPath).toBe(join(root, 'OpenHarmony兼容性申请资料.xlsx'))
      expect(discovery.skipped).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('discovers only immediate child directories with the exact phase-2 workbook name', async () => {
    const logic = await import('../scripts/phase2_logic.mjs')
    const root = await mkdtemp(join(tmpdir(), 'ohos-phase2-batch-'))
    try {
      await logic.createPhase2Workbook(join(root, 'RK3568', 'OpenHarmony兼容性申请资料.xlsx'))
      await mkdir(join(root, 'A537'), { recursive: true })
      await logic.createPhase2Workbook(join(root, 'OpenHarmony兼容性批量结果_旧结果', 'OpenHarmony兼容性申请资料.xlsx'))
      const discovery = await logic.discoverPhase2Workbooks(root)
      expect(discovery.mode).toBe('batch')
      expect(discovery.items).toHaveLength(1)
      expect(discovery.items[0].name).toBe('RK3568')
      expect(discovery.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'A537' })]))
      expect(discovery.items[0].workbookPath).toContain('RK3568')
      expect(discovery.items.map((item: { name: string }) => item.name)).not.toContain('OpenHarmony兼容性批量结果_旧结果')
      // 结果目录是产物，不是任务子目录
      expect(discovery.skipped.map((item: { name: string }) => item.name)).not.toContain('OpenHarmony兼容性批量结果_旧结果')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('accepts a single exact workbook path as a one-item discovery', async () => {
    const logic = await import('../scripts/phase2_logic.mjs')
    const root = await mkdtemp(join(tmpdir(), 'ohos-phase2-single-'))
    const file = join(root, 'OpenHarmony兼容性申请资料.xlsx')
    try {
      await writeFile(file, 'placeholder')
      const discovery = await logic.discoverPhase2Workbooks(file)
      expect(discovery.mode).toBe('single')
      expect(discovery.items).toEqual([expect.objectContaining({ workbookPath: file, name: root.split('/').pop() })])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('lists each batch task before the credential gate without launching a browser', async () => {
    const logic = await import('../scripts/phase2_logic.mjs')
    const root = await mkdtemp(join(tmpdir(), 'ohos-phase2-batch-run-'))
    const directory = join(root, 'A333')
    const workbookPath = join(directory, 'OpenHarmony兼容性申请资料.xlsx')
    try {
      await logic.createPhase2Workbook(workbookPath)
      await mkdir(join(directory, 'report'), { recursive: true })
      await mkdir(join(root, 'NoWorkbook'), { recursive: true })
      await writeFile(join(directory, 'A333.png'), 'image')
      await writeFile(join(directory, 'pcid.sc'), 'pcid')
      await writeFile(join(directory, 'OpenHarmony设备兼容性规范5.x自检表_标准系统.xlsx'), 'pcs')
      await writeFile(join(directory, 'report', 'report.zip'), 'report')
      const ExcelJS = logic.loadExcelJs()
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.readFile(workbookPath)
      const sheet = workbook.getWorksheet('模组开发板')
      fillSheet(sheet, BOARD_VALUES)
      await workbook.xlsx.writeFile(workbookPath)

      let failure: { code?: number; stdout?: string; stderr?: string } | undefined
      try {
        await execFile(process.execPath, [join(process.cwd(), 'scripts', 'phase2_batch.mjs'), '--input', root, '--save'], {
          cwd: process.cwd(),
          env: { ...process.env, OH_USERNAME: '', OH_PASSWORD: '' },
        })
      } catch (error) {
        failure = error as { code?: number; stdout?: string; stderr?: string }
      }
      expect(failure?.code).toBe(2)
      const output = `${failure?.stdout ?? ''}\n${failure?.stderr ?? ''}`
      expect(output).toContain('PHASE2_BATCH_INIT=')
      expect(output).toContain('"name":"A333"')
      expect(output).toContain('"name":"NoWorkbook"')
      expect(output).toContain('CREDENTIALS_MISSING')
      expect(output).not.toContain('登录平台')
      const resultLine = output.split(/\r?\n/).find((line) => line.startsWith('PHASE2_RESULT_JSON='))
      expect(resultLine).toBeTruthy()
      const summary = JSON.parse(resultLine!.slice('PHASE2_RESULT_JSON='.length)) as { items?: Array<{ name?: string; status?: string }>; skippedCount?: number }
      expect(summary.skippedCount).toBe(1)
      expect(summary.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'A333', status: 'blocked' }),
        expect.objectContaining({ name: 'NoWorkbook', status: 'skipped' }),
      ]))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('waits for the asynchronously-created report relation before uploading PCS and XTS files', () => {
    const source = readFileSync(join(process.cwd(), 'scripts', 'fill_phase2.mjs'), 'utf8')
    expect(source).toContain('REPORT_RELATION_MAX_WAIT_MS = 2 * 60 * 1000')
    expect(source).toContain('REPORT_RELATION_INITIALIZE_RETRY_MS = 30 * 1000')
    expect(source).toContain('async function waitForReportStage')
    expect(source).toContain('REPORT_STAGE_NOT_READY')
    expect(source).toContain("reportProgress(60, '核对报告上传阶段'")
    expect(source).toContain('await initializeReportRelation()')
    expect(source).toContain('平台第4步设备报告关联在 2 分钟内仍未生成')
  })

  it('preserves the application for retryable report-stage failures instead of blocking the workbook', () => {
    const source = readFileSync(join(process.cwd(), 'scripts', 'fill_phase2.mjs'), 'utf8')
    expect(source).toContain('retryable = false')
    expect(source).toContain("status: retryable ? '第二阶段待重试' : '需人工处理'")
  })

  it('detects a workbook that cannot be opened for writing before browser launch', async () => {
    const logic = await import('../scripts/phase2_logic.mjs')
    const directory = await mkdtemp(join(tmpdir(), 'ohos-phase2-lock-'))
    const file = join(directory, 'application.xlsx')
    try {
      await writeFile(file, 'placeholder')
      await chmod(file, 0o444)
      await expect(logic.ensureWorkbookWritable(file, { attempts: 0 })).rejects.toMatchObject({ code: 'WORKBOOK_NOT_WRITABLE' })
    } finally {
      await chmod(file, 0o644).catch(() => {})
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('reports a locked workbook as retryable instead of a platform upload failure', () => {
    const source = readFileSync(join(process.cwd(), 'scripts', 'fill_phase2.mjs'), 'utf8')
    expect(source).toContain("const result = { assessmentNumber: input.record.assessmentNumber || '', status: 'retryable', code, message }")
    expect(source).toContain('WORKBOOK_NOT_WRITABLE')
    expect(source).toContain('请先关闭 WPS/Excel')
    expect(source).toContain("['blocked', 'retryable'].includes(result.status)")
  })

  it('reduces structured save failures to their actionable platform message', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'phase2-routes.ts'), 'utf8')
    expect(source).toContain('function formatSaveFailure')
    expect(source).toContain('parsed.failureMessage || result.output')
  })

  it('exposes a labelled progress bar in the DSH settings card', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'settings-view.ts'), 'utf8')
    expect(source).toContain("role: 'progressbar'")
    expect(source).toContain("'aria-valuenow'")
    expect(source).toContain('XTS 报告上传进度')
    expect(source).toContain('clampPercent')
    expect(source).toContain('aria-label')
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
      workbook.getWorksheet('模组开发板').getCell('C11').value = 'A333'
      workbook.getWorksheet('商用设备').getCell('C11').value = '设备'
      await workbook.xlsx.writeFile(file)
      await expect(logic.readPhase2Workbook(file)).rejects.toThrow('一个工作簿只能填写一个设备类型')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('derives the appearance image and pcid.sc from the workbook directory', async () => {
    const logic = await import('../scripts/phase2_logic.mjs')
    const directory = await mkdtemp(join(tmpdir(), 'ohos-phase2-'))
    const file = join(directory, 'application.xlsx')
    try {
      await logic.createPhase2Workbook(file)
      const ExcelJS = logic.loadExcelJs()
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.readFile(file)
      const sheet = workbook.getWorksheet('模组开发板')
      fillSheet(sheet, { ...BOARD_VALUES, C11: '76A' })
      await workbook.xlsx.writeFile(file)

      await expect(logic.readPhase2Workbook(file)).rejects.toThrow('外观图')
      await expect(logic.readPhase2Workbook(file)).rejects.toThrow('PCID.sc')

      await writeFile(join(directory, 'A333.png'), 'png')
      await writeFile(join(directory, 'pcid.sc'), 'pcid')
      const resolved = await logic.readPhase2Workbook(file)
      expect(resolved.record.appearancePaths).toEqual([join(directory, 'A333.png')])
      expect(resolved.record.pcidScPath).toBe(join(directory, 'pcid.sc'))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects a workbook whose kernel is empty', async () => {
    const logic = await import('../scripts/phase2_logic.mjs')
    const directory = await mkdtemp(join(tmpdir(), 'ohos-phase2-kernel-'))
    const file = join(directory, 'application.xlsx')
    try {
      await logic.createPhase2Workbook(file)
      const workbook = new (logic.loadExcelJs().Workbook)()
      await workbook.xlsx.readFile(file)
      fillSheet(workbook.getWorksheet('模组开发板'), { ...BOARD_VALUES, C10: '' })
      await workbook.xlsx.writeFile(file)
      await writeFile(join(directory, 'A333.png'), 'png')
      await writeFile(join(directory, 'pcid.sc'), 'pcid')
      await expect(logic.readPhase2Workbook(file)).rejects.toThrow('缺少内核')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('allows commercial devices to omit module model and auth type, but validates a filled auth type', async () => {
    const logic = await import('../scripts/phase2_logic.mjs')
    const directory = await mkdtemp(join(tmpdir(), 'ohos-phase2-commercial-'))
    const file = join(directory, 'application.xlsx')
    try {
      await logic.createPhase2Workbook(file)
      const workbook = new (logic.loadExcelJs().Workbook)()
      await workbook.xlsx.readFile(file)
      // C17「模组型号」与 C20「认证方式」留空，其余必填齐全。
      fillSheet(workbook.getWorksheet('商用设备'), {
        C8: '标准系统', C9: 'OpenHarmony 6.1 Release', C10: 'LiteOS-M',
        C11: '设备', C12: '智能穿戴', C13: 'MODEL-1', C14: 'HW-1',
        C15: '品牌', C16: 'Brand', C18: '芯片', C19: 'arm64',
        C21: '支持应用安装', C22: '带屏', C23: '描述', C24: '发证即公示',
        C27: '1.0.0', C28: '2026/08/28', C29: 'release', C30: 'hash',
      })
      await workbook.xlsx.writeFile(file)
      await writeFile(join(directory, '设备.png'), 'png')
      await writeFile(join(directory, 'pcid.sc'), 'pcid')

      const { record } = await logic.readPhase2Workbook(file)
      expect(record.sheetName).toBe('商用设备')
      expect(record.moduleModel).toBe('')
      expect(record.authType).toBe('')

      // 选填不等于不校验：填了非法认证方式仍然报错。
      const changed = new (logic.loadExcelJs().Workbook)()
      await changed.xlsx.readFile(file)
      changed.getWorksheet('商用设备').getCell('C20').value = '非法值'
      await changed.xlsx.writeFile(file)
      await expect(logic.readPhase2Workbook(file)).rejects.toThrow('“认证方式”无效')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('round-trips kernel and express order through the generated template and a layout rewrite', async () => {
    const logic = await import('../scripts/phase2_logic.mjs')
    const directory = await mkdtemp(join(tmpdir(), 'ohos-phase2-newcols-'))
    const file = join(directory, 'application.xlsx')
    try {
      await logic.createPhase2Workbook(file)
      const workbook = new (logic.loadExcelJs().Workbook)()
      await workbook.xlsx.readFile(file)
      fillSheet(workbook.getWorksheet('模组开发板'), {
        ...BOARD_VALUES,
        C26: 'SF1234567890,SF0987654321',
      })
      await workbook.xlsx.writeFile(file)
      await writeFile(join(directory, 'A333.png'), 'png')
      await writeFile(join(directory, 'pcid.sc'), 'pcid')

      // 新坐标表：三张表的「内核」都在第 10 行，「快递单号」在各自样机寄送段。
      const layout = new (logic.loadExcelJs().Workbook)()
      await layout.xlsx.readFile(file)
      for (const [sheetName, expressRow] of [['模组开发板', 26], ['商用设备', 32], ['发行版', 30]] as const) {
        const sheet = layout.getWorksheet(sheetName)
        expect(labelRow(sheet, '内核')).toBe(10)
        expect(labelRow(sheet, '快递单号')).toBe(expressRow)
      }

      const { record } = await logic.readPhase2Workbook(file)
      expect(record.systemKernel).toBe('LiteOS-A')
      expect(record.expressOrderNo).toBe('SF1234567890,SF0987654321')

      // 迁移/重写（fill 完成后重写布局）后两列必须保留。
      await logic.rewriteWorkbookLayout(file)
      const again = await logic.readPhase2Workbook(file)
      expect(again.record.systemKernel).toBe('LiteOS-A')
      expect(again.record.expressOrderNo).toBe('SF1234567890,SF0987654321')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('still reads a workbook that predates the kernel and express rows', async () => {
    const logic = await import('../scripts/phase2_logic.mjs')
    const directory = await mkdtemp(join(tmpdir(), 'ohos-phase2-old-layout-'))
    const file = join(directory, 'application.xlsx')
    try {
      // 旧模板没有「内核」「快递单号」两行：后续行整体上移一行。
      const ExcelJS = logic.loadExcelJs()
      const workbook = new ExcelJS.Workbook()
      for (const sheetName of ['模组开发板', '发行版', '商用设备']) {
        workbook.addWorksheet(sheetName).getCell('A1').value = `OpenHarmony兼容性申请 - ${sheetName}`
      }
      const sheet = workbook.getWorksheet('模组开发板')
      sheet.getCell('A7').value = '产品定义'
      const oldRows: Array<[string, string, string]> = [
        ['操作系统类型', 'C8', '标准系统'],
        ['操作系统版本号', 'C9', 'OpenHarmony 6.1 Release'],
        ['模组/开发板名称(传播名)', 'C10', 'A333'],
        ['模组/开发板型号', 'C11', 'A333'],
        ['芯片型号', 'C12', 'A333'],
      ]
      for (const [label, cell, value] of oldRows) {
        const row = Number(cell.match(/\d+/)?.[0])
        sheet.getCell(`A${row}`).value = label
        sheet.getCell(cell).value = value
      }
      await workbook.xlsx.writeFile(file)

      const meta = await logic.readWorkbookMeta(file)
      expect(meta).toEqual({ sheetName: '模组开发板', name: 'A333' })

      // 迁移脚本走 readWorkbookMeta + rewriteWorkbookLayout：补出新布局且数据不丢。
      await logic.rewriteWorkbookLayout(file)
      expect(await logic.readWorkbookMeta(file)).toEqual({ sheetName: '模组开发板', name: 'A333' })
      const migrated = new (logic.loadExcelJs().Workbook)()
      await migrated.xlsx.readFile(file)
      expect(labelRow(migrated.getWorksheet('模组开发板'), '内核')).toBe(10)
      expect(labelRow(migrated.getWorksheet('模组开发板'), '快递单号')).toBe(26)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
