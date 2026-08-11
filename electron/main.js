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
  // Generated from the staged resources immediately before packaging. Keeping
  // this manifest inside app.asar means the ASAR integrity check protects the
  // hashes for executable tools which must remain outside the archive.
  packagedResourceIntegrity = require('./packaged-resource-integrity.generated');
}

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
  shellRoot,
  packagedResourceIntegrity,
});

desktop.start().catch((error) => {
  // The visible startup error is handled by the shell. Keep a console trace
  // as well so development launches retain actionable diagnostics.
  console.error('[Elitesand Pro Electron]', error);
});
