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
    if (action === 'quit' || action === 'tray') ipcRenderer.send('elitesand:close-decision', action);
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
}));
