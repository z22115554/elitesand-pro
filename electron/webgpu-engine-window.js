'use strict';

// WebGPU 人聲分離引擎（實驗性，docs/AI-SEPARATION-PLAN.md §13 musetric 路線）的隱藏視窗。
// 形狀比照 spout-display-output.js（同一套 show:false／sandbox／contextIsolation／
// backgroundThrottling 設定，start/stop 冪等生命週期、視窗被關掉時自行清狀態），但這裡
// 不需要離屏材質擷取——這個視窗只是載入 server 自己的一個頁面，靠 Socket.io 跟主程式
// 溝通（見 webgpu-separation-worker.mjs／webgpu-separation-jobs.js），沒有畫面輸出。

function createWebgpuEngineWindow({ BrowserWindow, port, logger = console } = {}) {
  if (typeof BrowserWindow !== 'function') throw new TypeError('createWebgpuEngineWindow requires BrowserWindow.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be a valid TCP port.');

  let window = null;
  let startPromise = null;
  let stopPromise = null;

  function getStatus() {
    return Object.freeze({ hasWindow: !!window && !window.isDestroyed?.() });
  }

  async function start() {
    if (startPromise) return startPromise;
    if (window && !window.isDestroyed?.()) return getStatus();
    if (stopPromise) await stopPromise;
    startPromise = (async () => {
      try {
        const nextWindow = new BrowserWindow({
          width: 480,
          height: 320,
          show: false,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
          },
        });
        window = nextWindow;
        nextWindow.on?.('closed', () => { if (window === nextWindow) window = null; });
        await nextWindow.loadURL(`http://127.0.0.1:${port}/webgpu-separation-worker.html`);
        logger.info?.('[WebGPU Engine] 隱藏視窗已載入，等待 job 派發');
        return getStatus();
      } catch (error) {
        if (window && !window.isDestroyed?.()) window.destroy?.();
        window = null;
        logger.error?.('[WebGPU Engine] 隱藏視窗啟動失敗:', error.message);
        throw error;
      } finally {
        startPromise = null;
      }
    })();
    return startPromise;
  }

  async function stop() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      try {
        const activeWindow = window;
        window = null;
        if (activeWindow && !activeWindow.isDestroyed?.()) activeWindow.destroy?.();
        return getStatus();
      } finally {
        stopPromise = null;
      }
    })();
    return stopPromise;
  }

  return Object.freeze({ start, stop, getStatus });
}

module.exports = { createWebgpuEngineWindow };
