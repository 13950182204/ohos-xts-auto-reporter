import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
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
export const SETTINGS_FILE_NAME = 'ohos-xts-auto-reporter.json';
/** 旧版把同一批字段存在 settings.yaml 的这个 section 下。 */
export const LEGACY_SETTINGS_SECTION = 'ohos-xts-auto-reporter';
const STRING_FIELDS = [
    'username',
    'password',
    'workbookPath',
    'selfCheckPath',
    'reportPath',
    'mirrorPath',
    'contactPhone',
    'contactEmail',
];
export function defaultSettingsFilePath(home = homedir()) {
    return join(home, '.dsh', SETTINGS_FILE_NAME);
}
export function legacySettingsFilePath(home = homedir()) {
    return join(home, '.dsh', 'settings.yaml');
}
/** 只保留已知的字符串字段，顺手 trim；不认识的键一律丢弃。 */
export function pickSettings(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return {};
    const record = value;
    const result = {};
    for (const field of STRING_FIELDS) {
        const raw = record[field];
        if (typeof raw === 'string')
            result[field] = raw.trim();
    }
    return result;
}
/**
 * 从旧版 settings.yaml 读取本插件 section（一次性迁移用）。
 * 文件缺失或解析失败都返回空对象：迁移是尽力而为，不能阻断插件加载。
 */
export function readLegacySettings(file = legacySettingsFilePath()) {
    try {
        if (!existsSync(file))
            return {};
        const document = loadYaml(readFileSync(file, 'utf8'));
        if (document === null || typeof document !== 'object' || Array.isArray(document))
            return {};
        return pickSettings(document[LEGACY_SETTINGS_SECTION]);
    }
    catch {
        return {};
    }
}
/**
 * JSON 存储。写入走「同目录临时文件 + rename」，读到的永远是完整的旧值或新值；
 * 文件权限 0600（含账号密码），目录 0700。
 */
export class Phase2SettingsStore {
    filePath;
    cache;
    constructor(filePath = defaultSettingsFilePath()) {
        this.filePath = filePath;
    }
    load() {
        if (this.cache !== undefined)
            return this.cache;
        try {
            this.cache = existsSync(this.filePath) ? pickSettings(JSON.parse(readFileSync(this.filePath, 'utf8'))) : {};
        }
        catch {
            // 损坏的存储按空值处理，不在读取路径上抛错（否则设置卡片整个打不开）。
            this.cache = {};
        }
        return this.cache;
    }
    read() {
        return { ...this.load() };
    }
    /** 合并补丁并落盘，返回合并后的完整值。 */
    merge(patch) {
        const next = { ...this.load() };
        for (const field of STRING_FIELDS) {
            const value = patch[field];
            if (typeof value === 'string')
                next[field] = value.trim();
        }
        this.write(next);
        return { ...next };
    }
    /**
     * 仅在存储文件**尚不存在**时采用旧值（settings.yaml 迁移 / cordis 配置默认值）。
     * 已存在就不动：用户在当前宿主上保存过的值优先于任何历史来源。
     */
    seedIfAbsent(...sources) {
        if (existsSync(this.filePath))
            return;
        const merged = {};
        for (const source of sources) {
            if (source === undefined)
                continue;
            for (const field of STRING_FIELDS) {
                const value = source[field];
                if (typeof value === 'string' && value.trim() !== '' && merged[field] === undefined)
                    merged[field] = value.trim();
            }
        }
        if (Object.keys(merged).length === 0)
            return;
        this.write(merged);
    }
    write(value) {
        mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
        const temporary = `${this.filePath}.tmp-${String(process.pid)}`;
        try {
            writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
            renameSync(temporary, this.filePath);
            try {
                chmodSync(this.filePath, 0o600);
            }
            catch {
                // Windows 上 chmod 只影响只读位；失败不影响功能。
            }
        }
        catch (error) {
            try {
                rmSync(temporary, { force: true });
            }
            catch {
                // 清理失败不掩盖原始错误。
            }
            throw error;
        }
        this.cache = { ...value };
    }
}
