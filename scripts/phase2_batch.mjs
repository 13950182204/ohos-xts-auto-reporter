import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  derivePhase2AttachmentPaths,
  discoverPhase2Workbooks,
  ensureWorkbookWritable,
  isAssessmentNumber,
  readPhase2Workbook,
  validatePhase2Attachments,
  writeWorkbookState,
} from './phase2_logic.mjs';
import {
  artifactDirectory,
  processRecord,
  reportProgress,
  setProgressContext,
  signIn,
} from './fill_phase2.mjs';

function parseArgs(argv) {
  const value = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] || '' : '';
  };
  const input = value('--input') || value('--root') || value('--workbook');
  if (!input || input.startsWith('--')) throw new Error('没有提供对应的第二阶段 Excel 或批量目录。');
  return { input, mode: argv.includes('--dry-run') ? 'dry-run' : 'save' };
}

function batchArtifactDirectory(rootPath) {
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  return path.join(rootPath, `OpenHarmony兼容性批量结果_${stamp}`);
}

function emitBatchInit(discovery, items, taskCount) {
  console.log(`PHASE2_BATCH_INIT=${JSON.stringify({
    mode: discovery.mode,
    rootPath: discovery.rootPath,
    taskCount,
    items,
    skipped: discovery.skipped,
  })}`);
}

function errorDetails(error) {
  return error instanceof Error ? error.message : String(error);
}

function resultMessage(result) {
  if (result.message) return result.message;
  if (Array.isArray(result.differences) && result.differences.length) {
    return result.differences.map((difference) => `${difference.field || '字段'}：期望 ${difference.expected || '空'}，实际 ${difference.actual || '空'}`).join('；');
  }
  if (result.status === 'saved') return '资料已保存并完成平台回读校验。';
  if (result.status === 'skipped') return '平台已有一致的资料，未重复保存。';
  return result.status || '未返回处理结果。';
}

function emitBatchItemResult(result) {
  console.log(`PHASE2_BATCH_ITEM_RESULT=${JSON.stringify(result)}`);
}

function finalBatchItems(discovery, visibleItems, results) {
  return visibleItems.map((item) => {
    const taskIndex = Number(item.taskIndex);
    const result = Number.isFinite(taskIndex) ? results.find((candidate) => Number(candidate.taskIndex) === taskIndex) : null;
    if (!result) return item;
    const status = result.status || item.status;
    return {
      ...item,
      status,
      percent: ['saved', 'skipped', 'blocked', 'retryable'].includes(status) ? 100 : item.percent,
      stage: status === 'saved' ? '已完成' : status === 'skipped' ? '已跳过' : status === 'blocked' ? '已停止' : status === 'retryable' ? '待重试' : item.stage,
      detail: resultMessage(result),
      applicationId: result.applicationId || item.applicationId,
      assessmentNumber: result.assessmentNumber || item.assessmentNumber,
      code: result.code || item.code,
    };
  }).sort((left, right) => (left.name || left.directory || '').localeCompare(right.name || right.directory || ''));
}

function batchSummary(discovery, visibleItems, taskCount, results) {
  return {
    mode: discovery.mode,
    rootPath: discovery.rootPath,
    taskCount,
    skippedCount: discovery.skipped.length,
    items: finalBatchItems(discovery, visibleItems, results),
    skipped: discovery.skipped,
    results,
  };
}

