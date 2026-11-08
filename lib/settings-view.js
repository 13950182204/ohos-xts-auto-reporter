import { createElement } from 'react';
const TOKENS = `
.oh-xts{--oh-border:var(--dsw-alias-border-l2,var(--dsw-color-border,#cfd3d6));--oh-border-soft:var(--dsw-alias-border-l1,var(--dsw-color-border,#e1e5ee));--oh-text:var(--dsw-alias-label-primary,var(--dsw-color-text,inherit));--oh-text-2:var(--dsw-alias-label-secondary,var(--dsw-color-text-secondary,#61666b));--oh-text-3:var(--dsw-alias-label-tertiary,#81858c);--oh-soft:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.1));--oh-hover:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08));--oh-primary:var(--dsw-alias-button-primary-fill,var(--dsw-color-primary,#2563eb));--oh-primary-hover:var(--dsw-alias-button-primary-hover,var(--dsw-color-primary,#2563eb));--oh-on-primary:var(--dsw-alias-label-primary-foreground,#fff);--oh-danger:var(--dsw-alias-state-error-primary,var(--dsw-color-danger,#dc2626));--oh-success:var(--dsw-alias-state-success-primary,#22c55e);--oh-warn:var(--dsw-alias-state-warn-primary,#f59e0b);--oh-business:var(--dsw-alias-state-business-primary,#4176e6);--oh-radius:var(--dsw-radius-md,8px);--oh-radius-sm:var(--dsw-radius-sm,6px);--oh-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;--oh-focus:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6))}
.oh-xts,.oh-xts *{box-sizing:border-box}
.oh-xts{display:grid;gap:16px;max-width:780px;padding:18px 18px 16px;border:1px solid var(--oh-border-soft);border-radius:var(--dsw-radius-lg,10px);color:var(--oh-text);font-family:var(--dsw-font-family,inherit);font-size:13px;line-height:1.55}
.oh-xts__head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px 12px}
.oh-xts__title{margin:0;font-size:15px;font-weight:600;letter-spacing:.01em}
.oh-xts__head-note{font-size:11.5px;color:var(--oh-text-3)}
.oh-xts__section{display:grid;gap:12px}
.oh-xts__section-head{display:grid;gap:4px}
.oh-xts__section-title{margin:0;font-size:13px;font-weight:600}
.oh-xts__desc{margin:0;max-width:68ch;font-size:12px;line-height:1.6;color:var(--oh-text-2);overflow-wrap:anywhere}
.oh-xts__rule{height:1px;border:0;margin:0;background:var(--oh-border-soft)}
.oh-xts__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(216px,1fr));gap:12px 16px;align-items:start}
.oh-xts__field{display:grid;gap:6px;margin:0;min-width:0}
.oh-xts__field--wide{grid-column:1/-1}
.oh-xts__label{font-size:12px;font-weight:500;color:var(--oh-text-2)}
.oh-xts__hint{font-size:11px;line-height:1.5;color:var(--oh-text-3)}
.oh-xts__input{width:100%;min-height:34px;padding:6px 10px;border:1px solid var(--oh-border);border-radius:var(--oh-radius-sm);background:var(--oh-soft);color:inherit;font:inherit;transition:border-color .15s ease}
.oh-xts__input::placeholder{color:var(--oh-text-3)}
.oh-xts__input:hover:not(:disabled){border-color:var(--dsw-alias-border-l3,var(--oh-border))}
.oh-xts__input:focus-visible{outline:2px solid var(--oh-focus);outline-offset:1px}
.oh-xts__input:disabled{opacity:.6;cursor:not-allowed}
.oh-xts__actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.oh-xts__btn{height:32px;padding:0 12px;border:1px solid var(--oh-border);border-radius:var(--oh-radius-sm);background:transparent;color:var(--oh-text);font:inherit;font-size:12.5px;font-weight:500;cursor:pointer;transition:background-color .15s ease,border-color .15s ease,opacity .15s ease}
.oh-xts__btn:hover:not(:disabled){background:var(--oh-hover)}
.oh-xts__btn:focus-visible{outline:2px solid var(--oh-focus);outline-offset:2px}
.oh-xts__btn:disabled{opacity:.5;cursor:not-allowed}
.oh-xts__btn--primary{border-color:transparent;background:var(--oh-primary);color:var(--oh-on-primary)}
.oh-xts__btn--primary:hover:not(:disabled){background:var(--oh-primary-hover);opacity:.92}
.oh-xts__note{margin:0;max-width:70ch;font-size:11.5px;line-height:1.6;color:var(--oh-text-3);overflow-wrap:anywhere}
.oh-xts__panel{display:grid;gap:10px;padding:12px;border:1px solid var(--oh-border-soft);border-radius:var(--oh-radius)}
.oh-xts__panel-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 12px}
.oh-xts__panel-title{font-size:12.5px;font-weight:600}
.oh-xts__panel-meta{font-size:11.5px;color:var(--oh-text-3);overflow-wrap:anywhere}
.oh-xts__list{display:grid;gap:6px;margin:0;padding:0;list-style:none}
.oh-xts__row{display:grid;gap:3px;padding:8px 10px;border:1px solid var(--oh-border-soft);border-left:2px solid transparent;border-radius:var(--oh-radius-sm);background:var(--oh-soft)}
.oh-xts__row--blocked{border-left-color:var(--oh-danger)}
.oh-xts__row--ready{border-left-color:var(--oh-success)}
.oh-xts__row-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.oh-xts__name{font-size:12.5px;font-weight:500;overflow-wrap:anywhere;min-width:0}
.oh-xts__path{margin:0;font-family:var(--oh-mono);font-size:11px;line-height:1.5;color:var(--oh-text-3);overflow-wrap:anywhere}
.oh-xts__problem{margin:0;font-size:11.5px;line-height:1.5;color:var(--oh-danger);overflow-wrap:anywhere}
.oh-xts__chip{display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:999px;background:rgba(127,127,127,.16);font-size:10.5px;font-weight:600;letter-spacing:.02em;white-space:nowrap}
.oh-xts__chip--acts{color:var(--oh-business)}
.oh-xts__chip--validator{color:var(--oh-success)}
.oh-xts__chip--reserved{color:var(--oh-warn)}
.oh-xts__chip--pending{color:var(--oh-warn);border-color:var(--oh-warn)}
.oh-xts__chip--blocked{color:var(--oh-danger)}
.oh-xts__chip--neutral{color:var(--oh-text-2)}
.oh-xts__progress-top{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px;font-size:11.5px;color:var(--oh-text-2)}
.oh-xts__bar{height:6px;border-radius:999px;background:rgba(127,127,127,.22);overflow:hidden}
.oh-xts__bar>div{height:100%;border-radius:inherit;transition:width .2s ease-out}
.oh-xts__status{display:grid;gap:2px;padding:8px 10px;border-left:2px solid var(--oh-border);border-radius:4px;background:var(--oh-soft);font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
.oh-xts__status--ok{border-left-color:var(--oh-success)}
.oh-xts__status--error{border-left-color:var(--oh-danger)}
.oh-xts__status--warn{border-left-color:var(--oh-warn)}
.oh-xts__empty{margin:0;font-size:12px;color:var(--oh-text-3)}
.oh-xts__muted{color:var(--oh-text-3)}
@media (max-width:520px){.oh-xts{padding:14px}.oh-xts__grid{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.oh-xts *{transition:none!important}}
`;
function str(value) {
    return typeof value === 'string' ? value : '';
}
function fileBasename(value) {
    const text = str(value);
    if (!text)
        return '';
    const parts = text.split(/[\\/]/);
    return parts[parts.length - 1] ?? '';
}
function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}
function asArray(value) {
    return Array.isArray(value) ? value : [];
}
function clampPercent(value) {
    if (value === undefined)
        return undefined;
    return Math.max(0, Math.min(100, value));
}
function categoryTone(category) {
    if (category === 'ACTS')
        return 'acts';
    if (category === 'ACTS-Validator')
        return 'validator';
    if (['HATS', 'DCTS', 'SSTS'].includes(category))
        return 'reserved';
    return 'neutral';
}
function itemTone(status) {
    if (status === 'saved' || status === 'preflight')
        return 'ready';
    if (status === 'blocked' || status === 'retryable')
        return 'blocked';
    return 'neutral';
}
function field(props) {
    const classes = props.wide ? 'oh-xts__field oh-xts__field--wide' : 'oh-xts__field';
    return createElement('label', { className: classes, htmlFor: props.id, key: props.id }, createElement('span', { className: 'oh-xts__label' }, props.label), createElement('input', {
        id: props.id,
        className: 'oh-xts__input',
        type: props.type ?? 'text',
        value: props.value,
        placeholder: props.placeholder,
        autoComplete: props.autoComplete,
        disabled: props.disabled,
        readOnly: props.readOnly,
        onChange: (event) => props.onChange(event.target.value),
    }), props.hint ? createElement('span', { className: 'oh-xts__hint' }, props.hint) : null);
}
function sectionHead(title, description) {
    return createElement('div', { className: 'oh-xts__section-head', key: `head-${title}` }, createElement('h3', { className: 'oh-xts__section-title' }, title), createElement('p', { className: 'oh-xts__desc' }, description));
}
function chip(text, tone) {
    return createElement('span', { className: `oh-xts__chip oh-xts__chip--${tone}`, key: `chip-${text}-${tone}` }, text);
}
function scanSummaryMeta(summary, items) {
    const parts = [];
    const total = num(summary?.total) ?? items.length;
    parts.push(`${total} 条`);
    const byCategory = summary?.byCategory ?? {};
    const categories = Object.entries(byCategory).filter(([, count]) => Number(count) > 0);
    for (const [category, count] of categories)
        parts.push(`${category} ${Number(count)}`);
    const blocked = num(summary?.blocked) ?? items.filter((item) => item.ready === false).length;
    if (blocked > 0)
        parts.push(`待修复 ${blocked}`);
    return parts.join(' · ');
}
function draftPanel(drafts) {
    const items = asArray(drafts.items);
    const skipped = asArray(drafts.skipped);
    const rows = items.map((item) => createElement('div', { className: 'oh-xts__row', key: `draft-${item.applicationId || item.workbookPath || item.name}` }, createElement('div', { className: 'oh-xts__row-top' }, chip(item.assessmentNumber ? '未提交' : '编号待回写', item.assessmentNumber ? 'pending' : 'neutral'), createElement('span', { className: 'oh-xts__name' }, str(item.name) || '未命名申请'), createElement('span', { className: 'oh-xts__muted' }, str(item.processingStatus) || '待处理')), createElement('p', { className: 'oh-xts__path' }, `${item.assessmentNumber ? `测评编号：${item.assessmentNumber}` : '测评编号：待回写'}${item.processedAt ? ` · ${item.processedAt}` : ''}${item.notes ? ` · ${item.notes}` : ''}`)));
    const skippedRows = skipped.map((item) => createElement('p', { className: 'oh-xts__path', key: `skip-${item.workbookPath || item.name}` }, `跳过：${str(item.name) || str(item.workbookPath)}（${str(item.detail) || '未知原因'}）`));
    return createElement('div', { className: 'oh-xts__panel' }, createElement('div', { className: 'oh-xts__panel-head' }, createElement('span', { className: 'oh-xts__panel-title' }, '未提交草稿'), createElement('span', { className: 'oh-xts__panel-meta' }, `${items.filter((item) => item.resumable).length} 条可直接续提交`)), items.length ? createElement('div', { className: 'oh-xts__list' }, rows)
        : createElement('p', { className: 'oh-xts__empty' }, '这个目录下没有创建过平台申请的草稿。'), skippedRows.length ? createElement('div', { className: 'oh-xts__list' }, skippedRows) : null, items.length ? createElement('p', { className: 'oh-xts__note' }, '点「评测资料提交」会继续这条申请，不会重新建一条。') : null);
}
function scanPanel(scan) {
    const items = Array.isArray(scan.items) ? scan.items : [];
    const visibleItems = items.slice(0, 8);
    if (items.length === 0) {
        return createElement('div', { className: 'oh-xts__panel' }, createElement('div', { className: 'oh-xts__panel-head' }, createElement('span', { className: 'oh-xts__panel-title' }, '识别结果'), createElement('span', { className: 'oh-xts__panel-meta' }, scan.root ?? '')), createElement('p', { className: 'oh-xts__empty' }, scan.ok ? '这个路径下没有找到 .txt 豁免报告。' : (scan.error || scan.message || '识别失败。')));
    }
    return createElement('div', { className: 'oh-xts__panel', 'aria-live': 'polite' }, createElement('div', { className: 'oh-xts__panel-head' }, createElement('span', { className: 'oh-xts__panel-title' }, '识别结果'), createElement('span', { className: 'oh-xts__panel-meta' }, scanSummaryMeta(scan.summary, items))), createElement('ul', { className: 'oh-xts__list' }, visibleItems.map((item, index) => {
        const category = str(item.testCategory);
        const ready = item.ready !== false;
        const problems = asArray(item.problems).map(str).filter(Boolean);
        const name = item.moduleName && item.testsuite
            ? `${item.moduleName}#${item.testsuite}`
            : str(item.sourceReport);
        return createElement('li', {
            className: `oh-xts__row oh-xts__row--${ready ? 'ready' : 'blocked'}`,
            key: `${str(item.sourceReport)}-${index}`,
        }, createElement('div', { className: 'oh-xts__row-top' }, category ? chip(category, ready ? categoryTone(category) : 'blocked') : null, createElement('span', { className: 'oh-xts__name' }, name), createElement('span', { className: 'oh-xts__muted' }, `${num(item.caseCount) ?? 0} 条用例`)), item.submissionPath ? createElement('p', { className: 'oh-xts__path' }, `提交路径：${item.submissionPath}`) : null, fileBasename(item.attachmentPath)
            ? createElement('p', { className: 'oh-xts__path' }, `附件：${fileBasename(item.attachmentPath)}${str(item.attachmentKind) === 'txt' ? '（txt 直传）' : str(item.attachmentKind) === 'zip' ? '（zip）' : ''}`)
            : null, problems.length > 0 ? createElement('p', { className: 'oh-xts__problem' }, problems.join('；')) : null);
    })), items.length > visibleItems.length
        ? createElement('p', { className: 'oh-xts__muted' }, `另有 ${items.length - visibleItems.length} 条未列出（共 ${items.length} 条）；保存时会逐条处理，进度见下方批次面板。`)
        : null);
}
function formatFileSize(bytes) {
    if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0)
        return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
