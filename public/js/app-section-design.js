/**
 * 段落設計頁（實驗性分支，feat/section-aware-lyrics）
 *
 * 「段落分析」目前是空的——自動判斷主歌／副歌的模型還在獨立研究階段，尚未有正式資料流可以接。
 * 「段落搭配」是這裡真正能測的東西：讓使用者選「哪個段落用哪個模板」，透過既有的
 * lyric-settings:update 管道存到 sectionAwareEnabled / sectionTemplateMap 兩個欄位，
 * server 端的 sanitizeJsonObject 是通用 JSON 消毒（不是欄位白名單），這兩個新欄位不需要
 * 改任何 server 程式碼就會正常合併、持久化、廣播給 /display。
 *
 * 段落資料本身還是手動測試用（display.js 的 SECTION_TEST_DATA，只掛了一首測試曲），
 * 這裡不重造一份，只負責「使用者要怎麼搭配模板」這一半。
 */
(function () {
  'use strict';
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);

  // 段落標籤跟 display.js 的 SECTION_LABEL_ALIAS 對齊（start→intro、end→outro 已經
  // 在那邊併掉，這裡只需要暴露使用者看得懂、也調整得到的 7 種）。
  const SECTION_LABELS = ['intro', 'verse', 'pre_chorus', 'chorus', 'bridge', 'post_chorus', 'outro'];
  const FOLLOW_VALUE = '__follow__';

  const enableToggle = document.getElementById('section-aware-enable');
  const mapContainer = document.getElementById('section-template-map');
  if (!enableToggle || !mapContainer) return; // 這個 view 不存在（舊版面板/測試環境）就整支不動作

  function templateOptions() {
    // 單一事實來源：歌詞設定頁本來就有的模板卡片，不在這裡重複維護一份清單。
    const cards = document.querySelectorAll('#template-buttons .lyric-template-card:not([hidden])');
    return Array.from(cards).map((card) => ({
      id: card.dataset.template,
      label: card.querySelector('strong')?.textContent || card.dataset.template,
    }));
  }

  function labelText(section) {
    return t(`sections.label.${section}`, null) || section;
  }

  let currentMap = {};
  let currentEnabled = false;
  let suppressChange = false; // 收到伺服器狀態時重繪 UI，避免立刻觸發自己的 change handler 又送一次

  function renderRows() {
    const options = templateOptions();
    mapContainer.innerHTML = '';
    SECTION_LABELS.forEach((section) => {
      const row = document.createElement('div');
      row.className = 'section-map-row';
      const label = document.createElement('span');
      label.className = 'section-map-label';
      label.textContent = labelText(section);
      const select = document.createElement('select');
      select.className = 'input';
      select.dataset.section = section;
      const followOpt = document.createElement('option');
      followOpt.value = FOLLOW_VALUE;
      followOpt.textContent = t('sections.followCurrent', null) || '跟隨目前模板';
      select.appendChild(followOpt);
      options.forEach((opt) => {
        const o = document.createElement('option');
        o.value = opt.id;
        o.textContent = opt.label;
        select.appendChild(o);
      });
      select.value = currentMap[section] || FOLLOW_VALUE;
      select.addEventListener('change', () => {
        if (suppressChange) return;
        currentMap[section] = select.value;
        save();
      });
      row.appendChild(label);
      row.appendChild(select);
      mapContainer.appendChild(row);
    });
  }

  function save() {
    if (typeof SocketClient === 'undefined' || !SocketClient.sendWithCallback) return;
    SocketClient.sendWithCallback('lyric-settings:update', {
      sectionAwareEnabled: currentEnabled,
      sectionTemplateMap: currentMap,
    }, () => { /* 存檔結果不特別提示，跟其他細節設定一致，靜默即可 */ });
  }

  enableToggle.addEventListener('change', () => {
    if (suppressChange) return;
    currentEnabled = enableToggle.checked;
    save();
  });

  function applyFromServer(settings) {
    if (!settings || typeof settings !== 'object') return;
    suppressChange = true;
    currentEnabled = !!settings.sectionAwareEnabled;
    currentMap = (settings.sectionTemplateMap && typeof settings.sectionTemplateMap === 'object')
      ? { ...settings.sectionTemplateMap } : {};
    enableToggle.checked = currentEnabled;
    renderRows();
    suppressChange = false;
  }

  if (typeof SocketClient !== 'undefined') {
    // 即時變更（自己或其他面板分頁改設定）走 lyric-settings:update；
    // 連線當下的初始值是整包 state:sync 帶的 state.lyricSettings，兩個都要接，
    // 只接前者的話重新整理面板會看到剛存的值瞬間跳回預設（跟 lyric-extras.js 的
    // adoptServerSettings 是同一個坑）。
    SocketClient.on('lyric-settings:update', applyFromServer);
    SocketClient.on('state:sync', (state) => applyFromServer(state && state.lyricSettings));
  }
  // 模板卡片是動態的（drift 目前 hidden），視圖第一次被打開時再抓一次選項用最新清單重繪。
  document.addEventListener('view:change', (e) => {
    if (e.detail && e.detail.view === 'sections') renderRows();
  });

  renderRows(); // 先用預設（全部跟隨目前模板）畫一次，等 lyric-settings:update 進來再覆蓋
})();
