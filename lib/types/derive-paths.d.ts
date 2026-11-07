/**
 * 本地路径推导（纯函数，不联网、不起子进程、不读 Excel 内容）。
 *
 * 背景：设置页只让用户填一行「Excel 文件或批量目录」。真正要用的却是同一个设备目录下的
 * 三份东西——第二阶段申请资料 xlsx、豁免资料目录 `exemption/`、镜像固件包（zip/7z）。
 * 本模块把这三个默认值从那一行输入推出来，推导不出来时用 `warnings` 说清缺什么，
 * 而不是报错中断（缺一份不影响其余默认值可用）。
 */
/** `POST /api/ohos-xts-auto-reporter/paths/derive` 成功响应体。 */
export interface DerivePathsOk {
    ok: true;
    root: string;
    workbookPath?: string;
    waiverPath?: string;
    mirrorPath?: string;
    mirrorCandidates: MirrorCandidate[];
    warnings: string[];
}
/** 推导失败（HTTP 仍为 200，与 `/waiver/scan` 一致）。 */
export interface DerivePathsFailure {
    ok: false;
    error: string;
}
export type DerivePathsResult = DerivePathsOk | DerivePathsFailure;
export interface MirrorCandidate {
    path: string;
    name: string;
    size: number;
    /** 文件 mtime，ISO 8601 字符串。 */
    modifiedAt: string;
}
/** 第二阶段申请资料的固定文件名（设备目录里通常就是这一个）。 */
export declare const WORKBOOK_NAME = "OpenHarmony\u517C\u5BB9\u6027\u7533\u8BF7\u8D44\u6599.xlsx";
/** 固件包扩展名；长的在前，避免 `.tar` 抢先匹配 `.tar.gz` 之类（结果相同，只为可读）。 */
export declare const MIRROR_EXTENSIONS: readonly [".tar.bz2", ".tar.gz", ".tar.xz", ".tar", ".zip", ".7z"];
/**
 * 根据用户填的那一行推导各路径默认值。
 *
 * - 空输入 / 路径不存在 → `{ ok:false, error }`；
 * - 输入是目录 → `root` 就是它；输入是文件 → `root` 是它所在目录。
 *
 * 推导不到的东西不报错，只在 `warnings` 里给中文说明。
 */
export declare function derivePaths(input: string): DerivePathsResult;
