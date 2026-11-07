import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { PHASE2_WORKBOOK_NAME, ensureWorkbookWritable, readWorkbookMeta, rewriteWorkbookLayout } from './phase2_logic.mjs';

function parseArgs(argv) {
  const value = (name) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] || '' : ''; };
  const input = value('--input') || value('--workbook');
  if (!input || input.startsWith('--')) throw new Error('请用 --input 指定工作簿或设备目录。');
  return { input };
}

async function isDirectory(target) {
  try { return (await fs.stat(target)).isDirectory(); } catch { return false; }
}

async function workbookFiles(input) {
  if (!await isDirectory(input)) return [input];
  if (!await fs.access(path.join(input, PHASE2_WORKBOOK_NAME)).then(() => true).catch(() => false)) {
    throw new Error(`目录里没有 ${PHASE2_WORKBOOK_NAME}：${input}`);
  }
  return [path.join(input, PHASE2_WORKBOOK_NAME)];
}

async function backup(file) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const target = `${file}.${stamp}.bak`;
  await fs.copyFile(file, target);
  return target;
}

try {
  const { input } = parseArgs(process.argv.slice(2));
  if (!await fs.access(input).then(() => true).catch(() => false)) throw new Error(`路径不存在：${input}`);
  const files = await workbookFiles(input);
  const results = [];
  for (const file of files) {
    await ensureWorkbookWritable(file);
    const saved = await backup(file);
    const meta = await readWorkbookMeta(file);
    await rewriteWorkbookLayout(file);
    results.push({ file, backup: saved, sheet: meta.sheetName, name: meta.name });
  }
  console.log(JSON.stringify({ ok: true, results }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
