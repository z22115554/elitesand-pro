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
      empty.textContent = '目前沒有適用於此版本的公告。';
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
      const date = item.publishedAt ? new Date(item.publishedAt).toLocaleDateString('zh-TW') : '未標日期';
      meta.textContent = `${date} · ${item.read ? '已讀' : '未讀'}`;
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
    const critical = candidates.find((item) => item.level === 'critical');
    const warning = candidates.find((item) => item.level === 'warning');
    const info = candidates.find((item) => item.level === 'info');

    if (critical && criticalModal) {
      criticalTitle.textContent = critical.title;
      criticalMessage.textContent = critical.message;
      setSafeLink(criticalLink, critical);
      criticalClose.hidden = !critical.dismissible;
      criticalClose.onclick = () => dismiss(critical, criticalModal);
      criticalModal.hidden = false;
      markSeen(critical);
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
    statusEl.textContent = force ? '正在重新整理…' : '背景讀取中…';
    try {
      const response = await fetch(`/api/announcements${force ? '?force=1' : ''}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '伺服器沒有回應');
      const items = Array.isArray(data.announcements) ? data.announcements : [];
      statusEl.textContent = data.fetchedAt
        ? `最近同步：${new Date(data.fetchedAt).toLocaleString('zh-TW')}`
        : '尚無成功下載的公告快取';
      renderList(items);
      window.dispatchEvent(new CustomEvent('announcements:actions', { detail: data.actions || {} }));
      present(items);
    } catch (err) {
      statusEl.textContent = `公告暫時無法讀取：${err.message}`;
    } finally { refreshBtn.disabled = false; }
  }

  refreshBtn.addEventListener('click', () => load(true));
  setTimeout(() => load(false), 4000);
})();
