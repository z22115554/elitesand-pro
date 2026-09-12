/** 遠端公告：後端已驗證資料，前端仍只用 textContent 與固定 DOM，不插入遠端 HTML。 */
(function () {
  'use strict';

  const statusEl = document.getElementById('announcement-status');
  const listEl = document.getElementById('announcement-list');
  const refreshBtn = document.getElementById('announcement-refresh');
  const banner = document.getElementById('announcement-banner');
  const bannerTitle = document.getElementById('announcement-banner-title');
  const bannerMessage = document.getElementById('announcement-banner-message');
  const bannerLink = document.getElementById('announcement-banner-link');
  const bannerClose = document.getElementById('announcement-banner-close');
  const criticalModal = document.getElementById('announcement-critical-modal');
  const criticalTitle = document.getElementById('announcement-critical-title');
  const criticalMessage = document.getElementById('announcement-critical-message');
  const criticalLink = document.getElementById('announcement-critical-link');
  const criticalClose = document.getElementById('announcement-critical-close');
  if (!statusEl || !listEl || !refreshBtn) return;
  const tr = (value) => window.I18n ? window.I18n.translate(value) : value;
  const locale = () => window.I18n ? window.I18n.current() : 'zh-TW';
  let loaded = false;

  // 走「強制彈窗」介面的公告等級，依顯示優先序排列（陣列前面的比較急，同時存在時優先顯示）。
  // className 是額外疊上去的外觀 class（樣式中性、無需額外樣式就填 null）。之後要再讓一個
  // 新等級走同一套彈窗，只需要在這裡加一筆，不用再改下面 present() 的選取／樣式邏輯。
  const MODAL_LEVELS = [
    { level: 'critical', className: null },
    { level: 'notice', className: 'is-notice' },
  ];

  function protectedPost(url) {
    return typeof PinAuth !== 'undefined'
      ? PinAuth.fetchWithPin(url, { method: 'POST' })
      : fetch(url, { method: 'POST' });
  }

  function setSafeLink(element, announcement) {
    const enabled = announcement.url && announcement.buttonText;
    element.hidden = !enabled;
    if (enabled) {
      element.href = announcement.url;
      element.textContent = announcement.buttonText;
    } else {
      element.removeAttribute('href');
      element.textContent = '';
    }
  }

  function renderList(items) {
    listEl.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'sub';
      empty.textContent = tr('目前沒有適用於此版本的公告。');
      listEl.appendChild(empty);
      return;
    }
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'announcement-item';
      const head = document.createElement('div');
      head.className = 'announcement-item-head';
      const level = document.createElement('span');
      level.className = `announcement-level ${item.level}`;
      level.textContent = item.level;
      const title = document.createElement('span');
      title.className = 'announcement-item-title';
      title.textContent = item.title;
      const meta = document.createElement('span');
      meta.className = 'announcement-item-meta';
      const date = item.publishedAt ? new Date(item.publishedAt).toLocaleDateString(locale()) : tr('未標日期');
      meta.textContent = `${date} · ${tr(item.read ? '已讀' : '未讀')}`;
      head.append(level, title);
      row.append(head, meta);
      listEl.appendChild(row);
    }
  }

  async function markSeen(item) {
    try { await protectedPost(`/api/announcements/${encodeURIComponent(item.id)}/seen`); } catch (_) { /* 本機狀態失敗不阻斷公告 */ }
  }

  async function dismiss(item, element) {
    try {
      const response = await protectedPost(`/api/announcements/${encodeURIComponent(item.id)}/dismiss`);
      if (response.ok) element.hidden = true;
    } catch (_) { /* 保留公告 */ }
  }

  function present(items) {
    const candidates = items.filter((item) => item.shouldPresent);
    // MODAL_LEVELS 裡的等級共用同一個強制彈窗（可不可以關閉是資料驅動的
    // announcement.dismissible，見 announcement-service.js 的 LEVEL_DISMISSIBLE_LOCK）；
    // 陣列前面的等級優先顯示，例如 critical 是真的出事了，跟 notice 同時存在時優先顯示 critical。
    let modalItem = null;
    let modalClassName = null;
    for (const entry of MODAL_LEVELS) {
      const found = candidates.find((item) => item.level === entry.level);
      if (found) { modalItem = found; modalClassName = entry.className; break; }
    }
    const warning = candidates.find((item) => item.level === 'warning');
    const info = candidates.find((item) => item.level === 'info');

    if (modalItem && criticalModal) {
      criticalTitle.textContent = modalItem.title;
      criticalMessage.textContent = modalItem.message;
      setSafeLink(criticalLink, modalItem);
      criticalClose.hidden = !modalItem.dismissible;
      criticalClose.onclick = () => dismiss(modalItem, criticalModal);
      MODAL_LEVELS.forEach((entry) => {
        if (entry.className) criticalModal.classList.toggle(entry.className, entry.className === modalClassName);
      });
      criticalModal.hidden = false;
      markSeen(modalItem);
    }
    if (warning && banner) {
      bannerTitle.textContent = warning.title;
      bannerMessage.textContent = warning.message;
      setSafeLink(bannerLink, warning);
      bannerClose.hidden = !warning.dismissible;
      bannerClose.onclick = () => dismiss(warning, banner);
      banner.hidden = false;
      markSeen(warning);
    }
    if (info) {
      if (typeof AppShared !== 'undefined') AppShared.showToast(`${info.title}：${info.message}`, 'info');
      markSeen(info);
    }
  }

  async function load(force) {
    refreshBtn.disabled = true;
    statusEl.textContent = tr(force ? '正在重新整理…' : '背景讀取中…');
    try {
      const response = await fetch(`/api/announcements${force ? '?force=1' : ''}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '伺服器沒有回應');
      const items = Array.isArray(data.announcements) ? data.announcements : [];
      statusEl.textContent = data.fetchedAt
        ? tr(`最近同步：${new Date(data.fetchedAt).toLocaleString(locale())}`)
        : tr('尚無成功下載的公告快取');
      renderList(items);
      window.dispatchEvent(new CustomEvent('announcements:actions', { detail: data.actions || {} }));
      present(items);
    } catch (err) {
      statusEl.textContent = tr(`公告暫時無法讀取：${err.message}`);
    } finally { refreshBtn.disabled = false; }
  }

  refreshBtn.addEventListener('click', () => load(true));
  // 這裡的狀態列是 JS 直接寫進 DOM 的，語系層不會回頭重繪；換語言時要自己重畫。
  window.addEventListener('i18n:change', () => { if (loaded) load(false); });
  setTimeout(() => { loaded = true; load(false); }, 4000);
})();
