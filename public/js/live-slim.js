/**
 * Elitesand Pro — 直播頁瘦身（2026-09-28 改版 v3，docs/UIUX-REDESIGN.md，原型 LiveSlim）
 *
 * 目標：開台時畫面上只剩「直播中每次都會用」的東西（原本約 143 個可見控制項）。
 *   頂欄：兩顆「未連線」膠囊＋兩顆網址按鈕 → 一顆「OBS ●」，點開才看網址；只有斷線時才顯示伺服器狀態
 *   加歌：YouTube／本機分頁＋連結／搜尋分頁 → 一個輸入框（貼連結＝匯入、打字＝搜尋）＋資料夾鈕
 *   清單：匯入／匯出／選取／清除全部／連續播放 → 「⋯」；搜尋與篩選 → 「⌕」；每列的編輯／移除 → 滑過才出現
 *   準備：三個編號步驟 → 一列狀態＋「換歌詞」；對時只留 對齊第一句／−0.1／偏移／+0.1，其餘進「⋯」
 *   點歌：兩個空箱子＋說明 → 沒有點歌時只剩一行
 *
 * 跟畫面頁一樣只搬動既有元素（id、事件照舊），不重建控制項；新手導覽發 ui:reveal 時會打開對應選單。
 */
(function () {
  'use strict';

  const T = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const byId = (id) => document.getElementById(id);
  const $ = (sel, root = document) => root.querySelector(sel);

  function el(tag, cls, attrs = {}) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    });
    return node;
  }
  function i18n(node, key, attr) {
    if (attr) { node.setAttribute(`data-i18n-${attr}`, key); node.setAttribute(attr, T(key)); }
    else { node.dataset.i18n = key; node.textContent = T(key); }
    return node;
  }
  const hide = (node) => node && node.classList.add('lslim-gone');

  // ── 彈出選單：既有按鈕原封搬進去；點外面／Esc 關閉 ──
  const menus = [];
  const reveals = [];
  function popover(btn, pop) {
    pop.hidden = true;
    const wrap = el('span', 'lslim-pop-wrap');
    wrap.append(btn, pop);
    btn.setAttribute('aria-expanded', 'false');
    const set = (open) => {
      pop.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) menus.forEach((m) => { if (m.pop !== pop) m.set(false); });
    };
    btn.addEventListener('click', (event) => { event.stopPropagation(); set(pop.hidden); });
    // 選單項目點完就收（勾選類保持開著，方便連續切）
    pop.addEventListener('click', (event) => {
      const item = event.target.closest('button');
      if (item && !item.closest('.lslim-keep-open')) setTimeout(() => set(false), 0);
    });
    menus.push({ btn, pop, wrap, set });
    return { wrap, set };
  }
  document.addEventListener('click', (event) => {
    menus.forEach((m) => { if (!m.pop.hidden && !m.wrap.contains(event.target)) m.set(false); });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    menus.forEach((m) => { if (!m.pop.hidden) { m.set(false); m.btn.focus(); } });
  });
  // 新手導覽要指到收在選單裡的東西：先打開那個選單
  document.addEventListener('ui:reveal', (event) => {
    const target = event.detail && event.detail.target;
    if (!target) return;
    menus.forEach((m) => { if (m.pop.contains(target) || target.contains(m.pop)) m.set(true); });
    reveals.forEach((fn) => fn(target));
  });

  function iconBtn(cls, labelKey, glyph) {
    const b = el('button', `lslim-ic ${cls}`, { type: 'button' });
    i18n(b, labelKey, 'aria-label');
    b.title = T(labelKey);
    b.setAttribute('data-i18n-title', labelKey);
    if (glyph instanceof Node) b.appendChild(glyph); else b.textContent = glyph;
    return b;
  }
  function svg(path) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '15'); s.setAttribute('height', '15');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path'); p.setAttribute('d', path); s.appendChild(p);
    return s;
  }

  // ═══ 頂欄 ═══
  function slimHeader() {
    const actions = $('.topnav-actions');
    const chips = $('.obs-source-status');
    const links = $('.topbar-obs-links');
    if (!actions || !chips) return;

    const btn = el('button', 'topnav-action lslim-obs', { type: 'button' });
    const dot = el('span', 'lslim-obs-dot');
    btn.append(dot, document.createTextNode('OBS'));
    i18n(btn, 'liveSlim.obsStatus', 'aria-label');
    const pop = el('div', 'lslim-pop lslim-obs-pop', { role: 'dialog' });
    i18n(pop, 'liveSlim.obsStatus', 'aria-label');
    const rows = [
      [byId('display-source-status'), byId('copy-obs-url-top')],
      [byId('setlist-source-status'), byId('copy-setlist-url-top')],
    ];
    rows.forEach(([pill, copy]) => {
      const row = el('div', 'lslim-obs-row');
      if (pill) row.appendChild(pill);
      if (copy) { copy.classList.add('btn', 'btn-sm'); row.appendChild(copy); }
      pop.appendChild(row);
    });
    const { wrap } = popover(btn, pop);
    wrap.classList.add('lslim-pop-wrap--end');
    actions.insertBefore(wrap, chips);
    chips.classList.add('lslim-gone');
    if (links) links.classList.add('lslim-gone');

    // 點的顏色：兩個來源都連上＝綠、一個＝琥珀、都沒有＝灰
    const pills = rows.map(([pill]) => pill).filter(Boolean);
    const sync = () => {
      const on = pills.filter((p) => !p.classList.contains('disconnected')).length;
      const state = on === pills.length ? 'ok' : (on ? 'part' : 'off');
      if (dot.dataset.state !== state) dot.dataset.state = state;
    };
    pills.forEach((p) => new MutationObserver(sync).observe(p, { attributes: true, attributeFilter: ['class'] }));
    sync();

    // 頁首那一列：沒有子分頁時只剩頁名，整列收掉（直播、歌曲庫）
    const topbar = $('.topbar');
    const subnav = byId('subnav');
    if (topbar && subnav) {
      const syncBar = () => topbar.classList.toggle('lslim-bare', subnav.hidden);
      new MutationObserver(syncBar).observe(subnav, { attributes: true, attributeFilter: ['hidden'] });
      syncBar();
    }
  }

  // ═══ 加歌 ═══
  const looksLikeUrl = (text) => /^(https?:\/\/|www\.|youtu\.?be|(m\.|music\.)?youtube\.com)/i.test(text.trim());

  function slimAdd() {
    const card = byId('music-source-card');
    const url = byId('yt-url');
    const fetchBtn = byId('yt-fetch-btn');
    const searchQuery = byId('youtube-search-query');
    const searchSubmit = byId('youtube-search-submit');
    const modeLink = byId('youtube-mode-link');
    const modeSearch = byId('youtube-mode-search');
    if (!card || !url || !fetchBtn) return;

    const row = el('div', 'lslim-add');
    const folder = iconBtn('lslim-add-file', 'liveSlim.addFile', svg('M3 7h6l2 2h10v10H3z'));
    folder.addEventListener('click', () => byId('file-input')?.click());
    row.append(url, fetchBtn, folder);
    card.prepend(row);
    card.classList.add('lslim-source');
    i18n(url, 'liveSlim.addPlaceholder', 'placeholder');
    url.setAttribute('data-i18n-aria-label', 'liveSlim.addPlaceholder');
    url.setAttribute('aria-label', T('liveSlim.addPlaceholder'));

    // 按鈕字跟著輸入內容：像網址＝匯入、其他＝搜尋（匯入進行中由原程式改成「處理中」，不去搶）
    const verb = () => {
      if (fetchBtn.disabled) return;
      const key = url.value.trim() && !looksLikeUrl(url.value) ? 'youtubeSearch.submit' : 'liveSlim.addVerb';
      if (fetchBtn.dataset.i18n !== key || fetchBtn.textContent !== T(key)) i18n(fetchBtn, key);
    };
    url.addEventListener('input', verb);
    // 原程式匯入結束會把字改回「匯入音訊」：啟用狀態下文字一被改就換回來
    new MutationObserver(() => { if (!fetchBtn.disabled) verb(); })
      .observe(fetchBtn, { attributes: true, attributeFilter: ['disabled'], childList: true, characterData: true, subtree: true });
    fetchBtn.classList.remove('w-full');
    verb();

    // 不像網址的文字改走「搜尋 YouTube」：攔在原本的匯入處理之前（capture）
    const routeToSearch = (event) => {
      const text = url.value.trim();
      if (!text || looksLikeUrl(text) || !searchQuery || !searchSubmit) {
        if (text && looksLikeUrl(text)) modeLink?.click();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      modeSearch?.click();
      searchQuery.value = text;
      searchSubmit.click();
      url.focus();
    };
    fetchBtn.addEventListener('click', routeToSearch, true);
    url.addEventListener('keydown', (event) => { if (event.key === 'Enter') routeToSearch(event); }, true);

    // 本機檔案：整個清單欄都能拖檔進來，轉交給原本的拖放區
    const dropZone = byId('drop-zone');
    const column = card.closest('.live-queue');
    if (dropZone && column) {
      const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
      column.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); column.classList.add('lslim-drop'); } });
      column.addEventListener('dragleave', (e) => { if (!column.contains(e.relatedTarget)) column.classList.remove('lslim-drop'); });
      column.addEventListener('drop', (e) => {
        column.classList.remove('lslim-drop');
        if (!hasFiles(e) || dropZone.contains(e.target)) return;
        e.preventDefault();
        dropZone.dispatchEvent(new DragEvent('drop', { dataTransfer: e.dataTransfer, bubbles: false, cancelable: true }));
      });
    }

    // 本機檔案上傳要幾秒：一丟進來就在清單尾端顯示「正在加入」，避免使用者以為沒成功又丟一次
    const scroll = $('.playlist-scroll');
    if (scroll) {
      const pending = new Map();
      const row = el('div', 'lslim-upload-row');
      row.hidden = true;
      const bar = el('span', 'lslim-upload-bar');
      const label = el('span', 'lslim-upload-label');
      row.append(bar, label);
      scroll.insertBefore(row, byId('work-center') || null);
      const sync = () => {
        const names = Array.from(pending.values()).flat();
        row.hidden = !names.length;
        if (!names.length) return;
        label.textContent = T('liveSlim.uploading', { count: names.length, name: names[0] });
        row.scrollIntoView({ block: 'nearest' });
      };
      let seq = 0;
      const ids = [];
      document.addEventListener('upload:start', (e) => { const id = ++seq; ids.push(id); pending.set(id, e.detail.names || []); sync(); });
      document.addEventListener('upload:end', () => { const id = ids.shift(); pending.delete(id); sync(); });
      window.addEventListener('i18n:change', sync);
    }

    // 「匯入後製作伴奏」是偏好設定，不是每次加歌都要看：搬到設定頁「音訊」
    const auto = $('.youtube-auto-separate', card);
    const cols = document.querySelectorAll('.general-settings-col');
    if (auto && cols.length) {
      const pref = el('section', 'card', { id: 'import-prefs-card', 'data-sslim-cat': 'audio' });
      pref.appendChild(i18n(el('p', 'eyebrow'), 'liveSlim.importPrefs'));
      pref.appendChild(auto);
      cols[0].appendChild(pref);
    }
  }

  // ═══ 播放清單 ═══
  function slimQueue() {
    const card = $('.playlist-card');
    const head = card && $('.playlist-head', card);
    const actions = head && $('.playlist-head-actions', head);
    const filterRow = card && $('.playlist-filter-row', card);
    if (!card || !head || !actions) return;
    card.classList.add('lslim-queue');

    const tools = el('span', 'lslim-head-tools');
    // ⌕：搜尋與篩選平常收起；有輸入或篩選時保持展開
    if (filterRow) {
      const search = iconBtn('lslim-search-btn', 'liveSlim.searchQueue', svg('M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4'));
      const filter = byId('playlist-filter');
      const mode = byId('playlist-filter-mode');
      const active = () => !!(filter?.value || (mode && mode.selectedIndex > 0));
      let open = false;
      const sync = () => {
        const show = open || active();
        filterRow.classList.toggle('lslim-gone', !show);
        byId('playlist-filter-result')?.classList.toggle('lslim-gone', !active());
        search.setAttribute('aria-expanded', String(show));
      };
      search.addEventListener('click', () => { open = !(open || active()); sync(); if (open) filter?.focus(); });
      filter?.addEventListener('input', sync);
      mode?.addEventListener('change', sync);
      byId('btn-playlist-filter-clear')?.addEventListener('click', () => setTimeout(sync, 0));
      reveals.push((target) => { if (filterRow.contains(target)) { open = true; sync(); } });
      sync();
      tools.appendChild(search);
    }

    // ⋯：匯入／匯出／選取／清除全部＋連續播放
    const more = iconBtn('lslim-more-btn', 'liveSlim.queueMenu', '⋯');
    const pop = el('div', 'lslim-pop lslim-menu', { role: 'menu' });
    actions.classList.add('lslim-menu-items');
    pop.appendChild(actions);
    const cont = byId('continuous-toggle')?.closest('.switch-row');
    if (cont) { cont.classList.add('lslim-menu-switch', 'lslim-keep-open'); pop.appendChild(cont); }
    const { wrap } = popover(more, pop);
    wrap.classList.add('lslim-pop-wrap--end');
    tools.appendChild(wrap);
    head.appendChild(tools);

    // 清單每列的「伴」格要跟著 AI 伴奏進度變（製作中／完成／失敗）；進度事件很密，合併成一次重畫
    if (window.AiSeparation && typeof window.AiSeparation.subscribe === 'function' && typeof AppShared.renderPlaylist === 'function') {
      let timer = 0;
      window.AiSeparation.subscribe(() => {
        clearTimeout(timer);
        timer = setTimeout(() => AppShared.renderPlaylist(), 400);
      }, { replay: false });
    }
  }

  // ═══ 準備區 ═══
  function slimPrep() {
    const prep = byId('live-prep');
    if (!prep) return;
    prep.classList.add('lslim-prep');
    const steps = prep.querySelectorAll('.live-prep-step');
    steps.forEach((step) => hide($('.live-prep-step-head', step)));

    // 一列狀態：音檔｜伴奏｜歌詞＋「換歌詞」
    const audioRow = $('.live-prep-audio', prep);
    const lyricsNote = byId('live-prep-lyrics-note');
    const picker = byId('btn-lyrics-picker');
    if (audioRow) {
      if (lyricsNote) { lyricsNote.classList.add('live-prep-pill'); audioRow.appendChild(lyricsNote); }
      const spacer = el('span', 'lslim-spacer');
      audioRow.appendChild(spacer);
      if (picker) { i18n(picker, 'liveSlim.changeLyrics'); audioRow.appendChild(picker); }
    }

    // 對時：對齊第一句｜−0.5 −0.1｜偏移｜+0.1 +0.5｜⋯（±0.5 使用者要常駐）
    const offsetRow = $('.offset-row', prep);
    const align = byId('offset-align');
    hide($('.lb-lyric-k', prep));
    hide(byId('live-prep-sync-note'));
    if (offsetRow) {
      // 上一列：對齊第一句＋⋯；下一列：−0.5 −0.1 偏移 +0.1 +0.5 歸零，靠左（窄視窗也不換行）
      const top = el('div', 'lslim-sync-top');
      if (align) top.append(align);
      top.append(el('span', 'lslim-spacer'));
      offsetRow.parentElement.insertBefore(top, offsetRow);
      // 「已對時」：給主播自己看的準備標記，清單上的「對」格跟著亮
      const confirm = el('button', 'btn btn-sm lslim-sync-confirm', { type: 'button', 'aria-pressed': 'false' });
      top.append(confirm);
      const prepTrack = () => {
        const idx = typeof AppShared.prepTargetIndex === 'function' ? AppShared.prepTargetIndex() : -1;
        return idx >= 0 && AppShared.state && AppShared.state.playlist ? AppShared.state.playlist[idx] : null;
      };
      const syncConfirm = () => {
        const track = prepTrack();
        confirm.hidden = !track;
        const on = !!(track && track.syncConfirmed);
        i18n(confirm, on ? 'liveSlim.syncConfirmed' : 'liveSlim.syncConfirm');
        confirm.setAttribute('aria-pressed', String(on));
        confirm.classList.toggle('is-on', on);
      };
      confirm.addEventListener('click', () => {
        const track = prepTrack();
        if (track && track.id) SocketClient.send('sync:confirm', { trackId: track.id, confirmed: !track.syncConfirmed });
      });
      document.addEventListener('sync:confirmed', syncConfirm);
      document.addEventListener('playlist:rendered', syncConfirm);
      window.addEventListener('i18n:change', syncConfirm);
      syncConfirm();
      const more = iconBtn('lslim-more-btn', 'liveSlim.syncMenu', '⋯');
      const pop = el('div', 'lslim-pop lslim-menu', { role: 'menu' });
      const items = el('div', 'lslim-menu-items');
      [byId('btn-lyrics-timeline'),
        byId('btn-paste-lyrics'), byId('btn-preview-sample-lyrics')]
        .filter(Boolean).forEach((b) => items.appendChild(b));
      const upload = el('button', 'btn btn-sm', { type: 'button' });
      i18n(upload, 'liveSlim.uploadLyrics');
      upload.addEventListener('click', () => byId('lyrics-file-input')?.click());
      items.appendChild(upload);
      pop.appendChild(items);
      const { wrap } = popover(more, pop);
      wrap.classList.add('lslim-pop-wrap--end');
      top.appendChild(wrap);
      hide(offsetRow.parentElement.querySelector(':scope > .field-hint'));
    }
    // 原本放「選擇來源／貼上／示範」那列已經空了
    prep.querySelectorAll('.lb-lyric-actions').forEach((row) => {
      if (!row.querySelector('button:not(.lslim-gone)')) hide(row);
    });
  }

  // ═══ 點歌 ═══
  function slimInbox() {
    const side = $('.live-side');
    const boxes = [byId('twitch-requests'), byId('public-request-pending')].filter(Boolean);
    if (!side || !boxes.length) return;
    const lists = boxes.map((box) => $('.twitch-requests-list', box));
    const inbox = el('section', 'card lslim-inbox');
    const head = el('div', 'lslim-inbox-head');
    head.append(i18n(el('span', 'lslim-inbox-title'), 'liveSlim.requests'));
    const empty = i18n(el('p', 'lslim-inbox-empty'), 'liveSlim.noRequests');
    inbox.append(head, empty);
    side.insertBefore(inbox, boxes[0]);
    boxes.forEach((box) => box.querySelectorAll('.playlist-head .sub').forEach(hide));

    const hasItems = (list) => !!list && Array.from(list.children).some((c) => !c.classList.contains('twitch-request-empty'));
    const sync = () => {
      const any = lists.map(hasItems);
      boxes.forEach((box, i) => box.classList.toggle('lslim-gone', !any[i]));
      const none = !any.some(Boolean);
      inbox.classList.toggle('lslim-gone', !none);
    };
    lists.forEach((list) => list && new MutationObserver(sync).observe(list, { childList: true }));
    sync();
  }

  slimHeader();
  slimAdd();
  slimQueue();
  slimPrep();
  slimInbox();
})();
