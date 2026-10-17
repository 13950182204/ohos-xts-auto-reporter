import type { Context as ClientContext } from '@deepseek-ai/cordis';
/**
 * XTS 报告上传卡片。
 *
 * 数据面全部走本插件自己的 Host 路由（`/api/ohos-xts-auto-reporter/settings`），
 * **不用 `ctx.settingsScope`**：该服务只存在于 DSH 0.1.x，0.2.0-rc.2（DSH Desktop）
 * 的浏览器半区已无此服务，注入它会让整个卡片永不挂载。
 * 组件不再接收任何注入 props，注册时也无需 `inject`。
 */
export declare function ReporterSettingsCard(): import("react").DetailedReactHTMLElement<{
    style: {
        padding: string;
        border: string;
        borderRadius: string;
        marginBottom: string;
        maxWidth: string;
        boxSizing: "border-box";
    };
}, HTMLElement>;
/**
 * 必需注入：只要槽宿主。**不要加 `settingsScope`**——0.2.0-rc.2 的浏览器半区没有该服务，
 * 写进必需注入会让整个卡片（乃至浏览器半区）永不 apply。
 * `locale` 也省略：本卡片的中文文案是字面量，不依赖字典。
 */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
