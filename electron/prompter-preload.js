'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 跟唱視窗只拿得到「置頂」這一件事；主程序會再確認呼叫的是它自己開出來的跟唱視窗。
contextBridge.exposeInMainWorld('ElitesandPrompter', Object.freeze({
  getAlwaysOnTop() { return ipcRenderer.invoke('elitesand:prompter-pin-get'); },
  setAlwaysOnTop(value) { return ipcRenderer.invoke('elitesand:prompter-pin-set', value === true); },
}));
