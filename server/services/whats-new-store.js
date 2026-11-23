'use strict';

/**
 * 「這版更新了什麼」已讀紀錄（data/whats-new.json）。
 *
 * 伺服器是真實來源：面板換電腦、清快取、用手機看都只會跳一次。
 * 三種狀態：
 * - 有紀錄：回傳上次看過的版本，面板顯示「比它新、且不超過目前版本」的更新內容。
 * - 沒紀錄、但這個 data 目錄本來就有人用過（state.json 已存在）：老使用者第一次升到有這功能的版本，
 *   lastSeenVersion 回 null，面板只顯示目前這版的內容。
 * - 沒紀錄、也沒用過：全新安裝，直接記成目前版本，什麼都不跳（新手有新手導覽）。
 * 「有沒有用過」在模組載入（伺服器啟動）當下判定，避免這次啟動自己寫出的 state.json 混淆判斷。
 */
const fs = require('fs');
const path = require('path');
const { dataDir } = require('../utils/app-paths');
const { APP_VERSION } = require('../utils/app-version');
const { createLogger } = require('../utils/logger');

const log = createLogger('WhatsNew');
const STORE_FILE = path.join(dataDir, 'whats-new.json');
const VERSION_PATTERN = /^\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z.-]{1,40})?$/;

const existingUserAtStartup = fs.existsSync(path.join(dataDir, 'state.json'));

function isValidVersion(value) {
  return typeof value === 'string' && value.length <= 60 && VERSION_PATTERN.test(value);
}

function readRecord() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return parsed && isValidVersion(parsed.lastSeenVersion) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function writeRecord(version) {
  const tmp = `${STORE_FILE}.tmp`;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ lastSeenVersion: version, seenAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

function getStatus({ existingUser = existingUserAtStartup } = {}) {
  const record = readRecord();
  if (record) return { appVersion: APP_VERSION, lastSeenVersion: record.lastSeenVersion };
  if (existingUser) return { appVersion: APP_VERSION, lastSeenVersion: null };
  try { writeRecord(APP_VERSION); } catch (err) { log.warn(`寫入已讀紀錄失敗：${err.message}`); }
  return { appVersion: APP_VERSION, lastSeenVersion: APP_VERSION };
}

function markSeen(version) {
  if (!isValidVersion(version)) return { ok: false, error: 'INVALID_VERSION' };
  writeRecord(version);
  return { ok: true, lastSeenVersion: version };
}

module.exports = { getStatus, markSeen, isValidVersion, STORE_FILE };
