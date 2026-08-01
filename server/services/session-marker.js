'use strict';

/**
 * 非正常結束偵測（當機／閃退）。
 *
 * 原理只有一句話：啟動時寫一個標記檔，`gracefulShutdown()` 跑到時把它標成 clean。
 * 下次啟動看到 `clean !== true`，就代表上次沒有走完乾淨關閉的程式碼路徑。
 *
 * 為什麼不查 PID 還在不在：Windows 的 PID 會回收，上次的 PID 隔一陣子很可能已經被
 * 別的程式用掉，會誤判。clean 旗標只依賴「關閉路徑有沒有跑到」，語意精準得多。
 *
 * 為什麼不刪檔而是標記：檔案不存在無法區分「乾淨關閉過」與「全新安裝／可攜版剛解壓」。
 * 留著並標記，狀態才明確。
 *
 * ⚠️ 開發模式必須排除。實測（2026-08-01）`node --watch` 在 Windows 重啟時是**硬砍**
 * 舊行程——收不到 SIGTERM、連 exit 事件都沒有，`gracefulShutdown()` 完全不會執行。
 * 不排除的話，開發者每存一次檔就會被當成一次當機。`npm run dev` 已帶上
 * ELITESAND_DISABLE_CRASH_DETECT=1。
 *
 * 設計背景與驗收見 docs/CRASH-DIAGNOSTICS-PLAN.md。
 */

const fs = require('fs');
const path = require('path');
const { dataDir } = require('../utils/app-paths');
const { createLogger } = require('../utils/logger');

const log = createLogger('SessionMarker');
const MARKER_FILE = path.join(dataDir, '.session-marker');

// 這一輪啟動時讀到的「上一輪」狀態。啟動當下就定案，之後 markStarted 覆寫檔案也不影響。
let startupState = null;
let currentStartedAt = null;

/**
 * 兩道機制，任一成立就停用偵測：
 * 1. 明確的環境變數（測試與特殊情況用）。
 * 2. 自動偵測 `node --watch`。實測（2026-08-01，Node 24 / Windows）：watch 模式的
 *    子行程 `execArgv` 會帶 `--watch-kill-signal=SIGTERM`，一般執行則是空陣列；
 *    而 Windows 的 SIGTERM 是以 TerminateProcess 實作、**攔不到**，所以 watch 重啟
 *    時 `gracefulShutdown()` 根本不會跑 —— 不排除的話開發者每存一次檔就被當成當機。
 *    萬一未來 Node 不再帶這個選項，最壞情況只是開發時多跳提示，正式版不受影響，
 *    且仍可用上面的環境變數關掉。
 */
function isDisabled() {
  if (process.env.ELITESAND_DISABLE_CRASH_DETECT === '1') return true;
  return (process.execArgv || []).some((arg) => /^--watch(-|=|$)/.test(arg));
}

function readMarker(dependencies, file) {
  try {
    const parsed = JSON.parse(dependencies.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    // 不存在、空檔或壞掉都當成「沒有上一輪紀錄」——絕不能因為標記檔壞掉就誤報當機。
    return null;
  }
}

/**
 * 啟動時呼叫。先把上一輪狀態讀進記憶體定案，再寫下這一輪的標記。
 * 回傳這一輪判定出來的 startupState，方便呼叫端記錄。
 */
function markStarted(options = {}) {
  const dependencies = options.fs || fs;
  const file = options.file || MARKER_FILE;
  const now = options.now ? options.now() : Date.now();

  if (isDisabled()) {
    startupState = { wasClean: true, disabled: true, previousStartedAt: null, previousReason: null };
    return startupState;
  }

  const previous = readMarker(dependencies, file);
  startupState = previous
    ? {
      wasClean: previous.clean === true,
      previousStartedAt: previous.startedAt || null,
      previousReason: previous.reason || null,
      previousVersion: previous.version || null,
    }
    // 沒有上一輪紀錄＝全新安裝或第一次跑，不是當機。
    : { wasClean: true, previousStartedAt: null, previousReason: null, firstRun: true };

  currentStartedAt = now;
  try {
    dependencies.mkdirSync(path.dirname(file), { recursive: true });
    dependencies.writeFileSync(file, `${JSON.stringify({
      clean: false,
      pid: process.pid,
      startedAt: now,
      version: options.version || null,
    }, null, 2)}\n`, 'utf8');
  } catch (err) {
    // 寫不進去就沒有偵測能力，但絕不能讓它擋住伺服器啟動。
    log.warn(`無法寫入啟動標記（當機偵測本輪停用）：${err.message}`);
    startupState = { wasClean: true, unavailable: true, previousStartedAt: null, previousReason: null };
  }

  if (!startupState.wasClean) {
    log.warn(`偵測到上次未正常關閉（上次啟動時間 ${new Date(startupState.previousStartedAt || 0).toISOString()}）`);
  }
  return startupState;
}

/**
 * gracefulShutdown() 的**最前面**呼叫，早於 flush 與各種 stop()。
 *
 * 為什麼要最前面：關閉流程有 8 秒硬退保底（見 memory electron-quit-orphan-server），
 * 若 io.close 卡住會直接 process.exit()。標記若放在後面就來不及寫，
 * 「優雅關閉自己卡住」會被誤判成「上次當機」——那是兩個完全不同的問題，
 * 混在一起會讓下一個接手的人搞不清楚在修什麼。
 */
function markClean(reason = 'signal', options = {}) {
  if (isDisabled()) return false;
  const dependencies = options.fs || fs;
  const file = options.file || MARKER_FILE;
  const now = options.now ? options.now() : Date.now();
  try {
    dependencies.writeFileSync(file, `${JSON.stringify({
      clean: true,
      pid: process.pid,
      startedAt: currentStartedAt,
      endedAt: now,
      reason,
    }, null, 2)}\n`, 'utf8');
    return true;
  } catch (err) {
    log.warn(`無法標記乾淨關閉：${err.message}`);
    return false;
  }
}

/** 面板查詢用；不清除狀態，重整頁面仍讀得到（是否要再提示由前端的已處理紀錄決定）。 */
function getStartupState() {
  return startupState || { wasClean: true, previousStartedAt: null, previousReason: null };
}

function _resetForTests() {
  startupState = null;
  currentStartedAt = null;
}

module.exports = { MARKER_FILE, markStarted, markClean, getStartupState, _resetForTests };
