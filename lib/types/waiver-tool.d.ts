import type { Context } from '@deepseek-ai/cordis';
import type { Phase2SettingsPlane } from './phase2-routes.ts';
/** 脚本输出里携带结构化结果的行前缀（最后一行生效）。 */
export declare const WAIVER_RESULT_PREFIX = "WAIVER_RESULT_JSON=";
export interface WaiverDraftInput {
    assessmentNumber: string;
    /** 归一化后必定有值：输入缺失时由 attachmentPath 的上级目录自动识别。 */
    testCategory: string;
    moduleName: string;
    testsuite?: string;
    testcases: string[];
    waiverReason: string;
    attachmentPath: string;
    dryRun: boolean;
}
export interface WaiverDraftResult {
    status: string;
    action?: string;
    message?: string;
    code?: string;
    artifacts?: string;
    assessmentNumber?: string;
    testCategory?: string;
    moduleName?: string;
    testsuite?: string;
    testcases?: string[];
    systemTypeName?: string;
    systemVersionName?: string;
    certificationId?: string;
}
/** 把目录名或平台字典值归一到规范的 test_type；无法识别时返回 undefined。 */
export declare function normalizeTestCategory(value: string | undefined): string | undefined;
/**
 * 从附件路径的上级目录自动识别测试套分类。
 *
 * 规范目录结构：`<root>/<分类目录>/<模块>/<套件>-豁免材料.zip`。
 * 从附件所在目录逐级向上找第一个可识别的目录名（zip 与 txt 附件都适用），
 * 同时兼容 `/` 与 `\` 两种分隔符，避免 Windows 路径在 WSL 宿主上无法解析。
 */
export declare function inferTestCategory(attachmentPath: string): string | undefined;
/** 脚本目录（lib/waiver-tool.js → 包根/scripts）。 */
export declare function scriptsDirectory(): string;
/**
 * 输入归一化。
 *
 * **刻意不接收 `systemType` / `osVersion`**：系统类型与操作系统版本号必须由脚本按测评编号
 * 调平台 `/certificate/exempt/checkCertification?number=` 反查，避免沿用 `OpenHarmony 6.1 Release`
 * 之类写死默认值（用户 2026-10-26 明确要求）。调用方即使传了也会被忽略。
 *
 * `testCategory` 可省略：省略时按 attachmentPath 的上级目录（分类目录）自动识别；
 * 显式传入但无法识别时立即报错，不静默回退。
 */
export declare function normalizeWaiverInput(raw: unknown): WaiverDraftInput;
export declare function buildWaiverArgs(input: WaiverDraftInput, inputFile: string): string[];
/**
 * 子进程环境：DSH Desktop 宿主是 Electron，`process.execPath` 指向 DeepSeek Harness.exe，
 * 直接 spawn 会再开一个 GUI 实例；`ELECTRON_RUN_AS_NODE=1` 让其退化为普通 Node。
 * 凭据只经环境变量传入子进程，不落盘、不进命令行。
 */
export declare function waiverChildEnv(username: string, password: string, base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
/** 从脚本输出中取最后一条 `WAIVER_RESULT_JSON=` 结构化结果。 */
export declare function parseWaiverOutput(output: string): Record<string, unknown> | undefined;
/** 把脚本结果整理成工具输出；`derived` 里是测评编号反查出来的字段。 */
export declare function toWaiverResult(parsed: Record<string, unknown>, fallbackTestCategory?: string): WaiverDraftResult;
/**
 * `waiver_draft` 工具：保存 OpenHarmony 兼容性豁免**草稿**（绝不提交）。
 *
 * 与 browser_* 方案的区别：由插件 Host 用 Playwright 直接驱动 headless 浏览器，
 * 因此在没有 `@yeesy369/dsh-browser-playwright` 的 DSH Desktop profile 上也能用。
 * 系统类型 / 操作系统版本号在脚本内按测评编号反查（checkCertification），不接收写死值。
 */
export declare function registerWaiverTool(ctx: Context, settings: Phase2SettingsPlane): void;
