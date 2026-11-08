import { execFile } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { Phase2Settings as Phase2SettingsValue } from './config.ts'
import { derivePaths } from './derive-paths.ts'
import { parseMirrorProgressLine, parseMirrorResultLine, type MirrorResult } from './mirror-progress.ts'
import { Phase2SettingsStore, readLegacySettings } from './settings-store.ts'

// 解析函数留在 `mirror-progress.ts`（纯函数、不拉起 Electron 依赖），这里再导出一份方便测试。
export { parseMirrorProgressLine, parseMirrorResultLine } from './mirror-progress.ts'
export type { MirrorProgress, MirrorResult } from './mirror-progress.ts'

/**
 * 设置数据面。**刻意不 import `@deepseek-ai/dsh-settings` 的任何值**：
 * 该包在 0.1.2-rc.1 / 0.2.0-rc.2 上删掉了 `settingsNamespace`（见 settings-store.ts 顶部注释），
 * 值导入会让整个插件在链接期失败。类型导入（`import type`）会被擦除，保留无妨。
 */
export interface Phase2SettingsPlane {
  get(): Phase2SettingsValue
  merge(patch: Phase2SettingsValue): Promise<Phase2SettingsValue>
}

type ProgressState = {
  percent: number
  stage: string
  detail?: string
  itemIndex?: number
  itemTotal?: number
  itemPercent?: number
  workbookPath?: string
}
type BatchItemState = {
  directory?: string
  workbookPath?: string
  name?: string
  taskIndex?: number
  status: string
  percent: number
  stage: string
  detail?: string
  applicationId?: string
  assessmentNumber?: string
  /** 豁免资料自动识别出的测试套分类（ACTS / ACTS-Validator / HATS / DCTS / SSTS）。 */
  testCategory?: string
  /** 平台提交路径，例如 `Acts/<模块>/<套件>.txt`。 */
  submissionPath?: string
  code?: string
}
type BatchState = {
  mode?: 'single' | 'batch'
  rootPath?: string
  taskCount: number
  skippedCount: number
  items: BatchItemState[]
}
/** `--scan` 的单条识别结果（与 scripts/waiver_batch.mjs 的 WAIVER_SCAN_JSON 对齐）。 */
export interface WaiverScanItem {
  sourceReport: string
  categoryFolder: string
  testCategory: string
  moduleName: string
  testsuite: string
  caseCount: number
  testcases: string[]
  attachmentPath: string
  attachmentKind: string
  evidenceRelative: string[]
  submissionPath: string
  ready: boolean
  problems: string[]
}
export interface WaiverScanSummary {
  total: number
  ready: number
  blocked: number
  byCategory: Record<string, number>
}
export interface WaiverScanResult {
  root: string
  items: WaiverScanItem[]
  summary: WaiverScanSummary
}
type RunState = {
  /** 当前任务来源：第二阶段资料 / 豁免草稿 / 镜像固件上传（设置卡片据此切换文案）。 */
  kind?: 'phase2' | 'waiver' | 'mirror'
  phase: 'idle' | 'preflight' | 'saving' | 'uploading'
  startedAt?: string
  finishedAt?: string
  ok?: boolean
  message?: string
  errors?: string[]
  summary?: Record<string, unknown>
  progress?: ProgressState
  batch?: BatchState
  /** 镜像上传结果（`fileName` / `fileSize` / `platformStatus`），`/status` 原样返回。 */
  mirror?: Record<string, unknown>
}

const state: RunState = { phase: 'idle' }

function scriptsDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts')
}

function sendJson(res: ServerResponse, statusCode: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > 64 * 1024) throw new Error('请求体过大。')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('请求体必须是 JSON 对象。')
  }
  return parsed as Record<string, unknown>
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function blankToUndefined(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== '' ? value.trim() : undefined
}

function redact(value: string, secrets: string[]): string {
  return secrets.filter(Boolean).reduce((result, secret) => result.replaceAll(secret, '[已隐藏]'), value)
}

function inputPath(body: Record<string, unknown>, settings: Phase2SettingsValue): string {
  return text(body.inputPath) || text(body.workbookPath) || text(settings.workbookPath)
}

function attachmentSettings(workbook: string): Record<string, string> {
  const raw = workbook.trim()
  const isWindows = /^[a-zA-Z]:[\\/]/.test(raw)
  const normalized = raw.replaceAll('/', '\\')
  const directory = isWindows ? win32.dirname(normalized) : dirname(raw.replaceAll('\\', '/'))
  const separator = isWindows ? '\\' : '/'
  return {
    selfCheckPath: `${directory}${separator}OpenHarmony设备兼容性规范5.x自检表_标准系统.xlsx`,
    reportPath: `${directory}${separator}report${separator}report.zip`,
    mirrorPath: '',
  }
}

function currentSettings(settings: Phase2SettingsPlane): Phase2SettingsValue {
  return settings.get()
}

/** 对外视图：密码只报「有没有」，绝不回显（与 DSH settings 的 secret 语义保持一致）。 */
function settingsView(settings: Phase2SettingsValue): { settings: Omit<Phase2SettingsValue, 'password'>; hasPassword: boolean } {
  const { password, ...rest } = settings
  return { settings: rest, hasPassword: typeof password === 'string' && password !== '' }
}

function updateState(patch: Partial<RunState>): void {
  Object.assign(state, patch)
}

