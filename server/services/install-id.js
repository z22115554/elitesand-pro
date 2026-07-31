'use strict';

/**
 * 安裝識別碼 — 只為問題回報的每日限流而存在。
 *
 * 刻意的限制（改之前先想清楚為什麼要改）：
 * - 是隨機 UUID，**不是**硬體序號、MAC、機器 GUID 或任何指紋。重裝或刪掉
 *   dataDir 就會換一個，這是預期行為，不是要修的 bug。
 * - 只有在使用者實際送出問題回報時才會離開本機。不做遙測、不做使用行為分析、
 *   不在啟動時回傳任何東西。
 * - 存 dataDir 而不是 localStorage：面板與手機遙控器要共用同一個識別碼，
 *   而且可攜版搬資料夾時應該跟著走。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dataDir } = require('../utils/app-paths');
const { createLogger } = require('../utils/logger');

const log = createLogger('InstallId');
const ID_FILE = path.join(dataDir, 'install-id.json');

let cached = null;

function isValidId(value) {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
}

/**
 * 讀不到或寫不進去都不能讓回報功能整個壞掉——回退成一次性的臨時識別碼，
 * 使用者仍然送得出回報，只是限流會把他當成新的安裝。
 */
function getInstallId(options = {}) {
  const dependencies = options.fs || fs;
  const file = options.file || ID_FILE;
  if (cached && !options.force) return cached;

  try {
    const parsed = JSON.parse(dependencies.readFileSync(file, 'utf8'));
    if (parsed && isValidId(parsed.installId)) {
      cached = parsed.installId;
      return cached;
    }
  } catch (_) { /* 首次執行或檔案損毀，往下重建 */ }

  const installId = crypto.randomUUID();
  try {
    dependencies.mkdirSync(path.dirname(file), { recursive: true });
    dependencies.writeFileSync(
      file,
      `${JSON.stringify({ installId, createdAt: new Date().toISOString() }, null, 2)}\n`,
      'utf8'
    );
    cached = installId;
  } catch (err) {
    log.warn(`無法保存安裝識別碼（本次改用臨時值）：${err.message}`);
    return installId;
  }
  return cached;
}

function _resetForTests() { cached = null; }

module.exports = { getInstallId, ID_FILE, _resetForTests };
