import type { Context } from '@deepseek-ai/cordis'
import { Config, type Config as PluginConfig } from './config.ts'
import { registerPhase2Routes, registerPhase2Settings } from './phase2-routes.ts'
import { registerVendoredSkills } from './vendor.ts'
import { registerBrowserUploadTool } from './upload-tool.ts'

/**
 * OpenHarmony XTS 兼容性测试自动上报 DSH 插件。
 *
 * 运行时插件（DSH 双半区 bundle）：
 * - 注册 vendored skill：openharmony-waiver-draft（豁免草稿自动填写，
 *   由模型用 browser_* 工具驱动真实浏览器窗口执行，只存草稿绝不提交）；
 * - 注册 browser_upload 工具：文件上传（依赖 @yeesy369/dsh-browser-playwright
 *   的 DSH 定制补丁 setInputFiles，见仓库 docs/browser-upload-patch.md）；
 * - 注册第二阶段设置 namespace 与 Host 路由；浏览器半区在设置页的「XTS报告上传」独立区段提供预检和资料处理卡片。
 *
 * 浏览器依赖：@yeesy369/dsh-browser-playwright 等三个插件（已在 web profile）。
 */
export const name = 'ohos-xts-auto-reporter'
export const inject = ['skills', 'browser', 'tools', 'settings', 'webServer']
export { Config }

export function apply(ctx: Context, config: PluginConfig = {}): void {
  registerVendoredSkills(ctx)
  registerBrowserUploadTool(ctx)
  const settings = registerPhase2Settings(ctx, config.phase2)
  registerPhase2Routes(ctx, settings)
  ctx.logger.info('ohos-xts-auto-reporter: OpenHarmony XTS 自动上报插件加载完成')
}
