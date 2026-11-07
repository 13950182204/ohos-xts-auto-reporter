import { createElement, useEffect, useRef, useState } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// 0.2.x 起 slots 服务由 ui-renderer 提供（dsh-client-runtime / dsh-client-ui-slots 均已从发布线移除）。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  SettingsCardView,
  type DerivePathsResult,
  type ResponseState,
  type SettingsFormValues,
  type SettingsView,
  type WaiverScan,
} from './settings-view.ts'

const DEFAULT_PHONE = '13950182204'
const DEFAULT_EMAIL = '102438@dnake.com'

const EMPTY_VALUES: SettingsFormValues = {
  username: '',
  password: '',
  workbookPath: '',
  mirrorPath: '',
  contactPhone: DEFAULT_PHONE,
  contactEmail: DEFAULT_EMAIL,
  waiverPath: '',
  waiverAssessmentNumber: '',
}

type PathField = 'workbookPath' | 'waiverPath' | 'mirrorPath'

/** 只保存「上一轮由推导写入的值」，用来区分「用户手动改过」与「仍是自动带出的」。 */
type ApiResult = { ok: boolean; message?: string }

async function request<T extends ApiResult>(path: string, method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/ohos-xts-auto-reporter/${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    return { ok: false, message: '无法连接 DSH Host（网络请求失败，稍后重试）。' } as T
  }
  const raw = await response.text().catch(() => '')
  try {
    const parsed = JSON.parse(raw) as T & { error?: unknown }
    if (parsed && typeof parsed === 'object') {
      // 宿主对同步错误（路径为空、端口忙等）返回 { ok:false, error }；
      // 卡片只渲染 message/errors，这里统一成可读文案，避免"点了没反应"。
      if (parsed.ok === false && !parsed.message && typeof parsed.error === 'string' && parsed.error) {
        return { ...parsed, message: parsed.error } as T
      }
      return parsed
    }
  } catch {
    // 非 JSON 响应，落到下面的分支给出可执行的提示
  }
  // DSH 对「未注册的插件路由」返回纯文本 401/404：典型成因是宿主半区仍是旧版本
  // （桌面端热更新只替换浏览器半区，宿主半区要重启才更新）。
  if (response.status === 401 || response.status === 404) {
    return {
      ok: false,
      message: `Host 上没有这个接口（HTTP ${response.status}）。宿主半区可能仍是旧版本，重启 DSH Desktop 后重试。`,
    } as T
  }
  return {
    ok: false,
    message: `Host 返回了无法解析的响应（HTTP ${response.status}）${raw ? `：${raw.slice(0, 120)}` : ''}`,
  } as T
}

function displayValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * XTS 报告上传卡片。
 *
 * 数据面全部走本插件自己的 Host 路由（`/api/ohos-xts-auto-reporter/*`），
 * **不用 `ctx.settingsScope`**：该服务只存在于 DSH 0.1.x，0.2.0-rc.2（DSH Desktop）
 * 的浏览器半区已无此服务，注入它会让整个卡片永不挂载。
 * 视觉层拆在 `settings-view.ts`（纯 props），这里只负责状态、轮询与请求。
 */