async function updateSavedWorkbook(sourcePath, result) {
  if (!['saved', 'skipped'].includes(result.status)) return;
  const assessmentNumberReady = isAssessmentNumber(result.assessmentNumber);
  await writeWorkbookState(sourcePath, {
    applicationId: result.applicationId,
    assessmentNumber: result.assessmentNumber,
    status: assessmentNumberReady ? '第二阶段已保存' : '第二阶段已保存，待编号回写',
    notes: assessmentNumberReady
      ? (result.status === 'saved' ? '产品定义、软件定义、XTS报告和PCS自检表已保存并回读校验；镜像上传暂未启用。' : '平台数据与工作簿一致，未重复保存。')
      : '产品定义、软件定义、XTS报告和PCS自检表已保存并回读校验；镜像上传暂未启用。',
  });
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(errorDetails(error));
    process.exitCode = 2;
    return;
  }
  let discovery;
  try {
    reportProgress(2, '扫描批量目录', '正在查找一级子目录中的第二阶段 Excel。');
    discovery = await discoverPhase2Workbooks(options.input);
  } catch (error) {
    console.error(errorDetails(error));
    process.exitCode = 2;
    return;
  }

  const artifactRoot = batchArtifactDirectory(discovery.rootPath);
  await fs.mkdir(artifactRoot, { recursive: true });
  const prepared = [];
  const visibleItems = discovery.skipped.map((item) => ({
    directory: item.directory,
    name: item.name,
    status: 'skipped',
    percent: 100,
    stage: '已跳过',
    detail: item.reason,
  }));
  let taskCount = 0;
  for (const item of discovery.items) {
    const taskIndex = ++taskCount;
    try {
      const input = await readPhase2Workbook(item.workbookPath);
      const attachments = derivePhase2AttachmentPaths(item.workbookPath);
      const errors = await validatePhase2Attachments(attachments);
      const preparedItem = { ...item, taskIndex, input, attachments, errors };
      prepared.push(preparedItem);
      visibleItems.push({
        directory: item.directory,
        workbookPath: item.workbookPath,
        name: item.name,
        assessmentNumber: input.record.assessmentNumber || '',
        taskIndex,
        status: errors.length ? 'blocked' : 'pending',
        percent: errors.length ? 100 : 0,
        stage: errors.length ? '预检失败' : '待处理',
        detail: errors.length ? errors.join('；') : '等待处理。',
      });
    } catch (error) {
      const message = errorDetails(error);
      prepared.push({ ...item, taskIndex, input: null, attachments: null, errors: [message] });
      visibleItems.push({
        directory: item.directory,
        workbookPath: item.workbookPath,
        name: item.name,
        taskIndex,
        status: 'blocked',
        percent: 100,
        stage: '预检失败',
        detail: message,
      });
    }
  }
  emitBatchInit(discovery, visibleItems, taskCount);

  const results = [];
  const validItems = prepared.filter((item) => item.input && !item.errors.length);
  for (const item of prepared.filter((candidate) => candidate.errors.length)) {
    const result = {
      taskIndex: item.taskIndex,
      directory: item.directory,
      workbookPath: item.workbookPath,
      assessmentNumber: item.input?.record?.assessmentNumber || '',
      status: 'blocked',
      code: 'BATCH_PREFLIGHT_FAILED',
      message: item.errors.join('；'),
    };
    results.push(result);
    emitBatchItemResult(result);
  }
  if (!validItems.length) {
    const result = { status: prepared.length ? 'blocked' : 'skipped', message: prepared.length ? '批量目录中没有通过预检的第二阶段 Excel。' : '批量目录中没有可处理的第二阶段 Excel，已全部跳过。' };
    results.push(result);
    const summary = batchSummary(discovery, visibleItems, taskCount, results);
    await fs.writeFile(path.join(artifactRoot, 'result.json'), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`PHASE2_RESULT_JSON=${JSON.stringify(summary)}`);
    if (result.status === 'blocked') process.exitCode = 1;
    return;
  }

  if (!process.env.OH_USERNAME || !process.env.OH_PASSWORD) {
    for (const item of validItems) {
      const result = {
        taskIndex: item.taskIndex,
        directory: item.directory,
        workbookPath: item.workbookPath,
        assessmentNumber: item.input.record.assessmentNumber || '',
        status: 'blocked',
        code: 'CREDENTIALS_MISSING',
        message: '没有填写对应账号密码，已停止执行。',
      };
      results.push(result);
      emitBatchItemResult(result);
    }
    const summary = batchSummary(discovery, visibleItems, taskCount, results);
    await fs.writeFile(path.join(artifactRoot, 'result.json'), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`PHASE2_RESULT_JSON=${JSON.stringify(summary)}`);
    process.exitCode = 2;
    return;
  }

  let browser;
  try {
    const playwright = await import('playwright');
    browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    setProgressContext({ itemIndex: 0, itemTotal: taskCount, workbookPath: '' });
    reportProgress(5, '登录平台', `批量任务共 ${taskCount} 个，正在登录兼容性测评平台。`);
    await signIn(page, artifactRoot, process.env.OH_USERNAME, process.env.OH_PASSWORD);
    for (const item of validItems) {
      const itemArtifact = artifactDirectory('', item.input.sourcePath);
      await fs.mkdir(itemArtifact, { recursive: true });
      setProgressContext({ itemIndex: item.taskIndex, itemTotal: taskCount, workbookPath: item.workbookPath });
      let result;
      try {
        reportProgress(8, '检查工作簿', '正在确认工作簿可写。');
        await ensureWorkbookWritable(item.workbookPath, {
          onRetry: ({ attempt, lockPresent }) => reportProgress(8, '等待工作簿可写', lockPresent
            ? `检测到 WPS/Excel 占用，已等待 ${attempt} 秒。`
            : `工作簿暂时不可写，已等待 ${attempt} 秒。`),
        });
        process.env.OH_SELF_CHECK_PATH = item.attachments.selfCheckPath;
        process.env.OH_REPORT_PATH = item.attachments.reportPath;
        process.env.OH_MIRROR_PATH = '';
        result = await processRecord(page, itemArtifact, item.input.record, options.mode, item.input.sourcePath);
        result = { ...result, message: resultMessage(result) };
        await updateSavedWorkbook(item.input.sourcePath, result);
      } catch (error) {
        const retryable = Boolean(error?.retryable);
        result = {
          taskIndex: item.taskIndex,
          directory: item.directory,
          workbookPath: item.workbookPath,
          assessmentNumber: item.input.record.assessmentNumber || '',
          applicationId: item.input.record.applicationId || '',
          status: retryable ? 'retryable' : 'blocked',
          code: error?.code || 'UNEXPECTED_ERROR',
          message: errorDetails(error),
        };
        await writeWorkbookState(item.input.sourcePath, {
          status: retryable ? '第二阶段待重试' : '需人工处理',
          notes: `${result.code}: ${result.message}`,
        }).catch(() => {});
      }
      const itemResult = { taskIndex: item.taskIndex, directory: item.directory, workbookPath: item.workbookPath, ...result };
      results.push(itemResult);
      reportProgress(100, result.status === 'saved' || result.status === 'skipped' ? '当前评测完成' : '当前评测结束', resultMessage(result));
      emitBatchItemResult(itemResult);
    }
  } catch (error) {
    const code = error?.code || 'BATCH_RUNTIME_FAILED';
    const message = errorDetails(error);
    for (const item of validItems) {
      if (results.some((result) => Number(result.taskIndex) === item.taskIndex)) continue;
      const result = {
        taskIndex: item.taskIndex,
        directory: item.directory,
        workbookPath: item.workbookPath,
        assessmentNumber: item.input.record.assessmentNumber || '',
        applicationId: item.input.record.applicationId || '',
        status: 'blocked',
        code,
        message,
      };
      results.push(result);
      emitBatchItemResult(result);
    }
    console.error(`${code}: ${message}`);
  } finally {
    await browser?.close().catch(() => {});
    setProgressContext({});
  }

  const summary = batchSummary(discovery, visibleItems, taskCount, results);
  await fs.writeFile(path.join(artifactRoot, 'result.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`PHASE2_RESULT_JSON=${JSON.stringify(summary)}`);
  if (results.some((result) => ['blocked', 'retryable'].includes(result.status))) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
