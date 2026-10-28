/**
 * 新功能的 NEW 標記（2026-10-28 使用者要求：新功能都要標 NEW，讓使用者知道更新了什麼）
 *
 * 用法：在元素加 data-new-feature="<功能代號>"，並在下面 FEATURES 登記上線日期。
 * - 預設把標記放進元素最後面；data-new-placement="after" 則放在元素後面（給 textContent 會被改寫的按鈕用）。
 * - 使用者點過任一個同代號的元素後，該功能的 NEW 全部消失；每台裝置各自記在 localStorage（純介面提示，
 *   不是歌詞／歌單設定，鐵則 4 不適用）。
 * - 上線超過 SHOW_DAYS 天自動不再顯示，沒人點的功能也不會一直掛著 NEW。
 * - 動態產生的元素（例如 import-prefs.js 建的開關）在這支之前載入即可；之後才出現的可呼叫 NewBadges.scan()。
 */
(function () {
  'use strict';

  const FEATURES = {
    'auto-sync': '2026-10-28',     // 自動對時（對齊第一句旁、匯入後自動對時）
    'import-prefs': '2026-10-28',  // 加歌框下方「匯入後：…」設定
    'practice': '2026-10-28',      // 頂層「練唱」分頁（音軌評分＋OBS 練唱疊加層）
    'import-practice': '2026-10-29', // 匯入後「練唱音高」
  };
  const SHOW_DAYS = 60;
  const KEY = 'elitesand.newFeaturesSeen';

  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) { seen = {}; }

  function active(id) {
    const since = FEATURES[id];
    if (!since || seen[id]) return false;
    return Date.now() - Date.parse(`${since}T00:00:00`) < SHOW_DAYS * 86400000;
  }

  function markSeen(id) {
    if (seen[id]) return;
    seen[id] = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(seen)); } catch (_) { /* 只在這次有效 */ }
    document.querySelectorAll(`.new-badge[data-feature="${id}"]`).forEach((badge) => badge.remove());
  }

  function scan(root = document) {
    root.querySelectorAll('[data-new-feature]').forEach((el) => {
      const id = el.dataset.newFeature;
      if (el.dataset.newBadgeBound) return;
      el.dataset.newBadgeBound = '1';
      el.addEventListener('click', () => markSeen(id));
      if (!active(id)) return;
      const badge = document.createElement('span');
      badge.className = 'new-badge';
      badge.dataset.feature = id;
      badge.textContent = 'NEW';
      badge.setAttribute('aria-label', 'NEW');
      if (el.dataset.newPlacement === 'after') el.after(badge);
      else el.append(badge);
    });
  }

  scan();
  window.NewBadges = Object.freeze({ scan, markSeen });
})();