export function ReporterSettingsCard() {
  const [values, setValues] = useState<SettingsFormValues>(EMPTY_VALUES)
  const [hasPassword, setHasPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<ResponseState | null>(null)
  const [hostState, setHostState] = useState<ResponseState | null>(null)
  const [scan, setScan] = useState<WaiverScan | null>(null)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  // 路径推导：只做「填 Excel → 带出其它路径」，绝不自动触发任何提交动作。
  const [derived, setDerived] = useState<DerivePathsResult | null>(null)
  const [deriving, setDeriving] = useState(false)
  const [deriveError, setDeriveError] = useState('')
  const derivedForRef = useRef('')

  useEffect(() => {
    let active = true
    void (async () => {
      const response = await request<ResponseState>('settings', 'GET')
      if (!active) return
      const value: SettingsView = response.settings ?? {}
      setValues((previous) => ({
        ...previous,
        username: displayValue(value.username),
        password: '',
        workbookPath: displayValue(value.workbookPath),
        mirrorPath: displayValue(value.mirrorPath),
        contactPhone: displayValue(value.contactPhone) || DEFAULT_PHONE,
        contactEmail: displayValue(value.contactEmail) || DEFAULT_EMAIL,
        waiverPath: displayValue(value.waiverPath),
        waiverAssessmentNumber: displayValue(value.waiverAssessmentNumber),
      }))
      setHasPassword(response.hasPassword === true)
      setSettingsLoaded(response.ok)
    })()
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const poll = async () => {
      const response = await request<ResponseState>('status', 'GET')
      if (active) setHostState(response)
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 2500)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  // 输入停顿 500ms 后按 Excel 路径推导其它路径；同一输入只请求一次。
  // 语义：Excel 这一行是「根」，换了根就用推导结果覆盖另外两条路径；同一个根不重复推导，
  // 因此用户推导后手改的豁免路径 / 固件包路径不会被悄悄改回去。
  useEffect(() => {
    const input = values.workbookPath.trim()
    if (!settingsLoaded || !input || derivedForRef.current === input) return
    derivedForRef.current = input
    let active = true
    const timer = window.setTimeout(() => {
      void (async () => {
        setDeriving(true)
        const response = await request<DerivePathsResult>('paths/derive', 'POST', { workbookPath: input })
        if (!active) return
        setDeriving(false)
        // 期间用户又改了根：这次响应已过期，丢弃，避免用旧结果覆盖新输入。
        if (derivedForRef.current !== input) return
        setDerived(response)
        if (!response.ok) {
          setDeriveError(response.message ?? '路径推导不可用。')
          derivedForRef.current = ''
          return
        }
        setDeriveError('')
        setValues((previous) => {
          const next = { ...previous }
          // 换了根就按新根整体重置这三条路径：推不出来就清空（配合提示），
          // 绝不让上一台设备的固件包路径留在字段里被误上传。
          const adopt = (field: PathField, value: string | undefined): void => {
            const nextValue = value ?? ''
            if (previous[field] !== nextValue) next[field] = nextValue
          }
          adopt('workbookPath', response.workbookPath)
          adopt('waiverPath', response.waiverPath)
          adopt('mirrorPath', response.mirrorPath)
          return next
        })
      })()
    }, 500)
    return () => { active = false; window.clearTimeout(timer) }
  }, [values.workbookPath, settingsLoaded])

  function onChange(field: keyof SettingsFormValues, value: string): void {
    setValues((previous) => ({ ...previous, [field]: value }))
  }

  async function saveSettings(): Promise<boolean> {
    const response = await request<ResponseState>('settings', 'POST', {
      username: values.username.trim(),
      workbookPath: values.workbookPath.trim(),
      mirrorPath: values.mirrorPath.trim(),
      contactPhone: values.contactPhone.trim() || DEFAULT_PHONE,
      contactEmail: values.contactEmail.trim() || DEFAULT_EMAIL,
      waiverPath: values.waiverPath.trim(),
      waiverAssessmentNumber: values.waiverAssessmentNumber.trim(),
      // 空密码 = 保留已保存的密码；只有用户真的输入了新密码才提交。
      ...(values.password ? { password: values.password } : {}),
    })
    if (!response.ok) {
      setResult({ ok: false, message: response.message || '设置保存失败。' })
      return false
    }
    if (values.password) {
      setHasPassword(true)
      setValues((previous) => ({ ...previous, password: '' }))
    }
    return true
  }

  async function runScan(): Promise<void> {
    setScanning(true)
    setResult(null)
    const response = await request<WaiverScan>('waiver/scan', 'POST', { waiverPath: values.waiverPath.trim() })
    setScan(response)
    setScanning(false)
  }

  async function runMirror(dryRun: boolean): Promise<void> {
    setBusy(true)
    setResult(null)
    const saved = await saveSettings()
    if (saved) setResult(await request<ResponseState>('mirror/upload', 'POST', { mirrorPath: values.mirrorPath.trim(), dryRun }))
    setBusy(false)
  }

  async function run(action: 'preflight' | 'save' | 'waiver/preflight' | 'waiver/save', body: Record<string, unknown>): Promise<void> {
    setBusy(true)
    setResult(null)
    const saved = await saveSettings()
    if (saved) setResult(await request<ResponseState>(action, 'POST', body))
    setBusy(false)
  }

  // 固件上传是长任务：Host 立即返回「已开始」，真正的忙闲状态由 /status 的 phase 决定，
  // 否则本地 busy 会在几百毫秒后复位，按钮提前解禁。
  const hostPhase = typeof hostState?.state?.phase === 'string' ? hostState.state.phase : 'idle'
  const hostRunning = hostPhase !== 'idle'
  const effectiveBusy = busy || hostRunning

  return createElement(SettingsCardView, {
    values,
    hasPassword,
    busy: effectiveBusy,
    scanning,
    settingsLoaded,
    result,
    state: hostState?.state,
    scan,
    derived,
    deriving,
    deriveError,
    onChange,
    onPreflight: () => { void run('preflight', { workbookPath: values.workbookPath.trim() }) },
    onSaveReport: () => { void run('save', { workbookPath: values.workbookPath.trim() }) },
    onWaiverPreflight: () => {
      void run('waiver/preflight', {
        waiverPath: values.waiverPath.trim(),
        waiverAssessmentNumber: values.waiverAssessmentNumber.trim(),
      })
    },
    onSaveWaiverDraft: () => {
      void run('waiver/save', {
        waiverPath: values.waiverPath.trim(),
        waiverAssessmentNumber: values.waiverAssessmentNumber.trim(),
      })
    },
    onScan: () => { void runScan() },
    onCheckMirror: () => { void runMirror(true) },
    onUploadMirror: () => { void runMirror(false) },
  })
}

/**
 * 必需注入：只要槽宿主。**不要加 `settingsScope`**——0.2.0-rc.2 的浏览器半区没有该服务，
 * 写进必需注入会让整个卡片（乃至浏览器半区）永不 apply。
 * `locale` 也省略：本卡片的中文文案是字面量，不依赖字典。
 */
export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  try {
    ctx.slots.inject('settings.section', () => {
      const unregister = ctx.slots.register({
        name: 'settings.section',
        id: 'ohos-xts-auto-reporter',
        order: 35,
        label: () => 'XTS报告上传',
      }, ReporterSettingsCard)
      return () => unregister()
    })
  } catch (error) {
    console.warn('[ohos-xts-auto-reporter] settings section mount failed:', error)
  }
}
