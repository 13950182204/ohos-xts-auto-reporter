import { existsSync, readdirSync, statSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { posix, win32 } from 'node:path'

/**
 * 本地路径推导（纯函数，不联网、不起子进程、不读 Excel 内容）。
 *
 * 背景：设置页只让用户填一行**目录**（设备目录或批量父目录）。真正要用的却是同一个设备目录下的
 * 三份东西——第二阶段申请资料 xlsx、豁免资料目录 `exemption/`、镜像固件包（zip/7z）。
 * 本模块把这三个默认值从那一行输入推出来，推导不出来时用 `warnings` 说清缺什么，
 * 而不是报错中断（缺一份不影响其余默认值可用）。
 */

/** `POST /api/ohos-xts-auto-reporter/paths/derive` 成功响应体。 */
export interface DerivePathsOk {
  ok: true
  root: string
  workbookPath?: string
  waiverPath?: string
  mirrorPath?: string
  mirrorCandidates: MirrorCandidate[]
  warnings: string[]
}

/** 推导失败（HTTP 仍为 200，与 `/waiver/scan` 一致）。 */
export interface DerivePathsFailure {
  ok: false
  error: string
}

export type DerivePathsResult = DerivePathsOk | DerivePathsFailure

export interface MirrorCandidate {
  path: string
  name: string
  size: number
  /** 文件 mtime，ISO 8601 字符串。 */
  modifiedAt: string
}

/** 第二阶段申请资料的固定文件名（设备目录里通常就是这一个）。 */
export const WORKBOOK_NAME = 'OpenHarmony兼容性申请资料.xlsx'
/** 兜底匹配：`OpenHarmony兼容性申请资料-xxx.xlsx` 之类的改名副本。 */
const WORKBOOK_PATTERN = /兼容性申请资料.*\.xlsx$/i

/** 固件包扩展名；长的在前，避免 `.tar` 抢先匹配 `.tar.gz` 之类（结果相同，只为可读）。 */
export const MIRROR_EXTENSIONS = ['.tar.bz2', '.tar.gz', '.tar.xz', '.tar', '.zip', '.7z'] as const

function isWindowsPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value)
}

