'use strict';

const path = require('path');
const electron = require('electron');
const { app } = electron;
const { inspectUpdateLock } = require('./update-in-progress-lock');

// Electron resolves and caches the 'userData' special path from app.name the
// first time anything calls app.getPath('userData')/app.getPath('exe') touches
// path setup; a later app.setName() (shell.js start()) cannot change it
// afterwards. Without this, the media-preservation getPath('userData') call
// below runs first, locking userData to the package.json "name" default
// ("elitesand-pro") instead of the intended "Elitesand Pro" — silently
// pointing the whole app at an empty profile on every launch.
const isSpoutExperiment = process.env.ELITESAND_SPOUT_EXPERIMENT === '1';
app.setName(isSpoutExperiment ? 'Elitesand Pro Spout Lab' : 'Elitesand Pro');
app.setAppUserModelId?.(isSpoutExperiment ? 'com.elitesand.pro.spout-lab' : 'com.elitesand.pro');

// CP04's offscreen test window has an explicitly requested pixel canvas.
// On a high-DPI desktop Electron otherwise reports the shared texture in DIPs
// (for example 1280x720 for a requested 1920x1080), which is unsafe to pass
// to a native sender configured for the requested output. This is development
// opt-in only; normal Electron and OBS launches retain their existing DPI.
if (process.env.ELITESAND_SPOUT_DISPLAY_AUTOSTART === '1') {
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
}
// CP07 mixed-GPU measurement only. This is never persisted or exposed in the
// product UI; the native sender receives the matching preference separately.
if (process.env.ELITESAND_SPOUT_GPU_PREFERENCE === 'low-power') {
  app.commandLine.appendSwitch('force_low_power_gpu');
} else if (process.env.ELITESAND_SPOUT_GPU_PREFERENCE === 'high-performance') {
  app.commandLine.appendSwitch('force_high_performance_gpu');
}

const isPackaged = app.isPackaged;
const updateBlocked = isPackaged && inspectUpdateLock(app.getPath('exe')).active;

// During updater-v2 handoff the original Electron host has already exited, so
// the normal single-instance lock no longer protects the replacement window.
// A shortcut click here must exit immediately: keeping another Electron process
// alive (even just to show a dialog) can itself hold EXE/app.asar open and delay
// the updater. The visible warning is shown before the user confirms the update.
if (updateBlocked) {
  app.exit(0);
} else {
  const { BrowserWindow, utilityProcess, dialog, shell, Tray, Menu, nativeImage, clipboard, powerSaveBlocker, ipcMain } = electron;
  const { createElectronShell } = require('./shell');

  const projectRoot = isPackaged
    ? app.getAppPath()
    : path.resolve(__dirname, '..');
  const shellRoot = isPackaged
    ? app.getAppPath()
    : path.resolve(__dirname, '..');
  let packagedResourceIntegrity = null;

  if (isPackaged) {
    // The utility-process server needs the physical installation root and the
    // Electron host PID for updater-v2. app.getAppPath() points inside app.asar,
    // so it must never be used as a writable update target.
    process.env.ELITESAND_INSTALL_ROOT = path.dirname(app.getPath('exe'));
    process.env.ELITESAND_HOST_PID = String(process.pid);
    process.env.ELITESAND_PACKAGED = '1';

    // Generated from the staged resources immediately before packaging. Keeping
    // this manifest inside app.asar means the ASAR integrity check protects the
    // hashes for executable tools which must remain outside the archive.
    packagedResourceIntegrity = require('./packaged-resource-integrity.generated');
  }

  // Exit code 42 is reserved for a server shutdown that happens only after the
  // external updater has completed its ready-file handshake. The old shell saw
  // the utility process disappear and treated it as a crash, sometimes restarting
  // it while an update was trying to replace app files. Intercept that one code at
  // the Electron boundary and terminate the host immediately; updater-v2 waits on
  // ELITESAND_HOST_PID and will not replace EXE/app.asar until this process is gone.
  const updateAwareUtilityProcess = {
    fork(...args) {
      const child = utilityProcess.fork(...args);
      return new Proxy(child, {
        get(target, prop, receiver) {
          if (prop === 'on') {
            return (event, handler) => {
              if (event !== 'exit') return target.on(event, handler);
              return target.on('exit', (code, ...rest) => {
                if (code === 42 && isPackaged) {
                  app.exit(0);
                  return;
                }
                handler(code, ...rest);
              });
            };
          }
          // Electron UtilityProcess exposes native getters (notably pid) backed
          // by private fields. They must run with the real UtilityProcess as
          // `this`; using the Proxy receiver throws before the app can start.
          const value = Reflect.get(target, prop, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };

  const desktop = createElectronShell({
    app,
    BrowserWindow,
    utilityProcess: updateAwareUtilityProcess,
    dialog,
    shell,
    Tray,
    Menu,
    nativeImage,
    clipboard,
    powerSaveBlocker,
    ipcMain,
    projectRoot,
    shellRoot,
    packagedResourceIntegrity,
  });

  desktop.start().catch((error) => {
    // The visible startup error is handled by the shell. Keep a console trace
    // as well so development launches retain actionable diagnostics.
    console.error('[Elitesand Pro Electron]', error);
  });
}
