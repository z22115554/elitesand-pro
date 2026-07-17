/**
 * OBS 歌詞預覽等比縮放
 * iframe 以真實 OBS 解析度(1920×1080)渲染，這裡依容器寬度算出 scale，
 * 讓預覽成為 OBS 輸出的「等比縮小縮圖」（比例與 OBS 完全一致）。
 */
(function () {
  'use strict';
  const OBS_W = 1920;
  const wraps = Array.from(document.querySelectorAll('.obs-preview-wrap, .setlist-preview-wrap'));
  if (!wraps.length) return;

  function applyTo(wrap) {
    const w = wrap.clientWidth;
    if (w > 0) wrap.style.setProperty('--preview-scale', (w / OBS_W).toFixed(4));
  }
  function apply() { wraps.forEach(applyTo); }

  apply();
  let observing = false;
  if (typeof ResizeObserver !== 'undefined') {
    try {
      const ro = new ResizeObserver((entries) => entries.forEach((e) => applyTo(e.target)));
      wraps.forEach((w) => { if (w && w.nodeType === 1) ro.observe(w); });
      observing = true;
    } catch (_) {
      // 少數嵌入式 WebView 的 observer 實作不完整；預覽不能因此中斷整個控制台。
    }
  }
  if (!observing) {
    window.addEventListener('resize', apply);
  }
  // 視圖切換 / 字體載入後再校正一次
  document.addEventListener('view:change', () => setTimeout(apply, 50));
  window.addEventListener('load', apply);
})();
