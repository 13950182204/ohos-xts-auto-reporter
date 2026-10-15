import { describe, expect, it } from 'vitest'
// 路径层是 .mjs（由 Host 子进程直接执行），测试里按运行时导入即可。
import { isAbsoluteLocalPath, splitPaths, toHostPath } from '../scripts/phase2_logic.mjs'

/**
 * 双宿主路径语义回归锁。
 *
 * 背景：同一个输入串在两种宿主下必须得到**不同**的结果，写死任何一种都会在另一种宿主上
 * 静默全废（工作簿读取 ENOENT）。这里用注入的 platform 参数同时覆盖两条分支，
 * 否则 CI 只会跑到 Linux 那一半。
 */
describe('host path normalization', () => {
  it('keeps a Windows path usable on a Windows host (DSH Desktop)', () => {
    expect(toHostPath('D:\\ohos\\XTS6.1\\DHong', 'win32')).toBe('D:/ohos/XTS6.1/DHong')
    expect(toHostPath('D:/ohos/XTS6.1/DHong', 'win32')).toBe('D:/ohos/XTS6.1/DHong')
    expect(toHostPath('\\\\wsl.localhost\\Ubuntu-22.04\\home\\cx', 'win32')).toBe('//wsl.localhost/Ubuntu-22.04/home/cx')
  })

  it('maps a WSL path back to a Windows path on a Windows host', () => {
    expect(toHostPath('/mnt/d/ohos/XTS6.1/DHong', 'win32')).toBe('D:/ohos/XTS6.1/DHong')
    expect(toHostPath('/mnt/c/Users/x/a.xlsx', 'win32')).toBe('C:/Users/x/a.xlsx')
  })

  it('maps a Windows path to /mnt on the WSL host', () => {
    expect(toHostPath('D:\\ohos\\XTS6.1\\DHong', 'linux')).toBe('/mnt/d/ohos/XTS6.1/DHong')
    expect(toHostPath('D:/ohos/x', 'linux')).toBe('/mnt/d/ohos/x')
  })

  it('leaves a WSL path untouched on the WSL host', () => {
    expect(toHostPath('/mnt/d/ohos/x', 'linux')).toBe('/mnt/d/ohos/x')
    expect(toHostPath('/home/cx/os', 'linux')).toBe('/home/cx/os')
  })

  it('decides absoluteness with the host-native rule', () => {
    expect(isAbsoluteLocalPath('D:/ohos/x.xlsx', 'win32')).toBe(true)
    expect(isAbsoluteLocalPath('/mnt/d/ohos/x.xlsx', 'win32')).toBe(true)
    expect(isAbsoluteLocalPath('relative/x.xlsx', 'win32')).toBe(false)
    expect(isAbsoluteLocalPath('/mnt/d/ohos/x.xlsx', 'linux')).toBe(true)
    expect(isAbsoluteLocalPath('D:\\ohos\\x.xlsx', 'linux')).toBe(true)
    expect(isAbsoluteLocalPath('relative/x.xlsx', 'linux')).toBe(false)
  })

  it('normalizes every element of a multi-value cell for both hosts', () => {
    // 回归锁：`.map(toHostPath)` 会把数组下标当成 platform 传进去，导致 Windows 宿主
    // 上多张外观图/PCID 路径被静默转成 /mnt/...（实测于 DSH Desktop 预检）。
    const value = 'D:\\ohos\\a.png; D:\\ohos\\b.png;;/mnt/d/ohos/c.png'
    expect(splitPaths(value, 'win32')).toEqual(['D:/ohos/a.png', 'D:/ohos/b.png', 'D:/ohos/c.png'])
    expect(splitPaths(value, 'linux')).toEqual(['/mnt/d/ohos/a.png', '/mnt/d/ohos/b.png', '/mnt/d/ohos/c.png'])
  })
})
