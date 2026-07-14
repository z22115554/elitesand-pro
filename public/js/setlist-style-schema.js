/**
 * 歌單外觀設定（setlistStyle）— 單一事實來源 schema
 *
 * 目的：這份設定過去分散在 4 個地方，每加一個欄位都要記得同步全部：
 *   1. server/routes/socket-handler.js — 預設值 + 驗證邊界（numBounds/strKeys/enumKeys）
 *   2. public/js/app.js               — DOM id 對應 + 數值/格式化（F/NUM/VF）+ DEFAULT_STYLE
 *   3. public/js/setlist.js           — CSS 變數套用（applyStyle）
 *   4. public/index.html              — 實際的滑桿/選單/色票控制項
 * 漏接任何一處都會產生「設定改了沒反應」類的 bug（例如 2026-06-30 的 cnSpread/timeFormat
 * 即時預覽問題，根因就是欄位資訊分散導致某一環忘記處理）。
 *
 * 這份 schema 把「型別 / 預設值 / 合法範圍 / DOM 對應 / CSS 變數套用規則」集中定義，
 * server 用它產生預設值物件與驗證器，client 用它產生 collect/adopt 的通用迴圈與
 * applyStyle 的通用 CSS 套用。第 4 項（HTML 控制項本體）仍需手動加，這是純 UI 呈現，
 * 無法從資料定義自動產生，但只要照現有欄位的 domId 命名規則加一個 <input>/<select> 即可。
 *
 * 【下次要加新欄位時】：
 *   1. 在 SETLIST_STYLE_FIELDS 加一筆定義（決定 type/default/bounds/domId/apply）。
 *   2. 在 index.html 加對應的控制項（id 要跟 schema 的 domId 一致）。
 *   3. 若欄位需要「多欄位合成一個 CSS 變數」（如 accent 衍生出 4 個變數）或「特殊 UI
 *      控件（如一個下拉對應兩個布林欄位）」，才需要另外在 app.js / setlist.js 補一段
 *      特例程式碼——大多數新欄位（純數值滑桿/單一顏色/單一選單）完全不需要碰這兩個檔案。
 *
 * 這個檔案同時給 Node（server require）與瀏覽器（<script> 標籤）使用，故用 UMD 包裝。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SetlistStyleSchema = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── 格式化器：CSS 輸出轉換 + 面板上的數值標籤顯示 ──
  // toCss(v): 寫進 CSS 變數的字串；toLabel(v): 滑桿旁邊 <span class="val"> 顯示的文字
  const FORMATS = {
    px: { toCss: (v) => `${v}px`, toLabel: (v) => `${v}px` },
    percent: { toCss: (v) => `${v}%`, toLabel: (v) => `${v}%` },
    // 面板是 0~100 的百分比滑桿，但 CSS 變數要吃 0~1 的小數（用在 opacity 類變數）
    opacityFraction: { toCss: (v) => String(v / 100), toLabel: (v) => `${v}%` },
    // 面板是小數倍率（0.5~2），CSS 直接吃原始數字，標籤顯示成百分比較好懂
    multiplierPercent: { toCss: (v) => String(v), toLabel: (v) => `${Math.round(v * 100)}%` },
    // 面板是小數（如行高 1.4），CSS 與標籤都用原始數字（標籤固定 2 位小數）
    rawDecimal: { toCss: (v) => String(v), toLabel: (v) => Number(v).toFixed(2) },
    degree: { toCss: (v) => `${v}deg`, toLabel: (v) => `${v}°` },
    // diagonal 斜度：面板是「傾角」正值，CSS rotate 要反向（沿用既有視覺方向）
    degreeNeg: { toCss: (v) => `${-v}deg`, toLabel: (v) => `${v}°` },
    // 陰影/發光/描邊強度：0 時顯示「關」，CSS 由呼叫端(composite)自行處理，這裡僅供標籤用
    offPx: { toCss: (v) => `${v}px`, toLabel: (v) => (Number(v) ? `${v}px` : '關') },
    raw: { toCss: (v) => String(v), toLabel: (v) => String(v) },
  };

  // ── 欄位定義 ──
  // type: 'color' | 'number' | 'percent' | 'string' | 'boolean' | 'enum'
  // domId: 對應 HTML 控制項 id；null = 沒有直接的單一控制項（由 app.js 特例處理，
  //        例如 classicShowUpcoming/Done 是由同一個三態下拉衍生的兩個欄位）
  // cssVar: 若設定，applyStyle 會通用套用（配合 format 轉換單位）；composite 欄位
  //        （多欄位合成一個變數，如 accent 衍生 4 個變數）不設 cssVar，由 setlist.js
  //        另外寫的 composite 區塊處理，schema 只提供預設值/驗證。
  const SETLIST_STYLE_FIELDS = [
    // ── 舊欄位（classic 效果，向後相容）──
    { key: 'scale', type: 'number', default: 1.0, min: 0.6, max: 1.8, domId: 'sls-scale', format: 'multiplierPercent', cssVar: '--sl-scale' },
    { key: 'bgColor', type: 'color', default: '#000000', domId: 'sls-bg-color', composite: 'bgScrim' },
    { key: 'bgOpacity', type: 'number', default: 0, min: 0, max: 100, domId: 'sls-bg-opacity', format: 'percent', composite: 'bgScrim' },
    { key: 'textColor', type: 'color', default: '', domId: null, composite: 'textColorOverride', special: 'textColor' },
    { key: 'shadowStrength', type: 'number', default: 0, min: 0, max: 40, domId: 'sls-shadow', format: 'offPx', composite: 'userTextShadow' },
    { key: 'shadowColor', type: 'color', default: '#000000', domId: 'sls-shadow-color', composite: 'userTextShadow' },
    { key: 'glowStrength', type: 'number', default: 0, min: 0, max: 40, domId: 'sls-glow-strength', format: 'offPx', composite: 'userTextShadow' },
    { key: 'glowColor', type: 'color', default: '#ffd6a5', domId: 'sls-glow-color', composite: 'userTextShadow' },
    { key: 'strokeWidth', type: 'number', default: 0, min: 0, max: 8, domId: 'sls-stroke', format: 'offPx', composite: 'stroke' },
    { key: 'strokeColor', type: 'color', default: '#000000', domId: 'sls-stroke-color', composite: 'stroke' },

    // ── 色彩 ──
    { key: 'accent', type: 'color', default: '#d9a25c', domId: 'sls-accent', composite: 'accent' },
    { key: 'accentBright', type: 'color', default: '#f0c587', domId: 'sls-accent-b', cssVar: '--sl-acc-b' },
    { key: 'textPrimary', type: 'color', default: '#f0ead8', domId: 'sls-text-primary', composite: 'textShades' },
    { key: 'textSec', type: 'number', default: 45, min: 0, max: 100, domId: 'sls-text-sec', format: 'percent', composite: 'textShades' },
    { key: 'textDone', type: 'number', default: 22, min: 0, max: 100, domId: 'sls-text-done', format: 'percent', composite: 'textShades' },
    { key: 'textMeta', type: 'number', default: 35, min: 0, max: 100, domId: 'sls-text-meta', format: 'percent', composite: 'textShades' },
    { key: 'cardColor', type: 'color', default: '#0b0907', domId: 'sls-card-color', composite: 'cardBg' },
    { key: 'cardOpacity', type: 'number', default: 93, min: 0, max: 100, domId: 'sls-card-opacity', format: 'percent', composite: 'cardBg' },
    { key: 'borderColor', type: 'color', default: '#f0ead8', domId: 'sls-border-color', composite: 'borderColor' },
    { key: 'borderOpacity', type: 'number', default: 9, min: 0, max: 100, domId: 'sls-border-opacity', format: 'percent', composite: 'borderColor' },
    { key: 'borderWidth', type: 'number', default: 1, min: 0, max: 5, domId: 'sls-border-width', format: 'px', cssVar: '--sl-bw' },

    // ── 字體 ──
    { key: 'fontDisplay', type: 'string', default: 'Fraunces', domId: 'sls-font-display', cssVar: '--sl-fd', cssTransform: (v) => `'${v}', 'Noto Serif TC', Georgia, serif` },
    { key: 'fontBody', type: 'string', default: 'Manrope', domId: 'sls-font-body', cssVar: '--sl-fb', cssTransform: (v) => `'${v}', 'Noto Sans TC', sans-serif` },
    { key: 'fontMono', type: 'string', default: 'JetBrains Mono', domId: 'sls-font-mono', cssVar: '--sl-fm', cssTransform: (v) => `'${v}', ui-monospace, monospace` },

    // ── 字級 / 字重 ──
    { key: 'sizeNow', type: 'number', default: 16, min: 10, max: 60, domId: 'sls-size-now', format: 'px', cssVar: '--sl-sz-n' },
    { key: 'sizeList', type: 'number', default: 13, min: 8, max: 24, domId: 'sls-size-list', format: 'px', cssVar: '--sl-sz-l' },
    { key: 'sizeArtist', type: 'number', default: 11, min: 7, max: 18, domId: 'sls-size-artist', format: 'px', cssVar: '--sl-sz-a' },
    { key: 'sizeMeta', type: 'number', default: 10, min: 7, max: 14, domId: 'sls-size-meta', format: 'px', cssVar: '--sl-sz-m' },
    { key: 'fwActive', type: 'string', default: '700', domId: 'sls-fw-active', cssVar: '--sl-fw-n' },
    { key: 'fwList', type: 'string', default: '400', domId: 'sls-fw-list', cssVar: '--sl-fw-l' },

    // ── 外觀幾何 ──
    { key: 'cardWidth', type: 'number', default: 340, min: 160, max: 600, domId: 'sls-card-width', format: 'px', cssVar: '--sl-w' },
    { key: 'borderRadius', type: 'number', default: 12, min: 0, max: 32, domId: 'sls-radius', format: 'px', cssVar: '--sl-r-new' },
    { key: 'paddingV', type: 'number', default: 10, min: 0, max: 28, domId: 'sls-padding-v', format: 'px', cssVar: '--sl-pv' },
    { key: 'paddingH', type: 'number', default: 14, min: 0, max: 40, domId: 'sls-padding-h', format: 'px', cssVar: '--sl-ph' },
    { key: 'itemGap', type: 'number', default: 2, min: 0, max: 20, domId: 'sls-item-gap', format: 'px', cssVar: '--sl-gap-new' },
    { key: 'blurAmount', type: 'number', default: 12, min: 0, max: 48, domId: 'sls-blur', format: 'px', cssVar: '--sl-blur-new' },
    // glowSize：預留擴充欄位，目前尚無 UI 控制項（domId 留空），已可由 server 驗證與 applyStyle 套用
    { key: 'glowSize', type: 'number', default: 0, min: 0, max: 24, domId: null, format: 'px', cssVar: '--sl-glow' },

    // 外框陰影（用強調色，開關 + 兩個數值）
    { key: 'shadowEnabled', type: 'boolean', default: false, domId: 'sls-shadow-enabled', composite: 'boxShadow' },
    { key: 'shadowBlur', type: 'number', default: 20, min: 0, max: 60, domId: 'sls-shadow-blur', format: 'px', composite: 'boxShadow' },
    { key: 'shadowOpacity', type: 'number', default: 0, min: 0, max: 100, domId: 'sls-shadow-opacity', format: 'percent', composite: 'boxShadow' },

    // ── 透明度 ──
    // needsRerender：場景版（timeline/diagonal/constellation）的淡化在 JS render 內計算
    // （以預設值為基準的相對係數，見 setlist.js sceneFadeFactors），改動需重繪；
    // 經典/清單版仍走 cssVar 即時生效。
    { key: 'doneOpacity', type: 'number', default: 35, min: 0, max: 100, domId: 'sls-done-opacity', format: 'percent', cssVar: '--sl-op-d', cssFormat: 'opacityFraction', needsRerender: true },
    { key: 'waitOpacity', type: 'number', default: 55, min: 0, max: 100, domId: 'sls-wait-opacity', format: 'percent', cssVar: '--sl-op-w', cssFormat: 'opacityFraction', needsRerender: true },

    // ── 顯示開關（布林 → data-attr，invert：欄位 true 時「不加」data-attr）──
    { key: 'showArtist', type: 'boolean', default: true, domId: 'sls-show-artist', dataAttr: 'data-hide-artist', invert: true },
    { key: 'showNumber', type: 'boolean', default: true, domId: 'sls-show-number', dataAttr: 'data-hide-num', invert: true },
    { key: 'strikethrough', type: 'boolean', default: false, domId: 'sls-strikethrough', dataAttr: 'data-strike', invert: false },
    { key: 'showReserve', type: 'boolean', default: true, domId: 'sls-show-reserve' }, // 目前僅 server 保存，畫面尚未接顯示邏輯（預留）

    // ── 文字標籤（非 CSS 變數，套到 JS 標籤物件 + DOM textContent）──
    { key: 'labelNowPlaying', type: 'string', default: '▶ Now Playing', domId: 'sls-label-now', composite: 'label' },
    { key: 'labelReserve', type: 'string', default: 'Reserve', domId: 'sls-label-reserve', composite: 'label' },
    { key: 'labelDone', type: 'string', default: '已唱', domId: 'sls-label-done', composite: 'label' },
    { key: 'labelWait', type: 'string', default: '未唱', domId: 'sls-label-wait', composite: 'label' },

    // ── 場景版專屬：內容位置/縮放（避開角色站位）──
    { key: 'sceneOffsetX', type: 'number', default: 0, min: -50, max: 50, domId: 'sls-scene-x', format: 'percent', cssVar: '--sl-stage-x' },
    { key: 'sceneOffsetY', type: 'number', default: 0, min: -50, max: 50, domId: 'sls-scene-y', format: 'percent', cssVar: '--sl-stage-y' },
    { key: 'sceneScale', type: 'number', default: 1, min: 0.5, max: 2, domId: 'sls-scene-scale', format: 'multiplierPercent', cssVar: '--sl-scene-scale' },

    // ── 經典版型專屬：左未唱/右已唱 是否顯示（可只留一側）──
    // 對「套用」而言是兩個獨立布林（各自一個 data-attr，invert）；但面板 UI 是單一三態下拉
    // （sls-classic-sections），故 domId 留空、collect/adopt 由 app.js 特例處理（special: 'classicSections'）。
    { key: 'classicShowUpcoming', type: 'boolean', default: true, domId: null, dataAttr: 'data-cl-hide-up', invert: true, special: 'classicSections' },
    { key: 'classicShowDone', type: 'boolean', default: true, domId: null, dataAttr: 'data-cl-hide-done', invert: true, special: 'classicSections' },

    // ── 場景版各自版面（timeline 軸線/歌名、diagonal 斜度、constellation 間距）──
    { key: 'tlAxisPos', type: 'number', default: 38, min: 20, max: 70, domId: 'sls-tl-axis', format: 'percent', cssVar: '--tl-axis-top' },
    { key: 'tlNameGap', type: 'number', default: 22, min: 6, max: 60, domId: 'sls-tl-name-gap', format: 'px', cssVar: '--tl-name-gap' },
    { key: 'tlNamePos', type: 'enum', default: 'below', values: ['below', 'on', 'above'], domId: 'sls-tl-name-pos', dataAttr: 'data-tl-name' },
    { key: 'dgAngle', type: 'number', default: 32, min: 0, max: 60, domId: 'sls-dg-angle', format: 'degree', cssVar: '--dg-angle', cssFormat: 'degreeNeg' },
    // cnSpread 沒有 CSS 變數（在 constellation.render() 當下讀取來算星位），改動需觸發重繪
    { key: 'cnSpread', type: 'number', default: 1, min: 0.6, max: 1.5, domId: 'sls-cn-spread', format: 'multiplierPercent', needsRerender: true },

    // ── Timeline 專屬（軸線外觀 / 節點 / 歌名字級 / 間距 / Now 區位置）──
    { key: 'tlAxisWidth', type: 'number', default: 1, min: 1, max: 6, domId: 'sls-tl-axis-width', format: 'px', cssVar: '--tl-axis-h' },
    { key: 'tlAxisColor', type: 'color', default: '#d9a25c', domId: 'sls-tl-axis-color', composite: 'tlAxis' },
    { key: 'tlDotColor', type: 'color', default: '#d9a25c', domId: 'sls-tl-dot-color', composite: 'tlDot' },
    { key: 'tlDotSize', type: 'number', default: 14, min: 8, max: 28, domId: 'sls-tl-dot-size', format: 'px', cssVar: '--tl-dot-size' },
    { key: 'tlNameSize', type: 'number', default: 11, min: 8, max: 80, domId: 'sls-tl-name-size', format: 'px', cssVar: '--tl-name-size' },
    // 項目間距在 timeline.render() 算絕對定位時讀取，沒有 CSS 變數，改動需重繪
    { key: 'tlItemGap', type: 'number', default: 128, min: 70, max: 260, domId: 'sls-tl-item-gap', format: 'px', needsRerender: true },
    { key: 'tlNowPos', type: 'number', default: 52, min: 30, max: 85, domId: 'sls-tl-now-pos', format: 'percent', cssVar: '--tl-now-top' },

    // ── Diagonal 專屬（分隔線外觀 / 位置）──
    { key: 'dgLineWidth', type: 'number', default: 1, min: 1, max: 6, domId: 'sls-dg-line-width', format: 'px', cssVar: '--dg-line-w' },
    { key: 'dgLineColor', type: 'color', default: '#f0ead8', domId: 'sls-dg-line-color', composite: 'dgLine' },
    { key: 'dgLinePos', type: 'number', default: 33, min: 15, max: 70, domId: 'sls-dg-line-pos', format: 'percent', cssVar: '--dg-line-x' },
    // 「正在播放」與未唱歌曲清單的垂直距離：未唱清單第一項的起始位置（%），後面兩項固定往下遞增 9%。
    { key: 'dgWaitTop', type: 'number', default: 68, min: 40, max: 90, domId: 'sls-dg-wait-top', format: 'percent', needsRerender: true },

    // ── Constellation 專屬（節點顏色 / 星塵開關）──
    { key: 'cnDotColor', type: 'color', default: '#ffffff', domId: 'sls-cn-dot-color', composite: 'cnDot' },
    { key: 'cnGlowColor', type: 'color', default: '#d9a25c', domId: 'sls-cn-glow-color', composite: 'cnDot' },
    { key: 'cnShowDust', type: 'boolean', default: true, domId: 'sls-cn-dust', dataAttr: 'data-cn-hide-dust', invert: true },

    // ── 場景版基礎字級（未唱/已唱歌名、「正在播放」的歌手名）：Timeline 已有專屬 tlNameSize，
    // 這裡補 Diagonal／Constellation 的對應項，讓三個場景版都有「未唱歌曲字體大小」可調。
    // max 開到 80px：場景版是全畫布舞台設計，使用者可能想把清單文字放到接近標題等級的大小。──
    { key: 'dgWaitSize', type: 'number', default: 11, min: 7, max: 80, domId: 'sls-dg-wait-size', format: 'px', cssVar: '--dg-wait-size' },
    { key: 'cnWaitSize', type: 'number', default: 11, min: 7, max: 80, domId: 'sls-cn-wait-size', format: 'px', cssVar: '--cn-wait-size' },
    { key: 'sceneArtistSize', type: 'number', default: 11, min: 7, max: 80, domId: 'sls-scene-artist-size', format: 'px', cssVar: '--sl-scene-artist-size' },

    // ── KHelper 深度：行高 / 外邊距 / 進出場動畫 / 時間格式 ──
    { key: 'lineHeight', type: 'number', default: 1.4, min: 1, max: 2.4, domId: 'sls-line-height', format: 'rawDecimal', cssVar: '--sl-lh' },
    { key: 'marginV', type: 'number', default: 0, min: 0, max: 80, domId: 'sls-margin-v', format: 'px', cssVar: '--sl-mv' },
    { key: 'marginH', type: 'number', default: 0, min: 0, max: 80, domId: 'sls-margin-h', format: 'px', cssVar: '--sl-mh' },
    { key: 'rowAnim', type: 'enum', default: 'fade', values: ['fade', 'none', 'slide-up', 'slide-side'], domId: 'sls-row-anim', dataAttr: 'data-row-anim' },
    // timeFormat 沒有 CSS 變數（在 fmtOffset() 當下讀取），改動需觸發重繪
    { key: 'timeFormat', type: 'enum', default: 'mmss', values: ['mmss', 'hmmss', 'none'], domId: 'sls-time-format', needsRerender: true },
  ];

  const FIELD_BY_KEY = {};
  SETLIST_STYLE_FIELDS.forEach((f) => { FIELD_BY_KEY[f.key] = f; });

  /** 產生出廠預設值物件（server 開機預設 / client 重置按鈕共用同一份定義）。 */
  function getDefaultStyle() {
    const out = {};
    SETLIST_STYLE_FIELDS.forEach((f) => { out[f.key] = f.default; });
    return out;
  }

  /**
   * 驗證＋套用單一欄位改動（server 端用）。把 `incoming[key]` 依照 schema 型別/邊界
   * 寫入 `target[key]`；不合法（型別錯、超出 enum）的欄位會被忽略，不影響其他欄位。
   * @param {object} incoming 使用者送來的 style（可能只含部分欄位）
   * @param {object} target 要寫入的目前設定物件（會被就地修改）
   * @returns {object} target（方便鏈式使用）
   */
  function validateAndApply(incoming, target) {
    if (!incoming || typeof incoming !== 'object' || !target) return target;
    SETLIST_STYLE_FIELDS.forEach((f) => {
      const v = incoming[f.key];
      if (v == null) return;
      switch (f.type) {
        case 'number': {
          const n = Number(v);
          if (Number.isNaN(n)) return;
          target[f.key] = Math.min(f.max, Math.max(f.min, n));
          break;
        }
        case 'boolean':
          target[f.key] = Boolean(v);
          break;
        case 'enum':
          if (typeof v === 'string' && f.values.includes(v)) target[f.key] = v;
          break;
        case 'color':
        case 'string':
          if (typeof v === 'string') target[f.key] = v;
          break;
        default:
          break;
      }
    });
    return target;
  }

  return {
    FIELDS: SETLIST_STYLE_FIELDS,
    FIELD_BY_KEY,
    FORMATS,
    getDefaultStyle,
    validateAndApply,
  };
}));
