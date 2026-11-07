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
export const MIRROR_PROGRESS_PREFIX = 'MIRROR_PROGRESS=';
export const MIRROR_RESULT_PREFIX = 'MIRROR_RESULT_JSON=';
function trimText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/** 数字字段：`null` / 空串 / NaN 都视为缺失，不把 `null` 误当成 0。 */
function finiteNumber(value) {
    if (value === null || value === undefined || value === '')
        return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}
/** 0–100 的百分数：非法值返回 undefined，越界夹紧，最多保留一位小数。 */
export function clampMirrorPercent(value) {
    const number = finiteNumber(value);
    if (number === undefined)
        return undefined;
    return Math.round(Math.max(0, Math.min(100, number)) * 10) / 10;
}
function parseObject(line, prefix) {
    if (!line.startsWith(prefix))
        return undefined;
    try {
        const value = JSON.parse(line.slice(prefix.length));
        return value !== null && typeof value === 'object' && !Array.isArray(value)
            ? value
            : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * 解析一行进度。前缀不对、不是 JSON 对象、缺 `stage` 或缺合法 `percent` 时返回 undefined
 * （调用方保持上一条进度，不把非法行当成 0% 把进度条打回去）。
 */
export function parseMirrorProgressLine(line) {
    const value = parseObject(line, MIRROR_PROGRESS_PREFIX);
    if (!value)
        return undefined;
    const percent = clampMirrorPercent(value.percent);
    const stage = trimText(value.stage);
    if (percent === undefined || !stage)
        return undefined;
    const detail = trimText(value.detail);
    return detail ? { percent, stage, detail } : { percent, stage };
}
/**
 * 解析结果行。`ok` 必须是布尔值（数据层契约）；其余字段能取到就带上，
 * 缺失的字段不臆造，交给调用方决定回退文案。
 */
export function parseMirrorResultLine(line) {
    const value = parseObject(line, MIRROR_RESULT_PREFIX);
    if (!value || typeof value.ok !== 'boolean')
        return undefined;
    const result = { ok: value.ok };
    const fileName = trimText(value.fileName);
    if (fileName)
        result.fileName = fileName;
    const fileSize = finiteNumber(value.fileSize);
    if (fileSize !== undefined && fileSize >= 0)
        result.fileSize = fileSize;
    const platformStatus = trimText(value.platformStatus);
    if (platformStatus)
        result.platformStatus = platformStatus;
    const message = trimText(value.message);
    if (message)
        result.message = message;
    const errorCode = trimText(value.errorCode);
    if (errorCode)
        result.errorCode = errorCode;
    const percent = clampMirrorPercent(value.percent);
    if (percent !== undefined)
        result.percent = percent;
    const stage = trimText(value.stage);
    if (stage)
        result.stage = stage;
    return result;
}
