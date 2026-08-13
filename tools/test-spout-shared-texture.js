'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const projectRoot = path.resolve(__dirname, '..');
const addonPath = process.env.ELITESAND_SPOUT_ADDON
  ? path.resolve(process.env.ELITESAND_SPOUT_ADDON)
  : path.join(projectRoot, '.local', 'spout-output-build', 'elitesand_spout_output.node');
const reportPath = path.join(projectRoot, '.local', 'spout-shared-texture-test-report.json');
const holdMs = Number.parseInt(process.env.ELITESAND_SPOUT_SHARED_TEXTURE_HOLD_MS || '0', 10);
const requestedFps = Number.parseInt(process.env.ELITESAND_SPOUT_SHARED_TEXTURE_FPS || '30', 10);
const faultMode = String(process.env.ELITESAND_SPOUT_SHARED_TEXTURE_FAULT || '').trim();
const gpuPreference = String(process.env.ELITESAND_SPOUT_GPU_PREFERENCE || '').trim();
const motionDiagnostic = process.env.ELITESAND_SPOUT_SHARED_TEXTURE_MOTION_DIAGNOSTIC === '1';
const senderName = String(process.env.ELITESAND_SPOUT_SENDER_NAME || 'Elitesand Pro Lyrics Dev').trim();
const targetFrames = 8;
const width = 1920;
const height = 1080;
const probePoints = [
  { x: 1100, y: 450, name: 'transparent' },
  { x: 200, y: 200, name: 'opaque-red' },
  { x: 560, y: 200, name: 'half-green' },
  { x: 920, y: 200, name: 'quarter-blue' },
];

if (!process.versions.electron) throw new Error('Run this test with Electron, not Node.');
if (!Number.isInteger(requestedFps) || requestedFps < 1 || requestedFps > 60) {
  throw new Error(`ELITESAND_SPOUT_SHARED_TEXTURE_FPS must be an integer from 1 to 60 (received ${process.env.ELITESAND_SPOUT_SHARED_TEXTURE_FPS || ''})`);
}
if (faultMode && !new Set(['invalid-send', 'window-close', 'renderer-crash']).has(faultMode)) {
  throw new Error(`Unknown ELITESAND_SPOUT_SHARED_TEXTURE_FAULT: ${faultMode}`);
}
if (gpuPreference && !new Set(['low-power', 'high-performance']).has(gpuPreference)) {
  throw new Error(`ELITESAND_SPOUT_GPU_PREFERENCE must be low-power, high-performance, or omitted (received ${gpuPreference})`);
}
if (gpuPreference === 'low-power') app.commandLine.appendSwitch('force_low_power_gpu');
if (gpuPreference === 'high-performance') app.commandLine.appendSwitch('force_high_performance_gpu');

// A crash test can leave Chromium cache files briefly locked. Keep every test
// process isolated so a following fault scenario does not report cache noise.
app.setPath('userData', path.join(projectRoot, '.local', 'spout-shared-texture-test-user-data', String(process.pid)));

function writeReport(payload) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function calibrationPage() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body,canvas { width:100%; height:100%; margin:0; overflow:hidden; background:transparent; }
  canvas { display:block; }
