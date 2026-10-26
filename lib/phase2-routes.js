import { execFile } from 'node:child_process';
import { dirname, join, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Phase2SettingsStore, readLegacySettings } from "./settings-store.js";
const state = { phase: 'idle' };
function scriptsDirectory() {
    return join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
}
function sendJson(res, statusCode, value) {
    const body = JSON.stringify(value);
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(body);
}
async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        size += buffer.length;
        if (size > 64 * 1024)
            throw new Error('请求体过大。');
        chunks.push(buffer);
    }
    if (chunks.length === 0)
        return {};
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('请求体必须是 JSON 对象。');
    }
    return parsed;
}
function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function blankToUndefined(value) {
    return value !== undefined && value.trim() !== '' ? value.trim() : undefined;
}
function redact(value, secrets) {
    return secrets.filter(Boolean).reduce((result, secret) => result.replaceAll(secret, '[已隐藏]'), value);
}
function inputPath(body, settings) {
    return text(body.inputPath) || text(body.workbookPath) || text(settings.workbookPath);
}
function attachmentSettings(workbook) {
    const raw = workbook.trim();
    const isWindows = /^[a-zA-Z]:[\\/]/.test(raw);
    const normalized = raw.replaceAll('/', '\\');
    const directory = isWindows ? win32.dirname(normalized) : dirname(raw.replaceAll('\\', '/'));
    const separator = isWindows ? '\\' : '/';
    return {
        selfCheckPath: `${directory}${separator}OpenHarmony设备兼容性规范5.x自检表_标准系统.xlsx`,
        reportPath: `${directory}${separator}report${separator}report.zip`,
        mirrorPath: '',
    };
}
function currentSettings(settings) {
    return settings.get();
}
/** 对外视图：密码只报「有没有」，绝不回显（与 DSH settings 的 secret 语义保持一致）。 */
function settingsView(settings) {
    const { password, ...rest } = settings;
    return { settings: rest, hasPassword: typeof password === 'string' && password !== '' };
}
function updateState(patch) {
    Object.assign(state, patch);
}
function parseProgressLine(line) {
    if (!line.startsWith('PHASE2_PROGRESS='))
        return undefined;
    try {
        const parsed = JSON.parse(line.slice('PHASE2_PROGRESS='.length));
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
            return undefined;
        const value = parsed;
        const rawPercent = Number(value.percent);
        const rawItemPercent = Number(value.itemPercent);
        const stage = text(value.stage);
        if (!Number.isFinite(rawPercent) || !stage)
            return undefined;
        return {
            percent: Math.max(0, Math.min(100, Math.round(rawPercent))),
            stage,
            detail: text(value.detail) || undefined,
            itemIndex: Number.isFinite(Number(value.itemIndex)) ? Number(value.itemIndex) : undefined,
            itemTotal: Number.isFinite(Number(value.itemTotal)) ? Number(value.itemTotal) : undefined,
            itemPercent: Number.isFinite(rawItemPercent)
                ? Math.max(0, Math.min(100, Math.round(rawItemPercent)))
                : Math.max(0, Math.min(100, Math.round(rawPercent))),
            workbookPath: text(value.workbookPath) || undefined,
        };
    }
    catch {
        return undefined;
    }
}
function parseStructuredLine(line, prefix) {
    if (!line.startsWith(prefix))
        return undefined;
    try {
        const value = JSON.parse(line.slice(prefix.length));
        return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
    }
    catch {
        return undefined;
    }
}
function batchFromValue(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    const source = value;
    const rawItems = Array.isArray(source.items) ? source.items : [];
    const items = rawItems.filter((item) => item !== null && typeof item === 'object' && !Array.isArray(item)).map((item) => ({
        directory: text(item.directory) || undefined,
        workbookPath: text(item.workbookPath) || undefined,
        name: text(item.name) || undefined,
        taskIndex: Number.isFinite(Number(item.taskIndex)) ? Number(item.taskIndex) : undefined,
        status: text(item.status) || 'pending',
        percent: Number.isFinite(Number(item.percent)) ? Math.max(0, Math.min(100, Number(item.percent))) : 0,
        stage: text(item.stage) || '待处理',
        detail: text(item.detail) || undefined,
        applicationId: text(item.applicationId) || undefined,
        assessmentNumber: text(item.assessmentNumber)
            || (item.summary !== null && typeof item.summary === 'object' && !Array.isArray(item.summary)
                ? text(item.summary.assessmentNumber)
                : undefined),
        code: text(item.code) || undefined,
    }));
    const rawSkipped = Array.isArray(source.skipped) ? source.skipped : [];
    for (const skipped of rawSkipped) {
        if (skipped === null || typeof skipped !== 'object' || Array.isArray(skipped))
            continue;
        const item = skipped;
        const directory = text(item.directory) || undefined;
        if (directory && items.some((candidate) => candidate.directory === directory))
            continue;
        items.push({
            directory,
            name: text(item.name) || directory,
            status: 'skipped',
            percent: 100,
            stage: '已跳过',
            detail: text(item.reason) || '未找到第二阶段 Excel。',
        });
    }
    items.sort((left, right) => (left.name || left.directory || '').localeCompare(right.name || right.directory || ''));
    const skippedCount = Number.isFinite(Number(source.skippedCount))
        ? Number(source.skippedCount)
        : items.filter((item) => item.status === 'skipped').length;
    const taskCount = Number.isFinite(Number(source.taskCount)) ? Number(source.taskCount) : items.filter((item) => item.taskIndex).length;
    const mode = text(source.mode);
    return {
        mode: mode === 'single' || mode === 'batch' ? mode : undefined,
        rootPath: text(source.rootPath) || undefined,
        taskCount,
        skippedCount,
        items,
    };
}
function applyBatchProgress(batch, progress) {
    if (!batch || !progress.itemIndex || !progress.itemTotal)
        return { batch, progress };
    const itemIndex = progress.itemIndex;
    const itemPercent = progress.itemPercent ?? progress.percent;
    const items = batch.items.map((item) => item.taskIndex === itemIndex
        ? { ...item, status: item.status === 'skipped' ? item.status : 'saving', percent: itemPercent, stage: progress.stage, detail: progress.detail, workbookPath: progress.workbookPath || item.workbookPath }
        : item);
    const overall = Math.round(((itemIndex - 1) * 100 + itemPercent) / progress.itemTotal);
    return { batch: { ...batch, taskCount: progress.itemTotal, items }, progress: { ...progress, percent: Math.max(0, Math.min(100, overall)), itemPercent } };
}
function applyBatchItemResult(batch, value) {
    if (!batch)
        return batch;
    const taskIndex = Number(value.taskIndex);
    const status = text(value.status);
    const stage = { saved: '已完成', skipped: '已跳过', blocked: '已停止', retryable: '待重试' }[status] || status;
    const items = batch.items.map((item) => item.taskIndex === taskIndex ? {
        ...item,
        status: status || item.status,
        percent: ['saved', 'skipped', 'blocked', 'retryable'].includes(status) ? 100 : item.percent,
        stage: stage || item.stage,
        detail: text(value.message) || item.detail,
        applicationId: text(value.applicationId) || item.applicationId,
        assessmentNumber: text(value.assessmentNumber) || item.assessmentNumber,
        code: text(value.code) || item.code,
    } : item);
    return { ...batch, items };
}
function batchFromSummary(summary) {
    if (!summary || !Array.isArray(summary.items))
        return undefined;
    return batchFromValue(summary);
}
/**
 * 执行处理脚本所用的 Node 运行时环境。
 *
 * DSH Desktop 的宿主跑在 Electron 里，`process.execPath` 指向
 * `DeepSeek Harness.exe`：直接用它 spawn 脚本会**再开一个 GUI 实例**而不是执行脚本
 * （预检/保存表现为无输出、超时）。Electron 认 `ELECTRON_RUN_AS_NODE=1`，同一个
 * 二进制在该变量下退化成普通 Node。WSL 侧 `dsh web` 的 execPath 本来就是真 Node
 * （`process.versions.electron` 为空），不加该变量。
 */
