#!/usr/bin/env node
/**
 * 把本插件装进 **DSH Desktop** 的 profile（默认 `desktop`），并做安装后自检。
 *
 * 用法（Windows 侧 Node 20+ 即可）：
 *   node <repo>/scripts/desktop-reinstall.mjs [--profile desktop] [--dry-run] [--no-install]
 *
 * 也可以从 WSL 直接用桌面自带运行时调用（本仓库就在 WSL 里时最方便）：
 *   "<...>/resources/runtime/primary-runtime/dependencies/node/bin/node.exe" \
 *     <repo>/scripts/desktop-reinstall.mjs
 *
 * 为什么不是 `dsh plugin --profile desktop add …`：
 * 桌面 profile 由 Electron 应用独占管理，CLI 会直接拒绝
 * （`profile "desktop" is managed exclusively by the Electron application`）。
 * 因此按先例（openharmony-debug-test-pipeline/scripts/desktop-reinstall.mjs）走
 * 「直接改 profile 清单 + 自行 pnpm install」这条路。
 *
 * 三个已实测的坑，本脚本都做了防护：
 * 1. **GitHub URL 安装不构建**：`main` 指向 `lib/`，若仓库里没有产物（或产物过期），
 *    装出来的包入口指向不存在的文件、插件静默失效。本仓库已把 `lib/` 入库（见 .gitignore），
 *    本脚本打包前不构建，但会自检产物是否齐全。
 * 2. **pnpm 对同名 `file:` tarball 不重新解包**：同一路径换了内容，`pnpm install` 仍报
 *    “Already up to date”（`--force` 也不行）→ 手里永远是旧代码。因此 tarball 名带内容哈希：
 *    `<name>-<version>-<sha256 前 8 位>.tgz`，内容一变文件名就变。
 * 3. **PATH 必须显式补上 node 的 bin 目录**：DSH Desktop 的 pnpm 派生子进程时不会把 node
 *    放进子环境 PATH，依赖的 postinstall 会报 `'node' 不是内部或外部命令`。只补
 *    `…/dependencies/node/bin`，**绝不把 Node 根目录加进 PATH**——Node 根目录同时含
 *    `bash.exe`/`wsl.exe`，会顶掉 WSL 的 bash（会话里的 bash 工具直接坏掉）。
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ARGV = process.argv.slice(2)
const dryRun = ARGV.includes('--dry-run')
const skipInstall = ARGV.includes('--no-install')
const profileIndex = ARGV.indexOf('--profile')
const profile = profileIndex >= 0 ? ARGV[profileIndex + 1] : 'desktop'

/** 桌面自带运行时里 node / pnpm 的位置。 */
function resolveRuntime() {
  const candidates = [
    process.env.LOCALAPPDATA,
    join('C:', 'Users', process.env.USERNAME ?? '', 'AppData', 'Local'),
  ]
  for (const base of candidates) {
    if (!base) continue
    const runtime = join(base, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'primary-runtime', 'dependencies')
    const node = join(runtime, 'node', 'bin', 'node.exe')
    const pnpm = join(runtime, 'pnpm', 'bin', 'pnpm.cjs')
    if (existsSync(node) && existsSync(pnpm)) return { node, pnpm, nodeBin: dirname(node) }
  }
  return undefined
}

