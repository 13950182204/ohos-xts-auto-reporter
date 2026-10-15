import z from 'schemastery';
/** Settings namespace shared by the Host and browser halves. */
export declare const PHASE2_SETTINGS_NAMESPACE = "ohos-xts-auto-reporter";
/** Durable user settings. Secret fields are redacted by DSH settings RPCs. */
export interface Phase2Settings {
    username?: string;
    password?: string;
    workbookPath?: string;
    selfCheckPath?: string;
    reportPath?: string;
    mirrorPath?: string;
    contactPhone?: string;
    contactEmail?: string;
}
export declare const Phase2Settings: z<Schemastery.ObjectS<{
    username: z<string, string>;
    password: z<string, string>;
    workbookPath: z<string, string>;
    selfCheckPath: z<string, string>;
    reportPath: z<string, string>;
    mirrorPath: z<string, string>;
    contactPhone: z<string, string>;
    contactEmail: z<string, string>;
}>, Schemastery.ObjectT<{
    username: z<string, string>;
    password: z<string, string>;
    workbookPath: z<string, string>;
    selfCheckPath: z<string, string>;
    reportPath: z<string, string>;
    mirrorPath: z<string, string>;
    contactPhone: z<string, string>;
    contactEmail: z<string, string>;
}>>;
/**
 * 插件配置。默认值即可开箱即用；可在 profile 的 cordis.patch.yml
 * 覆盖该行的 config，或在 web GUI 的 Settings → 插件配置 中调整。
 */
export interface Config {
    /** 预留：未来模块（如报告生成）的开关列表 */
    enabledSkills?: string[];
    /** Composition defaults for the plugin settings (seeded once, then user edits win). */
    phase2?: Phase2Settings;
    /**
     * 设置存储文件路径。缺省 `~/.dsh/ohos-xts-auto-reporter.json`；
     * 测试或多机共用场景可用 profile 配置覆盖。
     */
    settingsFile?: string;
}
export declare const Config: z<Config>;
