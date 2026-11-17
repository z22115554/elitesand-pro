'use strict';

// WebGPU 人聲分離引擎（實驗性，docs/AI-SEPARATION-PLAN.md §13 musetric 路線）的隱藏視窗。
// 形狀比照 spout-display-output.js（同一套 show:false／sandbox／contextIsolation／
// backgroundThrottling 設定，start/stop 冪等生命週期、視窗被關掉時自行清狀態），但這裡
// 不需要離屏材質擷取——這個視窗只是載入 server 自己的一個頁面，靠 Socket.io 跟主程式
// 溝通（見 webgpu-separation-worker.mjs／webgpu-separation-jobs.js），沒有畫面輸出。

// 自我修復用的節流：render process 崩掉／視窗沒回應時自己重開，但短時間內連續崩
// 太多次就停手（多半是這台機器的 WebGPU 根本有問題，一直重開只會空轉燒資源）。
const SELF_HEAL_WINDOW_MS = 5 * 60 * 1000;
const SELF_HEAL_MAX_IN_WINDOW = 3;

function createWebgpuEngineWindow({ BrowserWindow, port, logger = console } = {}) {
  if (typeof BrowserWindow !== 'function') throw new TypeError('createWebgpuEngineWindow requires BrowserWindow.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be a valid TCP port.');

  let window = null;
  let retiringWindow = null;
  let startPromise = null;
  let stopPromise = null;
  let restartPromise = null;
  let restartIntent = -1;
  let disposed = true; // An explicit stop cancels pending starts and self-heal.
  let intentVersion = 0;
  let generation = 0;
  let selfHealTimestamps = [];

  function getStatus() {
    return Object.freeze({ hasWindow: !!window && !window.isDestroyed?.() });
  }

  function selfHealBudgetLeft() {
    const now = Date.now();
    selfHealTimestamps = selfHealTimestamps.filter(t => now - t < SELF_HEAL_WINDOW_MS);
    return SELF_HEAL_MAX_IN_WINDOW - selfHealTimestamps.length;
  }

  function scheduleSelfHeal(reason) {
    if (disposed || stopPromise || restartPromise) return;
    if (selfHealBudgetLeft() <= 0) {
      logger.error?.(`[WebGPU Engine] ${reason}，但 ${SELF_HEAL_WINDOW_MS / 60000} 分鐘內已自我修復 ${SELF_HEAL_MAX_IN_WINDOW} 次，停手`);
      return;
    }
    selfHealTimestamps.push(Date.now());
    logger.warn?.('[WebGPU Engine] ' + reason + '，自動重開隱藏視窗');
    restart().catch(error => logger.error?.('[WebGPU Engine] 自我修復重開失敗:', error.message));
  }

  function attachCrashHandlers(nextWindow) {
    nextWindow.webContents?.on?.('render-process-gone', (_event, details) => {
      if (window !== nextWindow) return;
      scheduleSelfHeal('render process 結束（' + (details?.reason || 'unknown') + '）');
    });
    nextWindow.on?.('unresponsive', () => {
      if (window !== nextWindow) return;
      scheduleSelfHeal('視窗沒有回應');
    });
  }

  // Do not await loadURL here: a wedged load is one reason to replace a renderer.
  // A failed destroy keeps its owner reachable and blocks another renderer.
  function retireCurrentWindow() {
    if (stopPromise) return stopPromise;
    generation += 1;
    startPromise = null;
    if (window) {
      retiringWindow = window;
      window = null;
    }
    const activeWindow = retiringWindow;
    const operation = Promise.resolve().then(() => {
      if (activeWindow && !activeWindow.isDestroyed?.()) activeWindow.destroy?.();
      if (activeWindow && !activeWindow.isDestroyed?.()) throw new Error('WebGPU engine window did not close.');
      if (retiringWindow === activeWindow) retiringWindow = null;
      return getStatus();
    });
    const pending = operation.finally(() => {
      if (stopPromise === pending) stopPromise = null;
    });
    stopPromise = pending;
    return pending;
  }

  function ensureStarted(intent) {
    if (disposed || intent !== intentVersion) return Promise.resolve(getStatus());
    if (stopPromise) return stopPromise.then(() => ensureStarted(intent));
    if (retiringWindow) return retireCurrentWindow().then(() => ensureStarted(intent));
    if (startPromise) return startPromise;
    if (window && !window.isDestroyed?.()) return Promise.resolve(getStatus());

    const ownerGeneration = ++generation;
    let nextWindow = null;
    const current = () => !disposed && intent === intentVersion && ownerGeneration === generation;
    // Install the shared promise before constructors, loadURL or log hooks run.
    const operation = Promise.resolve().then(async () => {
      if (!current()) return getStatus();
      try {
        nextWindow = new BrowserWindow({
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
        if (!current()) {
          nextWindow.destroy?.();
          return getStatus();
        }
        window = nextWindow;
        nextWindow.on?.('closed', () => {
          if (retiringWindow === nextWindow) retiringWindow = null;
          if (window === nextWindow) {
            window = null;
            generation += 1;
            startPromise = null;
          }
        });
        attachCrashHandlers(nextWindow);
        await nextWindow.loadURL('http://127.0.0.1:' + port + '/webgpu-separation-worker.html');
        if (current() && window === nextWindow) logger.info?.('[WebGPU Engine] 隱藏視窗已載入，等待 job 派發');
        return getStatus();
      } catch (error) {
        // A cancelled load belongs to the old generation, never its replacement.
        if (!current()) return getStatus();
        if (window === nextWindow) window = null;
        if (nextWindow && !nextWindow.isDestroyed?.()) {
          retiringWindow = nextWindow;
          try {
            await retireCurrentWindow();
          } catch (cleanupError) {
            logger.error?.('[WebGPU Engine] 失敗視窗尚未清理:', cleanupError.message);
          }
        }
        logger.error?.('[WebGPU Engine] 隱藏視窗啟動失敗:', error.message);
        throw error;
      }
    });
    const pending = operation.finally(() => {
      if (startPromise === pending) startPromise = null;
    });
    startPromise = pending;
    return pending;
  }

  function start() {
    if (disposed) {
      disposed = false;
      intentVersion += 1;
    }
    if (restartPromise && restartIntent === intentVersion) return restartPromise;
    return ensureStarted(intentVersion);
  }

  function stop() {
    disposed = true;
    intentVersion += 1;
    return retireCurrentWindow();
  }

  function restart() {
    if (restartPromise && restartIntent === intentVersion && !disposed) return restartPromise;
    disposed = false;
    const intent = ++intentVersion;
    const operation = retireCurrentWindow().then(() => ensureStarted(intent));
    const pending = operation.finally(() => {
      if (restartPromise === pending) restartPromise = null;
    });
    restartIntent = intent;
    restartPromise = pending;
    return pending;
  }

  return Object.freeze({ start, stop, restart, getStatus });
}

module.exports = { createWebgpuEngineWindow };
