import { afterEach, describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { derivePaths, WORKBOOK_NAME } from '../src/derive-paths.ts'
import { registerPhase2Routes, type Phase2SettingsPlane } from '../src/phase2-routes.ts'

/**
 * 路径推导的回归锁。
 *
 * 所有 fixture 都在 `os.tmpdir()` 里现建现删：推导全靠目录内容，不能依赖仓库里任何
 * 真实设备目录（CI 上没有 /mnt/d）。真实目录只做人工冒烟，不进单测。
 */

const fixtures: string[] = []

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ohos-derive-paths-'))
  fixtures.push(directory)
  return directory
}

/** 建空文件；`mtime` 用于锁定固件包排序分支（mtime 新的优先）。 */
async function touchFile(path: string, mtime?: string): Promise<void> {
  await writeFile(path, '', 'utf8')
  if (mtime) {
    const date = new Date(mtime)
    await utimes(path, date, date)
  }
}

/** 「完整设备目录」：申请资料 xlsx + exemption/ + 指定固件包。 */
async function deviceDirectory(options: { workbook?: string; archives?: string[] } = {}): Promise<string> {
  const root = await fixture()
  await touchFile(join(root, options.workbook ?? WORKBOOK_NAME))
  await mkdir(join(root, 'exemption'), { recursive: true })
  for (const archive of options.archives ?? []) await touchFile(join(root, archive))
  return root
}

afterEach(async () => {
  while (fixtures.length > 0) {
    const directory = fixtures.pop()!
    await rm(directory, { recursive: true, force: true })
  }
})

describe('derivePaths 输入校验', () => {
  it('rejects empty and whitespace-only input', () => {
    expect(derivePaths('')).toEqual({ ok: false, error: '请先填写 Excel 文件或批量目录。' })
    expect(derivePaths('   \n\t ')).toEqual({ ok: false, error: '请先填写 Excel 文件或批量目录。' })
  })

  it('rejects a path that does not exist and echoes the original input', () => {
    const missing = join(tmpdir(), 'ohos-derive-paths-does-not-exist-xyz')
    expect(derivePaths(missing)).toEqual({ ok: false, error: `路径不存在：${missing}` })
  })

  it('takes the parent directory when the input is a plain file', async () => {
    const root = await fixture()
    const file = join(root, '随便一个文件.txt')
    await touchFile(file)
    const result = derivePaths(file)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.root).toBe(root)
  })
})

describe('derivePaths 工作簿推导', () => {
  it('finds the fixed-name workbook in a directory', async () => {
    const root = await deviceDirectory()
    const result = derivePaths(root)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.root).toBe(root)
    expect(result.workbookPath).toBe(join(root, WORKBOOK_NAME))
  })

  it('falls back to the first renamed copy matching 兼容性申请资料*.xlsx', async () => {
    const root = await fixture()
    await touchFile(join(root, 'OpenHarmony兼容性申请资料-20261101.xlsx'))
    const result = derivePaths(root)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.workbookPath).toBe(join(root, 'OpenHarmony兼容性申请资料-20261101.xlsx'))
    expect(result.warnings).not.toContain(`未找到 ${WORKBOOK_NAME}`)
  })

  it('ignores the ~$ Excel lock file instead of treating it as the workbook', async () => {
    const root = await fixture()
    await touchFile(join(root, `~$${WORKBOOK_NAME}`))
    const result = derivePaths(root)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.workbookPath).toBeUndefined()
    expect(result.warnings).toContain(`未找到 ${WORKBOOK_NAME}`)
  })

  it('returns the input itself when it is the workbook file', async () => {
    const root = await deviceDirectory()
    const workbook = join(root, WORKBOOK_NAME)
    const result = derivePaths(workbook)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.root).toBe(root)
    expect(result.workbookPath).toBe(workbook)
  })

  it('derives the workbook from the directory when the input is another xlsx', async () => {
    const root = await deviceDirectory()
    const other = join(root, 'OpenHarmony设备兼容性规范6.x自检表_标准系统.xlsx')
    await touchFile(other)
    const result = derivePaths(other)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.root).toBe(root)
    expect(result.workbookPath).toBe(join(root, WORKBOOK_NAME))
  })

  it('keeps ok:true with a warning when nothing is found (batch parent directory)', async () => {
    const root = await fixture()
    const result = derivePaths(root)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.root).toBe(root)
    expect(result.workbookPath).toBeUndefined()
    expect(result.waiverPath).toBeUndefined()
    expect(result.mirrorPath).toBeUndefined()
    expect(result.mirrorCandidates).toEqual([])
    expect(result.warnings).toEqual([
      `未找到 ${WORKBOOK_NAME}`,
      '未找到 exemption 目录',
      '未找到 .zip / .7z 固件包',
    ])
  })
})

