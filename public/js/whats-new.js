/**
 * 更新後第一次開面板：跳出「這版更新了什麼」（2026-11-23 使用者回報：更新到新版的人根本不知道更新了什麼）
 *
 * - 內容在 whats-new-data.js（隨程式發版）；已讀紀錄在伺服器（/api/whats-new），只跳一次。
 * - 等 EULA 閘門處理完才出場；全新安裝不跳（伺服器直接記成目前版本）。
 * - 「帶我去看」：沿 NewBadges.doorsFor 由外往內打開頁籤、收合區、選單，捲過去並閃一下；
 *   這時還不算看完，右下角留一顆「回到更新內容（已看 n／總數）」可以回去看下一項。
 *   按「知道了」或那顆按鈕的 × 才記成已讀。
 * - 說明視窗頂端的「這版更新了什麼」隨時可以重看（window.WhatsNew.open()）。
 */
(() => {
  'use strict';
  const data = window.WhatsNewData;
  if (!data) return;
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const locale = () => (window.I18n && typeof window.I18n.current === 'function' ? window.I18n.current() : 'zh-TW');
  const request = (url, options) => (window.PinAuth && PinAuth.fetchWithPin ? PinAuth.fetchWithPin(url, options) : fetch(url, options));

  let modal = null;
  let chip = null;
  let status = null; // { appVersion, lastSeenVersion }
  let current = { releases: [], version: null, unseen: false };
  const visited = new Set();

  function markSeen(version) {
    if (!version) return Promise.resolve();
    if (status) status.lastSeenVersion = version;
    return request('/api/whats-new/seen', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }),
    }).catch(() => { /* 下次開面板會再跳一次，不影響使用 */ });
  }

  async function loadStatus() {
    if (status) return status;
    try {
      const res = await request('/api/whats-new', { cache: 'no-store' });
      if (res.ok) status = await res.json();
    } catch (_) { /* 離線或權限不足：不跳 */ }
    return status;
  }

  function featureTarget(id) {
    return id ? document.querySelector(`[data-new-feature="${id}"]`) : null;
  }

  function reveal(id) {
    const target = featureTarget(id);
    if (!target) return;
    const doors = window.NewBadges && NewBadges.doorsFor ? NewBadges.doorsFor(target).reverse() : [];
    for (const door of doors) {
      if (door.tagName === 'SUMMARY') { door.parentElement.open = true; continue; }
      if (door.getAttribute('aria-expanded') === 'true') continue;
      door.click();
    }
    document.dispatchEvent(new CustomEvent('ui:reveal', { detail: { target } }));
    setTimeout(() => {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.add('whats-new-flash');
      setTimeout(() => target.classList.remove('whats-new-flash'), 1800);
    }, 250);
  }

  const totalItems = () => current.releases.reduce((n, r) => n + r.items.length, 0);

  // 看完了：記已讀（只有自動跳出的那次才需要），收掉視窗與回去按鈕
  function finish() {
    if (modal) modal.hidden = true;
    removeChip();
    if (current.unseen) { current.unseen = false; markSeen(current.version); }
  }

  function removeChip() {
    if (chip) { chip.remove(); chip = null; }
  }

  function showChip() {
    removeChip();
    chip = document.createElement('div');
    chip.className = 'whats-new-chip';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn btn-sm whats-new-chip-back';
    back.textContent = t('whatsNew.resume', { done: visited.size, total: totalItems() });
    back.addEventListener('click', () => { removeChip(); open(); });
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'btn btn-sm btn-ghost whats-new-chip-close';
    dismiss.textContent = '×';
    dismiss.setAttribute('aria-label', t('whatsNew.close'));
    dismiss.title = t('whatsNew.close');
    dismiss.addEventListener('click', finish);
    chip.append(back, dismiss);
    document.body.appendChild(chip);
  }

  function build() {
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'whats-new-modal';
    modal.className = 'modal whats-new-modal';
    modal.hidden = true;
    const card = document.createElement('div');
    card.className = 'modal-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'whats-new-title');
    const head = document.createElement('div');
    head.className = 'modal-head';
    const title = document.createElement('h3');
    title.id = 'whats-new-title';
    title.textContent = t('whatsNew.title');
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-sm btn-primary';
    closeBtn.dataset.modalInitialFocus = '';
    closeBtn.textContent = t('whatsNew.close');
    closeBtn.addEventListener('click', finish);
    head.append(title, closeBtn);
    const body = document.createElement('div');
    body.className = 'modal-body whats-new-body';
    for (const release of current.releases) {
      const section = document.createElement('section');
      section.className = 'whats-new-release';
      const label = document.createElement('p');
      label.className = 'eyebrow whats-new-version';
      label.textContent = t('whatsNew.versionLine', { version: release.version, date: release.date });
      const list = document.createElement('ul');
      list.className = 'whats-new-list';
      for (const item of release.items) {
        const li = document.createElement('li');
        li.className = 'whats-new-item';
        if (visited.has(item.feature)) li.classList.add('is-visited');
        const text = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = data.text(item.title, locale());
        const desc = document.createElement('p');
        desc.textContent = data.text(item.desc, locale());
        text.append(name, desc);
        li.appendChild(text);
        if (featureTarget(item.feature)) {
          const go = document.createElement('button');
          go.type = 'button';
          go.className = 'btn btn-sm btn-ghost whats-new-go';
          go.textContent = t(visited.has(item.feature) ? 'whatsNew.goAgain' : 'whatsNew.go');
          go.addEventListener('click', () => {
            visited.add(item.feature);
            modal.hidden = true; // 還沒看完：不記已讀，留回去的按鈕
            reveal(item.feature);
            showChip();
          });
          li.appendChild(go);
        }
        list.appendChild(li);
      }
      section.append(label, list);
      body.appendChild(section);
    }
    card.append(head, body);
    modal.appendChild(card);
    modal.addEventListener('click', (event) => { if (event.target === modal) finish(); });
    modal.addEventListener('keydown', (event) => { if (event.key === 'Escape') finish(); });
    document.body.appendChild(modal);
  }

  function show(releases, version, { unseen = false } = {}) {
    if (!releases.length) return;
    if (current.version !== version) visited.clear();
    current = { releases, version, unseen: unseen || current.unseen };
    build();
    modal.hidden = false;
  }

  // 手動重看：目前版本（含）以前最新的一版
  async function open() {
    const s = await loadStatus();
    const version = (s && s.appVersion) || (data.RELEASES[0] && data.RELEASES[0].version);
    if (current.releases.length && current.version === version) { show(current.releases, version); return; }
    const releases = data.RELEASES.filter((r) => data.compareVersions(r.version, version) <= 0)
      .sort((a, b) => data.compareVersions(b.version, a.version)).slice(0, 1);
    show(releases, version);
  }

  async function check() {
    if (window.EulaGate && EulaGate.whenCleared) await EulaGate.whenCleared;
    const s = await loadStatus();
    if (!s || !s.appVersion) return;
    const releases = data.releasesToShow(s.lastSeenVersion, s.appVersion);
    if (releases.length) show(releases, s.appVersion, { unseen: true });
    else if (s.lastSeenVersion !== s.appVersion) markSeen(s.appVersion); // 這版沒有可說的內容，記成看過
  }

  // 說明視窗頂端的「這版更新了什麼」
  const helpBtn = document.getElementById('help-whats-new');
  if (helpBtn) {
    helpBtn.addEventListener('click', () => {
      document.getElementById('help-close')?.click();
      open();
    });
  }

  window.WhatsNew = Object.freeze({ open, reveal });

  // 等其他整理版面的腳本（*-slim.js、NEW 冒泡）都跑完，「帶我去看」才找得到入口
  if (document.readyState === 'complete') setTimeout(check, 300);
  else window.addEventListener('load', () => setTimeout(check, 300));
})();
