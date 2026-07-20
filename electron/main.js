'use strict';

const path = require('path');
const { app, BrowserWindow, utilityProcess, dialog, shell, Tray, Menu, nativeImage, clipboard, powerSaveBlocker } = require('electron');
const { createElectronShell } = require('./shell');

const isPackaged = app.isPackaged;
const projectRoot = isPackaged
  ? path.join(process.resourcesPath, 'app-root')
  : path.resolve(__dirname, '..');
const shellRoot = isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.resolve(__dirname, '..');

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
  projectRoot,
  shellRoot,
});

desktop.start().catch((error) => {
  // The visible startup error is handled by the shell. Keep a console trace
  // as well so development launches retain actionable diagnostics.
  console.error('[Elitesand Pro Electron]', error);
});
