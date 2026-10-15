import type { Phase2Settings as Phase2SettingsValue } from './config.ts';
/**
 * 插件自有设置存储。
 *
 * 为什么不继续用 DSH 的 settings 服务（历史包袱，三个运行时三套 API）：
 * - `0.1.0-rc.8` / `0.1.1-rc.2`：导出 `settingsNamespace` + `SettingsProvider.register`；
 * - `0.1.2-rc.1`（WSL 侧当前运行时）：`settingsNamespace` **已删除**，只剩 provider 上的
 *   `installSection`；
 * - `0.2.0-rc.2`（DSH Desktop 当前运行时）：整块换成 `SettingsForms`，`settingsNamespace`
 *   与 `installSection` **都不存在**，浏览器侧连 `settingsScope` 服务都没有。
 *
 * 结果是同一份 `import { settingsNamespace }` 在两个在役运行时上都让插件**链接期失败**
 * （`does not provide an export named 'settingsNamespace'`）→ 整插件不加载。
 * 因此设置数据面改为插件自持：一个 0600 的 JSON 文件 + 自有 `/settings` 路由，
 * 浏览器半区只跟自己的路由讲话，与 DSH 版本解耦。
 */
/** 存储文件名（`$DSH_HOME/` 下）。DSH_HOME 固定为 `~/.dsh`。 */
export declare const SETTINGS_FILE_NAME = "ohos-xts-auto-reporter.json";
/** 旧版把同一批字段存在 settings.yaml 的这个 section 下。 */
export declare const LEGACY_SETTINGS_SECTION = "ohos-xts-auto-reporter";
export declare function defaultSettingsFilePath(home?: string): string;
export declare function legacySettingsFilePath(home?: string): string;
/** 只保留已知的字符串字段，顺手 trim；不认识的键一律丢弃。 */
export declare function pickSettings(value: unknown): Phase2SettingsValue;
/**
 * 从旧版 settings.yaml 读取本插件 section（一次性迁移用）。
 * 文件缺失或解析失败都返回空对象：迁移是尽力而为，不能阻断插件加载。
 */
export declare function readLegacySettings(file?: string): Phase2SettingsValue;
/**
 * JSON 存储。写入走「同目录临时文件 + rename」，读到的永远是完整的旧值或新值；
 * 文件权限 0600（含账号密码），目录 0700。
 */
export declare class Phase2SettingsStore {
    readonly filePath: string;
    private cache;
    constructor(filePath?: string);
    private load;
    read(): Phase2SettingsValue;
    /** 合并补丁并落盘，返回合并后的完整值。 */
    merge(patch: Phase2SettingsValue): Phase2SettingsValue;
    /**
     * 仅在存储文件**尚不存在**时采用旧值（settings.yaml 迁移 / cordis 配置默认值）。
     * 已存在就不动：用户在当前宿主上保存过的值优先于任何历史来源。
     */
    seedIfAbsent(...sources: Array<Phase2SettingsValue | undefined>): void;
    private write;
}
