/**
 * 練唱演出風格與 OBS 外觀預設（面板、OBS 練唱疊加層共用；伺服器 practice-overlay.js 有同一份預設與驗證）。
 *
 * 演出風格只改光量、粒子與動畫幅度，不改版面：主播畫面上的位置不會因為換風格而跑掉。
 * 擴充方式：在 FX_PRESETS 加一筆即可——只寫跟 extends（預設 normal）不同的欄位；選單由這張表產生；
 * CSS 以 .pstage.fx-<id> 掛動畫，新風格沒寫專屬動畫時，因為也會掛上整條繼承鏈的 class，自動沿用父風格。
 * 新增風格時也要把 id 加進 server/services/practice-overlay.js 的 FX_IDS，並補 i18n 的 practice.fx.<id>。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PracticeFx = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FX_BASE = Object.freeze({
    glow: 1,            // 發光倍率（0＝不發光）
    particles: 1,       // 碎光數量倍率（0＝不噴）
    ring: true,         // PERFECT／結算的擴散光環
    edge: true,         // 正在填色的前緣亮線
    noteBurst: true,    // 唱得很好的音結束時冒小碎光
    perfectRing: true,  // 唱得很好的音描一圈邊
    trailW: 1,          // 你的聲音軌跡粗細倍率
    trailGlow: 1,       // 軌跡發光倍率
    tags: true,         // 技巧標籤（VIBRATO 等）是否畫在音軌上；不畫時仍照常計數
    blockH: 0.72,       // 音符方塊高度（佔一個半音列的比例）
    sheen: false,       // 填色上的流光
    pulse: false,       // 目前這個音的外框呼吸
    playheadGlow: 0,    // 播放頭發光半徑（px）
    hideLow: false,     // 不在畫面上跳 GOOD／MISS（分數照算）
    countMs: 1300,      // 結算分數滾動時間（0＝直接顯示）
    wave: false,        // 結算第二波碎光
  });

  const FX_PRESETS = Object.freeze({
    quiet: { label: 'practice.fx.quiet', glow: 0, particles: 0, ring: false, edge: false, noteBurst: false, perfectRing: false,
      trailW: 0.7, trailGlow: 0, tags: false, blockH: 0.55, hideLow: true, countMs: 0 },
    calm: { label: 'practice.fx.calm', glow: 0.5, particles: 0.35, ring: false, noteBurst: false, trailW: 0.85, trailGlow: 0.5,
      blockH: 0.66, countMs: 900 },
    normal: { label: 'practice.fx.normal' },
    warm: { label: 'practice.fx.warm', glow: 1.4, particles: 1.7, trailW: 1.2, trailGlow: 1.4, blockH: 0.76, pulse: true,
      playheadGlow: 8, countMs: 1500 },
    grand: { label: 'practice.fx.grand', extends: 'warm', glow: 2, particles: 2.6, trailW: 1.4, trailGlow: 2, blockH: 0.8,
      sheen: true, playheadGlow: 14, countMs: 1900, wave: true },
  });

  /** 由根到葉的繼承鏈，例如 grand → ['normal', 'warm', 'grand']；未知 id 視為 normal。 */
  function fxChain(id) {
    const out = [];
    let key = Object.prototype.hasOwnProperty.call(FX_PRESETS, id) ? id : 'normal';
    for (let guard = 0; key && guard < 8; guard++) {
      out.unshift(key);
      key = FX_PRESETS[key].extends || (key === 'normal' ? null : 'normal');
    }
    return out;
  }

  const cache = new Map();
  function resolveFx(id) {
    const key = Object.prototype.hasOwnProperty.call(FX_PRESETS, id) ? id : 'normal';
    if (!cache.has(key)) cache.set(key, Object.freeze(Object.assign({}, FX_BASE, ...fxChain(key).map((k) => FX_PRESETS[k]))));
    return cache.get(key);
  }

  const STYLE_DEFAULT = Object.freeze({ fx: 'normal', bg: true, bgOpacity: 45, bgColor: '#0B0B0A', note: '#5A5A50', fill: '#E9B949',
    voice: '#FFF3C9', off: '#E8836B', edge: true, pos: 'bottom', laneH: 38, score: true, lyrics: false, result: false, trailMode: 'ribbon' });

  return { FX_BASE, FX_PRESETS, fxChain, resolveFx, STYLE_DEFAULT, FX_IDS: Object.keys(FX_PRESETS) };
});