function scriptNodeEnv() {
    return process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {};
}
function runScript(script, args, env, secrets, onProgress, onBatchInit, onBatchItemResult) {
    return new Promise((resolve) => {
        const child = execFile(process.execPath, [join(scriptsDirectory(), script), ...args], {
            env: { ...process.env, ...scriptNodeEnv(), ...env },
            maxBuffer: 2 * 1024 * 1024,
        }, (error, stdout, stderr) => {
            const code = typeof error?.code === 'number' ? error.code : error ? 1 : 0;
            const output = redact(`${stdout}${stderr ? `\n${stderr}` : ''}`.trim(), secrets);
            resolve({ code, output });
        });
        let progressBuffer = '';
        child.stdout?.on('data', (chunk) => {
            progressBuffer += chunk.toString();
            const lines = progressBuffer.split(/\r?\n/);
            progressBuffer = lines.pop() || '';
            for (const line of lines) {
                const progress = parseProgressLine(line);
                if (progress)
                    onProgress?.(progress);
                const batch = parseStructuredLine(line, 'PHASE2_BATCH_INIT=');
                if (batch)
                    onBatchInit?.(batchFromValue(batch) || { taskCount: 0, skippedCount: 0, items: [] });
                const itemResult = parseStructuredLine(line, 'PHASE2_BATCH_ITEM_RESULT=');
                if (itemResult)
                    onBatchItemResult?.(itemResult);
            }
        });
        const timeout = setTimeout(() => child.kill('SIGTERM'), 15 * 60 * 1000);
        child.once('close', () => clearTimeout(timeout));
    });
}
function parsePreflight(output) {
    for (const line of output.split(/\r?\n/).reverse()) {
        if (!line.trim())
            continue;
        try {
            const value = JSON.parse(line);
            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                return value;
            }
        }
        catch {
            // Progress lines are expected before the final one-line JSON result.
        }
    }
    return { ok: false, errors: [output || '预检进程未返回结果。'], message: '工作簿预检失败。' };
}
function formatSaveFailure(summary) {
    const results = Array.isArray(summary?.results) ? summary.results : [];
    const first = results[0];
    if (first === null || typeof first !== 'object' || Array.isArray(first))
        return undefined;
    const value = first;
    const code = text(value.code);
    const message = text(value.message);
    if (!message)
        return undefined;
    return code ? `${code}: ${message}` : message;
}
function parseSave(output) {
    const marker = [...output.split(/\r?\n/)].reverse().find((line) => line.startsWith('PHASE2_RESULT_JSON='));
    if (!marker)
        return {};
    try {
        const value = JSON.parse(marker.slice('PHASE2_RESULT_JSON='.length));
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            const summary = value;
            return { summary, failureMessage: formatSaveFailure(summary) };
        }
    }
    catch {
        // Keep the normal save error when the structured marker is malformed.
    }
    return {};
}
async function handlePreflight(req, res, settings) {
    if (req.method !== 'POST')
        return sendJson(res, 405, { ok: false, message: '只支持 POST。' });
    if (state.phase !== 'idle')
        return sendJson(res, 409, { ok: false, message: '已有任务正在执行，请等待当前任务结束。' });
    try {
        const body = await readBody(req);
        const value = currentSettings(settings);
        const path = inputPath(body, value);
        if (!path)
            return sendJson(res, 400, { ok: false, message: '没有提供对应的申请表格文件或批量目录，已停止执行。' });
        const isDirectoryInput = !path.toLowerCase().endsWith('.xlsx');
        updateState({ kind: 'phase2', phase: 'preflight', startedAt: new Date().toISOString(), finishedAt: undefined, ok: undefined, message: isDirectoryInput ? '正在扫描批量目录。' : '正在读取工作簿。', errors: undefined, summary: undefined, batch: undefined, progress: { percent: 5, stage: isDirectoryInput ? '扫描批量目录' : '读取工作簿', detail: isDirectoryInput ? '正在检查一级子目录中的申请表。' : '正在检查设备类型和必填字段。' } });
        const result = await runScript('preflight_phase2.mjs', ['--input', path], {}, [], (progress) => {
            updateState({ progress, message: progress.detail || progress.stage });
        }, (batch) => {
            updateState({ batch });
        }, (itemResult) => {
            updateState({ batch: applyBatchItemResult(state.batch, itemResult) });
        });
        const parsed = parsePreflight(result.output);
        const response = { ...parsed, ok: result.code === 0 && parsed.ok, output: result.code === 0 ? undefined : parsed.message };
        updateState({ phase: 'idle', finishedAt: new Date().toISOString(), ok: response.ok, message: response.message, errors: response.errors, summary: response.summary, batch: batchFromSummary(response.summary), progress: { percent: 100, stage: response.ok ? '预检完成' : '预检失败', detail: response.ok ? response.message || '工作簿和附件路径可以使用。' : response.message } });
        sendJson(res, response.ok ? 200 : 422, { ...response, batch: state.batch });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateState({ phase: 'idle', finishedAt: new Date().toISOString(), ok: false, message, errors: [message], progress: { percent: 100, stage: '预检失败', detail: message } });
        sendJson(res, 400, { ok: false, message, errors: [message] });
    }
}
async function handleSave(req, res, settings) {
    if (req.method !== 'POST')
        return sendJson(res, 405, { ok: false, message: '只支持 POST。' });
    if (state.phase !== 'idle')
        return sendJson(res, 409, { ok: false, message: '已有任务正在执行，请等待当前任务结束。' });
    try {
        const body = await readBody(req);
        const value = currentSettings(settings);
        const path = inputPath(body, value);
        const username = text(value.username) || text(process.env.OH_USERNAME);
        const password = text(value.password) || text(process.env.OH_PASSWORD);
        if (!username || !password)
            return sendJson(res, 400, { ok: false, message: '没有填写对应账号密码，已停止执行。' });
        if (!path)
            return sendJson(res, 400, { ok: false, message: '没有提供对应的申请表格文件或批量目录，已停止执行。' });
        const isDirectoryInput = !path.toLowerCase().endsWith('.xlsx');
        const scriptName = isDirectoryInput ? 'phase2_batch.mjs' : 'fill_phase2.mjs';
        const scriptArgs = isDirectoryInput ? ['--input', path, '--save'] : ['--phase2', '--workbook', path, '--save'];
        const attachments = isDirectoryInput ? {} : attachmentSettings(path);
        updateState({ kind: 'phase2', phase: 'saving', startedAt: new Date().toISOString(), finishedAt: undefined, ok: undefined, message: '正在启动浏览器流程。', errors: undefined, summary: undefined, batch: undefined, progress: { percent: 2, stage: '启动流程', detail: isDirectoryInput ? '正在扫描批量目录。' : '正在登录兼容性测评平台。' } });
        const result = await runScript(scriptName, scriptArgs, {
            OH_USERNAME: username,
            OH_PASSWORD: password,
            OH_CONTACT_PHONE: text(value.contactPhone) || '13950182204',
            OH_CONTACT_EMAIL: text(value.contactEmail) || '102438@dnake.com',
            OH_SELF_CHECK_PATH: attachments.selfCheckPath || '',
            OH_REPORT_PATH: attachments.reportPath || '',
            OH_MIRROR_PATH: '',
        }, [username, password], (progress) => {
            const merged = applyBatchProgress(state.batch, progress);
            updateState({ progress: merged.progress, batch: merged.batch, message: progress.detail || progress.stage });
        }, (batch) => {
            updateState({ batch });
        }, (itemResult) => {
            updateState({ batch: applyBatchItemResult(state.batch, itemResult) });
        });
        const ok = result.code === 0;
        const parsed = parseSave(result.output);
        const message = ok
            ? (isDirectoryInput ? '批量评测资料已处理完成，尚未最终提交。' : '评测资料已保存，尚未最终提交。')
            : parsed.failureMessage || result.output || '评测资料处理失败。';
        updateState({ phase: 'idle', finishedAt: new Date().toISOString(), ok, message, errors: ok ? undefined : [message], summary: parsed.summary, batch: batchFromSummary(parsed.summary) || state.batch, progress: { percent: 100, stage: ok ? '已完成' : '已停止', detail: message } });
        sendJson(res, ok ? 200 : 422, { ok, message, summary: parsed.summary, batch: state.batch, output: result.output || undefined });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateState({ phase: 'idle', finishedAt: new Date().toISOString(), ok: false, message, errors: [message], progress: { percent: 100, stage: '已停止', detail: message } });
        sendJson(res, 400, { ok: false, message, errors: [message] });
    }
}
function waiverInputs(body, settings) {
    return {
        path: text(body.waiverPath) || text(settings.waiverPath),
        assessment: text(body.waiverAssessmentNumber) || text(settings.waiverAssessmentNumber),
        testCategory: text(body.waiverTestCategory) || text(settings.waiverTestCategory) || 'ACTS-Validator',
    };
}
/**
 * 豁免资料预检 / 保存草稿：把指定路径里的 .txt 豁免报告逐条解析，调用
 * `scripts/waiver_batch.mjs`（内部再调 `waiver_draft.mjs`）完成登录、按测评编号
 * 反查系统类型/版本、查重、填表、上传附件，并只点击精确「保存」。
 * 全程不点击「申请豁免/提交/确认提交」，也不调用 /exempt/submit。
 */