/**
 * 镜像固件上传面板：进度条 + 文件信息 + 平台回执。
 * 上传是长任务（几百 MB 需要几分钟），所以「进行中」与「已结束」共用一块面板，
 * 避免进度闪一下就消失、结果另起一块。
 */
function mirrorPanel(kind, mirror, percent, stage, detail, phase, ok, busy) {
    if (kind !== 'mirror')
        return null;
    const fileName = str(mirror?.fileName);
    const size = formatFileSize(num(mirror?.fileSize));
    const platformStatus = str(mirror?.platformStatus);
    const running = phase !== 'idle';
    const failed = ok === false;
    const value = clampPercent(percent) ?? (running ? 0 : failed ? 0 : 100);
    const title = running ? '正在上传固件' : failed ? '固件上传失败' : '固件上传完成';
    const meta = [fileName, size].filter(Boolean).join(' · ');
    return createElement('div', { className: 'oh-xts__panel', 'aria-live': 'polite' }, createElement('div', { className: 'oh-xts__panel-head' }, createElement('span', { className: 'oh-xts__panel-title' }, title), meta ? createElement('span', { className: 'oh-xts__panel-meta' }, meta) : null), createElement('div', { className: 'oh-xts__progress-top' }, createElement('span', null, stage || (running ? '上传中' : '已结束')), createElement('span', { className: 'oh-xts__muted' }, `${Math.round(value)}%`)), createElement('div', {
        className: 'oh-xts__bar',
        role: 'progressbar',
        'aria-label': '镜像固件上传进度',
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': Math.round(value),
    }, createElement('div', {
        style: { width: `${value}%`, background: failed ? 'var(--oh-danger)' : 'var(--oh-business)' },
    })), detail ? createElement('div', { className: 'oh-xts__path' }, detail) : null, platformStatus
        ? createElement('p', { className: 'oh-xts__path' }, `平台回执：${platformStatus}`)
        : null, running && busy
        ? createElement('p', { className: 'oh-xts__muted' }, '上传期间不要关闭设置页；完成后这里会显示平台回执。')
        : null);
}
function progressPanel(busy, result, percent, stage, detail) {
    if (percent === undefined)
        return null;
    return createElement('div', { className: 'oh-xts__panel' }, createElement('div', { className: 'oh-xts__progress-top' }, createElement('span', null, stage || (busy ? '处理中' : '处理状态')), createElement('span', { className: 'oh-xts__muted' }, `${Math.round(percent)}%`)), createElement('div', {
        className: 'oh-xts__bar',
        role: 'progressbar',
        'aria-label': 'XTS 报告上传进度',
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': Math.round(percent),
    }, createElement('div', {
        style: { width: `${percent}%`, background: result?.ok === false ? 'var(--oh-danger)' : 'var(--oh-business)' },
    })), detail ? createElement('div', { className: 'oh-xts__path' }, detail) : null);
}
function batchPanel(batch, batchItems, title, completed, taskCount) {
    if (!batch || batchItems.length === 0)
        return null;
    return createElement('div', { className: 'oh-xts__panel' }, createElement('div', { className: 'oh-xts__panel-head' }, createElement('span', { className: 'oh-xts__panel-title' }, `${title}（${completed}/${taskCount}）`), createElement('span', { className: 'oh-xts__panel-meta' }, str(batch.rootPath))), createElement('ul', { className: 'oh-xts__list' }, batchItems.map((item, index) => {
        const percent = clampPercent(num(item.percent)) ?? 0;
        const status = str(item.status) || 'pending';
        const tone = itemTone(status);
        const name = str(item.name) || str(item.directory) || `任务 ${index + 1}`;
        const category = str(item.testCategory);
        const submissionPath = str(item.submissionPath);
        const note = [str(item.stage) || status, str(item.detail)].filter(Boolean).join('：');
        return createElement('li', { className: `oh-xts__row oh-xts__row--${tone}`, key: `${str(item.workbookPath)}-${index}` }, createElement('div', { className: 'oh-xts__row-top' }, category ? chip(category, categoryTone(category)) : null, createElement('span', { className: 'oh-xts__name' }, name), createElement('span', { className: 'oh-xts__path' }, `${Math.round(percent)}%`)), createElement('div', {
            className: 'oh-xts__bar',
            role: 'progressbar',
            'aria-label': `${name} 处理进度`,
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': Math.round(percent),
        }, createElement('div', {
            style: { width: `${percent}%`, background: tone === 'blocked' ? 'var(--oh-danger)' : 'var(--oh-business)' },
        })), note ? createElement('p', { className: tone === 'blocked' ? 'oh-xts__problem' : 'oh-xts__path' }, note) : null, submissionPath ? createElement('p', { className: 'oh-xts__path' }, submissionPath) : null);
    })));
}
export function SettingsCardView(props) {
    const { values, result, state, scan, busy, scanning, derived, deriving, deriveError } = props;
    // 只提示「这个目录里认出了什么、带出了哪些路径」，不描述提交动作：
    // 回填永远不触发任何请求之外的行为。
    const derivedFields = derived && derived.ok
        ? [derived.waiverPath ? '豁免资料路径' : '', derived.mirrorPath ? '固件包路径' : ''].filter(Boolean)
        : [];
    const deriveHint = deriving
        ? '正在按该目录识别工作簿与其它路径…'
        : deriveError
            ? `路径推导没跑通：${deriveError}`
            : derived && derived.ok
                ? [
                    derived.workbookPath ? `工作簿已识别：${fileBasename(derived.workbookPath)}` : '',
                    derivedFields.length ? `已带出：${derivedFields.join(' · ')}` : '',
                    ...(derived.warnings ?? []),
                ].filter(Boolean).join('；')
                : '';
    const summaryState = state && !state.finishedAt && result
        ? { ...state, finishedAt: new Date().toISOString(), ok: result.ok, message: result.message, batch: result.batch ?? state.batch }
        : state;
    const progress = asRecord(summaryState?.progress);
    const percent = clampPercent(num(progress?.percent));
    const stage = str(progress?.stage);
    const detail = str(progress?.detail);
    const batch = asRecord(summaryState?.batch ?? result?.batch);
    const batchItems = asArray(batch?.items).map(asRecord).filter(Boolean);
    const batchCompleted = batchItems.filter((item) => ['saved', 'skipped', 'blocked', 'retryable', 'preflight'].includes(str(item.status))).length;
    const batchTotal = num(batch?.taskCount) ?? batchItems.length;
    const batchTitle = str(summaryState?.kind) === 'waiver' ? '批量豁免草稿进度' : '批量评测进度';
    const operation = asRecord(result?.summary ?? summaryState?.summary);
    const results = asArray(operation?.results).map(asRecord).filter(Boolean);
    const firstResult = results[0];
    const attachments = asRecord(firstResult?.attachments);
    const mirror = asRecord(attachments?.mirror);
    const showProgress = percent !== undefined && (busy || summaryState?.phase !== 'idle' || Boolean(summaryState?.finishedAt) || Boolean(result));
    const messages = [result?.message, ...(result?.errors ?? [])].filter(Boolean).join('\n');
    const operationKind = str(summaryState?.kind);
    const mirrorInfo = asRecord(summaryState?.mirror ?? result?.mirror);
    const phase = str(summaryState?.phase);
    const metaLines = [
        str(firstResult?.applicationId) ? `申请标识 ${str(firstResult?.applicationId)}` : '',
        str(firstResult?.assessmentNumber) ? `测评编号 ${str(firstResult?.assessmentNumber)}` : '',
        str(firstResult?.status) ? `处理结果 ${str(firstResult?.status)}` : '',
        str(mirror?.fileName) ? `镜像 ${str(mirror?.fileName)}` : '',
    ].filter(Boolean);
    return createElement('section', { className: 'oh-xts', 'aria-busy': busy ? true : undefined }, createElement('style', { key: 'oh-xts-styles' }, TOKENS), createElement('header', { className: 'oh-xts__head' }, createElement('h3', { className: 'oh-xts__title' }, 'OpenHarmony XTS 自动上报'), createElement('span', { className: 'oh-xts__head-note' }, '评测资料 / 豁免草稿')), createElement('div', { className: 'oh-xts__section' }, createElement('div', { className: 'oh-xts__grid' }, field({
        id: 'oh-xts-username', label: '账号', value: values.username, type: 'text', autoComplete: 'username',
        disabled: busy, onChange: (value) => props.onChange('username', value),
    }), field({
        id: 'oh-xts-password', label: '密码', value: values.password, type: 'password', autoComplete: 'current-password',
        placeholder: props.hasPassword ? '已保存密码，留空则沿用' : '未保存密码',
        disabled: busy, onChange: (value) => props.onChange('password', value),
    }), field({
        id: 'oh-xts-workbook', label: '设备目录（或批量父目录）', wide: true, value: values.workbookPath,
        placeholder: '目录路径，例如 D:\\ohos\\XTS6.1\\DHong\\DH-76AM-HS26A',
        hint: deriveHint || '只填目录：工作簿按目录下的 OpenHarmony兼容性申请资料.xlsx 自动识别，并带出豁免资料路径与固件包路径（不会自动提交）。',
        disabled: busy, onChange: (value) => props.onChange('workbookPath', value),
    }), field({
        id: 'oh-xts-phone', label: '企业联系电话', value: values.contactPhone, type: 'tel',
        disabled: busy, onChange: (value) => props.onChange('contactPhone', value),
    }), field({
        id: 'oh-xts-email', label: '企业邮箱', value: values.contactEmail, type: 'email',
        disabled: busy, onChange: (value) => props.onChange('contactEmail', value),
    })), createElement('div', { className: 'oh-xts__actions' }, createElement('button', { type: 'button', className: 'oh-xts__btn', onClick: props.onPreflight, disabled: busy }, '评测资料预检'), createElement('button', { type: 'button', className: 'oh-xts__btn oh-xts__btn--primary', onClick: props.onSaveReport, disabled: busy }, '评测资料提交'), createElement('button', { type: 'button', className: 'oh-xts__btn', onClick: props.onRefreshDrafts, disabled: busy || props.draftsLoading }, props.draftsLoading ? '检查中…' : '刷新草稿')), props.drafts?.ok === false
        ? createElement('p', { className: 'oh-xts__status oh-xts__status--error' }, `草稿检查失败：${str(props.drafts.message) || str(props.drafts.error) || '未知原因'}`)
        : props.drafts
            ? draftPanel(props.drafts)
            : createElement('p', { className: 'oh-xts__empty' }, props.draftsLoading ? '正在检查未提交草稿…' : '填好设备目录后会自动检查有没有未提交的草稿。')), createElement('hr', { className: 'oh-xts__rule' }), createElement('div', { className: 'oh-xts__section' }, sectionHead('镜像固件上传', '上传到平台「企业空间 → 镜像管理」，进度实时同步。'), createElement('div', { className: 'oh-xts__grid' }, field({
        id: 'oh-xts-mirror-path', label: '固件包路径', wide: true, value: values.mirrorPath,
        placeholder: '单个 .zip / .7z，或包含固件包的目录',
        hint: '支持 .zip / .7z（也接受 tar 系列）；文件名只用中文、英文、数字、空格 _ - . ( )。',
        disabled: busy, onChange: (value) => props.onChange('mirrorPath', value),
    })), createElement('div', { className: 'oh-xts__actions' }, createElement('button', { type: 'button', className: 'oh-xts__btn', onClick: props.onCheckMirror, disabled: busy }, '校验固件'), createElement('button', { type: 'button', className: 'oh-xts__btn oh-xts__btn--primary', onClick: props.onUploadMirror, disabled: busy }, busy ? '上传中…' : '上传固件')), createElement('p', { className: 'oh-xts__note' }, '评测资料预检通过后会自动开始上传固件；只上传文件，不删改任何镜像。'), mirrorPanel(operationKind, mirrorInfo, percent, stage, detail, phase, summaryState?.ok === true ? true : summaryState?.ok === false ? false : undefined, busy)), createElement('hr', { className: 'oh-xts__rule' }), createElement('div', { className: 'oh-xts__section' }, sectionHead('豁免资料', '按目录自动识别测试套分类与平台提交路径。'), createElement('div', { className: 'oh-xts__grid' }, field({
        id: 'oh-xts-assessment', label: '测评编号（豁免）', value: values.waiverAssessmentNumber,
        placeholder: '例如 OHC007500008641', disabled: busy,
        onChange: (value) => props.onChange('waiverAssessmentNumber', value),
    }), field({
        id: 'oh-xts-waiver-path', label: '豁免资料路径', wide: true, value: values.waiverPath,
        placeholder: '目录或单个 .txt，例如 D:\\ohos\\XTS6.1\\DHong\\DH-76AM-HS26A\\exemption',
        hint: 'Acts / ActsValidator / Hats / Dcts / Ssts 目录；附件优先 .zip，缺失用 .txt。',
        disabled: busy, onChange: (value) => props.onChange('waiverPath', value),
    })), createElement('div', { className: 'oh-xts__actions' }, createElement('button', { type: 'button', className: 'oh-xts__btn', onClick: props.onScan, disabled: busy || scanning }, scanning ? '识别中…' : '识别目录'), createElement('button', { type: 'button', className: 'oh-xts__btn', onClick: props.onWaiverPreflight, disabled: busy || scanning }, '豁免资料预检'), createElement('button', { type: 'button', className: 'oh-xts__btn oh-xts__btn--primary', onClick: props.onSaveWaiverDraft, disabled: busy || scanning }, busy ? '处理中…' : '保存豁免草稿')), createElement('p', { className: 'oh-xts__note' }, '只保存草稿，不提交；任一条失败即停。'), scanning ? createElement('div', { className: 'oh-xts__panel' }, createElement('div', { className: 'oh-xts__progress-top' }, createElement('span', null, '正在识别豁免资料…'))) : null, scan ? scanPanel(scan) : createElement('p', { className: 'oh-xts__empty' }, '还没有识别结果：点「识别目录」预览分类与提交路径。')), operationKind === 'mirror' ? null : (showProgress ? progressPanel(busy, result, percent, stage, detail) : null), operationKind === 'mirror' ? null : batchPanel(batch, batchItems, batchTitle, batchCompleted, batchTotal), 
    // 镜像上传成功时进度面板已写明结论与平台回执，底部再复述一遍是噪音；
    // 失败与同步错误仍要在底部给原因。
    result && messages && !(operationKind === 'mirror' && result.ok)
        ? createElement('div', { className: `oh-xts__status oh-xts__status--${result.ok ? 'ok' : 'error'}`, role: 'status' }, messages)
        : null, metaLines.length > 0
        ? createElement('div', { className: 'oh-xts__status', role: 'status' }, metaLines.join(' · '))
        : null, props.settingsLoaded
        ? null
        : createElement('div', { className: 'oh-xts__status oh-xts__status--error', role: 'status' }, '读不到插件设置（Host 路由不可达）；保存与预检会失败。请确认 DSH 宿主已加载本插件。'));
}
