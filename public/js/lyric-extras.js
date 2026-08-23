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
    fontSize: 56,
    fontFamily: "'Noto Sans SC', 'Noto Sans JP', 'Noto Sans KR', sans-serif",
    fontFamilyLatin: '', // 英文（拉丁字母/數字）專用字體；空＝跟主字體。display 端會組成「英文字體, 主字體」
    fontWeight: 900,
    color: '#8f8f8f',
    activeColor: '#febc6c',
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
    template: 'classic',  // 'classic' | 'pulse' | 'facet' | 'drift' | 'aura' | 'ktv' | 'columnflow' | 'paperstrip' | 'mirror'
    animationIntensity: 'normal', // folia 系模板的散射強度：'calm' | 'normal' | 'chaotic'
    lyricPosition: 'center', // 歌詞水平位置：'center' | 'left' | 'right' | 'split'（左右分散＝逐行交替）
    columnflowVariant: 'sen', // 直書句流：'sen' | 'fuda'
    columnflowPlacement: 'split', // 直書句流：'left' | 'right' | 'split'
    columnflowMaxLines: 4, // 直書句流：同時保留 1–6 句
    columnflowSafeMargin: 11, // 直書句流：中央安全距離（%，5–25），兩側直行不會跨入
    columnflowShowSafeZoneOnObs: false, // 直書句流：安全距離引導線是否也疊在真正的 OBS 來源上（預設只有面板預覽看得到）
    stageSafeMargin: 2, // Pulse/Facet/Drift/Aura/紙帶逐字/鏡像：左右分散時的中央安全距離（%，2–25），預設對應原本寫死的 48/52%
    stageShowSafeZoneOnObs: false, // 同上：安全距離引導線是否也疊在真正的 OBS 來源上
    // ── 自訂背景（Phase 4）：鍵名加 display 前綴避免與上面歌詞文字背景框(bgColor/bgOpacity)撞名 ──
    displayBgImage: '',   // 檔名（'' = 無背景，維持透明）
    displayBgOpacity: 1,
    displayBgFit: 'cover', // 'cover' | 'contain' | 'fill'
  };

  const TEMPLATE_IDS = ['classic', 'pulse', 'facet', 'drift', 'aura', 'ktv', 'columnflow', 'paperstrip', 'mirror'];
  // 將模板的「設定頁能力」集中在這裡。新增模板時，只需補上預設值、這份描述，
  // 以及一張 data-template 對應的卡片；設定頁不需要再散落模板名稱判斷。
  const TEMPLATE_UI = {
    classic: { label: '經典疊層', description: '完整歌詞畫面，適合需要看見歷史行、拼音或諧音的演出。', scope: '可調：九宮格位置、字型、歷史行、拼音與諧音、描邊與陰影。', positionMode: 'grid', supportsIntensity: false, supportsClassicControls: true },
    pulse: { label: 'Pulse', description: '明亮聚焦的單句演出，適合主唱與節奏感明確的歌曲。', scope: '可調：舞台位置、字型、配色、動畫強度與背景。此模板不支援拼音／諧音；需要雙語請選「經典疊層」。', positionMode: 'stage', supportsIntensity: true, supportsClassicControls: false },
    facet: { label: 'Facet', description: '段落感清楚、節奏分明的歌詞動畫。', scope: '可調：舞台位置、字型、配色、動畫強度與背景。此模板不支援拼音／諧音；需要雙語請選「經典疊層」。', positionMode: 'stage', supportsIntensity: true, supportsClassicControls: false },
    drift: { label: 'Drift', description: '斜向節拍與逐字律動，適合節奏鮮明的歌曲。', scope: '可調：舞台位置、字型、配色、動畫強度與背景。此模板不支援拼音／諧音；需要雙語請選「經典疊層」。', positionMode: 'stage', supportsIntensity: true, supportsClassicControls: false },
    aura: { label: 'Aura', description: '沉浸式的慢節奏氛圍，適合抒情與敘事歌曲。', scope: '可調：舞台位置、字型、配色、動畫強度與背景。此模板不支援拼音／諧音；需要雙語請選「經典疊層」。', positionMode: 'stage', supportsIntensity: true, supportsClassicControls: false },
    ktv: { label: 'KTV', description: '固定雙行演唱畫面，適合逐字或跟唱情境。', scope: '可調：字型、配色、背景與詳細的邊距設定；雙行位置固定。此模板不支援拼音／諧音；需要雙語請選「經典疊層」。', positionMode: 'fixed', supportsIntensity: false, supportsClassicControls: false },
    columnflow: { label: '直書句流', description: '直行在畫面兩側自然錯落，逐字浮現，唱過的句子留下淡淡殘影。', scope: '可調：直書樣式、左右配置、保留句數、字型、配色與背景。此模板不支援拼音／諧音；需要雙語請選「經典疊層」。', positionMode: 'fixed', supportsIntensity: false, supportsClassicControls: false },
    paperstrip: { label: '紙帶逐字', description: '白色紙帶先展開，再依歌詞時間逐字填入；每頁會依句長、總字數與節奏穩定選擇 2～4 句，小／中／大尺寸在進場前一次決定。', scope: '可調：舞台位置、中央安全距離、字型、文字色與背景；白色紙帶為模板固定視覺。偏左／偏右與左右分散都會限制可用寬度。此模板不支援拼音／諧音；需要雙語請選「經典疊層」。', positionMode: 'stage', supportsIntensity: false, supportsClassicControls: false },
    mirror: { label: '鏡像', description: '固定左右雙側構圖：每句左側實心原文逐字落位，右側空心鏡像字輕微跟上，中央完整保留人物空間。', scope: '可調：沉穩／標準／狂放動畫強度。標準保留目前的逐字飛入、旋轉、落位與唱詞彈跳；強度不改變時間軸或中央安全區。日文鏡像只把平假名轉成片假名；中文／韓文／英文原樣保留。此模板不支援拼音／諧音；需要雙語請選「經典疊層」。', positionMode: 'fixed', supportsIntensity: true, supportsClassicControls: false },
  };

  function getTemplateUI(template) {
    return TEMPLATE_UI[template] || TEMPLATE_UI.classic;
  }
  // 每個模板都有自己的預設外觀與獨立的設定快照。
  const TEMPLATE_DEFAULTS = {
    classic: { ...DEFAULT_SETTINGS, template: 'classic' },
    pulse: { ...DEFAULT_SETTINGS, template: 'pulse', fontSize: 50, color: '#ddfe9f', activeColor: '#38ff45', verticalPosition: 'center' },
    facet: { ...DEFAULT_SETTINGS, template: 'facet', fontSize: 45, color: '#9181bb', activeColor: '#5d0a94', verticalPosition: 'center' },
    drift: { ...DEFAULT_SETTINGS, template: 'drift', fontSize: 45, color: '#c0ff38', activeColor: '#ffc800', verticalPosition: 'center', animationIntensity: 'calm' },
    aura: { ...DEFAULT_SETTINGS, template: 'aura', fontSize: 72, color: '#ffffff', activeColor: '#14a5ff', verticalPosition: 'center' },
    ktv: { ...DEFAULT_SETTINGS, template: 'ktv', fontSize: 40, color: '#ffffff', activeColor: '#0400ff', verticalPosition: 'center' },
    columnflow: { ...DEFAULT_SETTINGS, template: 'columnflow', fontFamily: "'Noto Serif TC', 'PMingLiU', serif", fontWeight: 600, fontSize: 48, color: '#f4efe5', activeColor: '#f0c978', shadow: '0 1px 7px rgba(0,0,0,.72)', verticalPosition: 'center', columnflowVariant: 'sen', columnflowPlacement: 'split', columnflowMaxLines: 4, columnflowSafeMargin: 11, columnflowShowSafeZoneOnObs: false },
    paperstrip: { ...DEFAULT_SETTINGS, template: 'paperstrip', fontWeight: 600, fontSize: 56, color: '#111111', activeColor: '#111111', shadow: 'none', verticalPosition: 'center', lyricPosition: 'center', letterSpacing: 1 },
    mirror: { ...DEFAULT_SETTINGS, template: 'mirror', fontWeight: 900, fontSize: 60, color: '#ffffff', activeColor: '#ffffff', shadow: 'none', verticalPosition: 'center', lyricPosition: 'split', stageSafeMargin: 13, letterSpacing: 1, animationIntensity: 'normal' },
  };
  const COLUMNFLOW_VARIANTS = ['sen', 'fuda'];
  const COLUMNFLOW_PLACEMENTS = ['left', 'right', 'split'];
  const COLUMNFLOW_MIN_LINES = 1;
  const COLUMNFLOW_MAX_LINES = 6;
  const COLUMNFLOW_MIN_SAFE_MARGIN = 5;
  const COLUMNFLOW_MAX_SAFE_MARGIN = 25;
  // paperstrip／mirror 跟 Pulse/Facet/Drift/Aura 共用同一組 stageSafeMargin（不是 columnflow 那組獨立值）。
  const STAGE_POSITION_TEMPLATES = ['pulse', 'facet', 'drift', 'aura', 'paperstrip', 'mirror'];
  const STAGE_MIN_SAFE_MARGIN = 2;
  const STAGE_MAX_SAFE_MARGIN = 25;
  // 位置微調（X/Y）滑桿刻度：實際套用時 display.js 還會依當下內容再收緊一次（reclampLyricOffset），
  // 這裡只是配合「調得到的範圍」給合理刻度，避免滑桿大半段拖了沒效果。
  // 舞台模板貼著畫面邊界：往外（更靠近該側邊緣）能調的範圍很小，往內（回中央）空間大很多。
  const STAGE_OFFSET_X_OUTWARD = 50;
  const STAGE_OFFSET_X_OUTWARD_AURA = 70; // 潮汐心景版面比其他三款鬆，往外多留 20px（見 display.css）
  const STAGE_OFFSET_X_INWARD = 400;
  const STAGE_OFFSET_Y_RANGE = 150;
  const CLASSIC_OFFSET_RANGE = 400;
  const TEMPLATE_SETTING_KEY = 'lyricTemplateSettings';
  const PRESET_KEY = 'lyricPresets';
  let templateSettings = {};
  let lyricPresets = [];

  function templateDefaults(template) {
    return { ...(TEMPLATE_DEFAULTS[template] || TEMPLATE_DEFAULTS.classic) };
  }

  function normalizeColumnflowMaxLines(value) {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.columnflowMaxLines;
    return Math.max(COLUMNFLOW_MIN_LINES, Math.min(COLUMNFLOW_MAX_LINES, parsed));
  }

  function normalizeColumnflowSafeMargin(value) {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.columnflowSafeMargin;
    return Math.max(COLUMNFLOW_MIN_SAFE_MARGIN, Math.min(COLUMNFLOW_MAX_SAFE_MARGIN, parsed));
  }

  function normalizeStageSafeMargin(value) {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.stageSafeMargin;
    return Math.max(STAGE_MIN_SAFE_MARGIN, Math.min(STAGE_MAX_SAFE_MARGIN, parsed));
  }

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
        if (src[id] && typeof src[id] === 'object') {
          out[id] = { ...templateDefaults(id), ...cleanSettingSnapshot(src[id]), template: id };
          if (id === 'columnflow') {
            if (!COLUMNFLOW_VARIANTS.includes(out[id].columnflowVariant)) out[id].columnflowVariant = 'sen';
            if (!COLUMNFLOW_PLACEMENTS.includes(out[id].columnflowPlacement)) out[id].columnflowPlacement = 'split';
            out[id].columnflowMaxLines = normalizeColumnflowMaxLines(out[id].columnflowMaxLines);
            out[id].columnflowSafeMargin = normalizeColumnflowSafeMargin(out[id].columnflowSafeMargin);
            out[id].columnflowShowSafeZoneOnObs = !!out[id].columnflowShowSafeZoneOnObs;
          }
          if (STAGE_POSITION_TEMPLATES.includes(id)) {
            out[id].stageSafeMargin = normalizeStageSafeMargin(out[id].stageSafeMargin);
            out[id].stageShowSafeZoneOnObs = !!out[id].stageShowSafeZoneOnObs;
          }
          if (id === 'mirror') out[id].lyricPosition = 'split';
        }
      });
    }
    const base = cleanSettingSnapshot(fallback || {});
    const tpl = TEMPLATE_IDS.includes(base.template) ? base.template : 'classic';
    if (!out[tpl]) out[tpl] = { ...templateDefaults(tpl), ...base, template: tpl };
    if (out.mirror) out.mirror.lyricPosition = 'split';
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
    templateSettings[tpl] = { ...templateDefaults(tpl), ...cleanSettingSnapshot(settings), template: tpl };
  }

  function buildSettingsPayload() {
    saveCurrentTemplateSnapshot();
    return { ...cleanSettingSnapshot(settings), [TEMPLATE_SETTING_KEY]: templateSettings, [PRESET_KEY]: lyricPresets };
  }

  let settings = loadSettings();
  // 是否已採用「伺服器端持久化設定」。每次（重）連線後採用一次，避免拖滑桿時被回推迴圈。

  let serverSettingsApplied = false;
  let latestSaveRequest = 0;
  let lyricSaveStatus = {
    state: 'saved',
    key: 'settings.workspace.liveSaved',
    fallback: '已即時儲存',
    vars: null,
    savedAt: null,
  };

  function workspaceText(key, fallback, vars) {
    const translated = window.I18n?.t?.(key, vars);
    return translated && translated !== key ? translated : fallback;
  }

  function renderLyricSaveStatus() {
    let vars = lyricSaveStatus.vars || undefined;
    let fallback = lyricSaveStatus.fallback;
    if (lyricSaveStatus.savedAt) {
      const time = new Date(lyricSaveStatus.savedAt).toLocaleTimeString(window.I18n?.current?.() || 'zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      vars = { time };
      fallback = `已儲存 ${time}`;
    }
    const message = workspaceText(lyricSaveStatus.key, fallback, vars);
    document.querySelectorAll('[data-lyrics-save-status]').forEach((el) => {
      el.classList.remove('saving', 'saved', 'error');
      el.classList.add(lyricSaveStatus.state);
      el.textContent = message;
    });
  }

  function setSaveStatus(state, key, fallback, vars, savedAt) {
    lyricSaveStatus = { state, key, fallback, vars: vars || null, savedAt: savedAt || null };
    renderLyricSaveStatus();
  }

  function confirmSettingsSaved(payload) {
    const requestId = ++latestSaveRequest;
    setSaveStatus('saving', 'settings.workspace.saving', '儲存中…');
    SocketClient.sendWithCallback('lyric-settings:update', payload, (result, transportError) => {
      if (requestId !== latestSaveRequest) return;
      if (result?.ok) {
        setSaveStatus('saved', 'settings.workspace.savedAt', '已儲存', null, result.savedAt || Date.now());
      } else {
        const message = result?.error || transportError?.code || workspaceText('twitch.error.noResponse', '伺服器沒有回應');
        setSaveStatus('error', 'settings.workspace.saveFailed', `儲存失敗：${message}`, { message });
      }
    });
  }

  renderLyricSaveStatus();
  window.addEventListener('i18n:change', renderLyricSaveStatus);

  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      if (raw) {
        const parsed = JSON.parse(raw);
        templateSettings = normalizeTemplateSettings(parsed[TEMPLATE_SETTING_KEY], parsed);
        lyricPresets = normalizePresets(parsed[PRESET_KEY]);
        return { ...templateDefaults('classic'), ...cleanSettingSnapshot(parsed) };
      }
    } catch (e) { /* 忽略 */ }
    templateSettings = normalizeTemplateSettings(null, DEFAULT_SETTINGS);
    return templateDefaults('classic');
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
    settings = { ...templateDefaults(tpl), ...(templateSettings[tpl] || {}), ...clean, template: tpl };
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
      const payload = buildSettingsPayload();
      confirmSettingsSaved(payload);
    } else {
      setSaveStatus('saved', 'settings.workspace.liveSaved', '已即時儲存');
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
    confirmSettingsSaved(payload);
  }

  document.querySelectorAll('.btn-preview-sample-lyrics').forEach((button) => {
    button.addEventListener('click', showSampleLyricsInPreview);
  });

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
  // 字體名稱可來自作業系統與 Font Access API；即使通常可信，也不把它拼進
  // option 的 HTML/style 字串。textContent 保護文字與 value，CSSOM 僅設定單一
  // font-family 屬性，特殊字元不可能跳出成為新的 attribute 或 HTML。
  function setFontOptions(select, fams, placeholder) {
    if (!select) return;
    const fragment = document.createDocumentFragment();
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = placeholder;
    fragment.appendChild(emptyOption);
    fams.forEach((family) => {
      if (typeof family !== 'string' || !family) return;
      const option = document.createElement('option');
      option.value = family;
      option.textContent = family;
      option.style.fontFamily = family;
      fragment.appendChild(option);
    });
    select.textContent = '';
    select.appendChild(fragment);
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
      setFontOptions(sysSel, fams, '（選擇系統字體）');
      const current = extractPrimaryFont(settings.fontFamily);
      if (fams.includes(current)) sysSel.value = current;
      // 英文（拉丁字母）字體下拉也用同一份清單
      if (latinSel) {
        setFontOptions(latinSel, fams, '（不指定：英文跟主字體）');
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
    const offsetReset = document.getElementById('ls-offset-reset');
    if (offsetReset) {
      offsetReset.addEventListener('click', () => {
        settings.offsetX = 0;
        settings.offsetY = 0;
        refreshControls();
        pushSettings();
      });
    }
  }

  // ═══════════════════════════════════════════
  // 排版模板（v4）
  // ═══════════════════════════════════════════

  // 只有「經典疊層」用得到的設定區塊——這些全部是「經典疊層自己的 renderLine 才會讀」的
  // CSS 變數/JS 邏輯（動畫風格 style-buttons、風格微調、九宮格位置定位、行高/字距/文字對齊、
  // 保留行數/歷史字級透明度/描邊陰影發光背景框、羅馬字拼音/諧音顯示、逐字 KTV 模式），
  // 非經典模板都是透過 ctx.getLyrics() 自己組字、
  // 完全不讀這些——顯示出來也是「按了沒反應」，所以切模板時整批隱藏/還原。
  const CLASSIC_ONLY_FIELD_IDS = [
    'style-preset-field', 'style-tune-field',
    'classic-only-typography', 'classic-only-advanced-effects', 'classic-only-advanced-effect-card',
    'romaji-xieyin-card', 'classic-only-display-mode',
  ];

  function syncTemplateButtons() {
    const ui = getTemplateUI(settings.template);
    document.querySelectorAll('#template-buttons [data-template]').forEach((b) => {
      const active = b.dataset.template === settings.template;
      b.classList.toggle('active', active);
      b.setAttribute('aria-checked', String(active));
      b.tabIndex = active ? 0 : -1;
    });
    const isClassic = ui.supportsClassicControls;
    const isColumnflow = settings.template === 'columnflow';
    // 安全距離只有「舞台位置」模板（Pulse/Facet/Aura；Drift 共用同一套排版機制，
    // 但這次只開放這三個的設定 UI）在「左右分散」時才有意義——其他位置模式沒有中央保留區可調。
    // 紙帶逐字／鏡像的排版本身就仰賴這條安全距離（鏡像甚至永遠固定 split），必須一起開放。
    const STAGE_SAFE_MARGIN_UI_TEMPLATES = ['pulse', 'facet', 'aura', 'paperstrip', 'mirror'];
    const isStageSplit = STAGE_SAFE_MARGIN_UI_TEMPLATES.includes(settings.template) && settings.lyricPosition === 'split';

    const templateLabel = document.getElementById('lyric-template-label');
    const templateStatus = document.getElementById('lyric-template-status');
    const workspaceTemplateStatus = document.getElementById('lyrics-workspace-template-status');
    const templateDesc = document.getElementById('template-desc');
    const templateScope = document.getElementById('lyric-template-scope');
    const localizedTemplateLabel = window.I18n?.t(`template.${settings.template}`) || ui.label;
    if (templateLabel) templateLabel.textContent = localizedTemplateLabel;
    const statusText = workspaceText('settings.workspace.currentTemplate', `目前：${localizedTemplateLabel}`, { template: localizedTemplateLabel });
    if (templateStatus) templateStatus.textContent = statusText;
    if (workspaceTemplateStatus) workspaceTemplateStatus.textContent = statusText;
    if (templateDesc) templateDesc.textContent = window.I18n ? window.I18n.translate(ui.description) : ui.description;
    if (templateScope) templateScope.textContent = window.I18n ? window.I18n.translate(ui.scope) : ui.scope;

    const intensityField = document.getElementById('intensity-field');
    if (intensityField) intensityField.hidden = !ui.supportsIntensity;
    document.querySelectorAll('#intensity-buttons .style-thumb').forEach((b) => {
      b.classList.toggle('active', b.dataset.intensity === (settings.animationIntensity || 'normal'));
    });

    // 歌詞位置：經典疊層用九宮格全畫面定位，其他模板用置中/偏左/偏右/左右分散
    const gridWrap = document.getElementById('lyric-pos-grid-wrap');
    const posGrid = document.getElementById('ls-pos-grid');
    const fineWrap = document.getElementById('lyric-pos-fine-wrap');
    const offsetXRow = document.getElementById('ls-offset-x-row');
    const offsetYRow = document.getElementById('ls-offset-y-row');
    const offsetXInput = document.getElementById('ls-offset-x');
    const offsetYInput = document.getElementById('ls-offset-y');
    const quadRow = document.getElementById('lyric-pos-buttons');
    const lyricPosField = document.getElementById('lyric-pos-field');
    const posHint = document.getElementById('lyric-pos-hint');
    const fineHint = document.getElementById('lyric-pos-fine-hint');
    if (gridWrap) gridWrap.hidden = !isClassic;
    if (posGrid) posGrid.hidden = !isClassic;
    if (quadRow) quadRow.hidden = isClassic || ui.positionMode === 'fixed' || isColumnflow;
    const isMirror = settings.template === 'mirror';
    // 位置微調（X/Y）：經典疊層一律可調；舞台模板（Pulse/Facet/Drift/Aura）在「置中/偏左/偏右」
    // 也開放微調，但「左右分散」不適用——那個模式每行交替左右，沒有單一位置可微調，
    // 邊界靠「中央安全距離」控制。KTV 雙行構圖固定、沒有左右可調，只開放 Y；
    // 紙帶逐字／鏡像跟 KTV 一樣是固定構圖（鏡像永遠 split），也只開放 Y——
    // 兩者的 Y 直接由各自 #paperstrip-root／#mirror-root 消費同一個全域變數（見 display.css），
    // 不吃 #lyrics-container 本身的 transform，所以不受「左右分散不給微調」限制。
    // 實際套用時 display.js 會依當下內容自動收緊範圍，使用者調到極端值也不會把歌詞推出畫面；
    // 這裡的滑桿 min/max 只是配合「調得到的範圍」給合理刻度，避免大半段滑桿沒有效果。
    const isKtv = settings.template === 'ktv';
    const isPaperstrip = settings.template === 'paperstrip';
    const isYOnlyOffset = isKtv || isPaperstrip || isMirror;
    const supportsOffsetFineTune = (isClassic || ui.positionMode === 'stage' || isYOnlyOffset)
      && (settings.lyricPosition !== 'split' || isMirror || isPaperstrip);
    if (fineWrap) fineWrap.hidden = !supportsOffsetFineTune;
    if (offsetXRow) offsetXRow.hidden = !supportsOffsetFineTune || isYOnlyOffset;
    if (offsetYRow) offsetYRow.hidden = !supportsOffsetFineTune;
    if (offsetXInput && supportsOffsetFineTune && !isYOnlyOffset) {
      // 舞台模板貼著畫面邊界：往「外」（更靠近該側邊緣）能調的範圍很小，往「內」（回中央）
      // 空間大很多；偏左/偏右方向相反，置中兩邊都寬裕，維持跟經典疊層一樣的大範圍。
      // 潮汐心景版面比其他三款鬆，往外可以多留 20px（見 STAGE_OFFSET_X_OUTWARD_AURA）。
      const outward = settings.template === 'aura' ? STAGE_OFFSET_X_OUTWARD_AURA : STAGE_OFFSET_X_OUTWARD;
      if (!isClassic && settings.lyricPosition === 'left') {
        offsetXInput.min = String(-outward);
        offsetXInput.max = String(STAGE_OFFSET_X_INWARD);
      } else if (!isClassic && settings.lyricPosition === 'right') {
        offsetXInput.min = String(-STAGE_OFFSET_X_INWARD);
        offsetXInput.max = String(outward);
      } else {
        offsetXInput.min = String(-CLASSIC_OFFSET_RANGE);
        offsetXInput.max = String(CLASSIC_OFFSET_RANGE);
      }
      const clampedX = Math.min(Math.max(settings.offsetX || 0, Number(offsetXInput.min)), Number(offsetXInput.max));
      if (clampedX !== settings.offsetX) { settings.offsetX = clampedX; pushSettings(); }
      offsetXInput.value = String(settings.offsetX || 0);
      const offsetXVal = document.getElementById('ls-offset-x-val');
      if (offsetXVal) offsetXVal.textContent = `${settings.offsetX || 0}px`;
    }
    if (offsetYInput && supportsOffsetFineTune) {
      const yRange = isClassic ? CLASSIC_OFFSET_RANGE : STAGE_OFFSET_Y_RANGE;
      offsetYInput.min = String(-yRange);
      offsetYInput.max = String(yRange);
      const clampedY = Math.min(Math.max(settings.offsetY || 0, -yRange), yRange);
      if (clampedY !== settings.offsetY) { settings.offsetY = clampedY; pushSettings(); }
      offsetYInput.value = String(settings.offsetY || 0);
      const offsetYVal = document.getElementById('ls-offset-y-val');
      if (offsetYVal) offsetYVal.textContent = `${settings.offsetY || 0}px`;
    }
    if (lyricPosField) lyricPosField.hidden = isColumnflow || isMirror;
    const columnflowVariantField = document.getElementById('columnflow-variant-field');
    const columnflowPlacementField = document.getElementById('columnflow-placement-field');
    const columnflowMaxLinesField = document.getElementById('columnflow-max-lines-field');
    const columnflowSafeMarginField = document.getElementById('columnflow-safe-margin-field');
    if (columnflowVariantField) columnflowVariantField.hidden = !isColumnflow;
    if (columnflowPlacementField) columnflowPlacementField.hidden = !isColumnflow;
    if (columnflowMaxLinesField) columnflowMaxLinesField.hidden = !isColumnflow;
    if (columnflowSafeMarginField) columnflowSafeMarginField.hidden = !isColumnflow;
    document.querySelectorAll('#columnflow-variant-buttons .style-thumb').forEach((b) => {
      b.classList.toggle('active', b.dataset.columnflowVariant === (settings.columnflowVariant || 'sen'));
    });
    document.querySelectorAll('#columnflow-placement-buttons .style-thumb').forEach((b) => {
      b.classList.toggle('active', b.dataset.columnflowPlacement === (settings.columnflowPlacement || 'split'));
    });
    const maxLines = normalizeColumnflowMaxLines(settings.columnflowMaxLines);
    const maxLinesInput = document.getElementById('ls-columnflow-max-lines');
    const maxLinesValue = document.getElementById('ls-columnflow-max-lines-val');
    if (maxLinesInput) maxLinesInput.value = String(maxLines);
    if (maxLinesValue) maxLinesValue.textContent = `${maxLines} 句`;
    const safeMargin = normalizeColumnflowSafeMargin(settings.columnflowSafeMargin);
    const safeMarginInput = document.getElementById('ls-columnflow-safe-margin');
    const safeMarginValue = document.getElementById('ls-columnflow-safe-margin-val');
    if (safeMarginInput) safeMarginInput.value = String(safeMargin);
    if (safeMarginValue) safeMarginValue.textContent = `${safeMargin}%`;
    const showSafeZoneInput = document.getElementById('ls-columnflow-show-safe-zone');
    if (showSafeZoneInput) showSafeZoneInput.checked = !!settings.columnflowShowSafeZoneOnObs;

    // 舞台模板（Pulse/Facet/Aura）的中央安全距離：只有選了「左右分散」才顯示，
    // 其他位置模式（置中/偏左/偏右）沒有中央保留區的概念。
    const stageSafeMarginField = document.getElementById('stage-safe-margin-field');
    if (stageSafeMarginField) stageSafeMarginField.hidden = !isStageSplit;
    const stageSafeMargin = normalizeStageSafeMargin(settings.stageSafeMargin);
    const stageSafeMarginInput = document.getElementById('ls-stage-safe-margin');
    const stageSafeMarginValue = document.getElementById('ls-stage-safe-margin-val');
    if (stageSafeMarginInput) stageSafeMarginInput.value = String(stageSafeMargin);
    if (stageSafeMarginValue) stageSafeMarginValue.textContent = `${stageSafeMargin}%`;
    const stageShowSafeZoneInput = document.getElementById('ls-stage-show-safe-zone');
    if (stageShowSafeZoneInput) stageShowSafeZoneInput.checked = !!settings.stageShowSafeZoneOnObs;

    if (posHint) {
      posHint.textContent = isClassic
        ? '九宮格是整個歌詞區塊在畫面上的位置；細調 X/Y 可再微調偏移。'
        : (isKtv
          ? 'KTV 伴唱固定雙行構圖，左右不可調；下面可微調整體上下位置。'
          : '方便 VTuber／實況主把人物放在畫面固定位置；「左右分散」是一句左、一句右交替。');
    }
    if (fineHint) {
      fineHint.textContent = '拖曳選格子，或用下面細調微調';
    }
    if (posHint && isColumnflow) {
      posHint.textContent = '直書句流會保留最近幾句，並避開彼此重疊；可用上方直書選項調整構圖。';
    }
    document.querySelectorAll('#lyric-pos-buttons .style-thumb').forEach((b) => {
      b.classList.toggle('active', b.dataset.lyricPos === (settings.lyricPosition || 'center'));
    });
    // 「左右分散」是逐行交替左右——經典疊層（歷史行堆疊）與 KTV（自帶雙行位構圖）不支援
    const splitBtn = document.querySelector('#lyric-pos-buttons .style-thumb[data-lyric-pos="split"]');
    if (splitBtn) splitBtn.disabled = isClassic || ui.positionMode === 'fixed' || isColumnflow;

    // 經典疊層專用設定區塊：整批顯示/隱藏
    CLASSIC_ONLY_FIELD_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = !isClassic;
    });
    document.getElementById('display-advanced-modal')?._settingsWorkspace?.sync();
  }

  function initTemplatePicker() {
    const templateButtons = Array.from(document.querySelectorAll('#template-buttons [data-template]'))
      .filter((button) => !button.hidden);
    const selectTemplate = (nextTemplate) => {
      if (!TEMPLATE_IDS.includes(nextTemplate) || nextTemplate === settings.template) return;
      saveCurrentTemplateSnapshot();
      const nextSettings = templateSettings[nextTemplate] || templateDefaults(nextTemplate);
      settings = { ...templateDefaults(nextTemplate), ...cleanSettingSnapshot(nextSettings), template: nextTemplate };
      if ((settings.template === 'classic' || settings.template === 'ktv') && settings.lyricPosition === 'split') settings.lyricPosition = 'center';
      if (settings.template === 'mirror') settings.lyricPosition = 'split';
      if (settings.template === 'columnflow') {
        if (!COLUMNFLOW_VARIANTS.includes(settings.columnflowVariant)) settings.columnflowVariant = 'sen';
        if (!COLUMNFLOW_PLACEMENTS.includes(settings.columnflowPlacement)) settings.columnflowPlacement = 'split';
        settings.columnflowMaxLines = normalizeColumnflowMaxLines(settings.columnflowMaxLines);
        settings.columnflowSafeMargin = normalizeColumnflowSafeMargin(settings.columnflowSafeMargin);
        settings.columnflowShowSafeZoneOnObs = !!settings.columnflowShowSafeZoneOnObs;
      }
      if (STAGE_POSITION_TEMPLATES.includes(settings.template)) {
        settings.stageSafeMargin = normalizeStageSafeMargin(settings.stageSafeMargin);
        settings.stageShowSafeZoneOnObs = !!settings.stageShowSafeZoneOnObs;
      }
      refreshControls();
      pushSettings();
    };
    templateButtons.forEach((btn, index) => {
      btn.addEventListener('click', () => selectTemplate(btn.dataset.template));
      btn.addEventListener('keydown', (event) => {
        let nextIndex = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % templateButtons.length;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + templateButtons.length) % templateButtons.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = templateButtons.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        const next = templateButtons[nextIndex];
        selectTemplate(next.dataset.template);
        next.focus();
      });
    });
    document.querySelectorAll('#intensity-buttons .style-thumb').forEach((btn) => {
      btn.addEventListener('click', () => {
        settings.animationIntensity = btn.dataset.intensity;
        syncTemplateButtons();
        pushSettings();
      });
    });
    document.querySelectorAll('#columnflow-variant-buttons .style-thumb').forEach((btn) => {
      btn.addEventListener('click', () => {
        const variant = btn.dataset.columnflowVariant;
        if (settings.template !== 'columnflow' || !COLUMNFLOW_VARIANTS.includes(variant)) return;
        settings.columnflowVariant = variant;
        syncTemplateButtons();
        pushSettings();
      });
    });
    document.querySelectorAll('#columnflow-placement-buttons .style-thumb').forEach((btn) => {
      btn.addEventListener('click', () => {
        const placement = btn.dataset.columnflowPlacement;
        if (settings.template !== 'columnflow' || !COLUMNFLOW_PLACEMENTS.includes(placement)) return;
        settings.columnflowPlacement = placement;
        syncTemplateButtons();
        pushSettings();
      });
    });
    const maxLinesInput = document.getElementById('ls-columnflow-max-lines');
    if (maxLinesInput) {
      maxLinesInput.addEventListener('input', () => {
        if (settings.template !== 'columnflow') return;
        settings.columnflowMaxLines = normalizeColumnflowMaxLines(maxLinesInput.value);
        syncTemplateButtons();
        pushSettings();
      });
    }
    const safeMarginInput = document.getElementById('ls-columnflow-safe-margin');
    if (safeMarginInput) {
      safeMarginInput.addEventListener('input', () => {
        if (settings.template !== 'columnflow') return;
        settings.columnflowSafeMargin = normalizeColumnflowSafeMargin(safeMarginInput.value);
        syncTemplateButtons();
        pushSettings();
      });
    }
    const showSafeZoneInput = document.getElementById('ls-columnflow-show-safe-zone');
    if (showSafeZoneInput) {
      showSafeZoneInput.addEventListener('change', () => {
        if (settings.template !== 'columnflow') return;
        settings.columnflowShowSafeZoneOnObs = !!showSafeZoneInput.checked;
        pushSettings();
      });
    }
    const stageSafeMarginInput = document.getElementById('ls-stage-safe-margin');
    if (stageSafeMarginInput) {
      stageSafeMarginInput.addEventListener('input', () => {
        if (!STAGE_POSITION_TEMPLATES.includes(settings.template)) return;
        settings.stageSafeMargin = normalizeStageSafeMargin(stageSafeMarginInput.value);
        pushSettings();
      });
    }
    const stageShowSafeZoneInput = document.getElementById('ls-stage-show-safe-zone');
    if (stageShowSafeZoneInput) {
      stageShowSafeZoneInput.addEventListener('change', () => {
        if (!STAGE_POSITION_TEMPLATES.includes(settings.template)) return;
        settings.stageShowSafeZoneOnObs = !!stageShowSafeZoneInput.checked;
        pushSettings();
      });
    }
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
      ? lyricPresets.map((p) => '<option data-i18n-skip value="' + escapeHtml(p.id) + '">' + escapeHtml(p.name) + '</option>').join('')
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
        error.classList.toggle('is-visible', !!msg);
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
        if (existing) {
          const confirmed = await window.PanelConfirm?.request({
            title: '覆蓋同名歌詞預設？',
            summary: `「${name}」已存在。`,
            impact: '原本的這組歌詞外觀設定會被目前設定取代。',
            confirmLabel: '覆蓋預設',
          });
          if (!confirmed) return;
        }
        const item = { id: existing ? existing.id : String(Date.now()), name, settings: cleanSettingSnapshot(settings) };
        if (existing) existing.settings = item.settings;
        else lyricPresets.push(item);
        saveSettings();
        const payload = buildSettingsPayload();
        confirmSettingsSaved(payload);
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
        settings = { ...templateDefaults(item.settings.template), ...cleanSettingSnapshot(item.settings) };
        if (!TEMPLATE_IDS.includes(settings.template)) settings.template = 'classic';
        if ((settings.template === 'classic' || settings.template === 'ktv') && settings.lyricPosition === 'split') settings.lyricPosition = 'center';
        if (settings.template === 'columnflow') {
          if (!COLUMNFLOW_VARIANTS.includes(settings.columnflowVariant)) settings.columnflowVariant = 'sen';
          if (!COLUMNFLOW_PLACEMENTS.includes(settings.columnflowPlacement)) settings.columnflowPlacement = 'split';
          settings.columnflowMaxLines = normalizeColumnflowMaxLines(settings.columnflowMaxLines);
        }
        refreshControls();
        pushSettings();
        showToast('已套用歌詞外觀預設');
      });
    }
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        const item = lyricPresets.find((p) => p.id === (sel && sel.value));
        if (!item) return;
        const confirmed = await window.PanelConfirm?.request({
          title: `刪除預設「${item.name}」？`,
          summary: '這組已儲存的歌詞外觀預設會被刪除。',
          impact: '目前套用中的歌詞外觀不會改變，但這組預設無法復原。',
          tone: 'danger',
          confirmLabel: '刪除預設',
        });
        if (!confirmed) return;
        lyricPresets = lyricPresets.filter((p) => p.id !== item.id);
        saveSettings();
        const payload = buildSettingsPayload();
        confirmSettingsSaved(payload);
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
        settings = templateDefaults(tpl);
        templateSettings[tpl] = { ...settings };
        saveSettings();
        refreshControls();
        previewToIframe(settings);
        const payload = buildSettingsPayload();
        confirmSettingsSaved(payload);
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
  const pickerSearchCache = new Map();

  function pickerSearchKey(track, artist, title) {
    return `${track?.id || ''}\u0000${artist.trim()}\u0000${title.trim()}`;
  }

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

    const cacheKey = pickerSearchKey(track, artistEl?.value || '', titleEl?.value || '');
    const cached = pickerSearchCache.get(cacheKey);
    if (cached) {
      const body = document.getElementById('lyrics-picker-body');
      if (body) renderCandidates(body, cached.candidates, cached.providerHealth);
    } else {
      runPickerSearch();
    }
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
    const cacheKey = pickerSearchKey(pickerCurrentTrack, payload.artist, payload.title);
    const cached = pickerSearchCache.get(cacheKey);
    if (cached) {
      renderCandidates(body, cached.candidates, cached.providerHealth);
      return;
    }

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
        pickerSearchCache.set(cacheKey, { candidates: data.candidates, providerHealth: data.providerHealth });
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
    window.addEventListener('i18n:change', syncTemplateButtons);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
