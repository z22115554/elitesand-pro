'use strict';

/**
 * WebGPU 人聲分離（實驗性，§13 musetric 路線）的開關持久化——跟匿名活躍統計、
 * 歌詞偏移社群回饋是同一種模式（server 端 JSON，不是 localStorage），但刻意各自獨立
 * 一個檔案：這個開關關掉不該影響其他任何功能，別的開關也不該連動改到這裡。
 *
 * 預設關閉（opt-in，不是像 usage-telemetry／lyric-offset-sync 那樣的 opt-out）——
 * 這是一個會讓瀏覽器吃 GPU 資源、且已知在極端情況下會讓顯示卡當機的實驗性功能，
 * 不該預設就對所有使用者開啟。
 */

const fs = require('fs');
const path = require('path');
const { dataDir } = require('../utils/app-paths');
const { createLogger } = require('../utils/logger');

const log = createLogger('WebgpuSeparationSettings');

const STATE_FILE = path.join(dataDir, 'webgpu-separation-settings.json');

function atomicWrite(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temporary, filename);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) { /* best effort */ }
  }
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { enabled: parsed.enabled === true };
  } catch (_) {
    return { enabled: false };
  }
}

let state = loadState();

function getSettings() {
  return { enabled: state.enabled };
}

function setEnabled(enabled) {
  state = { enabled: !!enabled };
  try {
    atomicWrite(STATE_FILE, state);
  } catch (error) {
    log.warn(`WebGPU 分離設定保存失敗：${error.message}`);
  }
  return getSettings();
}

function _resetForTests() {
  state = { enabled: false };
}

module.exports = { getSettings, setEnabled, STATE_FILE, _resetForTests };
