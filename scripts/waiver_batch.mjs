#!/usr/bin/env node
/**
 * 豁免资料批量处理：从指定路径（目录或单个 .txt）解析豁免报告，逐条调用
 * `waiver_draft.mjs` 保存草稿。只保存，不提交。
 *
 * 用法：
 *   node scripts/waiver_batch.mjs --input <目录或.txt> --assessment <测评编号> \
 *     [--dry-run|--save] [--artifacts <目录>]
 *   node scripts/waiver_batch.mjs --input <目录或.txt> --scan
 *
 * 测试套分类不再人工传入：按豁免资料目录结构（Acts / ActsValidator / Hats / Dcts / Ssts）
 * 自动识别，目录识别不到再看报告首部「测试报告：ACTS 全量报告 …」兜底。
 *
 * 输出协议（与第二阶段批量一致，设置卡片直接复用进度/逐项列表）：
 *   PHASE2_BATCH_INIT=<json>
 *   PHASE2_PROGRESS=<json>
 *   PHASE2_BATCH_ITEM_RESULT=<json>
 *   PHASE2_RESULT_JSON=<json>   （最后一行）
 * --scan 只解析、不联网、不要求 --assessment，末行输出（也是唯一的 JSON 行）：
 *   WAIVER_SCAN_JSON=<json>     （单行、可直接 JSON.parse；扫描失败也 exit 0）
 *
 * 凭据从环境变量 OH_USERNAME / OH_PASSWORD 继承（由 Host 从设置页注入），
 * 不落盘、不打印。
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { detectTestCategory, submissionPathFor } from './waiver_logic.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'waiver_draft.mjs')
const CASE_RE = /(?:^|[-*]\s*)([A-Za-z0-9_]+)#([A-Za-z0-9_]+)#(.+?)\s*$/
const RESULT_PREFIX = 'WAIVER_RESULT_JSON='

function parseArgs(argv) {
  const options = { dryRun: true, save: false, scan: false, input: '', assessment: '', artifacts: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${argument} 缺少取值`)
      index += 1
      return value
    }
    if (argument === '--dry-run') {
      options.dryRun = true
      options.save = false
    } else if (argument === '--save') {
      options.dryRun = false
      options.save = true
    } else if (argument === '--scan') options.scan = true
    else if (argument === '--input') options.input = next()
    else if (argument === '--assessment') options.assessment = next()
    else if (argument === '--artifacts') options.artifacts = next()
    else if (argument === '--help' || argument === '-h') options.help = true
    else throw new Error(`未知参数：${argument}`)
  }
  if (!options.help && !options.input) throw new Error('缺少 --input')
  // 扫描只解析资料，不需要测评编号；保存/预检仍然必须人工提供。
  if (!options.help && !options.scan && !options.assessment.trim()) throw new Error('缺少 --assessment')
  return options
}

function stamp() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

async function listReports(input) {
  const status = await fs.stat(input).catch(() => null)
  if (!status) throw new Error(`路径不存在：${input}`)
  if (status.isFile()) return [input]
  if (!status.isDirectory()) throw new Error(`路径既不是文件也不是目录：${input}`)
  const found = []
  const walk = async (directory) => {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(directory, entry.name)
      // evidence/ 放的是佐证日志，不是豁免报告；不要当成报告去创建草稿。
      if (entry.isDirectory()) {
        if (entry.name !== 'evidence') await walk(full)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.txt')) {
        found.push(full)
      }
    }
  }
  await walk(input)
  return found
}

/** 按路径排序（code unit 比较，跨机器稳定），保证扫描/批量的输出顺序固定。 */
function sortByPath(reports) {
  return [...reports].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return ''
  }
}

/** 扫描根：目录输入就是该目录；单文件输入取「识别到的分类目录的父目录」。 */
async function resolveScanRoot(inputPath) {
  const status = await fs.stat(inputPath).catch(() => null)
  if (!status) throw new Error(`路径不存在：${inputPath}`)
  if (status.isDirectory()) return inputPath
  const reportText = await readText(inputPath)
  const detected = detectTestCategory({ reportPath: inputPath, reportText })
  return detected.categoryDirectory ? path.dirname(detected.categoryDirectory) : path.dirname(inputPath)
}

function unknownCategoryMessage(reportPath) {
  return `无法识别测试套分类：${reportPath}（目录应为 Acts/ActsValidator/Hats/Dcts/Ssts，或报告首部含『测试报告：ACTS …』）`
}

