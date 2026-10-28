/**
 * 「匯入後」偏好：製作伴奏（AI 分離）＋自動對時＋練唱音高
 *
 * - 加歌輸入框正下方一行小字顯示目前設定（「匯入後：不處理／製作伴奏／製作伴奏＋自動對時」），
 *   點開就能切換；設定頁「音訊 → YouTube 匯入」保留同一組開關，兩邊同步。
 *   （使用者回報：開關被搬到設定頁後找不到，而且重開程式會變回關閉。）
 * - 自動對時、練唱音高都要靠分離出的人聲：開任一個會一起開製作伴奏，關製作伴奏會一起關掉它們。
 * - 這是本機面板的操作偏好（匯入在面板端排隊執行），存在 localStorage；不是歌詞／歌單設定（鐵則 4 不適用）。
 * - 製作伴奏真正的旗標仍是原本的 #youtube-auto-separate（app-youtube-import.js 讀它），這裡負責同步它。
 */
(function () {
  'use strict';

  const original = document.getElementById('youtube-auto-separate');
  if (!original) return;

  const KEY = 'elitesand.importPrefs';
  const T = (k, v) => (window.I18n ? window.I18n.t(k, v) : k);
  let prefs = { separate: false, sync: false, practice: false };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved === 'object') {
      const separate = saved.separate === true;
      prefs = { separate, sync: separate && saved.sync === true, practice: separate && saved.practice === true };
    }
  } catch (_) { /* 讀不到就用預設（都關） */ }

  const controls = []; // { sep, sync, practice } checkbox 組，每個出現的位置一組
  let summary = null; // 摘要文字的 span（summary 本身還要放 NEW 標記，不能整個覆寫）

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (_) { /* 無痕或封鎖儲存時只在這次有效 */ }
  }

  function render() {
    original.checked = prefs.separate;
    for (const c of controls) {
      if (c.sep && c.sep !== original) c.sep.checked = prefs.separate;
      if (c.sync) c.sync.checked = prefs.sync;
      if (c.practice) c.practice.checked = prefs.practice;
    }
    if (summary) {
      const steps = [prefs.separate && 'importPrefs.separate', prefs.sync && 'importPrefs.autoSync', prefs.practice && 'importPrefs.practice']
        .filter(Boolean).map((key) => T(key));
      summary.textContent = steps.length ? T('importPrefs.summary', { steps: steps.join(T('importPrefs.joiner')) }) : T('importPrefs.summaryNone');
    }
  }

  // 開任何一個都要先確認分離元件已安裝；沒裝會跳原本的安裝視窗，取消就維持關閉
  async function ensureComponents() {
    try {
      return !!(await window.AiSeparation?.ensureReady());
    } catch (error) {
      AppShared?.showToast?.(T('import.separation.prepareFailed', { message: error.message }), 'error');
      return false;
    }
  }

  async function set(next) {
    const wantsSeparation = next.separate || next.sync || next.practice;
    if (wantsSeparation && !prefs.separate && !await ensureComponents()) { render(); return; }
    prefs = { separate: !!wantsSeparation, sync: !!next.sync && !!wantsSeparation, practice: !!next.practice && !!wantsSeparation };
    save();
    render();
  }

  function option(labelKey, hintKey, checked, className = 'youtube-auto-separate') {
    const label = document.createElement('label');
    label.className = className;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    const text = document.createElement('span');
    const strong = document.createElement('strong');
    strong.setAttribute('data-i18n', labelKey);
    strong.textContent = T(labelKey);
    const small = document.createElement('small');
    small.setAttribute('data-i18n', hintKey);
    small.textContent = T(hintKey);
    text.append(strong, small);
    label.append(input, text);
    return { label, input };
  }

  // 原本的開關（不論在匯入區還是被搬到設定頁）：接手它的 change，並在旁邊補上自動對時
  const keep = (separate) => ({ separate, sync: separate && prefs.sync, practice: separate && prefs.practice });
  original.addEventListener('change', () => { set(keep(original.checked)); });
  const originalLabel = original.closest('label');
  const settingsSync = option('importPrefs.autoSyncSetting', 'importPrefs.autoSyncHint', prefs.sync);
  settingsSync.input.addEventListener('change', () => set({ ...prefs, sync: settingsSync.input.checked }));
  settingsSync.label.dataset.newFeature = 'auto-sync';
  originalLabel?.after(settingsSync.label);
  const settingsPractice = option('importPrefs.practiceSetting', 'importPrefs.practiceHint', prefs.practice);
  settingsPractice.input.addEventListener('change', () => set({ ...prefs, practice: settingsPractice.input.checked }));
  settingsPractice.label.dataset.newFeature = 'import-practice';
  settingsSync.label.after(settingsPractice.label);
  controls.push({ sep: original, sync: settingsSync.input, practice: settingsPractice.input });

  // 加歌輸入框下方的快捷：一行目前狀態，點開兩個開關
  const addRow = document.querySelector('.lslim-add');
  if (addRow) {
    const box = document.createElement('details');
    box.className = 'import-prefs-quick';
    const summaryEl = document.createElement('summary');
    summaryEl.dataset.newFeature = 'import-prefs';
    summary = document.createElement('span');
    summaryEl.append(summary);
    const body = document.createElement('div');
    body.className = 'import-prefs-quick-body';
    const sep = option('importPrefs.separate', 'youtubeSearch.autoSeparateHint', prefs.separate, 'import-prefs-option');
    const sync = option('importPrefs.autoSync', 'importPrefs.autoSyncHint', prefs.sync, 'import-prefs-option');
    const practice = option('importPrefs.practice', 'importPrefs.practiceHint', prefs.practice, 'import-prefs-option');
    sep.input.addEventListener('change', () => set(keep(sep.input.checked)));
    sync.input.addEventListener('change', () => set({ ...prefs, sync: sync.input.checked }));
    practice.input.addEventListener('change', () => set({ ...prefs, practice: practice.input.checked }));
    body.append(sep.label, sync.label, practice.label);
    sync.label.dataset.newFeature = 'auto-sync';
    practice.label.dataset.newFeature = 'import-practice';
    box.append(summaryEl, body);
    addRow.after(box);
    controls.push({ sep: sep.input, sync: sync.input, practice: practice.input });
  }

  window.addEventListener('i18n:change', render);
  render();

  window.ImportPrefs = Object.freeze({ get: () => ({ ...prefs }) });
})();
