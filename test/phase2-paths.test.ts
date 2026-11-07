import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectAdjacentFile, detectFirmwareNearWorkbook } from '../scripts/fill_phase2.mjs'

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