function parseProgressLine(line: string): ProgressState | undefined {
  // 镜像上传脚本用 MIRROR_PROGRESS= 前缀，字段与 ProgressState 同构，映射后共用同一状态机。
  const mirror = parseMirrorProgressLine(line)
  if (mirror) return mirror
  if (!line.startsWith('PHASE2_PROGRESS=')) return undefined
  try {
    const parsed: unknown = JSON.parse(line.slice('PHASE2_PROGRESS='.length))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const value = parsed as Record<string, unknown>
    const rawPercent = Number(value.percent)
    const rawItemPercent = Number(value.itemPercent)
    const stage = text(value.stage)
    if (!Number.isFinite(rawPercent) || !stage) return undefined
    return {
      percent: Math.max(0, Math.min(100, Math.round(rawPercent))),
      stage,
      detail: text(value.detail) || undefined,
      itemIndex: Number.isFinite(Number(value.itemIndex)) ? Number(value.itemIndex) : undefined,
      itemTotal: Number.isFinite(Number(value.itemTotal)) ? Number(value.itemTotal) : undefined,
      itemPercent: Number.isFinite(rawItemPercent)
        ? Math.max(0, Math.min(100, Math.round(rawItemPercent)))
        : Math.max(0, Math.min(100, Math.round(rawPercent))),
      workbookPath: text(value.workbookPath) || undefined,
    }
  } catch {
    return undefined
  }
}

function parseStructuredLine<T>(line: string, prefix: string): T | undefined {
  if (!line.startsWith(prefix)) return undefined
  try {
    const value: unknown = JSON.parse(line.slice(prefix.length))
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as T : undefined
  } catch {
    return undefined
  }
}

function batchFromValue(value: unknown): BatchState | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const rawItems = Array.isArray(source.items) ? source.items : []
  const items: BatchItemState[] = rawItems.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item)).map((item) => ({
    directory: text(item.directory) || undefined,
    workbookPath: text(item.workbookPath) || undefined,
    name: text(item.name) || undefined,
    taskIndex: Number.isFinite(Number(item.taskIndex)) ? Number(item.taskIndex) : undefined,
    status: text(item.status) || 'pending',
    percent: Number.isFinite(Number(item.percent)) ? Math.max(0, Math.min(100, Number(item.percent))) : 0,
    stage: text(item.stage) || '待处理',
    detail: text(item.detail) || undefined,
    applicationId: text(item.applicationId) || undefined,
    assessmentNumber: text(item.assessmentNumber)
      || (item.summary !== null && typeof item.summary === 'object' && !Array.isArray(item.summary)
        ? text((item.summary as Record<string, unknown>).assessmentNumber)
        : undefined),
    testCategory: text(item.testCategory) || undefined,
    submissionPath: text(item.submissionPath) || undefined,
    code: text(item.code) || undefined,
  }))
  const rawSkipped = Array.isArray(source.skipped) ? source.skipped : []
  for (const skipped of rawSkipped) {
    if (skipped === null || typeof skipped !== 'object' || Array.isArray(skipped)) continue
    const item = skipped as Record<string, unknown>
    const directory = text(item.directory) || undefined
    if (directory && items.some((candidate) => candidate.directory === directory)) continue
    items.push({
      directory,
      name: text(item.name) || directory,
      status: 'skipped',
      percent: 100,
      stage: '已跳过',
      detail: text(item.reason) || '未找到第二阶段 Excel。',
    })
  }
  items.sort((left, right) => (left.name || left.directory || '').localeCompare(right.name || right.directory || ''))
  const skippedCount = Number.isFinite(Number(source.skippedCount))
    ? Number(source.skippedCount)
    : items.filter((item) => item.status === 'skipped').length
  const taskCount = Number.isFinite(Number(source.taskCount)) ? Number(source.taskCount) : items.filter((item) => item.taskIndex).length
  const mode = text(source.mode)
  return {
    mode: mode === 'single' || mode === 'batch' ? mode : undefined,
    rootPath: text(source.rootPath) || undefined,
    taskCount,
    skippedCount,
    items,
  }
}

function applyBatchProgress(batch: BatchState | undefined, progress: ProgressState): { batch?: BatchState; progress: ProgressState } {
  if (!batch || !progress.itemIndex || !progress.itemTotal) return { batch, progress }
  const itemIndex = progress.itemIndex
  const itemPercent = progress.itemPercent ?? progress.percent
  const items = batch.items.map((item) => item.taskIndex === itemIndex
    ? { ...item, status: item.status === 'skipped' ? item.status : 'saving', percent: itemPercent, stage: progress.stage, detail: progress.detail, workbookPath: progress.workbookPath || item.workbookPath }
    : item)
  const overall = Math.round(((itemIndex - 1) * 100 + itemPercent) / progress.itemTotal)
  return { batch: { ...batch, taskCount: progress.itemTotal, items }, progress: { ...progress, percent: Math.max(0, Math.min(100, overall)), itemPercent } }
}

function applyBatchItemResult(batch: BatchState | undefined, value: Record<string, unknown>): BatchState | undefined {
  if (!batch) return batch
  const taskIndex = Number(value.taskIndex)
  const status = text(value.status)
  const stage = ({ saved: '已完成', skipped: '已跳过', blocked: '已停止', retryable: '待重试' } as Record<string, string>)[status] || status
  const items = batch.items.map((item) => item.taskIndex === taskIndex ? {
    ...item,
    status: status || item.status,
    percent: ['saved', 'skipped', 'blocked', 'retryable'].includes(status) ? 100 : item.percent,
    stage: stage || item.stage,
    detail: text(value.message) || item.detail,
    applicationId: text(value.applicationId) || item.applicationId,
    assessmentNumber: text(value.assessmentNumber) || item.assessmentNumber,
    testCategory: text(value.testCategory) || item.testCategory,
    submissionPath: text(value.submissionPath) || item.submissionPath,
    code: text(value.code) || item.code,
  } : item)
  return { ...batch, items }
}

