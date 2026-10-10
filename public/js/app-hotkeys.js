/**
 * 面板快捷鍵：監聽鍵盤、執行動作，以及「一般設定 → 快捷鍵」卡片的自訂按鍵。
 *
 * 動作一律走面板上現成的按鈕或 AppShared 函式，行為跟手動操作完全一樣
 * （播放/上下首/緊急隱藏都會照常同步到 OBS 與遙控器）。
 *
 * 設定存放：桌面版存在主程序（userData/hotkeys.json），全域那份也由主程序註冊；
 * 瀏覽器開的面板沒有全域快捷鍵，面板內那份存在 localStorage。
 */
(function () {
  'use strict';

  const H = window.Hotkeys;
  const shared = window.AppShared;
  if (!H || !shared) return;

  const shellApi = window.ElitesandShell && window.ElitesandShell.hotkeys;
  const t = (key, vars) => (window.I18n && typeof window.I18n.t === 'function' ? window.I18n.t(key, vars) : key);
  const toast = (message, type) => { if (typeof shared.showToast === 'function') shared.showToast(message, type); };
  const dom = shared.dom || {};

  let config = H.defaults();
  let results = {};
  let recording = null; // { id, scope, button }

  // ─── 動作 ───
  function click(el) { if (el && !el.disabled) el.click(); }

  const RUN = {
    'play-toggle': () => click(dom.btnPlay),
    next: () => click(dom.btnNext),
    prev: () => click(dom.btnPrev),
    'seek-forward': () => shared.seekBy && shared.seekBy(5),
    'seek-back': () => shared.seekBy && shared.seekBy(-5),
    'volume-up': () => showVolume(shared.adjustVolume && shared.adjustVolume(10)),
    'volume-down': () => showVolume(shared.adjustVolume && shared.adjustVolume(-10)),
    'mute-toggle': () => showVolume(shared.toggleMute && shared.toggleMute()),
    'pitch-up': () => click(document.getElementById('pitch-up')),
    'pitch-down': () => click(document.getElementById('pitch-down')),
    'pitch-reset': () => click(document.getElementById('pitch-reset')),
    'lyrics-hide': () => click(dom.btnEmergency),
    'align-first': () => click(document.getElementById('offset-align')),
    'offset-plus': () => click(dom.offsetPlus01),
    'offset-minus': () => click(dom.offsetMinus01),
    'offset-reset': () => click(dom.offsetReset),
    'restart-track': () => shared.seekBy && shared.seekBy(-1e9),
    'vocals-toggle': () => toggleVocals(),
    'metronome-toggle': () => click(dom.metronomeToggle),
    'show-help': () => openHelp(),
  };

  // 原唱人聲開關：只有開了 AI 人聲分離的歌才有人聲音量滑桿；跟音量一樣走滑桿的 input，
  // 所以會照常記住音量。關掉前的音量記在這裡，再按一次還原。
  let vocalsBeforeOff = null;
  function toggleVocals() {
    const row = document.getElementById('separation-vocals-row');
    const slider = document.getElementById('separation-vocals-volume');
    if (!slider || !row || row.hidden) { toast(t('hotkeys.toast.noVocals')); return; }
    const current = parseInt(slider.value, 10) || 0;
    const next = current > 0 ? 0 : (vocalsBeforeOff || 100);
    vocalsBeforeOff = current > 0 ? current : null;
    slider.value = String(next);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    toast(t(next > 0 ? 'hotkeys.toast.vocalsOn' : 'hotkeys.toast.vocalsOff'));
  }

  function showVolume(value) {
    if (typeof value === 'number') toast(t('hotkeys.toast.volume', { value }));
  }

  function run(id) {
    const fn = RUN[id];
    if (!fn) return false;
    try { fn(); } catch (error) { console.warn('[Hotkeys] action failed:', id, error); }
    return true;
  }

  // ─── 面板內：鍵盤監聽 ───
  // 面板的對話框是靠 hidden 屬性開關（modal-focus.js 也是這樣判斷）。
  function modalOpen() {
    return [...document.querySelectorAll('.modal, .tour-welcome-layer, dialog[open]')]
      .some((el) => !el.hidden && el.getClientRects().length > 0);
  }

  function findInApp(combo) {
    const id = H.ACTION_IDS.find((action) => config.inApp[action] === combo);
    if (!id) return null;
    // 同一個組合鍵也綁成全域快捷鍵時，按下去會由全域那邊執行一次，這裡不再重複。
    if (shellApi && results[id] === 'ok' && config.global[id] === combo) return null;
    return id;
  }

  document.addEventListener('keydown', (event) => {
    if (recording || event.defaultPrevented || event.isComposing) return;
    const combo = H.fromEvent(event);
    if (!combo) return;
    const parsed = H.parse(combo);
    const typing = H.isTypingTarget(event.target);
    // 正在打字時，只有帶 Ctrl/Alt/Win 的組合鍵有效；空白鍵、方括號這類單鍵要留給輸入框。
    if (typing && !(parsed.mods.has('Ctrl') || parsed.mods.has('Alt') || parsed.mods.has('Meta'))) return;
    if (modalOpen()) return;
    const id = findInApp(combo);
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat && !['seek-forward', 'seek-back', 'volume-up', 'volume-down', 'offset-plus', 'offset-minus', 'pitch-up', 'pitch-down'].includes(id)) return;
    run(id);
  }, true);

  // ─── 全域：主程序送來的動作 ───
  if (shellApi && typeof shellApi.onTrigger === 'function') {
    shellApi.onTrigger((id) => { if (H.ACTION_IDS.includes(id)) run(id); });
  }

  // ─── 設定讀寫 ───
  function readLocal() {
    try { return JSON.parse(localStorage.getItem(H.STORAGE_KEY) || 'null'); } catch (_) { return null; }
  }

  async function load() {
    if (shellApi) {
      try {
        const state = await shellApi.get();
        if (state && state.config) {
          config = H.normalize(state.config);
          results = state.results || {};
        } else {
          // 第一次用桌面版：把預設（含媒體鍵）交給主程序註冊。
          config = H.normalize(readLocal());
          await save();
        }
      } catch (error) {
        console.warn('[Hotkeys] desktop settings unavailable:', error);
        config = H.normalize(readLocal());
      }
    } else {
      config = H.normalize(readLocal());
    }
    render();
  }

  async function save() {
    try { localStorage.setItem(H.STORAGE_KEY, JSON.stringify(config)); } catch (_) { /* 無痕模式：只在這次有效 */ }
    if (!shellApi) return;
    try {
      const state = await shellApi.set({ config, accelerators: H.globalAccelerators(config) });
      results = (state && state.results) || {};
    } catch (error) {
      console.warn('[Hotkeys] desktop settings could not be saved:', error);
    }
  }

  // ─── 設定卡片 ───
  const table = document.getElementById('hotkeys-table');
  const resetBtn = document.getElementById('hotkeys-reset');
  const globalNote = document.getElementById('hotkeys-global-note');
  const errorLine = document.getElementById('hotkeys-error');

  function setError(message) {
    if (!errorLine) return;
    errorLine.textContent = message || '';
    errorLine.hidden = !message;
  }

  function keyButton(id, scope) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hotkey-key';
    button.dataset.action = id;
    button.dataset.scope = scope;
    const combo = config[scope][id];
    button.textContent = combo ? H.label(combo) : t('hotkeys.unset');
    button.classList.toggle('is-unset', !combo);
    if (scope === 'global') {
      if (!shellApi || H.isInAppOnly(id)) button.disabled = true;
      if (H.isInAppOnly(id)) { button.textContent = '—'; button.title = t('hotkeys.inAppOnly'); }
      else if (combo && results[id] === 'taken') {
        button.classList.add('is-taken');
        button.title = t('hotkeys.taken');
      }
    }
    return button;
  }

  function render() {
    if (!table) return;
    const body = table.tBodies[0] || table.createTBody();
    body.textContent = '';
    for (const id of H.ACTION_IDS) {
      const row = body.insertRow();
      const name = row.insertCell();
      name.textContent = t(`hotkeys.action.${id}`);
      for (const scope of H.SCOPES) row.insertCell().appendChild(keyButton(id, scope));
    }
    if (globalNote) globalNote.hidden = !!shellApi;
  }

  function stopRecording() {
    if (!recording) return;
    recording.button.classList.remove('is-recording');
    recording = null;
    document.removeEventListener('keydown', onRecordKey, true);
    render();
  }

  function onRecordKey(event) {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();
    const { id, scope } = recording;
    const noMods = !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
    if (noMods && event.code === 'Escape') { setError(''); stopRecording(); return; }
    if (noMods && (event.code === 'Backspace' || event.code === 'Delete')) {
      config[scope][id] = '';
      setError('');
      stopRecording();
      void save().then(render);
      return;
    }
    const combo = H.fromEvent(event);
    if (!combo) return; // 只按了修飾鍵：繼續等
    const problem = H.validate(combo, scope);
    if (problem) { setError(t(`hotkeys.error.${problem}`)); return; }
    const other = H.conflict(config, scope, combo, id);
    if (other) { setError(t('hotkeys.error.conflict', { action: t(`hotkeys.action.${other}`) })); return; }
    config[scope][id] = combo;
    setError('');
    stopRecording();
    void save().then(render);
  }

  if (table) {
    table.addEventListener('click', (event) => {
      const button = event.target.closest('.hotkey-key');
      if (!button || button.disabled) return;
      if (recording) stopRecording();
      const target = table.querySelector(`.hotkey-key[data-action="${button.dataset.action}"][data-scope="${button.dataset.scope}"]`);
      if (!target) return;
      recording = { id: target.dataset.action, scope: target.dataset.scope, button: target };
      target.classList.add('is-recording');
      target.textContent = t('hotkeys.recording');
      setError('');
      document.addEventListener('keydown', onRecordKey, true);
    });
    table.addEventListener('focusout', (event) => {
      if (recording && event.target === recording.button) stopRecording();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      stopRecording();
      config = H.defaults();
      setError('');
      await save();
      render();
      toast(t('hotkeys.resetDone'), 'success');
    });
  }

  // ─── 快捷鍵一覽（預設 ?）───
  let help = null;
  function buildHelp() {
    const modal = document.createElement('div');
    modal.id = 'hotkeys-help-modal';
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'hotkeys-help-title');
    modal.hidden = true;
    modal.innerHTML = '<div class="modal-card hotkeys-help-card" role="document"><div class="modal-head"><h3 id="hotkeys-help-title"></h3>'
      + '<button type="button" class="btn btn-sm btn-ghost hotkeys-help-close"></button></div>'
      + '<div class="modal-body"><dl class="hotkeys-help-list"></dl><p class="field-hint hotkeys-help-foot"></p></div></div>';
    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target.closest('.hotkeys-help-close')) closeHelp();
    });
    modal.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeHelp(); }
    });
    document.body.appendChild(modal);
    return modal;
  }
  function fillHelp() {
    help.querySelector('#hotkeys-help-title').textContent = t('hotkeys.helpTitle');
    help.querySelector('.hotkeys-help-close').textContent = t('hotkeys.helpClose');
    help.querySelector('.hotkeys-help-foot').textContent = t('hotkeys.helpFoot');
    const list = help.querySelector('.hotkeys-help-list');
    list.textContent = '';
    for (const id of H.ACTION_IDS) {
      const keys = [config.inApp[id], config.global[id]].filter(Boolean).map(H.label);
      if (!keys.length) continue;
      const dt = document.createElement('dt');
      dt.textContent = t(`hotkeys.action.${id}`);
      const dd = document.createElement('dd');
      for (const label of [...new Set(keys)]) {
        const kbd = document.createElement('kbd');
        kbd.textContent = label;
        dd.appendChild(kbd);
      }
      list.append(dt, dd);
    }
  }
  function openHelp() {
    if (!help) help = buildHelp();
    fillHelp();
    help.hidden = false;
    help.querySelector('.hotkeys-help-close').focus();
  }
  function closeHelp() {
    if (help) help.hidden = true;
  }

  window.addEventListener('i18n:change', () => { if (!recording) render(); if (help && !help.hidden) fillHelp(); });

  window.AppHotkeys = Object.freeze({ run, getConfig: () => H.normalize(config) });
  void load();
})();
