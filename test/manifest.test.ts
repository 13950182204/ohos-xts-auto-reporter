import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * DSH 0.2.1-rc.1 适配回归锁。
 *
 * 0.2.x 发布线移除了 `@deepseek-ai/dsh-client-runtime`：浏览器半区的 `ctx.slots`
 * 改由 `@deepseek-ai/dsh-client-ui-renderer` 提供。这里锁住 manifest 的兼容声明与
 * client 入口的依赖来源，避免后续回退时插件在宿主上静默不加载。
 */
interface Manifest {
  dsh?: {
    engines?: { dsh?: string }
    compatibility?: { dshReleases?: Record<string, string> }
    client?: { inject?: string[] }
  }
  peerDependencies?: Record<string, string>
}

const root = process.cwd()
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest
const clientSource = readFileSync(join(root, 'src', 'client.tsx'), 'utf8')

describe('DSH 0.2.1-rc.1 compatibility manifest', () => {
  it('declares the 0.2.1-rc.1 engine baseline and compatibility mark', () => {
    expect(manifest.dsh?.engines?.dsh).toBe('>=0.2.1-rc.1')
    expect(manifest.dsh?.compatibility?.dshReleases?.['0.2.1-rc.1']).toBe('compatible')
  })

  it('resolves the browser slots service from ui-renderer, not the removed client-runtime', () => {
    expect(manifest.dsh?.client?.inject).toContain('@deepseek-ai/dsh-client-ui-renderer')
    expect(manifest.dsh?.client?.inject).not.toContain('@deepseek-ai/dsh-client-runtime')
    expect(manifest.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-client-runtime')
    expect(clientSource).not.toContain('@deepseek-ai/dsh-client-runtime')
    expect(clientSource).toContain("import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'")
  })
})