/** 输入是 Windows 路径（DSH Desktop 宿主）时用 win32 语义，否则用 posix（WSL 宿主）。 */
function pathApi(value: string): typeof posix {
  return isWindowsPath(value) ? win32 : posix
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** 列出目录一层（不递归）；读不到时返回 undefined，由调用方决定是报错还是当成空目录。 */
function listDirectory(directory: string): Dirent[] | undefined {
  try {
    return readdirSync(directory, { withFileTypes: true })
  } catch {
    return undefined
  }
}

/**
 * 从文件名里取 8 位日期（如 `DH-76AM-KS11C-20261104.7z` → 20261104）。
 * 必须前后都不是数字（避免把更长的数字串截一段当日期），月/日做范围校验。
 */
function dateStampFromName(name: string): number | undefined {
  const match = /(?:^|\D)(\d{8})(?!\d)/.exec(name)
  if (!match) return undefined
  const month = Number(match[1].slice(4, 6))
  const day = Number(match[1].slice(6, 8))
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  return Number(match[1])
}

function isMirrorArchive(name: string): boolean {
  const lower = name.toLowerCase()
  return MIRROR_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

/**
 * 固件包排序：① 文件名含 8 位日期的优先；② 日期新的优先；③ mtime 新的优先。
 * 最后用文件名兜底，保证同一目录多次推导得到同一个结果。
 */
function compareMirrorCandidates(left: MirrorCandidate, right: MirrorCandidate): number {
  const leftDate = dateStampFromName(left.name)
  const rightDate = dateStampFromName(right.name)
  if (leftDate !== undefined && rightDate !== undefined && leftDate !== rightDate) return rightDate - leftDate
  if (leftDate !== undefined && rightDate === undefined) return -1
  if (leftDate === undefined && rightDate !== undefined) return 1
  const mtimeDiff = Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt)
  if (mtimeDiff !== 0) return mtimeDiff
  return left.name.localeCompare(right.name)
}

/**
 * 根据用户填的那一行推导各路径默认值。
 *
 * - 空输入 / 路径不存在 → `{ ok:false, error }`；
 * - 输入是目录 → `root` 就是它；输入是文件 → `root` 是它所在目录。
 *
 * 推导不到的东西不报错，只在 `warnings` 里给中文说明。
 */
export function derivePaths(input: string): DerivePathsResult {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: '请先填写设备目录（或批量父目录）。' }

  let stats: ReturnType<typeof statSync>
  try {
    stats = statSync(trimmed)
  } catch {
    return { ok: false, error: `路径不存在：${input}` }
  }

  const api = pathApi(trimmed)
  let root: string
  /** 输入本身就是申请资料 xlsx 时直接返回它，不再去目录里重找。 */
  let directWorkbook: string | undefined
  if (stats.isDirectory()) {
    root = trimmed
  } else if (stats.isFile()) {
    root = api.dirname(trimmed)
    const name = api.basename(trimmed)
    // `~$` 是 Excel 打开文件时留下的锁文件，名字像但不是工作簿。
    if (WORKBOOK_PATTERN.test(name) && !name.startsWith('~$')) directWorkbook = trimmed
  } else {
    return { ok: false, error: `路径不是文件或目录：${input}` }
  }

  const entries = listDirectory(root)
  if (!entries) return { ok: false, error: `无法读取目录：${root}` }

  const warnings: string[] = []
  const files = entries.filter((entry) => entry.isFile())

  let workbookPath = directWorkbook
  if (!workbookPath) {
    if (files.some((entry) => entry.name === WORKBOOK_NAME)) {
      workbookPath = api.join(root, WORKBOOK_NAME)
    } else {
      const fallback = files
        .map((entry) => entry.name)
        .filter((name) => !name.startsWith('~$') && WORKBOOK_PATTERN.test(name))
        .sort((left, right) => left.localeCompare(right))[0]
      if (fallback) workbookPath = api.join(root, fallback)
      else warnings.push(`未找到 ${WORKBOOK_NAME}`)
    }
  }

  const exemptionPath = api.join(root, 'exemption')
  const waiverPath = isDirectory(exemptionPath) ? exemptionPath : undefined
  if (!waiverPath) warnings.push('未找到 exemption 目录')

  const mirrorCandidates: MirrorCandidate[] = []
  for (const entry of files) {
    if (!isMirrorArchive(entry.name)) continue
    const path = api.join(root, entry.name)
    try {
      const fileStats = statSync(path)
      mirrorCandidates.push({
        path,
        name: entry.name,
        size: fileStats.size,
        modifiedAt: fileStats.mtime.toISOString(),
      })
    } catch {
      // 单个候选读不到（权限/竞态）不影响其余推导，直接跳过。
    }
  }
  // 排序后第一个就是选中项，`mirrorCandidates` 也按同一优先级返回，前端可原样展示。
  mirrorCandidates.sort(compareMirrorCandidates)
  const mirrorPath = mirrorCandidates[0]?.path
  if (mirrorCandidates.length > 1) {
    warnings.push(`发现 ${mirrorCandidates.length} 个固件包，已选 ${mirrorCandidates[0].name}（最新的一个）`)
  } else if (mirrorCandidates.length === 0) {
    warnings.push('未找到 .zip / .7z 固件包')
  }
  // `existsSync` 只在这里做一次显式存在性复核，避免 stat/readdir 之间的竞态把不存在的路径交给前端。
  const confirmedMirrorPath = mirrorPath && existsSync(mirrorPath) ? mirrorPath : undefined

  return {
    ok: true,
    root,
    ...(workbookPath ? { workbookPath } : {}),
    ...(waiverPath ? { waiverPath } : {}),
    ...(confirmedMirrorPath ? { mirrorPath: confirmedMirrorPath } : {}),
    mirrorCandidates,
    warnings,
  }
}
