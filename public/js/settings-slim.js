/**
 * Elitesand Pro — 設定頁瘦身（2026-09-28 改版 v3，docs/UIUX-REDESIGN.md）
 *
 * 原本 13 張卡片分三欄一次攤開、畫面上約 3,500 字說明，找一個設定要整頁掃。
 * 現在：左邊「搜尋＋分類」，右邊一次只看一類；「總覽」只列出狀態與需要處理的事。
 * 每張卡片的說明文字預設收起，按卡片標題旁的「?」才展開。
 *
 * 跟畫面頁一樣只搬動既有卡片（id、事件、狀態更新全部照舊），不重建任何控制項。
 */
(function () {
  'use strict';

  const T = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const byId = (id) => document.getElementById(id);

  function el(tag, cls, attrs = {}) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    });
    return node;
  }
  function i18nText(node, key) {
    node.dataset.i18n = key;
    node.textContent = T(key);
    return node;
  }

  const CATEGORIES = [
    { key: 'overview' },
    { key: 'connect', cards: ['obs-url-card', 'obs-ws-card', 'lan-info-card', 'twitch-card'] },
    { key: 'audio', cards: ['dual-audio-card'] },
    { key: 'hotkeys', cards: ['hotkeys-card'] },
    { key: 'components', cards: ['ytdlp-card', 'app-update-card', 'announcement-card'] },
    { key: 'privacy', cards: ['pin-settings-card', 'usage-telemetry-card', 'lyric-offset-sync-card'] },
    { key: 'troubleshoot', cards: ['error-history-card', 'feedback-card'] },
  ];

  // 總覽：每列鏡像一個既有狀態元素；state 決定點的顏色，'todo' 會算進「需要處理」
  const textOf = (id) => (byId(id)?.textContent || '').trim().replace(/\s+/g, ' ');
  const isShownEl = (id) => { const n = byId(id); return !!n && !n.hidden && !n.closest('[hidden]'); };
  const OVERVIEW = [
    { key: 'obs', card: 'obs-ws-card', status: () => textOf('obs-ws-status'),
      state: () => (byId('obs-ws-status')?.classList.contains('ok') ? 'ok' : 'idle') },
    { key: 'phone', card: 'lan-info-card', status: () => textOf('controller-pairing-status'), state: () => 'idle' },
    { key: 'twitch', card: 'twitch-card', status: () => textOf('twitch-status'),
      state: () => (byId('twitch-status')?.classList.contains('ok') ? 'ok' : 'idle') },
    { key: 'ffmpeg', card: 'ytdlp-card', status: () => textOf('ffmpeg-status'),
      state: () => (byId('ffmpeg-status')?.classList.contains('ok') ? 'ok' : 'todo') },
    { key: 'ai', card: 'ytdlp-card', status: () => textOf('ai-separation-status'),
      state: () => (byId('ai-separation-status')?.classList.contains('ok') ? 'ok' : 'idle') },
    { key: 'update', card: 'app-update-card', status: () => textOf('app-update-status'),
      state: () => (isShownEl('app-update-download-btn') || isShownEl('app-update-restart-btn') ? 'todo' : 'ok') },
    { key: 'pin', card: 'pin-settings-card',
      status: () => (isShownEl('pin-status-on') ? T('settingsSlim.row.pinOn') : T('settingsSlim.row.pinOff')),
      state: () => (isShownEl('pin-status-on') ? 'ok' : 'todo') },
    { key: 'errors', card: 'error-history-card',
      status: () => { const n = Number(textOf('error-history-count')) || 0; return n ? T('settingsSlim.row.errorsN', { n }) : T('settingsSlim.row.errorsNone'); },
      state: () => ((Number(textOf('error-history-count')) || 0) ? 'todo' : 'ok') },
  ];

  // 卡片標題：<details> 的 summary 或 section 的第一個 .eyebrow
  const headOf = (card) => card.querySelector(':scope > summary, :scope > .eyebrow, :scope > .card-head');

  function slimSettings() {
    const view = document.querySelector('.view[data-view="general"]');
    const columns = view && view.querySelector('.general-settings-columns');
    if (!view || !columns) return;

    const shell = el('div', 'sslim');
    const rail = el('nav', 'sslim-rail', { 'aria-label': T('settingsSlim.railLabel'), 'data-i18n-aria-label': 'settingsSlim.railLabel' });
    const search = el('input', 'input sslim-search', { type: 'search', 'data-i18n-placeholder': 'settingsSlim.searchPlaceholder', 'data-i18n-aria-label': 'settingsSlim.searchLabel' });
    search.placeholder = T('settingsSlim.searchPlaceholder');
    search.setAttribute('aria-label', T('settingsSlim.searchLabel'));
    const catList = el('div', 'sslim-cats');
    rail.append(el('div', 'sslim-search-wrap'), catList);
    rail.firstChild.appendChild(search);

    const main = el('section', 'sslim-main');
    const heading = el('h2', 'sslim-heading');
    const sub = el('p', 'sslim-sub');
    const overview = el('div', 'sslim-overview');
    const cardsBox = el('div', 'sslim-cards');
    const empty = el('p', 'sslim-empty');
    i18nText(empty, 'settingsSlim.noResult');
    main.append(heading, sub, overview, cardsBox, empty);
    shell.append(rail, main);

    // 卡片搬進單欄容器；原本的三欄外框退休
    const cardCat = new Map();
    CATEGORIES.forEach((cat) => (cat.cards || []).forEach((id) => {
      const card = byId(id);
      if (!card) return;
      cardCat.set(card, cat.key);
      cardsBox.appendChild(card);
    }));
    // 沒列在分類裡的卡片（之後新增的）不能消失：歸到「疑難排解」前面的一般區
    Array.from(columns.querySelectorAll('.general-settings-col > *')).forEach((card) => {
      if (cardCat.has(card)) return;
      cardCat.set(card, card.dataset.sslimCat || 'troubleshoot');
      cardsBox.appendChild(card);
    });
    columns.hidden = true;
    columns.classList.add('sslim-retired');
    view.prepend(shell);
    view.classList.add('has-sslim');

    // 「?」：展開這張卡片自己的說明；說明文字平常由 CSS 收起
    cardCat.forEach((_cat, card) => {
      const head = headOf(card);
      if (!head) return;
      const help = el('button', 'sslim-help-btn', { type: 'button', 'aria-expanded': 'false', 'data-i18n-aria-label': 'settingsSlim.help' });
      help.setAttribute('aria-label', T('settingsSlim.help'));
      help.textContent = '?';
      help.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const open = card.classList.toggle('sslim-help-open');
        help.setAttribute('aria-expanded', String(open));
      });
      head.appendChild(help);
    });

    // 總覽列
    const rows = OVERVIEW.filter((row) => byId(row.card)).map((row) => {
      const node = el('div', 'sslim-row');
      const dot = el('span', 'sslim-dot');
      const text = el('span', 'sslim-row-text');
      const name = i18nText(el('span', 'sslim-row-name'), `settingsSlim.row.${row.key}`);
      const status = el('span', 'sslim-row-status');
      text.append(name, status);
      const go = i18nText(el('button', 'btn btn-sm btn-ghost sslim-row-go', { type: 'button' }), 'settingsSlim.open');
      go.addEventListener('click', () => { select(cardCat.get(byId(row.card))); focusCard(byId(row.card)); });
      node.append(dot, text, go);
      return { row, node, dot, status };
    });

    let current = 'overview';
    let query = '';
    const catButtons = CATEGORIES.map((cat) => {
      const btn = el('button', 'sslim-cat', { type: 'button' });
      const label = i18nText(el('span', 'sslim-cat-name'), `settingsSlim.cat.${cat.key}`);
      const badge = el('span', 'sslim-badge');
      btn.append(label, badge);
      btn.addEventListener('click', () => { search.value = ''; query = ''; select(cat.key); });
      catList.appendChild(btn);
      return { cat, btn, badge };
    });

    function focusCard(card) {
      if (!card) return;
      if (card.tagName === 'DETAILS') card.open = true;
      card.scrollIntoView({ block: 'start', behavior: 'smooth' });
      card.classList.add('sslim-flash');
      setTimeout(() => card.classList.remove('sslim-flash'), 1200);
    }

    let openOnEnter = false;
    function select(key) {
      current = key;
      openOnEnter = true;
      render();
      openOnEnter = false;
    }

    function render() {
      const q = query.trim().toLowerCase();
      // 總覽列狀態
      const todo = [];
      rows.forEach((r) => {
        const state = r.row.state();
        const text = r.row.status() || '—';
        if (r.status.textContent !== text) r.status.textContent = text;
        if (r.dot.dataset.state !== state) r.dot.dataset.state = state;
        if (state === 'todo') todo.push(r);
      });
      // 分類徽章：需要處理的件數
      catButtons.forEach(({ cat, btn, badge }) => {
        const n = cat.key === 'overview' ? todo.length
          : todo.filter((r) => cardCat.get(byId(r.row.card)) === cat.key).length;
        const label = n ? String(n) : '';
        if (badge.textContent !== label) badge.textContent = label;
        badge.hidden = !n;
        const on = !q && cat.key === current;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-current', on ? 'true' : 'false');
      });

      let visibleCards = 0;
      if (q) {
        heading.textContent = T('settingsSlim.searchHeading', { q: query.trim() });
        overview.hidden = true;
        cardCat.forEach((cat, card) => {
          const hit = haystack(card).includes(q);
          card.classList.toggle('sslim-off', !hit);
          if (hit) { visibleCards += 1; if (card.tagName === 'DETAILS') card.open = true; }
        });
        sub.textContent = T('settingsSlim.resultCount', { n: visibleCards });
      } else if (current === 'overview') {
        heading.textContent = T('settingsSlim.cat.overview');
        sub.textContent = todo.length ? T('settingsSlim.needsN', { n: todo.length }) : T('settingsSlim.allGood');
        overview.hidden = false;
        // 需要處理的排前面
        [...todo, ...rows.filter((r) => !todo.includes(r))].forEach((r) => overview.appendChild(r.node));
        cardCat.forEach((_cat, card) => card.classList.add('sslim-off'));
      } else {
        heading.textContent = T(`settingsSlim.cat.${current}`);
        sub.textContent = '';
        overview.hidden = true;
        cardCat.forEach((cat, card) => {
          const on = cat === current;
          card.classList.toggle('sslim-off', !on);
          // 進到分類就是要看這類設定：收合卡片直接展開（只在切換分類時做一次，之後使用者可自己收）
          if (on && openOnEnter && card.tagName === 'DETAILS') card.open = true;
          if (on) visibleCards += 1;
        });
      }
      sub.classList.toggle('is-todo', !q && current === 'overview' && todo.length > 0);
      sub.hidden = !sub.textContent;
      empty.hidden = !(q && visibleCards === 0);
    }

    // 搜尋比對五種語言：用英文介面打中文也找得到（反之亦然）。換語言時重建。
    let haystacks = new Map();
    const haystack = (card) => {
      if (!haystacks.has(card)) {
        const text = window.I18n && typeof window.I18n.searchText === 'function' ? window.I18n.searchText(card) : card.textContent;
        haystacks.set(card, text.toLowerCase());
      }
      return haystacks.get(card);
    };
    window.addEventListener('i18n:change', () => { haystacks = new Map(); });
    search.addEventListener('input', () => { haystacks = new Map(); query = search.value; render(); });

    // 其他地方（導覽、跳轉連結）要指到某張卡片時：切到它的分類，清掉搜尋
    document.addEventListener('ui:reveal', (event) => {
      const target = event.detail && event.detail.target;
      const card = target && Array.from(cardCat.keys()).find((c) => c === target || c.contains(target));
      if (!card) return;
      const cat = cardCat.get(card);
      if (!query && current === cat) return;
      search.value = '';
      query = '';
      select(cat);
    });

    // 狀態文字由各卡片自己的程式更新：盯著卡片的文字與顯示狀態，重算總覽
    let timer = 0;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(render, 60); };
    new MutationObserver(schedule).observe(cardsBox, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    window.addEventListener('i18n:change', schedule);
    render();
    window.SettingsSlim = { select, render };
  }

  slimSettings();
})();
