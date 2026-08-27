import { useEffect, useMemo, useState, useSyncExternalStore, type ChangeEvent } from 'react'
import { createElement } from 'react'
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { Phase2Settings } from './config.ts'

const NAMESPACE = 'ohos-xts-auto-reporter'
const DEFAULT_PHONE = '13950182204'
const DEFAULT_EMAIL = '102438@dnake.com'

type CardProps = { scope: SettingsScope<Phase2Settings> }
type ResponseState = {
  ok: boolean
  message?: string
  errors?: string[]
  summary?: Record<string, unknown>
  state?: Record<string, unknown>
}

async function request(path: string, method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<ResponseState> {
  try {
    const response = await fetch(`/api/ohos-xts-auto-reporter/${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const value = await response.json() as ResponseState
    return value
  } catch {
    return { ok: false, message: '无法连接 DSH Host。' }
  }
}

function displayValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function inputStyle(): Record<string, string> {
  return {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: '38px',
    padding: '8px 11px',
    border: '1px solid var(--dsw-color-border, #cbd5e1)',
    borderRadius: '6px',
    background: 'var(--dsw-color-input, transparent)',
    color: 'inherit',
  }
}

function labelStyle(): Record<string, string | number> {
  return { display: 'grid', gap: '6px', margin: 0, minWidth: 0, fontSize: '13px' }
}

function buttonStyle(primary = false): Record<string, string> {
  return {
    border: `1px solid ${primary ? 'var(--dsw-color-primary, #2563eb)' : 'var(--dsw-color-border, #cbd5e1)'}`,
    borderRadius: '6px',
    minHeight: '38px',
    padding: '7px 13px',
    cursor: 'pointer',
    color: primary ? '#fff' : 'inherit',
    background: primary ? 'var(--dsw-color-primary, #2563eb)' : 'transparent',
  }
}

export function ReporterSettingsCard({ scope }: CardProps) {
  const subscribe = useMemo(() => scope.subscribe.bind(scope), [scope])
  const readSnapshot = useMemo(() => scope.getSnapshot.bind(scope), [scope])
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, readSnapshot)
  const initial = snapshot.value ?? {}
  const [username, setUsername] = useState(displayValue(initial.username))
  const [password, setPassword] = useState('')
  const [workbookPath, setWorkbookPath] = useState(displayValue(initial.workbookPath))
  const [mirrorPath] = useState('')
  const [contactPhone, setContactPhone] = useState(displayValue(initial.contactPhone) || DEFAULT_PHONE)
  const [contactEmail, setContactEmail] = useState(displayValue(initial.contactEmail) || DEFAULT_EMAIL)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ResponseState | null>(null)
  const [hostState, setHostState] = useState<ResponseState | null>(null)
  const writable = snapshot.writable && snapshot.status !== 'unavailable'

  useEffect(() => {
    const value = scope.getSnapshot().value ?? {}
    if (value.workbookPath !== undefined) setWorkbookPath(displayValue(value.workbookPath))
    if (value.contactPhone !== undefined) setContactPhone(displayValue(value.contactPhone))
    if (value.contactEmail !== undefined) setContactEmail(displayValue(value.contactEmail))
  }, [scope, snapshot.value])

  useEffect(() => {
    let active = true
    const poll = async () => {
      const response = await request('status', 'GET')
      if (active) setHostState(response)
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 2500)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  const summary = useMemo(() => hostState?.state as Record<string, unknown> | undefined, [hostState])
  const displayState = result && !summary?.finishedAt
    ? { ...(summary ?? { phase: 'idle' }), finishedAt: new Date().toISOString(), ok: result.ok, message: result.message }
    : summary
  const operation = (result?.summary ?? summary?.summary) as Record<string, unknown> | undefined
  const progress = (displayState?.progress ?? summary?.progress) as Record<string, unknown> | undefined
  const progressPercent = Number.isFinite(Number(progress?.percent))
    ? Math.max(0, Math.min(100, Number(progress?.percent)))
    : undefined
  const progressStage = displayValue(progress?.stage)
  const progressDetail = displayValue(progress?.detail)
  const results = Array.isArray(operation?.results) ? operation.results as Array<Record<string, unknown>> : []
  const firstResult = results[0]
  const attachments = firstResult?.attachments as Record<string, Record<string, unknown>> | undefined

  async function saveSettings(): Promise<boolean> {
    if (!writable) {
      setResult({ ok: false, message: 'DSH 设置当前不可写，请在本机 Web GUI 中打开插件卡片。' })
      return false
    }
    const writes: Array<Promise<void>> = [
      scope.set('workbookPath', workbookPath.trim()),
      scope.set('mirrorPath', ''),
      scope.set('contactPhone', contactPhone.trim() || DEFAULT_PHONE),
      scope.set('contactEmail', contactEmail.trim() || DEFAULT_EMAIL),
    ]
    if (username.trim()) writes.push(scope.set('username', username.trim()))
    if (password) writes.push(scope.set('password', password))
    try {
      await Promise.all(writes)
      setPassword('')
      return true
    } catch {
      setResult({ ok: false, message: '设置保存失败。' })
      return false
    }
  }

  async function preflight(): Promise<void> {
    setBusy(true)
    setResult(null)
    const saved = await saveSettings()
    if (saved) setResult(await request('preflight', 'POST', { workbookPath: workbookPath.trim() }))
    setBusy(false)
  }

  async function saveDraft(): Promise<void> {
    setBusy(true)
    setResult(null)
    const saved = await saveSettings()
    if (saved) setResult(await request('save', 'POST', { workbookPath: workbookPath.trim() }))
    setBusy(false)
  }

  const onText = (setter: (value: string) => void) => (event: ChangeEvent<HTMLInputElement>) => setter(event.target.value)
  const gridStyle: Record<string, string> = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '12px 14px',
    alignItems: 'start',
  }
  const fullWidthStyle: Record<string, string> = { ...labelStyle(), gridColumn: '1 / -1' }
  const showProgress = progressPercent !== undefined && (
    busy || displayState?.phase !== 'idle' || Boolean(displayState?.finishedAt) || Boolean(result)
  )
  return createElement('section', {
    style: {
      padding: '16px',
      border: '1px solid var(--dsw-color-border, #cbd5e1)',
      borderRadius: '8px',
      marginBottom: '12px',
      maxWidth: '760px',
      boxSizing: 'border-box',
    },
  },
  createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', marginBottom: '10px' } },
  createElement('strong', { style: { fontSize: '15px' } }, 'OpenHarmony XTS 自动上报'),
    createElement('span', { style: { fontSize: '12px', opacity: 0.72 } }, '第二阶段草稿')),
  createElement('div', { style: gridStyle },
  createElement('label', { style: labelStyle() }, '账号', createElement('input', { type: 'text', autoComplete: 'username', value: username, onChange: onText(setUsername), disabled: busy, style: inputStyle() })),
  createElement('label', { style: labelStyle() }, '密码', createElement('input', { type: 'password', autoComplete: 'current-password', value: password, placeholder: '留空使用已保存密码或环境变量', onChange: onText(setPassword), disabled: busy, style: inputStyle() })),
  createElement('label', { style: fullWidthStyle }, '第二阶段 Excel 文件', createElement('input', { type: 'text', value: workbookPath, placeholder: '绝对路径，例如 D:\\ohos\\XTS6.1\\OpenHarmony兼容性申请_第二阶段.xlsx', onChange: onText(setWorkbookPath), disabled: busy, style: inputStyle() })),
  createElement('label', { style: fullWidthStyle }, '镜像固件路径（预留）', createElement('input', { type: 'text', value: mirrorPath, readOnly: true, placeholder: '未来固件自动上传，当前留空', disabled: true, style: inputStyle() })),
  createElement('label', { style: labelStyle() }, '企业联系电话', createElement('input', { type: 'tel', value: contactPhone, onChange: onText(setContactPhone), disabled: busy, style: inputStyle() })),
  createElement('label', { style: labelStyle() }, '企业邮箱', createElement('input', { type: 'email', value: contactEmail, onChange: onText(setContactEmail), disabled: busy, style: inputStyle() }))),
  createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '16px' } },
    createElement('button', { type: 'button', onClick: () => { void preflight() }, disabled: busy || !writable, style: buttonStyle(false) }, '预检'),
    createElement('button', { type: 'button', onClick: () => { void saveDraft() }, disabled: busy || !writable, style: buttonStyle(true) }, busy ? '处理中…' : '保存第二阶段草稿')),
  createElement('p', { style: { fontSize: '12px', lineHeight: 1.5, opacity: 0.68, margin: '12px 0 0' } }, '镜像上传暂未启用；不会进入样机寄送或提交申请。'),
  showProgress ? createElement('div', { style: { marginTop: '14px' } },
    createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', marginBottom: '6px', fontSize: '12px' } },
      createElement('span', null, progressStage || (busy ? '处理中' : '处理状态')),
      createElement('strong', null, `${Math.round(progressPercent)}%`)),
    createElement('div', {
      role: 'progressbar',
      'aria-label': 'XTS 报告上传进度',
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': Math.round(progressPercent),
      style: { height: '8px', overflow: 'hidden', borderRadius: '4px', background: 'var(--dsw-color-fill-secondary, rgba(127, 127, 127, 0.22))' },
    }, createElement('div', { style: { width: `${progressPercent}%`, height: '100%', borderRadius: 'inherit', background: result?.ok === false ? 'var(--dsw-color-danger, #dc2626)' : 'var(--dsw-color-primary, #2563eb)', transition: 'width 180ms ease-out' } })),
    progressDetail ? createElement('div', { style: { marginTop: '6px', color: 'var(--dsw-color-text-secondary, inherit)', fontSize: '12px', lineHeight: 1.5 } }, progressDetail) : null,
  ) : null,
  result ? createElement('div', { role: 'status', style: { marginTop: '10px', color: result.ok ? '#15803d' : '#b91c1c', whiteSpace: 'pre-wrap', fontSize: '13px' } }, result.ok ? (result.message || '操作成功。') : [result.message, ...(result.errors ?? [])].filter(Boolean).join('\n')) : null,
  displayState !== undefined && (displayState.phase !== 'idle' || displayState.finishedAt) ? createElement('div', { role: 'status', style: { marginTop: '8px', fontSize: '12px', lineHeight: 1.6 } },
    `Host 状态：${String(displayState.phase)}${displayState.message ? `，${String(displayState.message)}` : ''}`,
    firstResult?.applicationId ? createElement('div', null, `申请标识：${String(firstResult.applicationId)}`) : null,
    firstResult?.assessmentNumber ? createElement('div', null, `测评编号：${String(firstResult.assessmentNumber)}`) : null,
    firstResult?.status ? createElement('div', null, `处理结果：${String(firstResult.status)}`) : null,
    attachments?.mirror?.fileName ? createElement('div', null, `镜像：${String(attachments.mirror.fileName)}`) : null) : null,
  !writable ? createElement('div', { role: 'status', style: { marginTop: '8px', color: '#b45309', fontSize: '12px' } }, '设置服务不可写或未暴露；请使用本机 DSH Web GUI。') : null)
}

export const inject = ['slots', 'settingsScope']

export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind<Phase2Settings>({ namespace: NAMESPACE })
  ctx.slots.inject('settings.section', () => {
    const unregister = ctx.slots.register({
      name: 'settings.section',
      id: 'ohos-xts-auto-reporter',
      order: 35,
      label: () => 'XTS报告上传',
      inject: () => ({ scope }),
    }, ReporterSettingsCard)
    return () => unregister()
  })
}
