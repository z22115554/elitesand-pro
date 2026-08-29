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
  let startPromise = null;
  let stopPromise = null;
  let restartPromise = null;
  let disposed = false;            // stop() 被呼叫過＝有意關閉，之後不再自我修復
  let selfHealTimestamps = [];     // 最近幾次自我修復的時間，用來判斷是否崩太頻繁

  function getStatus() {
    return Object.freeze({ hasWindow: !!window && !window.isDestroyed?.() });
  }

  function selfHealBudgetLeft() {
    const now = Date.now();
    selfHealTimestamps = selfHealTimestamps.filter((t) => now - t < SELF_HEAL_WINDOW_MS);
    return SELF_HEAL_MAX_IN_WINDOW - selfHealTimestamps.length;
  }

  function scheduleSelfHeal(reason) {
    if (disposed || stopPromise) return; // 有意關閉中，不要跟它搶
    if (selfHealBudgetLeft() <= 0) {
      logger.error?.(`[WebGPU Engine] ${reason}，但 ${SELF_HEAL_WINDOW_MS / 60000} 分鐘內已自我修復 ${SELF_HEAL_MAX_IN_WINDOW} 次，停手`);
      return;
    }
    selfHealTimestamps.push(Date.now());
    logger.warn?.(`[WebGPU Engine] ${reason}，自動重開隱藏視窗`);
    restart().catch((error) => logger.error?.('[WebGPU Engine] 自我修復重開失敗:', error.message));
  }

  function attachCrashHandlers(nextWindow) {
    // render process 沒了（崩潰／被 OOM killer 收掉）——這就是 §13 一直擔心的
    // 「隱藏視窗當掉後不會自己回來」。
    nextWindow.webContents?.on?.('render-process-gone', (_event, details) => {
      if (window !== nextWindow) return;
      scheduleSelfHeal(`render process 結束（${details?.reason || 'unknown'}）`);
    });
    // 卡死到不回應——多半是 WebGPU s.run wedge 住整條 renderer。
    nextWindow.on?.('unresponsive', () => {
      if (window !== nextWindow) return;
      scheduleSelfHeal('視窗沒有回應');
    });
  }

  async function start() {
    if (startPromise) return startPromise;
    if (window && !window.isDestroyed?.()) return getStatus();
    if (stopPromise) await stopPromise;
    disposed = false;
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
        attachCrashHandlers(nextWindow);
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
    disposed = true; // 有意關閉：撤銷任何自我修復意圖
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

  // 卡死／崩潰後把視窗整個換一個新的。stop()+start() 都是冪等的，這裡只多做一件事：
  // 併發保護（server 的重開請求 + 視窗自己的崩潰事件可能同時打進來）。
  async function restart() {
    if (restartPromise) return restartPromise;
    restartPromise = (async () => {
      try {
        await stop();
        return await start();
      } finally {
        restartPromise = null;
      }
    })();
    return restartPromise;
  }

  return Object.freeze({ start, stop, restart, getStatus });
}

module.exports = { createWebgpuEngineWindow };
