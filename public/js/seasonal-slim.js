/**
 * Elitesand Pro — 節慶活動頁整理（2026-10-10，萬聖節／中秋共用）
 *
 * 原本十張卡片丟進自動排列的格線，高矮不一、擠成一團。這裡把既有卡片（id 與事件都不動）
 * 依「什麼時候用」分成分頁，每頁固定兩欄：
 *   現場：新增斗內＋進度｜斗內紀錄，抽獎（萬聖節）
 *   OBS 畫面：預覽＋大小｜來源網址（主網址常駐，分開擺放的收進摺疊）
 *   觀眾互動：聊天指令與搗蛋｜糖果排行（萬聖節）
 *   活動設定：標題、目標、門檻｜面板配色、回顧卡
 * 少用的選項（抽獎規則）收進摺疊；跟欄位標籤重複的說明文字藏起來。
 */
(function () {
  'use strict';

  const t = (key) => (window.I18n ? window.I18n.t(key) : key);
  const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
  const i18n = (node, key) => { node.dataset.i18n = key; node.textContent = t(key); return node; };

  function slim(prefix) {
    const view = document.querySelector(`.view[data-view="${prefix}"]`);
    if (!view || view.dataset.seslim) return;
    const card = (name) => view.querySelector(`[aria-labelledby="${prefix}-${name}-title"]`);
    const byId = (suffix) => document.getElementById(`${prefix}-${suffix}`);
    view.dataset.seslim = '1';
    view.classList.add('seslim');

    // ── 說明文字：欄位標籤／placeholder 已經講清楚的就不再重複 ──
    [view.querySelector(`[data-i18n="${prefix}.addHint"]`), view.querySelector(`[data-i18n="${prefix}.scaleHint"]`)]
      .forEach((node) => { if (node) node.hidden = true; });

    // ── OBS 網址：主網址常駐，其餘收進「分開擺放」 ──
    const urlList = card('preview')?.querySelector('.obs-url-list');
    if (urlList && urlList.children.length > 1) {
      const more = el('details', 'seslim-more');
      const sum = i18n(el('summary'), 'seasonalSlim.splitUrls');
      const box = el('div', 'obs-url-list');
      Array.from(urlList.children).slice(1).forEach((row) => box.appendChild(row));
      more.append(sum, box);
      urlList.after(more);
    }

    // ── 抽獎：只留「抽一位」與結果，規則收進摺疊 ──
    const raffle = card('raffle');
    if (raffle) {
      const opts = el('details', 'seslim-more');
      opts.appendChild(i18n(el('summary'), 'seasonalSlim.raffleOptions'));
      const pool = byId('raffle-pool')?.closest('.row-gap-10');
      if (pool) opts.appendChild(pool);
      raffle.querySelectorAll(':scope > .switch-row').forEach((row) => opts.appendChild(row));
      const clear = byId('raffle-clear');
      if (clear) { const wrap = el('div', 'seasonal-list-actions mt-10'); wrap.appendChild(clear); opts.appendChild(wrap); }
      const actions = byId('raffle-draw')?.closest('.seasonal-list-actions');
      raffle.insertBefore(opts, actions?.nextSibling || null);
    }

    // ── 分頁 ──
    const theme = view.querySelector('.seasonal-theme-row');
    const tabs = [
      // 萬聖節的大鍋卡（比例＋熬煮）放直播中、藥水菜單放活動設定；中秋沒有這兩張，filter 掉。
      { id: 'live', key: 'seasonalSlim.tab.live', left: [card('add'), card('cauldron'), card('raffle')], right: [card('list')] },
      { id: 'obs', key: 'seasonalSlim.tab.obs', left: [card('preview')], right: [] },
      { id: 'fx', key: 'seasonalSlim.tab.fx', left: [card('fx')], right: [card('board')] },
      { id: 'setup', key: 'seasonalSlim.tab.setup', left: [card('config'), card('potions')], right: [theme, card('recap')] },
    ].filter((tab) => [...tab.left, ...tab.right].some(Boolean));

    // OBS 頁：網址那半張卡獨立成右欄，預覽留左欄（同一張卡拆兩張，id 不變）
    const preview = card('preview');
    if (preview) {
      const urls = el('section', 'card seslim-urls');
      const head = i18n(el('p', 'eyebrow m-0'), 'seasonalSlim.urlsTitle');
      urls.appendChild(head);
      let node = preview.querySelector('.obs-url-list');
      while (node) { const next = node.nextElementSibling; urls.appendChild(node); node = next; }
      tabs.find((tab) => tab.id === 'obs')?.right.push(urls);
    }

    const bar = el('div', 'segmented seslim-tabs');
    bar.setAttribute('role', 'tablist');
    const panes = new Map();
    tabs.forEach((tab) => {
      const btn = i18n(el('button'), tab.key);
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.dataset.tab = tab.id;
      bar.appendChild(btn);
      const pane = el('div', 'seslim-pane');
      pane.setAttribute('role', 'tabpanel');
      const left = el('div', 'seslim-col');
      const right = el('div', 'seslim-col');
      tab.left.filter(Boolean).forEach((n) => left.appendChild(n));
      tab.right.filter(Boolean).forEach((n) => right.appendChild(n));
      pane.append(left);
      if (right.children.length) pane.append(right); else pane.classList.add('seslim-pane--single');
      panes.set(tab.id, { btn, pane });
    });

    const notice = byId('end-notice');
    const anchor = notice ? notice.nextSibling : view.firstChild;
    view.insertBefore(bar, anchor);
    panes.forEach(({ pane }) => view.appendChild(pane));

    const storeKey = `elite-seasonal-tab-${prefix}`;
    const show = (id) => {
      panes.forEach(({ btn, pane }, key) => {
        const on = key === id;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
        pane.hidden = !on;
      });
      try { localStorage.setItem(storeKey, id); } catch (_) { /* 只是記住分頁，失敗無妨 */ }
    };
    bar.addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-tab]');
      if (btn) show(btn.dataset.tab);
    });
    let initial = tabs[0]?.id;
    try { const saved = localStorage.getItem(storeKey); if (panes.has(saved)) initial = saved; } catch (_) { /* 沿用預設 */ }
    show(initial);

    // 導覽或其他模組要聚光頁內元素時，先切到它所在的分頁
    document.addEventListener('ui:reveal', (event) => {
      const target = event.detail?.target;
      if (!target || !view.contains(target)) return;
      panes.forEach(({ pane }, id) => { if (pane.contains(target)) show(id); });
    });
  }

  ['halloween', 'moon'].forEach(slim);
})();
