'use strict';

const path = require('path');
const { app, BrowserWindow, utilityProcess, dialog, shell, Tray, Menu, nativeImage, clipboard, powerSaveBlocker, ipcMain } = require('electron');
const { createElectronShell } = require('./shell');

const isPackaged = app.isPackaged;
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
        const value = Reflect.get(target, prop, receiver);
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
