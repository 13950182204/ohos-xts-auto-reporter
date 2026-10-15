import type { Context } from '@deepseek-ai/cordis';
import type { Phase2Settings as Phase2SettingsValue } from './config.ts';
/**
 * 设置数据面。**刻意不 import `@deepseek-ai/dsh-settings` 的任何值**：
 * 该包在 0.1.2-rc.1 / 0.2.0-rc.2 上删掉了 `settingsNamespace`（见 settings-store.ts 顶部注释），
 * 值导入会让整个插件在链接期失败。类型导入（`import type`）会被擦除，保留无妨。
 */
export interface Phase2SettingsPlane {
    get(): Phase2SettingsValue;
    merge(patch: Phase2SettingsValue): Promise<Phase2SettingsValue>;
}
export declare function registerPhase2Routes(ctx: Context, settings: Phase2SettingsPlane): void;
/** 存储与迁移路径可由调用方注入（profile 配置覆盖 / 测试隔离，避免误读真实 home）。 */
export interface Phase2SettingsOptions {
    /** 设置存储文件；缺省 `~/.dsh/ohos-xts-auto-reporter.json`。 */
    settingsFile?: string;
    /** 旧版 settings.yaml 路径；仅用于一次性迁移。 */
    legacyFile?: string;
}
/**
 * 组装设置数据面。
 *
 * 顺序很关键：`seedIfAbsent` 只在存储文件不存在时启用旧来源，且先看 settings.yaml
 * （用户真实填过的值，含密码），再落 cordis 配置里的 base 默认值。
 */
export declare function registerPhase2Settings(ctx: Context, config?: Phase2SettingsValue, options?: Phase2SettingsOptions): Phase2SettingsPlane;
