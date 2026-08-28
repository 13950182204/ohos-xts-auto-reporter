import { derivePhase2AttachmentPaths, discoverPhase2Workbooks, readPhase2Workbook, validatePhase2Attachments } from './phase2_logic.mjs';

function parseArgs(argv) {
  const value = (name) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] || '' : ''; };
  const input = value('--input') || value('--workbook');
  if (!input || input.startsWith('--')) throw new Error('没有提供对应的申请表格文件或批量目录，已停止执行。');
  return { input };
}

try {
  const input = parseArgs(process.argv.slice(2));
  const discovery = await discoverPhase2Workbooks(input.input);
  const items = [];
  for (const [index, item] of discovery.items.entries()) {
    console.log(`PHASE2_PROGRESS=${JSON.stringify({ percent: 10, stage: '扫描评测目录', detail: `正在预检 ${item.name}。`, itemIndex: index + 1, itemTotal: discovery.items.length, itemPercent: 10, workbookPath: item.workbookPath })}`);
    try {
      const { record } = await readPhase2Workbook(item.workbookPath);
      const attachments = derivePhase2AttachmentPaths(item.workbookPath);
      const attachmentErrors = await validatePhase2Attachments(attachments);
      const devices = record.type === 'release' ? record.devices : [record];
      items.push({
        directory: item.directory,
        workbookPath: item.workbookPath,
        name: item.name,
        ok: attachmentErrors.length === 0,
        assessmentNumber: record.assessmentNumber || '',
        status: attachmentErrors.length ? 'blocked' : 'pending',
        percent: attachmentErrors.length ? 100 : 0,
        stage: attachmentErrors.length ? '预检失败' : '待处理',
        detail: attachmentErrors.length ? attachmentErrors.join('；') : '预检通过，等待提交。',
        errors: attachmentErrors.length ? attachmentErrors : undefined,
        summary: {
          type: record.type,
          sheetName: record.sheetName,
          name: record.name,
          systemType: record.systemType,
          osVersion: record.osVersion,
          appearanceCount: record.appearancePaths.length,
          pcidCount: devices.filter((device) => device.pcidScPath).length,
          assessmentNumber: record.assessmentNumber || '',
          applicationId: record.applicationId || '',
          processingStatus: record.processingStatus,
          selfCheckPath: attachments.selfCheckPath,
          reportPath: attachments.reportPath,
          mirrorPath: '',
          mirrorUploadDeferred: true,
        },
      });
      console.log(`PHASE2_PROGRESS=${JSON.stringify({ percent: 100, stage: attachmentErrors.length ? '预检失败' : '预检通过', detail: attachmentErrors.length ? attachmentErrors.join('；') : '工作簿和附件路径可以使用。', itemIndex: index + 1, itemTotal: discovery.items.length, itemPercent: 100, workbookPath: item.workbookPath })}`);
    } catch (error) {
      const errors = error?.errors ?? [error instanceof Error ? error.message : String(error)];
      const message = errors.join('；');
      items.push({
        directory: item.directory,
        workbookPath: item.workbookPath,
        name: item.name,
        ok: false,
        status: 'blocked',
        percent: 100,
        stage: '预检失败',
        detail: message,
        errors,
      });
      console.log(`PHASE2_PROGRESS=${JSON.stringify({ percent: 100, stage: '预检失败', detail: message, itemIndex: index + 1, itemTotal: discovery.items.length, itemPercent: 100, workbookPath: item.workbookPath })}`);
    }
  }
  const errors = items.filter((item) => !item.ok).flatMap((item) => item.errors || []);
  const skipped = discovery.skipped.map((item) => ({ ...item, status: 'skipped' }));
  console.log(JSON.stringify({
    ok: errors.length === 0,
    message: items.length === 0
      ? '批量目录中没有可处理的第二阶段 Excel，已全部跳过。'
      : errors.length
        ? '批量预检失败。'
        : discovery.mode === 'batch'
          ? `批量预检完成：${items.length} 项可处理，${skipped.length} 项已跳过。`
          : '工作簿和附件路径可以使用。',
    summary: {
      mode: discovery.mode,
      rootPath: discovery.rootPath,
      taskCount: items.length,
      skippedCount: skipped.length,
      items,
      skipped,
    },
  }));
} catch (error) {
  const errors = error?.errors ?? [error instanceof Error ? error.message : String(error)];
  console.log(JSON.stringify({ ok: false, errors, message: '工作簿预检失败。' }));
  process.exitCode = 1;
}
