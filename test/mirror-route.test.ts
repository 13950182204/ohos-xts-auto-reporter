import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseMirrorProgressLine,
  parseMirrorResultLine,
  registerPhase2Routes,
  type Phase2SettingsPlane,
} from '../src/phase2-routes.ts'

/** 隔离注册用的最小 ctx：只记录路由，不拉起真实 webServer / cordis 运行时。 */
type CapturedRoute = {
  kind: string
  path: string
  handler: (req: unknown, res: unknown) => void
}

function fakeContext(): { ctx: any; routes: CapturedRoute[] } {
  const routes: CapturedRoute[] = []
  const ctx = {
    webServer: {
      register(route: CapturedRoute) {
        routes.push(route)
        return () => {}
      },
    },
    effect(fn: () => () => void) {
      fn()
    },
  }
  return { ctx, routes }
}

function fakeSettings(overrides: Record<string, unknown> = {}): Phase2SettingsPlane {
  const value: Record<string, unknown> = {
    username: '',
    password: '',
    mirrorPath: '',
    ...overrides,
  }
  return {
    get: () => value as any,
    merge: async (patch: any) => Object.assign(value, patch),
  } as Phase2SettingsPlane
}

type CapturedResponse = { statusCode: number; body: string }

/** 用一个可迭代的假 req 驱动 `(req,res)=>handler`，收集 sendJson 写出的响应。 */
function call(handler: (req: any, res: any) => void, method: string, body?: unknown): Promise<CapturedResponse> {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as any
  req.method = method
  const res: any = {
    statusCode: 0,
    setHeader() {},
    end(value: unknown) {
      resolve({ statusCode: res.statusCode, body: String(value ?? '') })
    },
  }
  let resolve: (response: CapturedResponse) => void = () => {}
  const done = new Promise<CapturedResponse>((settle) => { resolve = settle })
  handler(req, res)
  return done
}

describe('parseMirrorProgressLine', () => {
  it('parses a full progress line and keeps one decimal place', () => {
    const line = 'MIRROR_PROGRESS={"percent":12.34,"stage":"解析固件","detail":"正在解压 OpenHarmony-6.1.zip","uploadedBytes":123,"totalBytes":678,"speedBytesPerSecond":1234}'
    expect(parseMirrorProgressLine(line)).toEqual({
      percent: 12.3,
      stage: '解析固件',
      detail: '正在解压 OpenHarmony-6.1.zip',
    })
  })

  it('accepts a progress line without detail', () => {
    expect(parseMirrorProgressLine('MIRROR_PROGRESS={"percent":100,"stage":"完成"}')).toEqual({ percent: 100, stage: '完成' })
  })

  it('clamps an out-of-range percent instead of leaving 0–100', () => {
    expect(parseMirrorProgressLine('MIRROR_PROGRESS={"percent":120.5,"stage":"上传"}')?.percent).toBe(100)
    expect(parseMirrorProgressLine('MIRROR_PROGRESS={"percent":-8,"stage":"上传"}')?.percent).toBe(0)
  })

  it('rejects lines without the MIRROR_PROGRESS prefix or without valid JSON', () => {
    expect(parseMirrorProgressLine('PHASE2_PROGRESS={"percent":10,"stage":"解析"}')).toBeUndefined()
    expect(parseMirrorProgressLine('MIRROR_PROGRESS={not-json')).toBeUndefined()
    expect(parseMirrorProgressLine('MIRROR_PROGRESS=[1,2,3]')).toBeUndefined()
    expect(parseMirrorProgressLine('MIRROR_PROGRESS="text"')).toBeUndefined()
  })

  it('rejects lines missing percent or stage (keeps the previous progress instead of resetting it)', () => {
    expect(parseMirrorProgressLine('MIRROR_PROGRESS={"stage":"解析固件"}')).toBeUndefined()
    expect(parseMirrorProgressLine('MIRROR_PROGRESS={"percent":null,"stage":"解析固件"}')).toBeUndefined()
    expect(parseMirrorProgressLine('MIRROR_PROGRESS={"percent":10}')).toBeUndefined()
    expect(parseMirrorProgressLine('MIRROR_PROGRESS={"percent":10,"stage":"   "}')).toBeUndefined()
  })
})

describe('parseMirrorResultLine', () => {
  it('parses a successful result line', () => {
    const line = 'MIRROR_RESULT_JSON={"ok":true,"fileName":"OpenHarmony-6.1-Release.zip","fileSize":678912345,"percent":100,"stage":"完成","platformStatus":"已上传 100.00%","message":"上传成功"}'
    expect(parseMirrorResultLine(line)).toEqual({
      ok: true,
      fileName: 'OpenHarmony-6.1-Release.zip',
      fileSize: 678912345,
      percent: 100,
      stage: '完成',
      platformStatus: '已上传 100.00%',
      message: '上传成功',
    })
  })

  it('parses a failure result line with an errorCode', () => {
    expect(parseMirrorResultLine('MIRROR_RESULT_JSON={"ok":false,"errorCode":"LOGIN_FAILED","message":"账号或密码错误"}')).toEqual({
      ok: false,
      errorCode: 'LOGIN_FAILED',
      message: '账号或密码错误',
    })
  })

  it('rejects the line when ok is missing or not a boolean', () => {
    expect(parseMirrorResultLine('MIRROR_RESULT_JSON={"fileName":"a.zip"}')).toBeUndefined()
    expect(parseMirrorResultLine('MIRROR_RESULT_JSON={"ok":"true","message":"x"}')).toBeUndefined()
  })

  it('rejects malformed or non-JSON result lines', () => {
    expect(parseMirrorResultLine('MIRROR_RESULT_JSON={oops')).toBeUndefined()
    expect(parseMirrorResultLine('MIRROR_PROGRESS={"percent":100,"stage":"完成"}')).toBeUndefined()
    expect(parseMirrorResultLine('[MIRROR_RESULT_JSON]')).toBeUndefined()
  })

  it('drops a negative fileSize and clamps an out-of-range percent', () => {
    const result = parseMirrorResultLine('MIRROR_RESULT_JSON={"ok":true,"fileSize":-1,"percent":250}')
    expect(result).toEqual({ ok: true, percent: 100 })
  })
})

