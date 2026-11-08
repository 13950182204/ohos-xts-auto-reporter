/**
 * 镜像固件上传脚本（`scripts/mirror_upload.mjs`）的 stdout 行协议解析。
 *
 * 数据层逐行输出单行 JSON（不包含账号/密码）：
 * - 进度行 `MIRROR_PROGRESS={"percent":12.3,"stage":"解析固件","detail":"…"}`
 * - 末行 `MIRROR_RESULT_JSON={"ok":true,"fileName":"…","fileSize":678,"percent":100,"stage":"完成","platformStatus":"已上传 100.00%","message":"…"}`
 *
 * 这里只做纯解析（不 import Electron / HTTP 模块），便于 vitest 直接覆盖缺字段、
 * 非 JSON、百分数越界等边界情况；`phase2-routes.ts` 再把它接到 `/status` 状态机。
 */
export declare const MIRROR_PROGRESS_PREFIX = "MIRROR_PROGRESS=";
export declare const MIRROR_RESULT_PREFIX = "MIRROR_RESULT_JSON=";
/** `/status` 里 `progress` 的镜像进度视图。 */
export type MirrorProgress = {
    /** 0–100，最多保留一位小数。 */
    percent: number;
    stage: string;
    detail?: string;
};
/** `MIRROR_RESULT_JSON=` 的结果行（失败时带 `ok:false` + `errorCode`）。 */
export type MirrorResult = {
    ok: boolean;
    fileName?: string;
    fileSize?: number;
    platformStatus?: string;
    message?: string;
    errorCode?: string;
    percent?: number;
    stage?: string;
    /** 平台镜像管理里已有同名文件，本次没有重复上传。 */
    skipped?: boolean;
    /** 平台里同名镜像的条数（>1 说明历史上有重复记录）。 */
    duplicates?: number;
};
/** 0–100 的百分数：非法值返回 undefined，越界夹紧，最多保留一位小数。 */
export declare function clampMirrorPercent(value: unknown): number | undefined;
/**
 * 解析一行进度。前缀不对、不是 JSON 对象、缺 `stage` 或缺合法 `percent` 时返回 undefined
 * （调用方保持上一条进度，不把非法行当成 0% 把进度条打回去）。
 */
export declare function parseMirrorProgressLine(line: string): MirrorProgress | undefined;
/**
 * 解析结果行。`ok` 必须是布尔值（数据层契约）；其余字段能取到就带上，
 * 缺失的字段不臆造，交给调用方决定回退文案。
 */
export declare function parseMirrorResultLine(line: string): MirrorResult | undefined;
