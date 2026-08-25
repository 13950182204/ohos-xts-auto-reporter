import process from 'node:process';
import { DEFAULT_WORKBOOK_PATH, createPhase2Workbook } from './phase2_logic.mjs';

function parseArgs(argv) {
  const options = { output: DEFAULT_WORKBOOK_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--output requires a value');
      }
      options.output = value;
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: create_phase2_workbook.mjs [--output ABSOLUTE_PATH]');
  } else {
    const output = await createPhase2Workbook(options.output);
    console.log(`第二阶段模板已创建: ${output}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