describe('mirror upload route', () => {
  it('registers the mirror upload route alongside the existing phase2 routes', () => {
    const { ctx, routes } = fakeContext()
    registerPhase2Routes(ctx, fakeSettings())
    const paths = routes.map((route) => route.path)
    expect(paths).toEqual([
      '/api/ohos-xts-auto-reporter/status',
      '/api/ohos-xts-auto-reporter/settings',
      '/api/ohos-xts-auto-reporter/preflight',
      '/api/ohos-xts-auto-reporter/save',
      '/api/ohos-xts-auto-reporter/waiver/preflight',
      '/api/ohos-xts-auto-reporter/waiver/save',
      '/api/ohos-xts-auto-reporter/waiver/scan',
      '/api/ohos-xts-auto-reporter/mirror/upload',
      '/api/ohos-xts-auto-reporter/paths/derive',
      '/api/ohos-xts-auto-reporter/phase2/drafts',
    ])
    expect(routes.every((route) => route.kind === 'exact')).toBe(true)
    const mirror = routes.find((route) => route.path === '/api/ohos-xts-auto-reporter/mirror/upload')
    expect(typeof mirror?.handler).toBe('function')
  })

  it('rejects non-POST requests with 405', async () => {
    const { ctx, routes } = fakeContext()
    registerPhase2Routes(ctx, fakeSettings())
    const mirror = routes.find((route) => route.path === '/api/ohos-xts-auto-reporter/mirror/upload')!
    const response = await call(mirror.handler, 'GET')
    expect(response.statusCode).toBe(405)
    expect(JSON.parse(response.body)).toEqual({ ok: false, error: '只支持 POST。' })
  })

  it('returns a Chinese error when the mirror path is empty', async () => {
    const { ctx, routes } = fakeContext()
    registerPhase2Routes(ctx, fakeSettings({ mirrorPath: '' }))
    const mirror = routes.find((route) => route.path === '/api/ohos-xts-auto-reporter/mirror/upload')!
    const response = await call(mirror.handler, 'POST', {})
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: false, error: '没有填写镜像固件路径，已停止执行。' })
  })

  it('returns a Chinese error when the mirror path does not exist', async () => {
    const missing = join(tmpdir(), 'ohos-mirror-does-not-exist-xyz')
    const { ctx, routes } = fakeContext()
    registerPhase2Routes(ctx, fakeSettings({ mirrorPath: missing }))
    const mirror = routes.find((route) => route.path === '/api/ohos-xts-auto-reporter/mirror/upload')!
    const response = await call(mirror.handler, 'POST', {})
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: false, error: `镜像固件路径不存在：${missing}` })
  })

  it('answers immediately and reports busy while an upload is running', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ohos-mirror-route-'))
    const firmware = join(directory, 'firmware.zip')
    const created: string[] = []
    try {
      await writeFile(firmware, 'not-a-real-firmware', 'utf8')
      const { ctx, routes } = fakeContext()
      registerPhase2Routes(ctx, fakeSettings({ mirrorPath: firmware }))
      const mirror = routes.find((route) => route.path === '/api/ohos-xts-auto-reporter/mirror/upload')!
      const status = routes.find((route) => route.path === '/api/ohos-xts-auto-reporter/status')!

      // dryRun 不要求账号密码：脚本（或脚本缺失时的失败分支）在后台跑，HTTP 先返回。
      const started = await call(mirror.handler, 'POST', { dryRun: true })
      expect(started.statusCode).toBe(200)
      const startedBody = JSON.parse(started.body)
      expect(startedBody.ok).toBe(true)
      if (typeof startedBody.artifacts === 'string') created.push(startedBody.artifacts)

      const busy = await call(mirror.handler, 'POST', { dryRun: true })
      expect(busy.statusCode).toBe(200)
      expect(JSON.parse(busy.body)).toEqual({ ok: false, error: '正在处理其他任务，请稍后再试。' })

      // 轮询 /status，确认后台任务结束后 phase 收回 idle（前端按钮据此解除禁用）。
      const deadline = Date.now() + 15000
      let snapshot: any = {}
      while (Date.now() < deadline) {
        const response = await call(status.handler, 'GET')
        snapshot = JSON.parse(response.body).state
        if (snapshot.phase === 'idle') break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(snapshot.phase).toBe('idle')
      // 失败也要写 finishedAt 并回到 idle，前端不会永久禁用按钮。
      expect(typeof snapshot.finishedAt).toBe('string')
      // dry-run 走真实脚本时结果行被解析进 state.mirror，/status 原样返回给前端。
      expect(snapshot.ok).toBe(true)
      expect(snapshot.mirror?.fileName).toBe('firmware.zip')
    } finally {
      for (const artifact of created) await rm(artifact, { recursive: true, force: true })
      await rm(directory, { recursive: true, force: true })
    }
  }, 20000)
})
