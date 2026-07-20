'use strict';

const { app, BrowserWindow, utilityProcess, dialog, shell, Tray, Menu, nativeImage, clipboard, powerSaveBlocker } = require('electron');
const { createElectronShell } = require('./shell');

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
});

desktop.start().catch((error) => {
  // The visible startup error is handled by the shell. Keep a console trace
  // as well so development launches retain actionable diagnostics.
  console.error('[Elitesand Pro Electron]', error);
});
