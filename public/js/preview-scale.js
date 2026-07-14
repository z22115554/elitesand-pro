/**
 * OBS 歌詞預覽等比縮放
 * iframe 以真實 OBS 解析度(1920×1080)渲染，這裡依容器寬度算出 scale，
 * 讓預覽成為 OBS 輸出的「等比縮小縮圖」（比例與 OBS 完全一致）。
 */
(function () {
  'use strict';
  const OBS_W = 1920;
  const wraps = Array.from(document.querySelectorAll('.obs-preview-wrap'));
  if (!wraps.length) return;

  function applyTo(wrap) {
    const w = wrap.clientWidth;
    if (w > 0) wrap.style.setProperty('--preview-scale', (w / OBS_W).toFixed(4));
  }
  function apply() { wraps.forEach(applyTo); }

  apply();
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver((entries) => entries.forEach((e) => applyTo(e.target)));
    wraps.forEach((w) => { if (w && w.nodeType === 1) ro.observe(w); });
  } else {
    window.addEventListener('resize', apply);
  }
  // 視圖切換 / 字體載入後再校正一次
  document.addEventListener('view:change', () => setTimeout(apply, 50));
  window.addEventListener('load', apply);
})();