function batchFromSummary(summary: Record<string, unknown> | undefined): BatchState | undefined {
  if (!summary || !Array.isArray(summary.items)) return undefined
  return batchFromValue(summary)
}

/**
 * 执行处理脚本所用的 Node 运行时环境。
 *
 * DSH Desktop 的宿主跑在 Electron 里，`process.execPath` 指向
 * `DeepSeek Harness.exe`：直接用它 spawn 脚本会**再开一个 GUI 实例**而不是执行脚本
 * （预检/保存表现为无输出、超时）。Electron 认 `ELECTRON_RUN_AS_NODE=1`，同一个
 * 二进制在该变量下退化成普通 Node。WSL 侧 `dsh web` 的 execPath 本来就是真 Node
 * （`process.versions.electron` 为空），不加该变量。
 */
function scriptNodeEnv(): NodeJS.ProcessEnv {
  return process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}
}

function runScript(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  secrets: string[],
  onProgress?: (progress: ProgressState) => void,
  onBatchInit?: (batch: BatchState) => void,
  onBatchItemResult?: (result: Record<string, unknown>) => void,
  /** 硬超时；默认 15 分钟。大固件上传按调用方传入更长的值（镜像上传 45 分钟）。 */
  timeoutMs: number = 15 * 60 * 1000,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [join(scriptsDirectory(), script), ...args], {
      env: { ...process.env, ...scriptNodeEnv(), ...env },
      maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      const code = typeof error?.code === 'number' ? error.code : error ? 1 : 0
      const output = redact(`${stdout}${stderr ? `\n${stderr}` : ''}`.trim(), secrets)
      resolve({ code, output })
    })
    let progressBuffer = ''
    child.stdout?.on('data', (chunk: Buffer | string) => {
      progressBuffer += chunk.toString()
      const lines = progressBuffer.split(/\r?\n/)
      progressBuffer = lines.pop() || ''
      for (const line of lines) {
        const progress = parseProgressLine(line)
        if (progress) onProgress?.(progress)
        const batch = parseStructuredLine<BatchState>(line, 'PHASE2_BATCH_INIT=')
        if (batch) onBatchInit?.(batchFromValue(batch) || { taskCount: 0, skippedCount: 0, items: [] })
        const itemResult = parseStructuredLine<Record<string, unknown>>(line, 'PHASE2_BATCH_ITEM_RESULT=')
        if (itemResult) onBatchItemResult?.(itemResult)
      }
    })
    const timeout = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.once('close', () => clearTimeout(timeout))
  })
}

function parsePreflight(output: string): { ok: boolean; errors?: string[]; summary?: Record<string, unknown>; message?: string } {
  for (const line of output.split(/\r?\n/).reverse()) {
    if (!line.trim()) continue
    try {
      const value: unknown = JSON.parse(line)
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return value as { ok: boolean; errors?: string[]; summary?: Record<string, unknown>; message?: string }
      }
    } catch {
      // Progress lines are expected before the final one-line JSON result.
    }
  }
  return { ok: false, errors: [output || '预检进程未返回结果。'], message: '工作簿预检失败。' }
}

function formatSaveFailure(summary?: Record<string, unknown>): string | undefined {
  const results = Array.isArray(summary?.results) ? summary.results : []
  const first = results[0]
  if (first === null || typeof first !== 'object' || Array.isArray(first)) return undefined
  const value = first as Record<string, unknown>
  const code = text(value.code)
  const message = text(value.message)
  if (!message) return undefined
  return code ? `${code}: ${message}` : message
}

function parseSave(output: string): { summary?: Record<string, unknown>; failureMessage?: string } {
  const marker = [...output.split(/\r?\n/)].reverse().find((line: string) => line.startsWith('PHASE2_RESULT_JSON='))
  if (!marker) return {}
  try {
    const value: unknown = JSON.parse(marker.slice('PHASE2_RESULT_JSON='.length))
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const summary = value as Record<string, unknown>
      return { summary, failureMessage: formatSaveFailure(summary) }
    }
  } catch {
    // Keep the normal save error when the structured marker is malformed.
  }
  return {}
}

async function handlePreflight(req: IncomingMessage, res: ServerResponse, settings: Phase2SettingsPlane): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, message: '只支持 POST。' })
  if (state.phase !== 'idle') return sendJson(res, 409, { ok: false, message: '已有任务正在执行，请等待当前任务结束。' })
  try {
    const body = await readBody(req)
    const value = currentSettings(settings)
    const path = inputPath(body, value)
    if (!path) return sendJson(res, 400, { ok: false, message: '没有提供对应的申请表格文件或批量目录，已停止执行。' })
    const isDirectoryInput = !path.toLowerCase().endsWith('.xlsx')
    updateState({ kind: 'phase2', phase: 'preflight', startedAt: new Date().toISOString(), finishedAt: undefined, ok: undefined, message: isDirectoryInput ? '正在扫描批量目录。' : '正在读取工作簿。', errors: undefined, summary: undefined, batch: undefined, progress: { percent: 5, stage: isDirectoryInput ? '扫描批量目录' : '读取工作簿', detail: isDirectoryInput ? '正在检查一级子目录中的申请表。' : '正在检查设备类型和必填字段。' } })
    const result = await runScript('preflight_phase2.mjs', ['--input', path], {}, [], (progress) => {
      updateState({ progress, message: progress.detail || progress.stage })
    }, (batch) => {
      updateState({ batch })
    }, (itemResult) => {
      updateState({ batch: applyBatchItemResult(state.batch, itemResult) })
    })
    const parsed = parsePreflight(result.output)
    const response = { ...parsed, ok: result.code === 0 && parsed.ok, output: result.code === 0 ? undefined : parsed.message }
    updateState({ phase: 'idle', finishedAt: new Date().toISOString(), ok: response.ok, message: response.message, errors: response.errors, summary: response.summary, batch: batchFromSummary(response.summary), progress: { percent: 100, stage: response.ok ? '预检完成' : '预检失败', detail: response.ok ? response.message || '工作簿和附件路径可以使用。' : response.message } })
    sendJson(res, response.ok ? 200 : 422, { ...response, batch: state.batch })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateState({ phase: 'idle', finishedAt: new Date().toISOString(), ok: false, message, errors: [message], progress: { percent: 100, stage: '预检失败', detail: message } })
    sendJson(res, 400, { ok: false, message, errors: [message] })
  }
}

