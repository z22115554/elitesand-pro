'use strict';

// 全域快捷鍵（切到 OBS、遊戲也有效）。設定由面板編輯，經 preload 的固定 IPC 送來；
// 這裡只信任「已知動作 + 驗證過的 accelerator」，按下時把動作 id 送回面板執行，
// 主程序本身不碰播放邏輯。設定存在 userData，啟動時先註冊，不必等面板載入。

const fs = require('fs');
const path = require('path');

// 必須跟 public/js/hotkeys.js 的 ACTION_IDS 一致（tests/hotkeys.test.js 會比對）。
const ACTION_IDS = Object.freeze([
  'play-toggle', 'next', 'prev', 'seek-forward', 'seek-back', 'volume-up', 'volume-down',
  'mute-toggle', 'pitch-up', 'pitch-down', 'pitch-reset', 'lyrics-hide', 'align-first',
  'offset-plus', 'offset-minus', 'offset-reset', 'restart-track', 'vocals-toggle', 'metronome-toggle',
  'show-help',
]);
// 只在面板內有意義的動作，主程序不幫它註冊全域快捷鍵。
const IN_APP_ONLY = new Set(['show-help']);
const FILE_NAME = 'hotkeys.json';
const MODIFIER_RE = /^(Ctrl|Alt|Shift|Super)$/;
const KEY_RE = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|num[0-9]|numadd|numsub|nummult|numdiv|numdec|Up|Down|Left|Right|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Escape|MediaPlayPause|MediaNextTrack|MediaPreviousTrack|MediaStop|VolumeUp|VolumeDown|VolumeMute|[-=[\]\\;',./`])$/;
const STANDALONE_RE = /^(?:MediaPlayPause|MediaNextTrack|MediaPreviousTrack|MediaStop|VolumeUp|VolumeDown|VolumeMute|F(?:1[3-9]|2[0-4]))$/;

/** 只接受面板 hotkeys.js 產生得出來的 accelerator，而且一般按鍵一定要帶 Ctrl/Alt/Win。 */
function isSafeAccelerator(value) {
  if (typeof value !== 'string' || !value || value.length > 64) return false;
  const parts = value === '+' ? ['+'] : value.split('+');
  const key = parts.pop();
  if (!KEY_RE.test(key)) return false;
  const seen = new Set();
  for (const mod of parts) {
    if (!MODIFIER_RE.test(mod) || seen.has(mod)) return false;
    seen.add(mod);
  }
  const strong = seen.has('Ctrl') || seen.has('Alt') || seen.has('Super');
  return strong || STANDALONE_RE.test(key);
}

/** 面板送來的整份設定：只留已知動作、字串長度有上限；內容本身由面板的 hotkeys.normalize 負責。 */
function sanitizeConfig(config) {
  const out = { version: 1, inApp: {}, global: {} };
  for (const scope of ['inApp', 'global']) {
    const source = config && typeof config[scope] === 'object' && config[scope] ? config[scope] : {};
    for (const id of ACTION_IDS) {
      const value = source[id];
      if (typeof value === 'string' && value.length <= 64 && /^[A-Za-z0-9+]*$/.test(value)) out[scope][id] = value;
    }
  }
  return out;
}

function sanitizeAccelerators(accelerators) {
  const out = {};
  const used = new Set();
  for (const id of ACTION_IDS) {
    const value = accelerators && accelerators[id];
    if (IN_APP_ONLY.has(id) || !isSafeAccelerator(value) || used.has(value)) continue;
    used.add(value);
    out[id] = value;
  }
  return out;
}

function createGlobalHotkeys({ globalShortcut, userDataPath, onTrigger, fsImpl = fs } = {}) {
  const file = userDataPath ? path.join(userDataPath, FILE_NAME) : null;
  let saved = { config: null, accelerators: {} };
  let results = {};

  function load() {
    if (!file) return saved;
    try {
      const parsed = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
      saved = { config: parsed.config ? sanitizeConfig(parsed.config) : null, accelerators: sanitizeAccelerators(parsed.accelerators) };
    } catch (_) {
      saved = { config: null, accelerators: {} };
    }
    return saved;
  }

  function persist() {
    if (!file) return;
    try {
      fsImpl.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fsImpl.writeFileSync(tmp, JSON.stringify(saved, null, 2), 'utf8');
      fsImpl.renameSync(tmp, file);
    } catch (error) {
      console.warn('[Elitesand Pro Electron] Hotkey settings could not be saved:', error?.message || error);
    }
  }

  /** 依目前的 accelerators 重新註冊；回傳每個動作的結果：ok／taken（被別的程式佔用）。 */
  function register() {
    results = {};
    if (!globalShortcut) return results;
    try { globalShortcut.unregisterAll(); } catch (_) { /* 沒註冊過也沒關係 */ }
    for (const [id, accelerator] of Object.entries(saved.accelerators)) {
      let ok = false;
      try {
        ok = globalShortcut.register(accelerator, () => { try { onTrigger?.(id); } catch (_) { /* 面板已關 */ } }) !== false;
      } catch (_) {
        ok = false;
      }
      results[id] = ok ? 'ok' : 'taken';
    }
    return results;
  }

  function start() {
    load();
    return register();
  }

  function get() {
    return { config: saved.config, results: { ...results }, available: !!globalShortcut };
  }

  function set(payload) {
    saved = {
      config: sanitizeConfig(payload && payload.config),
      accelerators: sanitizeAccelerators(payload && payload.accelerators),
    };
    persist();
    register();
    return get();
  }

  function stop() {
    if (!globalShortcut) return;
    try { globalShortcut.unregisterAll(); } catch (_) { /* 結束中 */ }
  }

  return Object.freeze({ start, get, set, stop });
}

module.exports = { ACTION_IDS, FILE_NAME, createGlobalHotkeys, isSafeAccelerator, sanitizeAccelerators, sanitizeConfig };
