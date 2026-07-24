/**
 * OBS 預覽等比縮放
 * iframe 以真實 OBS 解析度渲染，這裡依容器寬度算出 scale，
 * 讓預覽成為 OBS 輸出的「等比縮小縮圖」（比例與 OBS 完全一致）。
 * 歌單預覽可以模擬不同的 Browser Source 尺寸：面板會在該 wrap 上設 --preview-w，
 * 這裡就以那個寬度為基準（沒設就是預設的 1920）。
 */
(function () {
  'use strict';
  const OBS_W = 1920;
  const wraps = Array.from(document.querySelectorAll('.obs-preview-wrap, .setlist-preview-wrap'));
  if (!wraps.length) return;

  function baseWidth(wrap) {
    const raw = parseFloat(wrap.style.getPropertyValue('--preview-w'));
    return raw > 0 ? raw : OBS_W;
  }
  function applyTo(wrap) {
    const w = wrap.clientWidth;
    if (w > 0) wrap.style.setProperty('--preview-scale', (w / baseWidth(wrap)).toFixed(4));
  }
  function apply() { wraps.forEach(applyTo); }
  // 面板換模擬尺寸後呼叫，不必重複實作同一份縮放計算。
  window.PreviewScale = { apply };

  apply();
  // 這些預覽的寬度只會跟著視窗／視圖切換變化。部分嵌入式 WebView 的
  // ResizeObserver 會在 observe() 當下報「參數不是 Node」並留下控制台錯誤；
  // resize 事件足以覆蓋實際情境，也能保證預覽功能不受 observer 實作差異影響。
  window.addEventListener('resize', apply);
  // 視圖切換 / 字體載入後再校正一次
  document.addEventListener('view:change', () => setTimeout(apply, 50));
  window.addEventListener('load', apply);
})();
