/**
 * 新功能的 NEW 標記（2026-10-28 使用者要求：新功能都要標 NEW，讓使用者知道更新了什麼）
 *
 * 用法：在元素加 data-new-feature="<功能代號>"，並在下面 FEATURES 登記上線日期。
 * - 預設把標記放進元素最後面；data-new-placement="after" 則放在元素後面（給 textContent 會被改寫的按鈕用）；
 *   元素內有 [data-new-badge-slot] 時放進那裡（整張卡片標 NEW、標記放在標題旁）。
 * - 使用者點過任一個同代號的元素、在裡面改了設定，或用了它所屬 <label> 對應的控制項（例如下拉選單）後，
 *   該功能的 NEW 全部消失；每台裝置各自記在 localStorage（純介面提示，
 *   不是歌詞／歌單設定，鐵則 4 不適用）。
 * - 上線超過 SHOW_DAYS 天自動不再顯示，沒人點的功能也不會一直掛著 NEW。
 * - 動態產生的元素（例如 import-prefs.js 建的開關）在這支之前載入即可；之後才出現的可呼叫 NewBadges.scan()。
 */
(function () {
  'use strict';

  const FEATURES = {
    'outro-pause-finish': '2026-11-23', // 直播頁清單下方「尾奏暫停後自動收尾」秒數
    'precise-sync': '2026-11-12',  // 精準對時元件（設定 › 下載工具卡，中文歌逐句校正）
    'auto-sync': '2026-10-28',     // 自動對時（對齊第一句旁、匯入後自動對時）
    'import-prefs': '2026-10-28',  // 加歌框下方「匯入後：…」設定
    'setlist-minimal': '2026-11-10',  // OBS 極簡歌單版型
    'setlist-now-playing': '2026-11-22',  // OBS 單曲看板版型（只顯示正在唱＋待機文字）
    'prompter-translation': '2026-11-11', // 跟唱視圖顯示雙語歌詞的譯文
    'library-word-upgrade': '2026-11-11', // 歌曲庫「逐句歌詞」篩選與批次升級成逐字
    'library-edit-meta': '2026-11-11',    // 歌曲庫直接改歌名／歌手
    'song-notes': '2026-11-12',           // 跟唱視圖的歌曲筆記（整首＋逐句，主播私用）
    'live-preview': '2026-11-10',     // 直播頁可收合的歌詞預覽
    'jizura-optin': '2026-11-11',     // 文字PV 自選部件（高耗能、大面積、恐怖風）
    'jizura-parts': '2026-11-10',     // 文字PV 部件範圍（標準／擴充）
    'quick-templates': '2026-11-10',
    'template-memory': '2026-11-10',  // 記住每首歌的歌詞模板  // 快捷歌詞模板（直播頁「歌詞模板」區＋快捷鍵）
    'per-song-volume': '2026-11-09',  // 記住每首歌的音量
    'overlay-show': '2026-11-09',     // 觀眾演出卡片（點歌明信片、揪團感謝，含各自外觀與位置）
    'overlay-show-nav': '2026-11-09', // 公開點歌頁分頁入口（裡面多了觀眾演出）
    'alert-show': '2026-11-12',       // 訂閱與贈訂演出（含揪團全畫面演出、門檻與演出勾選）
    'alert-show-nav': '2026-11-12',   // 公開點歌頁分頁入口（裡面多了訂閱與贈訂演出）
    'spout-gpu': '2026-11-09',        // Spout 輸出用的顯示卡
    'practice-score-mode': '2026-11-07', // 練唱評分模式（寬鬆／嚴格）
    'practice-obs-url': '2026-11-07', // 設定 › OBS 與連線的練唱畫面網址
    'practice': '2026-10-28',      // 頂層「練唱」分頁（音軌評分＋OBS 練唱疊加層）
    'practice-loop': '2026-10-31', // 練唱 A–B 循環
    'practice-echo-cancel': '2026-10-31', // 練唱回音消除（試用）
    'practice-review': '2026-10-31', // 練唱回饋（弱句、個人成績比較）
    'practice-challenge': '2026-10-31', // 練唱觀眾挑戰
    'library-batch-practice': '2026-10-31', // 歌曲庫批次建立練唱音軌
    'practice-mic-gain': '2026-10-30', // 練唱麥克風增益
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
      const seenNow = () => markSeen(id);
      el.addEventListener('click', seenNow);
      el.addEventListener('change', seenNow);
      // 標記掛在 label 文字上時，使用者實際操作的是 label 對應的選單／輸入框，點那個也要算看過。
      const control = el.closest('label')?.control;
      if (control && !el.contains(control)) {
        control.addEventListener('change', seenNow);
        control.addEventListener('click', seenNow);
      }
      if (!active(id)) return;
      const badge = document.createElement('span');
      badge.className = 'new-badge';
      badge.dataset.feature = id;
      badge.textContent = 'NEW';
      badge.setAttribute('aria-label', 'NEW');
      const slot = el.querySelector('[data-new-badge-slot]');
      if (slot) slot.append(badge);
      else if (el.dataset.newPlacement === 'after') el.after(badge);
      else el.append(badge);
    });
  }

  // ── 往外冒泡：功能藏在收合區、選單、分頁、設定分類或另一個頁面裡時，沿路每一道「門」也標 NEW ──
  // （2026-11-23 使用者回報：「記住每首歌的音量」的 NEW 在收合的「音訊」裡，不打開根本不知道有新功能）
  // 門上插的是 .new-badge--door；有些按鈕的文字會被 i18n 整段改寫，所以換語言後重新補一次。
  function doorsFor(el) {
    const doors = [];
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      // 收合區塊 <details>：摘要列
      if (node.tagName === 'DETAILS') {
        const summary = node.querySelector(':scope > summary');
        if (summary && !summary.contains(el)) doors.push(summary);
      }
      // live-slim 的 ⋯ 彈出選單：觸發按鈕
      if (node.classList.contains('lslim-pop')) {
        const trigger = node.parentElement && node.parentElement.querySelector(':scope > button');
        if (trigger) doors.push(trigger);
      }
      // aria 分頁面板：對應的分頁按鈕
      if (node.id && node.getAttribute('role') === 'tabpanel') {
        document.querySelectorAll(`[aria-controls="${node.id}"]`).forEach((tab) => doors.push(tab));
      }
      // 設定工作區的分組：同一個工作區裡的分組按鈕（一張卡可同屬多組）
      if (node.dataset.settingsWorkspaceGroup) {
        const root = node.closest('.settings-workspace') || document;
        node.dataset.settingsWorkspaceGroup.split(/\s+/).forEach((group) => {
          root.querySelectorAll(`[data-settings-workspace-tab="${group}"]`).forEach((tab) => doors.push(tab));
        });
      }
      // 系統設定的分類（settings-slim.js 標的）
      if (node.dataset.sslimCategory) {
        document.querySelectorAll(`.sslim-cat[data-sslim-cat="${node.dataset.sslimCategory}"]`).forEach((btn) => doors.push(btn));
      }
      // 整個頁面：頂部分頁，次級分頁再加上它的上層分頁
      if (node.classList.contains('view') && node.dataset.view) {
        const item = document.querySelector(`.nav-item[data-nav="${node.dataset.view}"]`);
        if (item) {
          doors.push(item);
          const parent = item.dataset.parent && document.querySelector(`.nav-item[data-nav="${item.dataset.parent}"]`);
          if (parent) doors.push(parent);
        }
      }
    }
    return doors;
  }

  const visibleBadge = (node) => [...node.querySelectorAll('.new-badge:not(.new-badge--door), .nav-new-badge')]
    .some((badge) => !badge.hidden && badge.getClientRects().length > 0);

  function refreshDoors() {
    document.querySelectorAll('.new-badge--door').forEach((badge) => badge.remove());
    const marked = new Set();
    document.querySelectorAll('[data-new-feature]').forEach((el) => {
      if (!active(el.dataset.newFeature)) return;
      doorsFor(el).forEach((door) => {
        if (marked.has(door)) return;
        // 門本身已經看得到自己的 NEW（例如摘要列就是另一個新功能）就不再疊一個
        if (door.matches('[data-new-feature]') || visibleBadge(door)) return;
        marked.add(door);
        const badge = document.createElement('span');
        badge.className = 'new-badge new-badge--door';
        badge.textContent = 'NEW';
        badge.setAttribute('aria-hidden', 'true');
        door.append(badge);
      });
    });
  }

  const markSeenAndRefresh = (id) => { markSeen(id); refreshDoors(); };

  scan();
  // 各頁的版面整理（*-slim.js）在這支之後才把元素搬進選單／分類；等同步腳本跑完再算一次，載入完成後再補一次
  setTimeout(refreshDoors, 0);
  window.addEventListener('load', refreshDoors);
  window.addEventListener('i18n:change', () => setTimeout(refreshDoors, 0));
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-new-feature]')) setTimeout(refreshDoors, 0);
  });
  window.NewBadges = Object.freeze({ scan, markSeen: markSeenAndRefresh, refreshDoors, doorsFor });
})();
