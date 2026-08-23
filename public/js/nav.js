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

  const TITLE_KEYS = {
    karaoke: 'nav.home',
    playlist: 'nav.playlist',
    setlist: 'nav.setlistTitle',
    library: 'nav.library',
    settings: 'nav.lyricsSettings',
    general: 'nav.system',
    twitch: 'nav.twitch',
  };

  const views = document.querySelectorAll('.view[data-view]');
  const content = document.querySelector('.content');

  function setActive(nav) {
    navItems.forEach((b) => b.classList.toggle('active', b.dataset.nav === nav));
    if (pageTitle && TITLE_KEYS[nav]) pageTitle.textContent = window.I18n.t(TITLE_KEYS[nav]);
  }

  window.addEventListener('i18n:change', () => {
    const active = document.querySelector('.nav-item.active[data-nav]');
    if (active) setActive(active.dataset.nav);
  });

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
    // 全新使用者先由互動導覽接手；完成或略過後，這張短提示仍可作為回訪入口。
    if (!dismissed && (!window.OnboardingTour || window.OnboardingTour.isComplete())) hint.hidden = false;
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
    document.addEventListener('onboarding:open-full-guide', openHelp);
    document.addEventListener('onboarding:open-advanced-guide', () => {
      openHelp();
      requestAnimationFrame(() => document.getElementById('guide-advanced-route')?.scrollIntoView({ block: 'center' }));
    });
    document.getElementById('guide-start-interactive')?.addEventListener('click', () => {
      helpModal.hidden = true;
      firstRunRequired = false;
      if (closeBtn) closeBtn.hidden = false;
      window.OnboardingTour?.start({ force: true });
    });
    const startAdvancedChapter = (kind) => {
      helpModal.hidden = true;
      firstRunRequired = false;
      if (closeBtn) closeBtn.hidden = false;
      const chapter = window.OnboardingTour?.getAdvancedState?.()?.[kind];
      const resume = !!chapter && ['in_progress', 'postponed'].includes(chapter.status);
      window.OnboardingTour?.startAdvanced({ kind, force: !resume, resume });
    };
    document.getElementById('guide-start-lyrics')?.addEventListener('click', () => startAdvancedChapter('lyrics'));
    document.getElementById('guide-start-obs')?.addEventListener('click', () => startAdvancedChapter('obs'));
    document.getElementById('guide-start-live')?.addEventListener('click', () => startAdvancedChapter('live'));
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
      const interactive = document.getElementById('guide-start-interactive');
      const sample = document.getElementById('guide-start-sample');
      const song = document.getElementById('guide-start-song');
      const success = document.getElementById('guide-route-success');
      // 完成「最短路徑」後仍要保留基本互動導覽的回顧入口。
      // 只收起已完成的快速測試按鈕，不再把整個 section 隱藏。
      if (route) route.hidden = false;
      const tourCompleted = !!window.OnboardingTour?.isComplete?.();
      if (interactive) {
        const key = tourCompleted ? 'tour.guide.review' : 'tour.welcome.start';
        interactive.dataset.i18n = key;
        interactive.textContent = window.I18n ? window.I18n.t(key) : (tourCompleted ? '重新觀看新手導覽' : '開始互動導覽');
      }
      if (sample) sample.hidden = guideFirstSuccess;
      if (song) song.hidden = guideFirstSuccess;
      if (confirm) {
        confirm.hidden = guideFirstSuccess;
        confirm.disabled = !guideStartPath || guideFirstSuccess;
      }
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
      el.textContent = window.I18n ? window.I18n.translate(text) : text;
    }

    function refreshReadiness(options = {}) {
      const forceSystemCheck = options === true || options?.force === true;
      readiness.control = SocketClient.connected();
      setReadiness('guide-check-control', readiness.control, readiness.control ? '控制台已連線' : '控制台未連線');
      readiness.obsWebSocket = typeof ObsWs !== 'undefined' && ObsWs.isConnected();
      setReadiness('guide-check-websocket', readiness.obsWebSocket, readiness.obsWebSocket ? 'OBS WebSocket 已連線' : 'OBS WebSocket 未連線');
      const systemCheckRequest = fetch(forceSystemCheck ? '/api/system-check?force=1' : '/api/system-check', { cache: 'no-store' }).then((res) => res.json()).then((data) => {
        readiness.ytdlp = !!data.ytdlp?.available;
        readiness.ffmpeg = !!data.ffmpeg?.available;
        setReadiness('guide-check-ytdlp', readiness.ytdlp, readiness.ytdlp ? `yt-dlp ${data.ytdlp.version}` : '找不到 yt-dlp');
        setReadiness('guide-check-ffmpeg', readiness.ffmpeg, readiness.ffmpeg ? 'FFmpeg 已就緒' : '找不到 FFmpeg');
        const downloadBtn = document.getElementById('guide-ffmpeg-download');
        if (downloadBtn && !downloadBtn.dataset.busy) {
          downloadBtn.hidden = readiness.ffmpeg || !data.ffmpeg?.downloadable;
        }
        setReadiness('ffmpeg-status', readiness.ffmpeg, readiness.ffmpeg ? 'FFmpeg 已就緒' : '找不到 FFmpeg，YouTube 匯入的轉檔步驟需要它');
        const settingsFfmpegBtn = document.getElementById('ffmpeg-download-btn');
        if (settingsFfmpegBtn && !settingsFfmpegBtn.dataset.busy) {
          settingsFfmpegBtn.hidden = readiness.ffmpeg || !data.ffmpeg?.downloadable;
        }
        updateChecklist();
        return fetch('/api/update-check').then((res) => res.json()).then((update) => {
          const newer = update && update.hasUpdate && update.latestVersion;
          setReadiness('guide-check-version', true, newer
            ? window.I18n.t('guide.updateVersion', { version: update.latestVersion })
            : window.I18n.t('guide.currentVersion', { version: data.appVersion }));
        });
      }).catch(() => {
        readiness.ytdlp = false;
        readiness.ffmpeg = false;
        setReadiness('guide-check-ytdlp', false, 'yt-dlp 檢查失敗');
        setReadiness('guide-check-ffmpeg', false, 'FFmpeg 檢查失敗');
        setReadiness('ffmpeg-status', false, 'FFmpeg 檢查失敗');
        setReadiness('guide-check-version', false, '版本檢查失敗');
        updateChecklist();
      });
      PinAuth.fetchWithPin('/api/twitch/status').then(res => res.json()).then((data) => {
        checklist.twitch = !!data.connected;
        updateChecklist();
      }).catch(() => { checklist.twitch = false; updateChecklist(); });
      return systemCheckRequest;
    }

    function forceRefreshFfmpegReadiness() {
      readiness.ffmpeg = false;
      const checkingText = window.I18n ? window.I18n.t('guide.ffmpegChecking') : 'FFmpeg 檢查中…';
      setReadiness('guide-check-ffmpeg', 'pending', checkingText);
      setReadiness('ffmpeg-status', 'pending', checkingText);
      return refreshReadiness({ force: true });
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
    if (refreshBtn) refreshBtn.addEventListener('click', () => refreshReadiness({ force: true }));
    const ffmpegCheckBtn = document.getElementById('ffmpeg-check-btn');
    if (ffmpegCheckBtn) {
      ffmpegCheckBtn.addEventListener('click', () => {
        ffmpegCheckBtn.disabled = true;
        forceRefreshFfmpegReadiness().finally(() => { ffmpegCheckBtn.disabled = false; });
      });
    }
    document.addEventListener('view:change', (event) => {
      if (event.detail?.view === 'general') forceRefreshFfmpegReadiness();
    });
    window.addEventListener('elitesand:ffmpeg-invalidated', forceRefreshFfmpegReadiness);

    const guideT = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
    // 「新手教學」的節點跟「連線與系統」設定卡的節點各自獨立顯示/隱藏，
    // 但都是同一顆下載按鈕的行為，共用同一段邏輯，用哪個 pillId 就回報到哪個狀態文字。
    // updateText 收進這個陣列，換語言時（見下方 i18n:change）逐一重畫按鈕文字。
    const ffmpegButtonTextUpdaters = [];
    function wireFfmpegDownloadButton(btn, pillId) {
      if (!btn) return;
      let latestProgress = null;
      let progressTimer = null;
      const progressText = () => {
        if (!latestProgress || latestProgress.stage !== 'download' || !latestProgress.totalBytes) {
          return guideT('guide.ffmpegDownloadingButton');
        }
        const downloaded = (Number(latestProgress.downloadedBytes || 0) / (1024 * 1024)).toFixed(1);
        const total = (Number(latestProgress.totalBytes || 0) / (1024 * 1024)).toFixed(1);
        const speed = (Number(latestProgress.speedBytesPerSec || 0) / (1024 * 1024)).toFixed(2);
        const percent = Math.max(0, Math.min(100, Math.floor(Number(latestProgress.percent || 0))));
        return guideT('guide.ffmpegDownloadingProgress', { percent, downloaded, total, speed });
      };
      const updateText = () => {
        btn.textContent = btn.dataset.busy === '1' ? progressText() : guideT('guide.ffmpegDownload');
      };
      const stopProgressPolling = () => {
        if (progressTimer) clearInterval(progressTimer);
        progressTimer = null;
        latestProgress = null;
      };
      const pollProgress = () => fetch('/api/ffmpeg/download/status', { cache: 'no-store' })
        .then((res) => res.json())
        .then((status) => {
          if (!status || btn.dataset.busy !== '1') return;
          latestProgress = status;
          updateText();
          setReadiness(pillId, 'pending', status.stage === 'download' ? progressText() : guideT('guide.ffmpegDownloading'));
        })
        .catch(() => {});
      ffmpegButtonTextUpdaters.push(updateText);
      updateText();
      btn.addEventListener('click', () => {
        btn.dataset.busy = '1';
        btn.disabled = true;
        latestProgress = null;
        updateText();
        setReadiness(pillId, 'pending', guideT('guide.ffmpegDownloading'));
        pollProgress();
        progressTimer = setInterval(pollProgress, 500);
        PinAuth.fetchWithPin('/api/ffmpeg/download', { method: 'POST' })
          .then((res) => res.json())
          .then((data) => {
            if (!data.ok) throw new Error(data.reason || guideT('guide.downloadFailed'));
            stopProgressPolling();
            delete btn.dataset.busy;
            btn.disabled = false;
            updateText();
            refreshReadiness();
          })
          .catch((err) => {
            stopProgressPolling();
            delete btn.dataset.busy;
            btn.disabled = false;
            updateText();
            setReadiness(pillId, false, guideT('guide.ffmpegDownloadFailed'));
            if (typeof ErrorHandler !== 'undefined') ErrorHandler.showToast(guideT('guide.ffmpegDownloadFailedWithError', { error: err.message }));
          });
      });
    }
    wireFfmpegDownloadButton(document.getElementById('guide-ffmpeg-download'), 'guide-check-ffmpeg');
    wireFfmpegDownloadButton(document.getElementById('ffmpeg-download-btn'), 'ffmpeg-status');

    // ─── AI 人聲分離（實驗性）：跟 FFmpeg 同一個「檢查→下載→輪詢」形狀，
    // 但不進「新手教學」清單、不影響 guide 的整體就緒判斷——這是獨立的選用功能。 ───
    (function wireAiSeparationDownload() {
      const statusEl = document.getElementById('ai-separation-status');
      const btn = document.getElementById('ai-separation-download-btn');
      if (!statusEl || !btn) return;
      let pollTimer = null;

      function refresh() {
        fetch('/api/ai-separation/runtime-status', { cache: 'no-store' }).then((res) => res.json()).then((status) => {
          if (status.available) {
            statusEl.textContent = '已就緒';
            btn.hidden = true;
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            return;
          }
          if (status.active) {
            const percent = Math.max(0, Math.min(100, Math.floor(Number(status.percent || 0))));
            statusEl.textContent = `下載中… ${percent}%`;
            btn.hidden = true;
            if (!pollTimer) pollTimer = setInterval(refresh, 500);
            return;
          }
          statusEl.textContent = '尚未安裝';
          btn.hidden = false;
          btn.disabled = false;
          btn.textContent = '下載元件';
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        }).catch(() => { statusEl.textContent = '檢查失敗'; });
      }

      btn.addEventListener('click', () => {
        btn.disabled = true;
        btn.textContent = '下載中…';
        statusEl.textContent = '下載中…';
        pollTimer = setInterval(refresh, 500);
        PinAuth.fetchWithPin('/api/ai-separation/runtime/download', { method: 'POST' })
          .then((res) => res.json())
          .then((data) => {
            if (!data.ok) throw new Error(data.reason || '下載失敗');
            refresh();
          })
          .catch((err) => {
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            statusEl.textContent = `下載失敗：${err.message}`;
            btn.disabled = false;
            btn.hidden = false;
            btn.textContent = '重新下載';
          });
      });

      document.addEventListener('view:change', (event) => {
        if (event.detail?.view === 'general') refresh();
      });
      refresh();
    })();
    // 兩顆下載按鈕（新手教學／連線與系統）共用同一組文字更新函式；換語言時要一起重畫。
    function updateFfmpegButtonText() {
      ffmpegButtonTextUpdaters.forEach((fn) => fn());
    }
    // 教學檢查清單的字是 JS 寫進去的；就算面板收著也要重畫，
    // 否則換語言後再打開會看到上一個語言的殘留。
    window.addEventListener('i18n:change', () => {
      updateGuideRoute();
      updateChecklist();
      refreshReadiness();
      updateFfmpegButtonText();
    });
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
    // v3 起首次體驗改由介面高亮導覽負責；舊版完整教學保留為查詢手冊。
    // 若互動導覽模組未載入，才安全退回原本的阻斷式教學。
    if (window.OnboardingTour) {
      window.OnboardingTour.maybeShowWelcome({
        legacyCompleted: guideCompleted,
        legacyPostponed: guidePostponed,
      });
    } else if (!guideCompleted && !guidePostponed) {
      firstRunRequired = true;
      if (closeBtn) closeBtn.hidden = true;
      if (hint) hint.hidden = true;
      openHelp();
    }
  }
})();