async function handleSave(req: IncomingMessage, res: ServerResponse, settings: Phase2SettingsPlane): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, message: '只支持 POST。' })
  if (state.phase !== 'idle') return sendJson(res, 409, { ok: false, message: '已有任务正在执行，请等待当前任务结束。' })
  try {
    const body = await readBody(req)
    const value = currentSettings(settings)
    const path = inputPath(body, value)
    const username = text(value.username) || text(process.env.OH_USERNAME)
    const password = text(value.password) || text(process.env.OH_PASSWORD)
    if (!username || !password) return sendJson(res, 400, { ok: false, message: '没有填写对应账号密码，已停止执行。' })
    if (!path) return sendJson(res, 400, { ok: false, message: '没有提供对应的申请表格文件或批量目录，已停止执行。' })
    const isDirectoryInput = !path.toLowerCase().endsWith('.xlsx')
    const scriptName = isDirectoryInput ? 'phase2_batch.mjs' : 'fill_phase2.mjs'
    const scriptArgs = isDirectoryInput ? ['--input', path, '--save'] : ['--phase2', '--workbook', path, '--save']
    const attachments = isDirectoryInput ? {} : attachmentSettings(path)
    updateState({ kind: 'phase2', phase: 'saving', startedAt: new Date().toISOString(), finishedAt: undefined, ok: undefined, message: '正在启动浏览器流程。', errors: undefined, summary: undefined, batch: undefined, progress: { percent: 2, stage: '启动流程', detail: isDirectoryInput ? '正在扫描批量目录。' : '正在登录兼容性测评平台。' } })
    const result = await runScript(scriptName, scriptArgs, {
      OH_USERNAME: username,
      OH_PASSWORD: password,
      OH_CONTACT_PHONE: text(value.contactPhone) || '13950182204',
      OH_CONTACT_EMAIL: text(value.contactEmail) || '102438@dnake.com',
      OH_SELF_CHECK_PATH: attachments.selfCheckPath || '',
      OH_REPORT_PATH: attachments.reportPath || '',
      OH_MIRROR_PATH: '',
    }, [username, password], (progress) => {
      const merged = applyBatchProgress(state.batch, progress)
      updateState({ progress: merged.progress, batch: merged.batch, message: progress.detail || progress.stage })
    }, (batch) => {
      updateState({ batch })
    }, (itemResult) => {
      updateState({ batch: applyBatchItemResult(state.batch, itemResult) })
    })
    const ok = result.code === 0
    const parsed = parseSave(result.output)
    const message = ok
      ? (isDirectoryInput ? '批量评测资料已处理完成，尚未最终提交。' : '评测资料已保存，尚未最终提交。')
      : parsed.failureMessage || result.output || '评测资料处理失败。'
    updateState({ phase: 'idle', finishedAt: new Date().toISOString(), ok, message, errors: ok ? undefined : [message], summary: parsed.summary, batch: batchFromSummary(parsed.summary) || state.batch, progress: { percent: 100, stage: ok ? '已完成' : '已停止', detail: message } })
    sendJson(res, ok ? 200 : 422, { ok, message, summary: parsed.summary, batch: state.batch, output: result.output || undefined })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateState({ phase: 'idle', finishedAt: new Date().toISOString(), ok: false, message, errors: [message], progress: { percent: 100, stage: '已停止', detail: message } })
    sendJson(res, 400, { ok: false, message, errors: [message] })
  }
}


function waiverInputs(body: Record<string, unknown>, settings: Phase2SettingsValue): { path: string; assessment: string } {
  return {
    path: text(body.waiverPath) || text(settings.waiverPath),
    assessment: text(body.waiverAssessmentNumber) || text(settings.waiverAssessmentNumber),
  }
}

/**
 * 豁免资料预检 / 保存草稿：把指定路径里的 .txt 豁免报告逐条解析，调用
 * `scripts/waiver_batch.mjs`（内部再调 `waiver_draft.mjs`）完成登录、按测评编号
 * 反查系统类型/版本、查重、填表、上传附件，并只点击精确「保存」。
 * 全程不点击「申请豁免/提交/确认提交」，也不调用 /exempt/submit。
 */
