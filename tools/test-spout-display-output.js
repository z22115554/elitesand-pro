'use strict';

const assert = require('assert');
const path = require('path');
const { app, BrowserWindow, utilityProcess, dialog, shell, Tray, Menu, nativeImage, clipboard, powerSaveBlocker, ipcMain } = require('electron');
const { createElectronShell } = require('../electron/shell');

const projectRoot = path.resolve(__dirname, '..');
const port = Number.parseInt(process.env.ELITESAND_SPOUT_DISPLAY_TEST_PORT || '3218', 10);
const userDataPath = path.join(projectRoot, '.local', 'spout-display-output-test-user-data', String(process.pid));
const deadlineMs = Number.parseInt(process.env.ELITESAND_SPOUT_DISPLAY_TEST_TIMEOUT_MS || '15000', 10);

app.commandLine.appendSwitch('force-device-scale-factor', '1');
if (process.env.ELITESAND_SPOUT_GPU_PREFERENCE === 'low-power') app.commandLine.appendSwitch('force_low_power_gpu');
if (process.env.ELITESAND_SPOUT_GPU_PREFERENCE === 'high-performance') app.commandLine.appendSwitch('force_high_performance_gpu');

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await delay(100);
  }
  return null;
}

async function run() {
  const desktop = createElectronShell({
    app,
    BrowserWindow,
    utilityProcess,
    dialog,
    shell,
    Tray,
    Menu,
    nativeImage,
    clipboard,
    powerSaveBlocker,
    ipcMain,
    projectRoot,
    shellRoot: projectRoot,
    port,
    headless: true,
    userDataPath,
    spoutDisplayAutostart: true,
    processObject: process,
  });

  try {
    const started = await desktop.start();
    assert.equal(started.started, true, 'Electron shell must start');
    const status = await waitFor(() => {
      const current = desktop.getState().spout?.output;
      return current?.state === 'running' && current.framesSent >= 1 ? current : null;
    }, deadlineMs);
    assert(status, `existing /display must render and send at least 1 Spout frame within ${deadlineMs}ms; last status=${JSON.stringify(desktop.getState().spout)}`);
    assert.equal(status.framesReceived, status.framesReleased, 'every /display shared texture must be released');
    assert.equal(status.native?.state, 'running', 'native sender must be running');
    for (const metric of ['lastGpuSyncMs', 'avgGpuSyncMs', 'maxGpuSyncMs', 'gpuSyncTimeouts']) {
      assert(Number.isFinite(status.native?.[metric]), `native status must expose a numeric ${metric} metric`);
    }
    assert(status.native.lastGpuSyncMs >= 0 && status.native.avgGpuSyncMs >= 0 && status.native.maxGpuSyncMs >= 0,
      'GPU synchronization timings must never be negative');
    assert(status.native.gpuSyncTimeouts === 0, 'a normal /display send must not time out waiting for GPU synchronization');
    console.log(JSON.stringify({ ok: true, port, reusedServer: started.reused, status }));
  } finally {
    await desktop.shutdown();
  }
}

run()
  .then(() => app.quit())
  .catch((error) => {
    console.error('[Spout display output test]', error.stack || error);
    app.exit(1);
  });
