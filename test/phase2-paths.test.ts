import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import zlib from 'node:zlib'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectAdjacentFile, detectFirmwareNearWorkbook } from '../scripts/fill_phase2.mjs'
import { derivePhase2AttachmentPaths } from '../scripts/phase2_logic.mjs'
import { packDirectoryToZip } from '../scripts/report_archive.mjs'

/** 只读取本仓库自己写出的 ZIP：解析中央目录 → 按偏移取本地头 → inflate，用来做往返校验。 */
function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = buffer.readUInt16LE(eocd + 10)
  let cursor = buffer.readUInt32LE(eocd + 16)
  const entries = new Map<string, Buffer>()
  for (let index = 0; index < count; index += 1) {
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    cursor += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const compressedLength = buffer.readUInt32LE(localOffset + 18)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const payload = buffer.subarray(start, start + compressedLength)
    entries.set(name, zlib.inflateRawSync(payload))
  }
  return entries
}

let directory = ''

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'oh-phase2-paths-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function touch(name: string, size = 8): Promise<string> {
  const filePath = path.join(directory, name)
  await writeFile(filePath, 'x'.repeat(size))
  return filePath
}

describe('phase2 adjacent files', () => {
  it('prefers the newest dated firmware package and ignores images and folders', async () => {
    await touch('DH-76AM-HS26A-20261001.7z')
    const newest = await touch('DH-76AM-HS26A-20261106.7z')
    await touch('DH-76AM-HS26A-20261002.zip')
    await touch('OTA_76AM_dsi_1024x600.img')
    await mkdir(path.join(directory, 'DH-76AM-HS26A-20261107.7z'))

    const detected = await detectFirmwareNearWorkbook(path.join(directory, 'OpenHarmony兼容性申请资料.xlsx'))

    expect(detected).toBe(newest)
  })

  it('accepts a workbook directory as the starting point', async () => {
    const firmware = await touch('firmware-20260101.tar.gz')

    await expect(detectFirmwareNearWorkbook(directory)).resolves.toBe(firmware)
  })

  it('returns an empty string when the directory has no firmware package', async () => {
    await touch('OpenHarmony兼容性申请资料.xlsx')

    await expect(detectFirmwareNearWorkbook(path.join(directory, 'OpenHarmony兼容性申请资料.xlsx'))).resolves.toBe('')
  })

  it('finds the sample checklist next to the workbook', async () => {
    const checklist = await touch('OpenHarmony兼容性测试样品清单.xlsx', 16)

    await expect(detectAdjacentFile(path.join(directory, 'OpenHarmony兼容性申请资料.xlsx'), 'OpenHarmony兼容性测试样品清单.xlsx')).resolves.toBe(checklist)
  })

  it('returns an empty string when the checklist is missing', async () => {
    await expect(detectAdjacentFile(path.join(directory, 'OpenHarmony兼容性申请资料.xlsx'), 'OpenHarmony兼容性测试样品清单.xlsx')).resolves.toBe('')
  })
})

describe('report archive', () => {
  it('packs an unpacked report directory into report.zip and round-trips the content', async () => {
    await mkdir(path.join(directory, 'report', 'ACTS', 'report-1', 'log'), { recursive: true })
    await writeFile(path.join(directory, 'report', 'ACTS', 'report-1', 'log', '模块.log'), 'hello 世界')
    await writeFile(path.join(directory, 'report', 'ACTS', 'summary.txt'), 'ok')

    const result = await packDirectoryToZip(path.join(directory, 'report'), path.join(directory, 'report', 'report.zip'))
    expect(result.fileCount).toBe(2)
    expect(result.bytes).toBeGreaterThan(0)

    const entries = readZipEntries(await readFile(result.zipPath))
    expect(entries.get('ACTS/summary.txt')?.toString('utf8')).toBe('ok')
    expect(entries.get('ACTS/report-1/log/模块.log')?.toString('utf8')).toBe('hello 世界')
  })

  it('does not pack twice when report/report.zip already exists and is newer', async () => {
    await mkdir(path.join(directory, 'report'), { recursive: true })
    await writeFile(path.join(directory, 'report', 'a.log'), 'a')
    const workbook = path.join(directory, 'OpenHarmony兼容性申请资料.xlsx')
    const first = await derivePhase2AttachmentPaths(workbook)
    expect(first.reportPath).toBe(path.join(directory, 'report', 'report.zip'))
    const before = (await stat(first.reportPath)).mtimeMs
    const second = await derivePhase2AttachmentPaths(workbook)
    expect(second.reportPath).toBe(first.reportPath)
    expect((await stat(second.reportPath)).mtimeMs).toBe(before)
  })

  it('keeps a manually curated zip inside report/ instead of nesting it', async () => {
    await mkdir(path.join(directory, 'report'), { recursive: true })
    await writeFile(path.join(directory, 'report', 'report-20261106.zip'), 'zip')
    await writeFile(path.join(directory, 'report', 'a.log'), 'a')
    const derived = await derivePhase2AttachmentPaths(path.join(directory, 'OpenHarmony兼容性申请资料.xlsx'))
    expect(derived.reportPath).toBe(path.join(directory, 'report', 'report-20261106.zip'))
  })
})
