'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const projectRoot = path.resolve(__dirname, '..');
const addonPath = process.env.ELITESAND_SPOUT_ADDON
  || path.join(projectRoot, '.local', 'spout-output-build', 'elitesand_spout_output.node');
const reportPath = process.env.ELITESAND_SPOUT_TEST_REPORT
  || path.join(projectRoot, '.local', 'spout-native-addon-test-report.json');
const loadOnly = process.env.ELITESAND_SPOUT_LOAD_ONLY === '1';
const holdMs = Number.parseInt(process.env.ELITESAND_SPOUT_HOLD_MS || '0', 10);
const cycles = Number.parseInt(process.env.ELITESAND_SPOUT_CYCLES || '100', 10);

if (!process.versions.electron) {
  throw new Error('Run this test with Electron, not Node.');
}

app.setPath('userData', path.join(projectRoot, '.local', 'spout-native-addon-test-user-data'));

function writeReport(payload) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function writePhase(phase, extra = {}) {
  writeReport({
    phase,
    addonPath,
    electron: process.versions.electron,
    nodeOptions: process.env.NODE_OPTIONS || '',
    execArgv: process.execArgv,
    ...extra,
  });
}

writePhase('script-started');

async function run() {
  await app.whenReady();
  writePhase('electron-ready');
  const addon = require(addonPath);
  writePhase('addon-loaded');
  if (loadOnly) return;
  try {
    assert.equal(addon.getStatus().state, 'idle', 'addon must start idle');
    assert.throws(
      () => addon.create({ senderName: 'bad width', width: 639, height: 1080 }),
      (error) => error && error.code === 'INVALID_SPOUT_DIMENSIONS',
      'invalid dimensions must become a structured Node-API error',
    );
    assert.throws(
      () => addon.create({ senderName: '歌詞', width: 1920, height: 1080 }),
      (error) => error && error.code === 'INVALID_SPOUT_SENDER_NAME',
      'invalid sender names must become a structured Node-API error',
    );
    assert.equal(addon.getStatus().state, 'idle', 'rejected create must not leave a sender behind');
    const running = addon.create({
      senderName: 'Elitesand Pro Lyrics Dev',
      width: 1920,
      height: 1080,
    });
    writePhase('sender-created', { running });
    assert.equal(running.state, 'running', 'native sender must enter running state');
    assert.equal(running.textureBridge, true, 'CP03 shared-texture bridge capability must be visible in native status');
    const repeatedCreate = addon.create({
      senderName: 'Elitesand Pro Lyrics Dev',
      width: 1920,
      height: 1080,
    });
    assert.equal(repeatedCreate.state, 'running', 'matching create must reuse the one sender');
    assert.throws(
      () => addon.send({ pixelFormat: 'bgra', codedSize: { width: 1920, height: 1080 } }),
      (error) => error && error.code === 'INVALID_TEXTURE_HANDLE',
      'native sender must reject a missing Electron shared texture handle',
    );
    if (Number.isSafeInteger(holdMs) && holdMs > 0) {
      writePhase('sender-visible-for-manual-test', { running, holdMs });
      console.log(`[Spout native addon test] sender is visible for ${holdMs} ms: ${running.senderName}`);
      await new Promise((resolve) => setTimeout(resolve, holdMs));
    }
    const stopped = addon.stop();
    writePhase('sender-stopped', { stopped });
    assert.equal(stopped.state, 'idle', 'stop must release the native sender');
    assert.equal(addon.stop().state, 'idle', 'native stop must be idempotent');
    assert(Number.isSafeInteger(cycles) && cycles >= 1 && cycles <= 100, 'cycles must be an integer from 1 to 100');
    for (let index = 0; index < cycles; index += 1) {
      const cycle = addon.create({
        senderName: 'Elitesand Pro Lyrics Dev',
        width: 1920,
        height: 1080,
      });
      assert.equal(cycle.state, 'running', `cycle ${index + 1} must create a sender`);
      assert.equal(addon.stop().state, 'idle', `cycle ${index + 1} must stop cleanly`);
    }
    assert.equal(addon.getStatus().state, 'idle', 'all cycles must finish without an orphan sender');
    console.log(JSON.stringify({ ok: true, addonPath, running, stopped }));
  } finally {
    try { addon.stop(); } catch (_) { /* cleanup hook remains the final safeguard */ }
  }
}

run()
  .then(() => {
    writeReport({ ok: true, phase: 'complete', addonPath, electron: process.versions.electron });
    app.quit();
  })
  .catch((error) => {
    writeReport({ ok: false, addonPath, electron: process.versions.electron, error: error.stack || String(error) });
    console.error('[Spout native addon test]', error.stack || error);
    app.exit(1);
  });