async function handleWaiverRun(req: IncomingMessage, res: ServerResponse, settings: Phase2SettingsPlane, mode: 'preflight' | 'save'): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, message: '只支持 POST。' })
  if (state.phase !== 'idle') return sendJson(res, 409, { ok: false, message: '已有任务正在执行，请等待当前任务结束。' })
  try {
    const body = await readBody(req)
    const value = currentSettings(settings)
    const inputs = waiverInputs(body, value)
    const username = text(value.username) || text(process.env.OH_USERNAME)
    const password = text(value.password) || text(process.env.OH_PASSWORD)
    if (!username || !password) return sendJson(res, 400, { ok: false, message: '没有填写对应账号密码，已停止执行。' })
    if (!inputs.assessment) return sendJson(res, 400, { ok: false, message: '没有填写对应测评编号，已停止执行。' })
    if (!inputs.path) return sendJson(res, 400, { ok: false, message: '没有填写豁免资料路径，已停止执行。' })
    const dryRun = mode === 'preflight'
    updateState({
      kind: 'waiver',
      phase: dryRun ? 'preflight' : 'saving',
      startedAt: new Date().toISOString(),
      finishedAt: undefined,
      ok: undefined,
      message: dryRun ? '正在解析豁免资料并预检。' : '正在解析豁免资料并保存草稿。',
      errors: undefined,
      summary: undefined,
      batch: undefined,
      progress: { percent: 2, stage: '解析豁免资料', detail: inputs.path },
    })
    const result = await runScript('waiver_batch.mjs', [
      '--input', inputs.path,
      '--assessment', inputs.assessment,
      dryRun ? '--dry-run' : '--save',
    ], { OH_USERNAME: username, OH_PASSWORD: password }, [username, password], (progress) => {
      updateState({ progress, message: progress.detail || progress.stage })
    }, (batch) => {
      updateState({ batch })
    }, (itemResult) => {
      updateState({ batch: applyBatchItemResult(state.batch, itemResult) })
    })
    const parsed = parseSave(result.output)
    const ok = result.code === 0
    const message = ok
      ? (dryRun ? '豁免资料预检完成：未创建草稿、未提交。' : '豁免草稿已保存（未提交；最终提交必须人工完成）。')
      : (parsed.failureMessage || result.output || '豁免草稿处理失败。')
    updateState({
      kind: 'waiver',
      phase: 'idle',
      finishedAt: new Date().toISOString(),
      ok,
      message,
      errors: ok ? undefined : [message],
      summary: parsed.summary,
      batch: batchFromSummary(parsed.summary) || state.batch,
      progress: { percent: 100, stage: ok ? '已完成' : '已停止', detail: message },
    })
    sendJson(res, ok ? 200 : 422, { ok, message, summary: parsed.summary, batch: state.batch, output: result.output || undefined })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateState({ kind: 'waiver', phase: 'idle', finishedAt: new Date().toISOString(), ok: false, message, errors: [message], progress: { percent: 100, stage: '已停止', detail: message } })
    sendJson(res, 400, { ok: false, message, errors: [message] })
  }
}

const WAIVER_SCAN_PREFIX = 'WAIVER_SCAN_JSON='

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => text(entry)).filter((entry) => entry !== '') : []
}

function parseScanItem(value: unknown): WaiverScanItem | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  const testcases = textList(item.testcases)
  const rawCount = Number(item.caseCount)
  return {
    sourceReport: text(item.sourceReport),
    categoryFolder: text(item.categoryFolder),
    testCategory: text(item.testCategory),
    moduleName: text(item.moduleName),
    testsuite: text(item.testsuite),
    caseCount: Number.isFinite(rawCount) ? Math.max(0, Math.trunc(rawCount)) : testcases.length,
    testcases,
    attachmentPath: text(item.attachmentPath),
    attachmentKind: text(item.attachmentKind),
    evidenceRelative: textList(item.evidenceRelative),
    submissionPath: text(item.submissionPath),
    ready: item.ready === true,
    problems: textList(item.problems),
  }
}

function parseScanSummary(value: unknown, items: WaiverScanItem[]): WaiverScanSummary {
  const source = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const byCategory: Record<string, number> = {}
  const rawByCategory = source.byCategory
  if (rawByCategory !== null && typeof rawByCategory === 'object' && !Array.isArray(rawByCategory)) {
    for (const [key, raw] of Object.entries(rawByCategory as Record<string, unknown>)) {
      const count = Number(raw)
      if (Number.isFinite(count)) byCategory[key] = count
    }
  }
  const rawTotal = Number(source.total)
  const total = Number.isFinite(rawTotal) ? rawTotal : items.length
  const rawReady = Number(source.ready)
  const ready = Number.isFinite(rawReady) ? rawReady : items.filter((item) => item.ready).length
  const rawBlocked = Number(source.blocked)
  const blocked = Number.isFinite(rawBlocked) ? rawBlocked : Math.max(0, total - ready)
  return { total, ready, blocked, byCategory }
}

/** 从脚本输出里取最后一条 `WAIVER_SCAN_JSON=` 结果；识别失败也带 ok:false。 */
function parseWaiverScan(output: string): { ok: boolean; root?: string; items?: WaiverScanItem[]; summary?: WaiverScanSummary; error?: string } | undefined {
  for (const line of output.split(/\r?\n/).reverse()) {
    const parsed = parseStructuredLine<Record<string, unknown>>(line, WAIVER_SCAN_PREFIX)
    if (!parsed) continue
    if (parsed.ok !== true) {
      return { ok: false, error: text(parsed.error) || text(parsed.message) || '识别豁免资料失败。' }
    }
    const items = Array.isArray(parsed.items)
      ? parsed.items.map(parseScanItem).filter((item): item is WaiverScanItem => item !== undefined)
      : []
    return { ok: true, root: text(parsed.root), items, summary: parseScanSummary(parsed.summary, items) }
  }
  return undefined
}

/**
 * 识别豁免资料：调用 `scripts/waiver_batch.mjs --scan`（纯本地，不联网、不登录），
 * 按目录结构解析出测试套分类、模块、套件、附件与平台提交路径，供设置页「识别」按钮预览。
 * 失败统一 HTTP 200 + `{ ok:false, error }`，方便前端统一处理。
 */
/** 草稿提示：只读工作簿状态，用来告诉用户「哪条申请还能继续提交」。 */
const PHASE2_DRAFTS_PREFIX = 'PHASE2_DRAFTS_JSON='

export interface Phase2DraftItem {
  directory?: string
  workbookPath?: string
  name?: string
  sheetName?: string
  type?: string
  assessmentNumber?: string
  applicationId?: string
  processingStatus?: string
  processedAt?: string
  notes?: string
  resumable?: boolean
}

