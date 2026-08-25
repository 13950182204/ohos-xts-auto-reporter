import { execFile } from 'node:child_process'
import { dirname, join, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { PHASE2_SETTINGS_NAMESPACE, Phase2Settings, type Phase2Settings as Phase2SettingsValue } from './config.ts'

type Phase2SettingsScope = SettingsScope<Phase2SettingsValue>
type RunState = {
  phase: 'idle' | 'preflight' | 'saving'
  startedAt?: string
  finishedAt?: string
  ok?: boolean
  message?: string
  errors?: string[]
  summary?: Record<string, unknown>
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

function workbookPath(body: Record<string, unknown>, settings: Phase2SettingsValue): string {
  return text(body.workbookPath) || text(settings.workbookPath)
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

function runScript(script: string, args: string[], env: NodeJS.ProcessEnv, secrets: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [join(scriptsDirectory(), script), ...args], {
      env: { ...process.env, ...env },
      maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      const code = typeof error?.code === 'number' ? error.code : error ? 1 : 0
      const output = redact(`${stdout}${stderr ? `\n${stderr}` : ''}`.trim(), secrets)
      resolve({ code, output })
    })
    const timeout = setTimeout(() => child.kill('SIGTERM'), 15 * 60 * 1000)
    child.once('close', () => clearTimeout(timeout))
  })
}

function parsePreflight(output: string): { ok: boolean; errors?: string[]; summary?: Record<string, unknown>; message?: string } {
  try {
    const value: unknown = JSON.parse(output)
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as { ok: boolean; errors?: string[]; summary?: Record<string, unknown>; message?: string }
    }
  } catch {
    // The fallback below preserves the child error while keeping the wire shape stable.
  }
  return { ok: false, errors: [output || '预检进程未返回结果。'], message: '工作簿预检失败。' }
}

function parseSave(output: string): { summary?: Record<string, unknown> } {
  const marker = [...output.split(/\r?\n/)].reverse().find((line: string) => line.startsWith('PHASE2_RESULT_JSON='))
  if (!marker) return {}
  try {
    const value: unknown = JSON.parse(marker.slice('PHASE2_RESULT_JSON='.length))
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return { summary: value as Record<string, unknown> }
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
    const path = workbookPath(body, value)
    if (!path) return sendJson(res, 400, { ok: false, message: '没有提供对应的申请表格文件，已停止执行。' })
    updateState({ phase: 'preflight', startedAt: new Date().toISOString(), finishedAt: undefined, ok: undefined, message: undefined, errors: undefined, summary: undefined })
    const result = await runScript('preflight_phase2.mjs', ['--workbook', path], {}, [])
    const parsed = parsePreflight(result.output)
    const response = { ...parsed, ok: result.code === 0 && parsed.ok, output: result.code === 0 ? undefined : parsed.message }
    updateState({ phase: 'idle', finishedAt: new Date().toISOString(), ok: response.ok, message: response.message, errors: response.errors, summary: response.summary })
    sendJson(res, response.ok ? 200 : 422, response)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateState({ phase: 'idle', finishedAt: new Date().toISOString(), ok: false, message, errors: [message] })
    sendJson(res, 400, { ok: false, message, errors: [message] })
  }
}

async function handleSave(req: IncomingMessage, res: ServerResponse, settings: Phase2SettingsScope): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, message: '只支持 POST。' })
  if (state.phase !== 'idle') return sendJson(res, 409, { ok: false, message: '已有任务正在执行，请等待当前任务结束。' })
  try {
    const body = await readBody(req)
    const value = currentSettings(settings)
    const path = workbookPath(body, value)
    const username = text(value.username) || text(process.env.OH_USERNAME)
    const password = text(value.password) || text(process.env.OH_PASSWORD)
    if (!username || !password) return sendJson(res, 400, { ok: false, message: '没有填写对应账号密码，已停止执行。' })
    if (!path) return sendJson(res, 400, { ok: false, message: '没有提供对应的申请表格文件，已停止执行。' })
    const attachments = attachmentSettings(path)
    updateState({ phase: 'saving', startedAt: new Date().toISOString(), finishedAt: undefined, ok: undefined, message: '正在保存第二阶段草稿。', errors: undefined, summary: undefined })
    const result = await runScript('fill_phase2.mjs', ['--phase2', '--workbook', path, '--save'], {
      OH_USERNAME: username,
      OH_PASSWORD: password,
      OH_CONTACT_PHONE: text(value.contactPhone) || '13950182204',
      OH_CONTACT_EMAIL: text(value.contactEmail) || '102438@dnake.com',
      OH_SELF_CHECK_PATH: attachments.selfCheckPath,
      OH_REPORT_PATH: attachments.reportPath,
      OH_MIRROR_PATH: '',
    }, [username, password])
    const ok = result.code === 0
    const parsed = parseSave(result.output)
    const message = ok ? '第二阶段草稿已保存，尚未提交。' : result.output || '第二阶段保存失败。'
    updateState({ phase: 'idle', finishedAt: new Date().toISOString(), ok, message, errors: ok ? undefined : [message], summary: parsed.summary })
    sendJson(res, ok ? 200 : 422, { ok, message, summary: parsed.summary, output: result.output || undefined })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateState({ phase: 'idle', finishedAt: new Date().toISOString(), ok: false, message, errors: [message] })
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
