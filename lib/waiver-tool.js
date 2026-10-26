import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { defineTool } from '@deepseek-ai/dsh-tools';
const execFileAsync = promisify(execFile);
/** 脚本输出里携带结构化结果的行前缀（最后一行生效）。 */
export const WAIVER_RESULT_PREFIX = 'WAIVER_RESULT_JSON=';
const SCRIPT_NAME = 'waiver_draft.mjs';
const SCRIPT_TIMEOUT_MS = 10 * 60 * 1000;
/** 脚本目录（lib/waiver-tool.js → 包根/scripts）。 */
export function scriptsDirectory() {
    return join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
}
function stringValue(value) {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
/**
 * 输入归一化。
 *
 * **刻意不接收 `systemType` / `osVersion`**：系统类型与操作系统版本号必须由脚本按测评编号
 * 调平台 `/certificate/exempt/checkCertification?number=` 反查，避免沿用 `OpenHarmony 6.1 Release`
 * 之类写死默认值（用户 2026-10-26 明确要求）。调用方即使传了也会被忽略。
 */
export function normalizeWaiverInput(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        throw new Error('参数必须是 JSON 对象。');
    const value = raw;
    const text = (key) => stringValue(value[key]) ?? '';
    const assessmentNumber = text('assessmentNumber');
    const testCategory = text('testCategory');
    const moduleName = text('moduleName');
    const waiverReason = text('waiverReason');
    const attachmentPath = text('attachmentPath');
    if (!assessmentNumber)
        throw new Error('缺少 assessmentNumber（当前测评编号）。');
    if (!testCategory)
        throw new Error('缺少 testCategory（测试套分类，如 ACTS / ACTS-Validator）。');
    if (!moduleName)
        throw new Error('缺少 moduleName（模块名称）。');
    if (!waiverReason)
        throw new Error('缺少 waiverReason（豁免原因）。');
    if (!attachmentPath)
        throw new Error('缺少 attachmentPath（附件绝对路径）。');
    if (!isAbsolute(attachmentPath))
        throw new Error('attachmentPath 必须是绝对路径。');
    const rawTestcases = Array.isArray(value.testcases) ? value.testcases : [];
    const testcases = rawTestcases
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item !== '');
    return {
        assessmentNumber,
        testCategory,
        moduleName,
        testsuite: stringValue(value.testsuite),
        testcases,
        waiverReason,
        attachmentPath,
        dryRun: value.dryRun === true,
    };
}
export function buildWaiverArgs(input, inputFile) {
    const args = ['--input', inputFile, input.dryRun ? '--dry-run' : '--save'];
    return args;
}
/**
 * 子进程环境：DSH Desktop 宿主是 Electron，`process.execPath` 指向 DeepSeek Harness.exe，
 * 直接 spawn 会再开一个 GUI 实例；`ELECTRON_RUN_AS_NODE=1` 让其退化为普通 Node。
 * 凭据只经环境变量传入子进程，不落盘、不进命令行。
 */
export function waiverChildEnv(username, password, base = process.env) {
    return {
        ...base,
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        OH_USERNAME: username,
        OH_PASSWORD: password,
    };
}
/** 从脚本输出中取最后一条 `WAIVER_RESULT_JSON=` 结构化结果。 */
export function parseWaiverOutput(output) {
    const lines = output.split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index].trim();
        if (!line.startsWith(WAIVER_RESULT_PREFIX))
            continue;
        try {
            const parsed = JSON.parse(line.slice(WAIVER_RESULT_PREFIX.length));
            if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
        }
        catch {
            // 继续向前找；畸形标记不阻断后续解析。
        }
    }
    return undefined;
}
/** 把脚本结果整理成工具输出；`derived` 里是测评编号反查出来的字段。 */
export function toWaiverResult(parsed) {
    const derived = parsed.derived !== null && typeof parsed.derived === 'object' && !Array.isArray(parsed.derived)
        ? parsed.derived
        : {};
    const testcases = Array.isArray(parsed.testcases)
        ? parsed.testcases.filter((item) => typeof item === 'string')
        : undefined;
    return {
        status: stringValue(parsed.status) ?? 'unknown',
        action: stringValue(parsed.action),
        message: stringValue(parsed.message),
        code: stringValue(parsed.code),
        artifacts: stringValue(parsed.artifacts),
        assessmentNumber: stringValue(parsed.assessmentNumber),
        moduleName: stringValue(parsed.moduleName),
        testsuite: stringValue(parsed.testsuite),
        testcases,
        systemTypeName: stringValue(derived.systemTypeName),
        systemVersionName: stringValue(derived.systemVersionName),
        certificationId: stringValue(derived.certificationId),
    };
}
function redact(value, secrets) {
    return secrets.filter(Boolean).reduce((result, secret) => result.replaceAll(secret, '[已隐藏]'), value);
}
/**
 * `waiver_draft` 工具：保存 OpenHarmony 兼容性豁免**草稿**（绝不提交）。
 *
 * 与 browser_* 方案的区别：由插件 Host 用 Playwright 直接驱动 headless 浏览器，
 * 因此在没有 `@yeesy369/dsh-browser-playwright` 的 DSH Desktop profile 上也能用。
 * 系统类型 / 操作系统版本号在脚本内按测评编号反查（checkCertification），不接收写死值。
 */
