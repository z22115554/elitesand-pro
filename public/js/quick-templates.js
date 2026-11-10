/**
 * 快捷歌詞模板：一組槽位（預設 5 個、最多 20 個，可新增、移除），各指定一個歌詞模板。
 * 直播時按快捷鍵或直播頁「歌詞模板」區的按鈕，就套用該模板「已經在畫面設定裡調好的外觀」——
 * 字型、顏色、位置都沿用那個模板自己的設定，這裡不另存外觀。
 *
 * - 槽位只存模板 ID（不存展示順序、不存翻譯後的名稱），存在這台裝置的 localStorage：
 *   這是面板操作偏好，不是歌詞設定本身；歌詞設定仍以伺服器為準（鐵則 4），切換走
 *   lyric-extras.js 的 LyricTemplates.select()，跟點模板畫廊完全同一條路。
 * - 快捷鍵跟著「第幾個」走：移除第 3 個時，後面的往前補，Ctrl+Alt+3 就換成原本第 4 個的模板。
 * - 沒設定的槽位按了只提示，不會自動挑一個模板；模板被下架時槽位保留，按了提示無法使用。
 *
 * 記住每首歌的模板（預設關閉，跟「記住每首歌的音量」同一套想法）：
 * - 開啟後，在某首歌手動切模板＝記住這首（伺服器 state 的 trackTemplate，只存模板 ID）；
 *   下次播這首自動切回去。沒記住的歌用「預設模板」。
 * - 切歌時的自動套用不算使用者選的，不會反過來被記住。
 */
