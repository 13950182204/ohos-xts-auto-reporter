import { discoverPhase2Workbooks, readPhase2Workbook } from './phase2_logic.mjs';

/**
 * 列出「已经创建过平台申请、但还没走到提交」的草稿，供设置卡片提示「哪条能继续提交」。
 * 判据只读工作簿自身状态（脱机、不登录平台），避免为了一个提示去拉浏览器。
 */
const DONE_STATES = ['已完成', '已提交', '无需处理', '已归档'];

function parseArgs(argv) {
  const value = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] || '' : '';
  };
  const input = value('--input') || value('--workbook');
  if (!input || input.startsWith('--')) throw new Error('没有提供第二阶段 Excel 或批量目录。');
  return { input };
}

function draftOf(item, record) {
  const applicationId = String(record.applicationId || '').trim();
  const assessmentNumber = String(record.assessmentNumber || '').trim();
  if (!applicationId && !assessmentNumber) return null;
  const processingStatus = String(record.processingStatus || '').trim();
  if (DONE_STATES.some((state) => processingStatus.includes(state))) return null;
  return {
    directory: item.directory,
    workbookPath: item.workbookPath,
    name: record.name || item.name,
    sheetName: record.sheetName,
    type: record.type,
    assessmentNumber,
    applicationId,
    processingStatus: processingStatus || '待处理',
    processedAt: String(record.processedAt || '').trim(),
    notes: String(record.notes || '').trim().slice(0, 300),
    resumable: Boolean(applicationId),
  };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const discovery = await discoverPhase2Workbooks(options.input);
  const items = [];
  const skipped = [];
  for (const item of discovery.items) {
    try {
      const { record } = await readPhase2Workbook(item.workbookPath);
      const draft = draftOf(item, record);
      if (draft) items.push(draft);
    } catch (error) {
      skipped.push({ workbookPath: item.workbookPath, name: item.name, detail: error instanceof Error ? error.message : String(error) });
    }
  }
  items.sort((left, right) => (right.processedAt || '').localeCompare(left.processedAt || ''));
  console.log(`PHASE2_DRAFTS_JSON=${JSON.stringify({ ok: true, root: discovery.rootPath || options.input, items, skipped, summary: { total: items.length, skipped: skipped.length } })}`);
} catch (error) {
  console.log(`PHASE2_DRAFTS_JSON=${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}`);
  process.exitCode = 1;
}
