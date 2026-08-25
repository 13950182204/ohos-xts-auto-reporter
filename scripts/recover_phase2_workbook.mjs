import ExcelJS from 'exceljs';
import path from 'node:path';
import { toWslPath } from './phase2_logic.mjs';

const argv = process.argv.slice(2);
const index = argv.indexOf('--workbook');
const requested = index >= 0 ? argv[index + 1] : '';
const applicationIdArg = argv.includes('--application-id') ? argv[argv.indexOf('--application-id') + 1] : '';
const assessmentNumberArg = argv.includes('--assessment-number') ? argv[argv.indexOf('--assessment-number') + 1] : '';
if (!requested || argv.includes('--help') || argv.includes('-h')) {
  console.error('Usage: recover_phase2_workbook.mjs --workbook ABSOLUTE_XLSX');
  process.exit(2);
}
const sourcePath = toWslPath(requested);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(sourcePath);
const sheets = ['模组开发板', '发行版', '商用设备'];
let changed = false;
for (const sheetName of sheets) {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) continue;
  const applicationId = String(sheet.getCell('F3').text || '').trim();
  const assessmentNumber = String(sheet.getCell('B4').text || '').trim();
  const status = String(sheet.getCell('B3').text || '').trim();
  if (status === '需人工处理' || (applicationIdArg && assessmentNumberArg && status === '待处理')) {
    if ((applicationId && applicationId !== applicationIdArg) || (assessmentNumber && assessmentNumber !== assessmentNumberArg)) {
      throw new Error(`${sheetName} 已有申请标识或测评编号，禁止自动恢复。`);
    }
    sheet.getCell('B3').value = '待处理';
    sheet.getCell('F4').value = '';
    sheet.getCell('B5').value = '已人工确认上次流程未取得申请标识，允许重新执行。';
    if (applicationIdArg) sheet.getCell('F3').value = applicationIdArg;
    if (assessmentNumberArg) sheet.getCell('B4').value = assessmentNumberArg;
    changed = true;
  }
}
if (!changed) throw new Error('未发现可安全恢复的“需人工处理”工作表。');
await workbook.xlsx.writeFile(sourcePath);
console.log(JSON.stringify({ ok: true, workbook: path.basename(sourcePath), message: '已恢复为待处理。' }));
