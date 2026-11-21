(function (root) {
  'use strict';

  // 預設值（與 display.css 的 :root 對齊）
  const DEFAULT_SETTINGS = {
    fontSize: 56,
    fontFamily: "'Noto Sans SC', 'Noto Sans JP', 'Noto Sans KR', sans-serif",
    fontFamilyLatin: '', // 英文（拉丁字母/數字）專用字體；空＝跟主字體。display 端會組成「英文字體, 主字體」
    // 由 /api/fonts 回傳的 opaque ID；只有輸出端成功以 FontFace 載入字型檔才會使用。
    fontAssetId: '',
    fontFamilyLatinAssetId: '',
    fontWeight: 900,
    color: '#8f8f8f',
    activeColor: '#febc6c',
    // 打字機模板：左右對話泡泡底色（其他模板忽略）
    twBubbleRight: '#0b93f6',
    twBubbleLeft: '#3b3b3d',
    twStickerEnabled: true,   // 對話氣泡：長間奏跳貼圖（清單管理在面板，不進 state）
    twStickerGapMs: 6000,     // 多長的空檔算「長間奏」
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
    // 注意：convertTraditional／showProgressBar 不放在這裡——它們是「歌詞顯示模式」的通用設定，
    // 不屬於任何一個模板的外觀，見下方 globalDisplaySettings（切模板不可連動跑掉，2026-09-18 回報）。
    // ── 燈牌：只吃兩款真點陣字型；三段捲動各自獨立 ──
    lightboardFont: 'cubic11',       // 'cubic11'（11×11）｜'boutique9x9'（9×9）；兩款都隨程式打包（SIL OFL）
    lightboardPan: true,             // 長句平移：功能不是裝飾，關掉會讓整首歌遷就最長句而縮小字級
    lightboardIdleMarquee: true,     // 間奏跑馬：只在沒人唱時跑，零成本
    lightboardIdleGapMs: 2500,       // 間奏跑馬門檻：間奏要長過這個秒數才開始跑（1.5–20s）
    lightboardSlideIn: false,        // 進場滑入：每句都動會累積成吵，預設關
    spellbookEffect: 'rune',         // 萬聖咒字逐字效果：rune｜ouija｜bats｜drip｜talisman｜moon｜thread｜cycle
    spellbookPosition: 'bottom',     // 萬聖咒字上下位置：'bottom'｜'middle'｜'top'
    // ── 紙帶逐字：排向（橫式白條／直式黑條）＋紙條顏色 ──
    paperstripOrient: 'horizontal',
    paperstripColor: '#ffffff',
    // ── KTV：長間奏／全曲結尾的畫面字樣；留空＝依顯示語言帶預設（繁中維持模板內三則輪播）──
    ktvInterludeText: '',
    ktvEndingText: '',
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
    template: 'classic',  // 'classic' | 'pulse' | 'facet' | 'drift' | 'aura' | 'ktv' | 'columnflow' | 'paperstrip' | 'mirror' | 'particle'
    animationIntensity: 'normal', // folia 系模板的散射強度：'calm' | 'normal' | 'chaotic'
    lyricPosition: 'center', // 歌詞水平位置：'center' | 'left' | 'right' | 'split'（左右分散＝逐行交替）
    columnflowVariant: 'sen', // 直書句流外觀：'sen' 素筆 | 'fuda' 字札
    columnflowEntrance: 'native', // 直書句流逐字進場：'native' 原樣 | 'drift' 四相漂字（吃動畫強度）；可疊在任一外觀上
    columnflowPlacement: 'split', // 直書句流：'left' | 'right' | 'split'
    jizuraPlacement: 'sides',     // 文字PV 獨立歌詞位置：'left' 偏左 | 'right' 偏右 | 'sides' 兩側（保留中央）| 'full' 原構圖置中；畫布一律全畫面
    jizuraMotion: 'smooth',       // 文字PV：'smooth' 每幀更新 | 'koma' 2 コマ打ち（每秒 12 張的作畫感）
    jizuraParts: 'base',          // 文字PV：'base' 標準部件 | 'extended' 擴充部件（JIZURA 追加分2 等新部件，稽核過的才會用）
    jizuraHeavy: false,           // 文字PV 自選：加入高耗能部件（稽核耗時超標，可能掉幀）
    jizuraLarge: false,           // 文字PV 自選：加入大面積部件（稽核覆蓋率超標，可能遮到角色）
    jizuraHorror: false,          // 文字PV 自選：加入恐怖風部件（不含全畫面特效、背景、轉場、恐怖配色）
    columnflowMaxLines: 4, // 直書句流：同時保留 1–6 句
    columnflowSafeMargin: 11, // 直書句流：中央安全距離（%，5–25），兩側直行不會跨入
    columnflowShowSafeZoneOnObs: false, // 直書句流：安全距離引導線是否也疊在真正的 OBS 來源上（預設只有面板預覽看得到）
    stageSafeMargin: 2, // Pulse/Facet/Drift/Aura/紙帶逐字/鏡像：左右分散時的中央安全距離（%，2–25），預設對應原本寫死的 48/52%
    stageShowSafeZoneOnObs: false, // 同上：安全距離引導線是否也疊在真正的 OBS 來源上
    particleOrient: 'vertical', // 風息成字：'vertical' 直書（1–2 直欄，預設）| 'horizontal' 橫排
    particleEntrance: 'auto', // 風息成字：'auto' 風/雨/渦流/雙束四種逐句輪替（預設）| 'quaddrift' 全部改用四相漂字進場（退場仍是粒子散開）
    // ── 自訂背景（Phase 4）：鍵名加 display 前綴避免與上面歌詞文字背景框(bgColor/bgOpacity)撞名 ──
    displayBgImage: '',   // 檔名（'' = 無背景，維持透明）
    displayBgOpacity: 1,
    displayBgFit: 'cover', // 'cover' | 'contain' | 'fill'
  };

  // 每個模板都有自己的預設外觀與獨立的設定快照。
  const TEMPLATE_DEFAULTS = {
    classic: { template: 'classic', fontSize: DEFAULT_SETTINGS.fontSize, color: DEFAULT_SETTINGS.color, activeColor: DEFAULT_SETTINGS.activeColor, verticalPosition: DEFAULT_SETTINGS.verticalPosition },
    pulse: { template: 'pulse', fontSize: 50, color: '#ddfe9f', activeColor: '#38ff45', verticalPosition: 'center' },
    facet: { template: 'facet', fontSize: 45, color: '#9181bb', activeColor: '#5d0a94', verticalPosition: 'center' },
    drift: { template: 'drift', fontSize: 45, color: '#c0ff38', activeColor: '#ffc800', verticalPosition: 'center', animationIntensity: 'calm' },
    aura: { template: 'aura', fontSize: 72, color: '#ffffff', activeColor: '#14a5ff', verticalPosition: 'center' },
    ktv: { template: 'ktv', fontSize: 40, color: '#ffffff', activeColor: '#0400ff', verticalPosition: 'center', ktvInterludeText: '', ktvEndingText: '' },
    columnflow: { template: 'columnflow', fontFamily: "'Noto Serif TC', 'PMingLiU', serif", fontWeight: 600, fontSize: 48, color: '#f4efe5', activeColor: '#f0c978', shadow: '0 1px 7px rgba(0,0,0,.72)', verticalPosition: 'center', columnflowVariant: 'sen', columnflowEntrance: 'native', columnflowPlacement: 'split', columnflowMaxLines: 4, columnflowSafeMargin: 11, columnflowShowSafeZoneOnObs: false, animationIntensity: 'normal' },
    paperstrip: { template: 'paperstrip', fontWeight: 600, fontSize: 56, color: '#111111', activeColor: '#111111', shadow: 'none', verticalPosition: 'center', lyricPosition: 'center', letterSpacing: 1, paperstripOrient: 'horizontal', paperstripColor: '#ffffff' },
    mirror: { template: 'mirror', fontWeight: 900, fontSize: 60, color: '#ffffff', activeColor: '#ffffff', shadow: 'none', verticalPosition: 'center', lyricPosition: 'split', stageSafeMargin: 13, letterSpacing: 1, animationIntensity: 'normal' },
    lightboard: { template: 'lightboard', fontSize: 44, fontWeight: 400, color: 'rgba(255,176,60,0.5)', activeColor: '#ffce8a', shadow: 'none', verticalPosition: 'center', lyricPosition: 'center', lightboardFont: 'cubic11', lightboardPan: true, lightboardIdleMarquee: true, lightboardIdleGapMs: 2500, lightboardSlideIn: false },
    typewriter: { template: 'typewriter', fontWeight: 700, fontSize: 36, color: '#f4f7fa', activeColor: '#a9cfe5', shadow: 'none', verticalPosition: 'center', lyricPosition: 'split', paddingX: 96, twBubbleRight: '#0b93f6', twBubbleLeft: '#3b3b3d', twStickerEnabled: true, twStickerGapMs: 6000 },
    // 文字 PV 目前由引擎選字體與字級。
    jizura: { template: 'jizura', verticalPosition: 'center', color: '#ffffff', activeColor: '#ffd166', animationIntensity: 'normal', jizuraPlacement: 'sides', jizuraMotion: 'smooth', jizuraParts: 'base', jizuraHeavy: false, jizuraLarge: false, jizuraHorror: false },
    particle: { template: 'particle', fontFamily: '', fontWeight: 400, fontSize: 64, color: '#f6f0e5', activeColor: '#e97855', verticalPosition: 'center', lyricPosition: 'center', paddingX: 96, paddingY: 90, stageSafeMargin: 13, particleOrient: 'vertical', particleEntrance: 'auto', animationIntensity: 'normal' },
    spellbook: { template: 'spellbook', fontSize: 60, fontWeight: 900, color: '#f4ead6', activeColor: '#ff9a3c', shadow: 'none', verticalPosition: 'center', lyricPosition: 'center', letterSpacing: 2, animationIntensity: 'normal', spellbookEffect: 'rune', spellbookPosition: 'bottom' },
  };
  const TEMPLATE_IDS = Object.freeze(Object.keys(TEMPLATE_DEFAULTS));
  // 固定輸入上限，與畫面尺寸無關。
  const MAX_OFFSET = 4096;
  function templateOverrides(id) {
    return { ...TEMPLATE_DEFAULTS[TEMPLATE_IDS.includes(id) ? id : 'classic'] };
  }
  function templateDefaults(id) {
    return { ...DEFAULT_SETTINGS, ...templateOverrides(id) };
  }
  function normalizeOffset(value) {
    return Number.isFinite(value) ? Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, value)) : undefined;
  }
  function normalizeAnchor(settings, template) {
    if (TEMPLATE_IDS.includes(template) && template !== 'classic') {
      settings.verticalPosition = TEMPLATE_DEFAULTS[template].verticalPosition;
    }
    return settings;
  }

  function sanitizeLyricPosition(settings, template) {
    for (const key of ['offsetX', 'offsetY']) {
      if (settings[key] === undefined) continue;
      const value = normalizeOffset(settings[key]);
      if (value === undefined) delete settings[key];
      else settings[key] = value;
    }
    if (settings.verticalPosition !== undefined) normalizeAnchor(settings, template);
    return settings;
  }

  const api = { DEFAULT_SETTINGS: Object.freeze(DEFAULT_SETTINGS), TEMPLATE_IDS, MAX_OFFSET, templateDefaults, templateOverrides, normalizeOffset, normalizeAnchor, sanitizeLyricPosition };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LyricTemplateDefaults = api;
})(typeof window === 'undefined' ? globalThis : window);