export function registerWaiverTool(ctx, settings) {
    ctx.tools.register(defineTool({
        name: 'waiver_draft',
        description: '保存 OpenHarmony 兼容性平台测试豁免草稿（只保存，绝不提交）。'
            + '插件 Host 用 Playwright 登录平台：按测评编号反查系统类型/操作系统版本号 → 查询是否已有待提交(status 0)草稿 → 填表 → 上传证据附件 → 只点击精确「保存」。'
            + '系统类型与版本号不接收写死值；查重命中、验证码、字段不匹配或保存结果不明确时停止并返回证据目录。'
            + 'dryRun=true 时只做登录+反查+查重预检，不打开创建申请。',
        parameters: {
            assessmentNumber: { type: 'string', required: true, description: '当前测评编号，例如 OHC007500008641（必须由人工提供）' },
            testCategory: { type: 'string', required: true, description: '测试套分类，取平台字典 test_type：ACTS / ACTS-Validator / HATS / DCTS / SSTS' },
            moduleName: { type: 'string', required: true, description: '模块名称（Module），例如 ActsValidator' },
            testsuite: { type: 'string', description: '测试套名称（Testsuite）；留空表示整个模块豁免' },
            testcases: { type: 'array', items: { type: 'string' }, description: '测试用例名称列表；留空表示整个测试套豁免' },
            waiverReason: { type: 'string', required: true, description: '豁免原因全文' },
            attachmentPath: { type: 'string', required: true, description: '证据附件本地绝对路径（文件）' },
            dryRun: { type: 'boolean', description: 'true 时只做登录/反查/查重预检，不创建草稿' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    status: { type: 'string', required: true },
                    action: { type: 'string' },
                    message: { type: 'string' },
                    code: { type: 'string' },
                    artifacts: { type: 'string' },
                    assessmentNumber: { type: 'string' },
                    moduleName: { type: 'string' },
                    testsuite: { type: 'string' },
                    testcases: { type: 'array', items: { type: 'string' } },
                    systemTypeName: { type: 'string' },
                    systemVersionName: { type: 'string' },
                    certificationId: { type: 'string' },
                },
            },
            render: (_args, value) => {
                const result = value;
                const lines = [`状态：${result.status}`];
                if (result.message)
                    lines.push(`说明：${result.message}`);
                if (result.systemTypeName || result.systemVersionName) {
                    lines.push(`反查字段：${result.systemTypeName ?? '?'} / ${result.systemVersionName ?? '?'}`);
                }
                if (result.assessmentNumber)
                    lines.push(`测评编号：${result.assessmentNumber}`);
                if (result.artifacts)
                    lines.push(`证据目录：${result.artifacts}`);
                return [{ type: 'text', text: lines.join('\n') }];
            },
        },
        async execute(rawArgs) {
            const input = normalizeWaiverInput(rawArgs);
            const configuration = settings.get();
            const username = (configuration.username ?? process.env.OH_USERNAME ?? '').trim();
            const password = configuration.password ?? process.env.OH_PASSWORD ?? '';
            if (!username || !password)
                throw new Error('没有填写对应账号密码，已停止执行。');
            const workDirectory = await mkdtemp(join(tmpdir(), 'dsh-waiver-'));
            const inputFile = join(workDirectory, 'input.json');
            await writeFile(inputFile, `${JSON.stringify({ ...input, dryRun: undefined })}\n`, 'utf8');
            let stdout = '';
            let stderr = '';
            let exitCode = 0;
            try {
                const completed = await execFileAsync(process.execPath, [join(scriptsDirectory(), SCRIPT_NAME), ...buildWaiverArgs(input, inputFile)], {
                    env: waiverChildEnv(username, password),
                    timeout: SCRIPT_TIMEOUT_MS,
                    maxBuffer: 8 * 1024 * 1024,
                });
                stdout = completed.stdout;
                stderr = completed.stderr;
            }
            catch (error) {
                const failure = error;
                stdout = failure.stdout ?? '';
                stderr = failure.stderr ?? '';
                exitCode = typeof failure.code === 'number' ? failure.code : 1;
            }
            finally {
                await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
            }
            const output = redact(`${stdout}${stderr ? `\n${stderr}` : ''}`.trim(), [username, password]);
            const parsed = parseWaiverOutput(output);
            if (!parsed)
                throw new Error(`豁免草稿流程未返回结构化结果（退出码 ${exitCode}）。输出：${output.slice(-1200)}`);
            const result = toWaiverResult(parsed);
            if (exitCode !== 0 || result.status === 'stopped') {
                const detail = [result.code, result.message].filter(Boolean).join(': ') || '原因不明';
                throw new Error(`豁免草稿未保存（${detail}）。证据目录：${result.artifacts ?? '（无）'}`);
            }
            return result;
        },
    }));
    ctx.logger.info('ohos-xts-auto-reporter: 已注册 waiver_draft 工具（Playwright，只保存不提交）');
}
