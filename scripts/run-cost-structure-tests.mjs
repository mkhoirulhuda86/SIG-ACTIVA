import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

async function collectTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTests(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) files.push(fullPath);
  }
  return files;
}

const roots = [path.resolve('lib/cost-structure'), path.resolve('lib/cost-fluctuation'), path.resolve('lib/fluktuasi')];
const tests = (await Promise.all(roots.map(collectTests))).flat().sort();
if (tests.length === 0) {
  console.error('No Cost Structure tests found.');
  process.exit(1);
}

const env = {
  ...process.env,
  TS_NODE_COMPILER_OPTIONS: JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' }),
};
const result = spawnSync(process.execPath, ['-r', 'ts-node/register', '--test', ...tests], {
  stdio: 'inherit',
  env,
});
process.exit(result.status ?? 1);
