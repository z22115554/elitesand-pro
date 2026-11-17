/**
 * 播放清單匯出/匯入的固定儲存位置（data/playlist-exports/）
 *
 * 使用者要求：匯出不跳系統「另存新檔」視窗（只跳 App 內取名），
 * 匯入不跳系統「開啟檔案」視窗（只跳 App 內清單挑選）——所以匯出的檔案
 * 一律存在這個固定資料夾，匯入時直接列出這裡有什麼可選。
 */
const fs = require('fs');
const path = require('path');
const { dataDir } = require('../utils/app-paths');
const { createLogger } = require('../utils/logger');

const log = createLogger('PlaylistExport');

const EXPORT_DIR = path.join(dataDir, 'playlist-exports');
const MAX_NAME_LENGTH = 60;

function ensureDir() {
  if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

// 檔名清理：只留使用者輸入的可讀名稱，過濾路徑穿越與檔名系統保留字元。
function sanitizeName(name) {
  const clean = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\.\.+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    // Windows 檔名不能以句點或空白結尾（會被系統默默拿掉，存檔後找不到同名檔）
    .replace(/[.\s]+$/, '');
  // Windows 保留裝置名（CON、NUL、COM1…，加副檔名也一樣）：取這種名字存檔會失敗或寫到裝置上。
  return /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(clean) ? `_${clean}` : clean;
}

/** 列出所有已匯出的播放清單（新到舊），供匯入時的選擇清單使用。 */
function list() {
  ensureDir();
  try {
    return fs.readdirSync(EXPORT_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const full = path.join(EXPORT_DIR, f);
        const stat = fs.statSync(full);
        return { filename: f, name: f.replace(/\.json$/, ''), savedAt: stat.mtimeMs };
      })
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch (e) {
    log.warn(`列出匯出清單失敗: ${e.message}`);
    return [];
  }
}

/** 存一份新的匯出檔。同名已存在時自動加序號，不覆蓋舊檔。回傳實際存檔的 filename。 */
function save(name, data) {
  ensureDir();
  const cleanName = sanitizeName(name) || `播放清單-${new Date().toISOString().slice(0, 10)}`;
  let filename = `${cleanName}.json`;
  let counter = 2;
  while (fs.existsSync(path.join(EXPORT_DIR, filename))) {
    filename = `${cleanName} (${counter}).json`;
    counter++;
  }
  const tmpFile = path.join(EXPORT_DIR, filename + '.tmp');
  const finalFile = path.join(EXPORT_DIR, filename);
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpFile, finalFile);
  log.info(`播放清單已匯出存檔: ${filename}`);
  return filename;
}

/** 讀取指定的匯出檔內容，filename 需先經 path.basename 防路徑穿越。 */
function load(filename) {
  const safeName = path.basename(String(filename || ''));
  const full = path.join(EXPORT_DIR, safeName);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf-8'));
  } catch (e) {
    log.warn(`讀取匯出檔失敗 ${safeName}: ${e.message}`);
    return null;
  }
}

module.exports = { list, save, load, sanitizeName, EXPORT_DIR };