describe('derivePaths 豁免目录推导', () => {
  it('returns root/exemption when it is a directory', async () => {
    const root = await deviceDirectory()
    const result = derivePaths(root)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.waiverPath).toBe(join(root, 'exemption'))
  })

  it('warns when exemption is missing (or is a file)', async () => {
    const root = await fixture()
    await touchFile(join(root, 'exemption'))
    const result = derivePaths(root)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.waiverPath).toBeUndefined()
    expect(result.warnings).toContain('未找到 exemption 目录')
  })
})

describe('derivePaths 固件包推导', () => {
  it('picks the only dated archive and reports it as a candidate', async () => {
    const root = await deviceDirectory({ archives: ['DH-76AM-KS11C-20261104.7z'] })
    const result = derivePaths(root)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const archive = join(root, 'DH-76AM-KS11C-20261104.7z')
    expect(result.mirrorPath).toBe(archive)
    expect(result.mirrorCandidates).toHaveLength(1)
    expect(result.mirrorCandidates[0]).toEqual({
      path: archive,
      name: 'DH-76AM-KS11C-20261104.7z',
      size: 0,
      modifiedAt: expect.any(String),
    })
    expect(Number.isNaN(Date.parse(result.mirrorCandidates[0].modifiedAt))).toBe(false)
    // 只有一个候选时不该报「发现 N 个固件包」；三条 warning 都不该出现。
    expect(result.warnings).toEqual([])
  })

  it('prefers the archive whose name carries a date over a newer undated one', async () => {
    const root = await deviceDirectory()
    await touchFile(join(root, 'firmware-old-20261001.zip'), '2020-01-01T00:00:00Z')
    await touchFile(join(root, 'firmware-new.zip'), '2026-11-07T00:00:00Z')
    const result = derivePaths(root)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mirrorPath).toBe(join(root, 'firmware-old-20261001.zip'))
    expect(result.mirrorCandidates.map((candidate) => candidate.name)).toEqual([
      'firmware-old-20261001.zip',
      'firmware-new.zip',
    ])
    expect(result.warnings).toContain('发现 2 个固件包，已选 firmware-old-20261001.zip（最新的一个）')
  })

  it('prefers the newer date when both names carry dates', async () => {
    const root = await deviceDirectory()
    await touchFile(join(root, 'board-20260601.zip'), '2026-11-07T00:00:00Z')
    await touchFile(join(root, 'board-20261104.zip'), '2020-01-01T00:00:00Z')
    const result = derivePaths(root)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mirrorPath).toBe(join(root, 'board-20261104.zip'))
  })

  it('uses mtime when no archive name carries a date', async () => {
    const root = await deviceDirectory()
    await touchFile(join(root, 'older.zip'), '2024-05-01T00:00:00Z')
    await touchFile(join(root, 'newer.zip'), '2026-11-07T00:00:00Z')
    const result = derivePaths(root)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mirrorPath).toBe(join(root, 'newer.zip'))
    expect(result.warnings).toContain('发现 2 个固件包，已选 newer.zip（最新的一个）')
  })

  it('accepts every supported archive extension regardless of case', async () => {
    const root = await deviceDirectory()
    await touchFile(join(root, 'a.ZIP'))
    await touchFile(join(root, 'b.7z'))
    await touchFile(join(root, 'c.tar'))
    await touchFile(join(root, 'd.tar.gz'))
    await touchFile(join(root, 'e.tar.bz2'))
    await touchFile(join(root, 'f.tar.xz'))
    const result = derivePaths(root)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mirrorCandidates.map((candidate) => candidate.name).sort()).toEqual([
      'a.ZIP',
      'b.7z',
      'c.tar',
      'd.tar.gz',
      'e.tar.bz2',
      'f.tar.xz',
    ])
  })

  it('ignores images, xlsx and txt files', async () => {
    const root = await deviceDirectory()
    await touchFile(join(root, 'firmware.img'))
    await touchFile(join(root, 'OpenHarmony兼容性测试样品清单.xlsx'))
    await touchFile(join(root, 'report.txt'))
    const result = derivePaths(root)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mirrorPath).toBeUndefined()
    expect(result.mirrorCandidates).toEqual([])
    expect(result.warnings).toContain('未找到 .zip / .7z 固件包')
  })

  it('does not recurse into exemption/ (an archive inside it is not a mirror candidate)', async () => {
    const root = await deviceDirectory()
    await touchFile(join(root, 'exemption', 'evidence.zip'), '2026-11-07T00:00:00Z')
    const result = derivePaths(root)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mirrorCandidates).toEqual([])
  })

  it('reports size and an ISO modifiedAt for every candidate', async () => {
    const root = await deviceDirectory()
    const archive = join(root, 'board-20261104.zip')
    await writeFile(archive, 'firmware-bytes', 'utf8')
    const result = derivePaths(root)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mirrorCandidates[0].size).toBe('firmware-bytes'.length)
    expect(new Date(result.mirrorCandidates[0].modifiedAt).toISOString()).toBe(result.mirrorCandidates[0].modifiedAt)
  })
})

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
  const value: Record<string, unknown> = { username: '', password: '', mirrorPath: '', ...overrides }
  return {
    get: () => value as any,
    merge: async (patch: any) => Object.assign(value, patch),
  } as Phase2SettingsPlane
}