export interface Phase2DraftsResult {
  ok: boolean
  root?: string
  items?: Phase2DraftItem[]
  skipped?: Array<{ workbookPath?: string; name?: string; detail?: string }>
  summary?: { total?: number; skipped?: number }
  error?: string
}

function parsePhase2Drafts(output: string): Phase2DraftsResult | undefined {
  for (const line of output.split(/\r?\n/).reverse()) {
    const parsed = parseStructuredLine<Phase2DraftsResult>(line, PHASE2_DRAFTS_PREFIX)
    if (parsed) return parsed
  }
  return undefined
}

async function handlePhase2Drafts(req: IncomingMessage, res: ServerResponse, settings: Phase2SettingsPlane): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '只支持 POST。' })
  try {
    const body = await readBody(req)
    const workbookPath = text(body.workbookPath) || text(currentSettings(settings).workbookPath)
    if (!workbookPath) return sendJson(res, 200, { ok: false, error: '没有填写设备目录，无法检查草稿。' })
    if (!existsSync(workbookPath)) return sendJson(res, 200, { ok: false, error: `设备目录不存在：${workbookPath}` })
    const result = await runScript('list_phase2_drafts.mjs', ['--input', workbookPath], {}, [])
    const parsed = parsePhase2Drafts(result.output)
    if (!parsed) {
      const detail = result.output ? `无法解析草稿检查结果：${result.output.slice(-500)}` : '草稿检查进程未返回结果。'
      return sendJson(res, 200, { ok: false, error: detail })
    }
    if (parsed.ok === false) return sendJson(res, 200, { ok: false, error: parsed.error || '检查草稿失败。' })
    sendJson(res, 200, { ok: true, root: parsed.root, items: parsed.items ?? [], skipped: parsed.skipped ?? [], summary: parsed.summary })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendJson(res, 200, { ok: false, error: `检查草稿失败：${message}` })
  }
}

async function handleWaiverScan(req: IncomingMessage, res: ServerResponse, settings: Phase2SettingsPlane): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '只支持 POST。' })
  try {
    const body = await readBody(req)
    const path = text(body.waiverPath) || text(currentSettings(settings).waiverPath)
    if (!path) return sendJson(res, 200, { ok: false, error: '没有填写豁免资料路径，无法识别。' })
    if (!existsSync(path)) return sendJson(res, 200, { ok: false, error: `豁免资料路径不存在：${path}` })
    const result = await runScript('waiver_batch.mjs', ['--scan', '--input', path], {}, [])
    const parsed = parseWaiverScan(result.output)
    if (!parsed) {
      const detail = result.output ? `无法解析识别结果：${result.output.slice(-500)}` : '识别进程未返回结果。'
      return sendJson(res, 200, { ok: false, error: detail })
    }
    if (parsed.ok === false) return sendJson(res, 200, { ok: false, error: parsed.error || '识别豁免资料失败。' })
    sendJson(res, 200, { ok: true, root: parsed.root || path, items: parsed.items || [], summary: parsed.summary })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendJson(res, 200, { ok: false, error: `识别豁免资料失败：${message}` })
  }
}

/** 镜像上传脚本的硬超时：647MB 实测约 3.5 分钟，留足慢网与解析阶段余量。 */
const MIRROR_UPLOAD_TIMEOUT_MS = 45 * 60 * 1000

/** 从脚本输出里取最后一条 `MIRROR_RESULT_JSON=` 结果行；没有则 undefined（不伪造成功）。 */
function parseMirrorResult(output: string): MirrorResult | undefined {
  for (const line of output.split(/\r?\n/).reverse()) {
    const parsed = parseMirrorResultLine(line)
    if (parsed) return parsed
  }
  return undefined
}

/** 每次上传一个独立证据目录（脚本失败时把截图写到这里，方便用户回看）。 */
function mirrorArtifactsDirectory(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '')
  return join(tmpdir(), `oh-mirror-upload-${stamp}`)
}

/** 结果行 → 中文 message；失败时保留脚本给的 errorCode，不吞掉可操作信息。 */
function mirrorResultMessage(result: MirrorResult, dryRun: boolean): string {
  if (result.ok) return result.message || (dryRun ? '镜像固件校验通过（未上传）。' : '镜像固件已上传完成。')
  const code = result.errorCode ? `${result.errorCode}: ` : ''
  return `${code}${result.message || (dryRun ? '镜像固件校验失败。' : '镜像固件上传失败。')}`
}

/**
 * 上传脚本在响应返回后继续跑：结束时**无论成败**都把 phase 收回 idle，
 * 否则前端「上传中」按钮会一直禁用。结果行缺失时给出中文诊断 + 脚本输出末尾 500 字
 * （runScript 已按 secrets 脱敏，不会带出密码）。
 */
