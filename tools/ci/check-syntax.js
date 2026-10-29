'use strict';

// Check tracked application/test/tool JavaScript without installing dependencies.
// Vendored upstream bundles keep their own validation and are not our source.
const { execFileSync, spawn } = require('node:child_process');

async function main() {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter((file) => /\.(?:js|cjs|mjs)$/.test(file) && !file.startsWith('public/vendor/'));
  if (!files.length) throw new Error('No tracked JavaScript files found; refusing an empty syntax check.');
  let next = 0;
  let failures = 0;
  async function worker() {
    while (next < files.length) {
      const file = files[next++];
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--check', file], { stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.on('data', (chunk) => { output += chunk; });
        child.once('error', reject);
        child.once('close', (code) => {
          if (code !== 0) {
            failures++;
            process.stderr.write(`Syntax check failed: ${file}\n${output}\n`);
          }
          resolve();
        });
      });
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log(`JavaScript syntax: ${files.length} checked, ${failures} failed.`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