/** 打 tar 包；`cwd` 用仓库路径（WSL 下是 UNC，pnpm 能处理）。 */
function pack(runtime, destination) {
  const result = spawnSync(runtime.node, [runtime.pnpm, 'pack', '--pack-destination', destination], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 300_000,
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    throw new Error(`pnpm pack 失败（exit ${String(result.status)}）`)
  }
  const produced = readdirSync(destination).filter((name) => name.endsWith('.tgz'))
  if (produced.length !== 1) throw new Error(`pnpm pack 产物异常：${produced.join(', ') || '（空）'}`)
  return join(destination, produced[0])
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** `file:` 依赖在 package.json 里用正斜杠的 Windows 绝对路径。 */
function fileSpecifier(file) {
  return `file:${resolve(file).replace(/\\/g, '/')}`
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** 从插件入口解析依赖：非 DSH 依赖必须真解析得到。 */
function resolveProbe(runtime, entry, packages) {
  const probe = `${entry}.resolve-probe.mjs`
  writeFileSync(
    probe,
    `import { createRequire } from 'node:module'\n`
    + `const require = createRequire(${JSON.stringify(entry)})\n`
    + `const missing = []\n`
    + `for (const name of ${JSON.stringify(packages)}) { try { require.resolve(name + '/package.json') } catch { missing.push(name) } }\n`
    + `console.log(JSON.stringify(missing))\n`,
    'utf8',
  )
  try {
    const result = spawnSync(runtime.node, [probe], { encoding: 'utf8' })
    const line = (result.stdout ?? '').trim().split('\n').pop() ?? '[]'
    return JSON.parse(line)
  } finally {
    rmSync(probe, { force: true })
  }
}

const manifest = readJson(join(REPO, 'package.json'))
const name = manifest.name
const version = manifest.version
const dshHome = join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profile)
const storeDir = join(dshHome, 'plugins')

if (!existsSync(join(profileDir, 'package.json'))) {
  console.error(`找不到 profile：${profileDir}`)
  console.error('若还没创建过，先在桌面 App 里用它自己的「插件」页安装一次任意插件，或确认 profile 名。')
  process.exit(1)
}

const runtime = resolveRuntime()
if (!runtime) {
  console.error('找不到 DSH Desktop 自带的运行时（期望 …/resources/runtime/primary-runtime/dependencies）。')
  process.exit(1)
}

console.log(`repo      : ${REPO}`)
console.log(`plugin    : ${name}@${version}`)
console.log(`profile   : ${profileDir}`)
console.log(`runtime   : ${runtime.node}`)

// 1) 打包：先打到临时目录算内容哈希，再按内容命名放进 ~/.dsh/plugins。
//    内容一变文件名就变，pnpm 才会真的重新解包。
const staging = mkdtempSync(join(tmpdir(), 'ohos-xts-pack-'))
let tarball
try {
  const packed = pack(runtime, staging)
  const digest = sha256(packed).slice(0, 8)
  const finalName = `${name}-${version}-${digest}.tgz`
  tarball = join(storeDir, finalName)
  console.log(`tarball   : ${tarball}`)
  if (dryRun) {
    console.log('[dry-run] 跳过复制与安装')
    process.exit(0)
  }
  if (!existsSync(storeDir)) {
    console.log(`创建插件目录：${storeDir}`)
    writeFileSync(join(storeDir, '.keep'), '', 'utf8')
  }
  if (existsSync(tarball)) {
    console.log('同内容 tarball 已存在，复用。')
  } else {
    copyFileSync(packed, tarball)
    console.log('已写入 tarball。')
  }
} finally {
  rmSync(staging, { recursive: true, force: true })
}

// 2) 清单：登记依赖 + 确保进 bundles（少了 bundles 插件不会加载）。
const manifestPath = join(profileDir, 'package.json')
const profileManifest = readJson(manifestPath)
const backup = `${manifestPath}.bak-xts-reinstall`
copyFileSync(manifestPath, backup)
profileManifest.dependencies ??= {}
profileManifest.dependencies[name] = fileSpecifier(tarball)
profileManifest.dsh ??= {}
profileManifest.dsh.profile ??= {}
const bundles = (profileManifest.dsh.profile.bundles ??= [])
if (!bundles.includes(name)) bundles.push(name)
writeFileSync(manifestPath, `${JSON.stringify(profileManifest, null, 2)}\n`, 'utf8')
console.log(`清单已更新（备份：${backup}），bundles=${String(bundles.length)}`)

// 3) 安装（PATH 只补 node 的 bin 目录，见文件头第 3 条）。
if (!skipInstall) {
  const install = spawnSync(runtime.node, [runtime.pnpm, 'install'], {
    cwd: profileDir,
    stdio: 'inherit',
    env: { ...process.env, PATH: `${runtime.nodeBin};${process.env.PATH ?? ''}` },
  })
  console.log(`install exit = ${String(install.status)}`)
  if (install.status !== 0) process.exitCode = 1
}

// 4) 自检
const installedDir = join(profileDir, 'node_modules', name)
const entry = join(installedDir, 'lib', 'index.js')
if (!existsSync(entry)) {
  console.error(`✗ 插件未就位：${entry}`)
  process.exit(1)
}
const installedVersion = readJson(join(installedDir, 'package.json')).version
console.log(`${installedVersion === version ? '✓' : '✗ 版本不符'} 已安装 ${name}@${installedVersion}（仓库 ${version}）`)
if (installedVersion !== version) process.exitCode = 1

for (const relative of ['lib/client.js', 'lib/settings-store.js', 'scripts/phase2_logic.mjs', 'scripts/preflight_phase2.mjs', 'skills/openharmony-waiver-draft/SKILL.md']) {
  const present = existsSync(join(installedDir, relative))
  console.log(`${present ? '✓' : '✗ 缺失'} ${relative}`)
  if (!present) process.exitCode = 1
}

// 非 DSH 依赖必须能解析；@deepseek-ai/* 由桌面 profile 的运行时解析提供
// （profile 里通常没有副本，普通 node 进程解析不到属正常，插件行内导入仍可用）。
const localDeps = Object.keys(readJson(join(installedDir, 'package.json')).dependencies ?? {})
const missingLocal = resolveProbe(runtime, entry, localDeps)
console.log(`${missingLocal.length === 0 ? '✓' : '✗ 无法解析'} 本地依赖：${localDeps.join(', ')}`)
if (missingLocal.length > 0) {
  console.error(`✗ 缺失本地依赖：${missingLocal.join(', ')}`)
  process.exitCode = 1
}

const dshPeers = Object.keys(readJson(join(installedDir, 'package.json')).peerDependencies ?? {})
const missingPeers = resolveProbe(runtime, entry, dshPeers)
console.log(`ℹ DSH peer（由运行时解析提供）${dshPeers.length} 个；普通 node 进程中解析不到的：${missingPeers.length === 0 ? '（无）' : missingPeers.join(', ')}`)

if (!readJson(manifestPath).dsh.profile.bundles.includes(name)) {
  console.error(`✗ bundles 未包含 ${name}`)
  process.exitCode = 1
}

console.log(process.exitCode === 1 ? '\n自检未通过，请看上面的 ✗ 行。' : '\n自检通过。重启 DSH Desktop 后生效（设置 → 插件 → 会看到「XTS报告上传」页）。')
console.log('设置存储：' + join(dshHome, 'ohos-xts-auto-reporter.json') + '（首次启动会从旧 ~/.dsh/settings.yaml 的 ohos-xts-auto-reporter 段迁移一次）')
