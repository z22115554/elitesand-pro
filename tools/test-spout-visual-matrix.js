'use strict';

// CP06 visual-matrix harness. It drives the existing /display preview runtime
// through its supported preview messages, then sends that exact renderer via
// the regular shared-texture Spout bridge. It never writes song data, template
// settings, or server state.
const assert = require('assert');
const path = require('path');
const {
  app, BrowserWindow, utilityProcess, dialog, shell, Tray, Menu,
  nativeImage, clipboard, powerSaveBlocker, ipcMain,
} = require('electron');
const { createElectronShell } = require('../electron/shell');
const { createSpoutDisplayOutput, loadSpoutAddon } = require('../electron/spout-display-output');

const projectRoot = path.resolve(__dirname, '..');
const port = Number.parseInt(process.env.ELITESAND_SPOUT_VISUAL_TEST_PORT || '3230', 10);
const dwellMs = Math.max(250, Number.parseInt(process.env.ELITESAND_SPOUT_VISUAL_DWELL_MS || '700', 10));
const requestedFps = Number.parseInt(process.env.ELITESAND_SPOUT_VISUAL_FPS || '30', 10);
const requestedTemplate = String(process.env.ELITESAND_SPOUT_VISUAL_TEMPLATE || '').trim();
const senderName = String(process.env.ELITESAND_SPOUT_SENDER_NAME || 'Elitesand Pro Lyrics Visual Matrix').trim();
const gpuPreference = String(process.env.ELITESAND_SPOUT_GPU_PREFERENCE || '').trim();
const userDataPath = path.join(projectRoot, '.local', 'spout-visual-matrix-test-user-data', String(process.pid));

const templateSettings = {
  classic: { template: 'classic', fontSize: 56, color: '#f5f5f5', activeColor: '#00e5ff', verticalPosition: 'flex-end', historyOpacity: 0.45, shadow: '0 3px 12px rgba(0,0,0,.75)' },
  pulse: { template: 'pulse', fontSize: 50, color: '#ddfe9f', activeColor: '#38ff45', verticalPosition: 'center', historyOpacity: 0.45, glow: '0 0 18px rgba(56,255,69,.78)' },
  facet: { template: 'facet', fontSize: 45, color: '#e3d8ff', activeColor: '#8c4dff', verticalPosition: 'center', historyOpacity: 0.45, glow: '0 0 18px rgba(140,77,255,.75)' },
  drift: { template: 'drift', fontSize: 45, color: '#c0ff38', activeColor: '#ffc800', verticalPosition: 'center', animationIntensity: 'calm', historyOpacity: 0.45, glow: '0 0 18px rgba(255,200,0,.72)' },
  aura: { template: 'aura', fontSize: 72, color: '#ffffff', activeColor: '#14a5ff', verticalPosition: 'center', historyOpacity: 0.45, glow: '0 0 24px rgba(20,165,255,.85)' },
  ktv: { template: 'ktv', fontSize: 40, color: '#ffffff', activeColor: '#00d5ff', verticalPosition: 'center', historyOpacity: 0.45, glow: '0 0 15px rgba(0,213,255,.8)' },
  columnflow: { template: 'columnflow', fontFamily: "'Noto Serif TC', 'PMingLiU', serif", fontWeight: 600, fontSize: 48, color: '#f4efe5', activeColor: '#f0c978', shadow: '0 1px 7px rgba(0,0,0,.72)', verticalPosition: 'center', columnflowVariant: 'sen', columnflowPlacement: 'split', columnflowMaxLines: 4, historyOpacity: 0.45 },
  paperstrip: { template: 'paperstrip', fontWeight: 600, fontSize: 56, color: '#111111', activeColor: '#111111', shadow: 'none', verticalPosition: 'center', lyricPosition: 'center', letterSpacing: 1, historyOpacity: 0.45 },
  mirror: { template: 'mirror', fontWeight: 900, fontSize: 60, color: '#ffffff', activeColor: '#ffffff', shadow: '0 0 14px rgba(255,255,255,.55)', verticalPosition: 'center', lyricPosition: 'split', stageSafeMargin: 13, letterSpacing: 1, animationIntensity: 'normal', historyOpacity: 0.45 },
};
const templateIds = requestedTemplate ? [requestedTemplate] : Object.keys(templateSettings);
if (templateIds.some((template) => !templateSettings[template])) {
  throw new Error(`Unknown CP06 visual-matrix template: ${requestedTemplate}`);
}
if (!Number.isInteger(requestedFps) || requestedFps < 15 || requestedFps > 60) {
  throw new Error(`ELITESAND_SPOUT_VISUAL_FPS must be an integer from 15 to 60 (received ${process.env.ELITESAND_SPOUT_VISUAL_FPS || ''})`);
}
if (gpuPreference && !new Set(['low-power', 'high-performance']).has(gpuPreference)) {
  throw new Error(`ELITESAND_SPOUT_GPU_PREFERENCE must be low-power, high-performance, or omitted (received ${gpuPreference})`);
}

