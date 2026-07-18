/**
 * 直播歌單面板 —— 開台/收台狀態、歌單列表渲染、複製 YouTube 章節、
 * 歌單 OBS 網址/版型/主題、歌單外觀詳細設定（schema 驅動的樣式微調）。
 *
 * 這塊跟播放/播放清單完全獨立，不碰 playlist/currentTrackIndex，只用 dom 與 showToast。
 */
(function () {
  'use strict';

  const { dom } = AppShared;

  let sessionState = { active: false, startedAt: null, source: null, songs: [] };

  function fmtSessionOffset(ms) {
    const totalSec = Math.floor((ms || 0) / 1000);
    const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
    const s = (totalSec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // 只更新狀態列（含每秒計時器），不重建清單 DOM → 計時器可每秒跳動而不閃爍/不打斷捲動
  function updateSessionStatus() {
    if (!dom.sessionStatus) return;
    const songs = sessionState.songs || [];
    if (sessionState.active && !sessionState.source) {
      dom.sessionStatus.textContent = `等待確認直播狀態 · ${songs.length} 首已記錄`;
      dom.sessionStatus.classList.remove('is-active');
    } else if (sessionState.active) {
      const dur = sessionState.startedAt ? Math.floor((Date.now() - sessionState.startedAt) / 1000) : 0;
      const m = Math.floor(dur / 60), s = dur % 60;
      const source = sessionState.source === 'obs' ? 'OBS 推流中' : sessionState.source === 'twitch' ? 'Twitch 開台中' : '直播中';
      dom.sessionStatus.textContent = `${source} · ${m}:${String(s).padStart(2, '0')} · ${songs.length} 首`;
      dom.sessionStatus.classList.add('is-active');
    } else if (songs.length > 0) {
      dom.sessionStatus.textContent = `已收台 · ${songs.length} 首已記錄`;
      dom.sessionStatus.classList.remove('is-active');
    } else {
      dom.sessionStatus.textContent = '尚未開台';
      dom.sessionStatus.classList.remove('is-active');
    }
  }

  function renderSetlistPanel(data) {
    sessionState = data || { active: false, startedAt: null, source: null, songs: [] };
    const songs = sessionState.songs || [];
    const active = sessionState.active;

    // 按鈕狀態
    if (dom.sessionStart) dom.sessionStart.disabled = active;
    if (dom.sessionStop) dom.sessionStop.disabled = !active;
    if (dom.sessionReset) dom.sessionReset.disabled = active || songs.length === 0;
    if (dom.btnCopyChapters) dom.btnCopyChapters.disabled = songs.length === 0;

    // 狀態文字（含計時器，另由每秒 timer 單獨刷新）
    updateSessionStatus();

    // 歌單計數
    if (dom.setlistCount) dom.setlistCount.textContent = songs.length + ' 首';

    // 歌單列表
    if (dom.setlistPanel) {
      if (songs.length === 0) {
        dom.setlistPanel.innerHTML = '<div class="playlist-empty">開台後播放歌曲，歌單會自動在此顯示。</div>';
      } else {
        dom.setlistPanel.innerHTML = '';
        const showTime = songs.some((s) => (s.offset || 0) > 0); // 時間全 0（未開台）就不顯示時間
        for (let i = 0; i < songs.length; i++) {
          const s = songs[i];
          const row = document.createElement('div');
          row.className = 'playlist-item' + (active && i === songs.length - 1 ? ' active' : '');
          if (showTime) {
            const time = document.createElement('span');
            time.className = 'pi-time';
            time.textContent = fmtSessionOffset(s.offset);
            row.appendChild(time);
          }
          const title = document.createElement('span');
          title.className = 'pi-title';
          title.appendChild(document.createTextNode(s.title || ''));
          if (s.artist) {
            const artist = document.createElement('span');
            artist.className = 'pi-artist';
            artist.textContent = `— ${s.artist}`;
            title.append(' ', artist);
          }
          row.appendChild(title);
          dom.setlistPanel.appendChild(row);
        }
        // 自動捲到底（最新一首）
        dom.setlistPanel.scrollTop = dom.setlistPanel.scrollHeight;
      }
    }
  }

  function copyText(text, btn, successLabel) {
    const orig = btn.textContent;
    const done = () => { btn.textContent = successLabel || '✓ 已複製'; setTimeout(() => { btn.textContent = orig; }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        const el = document.createElement('textarea');
        el.value = text; document.body.appendChild(el); el.select();
        try { document.execCommand('copy'); done(); } catch (_) { /* 靜默 */ }
        document.body.removeChild(el);
      });
    } else {
      const el = document.createElement('textarea');
      el.value = text; document.body.appendChild(el); el.select();
      try { document.execCommand('copy'); done(); } catch (_) { /* 靜默 */ }
      document.body.removeChild(el);
    }
  }

  function copyYoutubeChapters() {
    const songs = sessionState.songs || [];
    if (songs.length === 0) return;
    const lines = ['00:00 開台'];
    for (const s of songs) {
      lines.push(`${fmtSessionOffset(s.offset)} ${s.title}${s.artist ? ' - ' + s.artist : ''}`);
    }
    if (dom.btnCopyChapters) copyText(lines.join('\n'), dom.btnCopyChapters, '✓ 已複製章節');
  }

  if (dom.sessionStart) {
    dom.sessionStart.addEventListener('click', () => SocketClient.send('session:start'));
  }
  if (dom.sessionStop) {
    dom.sessionStop.addEventListener('click', () => SocketClient.send('session:stop'));
  }
  const sessionRefresh = document.getElementById('session-refresh');
  if (sessionRefresh) {
    sessionRefresh.addEventListener('click', () => {
      const label = sessionRefresh.textContent;
      sessionRefresh.disabled = true;
      sessionRefresh.textContent = '重新整理中…';
      SocketClient.send('setlist:get');
      const finish = () => {
        window.setTimeout(() => {
          sessionRefresh.disabled = false;
          sessionRefresh.textContent = label;
        }, 500);
      };
      if (typeof ObsWs !== 'undefined' && ObsWs.isConnected() && ObsWs.refreshStreamStatus) {
        ObsWs.refreshStreamStatus().then((stream) => {
          const twitchSessionContinues = !stream.active && sessionState.active && sessionState.source === 'twitch';
          const message = stream.active
            ? 'OBS 正在推流，直播 Session 已重新確認'
            : twitchSessionContinues
              ? 'OBS 目前未推流；Twitch 開台中的 Session 維持不變'
              : 'OBS 目前未推流，直播 Session 已重新確認';
          AppShared.showToast(message, stream.active ? 'success' : 'info');
        }).catch(() => {
          AppShared.showToast('無法讀取 OBS 推流狀態，已重新讀取歌單資料', 'warning');
        }).finally(finish);
      } else {
        AppShared.showToast('已重新讀取歌單資料；OBS WebSocket 未連線，無法確認推流狀態', 'warning');
        finish();
      }
    });
  }
  if (dom.sessionReset) {
    dom.sessionReset.addEventListener('click', async () => {
      const confirmed = await window.PanelConfirm?.request({
        title: '清除整個直播歌單？',
        summary: '本次直播已唱歌曲與 YouTube 章節將被清除。',
        impact: '播放清單、音檔、媒體庫與 OBS 版型設定都會保留。',
        tone: 'danger',
        confirmLabel: '清除直播歌單',
      });
      if (!confirmed) return;
      SocketClient.send('session:reset');
    });
  }
  if (dom.btnCopyChapters) {
    dom.btnCopyChapters.addEventListener('click', copyYoutubeChapters);
  }

  const setlistLayoutSel = document.getElementById('setlist-layout');

  // Setlist OBS URL 固定；版型與主題由 socket state 同步，使用者不用更新 OBS URL。
  function buildSetlistUrl() {
    return window.location.origin + '/setlist';
  }
  function refreshSetlistUrl() {
    if (dom.setlistObsUrl) dom.setlistObsUrl.textContent = buildSetlistUrl();
    const generalUrl = document.getElementById('setlist-url-general');
    if (generalUrl) generalUrl.textContent = buildSetlistUrl();
    // 同步更新面板內的歌單預覽 iframe（選版型/主題即時看到變化）。
    // 預覽 iframe 必須保留 ?preview=1——沒帶的話會被伺服器當成真的 OBS 歌單來源計入連線數。
    const prev = document.getElementById('setlist-preview');
    if (prev) {
      const want = buildSetlistUrl().replace(window.location.origin, '') + '?preview=1';
      if (prev.getAttribute('src') !== want) prev.setAttribute('src', want);
    }
  }

  // 版型類別：scene（場景版各自獨立）/ classic / list（清單版，與經典共用一份）
  const SETLIST_SCENE = ['timeline', 'diagonal', 'constellation'];
  const SETLIST_LAYOUT_UI = {
    classic: { name: '經典資訊', hint: '完整資訊小元件，適合放在畫面左下或右下常駐。', scope: '設定範圍：經典資訊與清單版共用一組外觀設定。' },
    cards: { name: '卡片清單', hint: '緊湊的側欄卡片，適合保留角色與遊戲畫面。', scope: '設定範圍：卡片清單與經典資訊共用一組外觀設定。' },
    diagonal: { name: '斜線舞台', hint: '全幅 16:9 場景；資訊在左、右側留給角色或遊戲。', scope: '設定範圍：斜線舞台有自己獨立的一組外觀設定。' },
    timeline: { name: '時間軸', hint: '全幅 16:9 場景；適合想讓歌單成為畫面主角的直播段落。', scope: '設定範圍：時間軸有自己獨立的一組外觀設定。' },
    simple: { name: '極簡兩排', hint: '只保留現在與下一首，畫面最輕量。', scope: '設定範圍：極簡兩排與經典資訊共用一組外觀設定。' },
    billboard: { name: '排行榜', hint: '固定排行榜配色的活動型畫面，適合特別企劃。', scope: '設定範圍：排行榜與經典資訊共用一組外觀設定；部分配色為版型固定風格。' },
    constellation: { name: '星座', hint: '裝飾性較強的全幅場景；建議搭配簡潔背景。', scope: '設定範圍：星座有自己獨立的一組外觀設定。' },
    terminal: { name: '終端機', hint: '復古資訊風的小元件，適合科技或遊戲主題。', scope: '設定範圍：終端機與經典資訊共用一組外觀設定；部分配色為版型固定風格。' },
  };
  const SETLIST_RECOMMENDED_LAYOUTS = ['classic', 'cards', 'diagonal'];
  const setlistLayoutButtons = Array.from(document.querySelectorAll('[data-setlist-layout]'));
  function syncSetlistLayoutPicker() {
    if (!setlistLayoutSel) return;
    const layout = setlistLayoutSel.value || 'classic';
    const info = SETLIST_LAYOUT_UI[layout] || SETLIST_LAYOUT_UI.classic;
    setlistLayoutButtons.forEach((button) => {
      const selected = button.dataset.setlistLayout === layout;
      button.setAttribute('aria-checked', String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle('is-selected', selected);
    });
    const hint = document.getElementById('setlist-layout-hint');
    const status = document.getElementById('setlist-layout-status');
    const scope = document.getElementById('setlist-style-scope');
    if (hint) hint.textContent = info.hint;
    if (status) status.textContent = `目前：${info.name}`;
    if (scope) scope.textContent = info.scope;
    const more = document.getElementById('setlist-more-layouts');
    const moreButton = document.getElementById('btn-setlist-more-layouts');
    if (more && !SETLIST_RECOMMENDED_LAYOUTS.includes(layout)) more.hidden = false;
    if (moreButton && more) moreButton.setAttribute('aria-expanded', String(!more.hidden));
  }
  function chooseSetlistLayout(layout) {
    if (!setlistLayoutSel || !layout) return;
    setlistLayoutSel.value = layout;
    setlistLayoutSel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  setlistLayoutButtons.forEach((button, index) => {
    button.addEventListener('click', () => chooseSetlistLayout(button.dataset.setlistLayout));
    button.addEventListener('keydown', (event) => {
      const lastIndex = setlistLayoutButtons.length - 1;
      let nextIndex = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = index === lastIndex ? 0 : index + 1;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = index === 0 ? lastIndex : index - 1;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = lastIndex;
      if (nextIndex === null) return;
      event.preventDefault();
      const next = setlistLayoutButtons[nextIndex];
      chooseSetlistLayout(next.dataset.setlistLayout);
      next.focus();
    });
  });
  const moreLayoutsButton = document.getElementById('btn-setlist-more-layouts');
  const moreLayouts = document.getElementById('setlist-more-layouts');
  if (moreLayoutsButton && moreLayouts) {
    moreLayoutsButton.addEventListener('click', () => {
      moreLayouts.hidden = !moreLayouts.hidden;
      moreLayoutsButton.setAttribute('aria-expanded', String(!moreLayouts.hidden));
    });
  }
  function setlistCategory() {
    const l = setlistLayoutSel ? setlistLayoutSel.value : 'classic';
    if (SETLIST_SCENE.includes(l)) return 'scene';
    return l === 'classic' ? 'classic' : 'list';
  }
  // 目前設定要寫到哪一份：場景版各自一份、其餘共用 'shared'
  function setlistTarget() {
    const l = setlistLayoutSel ? setlistLayoutSel.value : 'classic';
    return SETLIST_SCENE.includes(l) ? l : 'shared';
  }
  // 依目前版型「能動什麼顯示什麼」：data-sl-scope 列出適用類別
  function syncSetlistControlsForLayout() {
    const cat = setlistCategory();
    const layout = setlistLayoutSel ? setlistLayoutSel.value : 'classic';
    document.querySelectorAll('[data-sl-scope]').forEach((el) => {
      const scopes = el.getAttribute('data-sl-scope').split(/\s+/);
      el.hidden = !scopes.includes(cat);
    });
    // 場景版專屬：只在對應 layout 顯示（timeline/diagonal/constellation 各自的版面設定）
    document.querySelectorAll('[data-sl-layout]').forEach((el) => {
      const layouts = el.getAttribute('data-sl-layout').split(/\s+/);
      el.hidden = !layouts.includes(layout);
    });
  }

  if (dom.copySetlistUrl) {
    dom.copySetlistUrl.addEventListener('click', () => {
      copyText(buildSetlistUrl(), dom.copySetlistUrl);
    });
  }
  const copySetlistUrlGeneral = document.getElementById('copy-setlist-url-general');
  if (copySetlistUrlGeneral) {
    copySetlistUrlGeneral.addEventListener('click', () => {
      copyText(buildSetlistUrl(), copySetlistUrlGeneral);
    });
  }
  if (dom.copySetlistUrlTop) {
    dom.copySetlistUrlTop.addEventListener('click', () => {
      copyText(buildSetlistUrl(), dom.copySetlistUrlTop, '已複製');
    });
  }

  // 「載入示範資料」：還沒開台時歌單預覽是空的，看不出外觀設定的效果。走 socket 廣播
  // （server 純轉播、不落地存檔），面板內預覽 iframe 與真實 OBS 瀏覽器來源會同時收到同一份
  // 假資料（正在播放 1 首、已唱/未唱各 2 首）；「清除」讓所有端各自回頭要一次真實狀態還原。
  function demoSetlistPayload() {
    const now = Date.now();
    return {
      active: true,
      startedAt: now - 12 * 60 * 1000,
      songs: [
        { id: 'demo-done-1', title: '示範已唱歌曲一', artist: '示範歌手 A', offset: 65000 },
        { id: 'demo-done-2', title: '示範已唱歌曲二：測試比較長的歌名看跑馬燈', artist: '示範歌手 B', offset: 400000 },
      ],
      current: { id: 'demo-current', title: '示範正在播放的歌曲', artist: '示範歌手 C' },
      upcoming: [
        { title: '示範未唱歌曲一', artist: '示範歌手 D' },
        { title: '示範未唱歌曲二', artist: '示範歌手 E' },
      ],
    };
  }
  function loadSetlistDemo() {
    SocketClient.send('setlist:demo', demoSetlistPayload());
    AppShared.showToast('已載入示範資料（面板預覽＋真實 OBS 來源都會顯示，不影響真實歌單資料）');
  }
  function clearSetlistDemo() {
    SocketClient.send('setlist:demo-clear', null);
    AppShared.showToast('已清除示範資料，還原成真實歌單狀態');
  }
  document.querySelectorAll('.btn-setlist-demo').forEach((b) => b.addEventListener('click', loadSetlistDemo));
  document.querySelectorAll('.btn-setlist-demo-clear').forEach((b) => b.addEventListener('click', clearSetlistDemo));
  if (dom.setlistTheme) {
    dom.setlistTheme.addEventListener('change', () => {
      refreshSetlistUrl();
      SocketClient.send('setlist:theme', { theme: dom.setlistTheme.value || 'glass' });
    });
  }
  if (setlistLayoutSel) {
    setlistLayoutSel.addEventListener('change', () => {
      refreshSetlistUrl();
      syncSetlistControlsForLayout();
      syncSetlistLayoutPicker();
      SocketClient.send('setlist:layout', { layout: setlistLayoutSel.value || 'classic' });
    });
  }
  refreshSetlistUrl();
  syncSetlistControlsForLayout();
  syncSetlistLayoutPicker();

  // 歌單外觀細項：縮放 / 背板底色+不透明度 / 文字顏色覆蓋。
  // 改動只送 socket → 伺服器廣播 setlist:style，預覽 iframe 與真實 OBS 同步即時更新（與主題同機制）。
  (function initSetlistStyleControls() {
    const g = (id) => document.getElementById(id);
    if (!g('sls-accent')) return; // 不在歌單 view
    const setVal = (id, t) => { const e = g(id); if (e) e.textContent = t; };

    // 欄位定義（型別/預設值/邊界/CSS 套用）單一事實來源在 setlist-style-schema.js，
    // 這裡只負責「把 schema 欄位接到對應的 HTML 控制項」，新增欄位不需要再改這個檔案，
    // 只有「一個控制項對應多個輸出欄位」的特例（textColor / classicShowUpcoming+Done）
    // 才需要在下面手動處理。
    const schema = window.SetlistStyleSchema;
    const FIELDS = schema.FIELDS;
    const FORMATS = schema.FORMATS;
    // 有 domId 且非特例的欄位 → 通用 collect / adopt / 事件綁定
    const genericFields = FIELDS.filter((f) => f.domId && !f.special);
    const fmtOf = (f) => (f.format && FORMATS[f.format]) || null;
    const readVal = (f, el) => (f.type === 'boolean' ? el.checked : f.type === 'number' ? parseFloat(el.value) : el.value);
    const writeVal = (f, el, v) => { if (f.type === 'boolean') el.checked = !!v; else el.value = v; };

    function collectStyle() {
      const out = {};
      genericFields.forEach((f) => { const el = g(f.domId); if (el) out[f.key] = readVal(f, el); });
      // ── 特例：textColor（「用主題」checkbox + 色票，合成一個可為空字串的欄位）──
      out.textColor = g('sls-text-theme').checked ? '' : g('sls-text-color').value;
      // ── 特例：classicShowUpcoming/classicShowDone（單一三態下拉衍生兩個布林）──
      const cs = g('sls-classic-sections') ? g('sls-classic-sections').value : 'both';
      out.classicShowUpcoming = cs !== 'done';
      out.classicShowDone = cs !== 'up';
      out.target = setlistTarget(); // 場景版各自一份、其餘 'shared'
      return out;
    }
    // 各版型獨立設定的本地快取（伺服器為真實來源；切版型時還原該份）
    const slStores = { shared: null, timeline: null, diagonal: null, constellation: null };
    function sendStyle() { SocketClient.send('setlist:style', collectStyle()); }

    function adoptStyleUI(s) {
      if (!s || typeof s !== 'object') return;
      genericFields.forEach((f) => {
        if (s[f.key] == null) return;
        const el = g(f.domId); if (!el) return;
        writeVal(f, el, s[f.key]);
        const fmt = fmtOf(f); if (fmt) setVal(f.domId + '-val', fmt.toLabel(s[f.key]));
      });
      // ── 特例：textColor ──
      const hasText = typeof s.textColor === 'string' && s.textColor;
      const tt = g('sls-text-theme'), tc = g('sls-text-color');
      if (tt) tt.checked = !hasText; if (tc) { tc.disabled = !hasText; if (hasText) tc.value = s.textColor; }
      // ── 特例：classicShowUpcoming/classicShowDone ──
      const csEl = g('sls-classic-sections');
      if (csEl && (s.classicShowUpcoming != null || s.classicShowDone != null)) {
        const u = s.classicShowUpcoming !== false, d = s.classicShowDone !== false;
        csEl.value = (u && d) ? 'both' : (u ? 'up' : 'done');
      }
    }

    // 事件綁定（input/change → 更新 val 標籤 + 送出）：checkbox 與 <select> 用 change，其餘用 input
    genericFields.forEach((f) => {
      const el = g(f.domId); if (!el) return;
      const ev = (el.tagName === 'SELECT' || f.type === 'boolean') ? 'change' : 'input';
      el.addEventListener(ev, () => {
        const fmt = fmtOf(f); if (fmt) setVal(f.domId + '-val', fmt.toLabel(readVal(f, el)));
        sendStyle();
      });
    });
    // 特例欄位事件
    const csEl2 = g('sls-classic-sections');
    if (csEl2) csEl2.addEventListener('change', sendStyle);
    const tt = g('sls-text-theme'), tc = g('sls-text-color');
    if (tt) tt.addEventListener('change', () => { if (tc) tc.disabled = tt.checked; sendStyle(); });
    if (tc) tc.addEventListener('input', sendStyle);

    // 風格預設（一鍵套一組值，再廣播）
    const PRESETS = {
      sand: { accent: '#d9a25c', accentBright: '#f0c587', textPrimary: '#f0ead8', cardColor: '#0b0907', cardOpacity: 93, borderColor: '#f0ead8', borderOpacity: 9, bgColor: '#000000', bgOpacity: 0, blurAmount: 20, borderRadius: 14, doneOpacity: 35, waitOpacity: 55, shadowEnabled: false, fontDisplay: 'Fraunces', fontBody: 'Manrope' },
      glass: { accent: '#7c6cff', accentBright: '#a395ff', textPrimary: '#ffffff', cardColor: '#000000', cardOpacity: 35, borderColor: '#7c6cff', borderOpacity: 35, bgColor: '#000000', bgOpacity: 0, blurAmount: 12, borderRadius: 12, doneOpacity: 40, waitOpacity: 65, shadowEnabled: false },
      neon: { accent: '#00ff9f', accentBright: '#a0ffe0', textPrimary: '#e6fff5', cardColor: '#001610', cardOpacity: 82, borderColor: '#00ff9f', borderOpacity: 25, bgColor: '#000000', bgOpacity: 0, blurAmount: 4, borderRadius: 6, doneOpacity: 35, waitOpacity: 60, shadowEnabled: true, shadowOpacity: 40, shadowBlur: 24 },
      minimal: { accent: '#ffffff', accentBright: '#ffffff', textPrimary: '#ffffff', cardColor: '#000000', cardOpacity: 0, borderColor: '#ffffff', borderOpacity: 0, borderWidth: 0, bgColor: '#000000', bgOpacity: 0, blurAmount: 0, borderRadius: 8, doneOpacity: 30, waitOpacity: 55, shadowEnabled: false },
      dark: { accent: '#ffffff', accentBright: '#ffffff', textPrimary: '#e8e8ec', cardColor: '#050408', cardOpacity: 96, borderColor: '#ffffff', borderOpacity: 6, bgColor: '#000000', bgOpacity: 0, blurAmount: 0, borderRadius: 10, doneOpacity: 25, waitOpacity: 50, shadowEnabled: false },
      light: { accent: '#1e1450', accentBright: '#3a2880', textPrimary: '#140a3c', cardColor: '#ffffff', cardOpacity: 92, borderColor: '#000000', borderOpacity: 10, bgColor: '#000000', bgOpacity: 0, blurAmount: 0, borderRadius: 10, doneOpacity: 30, waitOpacity: 55, shadowEnabled: false },
    };
    // 完整預設（重置用）：所有欄位回出廠值，與 server 開機預設同一份定義（schema.getDefaultStyle）
    const DEFAULT_STYLE = schema.getDefaultStyle();
    // 縮圖化：色票直接從 PRESETS 的實際數值畫出來（不在 HTML 另外寫死一份顏色，
    // 避免兩處顏色定義互相漂移），每張縮圖＝主色角＋卡片底色，一眼看出風格差異。
    document.querySelectorAll('.preset-thumb').forEach((btn) => {
      const p = PRESETS[btn.dataset.preset];
      const swatch = btn.querySelector('.preset-swatch');
      if (p && swatch) {
        const cardBg = p.cardColor || '#000000';
        swatch.style.background = `linear-gradient(135deg, ${p.accent} 0%, ${p.accent} 38%, ${cardBg} 38%, ${cardBg} 100%)`;
        swatch.style.borderColor = p.borderColor || p.accent;
      }
      btn.addEventListener('click', () => {
        document.querySelectorAll('.preset-thumb').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        if (!p) return;
        adoptStyleUI(p); sendStyle();
      });
    });
    // 重置目前版型（場景版重置自己那份、其餘重置共用份）
    const resetBtn = g('sls-reset');
    if (resetBtn) resetBtn.addEventListener('click', () => { adoptStyleUI(DEFAULT_STYLE); sendStyle(); });

    // 自訂風格：存目前設定到 localStorage、可載入/刪除（與版型無關，跨版型通用）
    const CUSTOM_KEY = 'sls-custom-styles';
    const loadCustom = () => { try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}') || {}; } catch (_) { return {}; } };
    const saveCustom = (obj) => { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(obj)); } catch (_) {} };
    function renderCustomList() {
      const list = g('sls-custom-list'); if (!list) return;
      const obj = loadCustom();
      const names = Object.keys(obj);
      list.innerHTML = '';
      if (!names.length) { list.innerHTML = '<span class="sub sls-custom-empty">尚無自訂風格</span>'; return; }
      names.forEach((name) => {
        const chip = document.createElement('span');
        chip.className = 'sls-custom-chip';
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn btn-sm btn-ghost sls-custom-chip__apply'; b.textContent = name;
        b.addEventListener('click', () => { const o = loadCustom(); if (o[name]) { adoptStyleUI(o[name]); sendStyle(); } });
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'btn btn-sm btn-ghost sls-custom-chip__delete'; del.textContent = '×'; del.title = '刪除';
        del.addEventListener('click', () => { const o = loadCustom(); delete o[name]; saveCustom(o); renderCustomList(); });
        chip.appendChild(b); chip.appendChild(del); list.appendChild(chip);
      });
    }
    const saveBtn = g('sls-save-btn'), saveName = g('sls-save-name');
    if (saveBtn && saveName) {
      saveBtn.addEventListener('click', () => {
        const name = (saveName.value || '').trim();
        if (!name) { AppShared.showToast('請先輸入風格名稱', 'error'); return; }
        const obj = loadCustom();
        const st = collectStyle(); delete st.target; // target 不存（載入時套到目前版型）
        obj[name] = st; saveCustom(obj); saveName.value = ''; renderCustomList();
        AppShared.showToast(`已儲存風格「${name}」`);
      });
      saveName.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBtn.click(); });
    }
    renderCustomList();

    // 詳細設定 modal 開關
    const advBtn = g('btn-setlist-advanced'), advModal = g('setlist-advanced-modal'), advClose = g('setlist-advanced-close');
    // .card 有 backdrop-filter 會成為 fixed 的容器區塊 → 把彈窗搬到 body 才能真正全螢幕
    if (advModal && advModal.parentElement !== document.body) document.body.appendChild(advModal);
    const search = g('setlist-settings-search');
    const searchStatus = g('setlist-settings-search-status');
    const searchSections = advModal ? Array.from(advModal.querySelectorAll('.mw-settings > details.card-collapse')) : [];
    let searchOpenState = null;
    let advancedFocusBeforeOpen = null;
    const SEARCH_ALIASES = { 字體: '字型 字級', 寬度: '尺寸 間距', 已唱: '完成 刪除線 淡化', 未唱: '等待 下一首 淡化', 背景: '背板 顏色 透明度', 特效: '陰影 發光 描邊 動畫', 場景: '時間軸 斜線 星座 位置' };
    function filterSetlistSettings() {
      if (!search) return;
      const raw = search.value.trim();
      const query = raw ? `${raw} ${SEARCH_ALIASES[raw] || ''}`.toLocaleLowerCase() : '';
      if (!query) {
        searchSections.forEach((section, index) => { section.classList.remove('is-search-hidden'); if (searchOpenState) section.open = searchOpenState[index]; });
        searchOpenState = null;
        if (searchStatus) searchStatus.textContent = '可直接搜尋設定名稱或用途。';
        return;
      }
      if (!searchOpenState) searchOpenState = searchSections.map((section) => section.open);
      const terms = query.split(/\s+/).filter(Boolean);
      let matches = 0;
      searchSections.forEach((section) => {
        const availableForLayout = section.style.display !== 'none' && !section.hidden;
        const visible = availableForLayout && terms.some((term) => section.textContent.toLocaleLowerCase().includes(term));
        section.classList.toggle('is-search-hidden', !visible);
        if (visible) { section.open = true; matches += 1; }
      });
      if (searchStatus) searchStatus.textContent = matches ? `找到 ${matches} 個設定區塊。` : '找不到相符設定；可試試「字體」、「寬度」、「已唱」或「特效」。';
    }
    if (search) search.addEventListener('input', filterSetlistSettings);
    const closeAdvanced = () => {
      if (!advModal) return;
      if (search) { search.value = ''; filterSetlistSettings(); }
      advModal.hidden = true;
      (advancedFocusBeforeOpen && advancedFocusBeforeOpen.isConnected ? advancedFocusBeforeOpen : advBtn)?.focus();
      advancedFocusBeforeOpen = null;
    };
    if (advBtn && advModal) advBtn.addEventListener('click', () => { advancedFocusBeforeOpen = document.activeElement; advModal.hidden = false; window.setTimeout(() => search?.focus(), 0); });
    if (advClose && advModal) advClose.addEventListener('click', closeAdvanced);
    if (advModal) advModal.addEventListener('click', (e) => { if (e.target === advModal) closeAdvanced(); });

    // 切版型時：還原該版型（場景版）或共用份的設定到 UI
    if (setlistLayoutSel) {
      setlistLayoutSel.addEventListener('change', () => {
        const st = slStores[setlistTarget()];
        if (st) adoptStyleUI(st);
      });
    }

    // Socket 同步（伺服器為真實來源）；payload = { target, style }（向後相容舊格式）
    SocketClient.on('setlist:style', (payload) => {
      const t = (payload && payload.target) || 'shared';
      const st = (payload && payload.style) ? payload.style : payload;
      slStores[t] = st;
      if (t === setlistTarget()) adoptStyleUI(st);
    });
    SocketClient.on('state:sync', (state) => {
      const sess = state && state.session;
      if (!sess) return;
      if (sess.style) slStores.shared = sess.style;
      if (sess.sceneStyles) { ['timeline', 'diagonal', 'constellation'].forEach((k) => { if (sess.sceneStyles[k]) slStores[k] = sess.sceneStyles[k]; }); }
      if (sess.theme && dom.setlistTheme) { dom.setlistTheme.value = sess.theme; refreshSetlistUrl(); }
      if (sess.layout && setlistLayoutSel) { setlistLayoutSel.value = sess.layout; refreshSetlistUrl(); syncSetlistControlsForLayout(); syncSetlistLayoutPicker(); }
      const cur = slStores[setlistTarget()];
      if (cur) adoptStyleUI(cur);
    });
  })();

  // Session 計時器：每秒只刷新狀態列文字（不重建清單），直播時長即時跳動
  setInterval(() => {
    if (sessionState.active) updateSessionStatus();
  }, 1000);

  SocketClient.on('setlist:update', (data) => renderSetlistPanel(data));

  // state:sync 時同步 session 資料（初始連線/恢復）
  SocketClient.on('state:sync', (state) => {
    if (state && state.session) renderSetlistPanel(state.session);
  });
})();