async function handleWaiverRun(req, res, settings, mode) {
    if (req.method !== 'POST')
        return sendJson(res, 405, { ok: false, message: '只支持 POST。' });
    if (state.phase !== 'idle')
        return sendJson(res, 409, { ok: false, message: '已有任务正在执行，请等待当前任务结束。' });
    try {
        const body = await readBody(req);
        const value = currentSettings(settings);
        const inputs = waiverInputs(body, value);
        const username = text(value.username) || text(process.env.OH_USERNAME);
        const password = text(value.password) || text(process.env.OH_PASSWORD);
        if (!username || !password)
            return sendJson(res, 400, { ok: false, message: '没有填写对应账号密码，已停止执行。' });
        if (!inputs.assessment)
            return sendJson(res, 400, { ok: false, message: '没有填写对应测评编号，已停止执行。' });
        if (!inputs.path)
            return sendJson(res, 400, { ok: false, message: '没有填写豁免资料路径，已停止执行。' });
        const dryRun = mode === 'preflight';
        updateState({
            kind: 'waiver',
            phase: dryRun ? 'preflight' : 'saving',
            startedAt: new Date().toISOString(),
            finishedAt: undefined,
            ok: undefined,
            message: dryRun ? '正在解析豁免资料并预检。' : '正在解析豁免资料并保存草稿。',
            errors: undefined,
            summary: undefined,
            batch: undefined,
            progress: { percent: 2, stage: '解析豁免资料', detail: inputs.path },
        });
        const result = await runScript('waiver_batch.mjs', [
            '--input', inputs.path,
            '--assessment', inputs.assessment,
            '--test-category', inputs.testCategory,
            dryRun ? '--dry-run' : '--save',
        ], { OH_USERNAME: username, OH_PASSWORD: password }, [username, password], (progress) => {
            updateState({ progress, message: progress.detail || progress.stage });
        }, (batch) => {
            updateState({ batch });
        }, (itemResult) => {
            updateState({ batch: applyBatchItemResult(state.batch, itemResult) });
        });
        const parsed = parseSave(result.output);
        const ok = result.code === 0;
        const message = ok
            ? (dryRun ? '豁免资料预检完成：未创建草稿、未提交。' : '豁免草稿已保存（未提交；最终提交必须人工完成）。')
            : (parsed.failureMessage || result.output || '豁免草稿处理失败。');
        updateState({
            kind: 'waiver',
            phase: 'idle',
            finishedAt: new Date().toISOString(),
            ok,
            message,
            errors: ok ? undefined : [message],
            summary: parsed.summary,
            batch: batchFromSummary(parsed.summary) || state.batch,
            progress: { percent: 100, stage: ok ? '已完成' : '已停止', detail: message },
        });
        sendJson(res, ok ? 200 : 422, { ok, message, summary: parsed.summary, batch: state.batch, output: result.output || undefined });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateState({ kind: 'waiver', phase: 'idle', finishedAt: new Date().toISOString(), ok: false, message, errors: [message], progress: { percent: 100, stage: '已停止', detail: message } });
        sendJson(res, 400, { ok: false, message, errors: [message] });
    }
}
function handleStatus(req, res) {
    if (req.method !== 'GET')
        return sendJson(res, 405, { ok: false, message: '只支持 GET。' });
    sendJson(res, 200, { ok: true, state: { ...state } });
}
async function handleGetSettings(req, res, settings) {
    if (req.method !== 'GET')
        return sendJson(res, 405, { ok: false, message: '只支持 GET。' });
    sendJson(res, 200, { ok: true, ...settingsView(settings.get()) });
}
/**
 * 写设置。空字符串语义：
 * - `password` 传空 → 保留原值（卡片不回显密码，不能靠空值清掉它）；
 * - 其余字段传空 → 照写空串（调用方负责填默认联系人）。
 */
