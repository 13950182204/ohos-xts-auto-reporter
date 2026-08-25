import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'lib', 'client-build', 'client.cjs');
const output = path.join(root, 'lib', 'client.js');
const body = await fs.readFile(input, 'utf8');
const indented = body.split('\n').map((line) => `    ${line}`).join('\n');
const bundle = `window.__ModuleLoader__.load({\n\tid: 'ohos-xts-auto-reporter',\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n${indented}\n\t\treturn module.exports;\n\t},\n});\n`;
await fs.writeFile(output, bundle, 'utf8');
await fs.rm(path.join(root, 'lib', 'client-build'), { recursive: true, force: true });
