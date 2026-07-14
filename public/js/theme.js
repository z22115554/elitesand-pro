/**
 * Elitesand Pro 主題管理（深色 / 淺色）
 * - 預設跟隨系統 prefers-color-scheme
 * - 使用者手動切換後記憶於 localStorage（vk-theme）
 * - 同步更新 <meta name="theme-color">（手機瀏覽器狀態列顏色）
 * - 僅供 /controller 與 /panel 載入，/display（OBS）不使用
 */
const ThemeManager = (() => {
  const STORAGE_KEY = 'vk-theme';
  const META_COLORS = { dark: '#1B141F', light: '#F7F2F9' };

  function getSaved() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }

  function getSystemPref() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light' : 'dark';
    } catch (e) { return 'dark'; }
  }

  function current() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function apply(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);

    // 更新 meta theme-color
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = META_COLORS[t];

    // 更新所有切換按鈕圖示（SVG，不用 emoji）
    const sunIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>';
    const moonIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
    document.querySelectorAll('.theme-toggle').forEach((btn) => {
      btn.innerHTML = t === 'light' ? moonIcon : sunIcon;
      btn.title = t === 'light' ? '切換深色模式' : '切換淺色模式';
      btn.setAttribute('aria-label', btn.title);
    });
  }

  function toggle() {
    const next = current() === 'light' ? 'dark' : 'light';
    apply(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* 靜默 */ }
  }

  function init() {
    apply(getSaved() || getSystemPref());

    // 使用者未手動選擇時，跟隨系統切換
    try {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
        if (!getSaved()) apply(e.matches ? 'light' : 'dark');
      });
    } catch (e) { /* 舊瀏覽器靜默 */ }

    // 綁定切換按鈕
    document.querySelectorAll('.theme-toggle').forEach((btn) => {
      btn.addEventListener('click', toggle);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { toggle, apply, current };
})();