async function handleSaveSettings(req, res, settings) {
    if (req.method !== 'POST')
        return sendJson(res, 405, { ok: false, message: '只支持 POST。' });
    try {
        const body = await readBody(req);
        const patch = {};
        for (const field of ['username', 'workbookPath', 'selfCheckPath', 'reportPath', 'mirrorPath', 'contactPhone', 'contactEmail', 'waiverPath', 'waiverAssessmentNumber', 'waiverTestCategory']) {
            if (field in body)
                patch[field] = text(body[field]);
        }
        const password = text(body.password);
        if (password !== '')
            patch.password = password;
        const saved = await settings.merge(patch);
        sendJson(res, 200, { ok: true, ...settingsView(saved) });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, { ok: false, message: `设置保存失败：${message}` });
    }
}
export function registerPhase2Routes(ctx, settings) {
    const routes = [
        { kind: 'exact', path: '/api/ohos-xts-auto-reporter/status', handler: handleStatus },
        // `/settings` 同一路径同时服务 GET（读）与 POST（写）：WebRoute 按路径唯一匹配，
        // 方法分发必须在这个 handler 内部做（拆成两条同路径路由时只有第一条生效）。
        {
            kind: 'exact',
            path: '/api/ohos-xts-auto-reporter/settings',
            handler: (req, res) => {
                const task = req.method === 'POST' ? handleSaveSettings(req, res, settings) : handleGetSettings(req, res, settings);
                void task.catch((error) => {
                    const message = error instanceof Error ? error.message : String(error);
                    sendJson(res, 500, { ok: false, message });
                });
            },
        },
        { kind: 'exact', path: '/api/ohos-xts-auto-reporter/preflight', handler: (req, res) => handlePreflight(req, res, settings) },
        { kind: 'exact', path: '/api/ohos-xts-auto-reporter/save', handler: (req, res) => handleSave(req, res, settings) },
        { kind: 'exact', path: '/api/ohos-xts-auto-reporter/waiver/preflight', handler: (req, res) => handleWaiverRun(req, res, settings, 'preflight') },
        { kind: 'exact', path: '/api/ohos-xts-auto-reporter/waiver/save', handler: (req, res) => handleWaiverRun(req, res, settings, 'save') },
    ];
    // `/settings` 同时服务 GET（读）与 POST（写）：WebRoute 的 exact 只按路径分发，
    // 方法判定在各 handler 内部完成。
    const disposers = routes.map((route) => ctx.webServer.register(route));
    ctx.effect(() => () => { for (const dispose of disposers)
        dispose(); }, 'ohos-xts-auto-reporter: phase2 routes');
}
/**
 * 组装设置数据面。
 *
 * 顺序很关键：`seedIfAbsent` 只在存储文件不存在时启用旧来源，且先看 settings.yaml
 * （用户真实填过的值，含密码），再落 cordis 配置里的 base 默认值。
 */
