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
    library: '媒體庫',
    settings: '歌詞設定',
    general: '一般設定',
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
    const GUIDE_KEY = 'elite-guide-completed-v1';
    let firstRunRequired = false;
    const openHelp = () => { helpModal.hidden = false; };
    const closeHelp = (completed = false) => {
      if (firstRunRequired && !completed) return;
      helpModal.hidden = true;
      if (completed) {
        firstRunRequired = false;
        if (closeBtn) closeBtn.hidden = false;
        try { localStorage.setItem(GUIDE_KEY, '1'); } catch (e) { /* 靜默 */ }
      }
    };
    const openBtn = document.getElementById('btn-open-help');
    const onboardOpenBtn = document.getElementById('onboard-open-help');
    const closeBtn = document.getElementById('help-close');
    if (openBtn) openBtn.addEventListener('click', openHelp);
    if (onboardOpenBtn) onboardOpenBtn.addEventListener('click', openHelp);
    const completeBtn = document.getElementById('guide-complete');
    if (closeBtn) closeBtn.addEventListener('click', () => closeHelp(false));
    if (completeBtn) completeBtn.addEventListener('click', () => closeHelp(true));
    helpModal.addEventListener('click', (e) => { if (e.target === helpModal) closeHelp(false); });

    function setReadiness(id, ok, text) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('pending', 'ok', 'error');
      el.classList.add(ok ? 'ok' : 'error');
      el.textContent = text;
    }

    function refreshReadiness() {
      setReadiness('guide-check-websocket', SocketClient.connected(), SocketClient.connected() ? 'WebSocket 已連線' : 'WebSocket 未連線');
      fetch('/api/system-check').then((res) => res.json()).then((data) => {
        setReadiness('guide-check-ytdlp', !!data.ytdlp?.available, data.ytdlp?.available ? `yt-dlp ${data.ytdlp.version}` : '找不到 yt-dlp');
        setReadiness('guide-check-ffmpeg', !!data.ffmpeg?.available, data.ffmpeg?.available ? 'FFmpeg 已就緒' : '找不到 FFmpeg');
        return fetch('/api/update-check').then((res) => res.json()).then((update) => {
          const newer = update && update.hasUpdate && update.latestVersion;
          setReadiness('guide-check-version', true, newer ? `可更新 v${update.latestVersion}` : `目前 v${data.appVersion}`);
        });
      }).catch(() => {
        setReadiness('guide-check-ytdlp', false, 'yt-dlp 檢查失敗');
        setReadiness('guide-check-ffmpeg', false, 'FFmpeg 檢查失敗');
        setReadiness('guide-check-version', false, '版本檢查失敗');
      });
    }

    SocketClient.on('connection-change', (connected) => {
      setReadiness('guide-check-websocket', connected, connected ? 'WebSocket 已連線' : 'WebSocket 未連線');
    });
    const refreshBtn = document.getElementById('guide-check-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', refreshReadiness);
    refreshReadiness();

    let guideCompleted = false;
    try { guideCompleted = localStorage.getItem(GUIDE_KEY) === '1'; } catch (e) { /* 靜默 */ }
    if (!guideCompleted) {
      firstRunRequired = true;
      if (closeBtn) closeBtn.hidden = true;
      if (hint) hint.hidden = true;
      openHelp();
    }
  }
})();
