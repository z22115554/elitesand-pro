/**
 * 快捷鍵核心：動作清單、預設按鍵、組合鍵的記錄／顯示／驗證，以及轉成 Electron 全域快捷鍵格式。
 *
 * 兩種範圍：
 * - inApp（面板內）：面板視窗在前景時有效，預設參考 Spotify 桌面版（空白鍵播放／暫停、
 *   Ctrl+←/→ 上下首、Shift+←/→ 跳轉、Ctrl+↑/↓ 音量）。
 * - global（全域）：只有桌面版有，切到 OBS 或遊戲也有效。預設只綁鍵盤上的媒體鍵，
 *   其他組合鍵一律要帶 Ctrl/Alt/Win，避免搶走一般打字用的按鍵。
 *
 * 組合鍵字串固定順序：Ctrl+Alt+Shift+Meta+<KeyboardEvent.code>，例如 "Ctrl+ArrowRight"。
 * 用 code（實體按鍵）而不是 key（字元），換輸入法或鍵盤配置也不會失效。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Hotkeys = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const ACTIONS = Object.freeze([
    { id: 'play-toggle', inApp: 'Space', global: 'MediaPlayPause' },
    { id: 'next', inApp: 'Ctrl+ArrowRight', global: 'MediaTrackNext' },
    { id: 'prev', inApp: 'Ctrl+ArrowLeft', global: 'MediaTrackPrevious' },
    { id: 'seek-forward', inApp: 'Shift+ArrowRight', global: '' },
    { id: 'seek-back', inApp: 'Shift+ArrowLeft', global: '' },
    { id: 'volume-up', inApp: 'Ctrl+ArrowUp', global: '' },
    { id: 'volume-down', inApp: 'Ctrl+ArrowDown', global: '' },
    { id: 'mute-toggle', inApp: 'Ctrl+Shift+ArrowDown', global: '' },
    { id: 'pitch-up', inApp: 'Alt+ArrowUp', global: '' },
    { id: 'pitch-down', inApp: 'Alt+ArrowDown', global: '' },
    { id: 'pitch-reset', inApp: 'Alt+Digit0', global: '' },
    { id: 'lyrics-hide', inApp: 'Ctrl+KeyH', global: '' },
    // 「聽到第一個字的瞬間按下去」：按鍵比滑鼠點擊的時間點準。
    { id: 'align-first', inApp: 'Period', global: '' },
    { id: 'offset-plus', inApp: 'BracketRight', global: '' },
    { id: 'offset-minus', inApp: 'BracketLeft', global: '' },
    { id: 'offset-reset', inApp: 'Backslash', global: '' },
    { id: 'restart-track', inApp: '', global: '' },
    { id: 'vocals-toggle', inApp: '', global: '' },
    { id: 'metronome-toggle', inApp: '', global: '' },
    // 快捷鍵一覽是面板上的對話框，切到別的視窗時按了也看不到，所以不能設成全域。
    { id: 'show-help', inApp: 'Shift+Slash', global: '', inAppOnly: true },
  ].map(Object.freeze));
  const ACTION_IDS = Object.freeze(ACTIONS.map((action) => action.id));
  const IN_APP_ONLY = new Set(ACTIONS.filter((action) => action.inAppOnly).map((action) => action.id));
  const SCOPES = Object.freeze(['inApp', 'global']);
  const STORAGE_KEY = 'elitesand-hotkeys-v1';
  const MODIFIERS = Object.freeze(['Ctrl', 'Alt', 'Shift', 'Meta']);

  const MEDIA_CODES = Object.freeze({
    MediaPlayPause: 'MediaPlayPause',
    MediaTrackNext: 'MediaNextTrack',
    MediaTrackPrevious: 'MediaPreviousTrack',
    MediaStop: 'MediaStop',
    AudioVolumeUp: 'VolumeUp',
    AudioVolumeDown: 'VolumeDown',
    AudioVolumeMute: 'VolumeMute',
  });
  // KeyboardEvent.key 的媒體鍵名稱（部分鍵盤的媒體鍵 code 是空字串，只能看 key）。
  const MEDIA_KEYS = Object.freeze({
    MediaPlayPause: 'MediaPlayPause',
    MediaTrackNext: 'MediaTrackNext',
    MediaTrackPrevious: 'MediaTrackPrevious',
    MediaStop: 'MediaStop',
    AudioVolumeUp: 'AudioVolumeUp',
    AudioVolumeDown: 'AudioVolumeDown',
    AudioVolumeMute: 'AudioVolumeMute',
  });
  const PUNCTUATION = Object.freeze({
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
  });
  const NAMED = Object.freeze({
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
    Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Escape: 'Escape',
    NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
  });
  const ARROW_LABELS = Object.freeze({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' });
  const MEDIA_LABELS = Object.freeze({
    MediaPlayPause: '⏯', MediaTrackNext: '⏭', MediaTrackPrevious: '⏮', MediaStop: '⏹',
    AudioVolumeUp: '🔊+', AudioVolumeDown: '🔉−', AudioVolumeMute: '🔇',
  });
  // 這些鍵單獨按下時是面板操作本身要用的（關對話框、切焦點、送出），不可綁成面板內快捷鍵。
  const RESERVED_BARE = new Set(['Escape', 'Tab', 'Enter']);

  function isModifierCode(code) {
    return /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/.test(code);
  }

  /** 把組合鍵字串拆成 { mods:Set, code }；格式不對回傳 null。 */
  function parse(combo) {
    if (typeof combo !== 'string' || !combo || combo.length > 64) return null;
    const parts = combo.split('+');
    const code = parts.pop();
    if (!code || isModifierCode(code) || !/^[A-Za-z0-9]+$/.test(code)) return null;
    const mods = new Set();
    let last = -1;
    for (const part of parts) {
      const index = MODIFIERS.indexOf(part);
      if (index <= last) return null; // 未知修飾鍵、重複或順序錯
      last = index;
      mods.add(part);
    }
    return { mods, code };
  }

  function format(mods, code) {
    return [...MODIFIERS.filter((mod) => mods.has(mod)), code].join('+');
  }

  /** 鍵盤事件 → 組合鍵字串；只按修飾鍵、或認不出來的鍵回傳 null。 */
  function fromEvent(event) {
    if (!event) return null;
    let code = String(event.code || '');
    if (!code && MEDIA_KEYS[event.key]) code = MEDIA_KEYS[event.key];
    if (!code || isModifierCode(code) || !/^[A-Za-z0-9]+$/.test(code)) return null;
    const mods = new Set();
    if (event.ctrlKey) mods.add('Ctrl');
    if (event.altKey) mods.add('Alt');
    if (event.shiftKey) mods.add('Shift');
    if (event.metaKey) mods.add('Meta');
    return format(mods, code);
  }

  function keyLabel(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
    if (ARROW_LABELS[code]) return ARROW_LABELS[code];
    if (MEDIA_LABELS[code]) return MEDIA_LABELS[code];
    if (PUNCTUATION[code]) return PUNCTUATION[code];
    return code;
  }

  /** 給人看的標籤，例如 "Ctrl + →"；空字串＝未設定。 */
  function label(combo) {
    const parsed = parse(combo);
    if (!parsed) return '';
    const mods = MODIFIERS.filter((mod) => parsed.mods.has(mod)).map((mod) => (mod === 'Meta' ? 'Win' : mod));
    return [...mods, keyLabel(parsed.code)].join(' + ');
  }

  function acceleratorKey(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
    if (MEDIA_CODES[code]) return MEDIA_CODES[code];
    if (PUNCTUATION[code]) return PUNCTUATION[code];
    if (NAMED[code]) return NAMED[code];
    return null;
  }

  /** 組合鍵 → Electron accelerator（"Ctrl+Alt+P"、"MediaPlayPause"）；不能當全域快捷鍵就回傳 null。 */
  function toAccelerator(combo) {
    const parsed = parse(combo);
    if (!parsed) return null;
    const key = acceleratorKey(parsed.code);
    if (!key) return null;
    const mods = [];
    if (parsed.mods.has('Ctrl')) mods.push('Ctrl');
    if (parsed.mods.has('Alt')) mods.push('Alt');
    if (parsed.mods.has('Shift')) mods.push('Shift');
    if (parsed.mods.has('Meta')) mods.push('Super');
    return [...mods, key].join('+');
  }

  /**
   * 檢查一個組合鍵能不能用在某個範圍。回傳 null＝可以，否則回傳原因代碼
   * （面板用 hotkeys.error.<代碼> 顯示）。
   */
  function validate(combo, scope) {
    const parsed = parse(combo);
    if (!parsed) return 'invalid';
    if (scope === 'global') {
      if (!toAccelerator(combo)) return 'unsupported';
      const strong = parsed.mods.has('Ctrl') || parsed.mods.has('Alt') || parsed.mods.has('Meta');
      const standalone = Boolean(MEDIA_CODES[parsed.code]) || /^F(1[3-9]|2[0-4])$/.test(parsed.code);
      if (!strong && !standalone) return 'needsModifier';
      return null;
    }
    if (parsed.mods.size === 0 && RESERVED_BARE.has(parsed.code)) return 'reserved';
    return null;
  }

  function defaults() {
    const config = { version: 1, inApp: {}, global: {} };
    for (const action of ACTIONS) {
      config.inApp[action.id] = action.inApp;
      config.global[action.id] = action.global;
    }
    return config;
  }

  /** 把存起來的設定整理成完整、合法的設定：沒存的動作用預設、壞掉的值改成未設定、重複的只留第一個。 */
  function normalize(stored) {
    const base = defaults();
    const source = stored && typeof stored === 'object' ? stored : {};
    for (const scope of SCOPES) {
      const saved = source[scope] && typeof source[scope] === 'object' ? source[scope] : {};
      const used = new Set();
      for (const id of ACTION_IDS) {
        let combo = Object.prototype.hasOwnProperty.call(saved, id) ? saved[id] : base[scope][id];
        if (typeof combo !== 'string' || (combo && validate(combo, scope))) combo = '';
        if (combo && used.has(combo)) combo = '';
        if (scope === 'global' && IN_APP_ONLY.has(id)) combo = '';
        if (combo) used.add(combo);
        base[scope][id] = combo;
      }
    }
    return base;
  }

  /** 同一個範圍裡，這個組合鍵已經被哪個動作用掉（排除自己）；沒有回傳 null。 */
  function conflict(config, scope, combo, exceptId) {
    if (!combo) return null;
    const map = (config && config[scope]) || {};
    return ACTION_IDS.find((id) => id !== exceptId && map[id] === combo) || null;
  }

  /** 全域那份轉成 { 動作: accelerator }，給 Electron 主程序註冊。 */
  function globalAccelerators(config) {
    const out = {};
    for (const id of ACTION_IDS) {
      if (IN_APP_ONLY.has(id)) continue;
      const accelerator = toAccelerator(config && config.global ? config.global[id] : '');
      if (accelerator) out[id] = accelerator;
    }
    return out;
  }

  /** 焦點在可輸入的地方時，單鍵快捷鍵不能搶走打字（但 Ctrl/Alt/Win 組合照樣有效）。 */
  function isInAppOnly(id) {
    return IN_APP_ONLY.has(id);
  }

  function isTypingTarget(target) {
    if (!target || typeof target !== 'object') return false;
    const tag = String(target.tagName || '').toUpperCase();
    if (target.isContentEditable) return true;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const type = String(target.type || 'text').toLowerCase();
      return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
    }
    return false;
  }

  return Object.freeze({
    ACTIONS, ACTION_IDS, SCOPES, STORAGE_KEY,
    parse, fromEvent, label, toAccelerator, validate, defaults, normalize, conflict, globalAccelerators, isTypingTarget, isInAppOnly,
  });
});