async function finishMirrorRun(execution: Promise<{ code: number; output: string }>, options: { dryRun: boolean }): Promise<void> {
  const finishedAt = new Date().toISOString()
  try {
    const result = await execution
    const parsed = parseMirrorResult(result.output)
    const ok = result.code === 0 && parsed?.ok === true
    const label = options.dryRun ? '校验' : '上传'
    let message: string
    if (ok) {
      message = mirrorResultMessage(parsed as MirrorResult, options.dryRun)
    } else if (parsed && parsed.ok === false) {
      message = mirrorResultMessage(parsed, options.dryRun)
    } else if (parsed) {
      // 结果行说成功但进程非 0 退出：以退出码为准，不把失败报成成功。
      message = `镜像固件${label}异常结束（脚本退出码 ${result.code}）${result.output ? `：${result.output.slice(-500)}` : '。'}`
    } else {
      message = `镜像固件${label}没有返回结果（脚本退出码 ${result.code}）${result.output ? `：${result.output.slice(-500)}` : '。'}`
    }
    updateState({
      kind: 'mirror',
      phase: 'idle',
      finishedAt,
      ok,
      message,
      errors: ok ? undefined : [message],
      mirror: parsed?.ok ? {
        fileName: parsed.fileName,
        fileSize: parsed.fileSize,
        platformStatus: parsed.platformStatus,
      } : undefined,
      progress: { percent: 100, stage: '已结束', detail: message },
    })
  } catch (error) {
    const message = `镜像固件处理失败：${error instanceof Error ? error.message : String(error)}`
    updateState({
      kind: 'mirror',
      phase: 'idle',
      finishedAt: new Date().toISOString(),
      ok: false,
      message,
      errors: [message],
      mirror: undefined,
      progress: { percent: 100, stage: '已结束', detail: message },
    })
  }
}

/**
 * 镜像固件上传：POST 只做同步校验（方法/忙/空路径/凭据/路径存在）并**立刻**返回，
 * 脚本转后台跑，前端靠 `/status` 轮询进度条。真实上传 600MB+ 固件要数分钟，
 * 等脚本结束再响应会撞 5 分钟 HTTP 超时（DSH 宿主/代理侧）。
 * dryRun 只做本地校验，也走同一状态机，便于前端复用「校验固件」按钮。
 */
async function handleMirrorUpload(req: IncomingMessage, res: ServerResponse, settings: Phase2SettingsPlane): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '只支持 POST。' })
  if (state.phase !== 'idle') return sendJson(res, 200, { ok: false, error: '正在处理其他任务，请稍后再试。' })
  let body: Record<string, unknown>
  try {
    body = await readBody(req)
  } catch (error) {
    // 请求体本身不合法时不改动任务状态，只回 400。
    return sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
  try {
    const value = currentSettings(settings)
    const mirrorPath = text(body.mirrorPath) || text(value.mirrorPath)
    if (!mirrorPath) return sendJson(res, 200, { ok: false, error: '没有填写镜像固件路径，已停止执行。' })
    if (!existsSync(mirrorPath)) return sendJson(res, 200, { ok: false, error: `镜像固件路径不存在：${mirrorPath}` })
    const dryRun = body.dryRun === true
    const username = text(value.username) || text(process.env.OH_USERNAME)
    const password = text(value.password) || text(process.env.OH_PASSWORD)
    // dryRun 只做本地校验，不要求账号密码；真实上传必须要有凭据。
    if (!dryRun && (!username || !password)) return sendJson(res, 200, { ok: false, error: '没有填写对应账号密码，已停止执行。' })
    const artifactsDir = mirrorArtifactsDirectory()
    try {
      mkdirSync(artifactsDir, { recursive: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return sendJson(res, 200, { ok: false, error: `无法创建镜像上传证据目录：${message}` })
    }
    updateState({
      kind: 'mirror',
      phase: 'uploading',
      startedAt: new Date().toISOString(),
      finishedAt: undefined,
      ok: undefined,
      message: dryRun ? '正在校验镜像固件。' : '正在上传镜像固件。',
      errors: undefined,
      summary: undefined,
      batch: undefined,
      mirror: undefined,
      progress: dryRun
        ? { percent: 0, stage: '校验固件', detail: '正在校验固件文件与文件名规则。' }
        : { percent: 0, stage: '启动上传', detail: '正在登录兼容性测评平台。' },
    })
    const execution = runScript('mirror_upload.mjs', [
      '--input', mirrorPath,
      '--artifacts', artifactsDir,
      dryRun ? '--dry-run' : '--upload',
    ], { OH_USERNAME: username, OH_PASSWORD: password }, [username, password], (progress) => {
      updateState({ progress, message: progress.detail || progress.stage })
    }, undefined, undefined, MIRROR_UPLOAD_TIMEOUT_MS)
    sendJson(res, 200, {
      ok: true,
      message: dryRun ? '已开始校验固件，进度见下方进度条。' : '已开始上传固件，进度见下方进度条。',
      artifacts: artifactsDir,
    })
    void finishMirrorRun(execution, { dryRun })
  } catch (error) {
    const message = `镜像固件上传启动失败：${error instanceof Error ? error.message : String(error)}`
    updateState({
      kind: 'mirror',
      phase: 'idle',
      finishedAt: new Date().toISOString(),
      ok: false,
      message,
      errors: [message],
      mirror: undefined,
      progress: { percent: 100, stage: '已结束', detail: message },
    })
    sendJson(res, 400, { ok: false, error: message })
  }
}

/**
 * 本地路径推导：把设置页那行「Excel 文件或批量目录」推导成 申请资料 xlsx / 豁免目录 /
 * 固件包 三个默认值。纯本地、不联网、不写文件，失败也返回 HTTP 200
 * `{ ok:false, error }`（前端按同一结构提示，不会误判成「Host 上没有这个接口」）。
 */
async function handlePathsDerive(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '只支持 POST。' })
  try {
    const body = await readBody(req)
    // `workbookPath` 是契约字段，`path` 作为同义字段兼容；都缺时交给纯函数报中文提示。
    const input = text(body.workbookPath) || text(body.path)
    sendJson(res, 200, derivePaths(input))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendJson(res, 200, { ok: false, error: `推导路径失败：${message}` })
  }
}

function handleStatus(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, message: '只支持 GET。' })
  sendJson(res, 200, { ok: true, state: { ...state } })
}

async function handleGetSettings(req: IncomingMessage, res: ServerResponse, settings: Phase2SettingsPlane): Promise<void> {
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, message: '只支持 GET。' })
  sendJson(res, 200, { ok: true, ...settingsView(settings.get()) })
}

