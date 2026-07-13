/**
 * Elitesand Pro 控制面板 — 歌詞選擇器 + 歌詞外觀設定
 *
 * 這個模組是「附加」在 app.js 之上的，不修改既有播放邏輯。
 * 透過全域 SocketClient 與後端溝通，操作以下新功能：
 *  1. 歌詞選擇器：列出各 API 來源的候選歌詞供手動挑選（問題 6）
 *  2. 歌詞外觀/位置設定：字體、顏色、陰影、邊框、位置、保留句數（問題 5）
 *
 * 依賴的全域：SocketClient（socket-client.js）
 */
(function () {
  'use strict';

  if (typeof SocketClient === 'undefined') {
    console.warn('[Extras] SocketClient 未載入，附加功能停用');
    return;
  }

  const { escapeHtml } = SharedUtils;

  const LS_SETTINGS = 'vk-lyric-settings';

  // ═══════════════════════════════════════════
  // 歌詞外觀/位置設定
  // ═══════════════════════════════════════════

  // 預設值（與 display.css 的 :root 對齊）
  const DEFAULT_SETTINGS = {
    fontSize: 42,
    fontFamily: "'Noto Sans SC', 'Noto Sans JP', 'Noto Sans KR', sans-serif",
    fontFamilyLatin: '', // 英文（拉丁字母/數字）專用字體；空＝跟主字體。display 端會組成「英文字體, 主字體」
    fontWeight: 900,
    color: '#ffffff',
    activeColor: '#ffd6a5',
    strokeWidth: 0,
    strokeColor: '#000000',
    shadow: '0 2px 3px rgba(0,0,0,1), 0 4px 14px rgba(0,0,0,0.85)',
    shadowPreset: 'soft',
    shadowColor: '#000000',
    historyOpacity: 0.3,
    historyLines: 2,
    historyFontSize: 0, // 0 = 自動（主字級的 58%）；>0 = 固定像素，獨立於主字級

    verticalPosition: 'flex-end',
    horizontalAlign: 'center',
    textAlign: 'center',
    paddingX: 60,
    paddingY: 48,
    maxWidth: 90,
    offsetX: 0,
    offsetY: 0,
    // 逐字 KTV 模式已移除（經典疊層一律逐句；逐字改用獨立的 KTV 伴唱模板）
    convertTraditional: true, // 簡轉繁（簡體歌詞顯示成繁體；只轉原文 Han 字，不動拼音/諧音）；預設開啟
    // ── 文字排版細項 ──
    lineHeight: 1.3,      // 行高（active 與 history 共用）
    letterSpacing: 0,     // 字距 px
    activeScale: 1.0,     // 當前行相對基準字級的放大倍率（1.0=不放大）
    // ── 高亮發光（獨立於陰影預設）──
    glowColor: '#ffd6a5',
    glowStrength: 0,      // 0 = 關閉；>0 = 發光半徑 px
    glow: 'none',         // 合成字串（buildGlow 產生，推送給顯示端，不直接 UI 綁）
    // ── 歌詞半透明背景框 ──
    bgColor: '#000000',
    bgOpacity: 0,         // 0 = 關閉（透明）
    textBg: 'transparent', // 合成（buildTextBg 產生）
    textBgPad: '0',        // 合成：背景開啟時才有內距，避免關閉時推移位置
    // ── 羅馬字（拼音）與諧音的獨立外觀 ──
    romajiColor: '#ffffff',
    romajiSize: 0.5,      // 相對主字級的倍率（em）
    xieyinColor: '#ffd6a5',
    xieyinSize: 0.92,     // 相對主字級的倍率（em）
    // ── 排版模板（v4/v5）──
    template: 'classic',  // 'classic' | 'luminous' | 'partita' | 'tilt' | 'mindscape'
    animationIntensity: 'normal', // folia 系模板的散射強度：'calm' | 'normal' | 'chaotic'
    lyricPosition: 'center', // 歌詞水平位置：'center' | 'left' | 'right' | 'split'（左右分散＝逐行交替）
    // ── 自訂背景（Phase 4）：鍵名加 display 前綴避免與上面歌詞文字背景框(bgColor/bgOpacity)撞名 ──
    displayBgImage: '',   // 檔名（'' = 無背景，維持透明）
    displayBgOpacity: 1,
    displayBgFit: 'cover', // 'cover' | 'contain' | 'fill'
  };

  const TEMPLATE_IDS = ['classic', 'luminous', 'partita', 'tilt', 'mindscape', 'ktv'];
  const TEMPLATE_SETTING_KEY = 'lyricTemplateSettings';
  const PRESET_KEY = 'lyricPresets';
  let templateSettings = {};
  let lyricPresets = [];

  function cleanSettingSnapshot(src) {
    const out = {};
    Object.keys(DEFAULT_SETTINGS).forEach((key) => {
      if (src && src[key] !== undefined) out[key] = src[key];
    });
    return out;
  }

  function normalizeTemplateSettings(src, fallback) {
    const out = {};
    if (src && typeof src === 'object') {
      TEMPLATE_IDS.forEach((id) => {
        if (src[id] && typeof src[id] === 'object') out[id] = { ...DEFAULT_SETTINGS, ...cleanSettingSnapshot(src[id]), template: id };
      });
    }
    const base = cleanSettingSnapshot(fallback || {});
    const tpl = TEMPLATE_IDS.includes(base.template) ? base.template : 'classic';
    if (!out[tpl]) out[tpl] = { ...DEFAULT_SETTINGS, ...base, template: tpl };
    return out;
  }

  function normalizePresets(src) {
    if (!Array.isArray(src)) return [];
    return src
      .filter((p) => p && typeof p.name === 'string' && p.settings && typeof p.settings === 'object')
      .slice(0, 24)
      .map((p, i) => ({ id: String(p.id || Date.now() + '-' + i), name: p.name.slice(0, 40), settings: cleanSettingSnapshot(p.settings) }));
  }

  function saveCurrentTemplateSnapshot() {
    const tpl = TEMPLATE_IDS.includes(settings.template) ? settings.template : 'classic';
    templateSettings[tpl] = { ...DEFAULT_SETTINGS, ...cleanSettingSnapshot(settings), template: tpl };
  }

  function buildSettingsPayload() {
    saveCurrentTemplateSnapshot();
    return { ...cleanSettingSnapshot(settings), [TEMPLATE_SETTING_KEY]: templateSettings, [PRESET_KEY]: lyricPresets };
  }

  let settings = loadSettings();
  // 是否已採用「伺服器端持久化設定」。每次（重）連線後採用一次，避免拖滑桿時被回推迴圈。

  let serverSettingsApplied = false;

  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      if (raw) {
        const parsed = JSON.parse(raw);
        templateSettings = normalizeTemplateSettings(parsed[TEMPLATE_SETTING_KEY], parsed);
        lyricPresets = normalizePresets(parsed[PRESET_KEY]);
        return { ...DEFAULT_SETTINGS, ...cleanSettingSnapshot(parsed) };
      }
    } catch (e) { /* 忽略 */ }
    templateSettings = normalizeTemplateSettings(null, DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }

  function saveSettings() {
    try { localStorage.setItem(LS_SETTINGS, JSON.stringify(buildSettingsPayload())); } catch (e) { /* 忽略 */ }
  }

  // 陰影：由「預設樣式 + 顏色」組成 CSS 字串，讓四種效果差異明顯且顏色可調
  function hexToRgba(hex, a) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '#000000');
    const n = m ? parseInt(m[1], 16) : 0;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function buildShadow(preset, color) {
    const c = color || '#000000';
    switch (preset) {
      case 'none': return 'none';
      // 加強可見度：每個預設都疊一層「貼近文字的不透明暗影」(0 2px 2px) 當底，
      // 即使風格的彩色 glow 疊在上面也壓不掉，陰影才看得出來（之前 soft 太散＝不明顯）。
      case 'soft': return `0 2px 3px ${hexToRgba(c, 1)}, 0 4px 14px ${hexToRgba(c, 0.85)}`;
      case 'hard': return `3px 3px 0 ${hexToRgba(c, 1)}, 4px 4px 6px ${hexToRgba(c, 0.6)}`;
      case 'glow': return `0 2px 3px ${hexToRgba(c, 0.9)}, 0 0 14px ${hexToRgba(c, 0.95)}, 0 0 30px ${hexToRgba(c, 0.7)}`;
      case 'outline': { const o = hexToRgba(c, 1); return `-2px -2px 0 ${o}, 2px -2px 0 ${o}, -2px 2px 0 ${o}, 2px 2px 0 ${o}, 0 3px 4px ${hexToRgba(c, 0.8)}`; }
      default: return `0 2px 3px ${hexToRgba(c, 1)}, 0 4px 14px ${hexToRgba(c, 0.85)}`;
    }
  }

  // 高亮發光：當前行專屬的雙層 glow（強度 0=關）。獨立於陰影預設，疊加在 active 行 text-shadow。
  function buildGlow(strength, color) {
    const s = Number(strength) || 0;
    if (s <= 0) return 'none';
    const c = color || '#ffd6a5';
    return `0 0 ${s}px ${c}, 0 0 ${s * 2}px ${c}`;
  }
  // 半透明背景框：透明度 0=關（transparent）。開啟時才給內距，避免關閉時推移歌詞位置。
  function buildTextBg(opacity, color) {
    return (Number(opacity) || 0) > 0 ? hexToRgba(color || '#000000', Number(opacity)) : 'transparent';
  }
  function applyGlow() { settings.glow = buildGlow(settings.glowStrength, settings.glowColor); }
  function applyBg() {
    settings.textBg = buildTextBg(settings.bgOpacity, settings.bgColor);
    settings.textBgPad = (Number(settings.bgOpacity) || 0) > 0 ? '0.12em 0.5em' : '0';
  }

  // 所有外觀控制項定義（id ↔ 設定鍵 ↔ 數值顯示），bindControl 與 refreshControls 共用
  const CONTROLS = [
    { id: 'ls-fontsize', key: 'fontSize', valId: 'ls-fontsize-val', fmt: v => v + 'px' },
    { id: 'ls-fontweight', key: 'fontWeight' },
    { id: 'ls-color', key: 'color' },
    { id: 'ls-active-color', key: 'activeColor' },
    { id: 'ls-stroke-width', key: 'strokeWidth', valId: 'ls-stroke-width-val', fmt: v => v + 'px' },
    { id: 'ls-stroke-color', key: 'strokeColor' },
    { id: 'ls-history-lines', key: 'historyLines', valId: 'ls-history-lines-val' },
    { id: 'ls-history-fontsize', key: 'historyFontSize', valId: 'ls-history-fontsize-val', fmt: v => (Number(v) > 0 ? v + 'px' : '自動') },
    { id: 'ls-history-opacity', key: 'historyOpacity', valId: 'ls-history-opacity-val', fmt: v => Math.round(v * 100) + '%' },
    { id: 'ls-line-height', key: 'lineHeight', valId: 'ls-line-height-val', fmt: v => Number(v).toFixed(2) },
    { id: 'ls-letter-spacing', key: 'letterSpacing', valId: 'ls-letter-spacing-val', fmt: v => v + 'px' },
    { id: 'ls-active-scale', key: 'activeScale', valId: 'ls-active-scale-val', fmt: v => Number(v).toFixed(2) + '×' },
    { id: 'ls-romaji-color', key: 'romajiColor' },
    { id: 'ls-romaji-size', key: 'romajiSize', valId: 'ls-romaji-size-val', fmt: v => Math.round(v * 100) + '%' },
    { id: 'ls-xieyin-color', key: 'xieyinColor' },
    { id: 'ls-xieyin-size', key: 'xieyinSize', valId: 'ls-xieyin-size-val', fmt: v => Math.round(v * 100) + '%' },
    { id: 'ls-text-align', key: 'textAlign' },
    { id: 'ls-padding-x', key: 'paddingX', valId: 'ls-padding-x-val', fmt: v => v + 'px' },
    { id: 'ls-padding-y', key: 'paddingY', valId: 'ls-padding-y-val', fmt: v => v + 'px' },
    { id: 'ls-max-width', key: 'maxWidth', valId: 'ls-max-width-val', fmt: v => v + '%' },
    { id: 'ls-offset-x', key: 'offsetX', valId: 'ls-offset-x-val', fmt: v => v + 'px' },
    { id: 'ls-offset-y', key: 'offsetY', valId: 'ls-offset-y-val', fmt: v => v + 'px' },
    { id: 'ls-traditional', key: 'convertTraditional' },
  ];

  // 把目前 settings 套回所有 UI 控制項顯示（不觸發 pushSettings，用於採用伺服器設定 / 重置）
  function refreshControls() {
    CONTROLS.forEach((c) => {
      const el = document.getElementById(c.id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!settings[c.key];
      else el.value = settings[c.key];
      const valEl = c.valId ? document.getElementById(c.valId) : null;
      if (valEl) valEl.textContent = c.fmt ? c.fmt(settings[c.key]) : settings[c.key];
    });
    const shadowSel = document.getElementById('ls-shadow');
    if (shadowSel) shadowSel.value = settings.shadowPreset || 'soft';
    const shadowColorEl = document.getElementById('ls-shadow-color');
    if (shadowColorEl) shadowColorEl.value = settings.shadowColor || '#000000';
    // 高亮發光（色+強度）與背景框（色+透明度）：原子值單獨綁定，這裡同步 UI
    const glowColorEl = document.getElementById('ls-glow-color');
    if (glowColorEl) glowColorEl.value = settings.glowColor || '#ffd6a5';
    const glowStrengthEl = document.getElementById('ls-glow-strength');
    if (glowStrengthEl) {
      glowStrengthEl.value = settings.glowStrength;
      const v = document.getElementById('ls-glow-strength-val');
      if (v) v.textContent = (Number(settings.glowStrength) > 0 ? settings.glowStrength + 'px' : '關');
    }
    const bgColorEl = document.getElementById('ls-bg-color');
    if (bgColorEl) bgColorEl.value = settings.bgColor || '#000000';
    const bgOpacityEl = document.getElementById('ls-bg-opacity');
    if (bgOpacityEl) {
      bgOpacityEl.value = settings.bgOpacity;
      const v = document.getElementById('ls-bg-opacity-val');
      if (v) v.textContent = (Number(settings.bgOpacity) > 0 ? Math.round(settings.bgOpacity * 100) + '%' : '關');
    }
    if (typeof syncCustomFontUI === 'function') syncCustomFontUI();
    if (typeof syncPosGrid === 'function') syncPosGrid();
    if (typeof syncTemplateButtons === 'function') syncTemplateButtons();
    if (typeof syncBackgroundUI === 'function') syncBackgroundUI();
  }

  function applyServerSettings(srv) {
    if (!srv || typeof srv !== 'object' || Object.keys(srv).length === 0) return false;
    const clean = cleanSettingSnapshot(srv);
    templateSettings = normalizeTemplateSettings(srv[TEMPLATE_SETTING_KEY], clean);
    lyricPresets = normalizePresets(srv[PRESET_KEY]);
    const tpl = TEMPLATE_IDS.includes(clean.template) ? clean.template : 'classic';
    settings = { ...DEFAULT_SETTINGS, ...(templateSettings[tpl] || {}), ...clean, template: tpl };
    saveSettings();
    refreshControls();
    renderLyricPresetUI();
    previewToIframe(settings);
    return true;
  }

  // 採用伺服器持久化的歌詞設定（每次連線後一次）。伺服器是設定的唯一真實來源；
  // 只有當伺服器尚無設定時，才用本機 localStorage 種子化，避免重開後被預設值洗掉。
  function adoptServerSettings(state) {
    if (!state || serverSettingsApplied) return;
    serverSettingsApplied = true;
    const srv = state.lyricSettings;
    if (!applyServerSettings(srv)) {
      SocketClient.send('lyric-settings:update', buildSettingsPayload());
    }
  }

  // 即時預覽：把目前設定直接 postMessage 給面板內嵌的 /display?preview=1 iframe。
  // 走 postMessage 而非 socket → 不必等 debounce + 伺服器廣播往返，拖滑桿時預覽即時跟手（所見即所得）。
  // 真正的 OBS 來源仍透過下方 debounce 的 socket 更新並持久化，兩條路徑套用同一份設定、互不衝突。
  function previewToIframe(s) {
    try {
      // 同時送給所有內嵌預覽（歌詞分頁 + 設定分頁），兩邊都即時跟手
      document.querySelectorAll('iframe.obs-preview').forEach((frame) => {
        if (frame.contentWindow) {
          frame.contentWindow.postMessage({ type: 'lyric-settings:preview', settings: s }, '*');
        }
      });
    } catch (e) { /* 靜默：預覽失敗不影響正式推送 */ }
  }

  function showSampleLyricsInPreview() {
    try {
      document.querySelectorAll('iframe.obs-preview').forEach((frame) => {
        if (frame.contentWindow) {
          frame.contentWindow.postMessage({ type: 'lyrics-preview:sample' }, '*');
        }
      });
    } catch (e) { /* 靜默：示範預覽失敗不影響正式 OBS */ }
  }

  // 推送設定到顯示端：預覽（postMessage）與 OBS（socket）都「每次 input 立即送」，與歌單一致＝真正即時跟手。
  // 之前用 debounce 是因為當時 lyric-settings:update 會在伺服器觸發 broadcastState（整包狀態）很重；
  // 現已移除該 broadcastState，伺服器端只做「合併物件 + 小 io.emit + scheduleSave(只重設 3s 計時器)」，
  // 成本極低，故不再 debounce——否則 debounce 會等「停手」才送，OBS 就變成「定位才更新」。
  function pushSettings() {
    const payload = buildSettingsPayload();
    saveSettings();
    previewToIframe(settings);
    SocketClient.send('lyric-settings:update', payload);
  }

  const sampleLyricsBtn = document.getElementById('btn-preview-sample-lyrics');
  if (sampleLyricsBtn) {
    sampleLyricsBtn.addEventListener('click', showSampleLyricsInPreview);
  }

  // 把單一設定值套到對應的 UI 控制項顯示
  function bindControl(id, key, opts = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    const valEl = opts.valId ? document.getElementById(opts.valId) : null;

    // 初始化顯示
    if (el.type === 'checkbox') {
      el.checked = !!settings[key];
    } else {
      el.value = settings[key];
    }
    if (valEl) valEl.textContent = opts.fmt ? opts.fmt(settings[key]) : settings[key];

    const evt = (el.tagName === 'SELECT' || el.type === 'color' || el.type === 'checkbox') ? 'change' : 'input';
    el.addEventListener(evt, () => {
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'range' || opts.number) v = parseFloat(el.value);
      else v = el.value;
      settings[key] = v;
      if (valEl) valEl.textContent = opts.fmt ? opts.fmt(v) : v;
      pushSettings();
    });
  }

  // ═══════════════════════════════════════════
  // 自訂字體：讓使用者填入本機已安裝的字體名稱
  //  - 完全離線可用（OBS 瀏覽器來源讀的是同一台電腦的系統字體）
  //  - 自動附上回退堆疊（留後路：字體不存在時退回 Noto / 系統字體）
  // ═══════════════════════════════════════════
  const CUSTOM_FONT_VALUE = '__custom__';
  const FONT_FALLBACK = "'Noto Sans TC', 'Noto Sans SC', 'Noto Sans JP', sans-serif";

  function extractPrimaryFont(family) {
    if (!family) return '';
    return String(family).split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  }

  function applyCustomFont(name) {
    const trimmed = (name || '').trim();
    if (trimmed) {
      const quoted = /[,'"]/.test(trimmed) ? trimmed : `'${trimmed}'`;
      settings.fontFamily = `${quoted}, ${FONT_FALLBACK}`;
    } else {
      settings.fontFamily = DEFAULT_SETTINGS.fontFamily;
    }
    pushSettings();
  }

  // 依目前 settings.fontFamily 還原字體下拉與自訂區塊的顯示狀態
  function syncCustomFontUI() {
    const sel = document.getElementById('ls-fontfamily');
    const wrap = document.getElementById('ls-font-custom-wrap');
    const customInput = document.getElementById('ls-fontfamily-custom');
    if (!sel) return;
    const presets = Array.from(sel.options).map((o) => o.value).filter((v) => v !== CUSTOM_FONT_VALUE);
    const isPreset = presets.includes(settings.fontFamily);
    sel.value = isPreset ? settings.fontFamily : CUSTOM_FONT_VALUE;
    if (wrap) wrap.hidden = isPreset;
    if (!isPreset && customInput) customInput.value = extractPrimaryFont(settings.fontFamily);
  }

  // 列出本機字體，填進下拉選單（每個 option 用該字體顯示，像 Word）。
  // 主要來源改為伺服器掃描（/api/fonts：直接讀字體目錄＋解析字型檔，涵蓋「只安裝給
  // 目前使用者」的字體，數量不受瀏覽器 Font Access API 限制）；瀏覽器 queryLocalFonts
  // 若可用則合併補充，兩邊取聯集。
  let cachedFontList = null;
  async function fetchAllFonts() {
    if (cachedFontList) return cachedFontList;
    const names = new Set();
    try {
      const r = await fetch('/api/fonts');
      const data = await r.json();
      if (data && data.success && Array.isArray(data.fonts)) data.fonts.forEach((f) => names.add(f));
    } catch (_) { /* 伺服器掃描失敗 → 退回瀏覽器 API */ }
    if (typeof window.queryLocalFonts === 'function') {
      try {
        (await window.queryLocalFonts()).forEach((f) => names.add(f.family));
      } catch (_) { /* 使用者拒絕授權時仍有伺服器來源 */ }
    }
    cachedFontList = [...names].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    return cachedFontList;
  }
  function fontOptionsHtml(fams, placeholder) {
    return `<option value="">${placeholder}</option>` +
      fams.map((f) => {
        const safe = escapeHtml(f);
        const fam = f.replace(/'/g, '');
        return `<option value="${safe}" style="font-family:'${fam}'">${safe}</option>`;
      }).join('');
  }
  async function loadSystemFonts() {
    const sysSel = document.getElementById('ls-font-system');
    const latinSel = document.getElementById('ls-font-latin');
    const btn = document.getElementById('ls-font-load');
    if (!sysSel) return;
    try {
      if (btn) { btn.disabled = true; btn.textContent = '載入中…'; }
      const fams = await fetchAllFonts();
      if (!fams.length) { showToast('讀取系統字體失敗，請改用手動輸入'); return; }
      sysSel.innerHTML = fontOptionsHtml(fams, '（選擇系統字體）');
      const current = extractPrimaryFont(settings.fontFamily);
      if (fams.includes(current)) sysSel.value = current;
      // 英文（拉丁字母）字體下拉也用同一份清單
      if (latinSel) {
        latinSel.innerHTML = fontOptionsHtml(fams, '（不指定：英文跟主字體）');
        if (settings.fontFamilyLatin && fams.includes(settings.fontFamilyLatin)) latinSel.value = settings.fontFamilyLatin;
      }
      showToast(`已載入 ${fams.length} 個系統字體`);
    } catch (e) {
      showToast('讀取系統字體失敗，請改用手動輸入');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '瀏覽系統字體'; }
    }
  }

  function initCustomFont() {
    const sel = document.getElementById('ls-fontfamily');
    const wrap = document.getElementById('ls-font-custom-wrap');
    const customInput = document.getElementById('ls-fontfamily-custom');
    const sysSel = document.getElementById('ls-font-system');
    const loadBtn = document.getElementById('ls-font-load');
    if (!sel) return;

    syncCustomFontUI();

    sel.addEventListener('change', () => {
      if (sel.value === CUSTOM_FONT_VALUE) {
        if (wrap) wrap.hidden = false;
        if (customInput && customInput.value.trim()) applyCustomFont(customInput.value);
      } else {
        if (wrap) wrap.hidden = true;
        settings.fontFamily = sel.value;
        pushSettings();
      }
    });

    if (customInput) customInput.addEventListener('input', () => applyCustomFont(customInput.value));
    if (sysSel) sysSel.addEventListener('change', () => {
      if (sysSel.value) {
        if (customInput) customInput.value = sysSel.value;
        applyCustomFont(sysSel.value);
      }
    });
    if (loadBtn) loadBtn.addEventListener('click', loadSystemFonts);

    // ── 英文（拉丁字母）分離字體：下拉 + 手動輸入，兩者擇一，空＝跟主字體 ──
    const latinSel = document.getElementById('ls-font-latin');
    const latinInput = document.getElementById('ls-font-latin-custom');
    const latinLoad = document.getElementById('ls-font-latin-load');
    const setLatin = (name) => {
      settings.fontFamilyLatin = (name || '').trim();
      pushSettings();
    };
    if (latinInput) {
      latinInput.value = settings.fontFamilyLatin || '';
      latinInput.addEventListener('input', () => setLatin(latinInput.value));
    }
    if (latinSel) latinSel.addEventListener('change', () => {
      if (latinInput) latinInput.value = latinSel.value;
      setLatin(latinSel.value);
    });
    if (latinLoad) latinLoad.addEventListener('click', loadSystemFonts);
  }

  // ═══════════════════════════════════════════
  // 歌詞位置：3×3 定位格 + X/Y 細調 + 重置
  // ═══════════════════════════════════════════
  function syncPosGrid() {
    const grid = document.getElementById('ls-pos-grid');
    if (!grid) return;
    grid.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active',
        b.dataset.v === settings.verticalPosition && b.dataset.h === settings.horizontalAlign);
    });
  }

  // 九宮格的水平欄位 → 文字對齊：選左欄就順手把文字對齊也設成左，右欄設成右，
  // 中間欄維持置中——避免「區塊放在畫面左邊，但裡面的多行文字還置中」這種視覺不一致。
  const H_TO_TEXT_ALIGN = { 'flex-start': 'left', center: 'center', 'flex-end': 'right' };

  function initPosGrid() {
    const grid = document.getElementById('ls-pos-grid');
    if (grid) {
      grid.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          settings.verticalPosition = btn.dataset.v;
          settings.horizontalAlign = btn.dataset.h;
          const textAlign = H_TO_TEXT_ALIGN[btn.dataset.h];
          if (textAlign) settings.textAlign = textAlign;
          syncPosGrid();
          refreshControls(); // 讓「文字對齊」下拉同步顯示連動後的值
          pushSettings();
        });
      });
    }
    const reset = document.getElementById('ls-pos-reset');
    if (reset) {
      reset.addEventListener('click', () => {
        settings.verticalPosition = DEFAULT_SETTINGS.verticalPosition;
        settings.horizontalAlign = DEFAULT_SETTINGS.horizontalAlign;
        settings.offsetX = 0;
        settings.offsetY = 0;
        refreshControls();
        pushSettings();
      });
    }
    syncPosGrid();
  }

  // ═══════════════════════════════════════════
  // 排版模板（v4）
  // ═══════════════════════════════════════════

  // folia 系模板（有散射/強度概念的）才顯示「動畫強度」控制
  const INTENSITY_TEMPLATES = ['luminous', 'partita', 'tilt', 'mindscape'];

  // 只有「經典疊層」用得到的設定區塊——這些全部是「經典疊層自己的 renderLine 才會讀」的
  // CSS 變數/JS 邏輯（動畫風格 style-buttons、風格微調、九宮格位置定位、行高/字距/文字對齊、
  // 保留行數/歷史字級透明度/描邊陰影發光背景框、羅馬字拼音/諧音顯示、逐字 KTV 模式），
  // v5 模板（Luminous/Partita/Tilt/Mindscape/KTV）都是透過 ctx.getLyrics() 自己組字、
  // 完全不讀這些——顯示出來也是「按了沒反應」，所以切模板時整批隱藏/還原。
  const CLASSIC_ONLY_FIELD_IDS = [
    'style-preset-field', 'style-tune-field',
    'classic-only-typography', 'classic-only-advanced-effects',
    'romaji-xieyin-card', 'classic-only-display-mode',
  ];

  function syncTemplateButtons() {
    document.querySelectorAll('#template-buttons .style-thumb').forEach((b) => {
      b.classList.toggle('active', b.dataset.template === settings.template);
    });
    const isClassic = settings.template === 'classic';

    const intensityField = document.getElementById('intensity-field');
    if (intensityField) intensityField.hidden = !INTENSITY_TEMPLATES.includes(settings.template);
    document.querySelectorAll('#intensity-buttons .style-thumb').forEach((b) => {
      b.classList.toggle('active', b.dataset.intensity === (settings.animationIntensity || 'normal'));
    });

    // 歌詞位置：經典疊層用九宮格全畫面定位，其他模板用置中/偏左/偏右/左右分散
    const gridWrap = document.getElementById('lyric-pos-grid-wrap');
    const posGrid = document.getElementById('ls-pos-grid');
    const offsetXRow = document.getElementById('ls-offset-x-row');
    const offsetYRow = document.getElementById('ls-offset-y-row');
    const quadRow = document.getElementById('lyric-pos-buttons');
    const posHint = document.getElementById('lyric-pos-hint');
    const fineHint = document.getElementById('lyric-pos-fine-hint');
    if (gridWrap) gridWrap.hidden = !isClassic;
    if (posGrid) posGrid.hidden = !isClassic;
    if (offsetXRow) offsetXRow.hidden = !isClassic;
    if (offsetYRow) offsetYRow.hidden = !isClassic;
    if (quadRow) quadRow.hidden = isClassic;
    if (posHint) {
      posHint.textContent = isClassic
        ? '九宮格是整個歌詞區塊在畫面上的位置；細調 X/Y 可再微調偏移。'
        : (settings.template === 'ktv'
          ? 'KTV 伴唱固定雙行構圖；上下位置請到「詳細設定 → 邊距 · 最大寬度 → 上下邊距」調整。'
          : '方便 VTuber／實況主把人物放在畫面固定位置；「左右分散」是一句左、一句右交替。');
    }
    if (fineHint) {
      fineHint.textContent = '拖曳選格子，或用下面細調微調';
    }
    document.querySelectorAll('#lyric-pos-buttons .style-thumb').forEach((b) => {
      b.classList.toggle('active', b.dataset.lyricPos === (settings.lyricPosition || 'center'));
    });
    // 「左右分散」是逐行交替左右——經典疊層（歷史行堆疊）與 KTV（自帶雙行位構圖）不支援
    const splitBtn = document.querySelector('#lyric-pos-buttons .style-thumb[data-lyric-pos="split"]');
    if (splitBtn) splitBtn.disabled = settings.template === 'classic' || settings.template === 'ktv';

    // 經典疊層專用設定區塊：整批顯示/隱藏
    CLASSIC_ONLY_FIELD_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = !isClassic;
    });
  }

  function initTemplatePicker() {
    document.querySelectorAll('#template-buttons .style-thumb').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextTemplate = btn.dataset.template;
        if (!TEMPLATE_IDS.includes(nextTemplate) || nextTemplate === settings.template) return;
        saveCurrentTemplateSnapshot();
        const nextSettings = templateSettings[nextTemplate] || { ...cleanSettingSnapshot(settings), template: nextTemplate };
        settings = { ...DEFAULT_SETTINGS, ...cleanSettingSnapshot(nextSettings), template: nextTemplate };
        if ((settings.template === 'classic' || settings.template === 'ktv') && settings.lyricPosition === 'split') {
          settings.lyricPosition = 'center';
        }
        refreshControls();
        pushSettings();
      });
    });
    document.querySelectorAll('#intensity-buttons .style-thumb').forEach((btn) => {
      btn.addEventListener('click', () => {
        settings.animationIntensity = btn.dataset.intensity;
        syncTemplateButtons();
        pushSettings();
      });
    });
    document.querySelectorAll('#lyric-pos-buttons .style-thumb').forEach((btn) => {
      btn.addEventListener('click', () => {
        settings.lyricPosition = btn.dataset.lyricPos;
        syncTemplateButtons();
        pushSettings();
      });
    });
    syncTemplateButtons();
  }

  // ═══════════════════════════════════════════
  // 自訂背景（Phase 4）
  // ═══════════════════════════════════════════

  function syncBackgroundUI() {
    const previewWrap = document.getElementById('display-bg-preview-wrap');
    const previewImg = document.getElementById('display-bg-preview');
    const removeBtn = document.getElementById('display-bg-remove');
    if (previewWrap && previewImg) {
      if (settings.displayBgImage) {
        previewImg.src = `/background/${encodeURIComponent(settings.displayBgImage)}`;
        previewWrap.hidden = false;
      } else {
        previewImg.src = '';
        previewWrap.hidden = true;
      }
    }
    if (removeBtn) removeBtn.disabled = !settings.displayBgImage;
    const opacityEl = document.getElementById('display-bg-opacity');
    const opacityVal = document.getElementById('display-bg-opacity-val');
    if (opacityEl) opacityEl.value = settings.displayBgOpacity;
    if (opacityVal) opacityVal.textContent = Math.round(settings.displayBgOpacity * 100) + '%';
    const fitEl = document.getElementById('display-bg-fit');
    if (fitEl) fitEl.value = settings.displayBgFit || 'cover';
  }

  function initBackgroundControls() {
    const uploadInput = document.getElementById('display-bg-upload');
    if (uploadInput) {
      uploadInput.addEventListener('change', async () => {
        const file = uploadInput.files && uploadInput.files[0];
        if (!file) return;
        try {
          const formData = new FormData();
          formData.append('background', file);
          const res = await PinAuth.fetchWithPin('/api/background', { method: 'POST', body: formData });
          const data = await res.json();
          if (!res.ok || !data.success) {
            showToast(data.error || '背景上傳失敗');
            return;
          }
          settings.displayBgImage = data.filename;
          syncBackgroundUI();
          pushSettings();
          showToast('背景已更新');
        } catch (e) {
          showToast('背景上傳失敗');
        } finally {
          uploadInput.value = '';
        }
      });
    }

    const removeBtn = document.getElementById('display-bg-remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', async () => {
        try {
          const res = await PinAuth.fetchWithPin('/api/background', { method: 'DELETE' });
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error || '伺服器未確認刪除');
        } catch (e) { showToast(`背景刪除失敗：${e.message}`); return; }
        settings.displayBgImage = '';
        syncBackgroundUI();
        pushSettings();
      });
    }

    const opacityEl = document.getElementById('display-bg-opacity');
    if (opacityEl) {
      opacityEl.addEventListener('input', () => {
        settings.displayBgOpacity = parseFloat(opacityEl.value);
        const v = document.getElementById('display-bg-opacity-val');
        if (v) v.textContent = Math.round(settings.displayBgOpacity * 100) + '%';
        pushSettings();
      });
    }

    const fitEl = document.getElementById('display-bg-fit');
    if (fitEl) {
      fitEl.addEventListener('change', () => {
        settings.displayBgFit = fitEl.value;
        pushSettings();
      });
    }

    syncBackgroundUI();
  }

  function renderLyricPresetUI() {
    const sel = document.getElementById('lyric-preset-select');
    const loadBtn = document.getElementById('lyric-preset-load');
    const delBtn = document.getElementById('lyric-preset-delete');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = lyricPresets.length
      ? lyricPresets.map((p) => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.name) + '</option>').join('')
      : '<option value="">尚未保存預設</option>';
    if (lyricPresets.some((p) => p.id === current)) sel.value = current;
    const disabled = lyricPresets.length === 0;
    if (loadBtn) loadBtn.disabled = disabled;
    if (delBtn) delBtn.disabled = disabled;
  }

  function askLyricPresetName(defaultName) {
    const modal = document.getElementById('lyric-preset-name-modal');
    const input = document.getElementById('lyric-preset-name-input');
    const confirmBtn = document.getElementById('lyric-preset-name-confirm');
    const cancelBtn = document.getElementById('lyric-preset-name-cancel');
    const error = document.getElementById('lyric-preset-name-error');
    if (!modal || !input || !confirmBtn || !cancelBtn) return Promise.resolve('');

    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        modal.hidden = true;
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdrop);
        input.removeEventListener('keydown', onKeydown);
        resolve(value);
      };
      const showError = (msg) => {
        if (!error) return;
        error.textContent = msg;
        error.style.display = msg ? 'block' : 'none';
      };
      const onConfirm = () => {
        const name = input.value.trim();
        if (!name) {
          showError('請輸入預設名稱');
          input.focus();
          return;
        }
        finish(name);
      };
      const onCancel = () => finish('');
      const onBackdrop = (e) => { if (e.target === modal) finish(''); };
      const onKeydown = (e) => {
        if (e.key === 'Enter') onConfirm();
        if (e.key === 'Escape') finish('');
      };

      input.value = defaultName || '';
      showError('');
      modal.hidden = false;
      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', onCancel);
      modal.addEventListener('click', onBackdrop);
      input.addEventListener('keydown', onKeydown);
      setTimeout(() => { input.focus(); input.select(); }, 0);
    });
  }

  function initLyricPresetControls() {
    const saveBtn = document.getElementById('lyric-preset-save');
    const loadBtn = document.getElementById('lyric-preset-load');
    const delBtn = document.getElementById('lyric-preset-delete');
    const sel = document.getElementById('lyric-preset-select');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const defaultName = (settings.template || 'classic') + ' ' + new Date().toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        const name = await askLyricPresetName(defaultName);
        if (!name) return;
        saveCurrentTemplateSnapshot();
        const existing = lyricPresets.find((p) => p.name === name);
        if (existing && !confirm('已有同名預設，要覆蓋嗎？')) return;
        const item = { id: existing ? existing.id : String(Date.now()), name, settings: cleanSettingSnapshot(settings) };
        if (existing) existing.settings = item.settings;
        else lyricPresets.push(item);
        saveSettings();
        SocketClient.send('lyric-settings:update', buildSettingsPayload());
        renderLyricPresetUI();
        if (sel) sel.value = item.id;
        showToast('已保存歌詞外觀預設');
      });
    }
    if (loadBtn) {
      loadBtn.addEventListener('click', () => {
        const item = lyricPresets.find((p) => p.id === (sel && sel.value));
        if (!item) return;
        saveCurrentTemplateSnapshot();
        settings = { ...DEFAULT_SETTINGS, ...cleanSettingSnapshot(item.settings) };
        if (!TEMPLATE_IDS.includes(settings.template)) settings.template = 'classic';
        if ((settings.template === 'classic' || settings.template === 'ktv') && settings.lyricPosition === 'split') settings.lyricPosition = 'center';
        refreshControls();
        pushSettings();
        showToast('已套用歌詞外觀預設');
      });
    }
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        const item = lyricPresets.find((p) => p.id === (sel && sel.value));
        if (!item || !confirm('確定刪除預設「' + item.name + '」？')) return;
        lyricPresets = lyricPresets.filter((p) => p.id !== item.id);
        saveSettings();
        SocketClient.send('lyric-settings:update', buildSettingsPayload());
        renderLyricPresetUI();
        showToast('已刪除歌詞外觀預設');
      });
    }
    renderLyricPresetUI();
  }

  function initSettingsPanel() {
    CONTROLS.forEach((c) => bindControl(c.id, c.key, c));

    // 陰影：預設樣式 + 顏色 → 組成 CSS 字串
    const applyShadow = () => { settings.shadow = buildShadow(settings.shadowPreset, settings.shadowColor); };
    const shadowSel = document.getElementById('ls-shadow');
    if (shadowSel) {
      shadowSel.value = settings.shadowPreset || 'soft';
      shadowSel.addEventListener('change', () => {
        settings.shadowPreset = shadowSel.value;
        applyShadow();
        pushSettings();
      });
    }
    const shadowColorEl = document.getElementById('ls-shadow-color');
    if (shadowColorEl) {
      shadowColorEl.value = settings.shadowColor || '#000000';
      shadowColorEl.addEventListener('input', () => {
        settings.shadowColor = shadowColorEl.value;
        applyShadow();
        pushSettings();
      });
    }

    // 高亮發光：顏色 + 強度（原子值 → 合成 settings.glow）
    const glowColorEl = document.getElementById('ls-glow-color');
    if (glowColorEl) {
      glowColorEl.value = settings.glowColor || '#ffd6a5';
      glowColorEl.addEventListener('input', () => {
        settings.glowColor = glowColorEl.value;
        applyGlow();
        pushSettings();
      });
    }
    const glowStrengthEl = document.getElementById('ls-glow-strength');
    if (glowStrengthEl) {
      glowStrengthEl.value = settings.glowStrength;
      const glowVal = document.getElementById('ls-glow-strength-val');
      if (glowVal) glowVal.textContent = (Number(settings.glowStrength) > 0 ? settings.glowStrength + 'px' : '關');
      glowStrengthEl.addEventListener('input', () => {
        settings.glowStrength = parseFloat(glowStrengthEl.value);
        if (glowVal) glowVal.textContent = (settings.glowStrength > 0 ? settings.glowStrength + 'px' : '關');
        applyGlow();
        pushSettings();
      });
    }

    // 背景框：顏色 + 透明度（原子值 → 合成 settings.textBg / textBgPad）
    const bgColorEl = document.getElementById('ls-bg-color');
    if (bgColorEl) {
      bgColorEl.value = settings.bgColor || '#000000';
      bgColorEl.addEventListener('input', () => {
        settings.bgColor = bgColorEl.value;
        applyBg();
        pushSettings();
      });
    }
    const bgOpacityEl = document.getElementById('ls-bg-opacity');
    if (bgOpacityEl) {
      bgOpacityEl.value = settings.bgOpacity;
      const bgVal = document.getElementById('ls-bg-opacity-val');
      if (bgVal) bgVal.textContent = (Number(settings.bgOpacity) > 0 ? Math.round(settings.bgOpacity * 100) + '%' : '關');
      bgOpacityEl.addEventListener('input', () => {
        settings.bgOpacity = parseFloat(bgOpacityEl.value);
        if (bgVal) bgVal.textContent = (settings.bgOpacity > 0 ? Math.round(settings.bgOpacity * 100) + '%' : '關');
        applyBg();
        pushSettings();
      });
    }

    // 自訂字體（系統字體下拉 / 手動輸入，離線可用）
    initCustomFont();

    // 歌詞位置 3×3 定位格 + 細調
    initPosGrid();

    // 排版模板（v4）與自訂背景（Phase 4）
    initTemplatePicker();
    initLyricPresetControls();
    initBackgroundControls();

    // 重置按鈕：回到預設並推送一次
    const resetBtn = document.getElementById('ls-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        const tpl = TEMPLATE_IDS.includes(settings.template) ? settings.template : 'classic';
        settings = { ...DEFAULT_SETTINGS, template: tpl };
        templateSettings[tpl] = { ...settings };
        saveSettings();
        refreshControls();
        previewToIframe(settings);
        SocketClient.send('lyric-settings:update', buildSettingsPayload());
      });
    }

    // 伺服器為設定的真實來源：連線取得 state 後採用其持久化設定；
    // 重連後允許再採用一次（避免換瀏覽器 / 清掉 localStorage 後把設定洗成預設）。
    SocketClient.on('state:sync', adoptServerSettings);
    // 手機遙控器或另一個面板改模板/預設時，現有面板也要立即更新；
    // 這裡只採用並刷新 UI，不回送 socket，避免自己的事件形成迴圈。
    SocketClient.on('lyric-settings:update', applyServerSettings);
    SocketClient.on('connection-change', (connected) => {
      if (!connected) serverSettingsApplied = false;
    });
  }

  // ═══════════════════════════════════════════
  // 歌詞選擇器
  // ═══════════════════════════════════════════

  let pickerCurrentTrack = null;

  function openPicker(track) {
    if (!track) {
      showToast('請先選擇一首歌曲');
      return;
    }
    pickerCurrentTrack = track;
    const modal = document.getElementById('lyrics-picker-modal');
    if (!modal) return;
    modal.hidden = false;

    // 預填搜尋欄（使用者可改成正確的歌手/歌名再搜尋）
    const artistEl = document.getElementById('picker-artist');
    const titleEl = document.getElementById('picker-title');
    if (artistEl) artistEl.value = track.artist || '';
    if (titleEl) titleEl.value = track.title || track.name || '';

    runPickerSearch();
  }

  // 依搜尋欄目前的歌手/歌名查詢候選歌詞（自動開啟時與手動「搜尋」共用）
  function runPickerSearch() {
    const body = document.getElementById('lyrics-picker-body');
    if (!body) return;
    const artist = (document.getElementById('picker-artist') || {}).value || '';
    const title = (document.getElementById('picker-title') || {}).value || '';
    if (!title.trim()) {
      body.innerHTML = '<div class="picker-empty">請輸入歌名再搜尋</div>';
      return;
    }
    body.innerHTML = '<div class="picker-loading"><span class="loading-spinner"></span>正在從各來源搜尋歌詞<span class="busy-dots"></span></div>';

    const payload = {
      artist: artist.trim(),
      title: title.trim(),
      duration: Math.round((pickerCurrentTrack && pickerCurrentTrack.duration) || 0),
    };

    PinAuth.fetchWithPin('/api/lyrics/candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(r => r.json())
      .then(data => {
        if (!data.success || !Array.isArray(data.candidates) || data.candidates.length === 0) {
          body.innerHTML = '<div class="picker-empty">沒有找到任何來源的歌詞<br>試試只填歌名、或改用「貼上歌詞」手動輸入</div>';
          renderProviderHealth(body, data.providerHealth);
          return;
        }
        renderCandidates(body, data.candidates, data.providerHealth);
      })
      .catch(err => {
        body.innerHTML = `<div class="picker-empty">查詢失敗：${escapeHtml(err.message)}</div>`;
      });
  }

  function renderProviderHealth(body, health) {
    if (!Array.isArray(health)) return;
    const paused = health.filter(item => item.state === 'paused');
    const timeouts = health.reduce((sum, item) => sum + (Number(item.timeouts) || 0), 0);
    if (paused.length === 0 && timeouts === 0) return;
    const notice = document.createElement('div');
    notice.className = 'picker-health-notice';
    const parts = [];
    if (paused.length) parts.push(`${paused.length} 個來源暫時休息，稍後會自動重試`);
    if (timeouts) parts.push(`本次執行已記錄 ${timeouts} 次逾時`);
    notice.textContent = parts.join('；');
    body.prepend(notice);
  }

  function renderCandidates(body, candidates, health) {
    body.innerHTML = '';
    candidates.forEach((c) => {
      const el = document.createElement('div');
      el.className = 'candidate';

      const tags = [];
      tags.push(`<span class="candidate-tag ${c.isWordByWord ? 'word' : ''}">${c.isWordByWord ? '逐字' : '逐句'}</span>`);
      if (c.durationMatch) tags.push('<span class="candidate-tag match">時長吻合</span>');
      tags.push(`<span class="candidate-tag">${c.lineCount} 行</span>`);

      const preview = (c.preview || []).map(p =>
        `<div class="cp-line"><span class="cp-time">${escapeHtml(p.timeLabel)}</span><span>${escapeHtml(p.text || '（空行）')}</span></div>`
      ).join('');

      el.innerHTML = `
        <div class="candidate-head">
          <span class="candidate-source">${escapeHtml(c.sourceLabel)}</span>
          ${tags.join('')}
        </div>
        <div class="candidate-preview">${preview || '<span class="cp-time">無預覽</span>'}</div>
      `;

      el.addEventListener('click', () => {
        body.querySelectorAll('.candidate').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
        applyCandidate(c);
      });

      body.appendChild(el);
    });
    renderProviderHealth(body, health);
  }

  function applyCandidate(candidate) {
    if (!pickerCurrentTrack) return;
    // 透過 app.js 的 applyManualLyrics 套用（會同步更新本地播放清單顯示——歌詞狀態 dot
    // 立即翻色，不限於當前播放中的那首——並照舊持久化到伺服器/自動羅馬化/記憶）。
    if (window.VKState && window.VKState.applyManualLyrics) {
      window.VKState.applyManualLyrics(pickerCurrentTrack.id, candidate.lyrics, candidate.type, null);
    } else {
      SocketClient.send('lyrics:manual', {
        trackId: pickerCurrentTrack.id,
        lyrics: candidate.lyrics,
        lyricsType: candidate.type,
        parsedLyrics: null, // 由顯示端解析
      });
    }
    showToast(`已套用 ${candidate.sourceLabel} 的歌詞`);
    setTimeout(closePicker, 600);
  }

  function closePicker() {
    const modal = document.getElementById('lyrics-picker-modal');
    if (modal) modal.hidden = true;
  }

  function initPicker() {
    const openBtn = document.getElementById('btn-lyrics-picker');
    const closeBtn = document.getElementById('lyrics-picker-close');
    const modal = document.getElementById('lyrics-picker-modal');

    if (openBtn) {
      openBtn.addEventListener('click', () => {
        // 從全域取得當前歌曲（app.js 會把它掛在 window.VKState）
        const track = (window.VKState && window.VKState.getCurrentTrack)
          ? window.VKState.getCurrentTrack() : null;
        openPicker(track);
      });
    }
    if (closeBtn) closeBtn.addEventListener('click', closePicker);
    if (modal) {
      modal.addEventListener('click', (e) => { if (e.target === modal) closePicker(); });
    }

    // 自訂搜尋：按鈕 + 兩個輸入框 Enter
    const searchBtn = document.getElementById('picker-search-btn');
    if (searchBtn) searchBtn.addEventListener('click', runPickerSearch);
    ['picker-artist', 'picker-title'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') runPickerSearch(); });
    });
  }

  // ═══════════════════════════════════════════
  // 工具
  // ═══════════════════════════════════════════

  function showToast(msg) {
    const t = document.getElementById('app-toast');
    if (!t) { console.log('[Toast]', msg); return; }
    t.textContent = msg;
    t.classList.add('visible');
    setTimeout(() => t.classList.remove('visible'), 2200);
  }

  // 讓播放清單的「歌詞狀態」按鈕（app.js）可以直接為任一首歌開啟選擇器，
  // 不限於目前播放中的那首。
  window.LyricPicker = { open: openPicker };

  // ─── 啟動 ───
  function init() {
    initSettingsPanel();
    initPicker();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