/**
 * 单份报告的分类上下文：分类在解析前识别好再交给 parseReport；
 * submissionPath 由扫描根推导（不解析正文里「平台提交路径」那行模板占位符）。
 */
async function reportContext(reportPath, scanRoot) {
  const reportText = await readText(reportPath)
  const detected = detectTestCategory({ reportPath, rootPath: scanRoot, reportText })
  // 提交路径的基准是「分类目录的父目录」而不是参数里的扫描根：用户可能只从 Acts/ 子目录
  // 发起扫描，但平台要的永远是 Acts/<模块>/<套件>.txt 这种带分类的路径。
  const pathRoot = detected.categoryDirectory ? path.dirname(detected.categoryDirectory) : scanRoot
  return {
    testCategory: detected.testCategory,
    categoryFolder: detected.categoryFolder,
    submissionPath: submissionPathFor({ rootPath: pathRoot, reportPath }),
  }
}

function cleanText(lines) {
  return lines.map((line) => line.trim().replace(/^[-*]\s*/, '')).filter(Boolean).join(' ').trim()
}

function splitSections(lines) {
  const sections = {}
  let current = null
  for (const line of lines) {
    const match = /^\s*([123])\.\s+/.exec(line)
    if (match) {
      current = Number(match[1])
      sections[current] = []
      continue
    }
    if (current !== null) sections[current].push(line)
  }
  return sections
}

const TRAILING_NOTE_RE = /[（(][^（）()]*[)）]\s*$/
const EVIDENCE_RE = /^-\s+(evidence\/[^\s：:]+)/
const ZIP_SUFFIX = '-豁免材料.zip'

function parseCases(lines) {
  const cases = []
  for (const line of lines) {
    const match = CASE_RE.exec(line.trim())
    if (!match) continue
    // 用例行允许「（报告耗时 x s）」尾注；提交给平台的 Testcase 只要裸用例名。
    const testcase = match[3].replace(TRAILING_NOTE_RE, '').trim()
    cases.push({ module: match[1], testsuite: match[2], testcase })
  }
  return cases
}

function referencedEvidence(lines) {
  const refs = []
  for (const line of lines) {
    const match = EVIDENCE_RE.exec(line.trim())
    if (match && !refs.includes(match[1])) refs.push(match[1])
  }
  return refs
}

/**
 * 豁免资料布局校验（与闭环插件 scripts/verify_waiver_layout.py 同一套规则）：
 * 一个模块的一个 Testsuite = 一个 <套件>.txt + 一个 <套件>-豁免材料.zip。
 */
async function checkLayout(reportPath, moduleName, testsuite, evidenceRefs) {
  const problems = []
  const directory = path.dirname(reportPath)
  const expectedName = `${testsuite}.txt`
  if (path.basename(reportPath) !== expectedName) {
    problems.push(`文件名应为 ${expectedName}（当前 ${path.basename(reportPath)}）`)
  }
  // 两种都是合法布局：<分类>/<模块>/<套件>.txt（Acts）与
  // <分类>/<套件>/<套件>.txt（ActsValidator，用例第一段是分类名、目录名等于套件名）。
  const directoryName = path.basename(directory)
  if (directoryName !== moduleName && directoryName !== testsuite) {
    problems.push(`父目录应为模块名或套件名 ${moduleName}/${testsuite}（当前 ${directoryName}）`)
  }
  const archive = path.join(directory, `${testsuite}${ZIP_SUFFIX}`)
  const archiveStat = await fs.stat(archive).catch(() => null)
  const hasArchive = archiveStat?.isFile() === true
  // 附件规则：优先用 <套件>-豁免材料.zip；没有 zip 时直接把本份报告 .txt 当附件上传
  // （平台接受单个 txt 作为豁免材料，见 2026-11-06 用户确认）。因此缺 zip 不再是阻塞项。
  const attachmentPath = hasArchive ? archive : path.resolve(reportPath)
  const attachmentKind = hasArchive ? 'zip' : 'txt'
  for (const ref of evidenceRefs) {
    const target = path.join(directory, ref)
    const stat = await fs.stat(target).catch(() => null)
    if (!stat?.isFile()) problems.push(`佐证文件不存在：${ref}`)
  }
  return { problems, attachmentPath, attachmentKind, archive, archiveStat }
}

