/**
 * Setlist OBS 疊加頁前端 — 多版型(layout)架構
 *
 * 同一套 socket 資料（已唱 past / 現在 current / 接下來 upcoming）驅動多種版型：
 *   classic（毛玻璃三段，支援 theme/style）
 *   simple / timeline / diagonal / constellation（v2，全幅 16:9 舞台）
 *   terminal / billboard / cards（清單型 variants）
 * 版型由 ?layout= 初始、socket setlist:layout 即時切換。
 */
(function () {
  'use strict';

  const rootEl = document.getElementById('setlist-root');

  // 目前資料模型（normalize 後）與版型
  let model = { active: false, startedAt: null, past: [], current: null, upcoming: [] };
  let layoutId = 'classic';

  // ─── 共用工具（去重：現在統一在 shared-utils.js） ───
  const { escapeHtml } = SharedUtils;
  // 目前套用的時間格式（由 applyStyle 更新）；'mmss' 預設 / 'hmmss' 帶小時 / 'none' 不顯示
  let curTimeFormat = 'mmss';
  let curStyle = {};
  function fmtOffset(ms) {
    if (curTimeFormat === 'none') return '';
    const t = Math.floor((ms || 0) / 1000);
    const s = t % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
    const p = (n) => String(n).padStart(2, '0');
    if (curTimeFormat === 'hmmss') return `${h}:${p(m)}:${p(s)}`;
    return `${p(Math.floor(t / 60))}:${p(s)}`;
  }
  function hexToRgba(hex, a) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '');
    if (!m) return 'transparent';
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function keyOf(s) { return (s && (s.title || '')) + '|' + (s && (s.artist || '')); }

  // ─── 簡轉繁（opencc-js cn→tw）：與 karaoke.js 同一套轉換邏輯，套用在歌名/歌手名上。
  // 這裡是獨立頁面（歌單 OBS 來源），有自己的 opencc-cn2t.js 載入與轉換快取，不共用 karaoke.js 的實例。
  let s2tEnabled = true; // 預設開啟；實際值以伺服器同步的 lyricSettings.convertTraditional 為準
  let _s2tConv = null;
  function getS2T() {
    if (_s2tConv) return _s2tConv;
    try {
      if (typeof OpenCC !== 'undefined' && OpenCC.Converter) _s2tConv = OpenCC.Converter({ from: 'cn', to: 'tw' });
    } catch (e) { _s2tConv = null; }
    return _s2tConv;
  }
  function s2t(str) {
    if (!s2tEnabled || !str) return str;
    const conv = getS2T();
    if (!conv) return str;
    try { return conv(str); } catch (e) { return str; }
  }

  // socket 資料 → 統一模型
  function normalize(data) {
    data = data || {};
    const songs = Array.isArray(data.songs) ? data.songs : [];
    const upcoming = Array.isArray(data.upcoming) ? data.upcoming : [];
    // 「正在唱」＝目前有 current track，且它已被記錄成 songs 最後一筆——用 id 精確比對，
    // 不用播放/暫停狀態推斷。暫停時 data.current.playing 會是 false，但歌曲並沒有唱完，
    // 不該因此被誤判成「已唱」讓 Now Playing 消失（之前的寫法：session 未開台 + 暫停時，
    // 兩個判斷式都不成立，current 掉回 null、整首歌被吞進 past，就是這個 bug）。
    const last = songs.length ? songs[songs.length - 1] : null;
    const lastIsCurrent = !!(data.current && last && last.id != null && last.id === data.current.id);
    let current = null, past = songs;
    if (lastIsCurrent) { current = last; past = songs.slice(0, -1); }
    else if (data.current) { current = data.current; past = songs; }
    const pastMapped = past.map((s) => ({ title: s2t(s.title || ''), artist: s2t(s.artist || ''), offset: s.offset, key: keyOf(s) }));
    return {
      active: !!data.active,
      startedAt: data.startedAt || null,
      showTime: pastMapped.some((s) => (s.offset || 0) > 0), // 時間全 0（未開台）就不顯示時間欄
      past: pastMapped,
      current: current ? { title: s2t(current.title || ''), artist: s2t(current.artist || ''), key: keyOf(current) } : null,
      upcoming: upcoming.map((s) => ({ title: s2t(s.title || ''), artist: s2t(s.artist || ''), key: keyOf(s) })),
    };
  }

  // 攤平成有序清單 + current 索引（給有「視窗/位移」概念的版型用）
  function flat() {
    const arr = [];
    model.past.forEach((s) => arr.push({ ...s, state: 'done' }));
    let cur = -1;
    if (model.current) { cur = arr.length; arr.push({ ...model.current, state: 'now' }); }
    model.upcoming.forEach((s) => arr.push({ ...s, state: 'wait' }));
    arr.forEach((it, i) => { it.n = String(i + 1).padStart(2, '0'); });
    // 沒有正在播放時，把「接下來第一首」當視覺中心（不高亮）
    const center = cur >= 0 ? cur : Math.min(model.past.length, Math.max(0, arr.length - 1));
    return { arr, cur, center };
  }

  // 場景版已唱/未唱透明度係數：以 schema 預設值（done 35% / wait 55%）為基準 1.0。
  // 場景版的淡出是 JS 依距離排程的階梯值，這裡把使用者設定當「相對倍率」乘上去——
  // 預設值＝外觀完全不變；拉高更清楚、拉低更淡（最終值 clamp 到 0~1）。
  function sceneFadeFactors() {
    const fDone = Math.max(0, (Number(curStyle.doneOpacity ?? 35)) / 35);
    const fWait = Math.max(0, (Number(curStyle.waitOpacity ?? 55)) / 55);
    return { fDone, fWait };
  }
  function sceneFade(base, state, f) {
    if (state === 'now') return base;
    return Math.min(1, base * (state === 'done' ? f.fDone : f.fWait));
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  // ═══════════════════════════════════════════
  // classic：毛玻璃三段（支援 theme / style）
  // ═══════════════════════════════════════════
  function applyTheme(t) { document.documentElement.dataset.theme = t || 'glass'; }

  // 完整外觀套用：把伺服器的 setlistStyle（全欄位）映射到 CSS 變數 / data-attr。
  // 同一組變數 classic 與場景版共用（場景版再透過 --es-* 別名取用），故一次套用所有版型同步更新。
  // 通用套用：把 schema 裡「單一欄位 → 單一 CSS 變數 / data-attr」的欄位自動套用。
  // 多欄位合成一個輸出（如 accent 衍生 4 個變數、cardColor+cardOpacity 合成一個 rgba）
  // 的欄位標了 `composite`，這裡略過，改由 applyStyle 下面對應的 composite 區塊手動處理
  // ——新增一般數值/顏色/開關類欄位時，只要 schema 有寫 cssVar/dataAttr 就會自動生效，
  // 不需要再回來改這個函式。
  function applyGenericFields(s, root, r) {
    const schema = window.SetlistStyleSchema;
    if (!schema) return;
    schema.FIELDS.forEach((f) => {
      const v = s[f.key];
      if (v == null || f.composite) return;
      if (f.cssVar) {
        const fmt = schema.FORMATS[f.cssFormat || f.format];
        r.setProperty(f.cssVar, f.cssTransform ? f.cssTransform(v) : fmt ? fmt.toCss(v) : String(v));
      }
      if (f.dataAttr) {
        if (f.type === 'boolean') root.toggleAttribute(f.dataAttr, f.invert ? v === false : v === true);
        else root.setAttribute(f.dataAttr, v);
      }
    });
  }

  function applyStyle(s) {
    if (!s || typeof s !== 'object') return;
    const root = document.documentElement;
    const r = root.style;
    const has = (k) => s[k] != null;
    const num = (k, d) => (has(k) ? Number(s[k]) : d);

    applyGenericFields(s, root, r);

    // ── composite：多欄位合成的 CSS 變數（不在通用套用範圍內，schema 標了 composite）──
    // 背板/襯底：bgOpacity 0=透明（場景版看得到背後角色）；同時餵 classic 與場景
    const bgOp = num('bgOpacity', 0) / 100;
    const scrim = bgOp > 0 ? hexToRgba(s.bgColor || '#000000', bgOp) : 'transparent';
    r.setProperty('--sl-user-bg', scrim);
    r.setProperty('--sl-stage-bg', scrim);
    // 文字顏色覆蓋（空＝沿用 textPrimary）。用獨立 --sl-txt-ov，不碰主題變數。
    if (typeof s.textColor === 'string' && s.textColor) {
      r.setProperty('--sl-txt-ov', s.textColor);
      r.setProperty('--sl-title-color', s.textColor); r.setProperty('--sl-rowtitle-color', s.textColor);
    } else {
      r.removeProperty('--sl-txt-ov');
      r.removeProperty('--sl-title-color'); r.removeProperty('--sl-rowtitle-color');
    }
    const parts = [];
    const sh = num('shadowStrength', 0);
    if (sh > 0) parts.push(`0 2px ${sh}px ${s.shadowColor || '#000000'}`);
    const gl = num('glowStrength', 0);
    if (gl > 0) parts.push(`0 0 ${gl}px ${s.glowColor || '#ffd6a5'}`, `0 0 ${gl * 2}px ${s.glowColor || '#ffd6a5'}`);
    r.setProperty('--sl-user-text-shadow', parts.length ? parts.join(', ') : '0 0 0 transparent');
    const sw = num('strokeWidth', 0);
    r.setProperty('--sl-stroke-w', sw > 0 ? `${sw}px` : '0px');
    r.setProperty('--sl-stroke-c', sw > 0 ? (s.strokeColor || '#000000') : 'transparent');

    if (s.accent) {
      r.setProperty('--sl-acc', s.accent);
      r.setProperty('--sl-acc-g', hexToRgba(s.accent, 0.4));
      r.setProperty('--sl-acc-dim', hexToRgba(s.accent, 0.08));
      r.setProperty('--sl-acc-bd', hexToRgba(s.accent, 0.3));
    }
    if (s.textPrimary) {
      r.setProperty('--sl-txt', s.textPrimary);
      r.setProperty('--sl-txt2', hexToRgba(s.textPrimary, num('textSec', 45) / 100));
      r.setProperty('--sl-txt3', hexToRgba(s.textPrimary, num('textDone', 22) / 100));
      r.setProperty('--sl-txt4', hexToRgba(s.textPrimary, num('textMeta', 35) / 100));
    }
    if (s.cardColor) r.setProperty('--sl-bg-card', hexToRgba(s.cardColor, num('cardOpacity', 93) / 100));
    if (s.borderColor) r.setProperty('--sl-bc', hexToRgba(s.borderColor, num('borderOpacity', 9) / 100));

    // ── 場景版專屬 composite：軸線/節點/分隔線/星點顏色（透明度層次由 JS 先算成 rgba）──
    const axisC = s.tlAxisColor || s.accent || '#d9a25c';
    r.setProperty('--tl-ax-soft', hexToRgba(axisC, 0.25));
    r.setProperty('--tl-ax-mid', hexToRgba(axisC, 0.55));
    r.setProperty('--tl-ax-hi', hexToRgba(axisC, 0.7));
    const dotC = s.tlDotColor || s.accent || '#d9a25c';
    r.setProperty('--tl-dot-c', dotC);
    r.setProperty('--tl-dot-g', hexToRgba(dotC, 0.7));
    r.setProperty('--tl-dot-g2', hexToRgba(dotC, 1));
    const dgC = s.dgLineColor || '#f0ead8';
    r.setProperty('--dg-line-soft', hexToRgba(dgC, 0.12));
    r.setProperty('--dg-line-mid', hexToRgba(dgC, 0.2));
    const cnC = s.cnDotColor || '#ffffff';
    r.setProperty('--cn-dot-c', cnC);
    r.setProperty('--cn-dot-wait', hexToRgba(cnC, 0.4));
    r.setProperty('--cn-dot-done', hexToRgba(cnC, 0.15));
    const cnG = s.cnGlowColor || s.accent || '#d9a25c';
    r.setProperty('--cn-glow', hexToRgba(cnG, 0.7));
    r.setProperty('--cn-glow-soft', hexToRgba(cnG, 0.5));
    // 「正在播放」字級同時影響場景版大標題：換算成相對預設 16px 的倍率（unitless，CSS 用 calc 乘上 clamp）
    if (has('sizeNow')) r.setProperty('--sl-szn-mult', String(num('sizeNow', 16) / 16));

    // 外框陰影（用強調色）
    if (s.shadowEnabled) {
      const sop = num('shadowOpacity', 0) / 100;
      const sbl = num('shadowBlur', 20);
      r.setProperty('--sl-box-shd', sop > 0
        ? `0 0 ${sbl}px ${hexToRgba(s.accent || '#d9a25c', sop)}, inset 0 1px 0 rgba(255,255,255,0.04)`
        : 'none');
    } else r.setProperty('--sl-box-shd', 'none');

    // cnSpread / timeFormat 沒有對應的 CSS 變數，只在 render() 當下讀取（見 schema
    // needsRerender 註記）。改動後若不重繪，畫面會停留在舊值直到下一次自然更新（換歌）
    // 才變──這裡改動時主動觸發一次重繪，避免「設定改了沒反應」。
    const schema = window.SetlistStyleSchema;
    const needsRerender = schema && schema.FIELDS.some((f) => f.needsRerender && has(f.key));
    curStyle = s;
    if (typeof s.timeFormat === 'string') curTimeFormat = s.timeFormat;
    if (needsRerender) renderActive();

    // ── 文字標籤（更新已掛載的 DOM；render 也會用到最新值）──
    if (typeof s.labelNowPlaying === 'string') lastLabels.nowPlaying = s.labelNowPlaying;
    if (typeof s.labelDone === 'string') lastLabels.done = s.labelDone;
    if (typeof s.labelWait === 'string') lastLabels.wait = s.labelWait;
    if (typeof s.labelReserve === 'string') lastLabels.reserve = s.labelReserve;
    applyLabels();
  }

  // 文字標籤：套到目前畫面上的對應元素（各版型 class 不同，逐一更新）
  const lastLabels = { nowPlaying: '▶ Now Playing', done: '已唱', wait: '未唱', reserve: 'Reserve' };
  function applyLabels() {
    const nowEls = document.querySelectorAll('.ns-label, #sm-eye, #tl-eye, #dg-eye');
    nowEls.forEach((e) => { if (model.current) e.textContent = lastLabels.nowPlaying; });
    document.querySelectorAll('.sm-row:first-child .sm-row-lbl').forEach((e) => { e.textContent = lastLabels.done; });
    document.querySelectorAll('.sm-row:last-child .sm-row-lbl').forEach((e) => { e.textContent = lastLabels.wait; });
    document.querySelectorAll('.cl-lbl-up').forEach((e) => { e.textContent = lastLabels.wait; });
    document.querySelectorAll('.cl-lbl-done').forEach((e) => { e.textContent = lastLabels.done; });
  }

  const PAST_LIMIT = 6, UP_LIMIT = 6;

  // 經典：上＝正在播放、左＝未唱、右＝已唱（可只保留其中一側）
  const classic = {
    mount(root) {
      root.innerHTML =
        '<div class="now-singing" id="cl-now" hidden><div class="ns-label">♪ 現在正在唱</div><div class="ns-title" id="cl-t"></div><div class="ns-artist" id="cl-a"></div></div>' +
        '<div class="cl-cols">' +
          '<div class="cl-col cl-col-up"><div class="setlist-section-label cl-lbl-up">未唱</div><div class="setlist-upcoming" id="cl-up"></div></div>' +
          '<div class="cl-col cl-col-done"><div class="setlist-section-label cl-lbl-done">已唱</div><div class="setlist-past" id="cl-past"></div></div>' +
        '</div>';
    },
    render(root) {
      const now = root.querySelector('#cl-now');
      if (model.current) {
        now.hidden = false;
        root.querySelector('#cl-t').textContent = model.current.title;
        const a = root.querySelector('#cl-a'); a.textContent = model.current.artist; a.hidden = !model.current.artist;
      } else now.hidden = true;
      // 未唱（左）
      const upEl = root.querySelector('#cl-up');
      const up = model.upcoming.slice(0, UP_LIMIT);
      upEl.innerHTML = '';
      up.forEach((s) => upEl.appendChild(el('div', 'setlist-row setlist-upcoming-row',
        `<span class="setlist-title">${escapeHtml(s.title)}</span>${s.artist ? `<span class="setlist-artist"> — ${escapeHtml(s.artist)}</span>` : ''}`)));
      root.querySelector('.cl-lbl-up').style.display = up.length ? '' : 'none';
      // 已唱（右）
      const pastEl = root.querySelector('#cl-past');
      const past = model.past.slice(-PAST_LIMIT);
      pastEl.innerHTML = '';
      past.forEach((s) => pastEl.appendChild(el('div', 'setlist-row',
        `${model.showTime ? `<span class="setlist-time">${escapeHtml(fmtOffset(s.offset))}</span>` : ''}<span class="setlist-title">${escapeHtml(s.title)}</span>${s.artist ? `<span class="setlist-artist"> — ${escapeHtml(s.artist)}</span>` : ''}`)));
      root.querySelector('.cl-lbl-done').style.display = past.length ? '' : 'none';
      // 全空時的提示
      const empty = !model.current && past.length === 0 && up.length === 0;
      if (empty && model.active) { pastEl.innerHTML = '<div class="setlist-empty">直播中…等待第一首歌</div>'; root.querySelector('.cl-lbl-done').style.display = 'none'; }
    },
  };

  // ═══════════════════════════════════════════
  // simple：兩排 + 居中正播
  // ═══════════════════════════════════════════
  const simple = {
    mount(root) {
      root.innerHTML =
        '<div class="lay-stage sm-bg"><div class="sm-card">' +
        '<div class="sm-row"><div class="sm-row-head"><span class="sm-row-lbl">已唱</span><span class="sm-row-cnt" id="sm-dc"></span></div><div class="sm-chips" id="sm-done"></div></div>' +
        '<div class="sm-now"><div class="sm-now-inner"><div class="sm-now-eye" id="sm-eye">▶ Now Playing</div><div class="sm-now-t" id="sm-t"></div><div class="sm-now-a" id="sm-a"></div><div class="sm-bars"><span class="bar-a"></span><span class="bar-a"></span><span class="bar-a"></span></div></div></div>' +
        '<div class="sm-row"><div class="sm-row-head"><span class="sm-row-lbl">未唱</span><span class="sm-row-cnt" id="sm-wc"></span></div><div class="sm-chips" id="sm-wait"></div></div>' +
        '</div></div>';
    },
    render(root) {
      const now = model.current || model.upcoming[0] || null;
      root.querySelector('#sm-eye').textContent = model.current ? '▶ Now Playing' : '· Up Next';
      root.querySelector('#sm-t').textContent = now ? now.title : '—';
      root.querySelector('#sm-a').textContent = now ? now.artist : '';
      const done = model.past, wait = model.current ? model.upcoming : model.upcoming.slice(1);
      root.querySelector('#sm-dc').textContent = done.length || '';
      root.querySelector('#sm-wc').textContent = wait.length || '';
      const chip = (s, st) => `<div class="sm-chip ${st}"><span class="sm-chip-t">${escapeHtml(s.title)}</span></div>`;
      const dEl = root.querySelector('#sm-done');
      dEl.innerHTML = done.length ? done.slice(-8).map((s) => chip(s, 'done')).join('') : '<span class="sm-empty">尚未唱任何歌曲</span>';
      const wEl = root.querySelector('#sm-wait');
      wEl.innerHTML = wait.length ? wait.slice(0, 8).map((s) => chip(s, 'wait')).join('') : '<span class="sm-empty">已唱完所有歌曲</span>';
      dEl.scrollLeft = dEl.scrollWidth;
    },
  };

  // ═══════════════════════════════════════════
  // timeline：居中輪播（per-item 絕對定位，鍵控滑動）
  // ═══════════════════════════════════════════
  const timeline = {
    mount(root) {
      root.innerHTML =
        '<div class="lay-stage tl-bg"><div class="tl-axis"></div><div id="tl-wrap" style="position:absolute;inset:0;pointer-events:none;"></div>' +
        '<div class="tl-now"><div class="tl-now-eye" id="tl-eye">▶ Now Playing</div><div class="tl-now-t" id="tl-t"></div><div class="tl-now-a" id="tl-a"></div></div></div>';
    },
    render(root) {
      const { arr, cur, center } = flat();
      const wrap = root.querySelector('#tl-wrap');
      const seen = new Set();
      const fade = sceneFadeFactors();
      // 項目間距：使用者可調（tlItemGap，schema needsRerender —— 改動時 applyStyle 會觸發重繪）
      const ITEM_W = Number(curStyle.tlItemGap) || 128;
      arr.forEach((it, i) => {
        seen.add(it.key);
        let node = wrap.querySelector(`[data-k="${CSS.escape(it.key)}"]`);
        const offset = i - center;
        const dist = Math.abs(offset);
        if (!node) {
          node = el('div', 'tl-dot-item', `<div class="tl-dot pulse-a"></div><div class="tl-item-name">${escapeHtml(it.title)}</div>`);
          node.dataset.k = it.key;
          node.style.transition = 'none';
          node.style.left = `calc(50% + ${offset * ITEM_W}px)`;
          node.style.opacity = '0';
          wrap.appendChild(node);
          requestAnimationFrame(() => { node.style.transition = ''; });
        }
        node.dataset.d = Math.min(dist, 4);
        node.classList.toggle('is-now', i === cur);
        node.querySelector('.tl-item-name').textContent = it.title;
        node.style.left = `calc(50% + ${offset * ITEM_W}px)`;
        // 距離階梯 × 使用者已唱/未唱淡化係數（正在播放不受影響）
        const ladder = [1, .6, .3, .12, .04][Math.min(dist, 4)];
        node.style.opacity = sceneFade(ladder, i === cur ? 'now' : it.state, fade);
      });
      wrap.querySelectorAll('.tl-dot-item').forEach((n) => { if (!seen.has(n.dataset.k)) n.remove(); });
      const now = model.current;
      root.querySelector('#tl-eye').textContent = now ? '▶ Now Playing' : '· Up Next';
      root.querySelector('#tl-t').textContent = now ? now.title : (model.upcoming[0] ? model.upcoming[0].title : '—');
      root.querySelector('#tl-a').textContent = now ? now.artist : (model.upcoming[0] ? model.upcoming[0].artist : '');
    },
  };

  // ═══════════════════════════════════════════
  // diagonal：斜線分割（左歌單；右側留空給 OBS 角色站位）
  // ═══════════════════════════════════════════
  const diagonal = {
    mount(root) {
      root.innerHTML =
        '<div class="lay-stage dg-bg"><div class="dg-amb"></div>' +
        '<div class="dg-divider"></div>' +
        '<div id="dg-done"></div>' +
        '<div class="dg-now"><div class="dg-eye" id="dg-eye">▶ Now Playing</div><div class="dg-t" id="dg-t"></div><div class="dg-a" id="dg-a"></div></div>' +
        '<div id="dg-wait"></div><div class="dg-cnt" id="dg-cnt"></div></div>';
    },
    render(root) {
      const now = model.current;
      root.querySelector('#dg-eye').textContent = now ? '▶ Now Playing' : '· Up Next';
      root.querySelector('#dg-t').textContent = now ? now.title : (model.upcoming[0] ? model.upcoming[0].title : '—');
      root.querySelector('#dg-a').textContent = now ? now.artist : (model.upcoming[0] ? model.upcoming[0].artist : '');
      const total = model.past.length + (model.current ? 1 : 0) + model.upcoming.length;
      const idx = model.past.length + (model.current ? 1 : 0);
      root.querySelector('#dg-cnt').innerHTML = `${idx} / ${total}<br>SETLIST`;
      const fade = sceneFadeFactors();
      const opDone = Math.min(1, fade.fDone), opWait = Math.min(1, fade.fWait);
      const tops = ['9%', '17%', '25%'];
      const done = model.past.slice(-3);
      root.querySelector('#dg-done').innerHTML = done.map((s, i) =>
        `<div class="dg-done" style="left:${3 + i}%;top:${tops[i]};opacity:${opDone}">${escapeHtml((s.title))}</div>`).join('');
      // 未唱清單起始位置可調（dgWaitTop，預設 68%），後兩項固定往下遞增 9%，夾在畫面內避免溢出
      const wtBase = Number(curStyle.dgWaitTop) || 68;
      const wt = [0, 9, 18].map((g) => `${Math.min(97, wtBase + g)}%`);
      const wait = (model.current ? model.upcoming : model.upcoming.slice(1)).slice(0, 3);
      root.querySelector('#dg-wait').innerHTML = wait.map((s, i) =>
        `<div class="dg-wait" style="left:${4 + i}%;top:${wt[i]};opacity:${opWait}"><span class="dg-wn">${String(i + 1).padStart(2, '0')}</span><span>${escapeHtml(s.title)}</span></div>`).join('');
    },
  };

  // ═══════════════════════════════════════════
  // constellation：不規則星座（±3，鍵控進場）
  // ═══════════════════════════════════════════
  const CN_POS = [
    { x: 76, y: 10, side: 'r' }, { x: 63, y: 22, side: 'l' }, { x: 73, y: 35, side: 'r' },
    { x: 67, y: 48, side: 'c' }, { x: 75, y: 61, side: 'r' }, { x: 62, y: 74, side: 'l' }, { x: 71, y: 87, side: 'r' },
  ];
  const constellation = {
    mount(root) {
      root.innerHTML =
        '<div class="lay-stage cn-bg"><div class="cn-dust"><i style="left:62%;top:8%"></i><i style="left:78%;top:15%;opacity:.6"></i><i style="left:88%;top:32%;opacity:.5"></i><i style="left:70%;top:55%;opacity:.6"></i><i style="left:83%;top:70%;opacity:.4"></i></div>' +
        '<div id="cn-wrap" style="position:absolute;inset:0;"></div></div>';
    },
    render(root) {
      const { arr, cur, center } = flat();
      const wrap = root.querySelector('#cn-wrap');
      const seen = new Set();
      const fade = sceneFadeFactors();
      const opac = [1, .52, .26, .1];
      arr.forEach((it, i) => {
        const offset = i - center;
        if (Math.abs(offset) > 3) return; // 視窗外不畫
        seen.add(it.key);
        const base = CN_POS[offset + 3];
        // cnSpread：以中心(y≈48)為基準縮放垂直間距（>1 疏、<1 密）
        const spread = Number(curStyle.cnSpread) || 1;
        const pos = { x: base.x, y: 48 + (base.y - 48) * spread, side: base.side };
        const isNow = i === cur;
        const state = isNow ? 'active' : (it.state === 'done' ? 'done' : 'wait');
        // 距離階梯 × 使用者已唱/未唱淡化係數（正在播放不受影響）
        const opacity = sceneFade(opac[Math.abs(offset)] ?? 0, isNow ? 'now' : it.state, fade);
        let node = wrap.querySelector(`[data-k="${CSS.escape(it.key)}"]`);
        const inner = `<div class="cn-dot star-a"></div><div class="cn-text"><div class="cn-num">${it.n}</div><div class="cn-title">${escapeHtml(it.title)}</div>${isNow ? `<div class="cn-artist">${escapeHtml(it.artist)}</div>` : ''}</div>`;
        if (!node) {
          node = el('div', `cn-item ${state}`, inner);
          node.dataset.k = it.key;
          node.style.left = pos.x + '%'; node.style.top = '100%'; node.style.opacity = '0'; node.style.transition = 'none';
          wrap.appendChild(node);
          requestAnimationFrame(() => { node.style.transition = ''; node.style.top = pos.y + '%'; node.style.opacity = String(opacity); });
        } else {
          node.className = `cn-item ${state}`;
          node.innerHTML = inner;
          node.style.left = pos.x + '%'; node.style.top = pos.y + '%'; node.style.opacity = String(opacity);
        }
        node.classList.remove('side-l', 'side-r');
        if (!isNow) node.classList.add(pos.side === 'l' ? 'side-l' : 'side-r');
      });
      wrap.querySelectorAll('.cn-item').forEach((n) => {
        if (!seen.has(n.dataset.k)) { n.style.opacity = '0'; setTimeout(() => { if (!seen.has(n.dataset.k)) n.remove(); }, 500); }
      });
    },
  };

  // ═══════════════════════════════════════════
  // 清單型 variants：terminal / billboard / cards
  // ═══════════════════════════════════════════
  function windowList() {
    // 取「最近 5 首已唱 + 現在 + 接下來 5 首」的視窗
    const done = model.past.slice(-5).map((s) => ({ ...s, state: 'done' }));
    const now = model.current ? [{ ...model.current, state: 'active' }] : [];
    const wait = (model.current ? model.upcoming : model.upcoming.slice(0)).slice(0, 6).map((s) => ({ ...s, state: 'wait' }));
    const list = [...done, ...now, ...wait];
    list.forEach((it, i) => { it.n = String(i + 1).padStart(2, '0'); });
    return list;
  }

  const terminal = {
    mount(root) { root.innerHTML = '<div class="lay-stage term-stage"><div class="terminal"><div class="term-bar"><div class="term-dot r"></div><div class="term-dot y"></div><div class="term-dot g"></div><div class="term-filename">setlist.txt</div></div><div class="term-list" id="term-list"></div></div></div>'; },
    render(root) {
      const list = windowList();
      root.querySelector('#term-list').innerHTML = list.map((s) => {
        const prompt = s.state === 'done' ? '#' : s.state === 'active' ? '▶' : '·';
        const pc = s.state === 'active' ? ' t-prompt-active' : '';
        return `<div class="term-item ${s.state === 'active' ? 'active' : s.state === 'done' ? 'done' : ''}"><span class="t-prompt${pc}">${prompt}</span><span class="t-num">${s.n}</span><span class="t-line">${escapeHtml(s.title)}</span></div>`;
      }).join('') || '<div class="term-reserve">— 尚無歌曲 —</div>';
    },
  };

  const billboard = {
    mount(root) { root.innerHTML = '<div class="lay-stage bb-stage"><div class="billboard"><div class="bb-header"><div class="bb-title">Setlist</div><div class="bb-meta" id="bb-meta"></div></div><div class="bb-list" id="bb-list"></div></div></div>'; },
    render(root) {
      const list = windowList();
      const total = model.past.length + (model.current ? 1 : 0) + model.upcoming.length;
      const idx = model.past.length + (model.current ? 1 : 0);
      root.querySelector('#bb-meta').textContent = `Live · ${idx}/${total}`;
      root.querySelector('#bb-list').innerHTML = list.map((s) => {
        const cls = s.state === 'active' ? 'active' : s.state === 'done' ? 'done' : '';
        const nowBlk = s.state === 'active' ? '<div class="bb-now"><div class="bb-bar"><span></span><span></span><span></span><span></span></div><div class="bb-now-label">NOW</div></div>' : '';
        return `<div class="bb-item ${cls}"><div class="bb-rank">${s.n}</div><div class="bb-vline"></div><div class="bb-info"><div class="bb-name">${escapeHtml(s.title)}</div><div class="bb-artist">${escapeHtml(s.artist)}</div></div>${nowBlk}</div>`;
      }).join('') || '<div class="bb-item"><div class="bb-info"><div class="bb-name">尚無歌曲</div></div></div>';
    },
  };

  const cards = {
    mount(root) { root.innerHTML = '<div class="lay-stage cards-stage"><div class="cards" id="cards-list"></div></div>'; },
    render(root) {
      const list = windowList();
      root.querySelector('#cards-list').innerHTML = list.map((s) => {
        const cls = s.state === 'active' ? 'active' : s.state === 'done' ? 'done' : '';
        return `<div class="card ${cls}"><div class="card-num">${s.n}</div><div class="card-info"><div class="card-title">${escapeHtml(s.title)}</div><div class="card-artist">${escapeHtml(s.artist)}</div></div><div class="card-status"></div></div>`;
      }).join('') || '<div class="card"><div class="card-info"><div class="card-title">尚無歌曲</div></div></div>';
    },
  };

  const LAYOUTS = { classic, simple, timeline, diagonal, constellation, terminal, billboard, cards };

  // ─── 版型掛載/切換 ───
  function setLayout(id) {
    if (!LAYOUTS[id]) id = 'classic';
    layoutId = id;
    document.documentElement.dataset.layout = id;
    rootEl.innerHTML = '';
    LAYOUTS[id].mount(rootEl);
    renderActive();
  }
  function renderActive() {
    const lay = LAYOUTS[layoutId] || classic;
    lay.render(rootEl);
    applyLabels();
    requestAnimationFrame(applyMarquees);
  }

  // ── 長歌名跑馬燈：文字超出容器時來回滾動（不超出就維持靜態，不加動畫）──
  const MARQUEE_SEL = '.ns-title, .setlist-title, .bb-name, .card-title, .t-line';
  function applyMarquees() {
    rootEl.querySelectorAll(MARQUEE_SEL).forEach((el) => {
      let span = el.querySelector(':scope > .sl-mq');
      if (!span) {
        span = document.createElement('span');
        span.className = 'sl-mq';
        while (el.firstChild) span.appendChild(el.firstChild);
        el.appendChild(span);
      }
      el.classList.remove('sl-marquee');
      el.style.removeProperty('--sl-mq-dist');
      const overflow = span.scrollWidth - el.clientWidth;
      if (overflow > 4) {
        el.classList.add('sl-marquee');
        el.style.setProperty('--sl-mq-dist', `${-overflow}px`);
        el.style.setProperty('--sl-mq-dur', `${Math.max(6, Math.round(overflow / 18))}s`);
      }
    });
  }

  // 初始 layout/theme：URL 參數作為 socket 連上前的 fallback
  const q = new URLSearchParams(location.search);
  if (q.get('theme')) applyTheme(q.get('theme'));
  setLayout(q.get('layout') || 'classic');

  // 場景版各自獨立、其餘共用 'shared'
  const SCENE = ['timeline', 'diagonal', 'constellation'];
  const effTarget = (l) => (SCENE.includes(l) ? l : 'shared');
  // 取某版型生效的設定（連線初始用：data.sceneStyles[layout] 或 data.style 共用份）
  function effStyleFrom(data, layout) {
    if (!data) return null;
    if (SCENE.includes(layout) && data.sceneStyles && data.sceneStyles[layout]) return data.sceneStyles[layout];
    return data.style || null;
  }

  // ─── Socket ───
  // 記住最近一次收到的原始資料，簡轉繁設定切換時要用同一份原始資料重新 normalize，
  // 不能只改旗標不重繪——normalize() 是唯一做轉換的地方，且轉換結果已經寫進 model 裡。
  let lastRawData = null;
  // 面板內嵌的預覽 iframe（?preview=1）註冊成 setlist-preview：資料照餵、不計入連線數（同 display）。
  const isPreviewClient = new URLSearchParams(location.search).get('preview') === '1';
  SocketClient.init(isPreviewClient ? 'setlist-preview' : 'setlist');
  SocketClient.on('setlist:update', (data) => { lastRawData = data; model = normalize(data); renderActive(); });
  SocketClient.on('setlist:theme', ({ theme } = {}) => applyTheme(theme));
  // payload = { target, style }（向後相容：直接是 style 物件）；只套用符合目前版型的那一份
  SocketClient.on('setlist:style', (payload) => {
    const t = (payload && payload.target) || 'shared';
    const style = (payload && payload.style) ? payload.style : payload;
    if (t === effTarget(layoutId)) applyStyle(style);
  });
  SocketClient.on('setlist:layout', ({ layout } = {}) => { if (layout !== layoutId) setLayout(layout); });
  // 示範資料：伺服器純轉播（不落地存檔），面板內預覽 iframe 與真實 OBS 來源都會收到同一份，
  // 讓使用者不必真的開台也能看到外觀設定的效果。
  SocketClient.on('setlist:demo', (data) => { lastRawData = data; model = normalize(data); renderActive(); });
  // 簡轉繁等歌詞設定：歌單頁跟歌詞顯示頁共用同一份 lyricSettings（同一套 lyric-settings:update
  // 事件），設定改變時用剛才記住的原始資料重新 normalize+渲染，不必等下一次 setlist:update。
  SocketClient.on('lyric-settings:update', (settings) => {
    if (!settings || typeof settings.convertTraditional !== 'boolean') return;
    if (settings.convertTraditional === s2tEnabled) return;
    s2tEnabled = settings.convertTraditional;
    if (lastRawData) { model = normalize(lastRawData); renderActive(); }
  });
  // 剛連線／重連時：state:sync 帶著伺服器持久化的 lyricSettings，讓 OBS 來源一載入就套用
  // 正確的簡轉繁設定，不必等某個無關操作觸發下一次 lyric-settings:update 才補上。
  SocketClient.on('state:sync', (state) => {
    if (state && state.lyricSettings && typeof state.lyricSettings.convertTraditional === 'boolean') {
      s2tEnabled = state.lyricSettings.convertTraditional;
      if (lastRawData) { model = normalize(lastRawData); renderActive(); }
    }
  });
  // 清除示範資料：向伺服器要一次真實狀態，還原成原本畫面（開台中就是真實已唱/未唱，
  // 沒開台就是空清單，不是「回到示範資料出現之前的畫面」這種本地快取邏輯）。
  SocketClient.on('setlist:demo-clear', () => {
    SocketClient.sendWithCallback('setlist:get', null, (data) => {
      lastRawData = data || {};
      model = normalize(data || {});
      renderActive();
      const eff = effStyleFrom(data, layoutId);
      if (eff) applyStyle(eff);
    });
  });
  SocketClient.on('connection-change', (ok) => {
    if (ok) SocketClient.sendWithCallback('setlist:get', null, (data) => {
      if (data && data.theme) applyTheme(data.theme);
      lastRawData = data || {};
      model = normalize(data || {});
      const layout = (data && data.layout) || layoutId;
      setLayout(layout);
      const eff = effStyleFrom(data, layout);
      if (eff) applyStyle(eff);
    });
  });
})();
