/**
 * Elitesand Pro — 畫面頁瘦身（2026-09-28 改版 v3，docs/UIUX-REDESIGN.md）
 *
 * 使用者回饋：歌詞／歌單設定「太多、太亂、沒辦法一目了然」。問題不在外觀，而在所有設定同一層攤開，
 * 分類又是照程式（版面／可讀性／外觀／進階）而不是照「想解決的問題」。
 *
 * 這支腳本在載入時把「既有的」設定元素搬進三層容器，不重建任何控制項：
 *   1 選一個樣子（樣式縮圖＋我的預設）
 *   2 快速調整（所有樣式共通的幾項）
 *   3 哪裡不對？（依問題分組的收合區塊，一次只開一個）
 * 元素的 id、data-ls-control、事件綁定與「依樣式顯示／隱藏」全部照舊，所以設定邏輯、即時儲存與
 * OBS 同步（鐵則 4、5、13）都不受影響。畫面上的說明段落改成滑鼠停留提示（文字保留在 title）。
 */
(function () {
  'use strict';

  const T = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
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

  function i18nNode(tag, cls, key) {
    const node = el(tag, cls, { 'data-i18n': key });
    node.textContent = T(key);
    return node;
  }

  // 說明段落 → 滑鼠停留提示：把文字掛到最近的標籤上，段落本身在瘦身容器內用 CSS 隱藏
  function hintsToTooltips(root) {
    root.querySelectorAll('.field-hint, .switch-row .sub').forEach((hint) => {
      const text = hint.textContent.trim();
      if (!text) return;
      const host = hint.closest('.switch-row')?.querySelector('.label')
        || hint.closest('.field')?.querySelector('label')
        || hint.previousElementSibling;
      if (host && !host.title) host.title = text;
    });
  }

  // 一個「哪裡不對？」分組：<details> 收合，一次只開一個
  function intent(key, parts) {
    const box = el('details', 'oslim-intent');
    box.dataset.intent = key;
    const summary = el('summary', 'oslim-intent-summary');
    const q = i18nNode('span', 'oslim-intent-q', `outputSlim.${key}.q`);
    const hint = i18nNode('span', 'oslim-intent-hint', `outputSlim.${key}.hint`);
    summary.append(q, hint);
    const body = el('div', 'oslim-intent-body');
    parts.filter(Boolean).forEach((node) => {
      node.classList?.remove('settings-workspace__section-hidden');
      // 從詳細設定搬出來的 <details class="card card-collapse">：在分組裡直接展開、去掉卡片外框
      if (node.tagName === 'DETAILS') { node.open = true; node.classList.add('oslim-embedded'); }
      body.appendChild(node);
    });
    box.append(summary, body);
    box.addEventListener('toggle', () => {
      if (!box.open) return;
      box.parentElement?.querySelectorAll('.oslim-intent[open]').forEach((other) => { if (other !== box) other.open = false; });
    });
    return box;
  }

  // 分組裡的東西全被「依樣式隱藏」時，整組藏起來，避免點開是空的
  function isShown(node) {
    if (node.hidden) return false;
    if (node.tagName === 'SUMMARY') return false;
    return getComputedStyle(node).display !== 'none';
  }
  function refreshIntents(panel) {
    panel.querySelectorAll('.oslim-intent').forEach((box) => {
      const body = box.querySelector('.oslim-intent-body');
      const any = Array.from(body.children).some(isShown);
      if (box.hidden !== !any) box.hidden = !any;
    });
  }

  // 樣式縮圖：先露 6 個，其餘收在「全部 N 種」；目前選的那個永遠看得到
  function collapsibleGallery(picker, cardSelector, toggleHost) {
    const btn = el('button', 'btn btn-sm btn-ghost oslim-more', { type: 'button' });
    let expanded = false;
    function render() {
      const cards = Array.from(picker.querySelectorAll(cardSelector)).filter((c) => !c.hidden);
      cards.forEach((card, i) => {
        const active = card.classList.contains('active') || card.classList.contains('is-selected') || card.getAttribute('aria-checked') === 'true';
        const fold = !expanded && i >= 6 && !active;
        if (card.classList.contains('oslim-folded') !== fold) card.classList.toggle('oslim-folded', fold);
      });
      const label = expanded ? T('outputSlim.showFewer') : T('outputSlim.showAll', { n: cards.length });
      if (btn.textContent !== label) btn.textContent = label;
      if (btn.hidden !== (cards.length <= 6)) btn.hidden = cards.length <= 6;
    }
    btn.addEventListener('click', () => { expanded = !expanded; render(); });
    picker.addEventListener('click', () => setTimeout(render, 0));
    toggleHost.appendChild(btn);
    render();
    window.addEventListener('i18n:change', render);
    return render;
  }

  function section(numberKey, titleKey) {
    const sec = el('section', 'oslim-section');
    const head = el('div', 'oslim-section-head');
    head.appendChild(i18nNode('span', 'oslim-section-title', titleKey));
    sec.appendChild(head);
    return { sec, head };
  }

  // ═══ 歌詞畫面 ═══
  function slimLyrics() {
    const view = $('.view[data-view="settings"]');
    const stageBar = view && $('.settings-preview-bar', view);
    const body = view && $('.settings-body', view);
    const picker = $('#template-buttons');
    if (!view || !stageBar || !body || !picker) return;

    const shell = el('div', 'oslim');
    const stage = el('div', 'oslim-stage');
    const panel = el('aside', 'oslim-panel', { 'aria-label': T('outputSlim.panelLabel'), 'data-i18n-aria-label': 'outputSlim.panelLabel' });
    stage.appendChild(stageBar);
    // 先把外殼掛進文件：後面的 getElementById 才找得到已搬進新容器的元素
    shell.append(stage, panel);
    view.prepend(shell);

    // 1 選一個樣子
    const s1 = section(1, 'outputSlim.pick');
    const s2 = section(2, 'outputSlim.quick');
    const s3 = section(3, 'outputSlim.wrong');
    panel.append(s1.sec, s2.sec, s3.sec);
    const presets = $('.lyric-preset-section');
    const tplHeading = $('.lyric-template-heading');
    s1.sec.appendChild(picker);
    if (tplHeading) { tplHeading.classList.add('oslim-hidden'); }
    const galleryFoot = el('div', 'oslim-section-foot');
    s1.sec.appendChild(galleryFoot);
    const renderGallery = collapsibleGallery(picker, '.lyric-template-card', galleryFoot);
    if (presets) {
      presets.classList.add('oslim-presets');
      galleryFoot.appendChild(presets);
      // 摘要只留「儲存外觀」，長說明改滑鼠提示
      const sum = presets.querySelector('summary');
      const hint = sum && sum.querySelector('[data-i18n="lyricStyle.saveAppearanceHint"]');
      if (hint) sum.title = hint.textContent.trim();
    }
    // 萬聖咒字的七種效果是這個模板的主角，不能收在「哪裡不對？」裡讓人找不到：
    // 直接放在樣式縮圖正下方（只有選到萬聖咒字時才出現，lyric-extras.js 照舊切 hidden）
    const spellbookField = $('#spellbook-field');
    if (spellbookField) {
      spellbookField.classList.add('oslim-featured');
      s1.sec.appendChild(spellbookField);
    }

    // 2 快速調整
    [
      $('#particle-fontsize-field'),
      $('#ls-color')?.closest('.field'),
      $('#font-family-fields'),
      // 燈牌模板不用一般字體欄，改用自己的字體選單（lyric-extras.js 依模板切 hidden）
      $('#lightboard-font-field'),
      $('#classic-only-display-mode'),
      $('#lyric-pos-field'),
    ].filter(Boolean).forEach((node) => s2.sec.appendChild(node));

    // 快速調整只留主字體：英文／數字字體、字重等細項移到「其他顯示選項」，
    // 並跟著原本的 #font-family-fields 一起被「依樣式隱藏」（舊程式只切換那個容器）
    const fontBox = $('#font-family-fields');
    const fontExtra = el('div', 'oslim-font-extra');
    if (fontBox) {
      // 英文字體等欄位是字型模組之後才動態插進來的：持續把「第一欄以外」的欄位搬過去
      const moveExtras = () => { Array.from(fontBox.children).slice(1).forEach((child) => fontExtra.appendChild(child)); };
      const syncFontExtra = () => { if (fontExtra.hidden !== fontBox.hidden) fontExtra.hidden = fontBox.hidden; };
      new MutationObserver(() => { moveExtras(); syncFontExtra(); }).observe(fontBox, { childList: true, attributes: true, attributeFilter: ['hidden'] });
      moveExtras();
      syncFontExtra();
    }

    // 3 哪裡不對？
    const byId = (id) => document.getElementById(id);
    const workspaceCard = (group) => document.querySelector(`#display-advanced-modal [data-settings-workspace-group="${group}"], .settings-workspace details[data-settings-workspace-group="${group}"][data-lyrics-search]`);
    const templateOnlyIds = [
      'columnflow-variant-field', 'columnflow-entrance-field', 'columnflow-placement-field', 'columnflow-max-lines-field',
      'jizura-placement-field', 'jizura-motion-field', 'lightboard-scroll-field',
      'particle-orient-field', 'particle-entrance-field', 'particle-effects-field',
      'paperstrip-orient-field', 'paperstrip-color-field', 'ktv-text-field',
      'typewriter-colors-field', 'tw-sticker-field',
    ];
    const displaySwitches = ['metronome-toggle', 'ls-traditional', 'ls-progress-bar']
      .map((id) => byId(id)?.closest('.switch-row')).filter(Boolean);
    const intents = [
      intent('readability', [byId('classic-only-advanced-effect-card')]),
      intent('blocking', [byId('lyric-pos-fine-wrap'), workspaceCard('layout'), byId('stage-safe-margin-field'), byId('columnflow-safe-margin-field'), byId('typewriter-padding-field')]),
      intent('motion', [byId('style-preset-field'), byId('style-tune-field'), byId('intensity-field')]),
      intent('templateOnly', templateOnlyIds.map(byId)),
      intent('more', [...displaySwitches, fontExtra, byId('particle-fontweight-field'), byId('romaji-xieyin-card'), workspaceCard('appearance advanced'), byId('ls-reset')]),
    ];
    intents.forEach((box) => s3.sec.appendChild(box));

    // 保險：舊容器裡還留著控制項的欄位（之後新增、忘了分組的）一律收進「其他顯示選項」，
    // 不能因為舊容器被藏起來就讓設定消失（2026-10-04 實測漏了字重與燈牌字體）
    const moreBody = intents[4].querySelector('.oslim-intent-body');
    body.querySelectorAll('.field, .switch-row, details.card').forEach((node) => {
      if (!body.contains(node) || node.parentElement.closest('.field, .switch-row, details.card')) return;
      if (node.id === 'setlist-theme-field') return;
      if (node.querySelector('input:not([type="hidden"]), select, textarea')) moreBody.appendChild(node);
    });

    // 位置微調要在「擋到臉或字幕」裡；其他模組初始化時可能把它重新插回 #lyric-pos-field，
    // 所以盯著那個容器，一出現就搬回來（冪等，不管重建幾次結果都一樣）
    const blockingBody = intents[1].querySelector('.oslim-intent-body');
    const posField = byId('lyric-pos-field');
    const keepFine = () => {
      const fine = byId('lyric-pos-fine-wrap');
      if (fine && fine.parentElement !== blockingBody) blockingBody.prepend(fine);
    };
    if (posField) new MutationObserver(keepFine).observe(posField, { childList: true, subtree: true });
    keepFine();

    body.hidden = true;
    body.classList.add('oslim-retired');
    view.classList.add('has-oslim');
    // 原本的「詳細外觀設定」視窗內容已全部搬到「哪裡不對？」，入口卡片收起
    $('#btn-display-advanced')?.closest('.preview-detail-card')?.setAttribute('hidden', '');

    hintsToTooltips(panel);

    // 「{目前樣式}專屬」：標題跟著目前樣式；沒有專屬設定時整組藏起來
    const templateOnly = intents[3];
    function refresh() {
      const active = picker.querySelector('.lyric-template-card.active strong');
      const q = templateOnly.querySelector('.oslim-intent-q');
      const title = T('outputSlim.templateOnly.q', { name: active ? active.textContent.trim() : '' });
      if (q && q.textContent !== title) q.textContent = title;
      refreshIntents(panel);
      renderGallery();
    }
    let timer = 0;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 30); };
    new MutationObserver(schedule).observe(panel, { subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
    window.addEventListener('i18n:change', schedule);
    document.addEventListener('view:change', schedule);
    refresh();
  }

  // ═══ 歌單畫面 ═══
  // 原本：左欄模板＋右欄「快速調整」一長串（依版型顯示／隱藏）＋「詳細設定」視窗 10 張卡。
  // 現在：跟歌詞畫面同一套三層；元素照舊由 app-setlist-panel.js 依版型切 hidden，這裡只負責擺放。
  function slimSetlist() {
    const view = $('.view[data-view="setlist"]');
    const split = view && $('.setlist-split', view);
    const stageBar = split && $(':scope > .setlist-preview-bar', split);
    const main = split && $(':scope > .setlist-main', split);
    const layoutField = $('.setlist-layout-field', view || document);
    const collapse = document.getElementById('setlist-style-collapse');
    const modal = document.getElementById('setlist-advanced-modal');
    if (!view || !stageBar || !main || !layoutField || !collapse || !modal) return;

    const byId = (id) => document.getElementById(id);
    const fieldOf = (id) => byId(id)?.closest('.field, .switch-row');
    const cards = Array.from(modal.querySelectorAll('.mw-settings > details.card-collapse'));
    const cardBy = (summaryInput) => cards.find((d) => d.querySelector(summaryInput)) || null;

    const shell = el('div', 'oslim oslim--setlist');
    const stage = el('div', 'oslim-stage');
    const panel = el('aside', 'oslim-panel', { 'aria-label': T('outputSlim.setlistPanelLabel'), 'data-i18n-aria-label': 'outputSlim.setlistPanelLabel' });
    stage.appendChild(stageBar);
    shell.append(stage, panel);
    split.parentElement.insertBefore(shell, split);

    const s1 = section(1, 'outputSlim.pickLayout');
    const s2 = section(2, 'outputSlim.quick');
    const s3 = section(3, 'outputSlim.wrong');
    panel.append(s1.sec, s2.sec, s3.sec);

    // 1 選一個版型：三組縮圖攤平成一格，分組小標與尺寸說明收起
    s1.sec.appendChild(layoutField);
    layoutField.querySelectorAll('.setlist-layout-group-title, .setlist-layout-heading, #setlist-sizing-hint')
      .forEach((n) => n.classList.add('oslim-hidden'));
    const galleryFoot = el('div', 'oslim-section-foot');
    s1.sec.appendChild(galleryFoot);
    const renderGallery = collapsibleGallery(layoutField, '.setlist-layout-card', galleryFoot);
    const presets = collapse.querySelector('.setlist-quick-presets');
    if (presets) { presets.classList.add('oslim-presets'); galleryFoot.appendChild(presets); }

    // 2 快速調整：大小、配色、歌手名字、唱過的歌
    [
      fieldOf('sls-scale'), fieldOf('sls-scene-scale'),
      fieldOf('sls-accent'), fieldOf('sls-note-now-color'),
      fieldOf('sls-show-artist'),
      fieldOf('sls-done-opacity'), fieldOf('sls-strikethrough'),
    ].filter(Boolean).forEach((node) => s2.sec.appendChild(node));

    // 3 哪裡不對？
    const intents = [
      intent('sl.readability', [fieldOf('sls-readability-guard'), fieldOf('sls-card-color'), fieldOf('sls-text-theme'),
        cardBy('#sls-text-sec'), cardBy('#sls-blur')]),
      intent('sl.sizeLayout', [fieldOf('sls-size-now'), cardBy('#sls-font-display'), cardBy('#sls-radius'), cardBy('#sls-line-height')]),
      intent('sl.labels', [fieldOf('sls-show-upcoming'), cardBy('#sls-show-number'), cardBy('#sls-label-now')]),
      intent('templateOnly', [fieldOf('sls-round-decor'), fieldOf('sls-flap-stops'), fieldOf('sls-glow-header'),
        cardBy('#sls-scene-x'), ...cards.filter((d) => d.getAttribute('data-sl-scope') === 'classic')]),
    ];
    // 其他：還沒被分走的卡片全部收這裡——寧可多一組，也不能讓哪個設定消失
    const used = new Set(intents.flatMap((box) => Array.from(box.querySelectorAll('.oslim-intent-body > *'))));
    intents.push(intent('sl.more', [...cards.filter((d) => !used.has(d)), byId('sls-reset')]));
    intents.forEach((box) => s3.sec.appendChild(box));

    main.hidden = true;
    main.classList.add('oslim-retired');
    stageBar.querySelector('.preview-detail-card')?.setAttribute('hidden', '');
    hintsToTooltips(panel);

    const templateOnly = intents[3];
    function refresh() {
      const active = layoutField.querySelector('.setlist-layout-card.is-selected strong, .setlist-layout-card[aria-checked="true"] strong');
      const q = templateOnly.querySelector('.oslim-intent-q');
      const title = T('outputSlim.templateOnly.q', { name: active ? active.textContent.trim() : '' });
      if (q && q.textContent !== title) q.textContent = title;
      refreshIntents(panel);
      renderGallery();
    }
    let timer = 0;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 30); };
    new MutationObserver(schedule).observe(panel, { subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'aria-checked'] });
    window.addEventListener('i18n:change', schedule);
    document.addEventListener('view:change', schedule);
    refresh();
  }

  slimLyrics();
  slimSetlist();
  window.OutputSlim = { refreshIntents };
})();
