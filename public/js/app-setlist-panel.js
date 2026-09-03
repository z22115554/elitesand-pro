/**
 * 直播歌單面板 —— 開台/收台狀態、歌單列表渲染、複製 YouTube 章節、
 * 歌單 OBS 網址/版型/主題、歌單外觀詳細設定（schema 驅動的樣式微調）。
 *
 * 這塊跟播放/播放清單完全獨立，不碰 playlist/currentTrackIndex，只用 dom 與 showToast。
 */
(function () {
  'use strict';

  const { dom } = AppShared;
  const workspaceText = (key, fallback, vars) => {
    const translated = window.I18n?.t?.(key, vars);
    return translated && translated !== key ? translated : fallback;
  };
  const translateText = (source) => window.I18n?.translate?.(source) || source;
  const formatCount = (value) => new Intl.NumberFormat(window.I18n?.current?.() || 'zh-TW').format(value);

  let sessionState = { active: false, startedAt: null, source: null, songs: [] };
  const sessionSummaryStatus = document.getElementById('session-summary-status');

  // YouTube 章節時間戳：超過 1 小時必須是 H:MM:SS，否則貼上去不會被辨識成章節
  // （直播常常一開就是好幾小時，MM:SS 撐不住三位數分鐘）。
  function fmtSessionOffset(ms) {
    const totalSec = Math.floor((ms || 0) / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = (Math.floor(totalSec / 60) % 60).toString().padStart(2, '0');
    const s = (totalSec % 60).toString().padStart(2, '0');
    return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
  }

  // 只更新狀態列（含每秒計時器），不重建清單 DOM → 計時器可每秒跳動而不閃爍/不打斷捲動
  function updateSessionStatus() {
    if (!dom.sessionStatus && !sessionSummaryStatus) return;
    const songs = sessionState.songs || [];
    const applyStatus = (text, active) => {
      if (dom.sessionStatus) {
        dom.sessionStatus.textContent = text;
        dom.sessionStatus.classList.toggle('is-active', active);
      }
      if (sessionSummaryStatus) {
        sessionSummaryStatus.textContent = text;
        sessionSummaryStatus.classList.toggle('is-active', active);
      }
    };
    if (sessionState.active && !sessionState.source) {
      const count = formatCount(songs.length);
      applyStatus(workspaceText('home.session.statusPending', `等待確認直播狀態 · ${count} 首已記錄`, { count }), false);
    } else if (sessionState.active) {
      const dur = sessionState.startedAt ? Math.floor((Date.now() - sessionState.startedAt) / 1000) : 0;
      const m = Math.floor(dur / 60), s = dur % 60;
      const source = sessionState.source === 'obs'
        ? workspaceText('home.session.sourceObs', 'OBS 推流中')
        : sessionState.source === 'twitch'
          ? workspaceText('home.session.sourceTwitch', 'Twitch 開台中')
          : workspaceText('home.session.sourceLive', '直播中');
      const duration = `${m}:${String(s).padStart(2, '0')}`;
      const count = formatCount(songs.length);
      applyStatus(workspaceText('home.session.statusLive', `${source} · ${duration} · 已唱 ${count} 首`, { source, duration, count }), true);
    } else if (songs.length > 0) {
      const count = formatCount(songs.length);
      applyStatus(workspaceText('home.session.statusEnded', `已收台 · ${count} 首已記錄`, { count }), false);
    } else {
      applyStatus(workspaceText('home.session.statusNotLive', '尚未開台 · 已唱 0 首'), false);
    }
  }

  // 首頁重構：本場直播（Session 狀態 + 已唱歌曲）已從獨立 Modal 攤平成「本場直播」分頁，
  // 直接展開在頁面上，不再需要開關視窗的邏輯。

  function renderSetlistPanel(data) {
    sessionState = data || { active: false, startedAt: null, source: null, songs: [] };
    const songs = sessionState.songs || [];
    const active = sessionState.active;

    // 按鈕狀態
    if (dom.sessionStart) dom.sessionStart.disabled = active;
    if (dom.sessionStop) dom.sessionStop.disabled = !active;
    if (dom.sessionReset) dom.sessionReset.disabled = active || songs.length === 0;
    if (sessionNewStart) sessionNewStart.disabled = active;
    if (dom.btnCopyChapters) dom.btnCopyChapters.disabled = songs.length === 0;

    // 狀態文字（含計時器，另由每秒 timer 單獨刷新）
    updateSessionStatus();

    // 歌單計數
    if (dom.setlistCount) {
      const count = formatCount(songs.length);
      dom.setlistCount.textContent = workspaceText('home.session.count', `${count} 首`, { count });
    }

    // 歌單列表
    if (dom.setlistPanel) {
      if (songs.length === 0) {
        dom.setlistPanel.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'playlist-empty';
        empty.textContent = workspaceText('home.session.empty', '開台後播放歌曲，歌單會自動在此顯示。');
        dom.setlistPanel.appendChild(empty);
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
          const meta = document.createElement('div');
          meta.className = 'pi-meta';
          const title = document.createElement('span');
          title.className = 'pi-title';
          title.appendChild(document.createTextNode(s.title || ''));
          if (s.artist) {
            const artist = document.createElement('span');
            artist.className = 'pi-artist';
            artist.textContent = `— ${s.artist}`;
            title.append(' ', artist);
          }
          meta.appendChild(title);
          row.appendChild(meta);
          // 單獨刪一筆：點錯歌被誤記進已唱、切歌太快連點兩次，不用整場清空才能修正。
          // 沒有 entryId（理論上不該發生，state.js 載入時已幫舊資料補齊）就不給按，避免刪錯。
          if (s.entryId) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'pi-remove';
            removeBtn.type = 'button';
            removeBtn.dataset.removeSongEntryId = s.entryId;
            removeBtn.title = workspaceText('home.session.removeSong', '從已唱歌單移除');
            removeBtn.setAttribute('aria-label', workspaceText('home.session.removeSong', '從已唱歌單移除'));
            removeBtn.textContent = '×';
            row.appendChild(removeBtn);
          }
          dom.setlistPanel.appendChild(row);
        }
        // 自動捲到底（最新一首）
        dom.setlistPanel.scrollTop = dom.setlistPanel.scrollHeight;
      }
    }
  }

  window.addEventListener('i18n:change', () => renderSetlistPanel(sessionState));

  // 事件代理綁在容器上：renderSetlistPanel() 每次都整批重建 innerHTML，綁在個別按鈕上的
  // 監聽器會跟著舊 DOM 一起被丟掉，只有綁在容器（本身不會被替換）才能持續有效。
  if (dom.setlistPanel) {
    dom.setlistPanel.addEventListener('click', (event) => {
      const btn = event.target.closest('.pi-remove');
      if (!btn) return;
      const entryId = btn.dataset.removeSongEntryId;
      if (!entryId) return;
      SocketClient.send('session:remove-song', { entryId });
    });
  }

  function copyText(text, btn, successLabel, restoreLabel) {
    const originalLabel = btn.textContent;
    const resolveRestoreLabel = () => {
      if (typeof restoreLabel === 'function') return restoreLabel();
      if (restoreLabel) return restoreLabel;
      const key = btn.getAttribute('data-i18n');
      return key ? workspaceText(key, originalLabel) : originalLabel;
    };
    const done = () => {
      btn.textContent = successLabel || workspaceText('common.copied', '✓ 已複製');
      setTimeout(() => { btn.textContent = resolveRestoreLabel(); }, 2000);
    };
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
    const lines = [workspaceText('home.session.chapterOpening', '00:00 開台')];
    for (const s of songs) {
      lines.push(`${fmtSessionOffset(s.offset)} ${s.title}${s.artist ? ' - ' + s.artist : ''}`);
    }
    if (dom.btnCopyChapters) copyText(lines.join('\n'), dom.btnCopyChapters, workspaceText('home.session.copySuccess', '✓ 已複製章節'));
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
      sessionRefresh.disabled = true;
      sessionRefresh.textContent = workspaceText('home.session.refreshing', '重新整理中…');
      SocketClient.send('setlist:get');
      const finish = () => {
        window.setTimeout(() => {
          sessionRefresh.disabled = false;
          sessionRefresh.textContent = workspaceText('home.session.refresh', '重新整理狀態');
        }, 500);
      };
      if (typeof ObsWs !== 'undefined' && ObsWs.isConnected() && ObsWs.refreshStreamStatus) {
        ObsWs.refreshStreamStatus().then((stream) => {
          const twitchSessionContinues = !stream.active && sessionState.active && sessionState.source === 'twitch';
          const message = stream.active
            ? workspaceText('home.session.toastObsStreaming', 'OBS 正在推流，直播 Session 已重新確認')
            : twitchSessionContinues
              ? workspaceText('home.session.toastTwitchContinues', 'OBS 目前未推流；Twitch 開台中的 Session 維持不變')
              : workspaceText('home.session.toastObsNotStreaming', 'OBS 目前未推流，直播 Session 已重新確認');
          AppShared.showToast(message, stream.active ? 'success' : 'info');
        }).catch(() => {
          AppShared.showToast(workspaceText('home.session.toastObsReadFailed', '無法讀取 OBS 推流狀態，已重新讀取歌單資料'), 'warning');
        }).finally(finish);
      } else {
        AppShared.showToast(workspaceText('home.session.toastObsDisconnected', '已重新讀取歌單資料；OBS WebSocket 未連線，無法確認推流狀態'), 'warning');
        finish();
      }
    });
  }
  if (dom.sessionReset) {
    dom.sessionReset.addEventListener('click', async () => {
      const confirmed = await window.PanelConfirm?.request({
        title: workspaceText('home.session.confirmTitle', '清除整個直播歌單？'),
        summary: workspaceText('home.session.confirmSummary', '本次直播已唱歌曲與 YouTube 章節將被清除。'),
        impact: workspaceText('home.session.confirmImpact', '播放清單、音檔、媒體庫與 OBS 版型設定都會保留。'),
        tone: 'danger',
        confirmLabel: workspaceText('home.session.confirmLabel', '清除直播歌單'),
      });
      if (!confirmed) return;
      SocketClient.send('session:reset');
    });
  }

  // 「開始新場次」：session-reset（已唱歌單）＋ 清空播放清單，一次備妥下一場的乾淨起點。
  // 跟 session-reset 一樣，直播中不給按——避免收播前手滑把還在用的清單跟已唱記錄一起清掉。
  const sessionNewStart = document.getElementById('session-new-start');
  async function runStartNewSession() {
    const confirmed = await window.PanelConfirm?.request({
      title: workspaceText('home.session.newTitle', '開始新場次？'),
      summary: workspaceText('home.session.newSummary', '會清空目前的播放清單與本場已唱記錄，準備好唱新的一場。'),
      impact: workspaceText('home.session.newImpact', '歌曲音檔、媒體庫紀錄與歌詞設定都會保留；播放清單與已唱歌單清空後可從媒體庫重新加入歌曲。'),
      tone: 'danger',
      confirmLabel: workspaceText('home.session.newConfirmLabel', '開始新場次'),
    });
    if (!confirmed) return;
    SocketClient.send('session:reset');
    if (AppShared.clearPlaylist) await AppShared.clearPlaylist();
    AppShared.showToast(workspaceText('home.session.newDone', '已開始新場次'), 'success');
  }
  if (sessionNewStart) sessionNewStart.addEventListener('click', runStartNewSession);

  // 偵測到「真的開新場次」（非重連，見伺服器端判斷）且播放清單還留著上一場的歌時，
  // 主動問一次要不要順便清空——已唱記錄這時已經自動歸零了，這裡只問播放清單。
  const NEW_SESSION_PROMPT_KEY = 'elite-new-session-prompt-handled-v1';
  function newSessionPromptHandled(startedAt) {
    try { return localStorage.getItem(NEW_SESSION_PROMPT_KEY) === String(startedAt); } catch (_) { return false; }
  }
  function markNewSessionPromptHandled(startedAt) {
    try { localStorage.setItem(NEW_SESSION_PROMPT_KEY, String(startedAt)); } catch (_) { /* 無痕模式可能拒絕 */ }
  }
  SocketClient.on('session:new-start', async (data) => {
    const startedAt = data && data.startedAt;
    if (!startedAt || newSessionPromptHandled(startedAt)) return;
    markNewSessionPromptHandled(startedAt);
    const confirmed = await window.PanelConfirm?.request({
      title: workspaceText('home.session.detectTitle', '偵測到新場次開始'),
      summary: workspaceText('home.session.detectSummary', '播放清單裡還留著上一場的歌，要順便清空嗎？'),
      impact: workspaceText('home.session.detectImpact', '歌曲音檔、媒體庫紀錄與歌詞設定都會保留；清空後可從媒體庫重新加入歌曲。'),
      tone: 'neutral',
      confirmLabel: workspaceText('home.session.detectConfirmLabel', '清空播放清單'),
    });
    if (!confirmed) return;
    if (AppShared.clearPlaylist) await AppShared.clearPlaylist();
    AppShared.showToast(workspaceText('home.session.newDone', '已開始新場次'), 'success');
  });
  if (dom.btnCopyChapters) {
    dom.btnCopyChapters.addEventListener('click', copyYoutubeChapters);
  }

  const setlistLayoutSel = document.getElementById('setlist-layout');

  // Setlist OBS URL 固定；版型、主題與外觀都由 socket state 同步，
  // 歌單大小則由使用者在 OBS 拉 Browser Source 的寬高決定，不需要換網址。
  function buildSetlistUrl({ preview = false, relative = false } = {}) {
    const url = new URL('/setlist', window.location.origin);
    if (preview) url.searchParams.set('preview', '1');
    if (!preview && typeof AccessAuth !== 'undefined' && AccessAuth.sourceToken()) url.searchParams.set('source', AccessAuth.sourceToken());
    if (window.I18n) {
      const localized = new URL(window.I18n.localizeUrl(url.toString()));
      url.search = localized.search;
    }
    return relative ? `${url.pathname}${url.search}` : url.toString();
  }

  // ── 預覽尺寸：模擬不同的 OBS Browser Source 寬高 ──
  // 清單型模板是「來源即畫布」，所以預覽必須能換尺寸才看得出真正的排版結果。
  const SETLIST_PREVIEW_SIZES = {
    '16x9': { w: 1920, h: 1080, labelKey: 'settings.setlist.sizeLandscape', fallback: '橫式 1920×1080' },
    'portrait': { w: 600, h: 1080, labelKey: 'settings.setlist.sizePortrait', fallback: '直式 600×1080' },
    'strip': { w: 1920, h: 320, labelKey: 'settings.setlist.sizeStrip', fallback: '橫條 1920×320' },
    'small': { w: 640, h: 480, labelKey: 'settings.setlist.sizeSmall', fallback: '小框 640×480' },
  };
  let setlistPreviewSize = '16x9';
  const setlistPreviewButtons = Array.from(document.querySelectorAll('[data-setlist-preview-size]'));

  function applySetlistPreviewSize() {
    const size = SETLIST_PREVIEW_SIZES[setlistPreviewSize] || SETLIST_PREVIEW_SIZES['16x9'];
    document.querySelectorAll('.setlist-preview-wrap').forEach((wrap) => {
      wrap.style.aspectRatio = `${size.w} / ${size.h}`;
      wrap.style.setProperty('--preview-w', `${size.w}px`);
      wrap.style.setProperty('--preview-h', `${size.h}px`);
    });
    // 縮放交給 preview-scale.js（它會讀上面設好的 --preview-w 當基準）。
    window.PreviewScale?.apply();
    // 同源 iframe 換了邏輯尺寸後主動敲一下：預覽才會立刻依新尺寸重排，
    // 不必等瀏覽器自己送出 resize（分頁沒在繪製時會延後）。
    document.querySelectorAll('.setlist-preview').forEach((frame) => {
      try { frame.contentWindow?.dispatchEvent(new Event('resize')); } catch (e) { /* 跨來源或尚未載入 */ }
    });
    const sizeLabel = workspaceText(size.labelKey, size.fallback);
    document.querySelectorAll('.setlist-preview-tag').forEach((tag) => { tag.textContent = sizeLabel; });
    setlistPreviewButtons.forEach((button) => {
      const selected = button.dataset.setlistPreviewSize === setlistPreviewSize;
      button.setAttribute('aria-checked', String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle('is-selected', selected);
    });
  }
  function chooseSetlistPreviewSize(key) {
    if (!SETLIST_PREVIEW_SIZES[key]) return;
    setlistPreviewSize = key;
    applySetlistPreviewSize();
  }

  function refreshSetlistUrl() {
    if (dom.setlistObsUrl) dom.setlistObsUrl.textContent = buildSetlistUrl();
    const generalUrl = document.getElementById('setlist-url-general');
    if (generalUrl) generalUrl.textContent = buildSetlistUrl();
    // 同步更新面板內的歌單預覽 iframe（選版型/主題即時看到變化）。
    // 預覽 iframe 必須保留 ?preview=1——沒帶的話會被伺服器當成真的 OBS 歌單來源計入連線數。
    const want = buildSetlistUrl({ preview: true, relative: true });
    document.querySelectorAll('.setlist-preview').forEach((prev) => {
      prev.dataset.previewSrc = want;
      if (prev.hasAttribute('src') && prev.getAttribute('src') !== want) prev.setAttribute('src', want);
    });
    applySetlistPreviewSize();
  }
  window.addEventListener('i18n:change', refreshSetlistUrl);
  window.addEventListener('access:source-token', refreshSetlistUrl);

  // 版型類別：用於只顯示真正會作用的控制項；外觀值本身每個模板各自保存。
  const SETLIST_SCENE = ['timeline', 'diagonal', 'constellation'];
  const SETLIST_LAYOUTS = ['classic', 'simple', 'timeline', 'diagonal', 'constellation', 'terminal', 'billboard', 'cards', 'signal', 'index', 'label', 'glow', 'round', 'pager', 'flap', 'note', 'film'];
  const SETLIST_LAYOUT_UI = {
    classic: { name: '經典資訊', hint: '現在、未唱、已唱一次看懂，最完整的常駐歌單。', scope: '設定只套用並保存於這個模板；切換模板不會影響其他歌單。' },
    cards: { name: '卡片清單', hint: '緊湊的卡片清單，已唱／未唱各自分群，可勾選要保留哪一段。', scope: '設定只套用並保存於這個模板；切換模板不會影響其他歌單。' },
    signal: { name: '舞台訊號', hint: '貼齊來源底部的導播資訊條，正在播放是唯一主角。', scope: '設定只套用並保存於這個模板；切換模板不會影響其他歌單。' },
    index: { name: '章節索引', hint: '曲序表：已唱／正在播放／待播分段標示，一眼掃讀。', scope: '設定只套用並保存於這個模板；切換模板不會影響其他歌單。' },
    diagonal: { name: '斜線舞台', hint: '全幅 16:9 場景；資訊在左、右側留給角色或遊戲。', scope: '設定只套用並保存於這個模板；切換模板不會影響其他歌單。' },
    timeline: { name: '時間軸', hint: '全幅 16:9 場景；適合想讓歌單成為畫面主角的直播段落。', scope: '設定只套用並保存於這個模板；切換模板不會影響其他歌單。' },
    simple: { name: '極簡兩排', hint: '置中卡片，只保留現在與下一首，畫面最輕量。', scope: '設定只套用並保存於這個模板；切換模板不會影響其他歌單。' },
    billboard: { name: '排行榜', hint: '活動型的排行榜視覺，已唱／未唱各自分群。', scope: '設定只套用並保存於這個模板；切換模板不會影響其他歌單。' },
    constellation: { name: '星座', hint: '裝飾性較強的全幅場景；建議搭配簡潔背景。', scope: '設定只套用並保存於這個模板；切換模板不會影響其他歌單。' },
    terminal: { name: '終端機', hint: '復古資訊風，適合科技或遊戲主題。', scope: '設定只套用並保存於這個模板；切換模板不會影響其他歌單。' },
    label: { name: '紙牌標籤', hint: '色塊小標籤＋錯位紙卡，手作感較強的聊天型歌回。', scope: '設定只套用並保存於這個模板；切換模板不會影響其他歌單。' },
    glow: { name: '夜間霓虹', hint: '等寬字體、細框發光，適合夜唱或科技主題。', scope: '設定只套用並保存於這個模板；切換模板不會影響其他歌單。' },
    round: { name: '圓角氣泡', hint: '每首歌一顆膠囊，正在播放放大加亮。', scope: '設定只套用並保存於這個模板；切換模板不會影響其他歌單。' },
    pager: { name: '復古字卡', hint: '模擬 LCD 呼叫器，等寬字＋掃描線。', scope: '設定只套用並保存於這個模板；切換模板不會影響其他歌單。' },
    note: { name: '手帳頁', hint: '橫線筆記本側欄，單一清單，已唱蓋章；適合聊天型歌回。', scope: '設定只套用並保存於這個模板；切換模板不會影響其他歌單。' },
    flap: { name: '發車看板', hint: '貼齊來源底部的發車標橫帶，正在播放置中、以它為中心捲動路線。', scope: '設定只套用並保存於這個模板；切換模板不會影響其他歌單。' },
    film: { name: '底片邊條', hint: '全幅場景；貼邊 35mm 底片，正在播放的那格框在片門裡。', scope: '設定只套用並保存於這個模板；切換模板不會影響其他歌單。' },
  };
  // 暫停提供的場景模板仍留在 renderer／server 驗證清單，讓已保存的 OBS 畫面不會被自動改版。
  // 它們只從「新選擇」入口與設定面板隱藏，使用者選到其他現行模板後才會真正切換。
  const SETLIST_HIDDEN_LAYOUTS = ['diagonal', 'timeline', 'constellation'];
  const setlistLayoutButtons = Array.from(document.querySelectorAll('[data-setlist-layout]'));
  // 清單型模板＝來源即畫布；場景型維持原本的全幅舞台語意。
  const SETLIST_SKIN_LAYOUTS = ['label', 'glow', 'round', 'pager'];
  const SETLIST_FILL_LAYOUTS = ['classic', 'cards', 'simple', 'terminal', 'billboard', 'signal', 'index', 'flap', 'note', ...SETLIST_SKIN_LAYOUTS];
  // flap／note 走填滿；film 是全幅場景。四者暫歸 'list' 類，共用既有清單型調整項。

  // 清單型：填滿來源、有已唱／未唱區塊。單點式：填滿來源但版位固定、只呈現現在播放。
  const SETLIST_SECTIONED_LAYOUTS = ['classic', 'cards', 'terminal', 'billboard', 'index', ...SETLIST_SKIN_LAYOUTS];

  function syncSetlistSizingHint() {
    const hint = document.getElementById('setlist-sizing-hint');
    if (!hint) return;
    const layout = setlistLayoutSel?.value || 'classic';
    if (SETLIST_SECTIONED_LAYOUTS.includes(layout)) {
      hint.textContent = '大小與顯示首數跟著你在 OBS 拉的 Browser Source 寬高變化。';
    } else if (SETLIST_FILL_LAYOUTS.includes(layout)) {
      hint.textContent = '版位固定，來源寬高只決定寬度與字級；不顯示已唱與未唱清單。';
    } else {
      hint.textContent = '全幅 16:9 舞台，建議把 Browser Source 設成相同比例。';
    }
  }

  function syncSetlistLayoutPicker() {
    if (!setlistLayoutSel) return;
    const layout = setlistLayoutSel.value || 'classic';
    const info = SETLIST_LAYOUT_UI[layout] || SETLIST_LAYOUT_UI.classic;
    const isHiddenLayout = SETLIST_HIDDEN_LAYOUTS.includes(layout);
    setlistLayoutButtons.forEach((button) => {
      const selected = button.dataset.setlistLayout === layout;
      button.setAttribute('aria-checked', String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle('is-selected', selected);
    });
    const hint = document.getElementById('setlist-layout-hint');
    const status = document.getElementById('setlist-layout-status');
    const workspaceStatus = document.getElementById('setlist-workspace-template-status');
    const scope = document.getElementById('setlist-style-scope');
    const legacyNotice = document.getElementById('setlist-legacy-layout-notice');
    const appearance = document.getElementById('setlist-appearance');
    const advancedButton = document.getElementById('btn-setlist-advanced');
    if (hint) hint.textContent = translateText(isHiddenLayout ? '這個模板已暫停提供；選擇目前可用的模板後才會切換 OBS 輸出。' : info.hint);
    const localizedName = translateText(info.name);
    const layoutLabel = isHiddenLayout
      ? workspaceText('settings.workspace.pausedTemplate', `${localizedName}（暫停提供）`, { template: localizedName })
      : localizedName;
    const statusText = workspaceText('settings.workspace.currentTemplate', `目前：${layoutLabel}`, { template: layoutLabel });
    if (status) status.textContent = statusText;
    if (workspaceStatus) workspaceStatus.textContent = statusText;
    if (scope) scope.textContent = translateText(isHiddenLayout ? '已保留目前 OBS 畫面與保存設定；為避免誤改，這個模板的調整項目暫時收起。' : info.scope);
    if (legacyNotice) legacyNotice.hidden = !isHiddenLayout;
    if (appearance) appearance.hidden = isHiddenLayout;
    if (advancedButton) advancedButton.hidden = isHiddenLayout;
    syncSetlistSizingHint();
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
  setlistPreviewButtons.forEach((button, index) => {
    button.addEventListener('click', () => chooseSetlistPreviewSize(button.dataset.setlistPreviewSize));
    button.addEventListener('keydown', (event) => {
      const lastIndex = setlistPreviewButtons.length - 1;
      let nextIndex = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = index === lastIndex ? 0 : index + 1;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = index === 0 ? lastIndex : index - 1;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = lastIndex;
      if (nextIndex === null) return;
      event.preventDefault();
      const next = setlistPreviewButtons[nextIndex];
      chooseSetlistPreviewSize(next.dataset.setlistPreviewSize);
      next.focus();
    });
  });
  // 面板寬度改變時預覽縮圖要重新對齊目前模擬的來源寬度。
  window.addEventListener('resize', applySetlistPreviewSize);
  document.addEventListener('view:change', () => setTimeout(applySetlistPreviewSize, 60));
  // 'skin' 類：8 款皮膚只有原型 label/glow/round/pager，配色/裝飾是固定設計，
  // 不吃 accent／可讀性襯底／特效等一般清單型設定；獨立分類才能正確隱藏無效控制項。
  function setlistCategory() {
    const l = setlistLayoutSel ? setlistLayoutSel.value : 'classic';
    if (SETLIST_SCENE.includes(l)) return 'scene';
    if (SETLIST_SKIN_LAYOUTS.includes(l)) return 'skin';
    return l === 'classic' ? 'classic' : 'list';
  }
  // 每個模板都持有自己的外觀快照；切換模板只讀寫目前這一份。
  function setlistTarget() {
    const l = setlistLayoutSel ? setlistLayoutSel.value : 'classic';
    return SETLIST_LAYOUTS.includes(l) ? l : 'classic';
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
      copyText(buildSetlistUrl(), dom.copySetlistUrlTop, workspaceText('common.copied', '已複製'));
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
      syncSetlistControlsForLayout();
      syncSetlistLayoutPicker();
      refreshSetlistUrl();
      SocketClient.send('setlist:layout', { layout: setlistLayoutSel.value || 'classic' });
    });
  }
  syncSetlistControlsForLayout();
  syncSetlistLayoutPicker();
  refreshSetlistUrl();
  window.addEventListener('i18n:change', syncSetlistLayoutPicker);

  // 歌單外觀細項：縮放 / 背板底色+不透明度 / 文字顏色覆蓋。
  // 改動只送 socket → 伺服器廣播 setlist:style，預覽 iframe 與真實 OBS 同步即時更新（與主題同機制）。
  (function initSetlistStyleControls() {
    const g = (id) => document.getElementById(id);
    if (!g('sls-accent')) return; // 不在歌單 view
    const setVal = (id, t) => { const e = g(id); if (e) e.textContent = t; };

    // 欄位定義（型別/預設值/邊界/CSS 套用）單一事實來源在 setlist-style-schema.js，
    // 這裡只負責「把 schema 欄位接到對應的 HTML 控制項」，新增欄位不需要再改這個檔案，
    // 只有「一個控制項對應多個輸出欄位」的特例（textColor）才需要在下面手動處理。
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
      // ── 特例：字體（預設下拉 + 自訂／系統字體）──
      Object.keys(FONT_FIELD_IDS).forEach((key) => { out[key] = readFontValue(key); });
      out.target = setlistTarget();
      return out;
    }

    // ── 特例：字體（fontDisplay/fontBody/fontMono）——
    // 下拉預設 + 「自訂／系統字體…」：選了自訂才顯示系統字體下拉／手動輸入。
    // 欄位值本身仍是單一字體名稱字串（schema 的 cssTransform 會補上回退堆疊）。
    const FONT_FIELD_IDS = { fontDisplay: 'sls-font-display', fontBody: 'sls-font-body', fontMono: 'sls-font-mono' };
    const CUSTOM_FONT_VALUE = '__custom__';
    function fontPresetValues(key) {
      const sel = g(FONT_FIELD_IDS[key]);
      if (!sel) return [];
      return Array.from(sel.options).map((o) => o.value).filter((v) => v !== CUSTOM_FONT_VALUE);
    }
    function readFontValue(key) {
      const sel = g(FONT_FIELD_IDS[key]);
      if (!sel) return schema.FIELD_BY_KEY[key].default;
      if (sel.value !== CUSTOM_FONT_VALUE) return sel.value;
      const custom = g(`${FONT_FIELD_IDS[key]}-custom`);
      const name = (custom?.value || '').trim();
      return name || schema.FIELD_BY_KEY[key].default;
    }
    function writeFontValue(key, value) {
      const sel = g(FONT_FIELD_IDS[key]);
      const wrap = g(`${FONT_FIELD_IDS[key]}-custom-wrap`);
      const custom = g(`${FONT_FIELD_IDS[key]}-custom`);
      if (!sel) return;
      const isPreset = fontPresetValues(key).includes(value);
      sel.value = isPreset ? value : CUSTOM_FONT_VALUE;
      if (wrap) wrap.hidden = isPreset;
      if (!isPreset && custom) custom.value = value || '';
    }
    // 系統字體清單：伺服器 /api/fonts 掃描本機字體目錄為主，瀏覽器 queryLocalFonts()（若可用）補充。
    let cachedFontList = null;
    async function fetchAllFonts() {
      if (cachedFontList) return cachedFontList;
      const names = new Set();
      try {
        const r = await fetch('/api/fonts');
        const data = await r.json();
        if (data && data.success && Array.isArray(data.fonts)) data.fonts.forEach((f) => names.add(f));
      } catch (_) { /* 伺服器掃描失敗 → 退回瀏覽器 API */ }
      if (typeof window.queryLocalFonts === 'function') {
        try { (await window.queryLocalFonts()).forEach((f) => names.add(f.family)); } catch (_) { /* 使用者拒絕授權時仍有伺服器來源 */ }
      }
      cachedFontList = [...names].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
      return cachedFontList;
    }
    // 字體名稱只寫進 textContent/value 與單一 CSSOM 屬性，不會被拼進 HTML/attribute 字串。
    function setFontSelectOptions(select, fams, placeholder) {
      if (!select) return;
      const fragment = document.createDocumentFragment();
      const emptyOption = document.createElement('option');
      emptyOption.value = ''; emptyOption.textContent = placeholder;
      fragment.appendChild(emptyOption);
      fams.forEach((family) => {
        if (typeof family !== 'string' || !family) return;
        const option = document.createElement('option');
        option.value = family; option.textContent = family; option.style.fontFamily = family;
        fragment.appendChild(option);
      });
      select.textContent = ''; select.appendChild(fragment);
    }
    function initFontPicker(key) {
      const baseId = FONT_FIELD_IDS[key];
      const sel = g(baseId);
      if (!sel) return;
      const wrap = g(`${baseId}-custom-wrap`);
      const custom = g(`${baseId}-custom`);
      const sysSel = g(`${baseId}-system`);
      const loadBtn = g(`${baseId}-load`);
      sel.addEventListener('change', () => {
        if (sel.value === CUSTOM_FONT_VALUE) {
          if (wrap) wrap.hidden = false;
          if (!(custom?.value || '').trim()) return; // 自訂欄位還空著就先不送，避免用預設字體覆蓋掉
        } else if (wrap) wrap.hidden = true;
        sendStyle();
      });
      if (custom) custom.addEventListener('input', () => sendStyle());
      if (sysSel) sysSel.addEventListener('change', () => {
        if (sysSel.value) { if (custom) custom.value = sysSel.value; sendStyle(); }
      });
      if (loadBtn) loadBtn.addEventListener('click', async () => {
        try {
          loadBtn.disabled = true; loadBtn.textContent = '載入中…';
          const fams = await fetchAllFonts();
          if (!fams.length) { AppShared.showToast('讀取系統字體失敗，請改用手動輸入', 'error'); return; }
          setFontSelectOptions(sysSel, fams, '（選擇系統字體）');
          const current = (custom?.value || '').trim();
          if (current && fams.includes(current)) sysSel.value = current;
          AppShared.showToast(`已載入 ${fams.length} 個系統字體`);
        } catch (e) {
          AppShared.showToast('讀取系統字體失敗，請改用手動輸入', 'error');
        } finally {
          loadBtn.disabled = false; loadBtn.textContent = '瀏覽系統字體';
        }
      });
    }
    Object.keys(FONT_FIELD_IDS).forEach(initFontPicker);
    // 各版型獨立設定的本地快取（伺服器為真實來源；切版型時還原該份）
    const slStores = Object.fromEntries(SETLIST_LAYOUTS.map((layout) => [layout, null]));
    let latestStyleSaveRequest = 0;
    let styleSaveStatus = {
      state: 'saved',
      key: 'settings.workspace.liveSaved',
      fallback: '已即時儲存',
      vars: null,
      savedAt: null,
    };
    function renderStyleSaveStatus() {
      let vars = styleSaveStatus.vars || undefined;
      let fallback = styleSaveStatus.fallback;
      if (styleSaveStatus.savedAt) {
        const time = new Date(styleSaveStatus.savedAt).toLocaleTimeString(window.I18n?.current?.() || 'zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        vars = { time };
        fallback = `已儲存 ${time}`;
      }
      const message = workspaceText(styleSaveStatus.key, fallback, vars);
      document.querySelectorAll('[data-setlist-save-status]').forEach((status) => {
        status.classList.remove('saving', 'saved', 'error');
        status.classList.add(styleSaveStatus.state);
        status.textContent = message;
      });
    }
    function setStyleSaveStatus(state, key, fallback, vars, savedAt) {
      styleSaveStatus = { state, key, fallback, vars: vars || null, savedAt: savedAt || null };
      renderStyleSaveStatus();
    }
    function confirmStyleSaved() {
      const requestId = ++latestStyleSaveRequest;
      setStyleSaveStatus('saving', 'settings.workspace.saving', '儲存中…');
      // 伺服器端的 state-store 已有 800ms 磁碟 debounce；前端不應再等待，
      // 否則面板與真實 OBS 來源都會延遲。每次操作只送一個帶 ACK 的事件，
      // 並以 requestId 忽略較舊回應，避免舊狀態覆蓋最新儲存結果。
      SocketClient.sendWithCallback('setlist:style', collectStyle(), (result, transportError) => {
        if (requestId !== latestStyleSaveRequest) return;
        if (result?.ok) {
          setStyleSaveStatus('saved', 'settings.workspace.savedAt', '已儲存', null, result.savedAt || Date.now());
        } else {
          const message = result?.error || transportError?.code || workspaceText('twitch.error.noResponse', '伺服器沒有回應');
          setStyleSaveStatus('error', 'settings.workspace.saveFailed', `儲存失敗：${message}`, { message });
        }
      });
    }
    function sendStyle() {
      confirmStyleSaved();
    }
    renderStyleSaveStatus();
    window.addEventListener('i18n:change', renderStyleSaveStatus);

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
      // ── 特例：字體 ──
      Object.keys(FONT_FIELD_IDS).forEach((key) => { if (s[key] != null) writeFontValue(key, s[key]); });
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
    const tt = g('sls-text-theme'), tc = g('sls-text-color');
    if (tt) tt.addEventListener('change', () => { if (tc) tc.disabled = tt.checked; sendStyle(); });
    if (tc) tc.addEventListener('input', sendStyle);

    // 風格預設（一鍵套一組值，再廣播）
    const PRESETS = {
      sand: { accent: '#d9a25c', accentBright: '#f0c587', textPrimary: '#f0ead8', textSec: 72, textDone: 54, textMeta: 62, cardColor: '#0b0907', cardOpacity: 93, borderColor: '#f0ead8', borderOpacity: 9, bgColor: '#000000', bgOpacity: 0, blurAmount: 20, borderRadius: 14, doneOpacity: 54, waitOpacity: 72, readabilityGuard: true, shadowEnabled: false, fontDisplay: 'Fraunces', fontBody: 'Manrope' },
      glass: { accent: '#7c6cff', accentBright: '#a395ff', textPrimary: '#ffffff', textSec: 74, textDone: 56, textMeta: 64, cardColor: '#000000', cardOpacity: 72, borderColor: '#7c6cff', borderOpacity: 35, bgColor: '#000000', bgOpacity: 0, blurAmount: 12, borderRadius: 12, doneOpacity: 56, waitOpacity: 74, readabilityGuard: true, shadowEnabled: false },
      neon: { accent: '#00ff9f', accentBright: '#a0ffe0', textPrimary: '#e6fff5', textSec: 76, textDone: 58, textMeta: 66, cardColor: '#001610', cardOpacity: 82, borderColor: '#00ff9f', borderOpacity: 25, bgColor: '#000000', bgOpacity: 0, blurAmount: 4, borderRadius: 6, doneOpacity: 58, waitOpacity: 76, readabilityGuard: true, shadowEnabled: true, shadowOpacity: 40, shadowBlur: 24 },
      minimal: { accent: '#ffffff', accentBright: '#ffffff', textPrimary: '#ffffff', textSec: 72, textDone: 54, textMeta: 62, cardColor: '#000000', cardOpacity: 0, borderColor: '#ffffff', borderOpacity: 0, borderWidth: 0, bgColor: '#000000', bgOpacity: 0, blurAmount: 0, borderRadius: 8, doneOpacity: 54, waitOpacity: 72, readabilityGuard: true, shadowEnabled: false },
      dark: { accent: '#ffffff', accentBright: '#ffffff', textPrimary: '#e8e8ec', textSec: 72, textDone: 54, textMeta: 62, cardColor: '#050408', cardOpacity: 96, borderColor: '#ffffff', borderOpacity: 6, bgColor: '#000000', bgOpacity: 0, blurAmount: 0, borderRadius: 10, doneOpacity: 54, waitOpacity: 72, readabilityGuard: true, shadowEnabled: false },
      light: { accent: '#1e1450', accentBright: '#3a2880', textPrimary: '#140a3c', textSec: 76, textDone: 58, textMeta: 68, cardColor: '#ffffff', cardOpacity: 92, borderColor: '#000000', borderOpacity: 10, bgColor: '#000000', bgOpacity: 0, blurAmount: 0, borderRadius: 10, doneOpacity: 58, waitOpacity: 76, readabilityGuard: true, shadowEnabled: false },
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
    // 重置只影響目前模板，不會覆寫其他模板已調好的外觀。
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
        b.type = 'button'; b.className = 'btn btn-sm btn-ghost sls-custom-chip__apply'; b.dataset.i18nSkip = '1'; b.textContent = name;
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

    // 詳細設定 Modal：入口位於右側固定預覽下方。
    const advBtn = g('btn-setlist-advanced'), advModal = g('setlist-advanced-modal'), advClose = g('setlist-advanced-close');
    if (advModal && advModal.parentElement !== document.body) document.body.appendChild(advModal);
    const workspace = window.SettingsWorkspace?.create(advModal, {
      onSelect: () => {
        if (!search?.value) return;
        search.value = '';
        filterSetlistSettings();
      },
    });
    if (advModal) advModal._settingsWorkspace = workspace;
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
        workspace?.setSearching(false);
        if (searchStatus) searchStatus.textContent = workspaceText('settings.setlist.searchHint', '可直接搜尋設定名稱或用途。');
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
      workspace?.setSearching(true);
      if (searchStatus) searchStatus.textContent = matches
        ? workspaceText('settings.setlist.searchMatches', `找到 ${matches} 個設定區塊。`, { count: matches })
        : workspaceText('settings.setlist.searchNoMatches', '找不到相符設定；可試試「字體」、「寬度」、「已唱」或「特效」。');
    }
    if (search) search.addEventListener('input', filterSetlistSettings);
    window.addEventListener('i18n:change', filterSetlistSettings);
    const closeAdvanced = () => {
      if (!advModal) return;
      if (search) { search.value = ''; filterSetlistSettings(); }
      advModal.hidden = true;
      window.PreviewLifecycle?.refresh();
      (advancedFocusBeforeOpen && advancedFocusBeforeOpen.isConnected ? advancedFocusBeforeOpen : advBtn)?.focus();
      advancedFocusBeforeOpen = null;
    };
    if (advBtn && advModal) advBtn.addEventListener('click', () => {
      advancedFocusBeforeOpen = document.activeElement;
      advModal.hidden = false;
      window.PreviewLifecycle?.refresh();
      workspace?.sync();
      window.setTimeout(() => search?.focus(), 0);
    });
    if (advClose && advModal) advClose.addEventListener('click', closeAdvanced);
    if (advModal) advModal.addEventListener('click', (e) => { if (e.target === advModal) closeAdvanced(); });
    if (advModal) advModal.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeAdvanced(); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(advModal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter((element) => element.getAttribute('aria-disabled') !== 'true' && !element.hidden && !element.closest('[hidden], .is-search-hidden, .settings-workspace__section-hidden'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });

    // 切版型時：還原該版型（場景版）或共用份的設定到 UI
    if (setlistLayoutSel) {
      setlistLayoutSel.addEventListener('change', () => {
        const st = slStores[setlistTarget()];
        if (st) adoptStyleUI(st);
        workspace?.sync();
      });
    }

    // Socket 同步（伺服器為真實來源）；payload = { target, style }（向後相容舊格式）。
    SocketClient.on('setlist:style', (payload) => {
      const t = (payload && payload.target) || 'classic';
      const st = (payload && payload.style) ? payload.style : payload;
      slStores[t] = st;
      if (t === setlistTarget()) adoptStyleUI(st);
    });
    function applySetlistControls(sess) {
      if (!sess) return;
      if (sess.styles && typeof sess.styles === 'object') {
        SETLIST_LAYOUTS.forEach((layout) => { if (sess.styles[layout]) slStores[layout] = sess.styles[layout]; });
      } else {
        // 可讀取舊 server payload：shared 作為所有模板的基底，舊場景設定再覆蓋對應模板。
        SETLIST_LAYOUTS.forEach((layout) => { if (sess.style) slStores[layout] = sess.style; });
        if (sess.sceneStyles) SETLIST_SCENE.forEach((layout) => { if (sess.sceneStyles[layout]) slStores[layout] = sess.sceneStyles[layout]; });
      }
      if (sess.theme && dom.setlistTheme) { dom.setlistTheme.value = sess.theme; refreshSetlistUrl(); }
      if (sess.layout && setlistLayoutSel) { setlistLayoutSel.value = sess.layout; syncSetlistControlsForLayout(); syncSetlistLayoutPicker(); refreshSetlistUrl(); workspace?.sync(); }
      const cur = slStores[setlistTarget()];
      if (cur) adoptStyleUI(cur);
    }

    // 控制端初始外觀改走 setlist:update，避免 state:sync 帶著所有模板快照。
    SocketClient.on('setlist:update', applySetlistControls);
    SocketClient.on('state:sync', (state) => applySetlistControls(state && state.session));
    SocketClient.on('connection-change', (connected) => {
      if (connected) SocketClient.send('setlist:get');
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
