import { Config } from "./config.js";
import { registerPhase2Routes, registerPhase2Settings } from "./phase2-routes.js";
import { registerVendoredSkills } from "./vendor.js";
import { registerBrowserUploadTool } from "./upload-tool.js";
/**
 * OpenHarmony XTS 兼容性测试自动上报 DSH 插件。
 *
 * 运行时插件（DSH 双半区 bundle）：
 * - 注册 vendored skill：openharmony-waiver-draft（豁免草稿自动填写，
 *   由模型用 browser_* 工具驱动真实浏览器窗口执行，只存草稿绝不提交）；
 * - 注册 browser_upload 工具：文件上传（依赖 @yeesy369/dsh-browser-playwright
 *   的 DSH 定制补丁 setInputFiles，见仓库 docs/browser-upload-patch.md）；
 *   该工具是**可选**能力，见下面 inject 的说明；
 * - 注册第二阶段设置 namespace 与 Host 路由；浏览器半区在设置页的「XTS报告上传」独立区段提供预检和资料处理卡片。
 *
 * 宿主形态：本插件既跑在 WSL 侧 `dsh web`（真 Node + /mnt 路径），也跑在
 * **DSH Desktop**（Windows 侧 Electron 宿主）。两处差异见 README「宿主差异」：
 * 子进程 Node 运行时、路径归一化、browser 服务是否可用。
 */
export const name = 'ohos-xts-auto-reporter';
/**
 * 必需服务。`browser` **故意不在必需注入里**：browser_* 工具由
 * `@yeesy369/dsh-browser-playwright` 提供，而 DSH Desktop 的 desktop profile 没有它
 * （该插件当前版本不满足桌面运行时 0.2.0-rc.2 的 peer 门禁）。若把它写进必需注入，
 * Cordis 会让整个插件在桌面侧永不 apply——设置页卡片、skill、预检全部一起消失。
 * 改为在 apply 内用 `ctx.inject(['browser'], …)` 派生可选子 fiber：服务出现才注册
 * browser_upload，缺失时插件其余能力照常可用。
 */
export const inject = ['skills', 'tools', 'settings', 'webServer'];
export { Config };
export function apply(ctx, config = {}) {
    registerVendoredSkills(ctx);
    ctx.inject(['browser'], (browserCtx) => { registerBrowserUploadTool(browserCtx); });
    const settings = registerPhase2Settings(ctx, config.phase2, { settingsFile: config.settingsFile });
    registerPhase2Routes(ctx, settings);
    ctx.logger.info('ohos-xts-auto-reporter: OpenHarmony XTS 自动上报插件加载完成');
}