/**
 * 写设置。空字符串语义：
 * - `password` 传空 → 保留原值（卡片不回显密码，不能靠空值清掉它）；
 * - 其余字段传空 → 照写空串（调用方负责填默认联系人）。
 */
async function handleSaveSettings(req: IncomingMessage, res: ServerResponse, settings: Phase2SettingsPlane): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, message: '只支持 POST。' })
  try {
    const body = await readBody(req)
    const patch: Phase2SettingsValue = {}
    for (const field of ['username', 'workbookPath', 'selfCheckPath', 'reportPath', 'mirrorPath', 'contactPhone', 'contactEmail', 'waiverPath', 'waiverAssessmentNumber'] as const) {
      if (field in body) patch[field] = text(body[field])
    }
    const password = text(body.password)
    if (password !== '') patch.password = password
    const saved = await settings.merge(patch)
    sendJson(res, 200, { ok: true, ...settingsView(saved) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendJson(res, 400, { ok: false, message: `设置保存失败：${message}` })
  }
}

export function registerPhase2Routes(ctx: Context, settings: Phase2SettingsPlane): void {
  const routes: WebRoute[] = [
    { kind: 'exact', path: '/api/ohos-xts-auto-reporter/status', handler: handleStatus },
    // `/settings` 同一路径同时服务 GET（读）与 POST（写）：WebRoute 按路径唯一匹配，
    // 方法分发必须在这个 handler 内部做（拆成两条同路径路由时只有第一条生效）。
    {
      kind: 'exact',
      path: '/api/ohos-xts-auto-reporter/settings',
      handler: (req, res) => {
        const task = req.method === 'POST' ? handleSaveSettings(req, res, settings) : handleGetSettings(req, res, settings)
        void task.catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          sendJson(res, 500, { ok: false, message })
        })
      },
    },
    { kind: 'exact', path: '/api/ohos-xts-auto-reporter/preflight', handler: (req, res) => handlePreflight(req, res, settings) },
    { kind: 'exact', path: '/api/ohos-xts-auto-reporter/save', handler: (req, res) => handleSave(req, res, settings) },
    { kind: 'exact', path: '/api/ohos-xts-auto-reporter/waiver/preflight', handler: (req, res) => handleWaiverRun(req, res, settings, 'preflight') },
    { kind: 'exact', path: '/api/ohos-xts-auto-reporter/waiver/save', handler: (req, res) => handleWaiverRun(req, res, settings, 'save') },
    { kind: 'exact', path: '/api/ohos-xts-auto-reporter/waiver/scan', handler: (req, res) => handleWaiverScan(req, res, settings) },
    { kind: 'exact', path: '/api/ohos-xts-auto-reporter/mirror/upload', handler: (req, res) => handleMirrorUpload(req, res, settings) },
    // 路径推导只依赖请求体里的那一行输入，不需要设置数据面。
    { kind: 'exact', path: '/api/ohos-xts-auto-reporter/paths/derive', handler: (req, res) => handlePathsDerive(req, res) },
    { kind: 'exact', path: '/api/ohos-xts-auto-reporter/phase2/drafts', handler: (req, res) => handlePhase2Drafts(req, res, settings) },
  ]
  // `/settings` 同时服务 GET（读）与 POST（写）：WebRoute 的 exact 只按路径分发，
  // 方法判定在各 handler 内部完成。
  const disposers = routes.map((route) => ctx.webServer.register(route))
  ctx.effect(() => () => { for (const dispose of disposers) dispose() }, 'ohos-xts-auto-reporter: phase2 routes')
}

/** 存储与迁移路径可由调用方注入（profile 配置覆盖 / 测试隔离，避免误读真实 home）。 */
export interface Phase2SettingsOptions {
  /** 设置存储文件；缺省 `~/.dsh/ohos-xts-auto-reporter.json`。 */
  settingsFile?: string
  /** 旧版 settings.yaml 路径；仅用于一次性迁移。 */
  legacyFile?: string
}

/**
 * 组装设置数据面。
 *
 * 顺序很关键：`seedIfAbsent` 只在存储文件不存在时启用旧来源，且先看 settings.yaml
 * （用户真实填过的值，含密码），再落 cordis 配置里的 base 默认值。
 */
export function registerPhase2Settings(ctx: Context, config: Phase2SettingsValue = {}, options: Phase2SettingsOptions = {}): Phase2SettingsPlane {
  const store = new Phase2SettingsStore(blankToUndefined(options.settingsFile))
  const fromConfig: Phase2SettingsValue = {
    workbookPath: text(config.workbookPath),
    selfCheckPath: text(config.selfCheckPath),
    reportPath: text(config.reportPath),
    mirrorPath: '',
    contactPhone: text(config.contactPhone) || '13950182204',
    contactEmail: text(config.contactEmail) || '102438@dnake.com',
    waiverPath: text(config.waiverPath),
    waiverAssessmentNumber: text(config.waiverAssessmentNumber),
  }
  try {
    store.seedIfAbsent(readLegacySettings(blankToUndefined(options.legacyFile)), fromConfig)
  } catch (error) {
    ctx.logger.warn(`ohos-xts-auto-reporter: 设置迁移失败，使用空存储: ${error instanceof Error ? error.message : String(error)}`)
  }
  const plane: Phase2SettingsPlane = {
    get: () => store.read(),
    merge: async (patch) => {
      const merged = store.merge(patch)
      ctx.logger.info('ohos-xts-auto-reporter: 设置已保存')
      return merged
    },
  }
  ctx.logger.info(`ohos-xts-auto-reporter: 设置存储 ${store.filePath}`)
  return plane
}
