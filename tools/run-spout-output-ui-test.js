'use strict';

// Keep the cleanup outside Electron: on Windows, Crashpad can retain a handle
// until the Electron child process has completely exited.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-spout-ui-'));
const electronBinary = require('electron');
const child = spawn(electronBinary, ['tools/test-spout-output-ui.js'], {
  cwd: projectRoot,
  env: { ...process.env, ELITESAND_SPOUT_UI_TEST_RUNTIME: runtimeRoot },
  stdio: 'inherit',
  windowsHide: true,
});

child.once('error', finish);
child.once('exit', (code) => finish(code ? new Error(`Electron UI test exited with ${code}`) : null));

let finished = false;
function finish(error) {
  if (finished) return;
  finished = true;
  try {
    fs.rmSync(runtimeRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (cleanupError) {
    process.stderr.write(`Spout output UI test cleanup failed: ${cleanupError.stack || cleanupError.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (error) {
    process.stderr.write(`Spout output UI test failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
