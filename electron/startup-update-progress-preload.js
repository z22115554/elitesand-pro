'use strict';

// Minimal, isolated preload for the cold-start update progress window. This
// window shows before any panel exists and only renders a progress bar fed by
// the Electron main process; it never talks to the server or the renderer's
// full API surface. Context isolation + sandbox stay on (see CLAUDE.md).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('startupUpdateProgress', {
  onProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, data) => {
      try { callback(data); } catch (_) { /* renderer-side guard */ }
    };
    ipcRenderer.on('startup-update:progress', handler);
    return () => ipcRenderer.removeListener('startup-update:progress', handler);
  },
});
