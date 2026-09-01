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
      jumpToGuideTarget('karaoke', 'lyric-now-line');
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

    // ─── AI 伴奏製作（實驗性）：對使用者只有一個完整元件，不再分開顯示
    // Python/WebGPU。真正的備援順序由 server 協調器負責。 ───
    (function wireAiSeparationDownload() {
      const statusEl = document.getElementById('ai-separation-status');
      const btn = document.getElementById('ai-separation-download-btn');
      if (!statusEl || !btn) return;

      function refresh() {
        window.AiSeparation.getBundleStatus().then((status) => {
          if (status.available) {
            statusEl.textContent = guideT('aiInstall.stageDone');
            btn.hidden = true;
            return;
          }
          if (status.active) {
            const percent = Math.max(0, Math.min(100, Math.floor(Number(status.percent || 0))));
            statusEl.textContent = `${guideT('aiInstall.downloading')} ${percent}%`;
            btn.hidden = false;
            btn.disabled = false;
            btn.textContent = guideT('aiInstall.viewProgress');
            return;
          }
          statusEl.textContent = guideT('aiInstall.notInstalled');
          btn.hidden = false;
          btn.disabled = false;
          btn.textContent = guideT('aiInstall.downloadComponents');
        }).catch(() => { statusEl.textContent = guideT('aiInstall.checkFailed'); });
      }

      btn.addEventListener('click', async () => {
        try {
          await window.AiSeparation.ensureReady();
        } catch (error) {
          AppShared.showToast(`${guideT('aiInstall.statusFailed')}：${error.message}`, 'error');
        }
        refresh();
      });

      document.addEventListener('view:change', (event) => {
        if (event.detail?.view === 'general') refresh();
      });
      refresh();
    })();

    // ─── 雙路音訊路由（實驗性）：docs/AI-SEPARATION-PLAN.md §14 路線 A ───
    // 裝置清單只在使用者按「重新整理」時才列舉（比照本機字體「瀏覽系統字體」的「使用者
    // 主動觸發」模式，不做 ondevicechange 即時熱插拔監聽，這輪範圍刻意縮小）。
    (function wireDualAudioRouting() {
      const card = document.getElementById('dual-audio-card');
      if (!card) return;
      const refreshBtn = document.getElementById('dual-audio-refresh-devices');
      const warningEl = document.getElementById('dual-audio-device-warning');
      const streamSel = document.getElementById('dual-audio-stream-device');
      const headphoneSel = document.getElementById('dual-audio-headphone-device');
      const toggle = document.getElementById('dual-audio-mode-toggle');
      const offsetSlider = document.getElementById('dual-audio-sync-offset');
      const offsetVal = document.getElementById('dual-audio-sync-offset-val');
      const headphoneVolumeSlider = document.getElementById('dual-audio-headphone-volume');
      const headphoneVolumeVal = document.getElementById('dual-audio-headphone-volume-val');
      const streamVolumeSlider = document.getElementById('dual-audio-stream-volume');
      const streamVolumeVal = document.getElementById('dual-audio-stream-volume-val');

      // 還原上次選過的偏移／開關／音量狀態（裝置下拉選單的還原值要等 populateDevices() 建好
      // 選項後才套得上，見下面 fillSelect 的 savedId 參數）。
      const initialState = (typeof AppShared.getDualAudioState === 'function') ? AppShared.getDualAudioState() : null;
      if (initialState) {
        toggle.checked = initialState.enabled;
        offsetSlider.value = initialState.syncOffsetMs;
        offsetVal.textContent = `${initialState.syncOffsetMs}ms`;
        const hpPct = Math.round((initialState.headphoneVolume ?? 1) * 100);
        const streamPct = Math.round((initialState.streamVolume ?? 1) * 100);
        headphoneVolumeSlider.value = hpPct;
        headphoneVolumeVal.textContent = `${hpPct}%`;
        streamVolumeSlider.value = streamPct;
        streamVolumeVal.textContent = `${streamPct}%`;
      }

      // 過濾 default/communications 這兩個「別名」，避免同一顆實體裝置在清單裡重複出現
      // （比照 docs §14 D2 的判斷邏輯）。
      function dedupedOutputDevices(devices) {
        return devices.filter((d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
      }

      function fillSelect(sel, devices, savedId) {
        sel.innerHTML = '';
        devices.forEach((d) => {
          const opt = document.createElement('option');
          opt.value = d.deviceId;
          opt.textContent = d.label || d.deviceId;
          sel.appendChild(opt);
        });
        if (savedId && devices.some((d) => d.deviceId === savedId)) sel.value = savedId;
      }

      async function populateDevices({ silent = false } = {}) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = '偵測中…';
        try {
          // 裝置 label 要先取得任一個媒體權限才拿得到；用完立刻停止，不留下常駐的麥克風佔用。
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach((t) => t.stop());
          } catch (e) { /* 使用者拒絕權限：裝置清單可能沒有 label，仍繼續嘗試列舉 */ }
          const all = await navigator.mediaDevices.enumerateDevices();
          const outputs = dedupedOutputDevices(all);
          const st = (typeof AppShared.getDualAudioState === 'function') ? AppShared.getDualAudioState() : {};
          fillSelect(streamSel, outputs, st.streamDeviceId);
          fillSelect(headphoneSel, outputs, st.headphoneDeviceId);
          const enough = outputs.length >= 2;
          warningEl.hidden = enough;
          [streamSel, headphoneSel, toggle].forEach((el) => { el.disabled = !enough; });
          if (!enough) toggle.checked = false;
          // 開頁面時的安靜自動列舉（見下方 Permissions API 那段）不彈 toast——只有使用者
          // 自己按「重新整理」才需要這個確認回饋，安靜載入跳出來反而像沒來由的通知。
          if (!silent) AppShared.showToast(`已偵測到 ${outputs.length} 個獨立音訊輸出裝置`, enough ? 'success' : 'info');
        } catch (e) {
          if (!silent) AppShared.showToast(`無法列舉音訊裝置：${e.message}`, 'error');
        } finally {
          refreshBtn.disabled = false;
          refreshBtn.textContent = '重新整理裝置清單';
        }
      }
      refreshBtn.addEventListener('click', () => populateDevices());
      // 麥克風權限是同源永久記住的（Chrome 同意過後不會再跳提示）；已經同意過的話，
      // 開頁面就安靜列一次裝置，開關/下拉選單才不會每次重整頁面都要先手動按一次才能用。
      // 沒有 Permissions API 或還沒同意過就跳過，維持原本「使用者主動觸發」行為，
      // 絕不主動彈出授權請求本身。
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'microphone' }).then((status) => {
          if (status.state === 'granted') populateDevices({ silent: true });
        }).catch(() => { /* 瀏覽器不支援這個查詢，安靜跳過 */ });
      }

      function pushDevices() {
        if (typeof AppShared.setDualAudioDevices === 'function') {
          AppShared.setDualAudioDevices({ streamDeviceId: streamSel.value, headphoneDeviceId: headphoneSel.value });
        }
      }
      streamSel.addEventListener('change', pushDevices);
      headphoneSel.addEventListener('change', pushDevices);

      toggle.addEventListener('change', () => {
        if (typeof AppShared.setDualAudioMode === 'function') AppShared.setDualAudioMode(toggle.checked);
      });

      offsetSlider.addEventListener('input', () => {
        const ms = parseInt(offsetSlider.value, 10) || 0;
        offsetVal.textContent = `${ms}ms`;
        if (typeof AppShared.setDualAudioSyncOffset === 'function') AppShared.setDualAudioSyncOffset(ms);
      });

      // 本地監聽／對外各自的音量：疊加在主音量之上，互不影響（這就是「調大聲、OBS
      // 端也跟著大聲」問題的解法——兩路各自一顆，設定一次很少再動）。
      headphoneVolumeSlider.addEventListener('input', () => {
        const pct = parseInt(headphoneVolumeSlider.value, 10) || 0;
        headphoneVolumeVal.textContent = `${pct}%`;
        if (typeof AppShared.setDualAudioHeadphoneVolume === 'function') AppShared.setDualAudioHeadphoneVolume(pct / 100);
      });
      streamVolumeSlider.addEventListener('input', () => {
        const pct = parseInt(streamVolumeSlider.value, 10) || 0;
        streamVolumeVal.textContent = `${pct}%`;
        if (typeof AppShared.setDualAudioStreamVolume === 'function') AppShared.setDualAudioStreamVolume(pct / 100);
      });
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