(function () {
  'use strict';

  const MAX_SLOTS = 20;
  const DEFAULT_SLOTS = 5;
  const STORAGE_KEY = 'elitesand.quickTemplates.v1';
  const MEMORY_KEY = 'elitesand.templateMemory.v1';
  const ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
  const t = (key, vars) => (window.I18n && typeof window.I18n.t === 'function' ? window.I18n.t(key, vars) : key);
  const toast = (message, type) => {
    if (window.AppShared && typeof window.AppShared.showToast === 'function') window.AppShared.showToast(message, type);
  };
  const readJson = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } };
  const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* 無痕模式：只在這次有效 */ } };

  function readSlots() {
    const stored = readJson(STORAGE_KEY);
    if (!stored || stored.version !== 1 || !Array.isArray(stored.slots)) return Array(DEFAULT_SLOTS).fill('');
    return stored.slots.slice(0, MAX_SLOTS).map((id) => (typeof id === 'string' && ID_RE.test(id) ? id : ''));
  }
  let slots = readSlots();
  const writeSlots = () => writeJson(STORAGE_KEY, { version: 1, slots });

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

  function changed(detail) {
    renderLive();
    window.dispatchEvent(new CustomEvent('quick-templates:change', { detail: detail || {} }));
  }

  function apply(index) {
    if (index < 0 || index >= slots.length) return false;
    const id = slots[index];
    if (!id) { toast(t('quickTemplates.toast.empty', { n: index + 1 })); return false; }
    if (!window.LyricTemplates) { toast(t('quickTemplates.toast.notReady')); return false; }
    const result = window.LyricTemplates.select(id);
    if (result === 'unknown') { toast(t('quickTemplates.toast.unavailable', { name: templateName(id) }), 'error'); return false; }
    if (result === 'ok') toast(t('quickTemplates.toast.applied', { name: templateName(id) }));
    return true;
  }

  function setSlot(index, id) {
    if (index < 0 || index >= slots.length) return;
    slots[index] = id && availableIds().includes(id) ? id : '';
    writeSlots();
    changed();
  }

  function addSlot() {
    if (slots.length >= MAX_SLOTS) return false;
    slots.push('');
    writeSlots();
    changed({ added: slots.length });
    return true;
  }

  /** 移除第 index 個：後面的往前補；最後一個號碼消失，它的全域快捷鍵由 app-hotkeys.js 清掉。 */
  function removeSlot(index) {
    if (index < 0 || index >= slots.length) return false;
    const removedNumber = slots.length;
    slots.splice(index, 1);
    writeSlots();
    changed({ removedNumber });
    return true;
  }

  // ─── 記住每首歌的模板 ───
  function readMemory() {
    const stored = readJson(MEMORY_KEY);
    return {
      enabled: !!(stored && stored.enabled === true),
      base: stored && typeof stored.base === 'string' && ID_RE.test(stored.base) ? stored.base : '',
    };
  }
  let memory = readMemory();
  const writeMemory = () => writeJson(MEMORY_KEY, memory);
  let loadedTrackId = null;
  let loadedTemplate = null; // 這首記住的模板（伺服器確認過的值）

  function sharedPlaylist() {
    const state = window.AppShared && window.AppShared.state;
    return state && Array.isArray(state.playlist) ? state.playlist : [];
  }
  function setLocalMemory(trackId, template) {
    sharedPlaylist().forEach((entry) => { if (entry && entry.id === trackId) entry.lyricTemplate = template; });
    if (trackId === loadedTrackId) loadedTemplate = template;
    renderMemory();
  }
  function sendMemory(trackId, template) {
    if (typeof SocketClient === 'undefined') return;
    SocketClient.sendWithCallback('track-template:set', { trackId, template }, (result) => {
      if (!result || !result.ok) return;
      setLocalMemory(result.trackId, result.template);
    });
  }

  function applyAuto(id) {
    if (!id || !window.LyricTemplates || !availableIds().includes(id)) return false;
    return window.LyricTemplates.select(id, { user: false }) !== 'unknown';
  }

  window.addEventListener('track:loaded', (event) => {
    const track = event.detail && event.detail.track;
    loadedTrackId = track && track.id ? String(track.id) : null;
    loadedTemplate = track && typeof track.lyricTemplate === 'string' ? track.lyricTemplate : null;
    if (memory.enabled) {
      // 記住的模板被下架了就退回預設模板，不擋播放
      if (!applyAuto(loadedTemplate)) applyAuto(memory.base);
    }
    renderMemory();
  });

  // 使用者自己切了模板（快捷槽位、模板畫廊都算）：有載入歌曲就記給這首，沒有就當成新的預設模板
  window.addEventListener('lyric-template:selected', (event) => {
    if (!memory.enabled) return;
    const template = event.detail && event.detail.template;
    if (!template) return;
    if (loadedTrackId) {
      if (template !== loadedTemplate) sendMemory(loadedTrackId, template);
    } else if (template !== memory.base) {
      memory.base = template;
      writeMemory();
      renderMemory();
    }
  });

  if (typeof SocketClient !== 'undefined') {
    SocketClient.on('track-template:update', (data) => {
      if (!data || typeof data.trackId !== 'string') return;
      setLocalMemory(data.trackId, typeof data.template === 'string' ? data.template : null);
    });
  }

  // ─── 直播頁「歌詞模板」區 ───
  const liveList = document.getElementById('quick-template-list');
  const liveCurrent = document.getElementById('quick-template-current');
  const memoryToggle = document.getElementById('template-memory-toggle');
  const memoryDetail = document.getElementById('template-memory-detail');
  const memoryBase = document.getElementById('template-memory-base');
  const memorySong = document.getElementById('template-memory-song');
  const memorySongName = document.getElementById('template-memory-song-name');
  const memoryClear = document.getElementById('template-memory-clear');

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
    renderMemory();
  }

  function renderMemory() {
    if (memoryToggle) memoryToggle.checked = memory.enabled;
    if (memoryDetail) memoryDetail.hidden = !memory.enabled;
    if (memoryBase) {
      const ids = availableIds();
      const keep = memoryBase.value;
      memoryBase.textContent = '';
      for (const id of ids) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = templateName(id);
        memoryBase.appendChild(option);
      }
      memoryBase.value = ids.includes(memory.base) ? memory.base : (ids.includes(keep) ? keep : (ids[0] || ''));
    }
    const remembered = memory.enabled && loadedTrackId && loadedTemplate;
    if (memorySong) memorySong.hidden = !remembered;
    if (memorySongName && remembered) memorySongName.textContent = templateName(loadedTemplate);
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

  memoryToggle?.addEventListener('change', () => {
    memory.enabled = memoryToggle.checked;
    // 剛開啟時，以目前的模板當預設模板，畫面不會突然換掉
    if (memory.enabled && !memory.base) memory.base = currentTemplate() || '';
    writeMemory();
    renderMemory();
  });
  memoryBase?.addEventListener('change', () => {
    memory.base = memoryBase.value;
    writeMemory();
    // 目前這首沒記住模板時，畫面跟著預設模板換
    if (memory.enabled && !loadedTemplate) applyAuto(memory.base);
  });
  memoryClear?.addEventListener('click', () => {
    if (!loadedTrackId) return;
    sendMemory(loadedTrackId, null);
    setLocalMemory(loadedTrackId, null);
    applyAuto(memory.base);
  });

  function openSettings() {
    // 快捷鍵卡片在「設定」頁（data-nav=general）
    const nav = document.querySelector('[data-nav="general"]');
    if (nav) nav.click();
    setTimeout(() => {
      // 設定頁分類顯示時，要先切到「快捷鍵」分類，卡片才看得到
      if (window.SettingsSlim && typeof window.SettingsSlim.select === 'function') window.SettingsSlim.select('hotkeys');
      // 槽位在快捷鍵表格最底下：直接捲到第一個沒指定的槽位（都指定了就第一個）並給焦點
      const selects = Array.from(document.querySelectorAll('.hotkey-template-select'));
      const select = selects.find((el) => !el.value) || selects[0];
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
    MAX_SLOTS,
    apply,
    setSlot,
    addSlot,
    removeSlot,
    count: () => slots.length,
    slots: () => slots.slice(),
    availableIds,
    templateName,
  });
})();
