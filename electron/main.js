'use strict';

const { app, BrowserWindow, utilityProcess, dialog, shell } = require('electron');
const { createElectronShell } = require('./shell');

const desktop = createElectronShell({
  app,
  BrowserWindow,
  utilityProcess,
  dialog,
  shell,
});

desktop.start().catch((error) => {
  // The visible startup error is handled by the shell. Keep a console trace
  // as well so development launches retain actionable diagnostics.
  console.error('[Elitesand Pro Electron]', error);
});
