import type { Context as ClientContext } from '@deepseek-ai/cordis';
/**
 * XTS 报告上传卡片。
 *
 * 数据面全部走本插件自己的 Host 路由（`/api/ohos-xts-auto-reporter/*`），
 * **不用 `ctx.settingsScope`**：该服务只存在于 DSH 0.1.x，0.2.0-rc.2（DSH Desktop）
 * 的浏览器半区已无此服务，注入它会让整个卡片永不挂载。
 * 视觉层拆在 `settings-view.ts`（纯 props），这里只负责状态、轮询与请求。
 */
export declare function ReporterSettingsCard(): import("react").FunctionComponentElement<import("./settings-view.ts").SettingsCardProps>;
/**
 * 必需注入：只要槽宿主。**不要加 `settingsScope`**——0.2.0-rc.2 的浏览器半区没有该服务，
 * 写进必需注入会让整个卡片（乃至浏览器半区）永不 apply。
 * `locale` 也省略：本卡片的中文文案是字面量，不依赖字典。
 */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