/**
 * 解析一份豁免报告，但把「解析问题」与「布局问题」分开收集而不是直接抛：
 * 扫描模式要把它们收进 items[].problems[]（设置页要能预览这份资料哪里不对）；
 * 批量模式仍由 parseReport 抛出并中止。
 */
async function inspectReport(reportPath, assessment, testCategory) {
  const text = await fs.readFile(reportPath, 'utf8')
  const lines = text.split(/\r?\n/)
  const sections = splitSections(lines)
  const cases = parseCases(sections[1] ?? [])
  const parseProblems = []
  if (cases.length === 0) parseProblems.push(`报告里没有失败用例：${reportPath}`)
  const first = cases[0] ?? { module: '', testsuite: '' }
  if (cases.some((item) => item.module !== first.module || item.testsuite !== first.testsuite)) {
    parseProblems.push(`同一报告里混有不同模块/测试套：${reportPath}（一个 .txt 只能是一个模块的一个 Testsuite，请拆分文件）`)
  }
  const reason = cleanText(sections[3] ?? []) || cleanText(sections[2] ?? [])
  if (!reason) parseProblems.push(`报告缺少豁免原因：${reportPath}`)
  const evidenceRefs = referencedEvidence(sections[1] ?? [])
  const layout = first.module && first.testsuite
    ? await checkLayout(reportPath, first.module, first.testsuite, evidenceRefs)
    : { problems: [], attachmentPath: path.resolve(reportPath), attachmentKind: 'txt' }
  return {
    record: {
      assessmentNumber: assessment,
      testCategory,
      moduleName: first.module,
      testsuite: first.testsuite,
      testcases: cases.map((item) => item.testcase),
      caseCount: cases.length,
      waiverReason: reason,
      attachmentPath: layout.attachmentPath,
      attachmentKind: layout.attachmentKind,
      evidenceRelative: evidenceRefs,
      sourceReport: path.resolve(reportPath),
    },
    parseProblems,
    layoutProblems: layout.problems,
  }
}

/**
 * 单个 .txt → 一条记录；与 process_directory.py 的解析规则一致。
 * 分类必须已由调用方识别好传入（不再读 `--test-category`）。
 */
async function parseReport(reportPath, assessment, testCategory) {
  const { record, parseProblems, layoutProblems } = await inspectReport(reportPath, assessment, testCategory)
  if (parseProblems.length > 0) throw new Error(parseProblems[0])
  if (layoutProblems.length > 0) {
    throw new Error(`豁免资料布局不符合规范：${layoutProblems.join('；')}（${reportPath}）`)
  }
  return record
}

function scanItemFor(reportPath) {
  return {
    sourceReport: path.resolve(reportPath),
    categoryFolder: '',
    testCategory: '',
    moduleName: '',
    testsuite: '',
    caseCount: 0,
    testcases: [],
    attachmentPath: '',
    attachmentKind: 'txt',
    evidenceRelative: [],
    submissionPath: '',
    ready: false,
    problems: [],
  }
}

/** --scan：逐份报告输出结构性信息；识别/解析/布局问题都收进 problems[]，不抛错。 */
async function scanReports(reports, { scanRoot, assessment }) {
  const items = []
  for (const reportPath of reports) {
    const item = scanItemFor(reportPath)
    const context = await reportContext(reportPath, scanRoot)
    item.categoryFolder = context.categoryFolder
    item.testCategory = context.testCategory
    item.submissionPath = context.submissionPath
    if (!context.testCategory) item.problems.push(unknownCategoryMessage(reportPath))
    try {
      const inspection = await inspectReport(reportPath, assessment, context.testCategory)
      item.moduleName = inspection.record.moduleName
      item.testsuite = inspection.record.testsuite
      item.caseCount = inspection.record.caseCount
      item.testcases = inspection.record.testcases
      item.attachmentPath = inspection.record.attachmentPath
      item.attachmentKind = inspection.record.attachmentKind
      item.evidenceRelative = inspection.record.evidenceRelative
      item.problems.push(...inspection.parseProblems, ...inspection.layoutProblems)
    } catch (error) {
      item.problems.push(String(error && error.message ? error.message : error))
    }
    item.ready = item.testCategory !== '' && item.problems.length === 0
    items.push(item)
  }
  return items
}

function scanSummary(items) {
  const byCategory = {}
  for (const item of items) {
    if (!item.testCategory) continue
    byCategory[item.testCategory] = (byCategory[item.testCategory] ?? 0) + 1
  }
  const ready = items.filter((item) => item.ready).length
  return { total: items.length, ready, blocked: items.length - ready, byCategory }
}

