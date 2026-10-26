#!/usr/bin/env node
/**
 * 豁免资料批量处理：从指定路径（目录或单个 .txt）解析豁免报告，逐条调用
 * `waiver_draft.mjs` 保存草稿。只保存，不提交。
 *
 * 用法：
 *   node scripts/waiver_batch.mjs --input <目录或.txt> --assessment <测评编号> \
 *     [--test-category ACTS-Validator] [--dry-run|--save] [--artifacts <目录>]
 *
 * 输出协议（与第二阶段批量一致，设置卡片直接复用进度/逐项列表）：
 *   PHASE2_BATCH_INIT=<json>
 *   PHASE2_PROGRESS=<json>
 *   PHASE2_BATCH_ITEM_RESULT=<json>
 *   PHASE2_RESULT_JSON=<json>   （最后一行）
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

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'waiver_draft.mjs')
const CASE_RE = /(?:^|[-*]\s*)([A-Za-z0-9_]+)#([A-Za-z0-9_]+)#(.+?)\s*$/
const RESULT_PREFIX = 'WAIVER_RESULT_JSON='

function parseArgs(argv) {
  const options = { dryRun: true, save: false, input: '', assessment: '', testCategory: 'ACTS-Validator', artifacts: '' }
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
    } else if (argument === '--input') options.input = next()
    else if (argument === '--assessment') options.assessment = next()
    else if (argument === '--test-category') options.testCategory = next()
    else if (argument === '--artifacts') options.artifacts = next()
    else if (argument === '--help' || argument === '-h') options.help = true
    else throw new Error(`未知参数：${argument}`)
  }
  if (!options.help && !options.input) throw new Error('缺少 --input')
  if (!options.help && !options.assessment.trim()) throw new Error('缺少 --assessment')
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
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.txt')) found.push(full)
    }
  }
  await walk(input)
  return found
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

function parseCases(lines) {
  const cases = []
  for (const line of lines) {
    const match = CASE_RE.exec(line.trim())
    if (match) cases.push({ module: match[1], testsuite: match[2], testcase: match[3].trim() })
  }
  return cases
}

/** 单个 .txt → 一条记录；与 process_directory.py 的解析规则一致。 */
async function parseReport(reportPath, assessment, testCategory) {
  const text = await fs.readFile(reportPath, 'utf8')
  const sections = splitSections(text.split(/\r?\n/))
  const cases = parseCases(sections[1] ?? [])
  if (cases.length === 0) throw new Error(`报告里没有失败用例：${reportPath}`)
  const first = cases[0]
  if (cases.some((item) => item.module !== first.module || item.testsuite !== first.testsuite)) {
    throw new Error(`同一报告里混有不同模块/测试套：${reportPath}`)
  }
  const reason = cleanText(sections[3] ?? []) || cleanText(sections[2] ?? [])
  if (!reason) throw new Error(`报告缺少豁免原因：${reportPath}`)
  return {
    assessmentNumber: assessment,
    testCategory,
    moduleName: first.module,
    testsuite: first.testsuite,
    testcases: cases.map((item) => item.testcase),
    waiverReason: reason,
    attachmentPath: path.resolve(reportPath),
    sourceReport: path.resolve(reportPath),
  }
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
    console.log('node scripts/waiver_batch.mjs --input <目录或.txt> --assessment <测评编号> [--test-category ACTS-Validator] [--dry-run|--save] [--artifacts <目录>]')
    return
  }
  const artifactsRoot = options.artifacts
    ? path.resolve(options.artifacts)
    : path.join(os.tmpdir(), `oh-waiver-batch-${stamp()}`)
  await fs.mkdir(artifactsRoot, { recursive: true })

  let reports
  try {
    reports = await listReports(path.resolve(options.input))
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
    rootPath: path.resolve(options.input),
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
    emit('PHASE2_BATCH_ITEM_RESULT', { ...item, percent: 5 })

    let record
    try {
      record = await parseReport(report, options.assessment.trim(), options.testCategory.trim() || 'ACTS-Validator')
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
