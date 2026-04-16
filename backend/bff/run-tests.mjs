import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function collectSpecFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSpecFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && absolutePath.endsWith('.spec.js')) {
      files.push(absolutePath);
    }
  }

  return files;
}

const distDirectory = join(process.cwd(), 'dist-test');
if (!statSync(distDirectory).isDirectory()) {
  throw new Error(`Compiled test directory not found: ${distDirectory}`);
}

const specFiles = collectSpecFiles(distDirectory);
if (specFiles.length === 0) {
  throw new Error(`No compiled spec files found under ${distDirectory}`);
}

const result = spawnSync(process.execPath, ['--test', ...specFiles], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
