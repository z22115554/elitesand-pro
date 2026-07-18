/**
 * Elitesand Pro — 側欄導覽 + Onboarding + 預留功能掛載點
 *
 * 目前所有功能都在同一頁，導覽項以「捲動定位 + active 高亮」運作。
 * 商城 / 會員 / 模板 / 個人檔案的導覽項在 HTML 中以 hidden 預留，
 * 未來啟用時：
 *   1. 移除該 nav-item 的 hidden 屬性
 *   2. 在 FUTURE_VIEWS 註冊對應的 render 函式
 *   3. 切換邏輯已寫好，會自動處理
 */
(function () {
  'use strict';

  // ─── 預留：未來頁面的掛載點（目前皆為 null＝停用）───
  // 之後要啟用商城，只要把對應函式補上即可，切換骨架已就緒。
  const FUTURE_VIEWS = {
    templates: null,    // () => 渲染模板頁
    marketplace: null,  // () => 渲染商城頁
    account: null,      // () => 渲染個人檔案頁
  };

  const navItems = document.querySelectorAll('.nav-item[data-nav]');
  const pageTitle = document.querySelector('.page-title');

  const TITLES = {
    karaoke: '首頁',
    playlist: '播放清單',
    setlist: '直播歌單',
    library: '媒體庫',
    settings: '歌詞設定',
    general: '連線與系統',
    twitch: 'Twitch 點歌',
    templates: '模板',
    marketplace: '商城',
    account: '帳號',
  };

  const views = document.querySelectorAll('.view[data-view]');
  const content = document.querySelector('.content');

  function setActive(nav) {
    navItems.forEach((b) => b.classList.toggle('active', b.dataset.nav === nav));
    if (pageTitle && TITLES[nav]) pageTitle.textContent = TITLES[nav];
  }

  // 真正切換視圖：顯示對應 data-view、隱藏其他
  function showView(nav) {
    let matched = false;
    views.forEach((v) => {
      const on = v.dataset.view === nav;
      v.classList.toggle('is-active', on);
      if (on) matched = true;
    });
    if (content) content.scrollTop = 0;
    if (matched) document.dispatchEvent(new CustomEvent('view:change', { detail: { view: nav } }));
    return matched;
  }

  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const nav = btn.dataset.nav;

      // 未來頁面（已註冊 render 函式）→ 呼叫之
      if (FUTURE_VIEWS[nav]) {
        setActive(nav);
        FUTURE_VIEWS[nav]();
        return;
      }

      setActive(nav);
      showView(nav);
    });
  });

  // 對外暴露：之後啟用商城/會員時可呼叫 EliteNav.enableView('marketplace', renderFn)
  window.EliteNav = {
    enableView(nav, renderFn) {
      FUTURE_VIEWS[nav] = renderFn;
      const item = document.querySelector(`.nav-item[data-nav="${nav}"]`);
      if (item) item.hidden = false;
    },
  };

  // ─── Onboarding 提示（首次使用顯示一次）───
  const HINT_KEY = 'elite-onboard-dismissed';
  const hint = document.getElementById('onboard-hint');
  const hintClose = document.getElementById('onboard-close');
  if (hint) {
    let dismissed = false;
    try { dismissed = localStorage.getItem(HINT_KEY) === '1'; } catch (e) { /* 靜默 */ }
    if (!dismissed) hint.hidden = false;
    if (hintClose) {
      hintClose.addEventListener('click', () => {
        hint.hidden = true;
        try { localStorage.setItem(HINT_KEY, '1'); } catch (e) { /* 靜默 */ }
      });
    }
  }

  // ─── 新手教學 modal：側欄「教學」按鈕、Onboarding 提示裡的連結都能開 ───
  const helpModal = document.getElementById('help-modal');
  if (helpModal) {
    const GUIDE_KEY = 'elite-guide-completed-v2';
    const LEGACY_GUIDE_KEY = 'elite-guide-completed-v1';
    const GUIDE_POSTPONED_KEY = 'elite-guide-postponed-v2';
    let firstRunRequired = false;
    const checklist = { environment: false, song: false, obs: false, websocket: false, twitch: false };
    const readiness = { control: SocketClient.connected(), obsWebSocket: typeof ObsWs !== 'undefined' && ObsWs.isConnected(), ytdlp: false, ffmpeg: false };
    const completeBtn = document.getElementById('guide-complete');
    const laterBtn = document.getElementById('guide-later');
    const openHelp = () => { helpModal.hidden = false; updateGuideRoute(); refreshReadiness(); };
    const closeHelp = (completed = false, postponed = false) => {
      if (firstRunRequired && !completed && !postponed) return;
      helpModal.hidden = true;
      if (completed) {
        firstRunRequired = false;
        if (closeBtn) closeBtn.hidden = false;
        try { localStorage.setItem(GUIDE_KEY, '1'); } catch (e) { /* 靜默 */ }
      } else if (postponed) {
        firstRunRequired = false;
        if (closeBtn) closeBtn.hidden = false;
        if (hint) hint.hidden = false;
        try { localStorage.setItem(GUIDE_POSTPONED_KEY, '1'); } catch (e) { /* 靜默 */ }
      }
    };
    const openBtn = document.getElementById('btn-open-help');
    const onboardOpenBtn = document.getElementById('onboard-open-help');
    const closeBtn = document.getElementById('help-close');
    if (openBtn) openBtn.addEventListener('click', openHelp);
    if (onboardOpenBtn) onboardOpenBtn.addEventListener('click', openHelp);
    if (closeBtn) closeBtn.addEventListener('click', () => closeHelp(false));
    if (completeBtn) completeBtn.addEventListener('click', () => {
      if (checklist.environment && checklist.song && checklist.obs) closeHelp(true);
    });
    if (laterBtn) laterBtn.addEventListener('click', () => closeHelp(false, true));
    helpModal.addEventListener('click', (e) => { if (e.target === helpModal) closeHelp(false); });

    // 新手路徑：先讓使用者看見一次歌詞，再慢慢處理下載工具與 OBS。
    let guideStartPath = null;
    const GUIDE_PREVIEW_COMPLETE_KEY = 'elite-guide-preview-complete-v1';
    let guideFirstSuccess = false;
    try { guideFirstSuccess = localStorage.getItem(GUIDE_PREVIEW_COMPLETE_KEY) === '1'; } catch (e) { /* 靜默 */ }
    const jumpToGuideTarget = (nav, targetId) => {
      helpModal.hidden = true;
      document.querySelector(`.nav-item[data-nav="${nav}"]`)?.click();
      requestAnimationFrame(() => {
        const target = document.getElementById(targetId);
        if (!target) return;
        if (target.tagName === 'DETAILS') target.open = true;
        target.classList.remove('guide-target-highlight');
        void target.offsetWidth;
        target.classList.add('guide-target-highlight');
        target.setAttribute('tabindex', '-1');
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.focus({ preventScroll: true });
        window.clearTimeout(target._guideHighlightTimer);
        target._guideHighlightTimer = window.setTimeout(() => target.classList.remove('guide-target-highlight'), 2400);
      });
    };
    const updateGuideRoute = () => {
      const route = document.getElementById('guide-route');
      const status = document.getElementById('guide-route-status');
      const confirm = document.getElementById('guide-confirm-preview');
      const success = document.getElementById('guide-route-success');
      if (route) route.hidden = guideFirstSuccess;
      if (confirm) confirm.disabled = !guideStartPath || guideFirstSuccess;
      if (success) success.hidden = !guideFirstSuccess;
      if (status) status.textContent = guideFirstSuccess ? '第一次成功完成' : (guideStartPath === 'sample' ? '確認右側出現示範文字' : guideStartPath === 'song' ? '匯入完成後回來確認' : '選一種開始方式');
    };
    document.getElementById('guide-start-sample')?.addEventListener('click', () => {
      guideStartPath = 'sample';
      updateGuideRoute();
      jumpToGuideTarget('karaoke', 'lyrics-preview-card');
      document.getElementById('btn-preview-sample-lyrics')?.click();
    });
    document.getElementById('guide-start-song')?.addEventListener('click', () => {
      guideStartPath = 'song';
      updateGuideRoute();
      jumpToGuideTarget('karaoke', 'music-source-card');
    });
    document.getElementById('guide-confirm-preview')?.addEventListener('click', () => {
      if (!guideStartPath) return;
      guideFirstSuccess = true;
      try { localStorage.setItem(GUIDE_PREVIEW_COMPLETE_KEY, '1'); } catch (e) { /* 靜默 */ }
      updateGuideRoute();
    });

    document.querySelectorAll('.onboard-task[data-guide-nav][data-guide-target]').forEach((task) => {
      task.addEventListener('click', () => jumpToGuideTarget(task.dataset.guideNav, task.dataset.guideTarget));
    });

    function updateChecklist() {
      checklist.environment = readiness.control && readiness.ytdlp && readiness.ffmpeg;
      checklist.websocket = readiness.obsWebSocket;
      const tasks = {
        environment: ['guide-task-environment', '環境可用'],
        song: ['guide-task-song', '已加入第一首歌'],
        obs: ['guide-task-obs', 'OBS 歌詞來源已連線'],
        websocket: ['guide-task-websocket', 'OBS WebSocket 已連線（選配）'],
        twitch: ['guide-task-twitch', 'Twitch 已連線（選配）'],
      };
      Object.entries(tasks).forEach(([key, [id, doneText]]) => {
        const task = document.getElementById(id);
        if (!task) return;
        task.classList.toggle('done', checklist[key]);
        const mark = task.querySelector('.onboard-task-mark');
        if (mark) mark.textContent = checklist[key] ? '✓' : ((key === 'twitch' || key === 'websocket') ? '選' : String(['environment', 'song', 'obs'].indexOf(key) + 1));
        if (checklist[key]) task.setAttribute('aria-label', doneText);
      });
      const completed = ['environment', 'song', 'obs'].filter(key => checklist[key]).length;
      const progress = document.getElementById('guide-checklist-progress');
      if (progress) {
        progress.textContent = `${completed} / 3`;
        progress.classList.toggle('ok', completed === 3);
        progress.classList.toggle('pending', completed !== 3);
      }
      if (completeBtn) completeBtn.disabled = completed !== 3;
    }

    function setReadiness(id, state, text) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('pending', 'ok', 'error');
      el.classList.add(state === true ? 'ok' : state === 'pending' ? 'pending' : 'error');
      el.textContent = text;
    }

    function refreshReadiness() {
      readiness.control = SocketClient.connected();
      setReadiness('guide-check-control', readiness.control, readiness.control ? '控制台已連線' : '控制台未連線');
      readiness.obsWebSocket = typeof ObsWs !== 'undefined' && ObsWs.isConnected();
      setReadiness('guide-check-websocket', readiness.obsWebSocket, readiness.obsWebSocket ? 'OBS WebSocket 已連線' : 'OBS WebSocket 未連線');
      fetch('/api/system-check').then((res) => res.json()).then((data) => {
        readiness.ytdlp = !!data.ytdlp?.available;
        readiness.ffmpeg = !!data.ffmpeg?.available;
        setReadiness('guide-check-ytdlp', readiness.ytdlp, readiness.ytdlp ? `yt-dlp ${data.ytdlp.version}` : '找不到 yt-dlp');
        setReadiness('guide-check-ffmpeg', readiness.ffmpeg, readiness.ffmpeg ? 'FFmpeg 已就緒' : '找不到 FFmpeg');
        updateChecklist();
        return fetch('/api/update-check').then((res) => res.json()).then((update) => {
          const newer = update && update.hasUpdate && update.latestVersion;
          setReadiness('guide-check-version', true, newer ? `可更新 v${update.latestVersion}` : `目前 v${data.appVersion}`);
        });
      }).catch(() => {
        readiness.ytdlp = false;
        readiness.ffmpeg = false;
        setReadiness('guide-check-ytdlp', false, 'yt-dlp 檢查失敗');
        setReadiness('guide-check-ffmpeg', false, 'FFmpeg 檢查失敗');
        setReadiness('guide-check-version', false, '版本檢查失敗');
        updateChecklist();
      });
      PinAuth.fetchWithPin('/api/twitch/status').then(res => res.json()).then((data) => {
        checklist.twitch = !!data.connected;
        updateChecklist();
      }).catch(() => { checklist.twitch = false; updateChecklist(); });
    }

    SocketClient.on('connection-change', (connected) => {
      readiness.control = connected;
      setReadiness('guide-check-control', connected, connected ? '控制台已連線' : '控制台未連線');
      updateChecklist();
    });
    if (typeof ObsWs !== 'undefined') {
      ObsWs.on('status', (status) => {
        readiness.obsWebSocket = !!status?.connected;
        setReadiness('guide-check-websocket', status?.connecting ? 'pending' : readiness.obsWebSocket,
          status?.connecting ? 'OBS WebSocket 連線中' : readiness.obsWebSocket ? 'OBS WebSocket 已連線' : 'OBS WebSocket 未連線');
        updateChecklist();
      });
    }
    SocketClient.on('state:sync', (state) => {
      checklist.song = Array.isArray(state?.playlist) && state.playlist.length > 0;
      updateChecklist();
    });
    SocketClient.on('state:recovery', (state) => {
      checklist.song = Array.isArray(state?.playlist) && state.playlist.length > 0;
      updateChecklist();
    });
    SocketClient.on('playlist:update', (playlist) => {
      checklist.song = Array.isArray(playlist) && playlist.length > 0;
      updateChecklist();
    });
    SocketClient.on('client:counts', (counts) => {
      checklist.obs = Number(counts?.displays) > 0;
      updateChecklist();
    });
    const refreshBtn = document.getElementById('guide-check-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', refreshReadiness);
    refreshReadiness();

    let guideCompleted = false;
    let guidePostponed = false;
    try {
      guideCompleted = localStorage.getItem(GUIDE_KEY) === '1' || localStorage.getItem(LEGACY_GUIDE_KEY) === '1';
      guidePostponed = localStorage.getItem(GUIDE_POSTPONED_KEY) === '1';
      if (guideCompleted) localStorage.setItem(GUIDE_KEY, '1');
    } catch (e) { /* 靜默 */ }
    updateChecklist();
    if (SocketClient.connected()) {
      SocketClient.send('client:type', 'controller');
      SocketClient.send('state:request');
    }
    if (!guideCompleted && !guidePostponed) {
      firstRunRequired = true;
      if (closeBtn) closeBtn.hidden = true;
      if (hint) hint.hidden = true;
      openHelp();
    }
  }
})();
