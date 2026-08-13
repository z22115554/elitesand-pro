'use strict';

// CP05 rendered Electron-panel check. This deliberately starts no sender:
// it verifies that the opt-in control exists only inside the native shell and
// that saving a preference remains in that shell's isolated userData folder.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  app, BrowserWindow, utilityProcess, dialog, shell, Tray, Menu,
  nativeImage, clipboard, powerSaveBlocker, ipcMain,
} = require('electron');
const { createElectronShell } = require('../electron/shell');
const settings = require('../electron/spout-settings');

const projectRoot = path.resolve(__dirname, '..');
const runtimeRoot = process.env.ELITESAND_SPOUT_UI_TEST_RUNTIME
  ? path.resolve(process.env.ELITESAND_SPOUT_UI_TEST_RUNTIME)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-spout-ui-'));
const userDataPath = path.join(runtimeRoot, 'user-data');
const port = 39200 + Math.floor(Math.random() * 500);
const processObject = Object.create(process);
processObject.env = { ...process.env, ELITESAND_SPOUT_EXPERIMENT: '1' };

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
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
    processObject,
  });

  try {
    await desktop.start();
    await delay(250);
    const panel = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
    assert(panel, 'Electron main panel must exist');
    const surface = await panel.webContents.executeJavaScript(`(() => ({
      hidden: document.getElementById('spout-output-card')?.hidden,
      title: document.getElementById('spout-output-title')?.textContent?.trim(),
      hasFixedApi: !!window.ElitesandShell?.spout
        && ['getStatus', 'getIssueDiagnostics', 'saveSettings', 'start', 'stop'].every((key) => typeof window.ElitesandShell.spout[key] === 'function'),
      hasManualRecorder: !!document.getElementById('spout-recording-start') || !!document.getElementById('spout-recording-stop'),
      hasSpoutFeedbackType: !!document.querySelector('#feedback-type option[value="spout"]'),
      startDisabled: document.getElementById('spout-output-start')?.disabled,
      stopDisabled: document.getElementById('spout-output-stop')?.disabled,
    }))()`);
    assert.equal(surface.hidden, false, 'Spout card must be visible in Electron only');
    assert.equal(surface.hasFixedApi, true, 'renderer must receive only the fixed Spout API');
    assert.equal(surface.hasManualRecorder, false, 'manual Spout recorder controls must not remain');
    assert.equal(surface.hasSpoutFeedbackType, true, 'feedback form must offer a dedicated Spout type');
    assert.equal(surface.startDisabled, false, 'Spout output must not auto-start');
    assert.equal(surface.stopDisabled, true, 'stop must be disabled before a sender exists');
    const localizedTitles = await panel.webContents.executeJavaScript(`(() => {
      return window.I18n.LOCALES.map((locale) => {
        window.I18n.setLocale(locale);
        return { locale, title: document.getElementById('spout-output-title')?.textContent?.trim() || '' };
      });
    })()`);
    assert.equal(localizedTitles.length, 5, 'five locales must render the Spout control');
    assert(localizedTitles.every(({ title }) => title.length > 0), 'every localized Spout title must be visible');
    await panel.webContents.executeJavaScript("window.I18n.setLocale('zh-TW')");

    const saveResult = await panel.webContents.executeJavaScript(`window.ElitesandShell.spout.saveSettings({
      senderName: 'Elitesand UI Check', width: 1280, height: 720, fps: 60,
    })`);
    assert.equal(saveResult.options.senderName, 'Elitesand UI Check');
    assert.equal(settings.load(userDataPath).width, 1280, 'settings must stay under isolated userData');
    process.stdout.write(`Spout output UI check passed: ${surface.title}; five locales, isolated settings, and no sender auto-started.\n`);
  } finally {
    await desktop.shutdown();
    BrowserWindow.getAllWindows().forEach((window) => { if (!window.isDestroyed()) window.destroy(); });
    // The npm wrapper removes this exact folder after Electron exits. Doing it
    // here races Electron's Crashpad handle on Windows.
  }
}

main().then(() => app.exit(0)).catch((error) => {
  process.stderr.write(`Spout output UI check failed: ${error.stack || error.message}\n`);
  app.exit(1);
});
