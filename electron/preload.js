'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Keep Electron-specific access deliberately tiny. The control panel retains
// its existing localhost HTTP and Socket.io boundary, including PIN.
contextBridge.exposeInMainWorld('ElitesandShell', Object.freeze({
  onCloseRequested(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('elitesand:close-requested', listener);
    return () => ipcRenderer.removeListener('elitesand:close-requested', listener);
  },
  decideClose(action) {
    if (action === 'quit' || action === 'tray' || action === 'cancel') ipcRenderer.send('elitesand:close-decision', action);
  },
  windowControl(action) {
    if (action === 'minimize' || action === 'toggle-maximize' || action === 'close') {
      ipcRenderer.send('elitesand:window-control', action);
    }
  },
  onWindowMaximized(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, isMaximized) => callback(Boolean(isMaximized));
    ipcRenderer.on('elitesand:window-maximized', listener);
    return () => ipcRenderer.removeListener('elitesand:window-maximized', listener);
  },
  chooseMediaLocation() {
    return ipcRenderer.invoke('elitesand:choose-media-location');
  },
  restartAfterMediaMigration() {
    return ipcRenderer.invoke('elitesand:restart-after-media-migration');
  },
  restartForUpdateCheck() {
    return ipcRenderer.invoke('elitesand:restart-for-update-check');
  },
  // A fixed Spout surface only. Do not expose a generic IPC bridge or allow
  // renderer-controlled channels/filesystem access.
  spout: Object.freeze({
    getStatus() { return ipcRenderer.invoke('elitesand:spout-status'); },
    getIssueDiagnostics() { return ipcRenderer.invoke('elitesand:spout-issue-diagnostics'); },
    saveSettings(options) { return ipcRenderer.invoke('elitesand:spout-save-settings', options); },
    start(options) { return ipcRenderer.invoke('elitesand:spout-start', options); },
    stop() { return ipcRenderer.invoke('elitesand:spout-stop'); },
  }),
}));