export function registerPhase2Settings(ctx, config = {}, options = {}) {
    const store = new Phase2SettingsStore(blankToUndefined(options.settingsFile));
    const fromConfig = {
        workbookPath: text(config.workbookPath),
        selfCheckPath: text(config.selfCheckPath),
        reportPath: text(config.reportPath),
        mirrorPath: '',
        contactPhone: text(config.contactPhone) || '13950182204',
        contactEmail: text(config.contactEmail) || '102438@dnake.com',
        waiverPath: text(config.waiverPath),
        waiverAssessmentNumber: text(config.waiverAssessmentNumber),
        waiverTestCategory: text(config.waiverTestCategory) || 'ACTS-Validator',
    };
    try {
        store.seedIfAbsent(readLegacySettings(blankToUndefined(options.legacyFile)), fromConfig);
    }
    catch (error) {
        ctx.logger.warn(`ohos-xts-auto-reporter: 设置迁移失败，使用空存储: ${error instanceof Error ? error.message : String(error)}`);
    }
    const plane = {
        get: () => store.read(),
        merge: async (patch) => {
            const merged = store.merge(patch);
            ctx.logger.info('ohos-xts-auto-reporter: 设置已保存');
            return merged;
        },
    };
    ctx.logger.info(`ohos-xts-auto-reporter: 设置存储 ${store.filePath}`);
    return plane;
}
