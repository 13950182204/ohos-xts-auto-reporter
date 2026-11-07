import { type ReactElement } from 'react';
/**
 * 设置卡片的纯展示层：只吃 props、返回元素树，不持有状态、不发请求。
 *
 * 拆出来的原因有两个：
 * 1) 真实宿主（DSH Desktop settings.section 槽）里由 `client.tsx` 负责状态与 fetch；
 * 2) 本地视觉验证脚本可以直接调用 `SettingsCardView(props)` 把同一份标记序列化成
 *    HTML 截图，不需要 react-dom、不需要跑起整个 DSH。
 *
 * 样式全部走 DSH 主题别名令牌（`--dsw-alias-*`）；0.2.x 的宿主已经不提供
 * `--dsw-color-*`，所以旧令牌只作为兜底保留在 var() 里。
 */
export type SettingsFormValues = {
    username: string;
    password: string;
    workbookPath: string;
    mirrorPath: string;
    contactPhone: string;
    contactEmail: string;
    waiverPath: string;
    waiverAssessmentNumber: string;
};
export type SettingsView = {
    username?: string;
    workbookPath?: string;
    mirrorPath?: string;
    selfCheckPath?: string;
    reportPath?: string;
    contactPhone?: string;
    contactEmail?: string;
    waiverPath?: string;
    waiverAssessmentNumber?: string;
};
export type ResponseState = {
    ok: boolean;
    message?: string;
    errors?: string[];
    summary?: Record<string, unknown>;
    batch?: Record<string, unknown>;
    mirror?: Record<string, unknown>;
    state?: Record<string, unknown>;
    settings?: SettingsView;
    hasPassword?: boolean;
};
/** 豁免资料扫描结果：由 Host 的 `waiver/scan` 路由（scripts/waiver_batch.mjs --scan）返回。 */
export type WaiverScanItem = {
    sourceReport?: string;
    categoryFolder?: string;
    testCategory?: string;
    moduleName?: string;
    testsuite?: string;
    caseCount?: number;
    testcases?: string[];
    attachmentPath?: string;
    attachmentKind?: string;
    submissionPath?: string;
    ready?: boolean;
    problems?: string[];
};
export type WaiverScanSummary = {
    total?: number;
    ready?: number;
    blocked?: number;
    byCategory?: Record<string, number>;
};
export type WaiverScan = {
    ok: boolean;
    root?: string;
    items?: WaiverScanItem[];
    summary?: WaiverScanSummary;
    error?: string;
    message?: string;
};
export type SettingsCardProps = {
    values: SettingsFormValues;
    hasPassword: boolean;
    busy: boolean;
    scanning: boolean;
    settingsLoaded: boolean;
    result: ResponseState | null;
    state: Record<string, unknown> | undefined;
    scan: WaiverScan | null;
    onChange: (field: keyof SettingsFormValues, value: string) => void;
    onPreflight: () => void;
    onSaveReport: () => void;
    onWaiverPreflight: () => void;
    onSaveWaiverDraft: () => void;
    onScan: () => void;
    onCheckMirror: () => void;
    onUploadMirror: () => void;
};
export declare function SettingsCardView(props: SettingsCardProps): ReactElement;
