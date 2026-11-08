import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { createPhase2Workbook } from '../scripts/phase2_logic.mjs'

const run = promisify(execFile)
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const script = path.join(repositoryRoot, 'scripts', 'list_phase2_drafts.mjs')

let directory = ''

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'oh-phase2-drafts-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function draftsOf(input: string): Promise<any> {
  let stdout = ''
  try {
    ;({ stdout } = await run(process.execPath, [script, '--input', input]))
  } catch (error) {
    stdout = String((error as { stdout?: string }).stdout ?? '')
  }
  const line = stdout.split(/\r?\n/).reverse().find((item) => item.startsWith('PHASE2_DRAFTS_JSON='))
  expect(line).toBeTruthy()
  return JSON.parse(String(line).slice('PHASE2_DRAFTS_JSON='.length))
}

/** 造一份「商用设备」工作簿：只填最少字段 + 平台状态，够 readWorkbook 识别即可。 */
async function seedWorkbook(filePath: string, state: { status?: string; applicationId?: string; assessmentNumber?: string; notes?: string } = {}): Promise<void> {
  await createPhase2Workbook(filePath)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  const sheet = workbook.getWorksheet('商用设备')!
  const fields: Array<[string, string]> = [
    ['C8', '标准系统'],
    ['C9', 'OpenHarmony 6.1 LTS'],
    ['C10', 'Linux'],
    ['C11', '验证样机B'],
    ['C12', '运动健康-其他(Sports Health-Other)'],
    ['C13', 'DH-76AM-KS11C'],
    ['C14', 'DH-76AM-KS11C'],
    ['C15', '狄耐克'],
    ['C16', 'DNAKE'],
    ['C18', 'A333'],
    ['C19', 'arm64'],
    ['C21', '支持应用安装'],
    ['C22', '带屏'],
    ['C23', '验证草稿列表用的临时设备'],
    ['C24', '发证即公示'],
    ['C27', '1.4.0'],
    ['C28', '2026-11-01'],
    ['C29', 'default/DHong/DNAKE/DH-76AM-KS11C/OpenHarmony-6.1.0.35/DH-76AM-KS11C/1.4.0/23/1.4.0.0/default'],
    ['C30', 'default'],
  ]
  for (const [cell, value] of fields) sheet.getCell(cell).value = value
  if (state.status) sheet.getCell('B3').value = state.status
  if (state.applicationId) sheet.getCell('F3').value = state.applicationId
  if (state.assessmentNumber) sheet.getCell('B4').value = state.assessmentNumber
  if (state.notes) sheet.getCell('B5').value = state.notes
  await workbook.xlsx.writeFile(filePath)
  // 外观图与 PCID.sc 由目录自动定位，测试里放两个最小可识别文件即可。
  await writeFile(path.join(path.dirname(filePath), 'A333.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  await writeFile(path.join(path.dirname(filePath), 'pcid.sc'), Buffer.from('pcid'))
}

describe('list_phase2_drafts', () => {
  it('lists a saved application as a resumable draft', async () => {
    await seedWorkbook(path.join(directory, 'OpenHarmony兼容性申请资料.xlsx'), {
      status: '第二阶段已保存',
      applicationId: 'aa975679236b47838a7ea05cd64cf4a3',
      assessmentNumber: 'OHC838600008915',
      notes: '平台数据与工作簿一致',
    })

    const result = await draftsOf(directory)

    expect(result.ok).toBe(true)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      assessmentNumber: 'OHC838600008915',
      applicationId: 'aa975679236b47838a7ea05cd64cf4a3',
      processingStatus: '第二阶段已保存',
      resumable: true,
    })
  })

  it('ignores a workbook that never created an application', async () => {
    await seedWorkbook(path.join(directory, 'OpenHarmony兼容性申请资料.xlsx'))

    const result = await draftsOf(directory)

    expect(result.ok).toBe(true)
    expect(result.items).toHaveLength(0)
  })

  it('reports unreadable workbooks instead of failing the whole listing', async () => {
    await seedWorkbook(path.join(directory, 'OpenHarmony兼容性申请资料.xlsx'))
    const result = await draftsOf(path.join(directory, 'no-such-directory'))
    expect(result.ok).toBe(false)
    expect(typeof result.error).toBe('string')
  })
})