app.commandLine.appendSwitch('force-device-scale-factor', '1');
if (gpuPreference === 'low-power') app.commandLine.appendSwitch('force_low_power_gpu');
if (gpuPreference === 'high-performance') app.commandLine.appendSwitch('force_high_performance_gpu');

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitFor(predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await delay(50);
  }
  return null;
}

async function applyTemplate(outputWindow, template) {
  const settings = templateSettings[template];
  const result = await outputWindow.webContents.executeJavaScript(`new Promise((resolve) => {
    window.postMessage({ type: 'lyric-settings:preview', settings: ${JSON.stringify(settings)} }, '*');
    window.postMessage({ type: 'lyrics-preview:sample' }, '*');
    window.setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      resolve({
        template: typeof LyricTemplates !== 'undefined' ? LyricTemplates.get('${template}')?.id || null : null,
        childCount: document.getElementById('lyrics-container')?.childElementCount || 0,
        text: document.getElementById('lyrics-container')?.textContent?.trim() || '',
      });
    })), 120);
  })`);
  assert.equal(result.template, template, `${template} must be registered in the delivered /display runtime`);
  assert(result.childCount > 0, `${template} must mount visible lyric DOM`);
  assert(result.text.length > 0, `${template} must render the fixed preview lyric sample`);
  return result;
}

async function measureRendererAnimationFrames(outputWindow, durationMs) {
  return outputWindow.webContents.executeJavaScript(`new Promise((resolve) => {
    const startedAt = performance.now();
    let frames = 0;
    function tick(now) {
      frames += 1;
      if (now - startedAt >= ${Math.max(250, dwellMs)}) {
        resolve({ frames, elapsedMs: now - startedAt });
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  })`);
}

async function run() {
  const desktop = createElectronShell({
    app, BrowserWindow, utilityProcess, dialog, shell, Tray, Menu,
    nativeImage, clipboard, powerSaveBlocker, ipcMain,
    projectRoot,
    shellRoot: projectRoot,
    port,
    headless: true,
    userDataPath,
    processObject: process,
  });
  let outputWindow = null;
  const rendererErrors = [];
  const results = [];
  let output = null;

  try {
    const started = await desktop.start();
    assert.equal(started.started, true, 'visual matrix server shell must start');
    output = createSpoutDisplayOutput({
      BrowserWindow,
      addon: loadSpoutAddon(projectRoot, process.env.ELITESAND_SPOUT_NATIVE_ADDON || ''),
      port,
      senderName,
      width: 1920,
      height: 1080,
      fps: requestedFps,
      nativeAdapterPreference: gpuPreference,
      displayPath: '/display?output=spout&preview=1',
      onWindowCreated(window) {
        outputWindow = window;
        window.webContents.on('console-message', (_event, level, message) => {
          // Chromium emits this third-party Web Audio deprecation as a warning
          // for every display page. CP06 needs renderer errors, not that known
          // browser warning (the app's audio element stays muted here).
          if (level >= 3 && !String(message).includes('ScriptProcessorNode is deprecated')) {
            rendererErrors.push(String(message));
          }
        });
      },
    });
    await output.start();
    const running = await waitFor(() => output.getStatus().state === 'running' && output.getStatus().framesSent >= 1);
    assert(running, 'visual matrix must start the shared /display Spout bridge');
    assert(outputWindow && !outputWindow.isDestroyed(), 'visual matrix needs its offscreen /display window');

    for (const template of templateIds) {
      const frameStart = output.getStatus().framesSent;
      const rendered = await applyTemplate(outputWindow, template);
      const measurementStartedAt = Date.now();
      const rendererAnimation = await measureRendererAnimationFrames(outputWindow, dwellMs);
      const status = output.getStatus();
      assert(status.framesSent > frameStart, `${template} must send frames after rendering its preview sample`);
      const measuredMs = Math.max(1, Date.now() - measurementStartedAt);
      const framesDuringDwell = status.framesSent - frameStart;
      results.push({
        template,
        rendered,
        requestedFps,
        framesSent: status.framesSent,
        framesDuringDwell,
        measuredMs,
        measuredFps: Math.round((framesDuringDwell * 1000 / measuredMs) * 10) / 10,
        rendererAnimation,
        rendererFps: Math.round((rendererAnimation.frames * 1000 / rendererAnimation.elapsedMs) * 10) / 10,
        framesDropped: status.native?.framesDropped || 0,
      });
      console.log(JSON.stringify({ phase: 'template', template, dwellMs, status }));
    }

    assert.equal(rendererErrors.length, 0, `display runtime errors during matrix: ${rendererErrors.join(' | ')}`);
    console.log(JSON.stringify({
      ok: true,
      implementation: 'cp06-display-preview-through-shared-spout-bridge',
      senderName,
      port,
      dwellMs,
      requestedFps,
      results,
      finalStatus: output.getStatus(),
    }));
  } finally {
    if (output) await output.stop();
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) window.destroy();
    });
    await desktop.shutdown();
  }
}

run()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error('[Spout visual matrix test]', error.stack || error);
    app.exit(1);
  });
