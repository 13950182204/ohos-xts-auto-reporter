import type { Context } from '@deepseek-ai/cordis'
import { registerVendoredSkills } from './vendor.ts'

/**
 * OpenHarmony XTS 兼容性测试自动上报 DSH 插件。
 *
 * 运行时插件（bundle 聚合包形态，无 client 半身）：
 * - 注册 vendored skill：openharmony-waiver-draft（豁免草稿自动填写，
 *   由模型用 browser_* 工具驱动真实浏览器窗口执行，只存草稿绝不提交）；
 * - 多模块预留：后续报告生成/自动上报等 skill 加入 skills/ 与 VENDORED_SKILLS 即可。
 *
 * 浏览器依赖：@yeesy369/dsh-browser-playwright 等三个插件（已在 web profile）。
 */
export const name = 'ohos-xts-auto-reporter'
export const inject = ['skills']
export { Config } from './config.ts'

export function apply(ctx: Context): void {
  registerVendoredSkills(ctx)
  ctx.logger.info('ohos-xts-auto-reporter: OpenHarmony XTS 自动上报插件加载完成')
}