function parseChildResult(output) {
  const lines = output.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (!line.startsWith(RESULT_PREFIX)) continue
    try {
      const parsed = JSON.parse(line.slice(RESULT_PREFIX.length))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {
      // 继续向前找
    }
  }
  return undefined
}

async function runOne(record, itemDir, options) {
  const inputFile = path.join(itemDir, 'input.json')
  await fs.writeFile(inputFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  const args = [SCRIPT, '--input', inputFile, options.dryRun ? '--dry-run' : '--save', '--artifacts', itemDir]
  const completed = spawnSync(process.execPath, args, {
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  })
  const output = `${completed.stdout ?? ''}${completed.stderr ? `\n${completed.stderr}` : ''}`.trim()
  return { code: completed.status ?? 1, output, result: parseChildResult(output) }
}

function emit(line, value) {
  process.stdout.write(`${line}=${JSON.stringify(value)}\n`)
}

/**
 * --scan：只解析不联网；参数错误由 parseArgs 以退出码 2 结束，其余情况一律 exit 0。
 * `WAIVER_SCAN_JSON=` 必须是最后一行、单行、可直接 JSON.parse（items 按路径排序）。
 */
async function scanMode(options) {
  const inputPath = path.resolve(options.input)
  try {
    const scanRoot = await resolveScanRoot(inputPath)
    const reports = sortByPath(await listReports(inputPath))
    const items = await scanReports(reports, { scanRoot, assessment: options.assessment.trim() })
    emit('WAIVER_SCAN_JSON', { ok: true, root: scanRoot, items, summary: scanSummary(items) })
  } catch (error) {
    // 扫描是设置页的预览：任何读取/解析异常都转成 ok:false 的单行 JSON，进程仍 exit 0。
    emit('WAIVER_SCAN_JSON', {
      ok: false,
      root: inputPath,
      items: [],
      summary: { total: 0, ready: 0, blocked: 0, byCategory: {} },
      error: String(error && error.message ? error.message : error),
    })
  }
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(String(error && error.message ? error.message : error))
    process.exitCode = 2
    return
  }
  if (options.help) {
    console.log('node scripts/waiver_batch.mjs --input <目录或.txt> --assessment <测评编号> [--dry-run|--save] [--artifacts <目录>]')
    console.log('node scripts/waiver_batch.mjs --input <目录或.txt> --scan')
    return
  }
  if (options.scan) {
    await scanMode(options)
    return
  }
  const artifactsRoot = options.artifacts
    ? path.resolve(options.artifacts)
    : path.join(os.tmpdir(), `oh-waiver-batch-${stamp()}`)
  await fs.mkdir(artifactsRoot, { recursive: true })

  const inputPath = path.resolve(options.input)
  let scanRoot
  let reports
  try {
    scanRoot = await resolveScanRoot(inputPath)
    reports = sortByPath(await listReports(inputPath))
  } catch (error) {
    console.error(`读取豁免资料失败：${error.message}`)
    process.exitCode = 1
    return
  }
  if (reports.length === 0) {
    console.error(`目录里没有 .txt 豁免报告：${options.input}`)
    process.exitCode = 1
    return
  }

  const items = reports.map((report, index) => ({
    directory: artifactsRoot,
    workbookPath: report,
    name: path.basename(report, '.txt'),
    taskIndex: index + 1,
    status: 'pending',
    percent: 0,
    stage: '待处理',
    detail: report,
  }))
  const results = []
  emit('PHASE2_BATCH_INIT', {
    mode: 'batch',
    kind: 'waiver',
    rootPath: inputPath,
    taskCount: items.length,
    skippedCount: 0,
    items,
  })
  emit('PHASE2_PROGRESS', {
    percent: 1,
    stage: '解析豁免资料',
    detail: `共 ${items.length} 份 .txt 报告`,
    itemIndex: 0,
    itemTotal: items.length,
    itemPercent: 0,
  })

  let failed = 0
  for (let index = 0; index < reports.length; index += 1) {
    const report = reports[index]
    const item = items[index]
    const itemDir = path.join(artifactsRoot, String(index + 1).padStart(3, '0'))
    await fs.mkdir(itemDir, { recursive: true })
    item.percent = 5
    item.stage = '解析报告'

    // 分类逐条识别：先算好 testCategory / submissionPath，再解析正文。
    const context = await reportContext(report, scanRoot)
    item.testCategory = context.testCategory
    item.submissionPath = context.submissionPath
    emit('PHASE2_BATCH_ITEM_RESULT', { ...item, percent: 5 })

    if (!context.testCategory) {
      item.status = 'blocked'
      item.percent = 100
      item.stage = '解析失败'
      item.detail = unknownCategoryMessage(report)
      failed += 1
      emit('PHASE2_BATCH_ITEM_RESULT', { ...item })
      results.push({ ...item, code: 'REPORT_PARSE_FAILED', message: item.detail })
      break
    }

    let record
    try {
      record = await parseReport(report, options.assessment.trim(), context.testCategory)
      record.submissionPath = context.submissionPath
    } catch (error) {
      item.status = 'blocked'
      item.percent = 100
      item.stage = '解析失败'
      item.detail = String(error.message)
      failed += 1
      emit('PHASE2_BATCH_ITEM_RESULT', { ...item })
      results.push({ ...item, code: 'REPORT_PARSE_FAILED', message: item.detail })
      break
    }
    item.name = `${record.moduleName}#${record.testsuite}`
    item.assessmentNumber = record.assessmentNumber
    item.percent = 20
    item.stage = options.dryRun ? '登录并预检' : '登录并保存草稿'
    emit('PHASE2_BATCH_ITEM_RESULT', { ...item })
    emit('PHASE2_PROGRESS', {
      percent: Math.max(1, Math.round((index / reports.length) * 100)),
      stage: `第 ${index + 1}/${reports.length} 条：${item.stage}`,
      detail: `${record.moduleName}#${record.testsuite}（${record.testcases.length} 条用例）`,
      itemIndex: index + 1,
      itemTotal: reports.length,
      itemPercent: 20,
      workbookPath: report,
    })

    const outcome = await runOne(record, itemDir, options)
    const result = outcome.result ?? {}
    const derived = result.derived && typeof result.derived === 'object' ? result.derived : {}
    item.percent = 100
    if (outcome.code === 0 && (result.status === 'saved' || result.status === 'preflight-complete')) {
      item.status = result.status === 'saved' ? 'saved' : 'preflight'
      item.stage = result.status === 'saved' ? '已保存草稿' : '预检通过'
      item.detail = [derived.systemTypeName, derived.systemVersionName].filter(Boolean).join(' / ')
      if (result.status === 'saved') {
        item.message = result.message
      }
    } else if (result.status === 'stopped' && ['PENDING_DUPLICATE_FOUND', 'EXISTING_WAIVER_UNDER_REVIEW', 'EXISTING_WAIVER_APPROVED'].includes(result.code)) {
      item.status = 'skipped'
      item.stage = '已存在同键记录，跳过'
      item.detail = `${result.code}: ${result.message || ''}`
    } else {
      item.status = 'blocked'
      item.stage = '失败'
      item.detail = `${result.code || 'UNKNOWN'}: ${result.message || outcome.output.slice(-500)}`
      failed += 1
    }
    results.push({ ...item, code: result.code, message: result.message, artifacts: result.artifacts })
    emit('PHASE2_BATCH_ITEM_RESULT', { ...item, percent: 100, stage: item.stage, detail: item.detail })
    emit('PHASE2_PROGRESS', {
      percent: Math.max(1, Math.round(((index + 1) / reports.length) * 100)),
      stage: item.stage,
      detail: `${item.name}：${item.detail || ''}`,
      itemIndex: index + 1,
      itemTotal: reports.length,
      itemPercent: 100,
      workbookPath: report,
    })
    if (failed > 0) break
  }

  const summary = {
    ok: failed === 0,
    status: failed > 0 ? 'blocked' : (options.dryRun ? 'preflight-complete' : 'saved'),
    kind: 'waiver',
    mode: 'batch',
    action: options.dryRun ? 'none' : 'save-draft',
    assessmentNumber: options.assessment.trim(),
    artifacts: artifactsRoot,
    items: items.map((item) => ({ ...item })),
    results,
    message: failed > 0
      ? '批量豁免草稿处理已停止：出现失败项，未继续创建后续草稿，也未提交任何申请。'
      : (options.dryRun
        ? '豁免资料预检完成：未创建草稿、未提交。'
        : '豁免草稿已保存（未提交；最终提交必须人工完成）。'),
  }
  emit('PHASE2_RESULT_JSON', summary)
  if (failed > 0) process.exitCode = 1
}

await main()
