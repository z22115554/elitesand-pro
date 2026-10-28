#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(path.join(root, 'tests'))
  .filter((name) => /^practice-.*\.test\.js$/.test(name)).sort()
  .map((name) => path.join('tests', name));
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status || 1);
}
run(process.execPath, ['--test', ...files]);
const python = process.env.ELITESAND_TEST_PYTHON || process.env.ELITESAND_AI_PYTHON
  || process.env.CODEX_PRIMARY_RUNTIME_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
run(python, ['tests/practice_pitch_worker_test.py']);