</style></head><body><canvas id="c" width="${width}" height="${height}"></canvas><script>
  const c = document.getElementById('c'); const x = c.getContext('2d');
  const motionDiagnostic = ${JSON.stringify(motionDiagnostic)};
  const expectedFps = ${requestedFps};
  let drawCalibration = true;
  window.__clearCalibration = () => new Promise((resolve) => {
    drawCalibration = false;
    // Resolve only after Chromium has had two animation turns to paint the
    // cleared canvas; the native worker then verifies that post-clear frame.
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
  function frame(t) {
    x.clearRect(0, 0, c.width, c.height);
    if (drawCalibration) {
    x.fillStyle = 'rgba(255,0,0,1)'; x.fillRect(120, 120, 240, 240);
    x.fillStyle = 'rgba(0,255,0,.5)'; x.fillRect(480, 120, 240, 240);
    x.fillStyle = 'rgba(0,0,255,.25)'; x.fillRect(840, 120, 240, 240);
    x.font = 'bold 96px Arial'; x.fillStyle = '#fff'; x.fillText('Elitesand Alpha Lab', 120, 600);
    x.font = 'bold 112px Arial'; x.fillStyle = '#00e5ff'; x.shadowColor = 'rgba(0,229,255,.72)'; x.shadowBlur = 28; x.fillText('SOFT GLOW', 120, 770); x.shadowBlur = 0;
    x.font = '64px Arial'; x.fillStyle = 'rgba(255,70,190,.5)'; x.fillText('50% alpha / translucent text', 120, 900);
    x.fillStyle = '#00ff40'; x.fillRect(1200, 120, 160, 160);
    x.fillStyle = 'rgba(255,255,255,.9)'; x.fillRect(20, 20, 2, 2);
    x.fillStyle = 'rgba(255,255,255,.9)'; x.fillRect(20 + (Math.floor(t / 250) % 8), 20, 1, 1);
    if (motionDiagnostic) {
      // Every compositor frame has an obvious, opaque change. This lets a
      // Shoost recording measure presentation cadence independently from the
      // sender's paint-event counter. It is test-only and never touches /display.
      const frameNumber = Math.floor(t * expectedFps / 1000);
      const markerX = 40 + ((frameNumber % 105) * 17);
      x.fillStyle = 'rgba(0,0,0,.68)'; x.fillRect(24, 920, 1872, 140);
      x.fillStyle = '#ffffff'; x.fillRect(40, 970, 1840, 4);
      x.fillStyle = '#00e5ff'; x.fillRect(markerX, 936, 64, 72);
      x.fillStyle = '#ffffff'; x.fillRect(markerX + 22, 908, 20, 128);
      x.font = 'bold 54px Arial'; x.fillStyle = '#ffffff';
      x.fillText('MOTION ' + expectedFps + '  FRAME ' + frameNumber, 40, 1040);
    }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
</script></body></html>`;
}

function summarizeTextureInfo(info) {
  const ntHandle = info?.handle?.ntHandle || info?.sharedTextureHandle;
  return {
    keys: Object.keys(info || {}).sort(),
    pixelFormat: info?.pixelFormat || null,
    codedSize: info?.codedSize || null,
    visibleRect: info?.visibleRect || null,
    ntHandleBytes: Buffer.isBuffer(ntHandle) ? ntHandle.length : null,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertCalibrationSamples(samples) {
  assert.equal(samples.length, probePoints.length, 'native probe must return every requested pixel');
  const byName = Object.fromEntries(samples.map((sample, index) => [probePoints[index].name, sample]));
  assert(byName.transparent.a <= 3, `transparent canvas must keep alpha 0 (actual ${byName.transparent.a})`);
  assert(byName['opaque-red'].r >= 250 && byName['opaque-red'].a >= 250, 'opaque red must preserve RGB and alpha');
  assert(byName['half-green'].a >= 120 && byName['half-green'].a <= 136, '50% green alpha must survive shared texture');
  assert(byName['half-green'].g >= 120 && byName['half-green'].g <= 136, 'premultiplied 50% green RGB must match alpha');
  assert(byName['quarter-blue'].a >= 56 && byName['quarter-blue'].a <= 72, '25% blue alpha must survive shared texture');
  assert(byName['quarter-blue'].b >= 56 && byName['quarter-blue'].b <= 72, 'premultiplied 25% blue RGB must match alpha');
}

async function run() {
  await app.whenReady();
  const addon = require(addonPath);

  let window = null;
  let received = 0;
  let released = 0;
  let sent = 0;
  let firstInfo = null;
  let firstSamples = null;
  let firstError = null;
  let handling = false;
  let senderStarted = false;
  let stopped = false;
  let clearRequested = false;
  let clearSent = false;
  let clearTargetSent = 0;
  let faultObserved = null;
  const pendingTextures = [];
  let releaseTimer = null;
  const releaseTexture = (texture) => {
    try { texture.release(); } finally { released += 1; }
  };
  const drainReleasedTextures = (force = false) => {
    const completed = force ? Number.POSITIVE_INFINITY : Number(addon.getStatus().sourceCopyCompletedSequence || 0);
    while (pendingTextures.length && pendingTextures[0].sequence <= completed) releaseTexture(pendingTextures.shift().texture);
  };
  let resolveFrames;
  let resolveClearFrame;
  const enoughFrames = new Promise((resolve) => { resolveFrames = resolve; });
  const clearFrame = new Promise((resolve) => { resolveClearFrame = resolve; });

  try {
    window = new BrowserWindow({
      width,
      height,
      useContentSize: true,
      enableLargerThanScreen: true,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        offscreen: { useSharedTexture: true },
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    // Windows constrains a hidden native window to the work area on some
    // desktops (e.g. 1040 px with a 40 px taskbar). Move it above the work
    // area before setting content size so the offscreen surface remains the
    // requested 1920 x 1080 calibration canvas.
    window.setPosition(0, -40);
    window.setContentSize(width, height);
    window.webContents.setFrameRate(requestedFps);
    window.webContents.on('paint', (event) => {
      const texture = event?.texture;
      if (!texture || handling || firstError) return;
      handling = true;
      received += 1;
      let deferRelease = false;
      try {
        drainReleasedTextures();
        const textureInfo = texture.textureInfo;
        if (!firstInfo) firstInfo = summarizeTextureInfo(textureInfo);
        if (!senderStarted) {
          const codedSize = textureInfo?.codedSize;
          assert(Number.isInteger(codedSize?.width) && Number.isInteger(codedSize?.height), 'shared texture must report codedSize');
          const running = addon.create({
            senderName,
            width: codedSize.width,
            height: codedSize.height,
            adapterPreference: gpuPreference,
          });
          assert.equal(running.state, 'running');
          senderStarted = true;
        }
        const result = addon.send({ ...textureInfo, probePoints });
        assert.equal(result.accepted, true, 'native addon must accept Electron shared texture');
        if (faultMode === 'invalid-send' && !faultObserved) {
          try {
            addon.send({ ...textureInfo, pixelFormat: 'rgba' });
          } catch (error) {
            faultObserved = { kind: faultMode, code: error.code || null, message: error.message || String(error) };
          }
          assert.equal(faultObserved?.code, 'UNSUPPORTED_TEXTURE_FORMAT', 'native addon must reject a bad texture format safely');
        }
        sent += 1;
        if (result.deferredRelease === true && Number.isSafeInteger(result.sourceSequence)) {
          pendingTextures.push({ texture, sequence: result.sourceSequence });
          deferRelease = true;
        }
        if (clearRequested && !clearSent && sent >= clearTargetSent && result.code === 'SPOUT_FRAME_QUEUED') {
          clearSent = true;
          resolveClearFrame();
        }
        if (sent >= targetFrames) resolveFrames();
      } catch (error) {
        firstError = error;
        resolveFrames();
      } finally {
        if (!deferRelease) releaseTexture(texture);
        handling = false;
      }
    });
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(calibrationPage())}`);
    releaseTimer = setInterval(drainReleasedTextures, 8);
    await Promise.race([enoughFrames, delay(15000)]);
    if (firstError) throw firstError;
    assert(sent >= targetFrames, `expected ${targetFrames} shared-texture frames, got ${sent}`);
    if (Number.isSafeInteger(holdMs) && holdMs > 0) await delay(holdMs);
    assert.equal(addon.waitForIdle(5000), true, 'worker must drain the queued shared-texture frames');
    drainReleasedTextures();
    assert.equal(received, released, 'every received Electron texture must be released after the native source copy completes');
    firstSamples = addon.getLastProbeSamples();
    assertCalibrationSamples(firstSamples);
    if (faultMode === 'window-close') {
      window.destroy();
      window = null;
      faultObserved = { kind: faultMode, closed: true };
    } else if (faultMode === 'renderer-crash') {
      const rendererGone = new Promise((resolve) => window.webContents.once('render-process-gone', (_event, details) => resolve(details)));
      window.webContents.forcefullyCrashRenderer();
      const details = await Promise.race([rendererGone, delay(5000).then(() => null)]);
      assert(details, 'forced renderer crash must emit render-process-gone');
      faultObserved = { kind: faultMode, reason: details.reason || null, exitCode: details.exitCode ?? null };
    } else {
      await window.webContents.executeJavaScript('window.__clearCalibration()');
      // Let the renderer commit the cleared canvas before treating a queued
      // frame as the explicit clear marker; an already-dispatched paint event
      // may still refer to the pre-clear backing texture.
      await delay(150);
      clearTargetSent = sent + 1;
      clearRequested = true;
      window.webContents.invalidate?.();
      const invalidateTimer = setInterval(() => window?.webContents.invalidate?.(), 50);
      await Promise.race([clearFrame, delay(5000)]);
      clearInterval(invalidateTimer);
      assert(clearSent, 'must send one fully transparent frame before stopping the sender');
      assert.equal(addon.waitForIdle(5000), true, 'worker must drain the transparent clear frame');
      const clearedMarker = addon.getLastProbeSamples()?.[1];
      assert(clearedMarker?.a <= 3, `transparent clear frame must reach the bridge before stop (actual alpha ${clearedMarker?.a}; ${JSON.stringify(addon.getStatus())})`);
    }
    const statusBeforeStop = addon.getStatus();
    const statusAfterStop = addon.stop();
    drainReleasedTextures(true);
    stopped = true;
    assert.equal(statusAfterStop.state, 'idle', 'native sender must be idle after the test cleanup');
    if (window && !window.isDestroyed()) window.destroy();
    window = null;
    writeReport({ ok: true, electron: process.versions.electron, requestedFps, holdMs, motionDiagnostic, received, released, sent, firstInfo, firstSamples, statusBeforeStop, statusAfterStop, clearSent, faultObserved });
    console.log(JSON.stringify({ ok: true, requestedFps, holdMs, motionDiagnostic, received, released, sent, firstInfo, firstSamples, statusBeforeStop, statusAfterStop, clearSent, faultObserved }));
  } finally {
    if (releaseTimer) clearInterval(releaseTimer);
    if (window && !window.isDestroyed()) window.destroy();
    if (!stopped) addon.stop();
    drainReleasedTextures(true);
  }
}

run()
  .then(() => app.quit())
  .catch((error) => {
    writeReport({ ok: false, electron: process.versions.electron, error: error.stack || String(error) });
    console.error('[Spout shared texture test]', error.stack || error);
    app.exit(1);
  });
