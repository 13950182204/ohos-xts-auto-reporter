import { createElement, useEffect, useState } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// 0.2.x 起 slots 服务由 ui-renderer 提供（dsh-client-runtime / dsh-client-ui-slots 均已从发布线移除）。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  SettingsCardView,
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
  contactPhone: DEFAULT_PHONE,
  contactEmail: DEFAULT_EMAIL,
  waiverPath: '',
  waiverAssessmentNumber: '',
}

type ApiResult = { ok: boolean; message?: string }

async function request<T extends ApiResult>(path: string, method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<T> {
  try {
    const response = await fetch(`/api/ohos-xts-auto-reporter/${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    return await response.json() as T
  } catch {
    return { ok: false, message: '无法连接 DSH Host。' } as T
  }
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

  function onChange(field: keyof SettingsFormValues, value: string): void {
    setValues((previous) => ({ ...previous, [field]: value }))
  }

  async function saveSettings(): Promise<boolean> {
    const response = await request<ResponseState>('settings', 'POST', {
      username: values.username.trim(),
      workbookPath: values.workbookPath.trim(),
      mirrorPath: '',
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

  async function run(action: 'preflight' | 'save' | 'waiver/preflight' | 'waiver/save', body: Record<string, unknown>): Promise<void> {
    setBusy(true)
    setResult(null)
    const saved = await saveSettings()
    if (saved) setResult(await request<ResponseState>(action, 'POST', body))
    setBusy(false)
  }

  return createElement(SettingsCardView, {
    values,
    hasPassword,
    busy,
    scanning,
    settingsLoaded,
    result,
    state: hostState?.state,
    scan,
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
