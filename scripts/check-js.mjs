import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.argv[2] || '/source');
const ignored = new Set(['node_modules', 'pi-ollama-main', '.git', 'archive']);
let checked = 0;
function check(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) check(file);
    else if (/\.(?:mjs|js)$/.test(entry.name)) {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
      checked++;
    }
  }
}
try {
  for (const directory of ['pi-agent', 'pi-telegram', 'shared', 'scripts']) check(path.join(root, directory));
  console.log(`JavaScript syntax: ${checked} files checked`);
} catch (error) {
  process.stderr.write(error.stderr || error.message);
  process.exitCode = 1;
}
