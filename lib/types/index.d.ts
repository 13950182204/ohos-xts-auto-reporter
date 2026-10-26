import type { Context } from '@deepseek-ai/cordis';
import { Config, type Config as PluginConfig } from './config.ts';
/**
 * OpenHarmony XTS 兼容性测试自动上报 DSH 插件。
 *
 * 运行时插件（DSH 双半区 bundle）：
 * - 注册 vendored skill：openharmony-waiver-draft（豁免草稿自动填写，只存草稿绝不提交）；
 * - 注册 waiver_draft 工具：插件 Host 用 Playwright 驱动 headless 浏览器保存豁免草稿，
 *   不依赖 browser_* 工具（因此 DSH Desktop 也可用）；系统类型/操作系统版本号按测评编号
 *   从平台反查，不接收写死默认值；
 * - 注册 browser_upload 工具：文件上传（依赖 @yeesy369/dsh-browser-playwright
 *   的 DSH 定制补丁 setInputFiles，见仓库 docs/browser-upload-patch.md）；
 *   该工具是**可选**能力，见下面 inject 的说明；
 * - 注册第二阶段设置 namespace 与 Host 路由；浏览器半区在设置页的「XTS报告上传」独立区段提供预检和资料处理卡片。
 *
 * 宿主形态：本插件既跑在 WSL 侧 `dsh web`（真 Node + /mnt 路径），也跑在
 * **DSH Desktop**（Windows 侧 Electron 宿主）。两处差异见 README「宿主差异」：
 * 子进程 Node 运行时、路径归一化、browser 服务是否可用。
 */
export declare const name = "ohos-xts-auto-reporter";
/**
 * 必需服务。`browser` **故意不在必需注入里**：browser_* 工具由
 * `@yeesy369/dsh-browser-playwright` 提供，而 DSH Desktop 的 desktop profile 没有它
 * （desktop profile 当前未安装该插件）。若把它写进必需注入，
 * Cordis 会让整个插件在桌面侧永不 apply——设置页卡片、skill、预检全部一起消失。
 * 改为在 apply 内用 `ctx.inject(['browser'], …)` 派生可选子 fiber：服务出现才注册
 * browser_upload，缺失时插件其余能力（含 waiver_draft）照常可用。
 */
export declare const inject: string[];
export { Config };
export declare function apply(ctx: Context, config?: PluginConfig): void;
