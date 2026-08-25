import { derivePhase2AttachmentPaths, readPhase2Workbook, validatePhase2Attachments } from './phase2_logic.mjs';

function parseArgs(argv) {
  const value = (name) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] || '' : ''; };
  const workbook = value('--workbook');
  if (!workbook || workbook.startsWith('--')) throw new Error('没有提供对应的申请表格文件，已停止执行。');
  return { workbook };
}

try {
  const input = parseArgs(process.argv.slice(2));
  const workbook = input.workbook;
  const { record } = await readPhase2Workbook(workbook);
  const attachments = derivePhase2AttachmentPaths(workbook);
  const attachmentErrors = await validatePhase2Attachments(attachments);
  if (attachmentErrors.length) {
    console.log(JSON.stringify({ ok: false, errors: attachmentErrors, message: '附件预检失败。' }));
    process.exitCode = 1;
    process.exitCode = 1;
    process.exit();
  }
  const devices = record.type === 'release' ? record.devices : [record];
  console.log(JSON.stringify({
    ok: true,
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
  }));
} catch (error) {
  const errors = error?.errors ?? [error instanceof Error ? error.message : String(error)];
  console.log(JSON.stringify({ ok: false, errors, message: '工作簿预检失败。' }));
  process.exitCode = 1;
}
