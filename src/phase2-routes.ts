import { execFile } from 'node:child_process'
import { dirname, join, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { PHASE2_SETTINGS_NAMESPACE, Phase2Settings, type Phase2Settings as Phase2SettingsValue } from './config.ts'

type Phase2SettingsScope = SettingsScope<Phase2SettingsValue>
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
  code?: string
}
type BatchState = {
  mode?: 'single' | 'batch'
  rootPath?: string
  taskCount: number
  skippedCount: number
  items: BatchItemState[]
}
type RunState = {
  phase: 'idle' | 'preflight' | 'saving'
  startedAt?: string
  finishedAt?: string
  ok?: boolean
  message?: string
  errors?: string[]
  summary?: Record<string, unknown>
  progress?: ProgressState
  batch?: BatchState
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

function currentSettings(scope: Phase2SettingsScope): Phase2SettingsValue {
  return scope.get()
}

function updateState(patch: Partial<RunState>): void {
  Object.assign(state, patch)
}

function parseProgressLine(line: string): ProgressState | undefined {
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
    code: text(value.code) || item.code,
  } : item)
  return { ...batch, items }
}

function batchFromSummary(summary: Record<string, unknown> | undefined): BatchState | undefined {
  if (!summary || !Array.isArray(summary.items)) return undefined
  return batchFromValue(summary)
}

function runScript(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  secrets: string[],
  onProgress?: (progress: ProgressState) => void,
  onBatchInit?: (batch: BatchState) => void,
  onBatchItemResult?: (result: Record<string, unknown>) => void,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [join(scriptsDirectory(), script), ...args], {
      env: { ...process.env, ...env },
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
    const timeout = setTimeout(() => child.kill('SIGTERM'), 15 * 60 * 1000)
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

async function handlePreflight(req: IncomingMessage, res: ServerResponse, settings: Phase2SettingsScope): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, message: '只支持 POST。' })
  if (state.phase !== 'idle') return sendJson(res, 409, { ok: false, message: '已有任务正在执行，请等待当前任务结束。' })
  try {
    const body = await readBody(req)
    const value = currentSettings(settings)
    const path = inputPath(body, value)
    if (!path) return sendJson(res, 400, { ok: false, message: '没有提供对应的申请表格文件或批量目录，已停止执行。' })
    const isDirectoryInput = !path.toLowerCase().endsWith('.xlsx')
    updateState({ phase: 'preflight', startedAt: new Date().toISOString(), finishedAt: undefined, ok: undefined, message: isDirectoryInput ? '正在扫描批量目录。' : '正在读取工作簿。', errors: undefined, summary: undefined, batch: undefined, progress: { percent: 5, stage: isDirectoryInput ? '扫描批量目录' : '读取工作簿', detail: isDirectoryInput ? '正在检查一级子目录中的申请表。' : '正在检查设备类型和必填字段。' } })
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

async function handleSave(req: IncomingMessage, res: ServerResponse, settings: Phase2SettingsScope): Promise<void> {
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
    updateState({ phase: 'saving', startedAt: new Date().toISOString(), finishedAt: undefined, ok: undefined, message: '正在启动浏览器流程。', errors: undefined, summary: undefined, batch: undefined, progress: { percent: 2, stage: '启动流程', detail: isDirectoryInput ? '正在扫描批量目录。' : '正在登录兼容性测评平台。' } })
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

function handleStatus(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, message: '只支持 GET。' })
  sendJson(res, 200, { ok: true, state: { ...state } })
}

export function registerPhase2Routes(ctx: Context, settings: Phase2SettingsScope): void {
  const routes: WebRoute[] = [
    { kind: 'exact', path: '/api/ohos-xts-auto-reporter/status', handler: handleStatus },
    { kind: 'exact', path: '/api/ohos-xts-auto-reporter/preflight', handler: (req, res) => handlePreflight(req, res, settings) },
    { kind: 'exact', path: '/api/ohos-xts-auto-reporter/save', handler: (req, res) => handleSave(req, res, settings) },
  ]
  const disposers = routes.map((route) => ctx.webServer.register(route))
  ctx.effect(() => () => { for (const dispose of disposers) dispose() }, 'ohos-xts-auto-reporter: phase2 routes')
}

export function registerPhase2Settings(ctx: Context, config: Phase2SettingsValue = {}): Phase2SettingsScope {
  return ctx.settings.register(settingsNamespace(PHASE2_SETTINGS_NAMESPACE), Phase2Settings, {
    base: {
      workbookPath: text(config.workbookPath),
      selfCheckPath: text(config.selfCheckPath),
      reportPath: text(config.reportPath),
      mirrorPath: '',
      contactPhone: text(config.contactPhone) || '13950182204',
      contactEmail: text(config.contactEmail) || '102438@dnake.com',
    },
  }) as Phase2SettingsScope
}
