/**
 * 快捷歌詞模板：5 個槽位，各指定一個歌詞模板。直播時按快捷鍵或直播頁「歌詞模板」區的按鈕，
 * 就套用該模板「已經在畫面設定裡調好的外觀」——字型、顏色、位置都沿用那個模板自己的設定，
 * 這裡不另存外觀。
 *
 * - 槽位只存模板 ID（不存展示順序、不存翻譯後的名稱），存在這台裝置的 localStorage：
 *   這是面板操作偏好，不是歌詞設定本身；歌詞設定仍以伺服器為準（鐵則 4），切換走
 *   lyric-extras.js 的 LyricTemplates.select()，跟點模板畫廊完全同一條路。
 * - 沒設定的槽位按了只提示，不會自動挑一個模板。
 * - 模板被下架（例如季節模板收起來）時槽位保留，按了提示「目前無法使用」，不清掉設定。
 */
(function () {
  'use strict';

  const SLOT_COUNT = 5;
  const STORAGE_KEY = 'elitesand.quickTemplates.v1';
  const t = (key, vars) => (window.I18n && typeof window.I18n.t === 'function' ? window.I18n.t(key, vars) : key);
  const toast = (message, type) => {
    if (window.AppShared && typeof window.AppShared.showToast === 'function') window.AppShared.showToast(message, type);
  };

  function readSlots() {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) { stored = null; }
    const list = stored && stored.version === 1 && Array.isArray(stored.slots) ? stored.slots : [];
    return Array.from({ length: SLOT_COUNT }, (_, i) => (typeof list[i] === 'string' && /^[a-z0-9-]{1,40}$/.test(list[i]) ? list[i] : ''));
  }
  let slots = readSlots();

  function writeSlots() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, slots })); } catch (_) { /* 無痕模式：只在這次有效 */ }
  }

  // 模板清單與名稱直接讀「畫面 → 歌詞畫面」的模板畫廊，名稱跟著介面語言走。
  function templateCards() {
    return Array.from(document.querySelectorAll('#template-buttons [data-template]'));
  }
  function templateName(id) {
    const card = templateCards().find((el) => el.dataset.template === id);
    const name = card && card.querySelector('strong');
    return name ? name.textContent.trim() : id;
  }
  function availableIds() {
    if (window.LyricTemplates) return window.LyricTemplates.available();
    return templateCards().filter((el) => !el.hidden).map((el) => el.dataset.template);
  }
  function currentTemplate() {
    return window.LyricTemplates ? window.LyricTemplates.current() : null;
  }

  function apply(index) {
    const id = slots[index];
    if (!id) { toast(t('quickTemplates.toast.empty', { n: index + 1 })); return false; }
    if (!window.LyricTemplates) { toast(t('quickTemplates.toast.notReady')); return false; }
    const result = window.LyricTemplates.select(id);
    if (result === 'unknown') { toast(t('quickTemplates.toast.unavailable', { name: templateName(id) }), 'error'); return false; }
    if (result === 'ok') toast(t('quickTemplates.toast.applied', { name: templateName(id) }));
    return true;
  }

  function setSlot(index, id) {
    if (index < 0 || index >= SLOT_COUNT) return;
    slots[index] = id && availableIds().includes(id) ? id : '';
    writeSlots();
    renderLive();
    window.dispatchEvent(new CustomEvent('quick-templates:change'));
  }

  // ─── 直播頁「歌詞模板」區 ───
  const liveList = document.getElementById('quick-template-list');
  const liveCurrent = document.getElementById('quick-template-current');

  function renderLive() {
    const current = currentTemplate();
    if (liveCurrent) liveCurrent.textContent = current ? templateName(current) : '';
    if (!liveList) return;
    const available = availableIds();
    liveList.textContent = '';
    slots.forEach((id, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quick-template-btn';
      button.dataset.slot = String(index);
      const num = document.createElement('span');
      num.className = 'quick-template-num';
      num.textContent = String(index + 1);
      const name = document.createElement('span');
      name.className = 'quick-template-name';
      if (!id) {
        name.textContent = t('quickTemplates.empty');
        button.classList.add('is-empty');
      } else {
        name.textContent = templateName(id);
        if (!available.includes(id)) { button.classList.add('is-unavailable'); button.title = t('quickTemplates.unavailableTitle'); }
      }
      const active = !!id && id === current;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.append(num, name);
      liveList.appendChild(button);
    });
  }

  if (liveList) {
    liveList.addEventListener('click', (event) => {
      const button = event.target.closest('.quick-template-btn');
      if (!button) return;
      const index = Number(button.dataset.slot);
      // 空槽位直接帶去快捷鍵設定，讓使用者指定模板
      if (!slots[index]) { openSettings(); return; }
      apply(index);
    });
  }

  function openSettings() {
    // 快捷鍵卡片在「設定」頁（data-nav=general）
    const nav = document.querySelector('[data-nav="general"]');
    if (nav) nav.click();
    setTimeout(() => {
      // 設定頁分類顯示時，要先切到「快捷鍵」分類，卡片才看得到
      if (window.SettingsSlim && typeof window.SettingsSlim.select === 'function') window.SettingsSlim.select('hotkeys');
      // 五個槽位在快捷鍵表格最底下：直接捲到第一個槽位的選單並給焦點
      const select = document.querySelector('.hotkey-template-select');
      const target = select ? select.closest('tr') : document.getElementById('hotkeys-card');
      if (target) target.scrollIntoView({ block: 'center' });
      if (select) select.focus({ preventScroll: true });
    }, 120);
  }
  document.getElementById('quick-template-settings')?.addEventListener('click', openSettings);

  window.addEventListener('lyric-template:change', renderLive);
  window.addEventListener('lyric-templates:ready', renderLive);
  window.addEventListener('i18n:change', renderLive);
  renderLive();

  window.QuickTemplates = Object.freeze({
    SLOT_COUNT,
    apply,
    setSlot,
    slots: () => slots.slice(),
    availableIds,
    templateName,
  });
})();