type CapturedResponse = { statusCode: number; body: string }

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

const DERIVE_URL = '/api/ohos-xts-auto-reporter/paths/derive'

function deriveRoute(): CapturedRoute {
  const { ctx, routes } = fakeContext()
  registerPhase2Routes(ctx, fakeSettings())
  return routes.find((route) => route.path === DERIVE_URL)!
}

describe('paths/derive 路由', () => {
  it('registers the derive route exactly once alongside the existing routes', () => {
    const { ctx, routes } = fakeContext()
    registerPhase2Routes(ctx, fakeSettings())
    expect(routes.map((route) => route.path)).toEqual([
      '/api/ohos-xts-auto-reporter/status',
      '/api/ohos-xts-auto-reporter/settings',
      '/api/ohos-xts-auto-reporter/preflight',
      '/api/ohos-xts-auto-reporter/save',
      '/api/ohos-xts-auto-reporter/waiver/preflight',
      '/api/ohos-xts-auto-reporter/waiver/save',
      '/api/ohos-xts-auto-reporter/waiver/scan',
      '/api/ohos-xts-auto-reporter/mirror/upload',
      DERIVE_URL,
    ])
    expect(routes.every((route) => route.kind === 'exact')).toBe(true)
    expect(typeof deriveRoute().handler).toBe('function')
  })

  it('rejects non-POST requests with 405', async () => {
    const response = await call(deriveRoute().handler, 'GET')
    expect(response.statusCode).toBe(405)
    expect(JSON.parse(response.body)).toEqual({ ok: false, error: '只支持 POST。' })
  })

  it('answers HTTP 200 with a Chinese error when no path is given', async () => {
    const response = await call(deriveRoute().handler, 'POST', {})
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: false, error: '请先填写 Excel 文件或批量目录。' })
  })

  it('answers HTTP 200 with a Chinese error when the path does not exist', async () => {
    const missing = join(tmpdir(), 'ohos-derive-route-missing-xyz')
    const response = await call(deriveRoute().handler, 'POST', { workbookPath: missing })
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: false, error: `路径不存在：${missing}` })
  })

  it('derives the defaults for a real directory through the route', async () => {
    const root = await deviceDirectory({ archives: ['DH-76AM-KS11C-20261104.7z'] })
    const response = await call(deriveRoute().handler, 'POST', { workbookPath: root })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.ok).toBe(true)
    expect(body.root).toBe(root)
    expect(body.workbookPath).toBe(join(root, WORKBOOK_NAME))
    expect(body.waiverPath).toBe(join(root, 'exemption'))
    expect(body.mirrorPath).toBe(join(root, 'DH-76AM-KS11C-20261104.7z'))
    expect(body.warnings).toEqual([])
  })

  it('accepts `path` as an alias for `workbookPath`', async () => {
    const root = await deviceDirectory()
    const response = await call(deriveRoute().handler, 'POST', { path: root })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.ok).toBe(true)
    expect(body.root).toBe(root)
  })

  it('keeps ok:true for a batch parent directory with nothing inside', async () => {
    const root = await fixture()
    const response = await call(deriveRoute().handler, 'POST', { workbookPath: root })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.ok).toBe(true)
    expect(body.mirrorCandidates).toEqual([])
    expect(body.warnings).toHaveLength(3)
  })
})
