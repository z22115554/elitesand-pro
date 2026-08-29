/* 首頁「AI 伴奏」分頁 —— 把 AI 人聲分離做成本場直播的準備步驟。
 *
 * 純前端：
 *  - 清單資料讀 AppShared.state.playlist（已 enriched 的 separationStatus /
 *    vocalsFile / instrumentalFile），不自己維護 state。
 *  - 即時進度訂閱 window.AiSeparation.subscribe()（既有）。
 *  - 觸發分離走既有路由 POST /api/library/:id/separate 與 …/separate/cancel，
 *    一律用 window.AiSeparation（内含 ensureReady 安裝流程 + PinAuth）。
 *  - 不新增 socket 事件、不觸發整包狀態廣播。
 */
(function () {
  'use strict';

  const panel = document.querySelector('[data-prep-panel="ai"]');
  if (!panel || !window.AppShared || !window.AiSeparation) return;

  const state = AppShared.state;
  const T = (k, v) => (window.I18n ? window.I18n.t(k, v) : k);
  const escapeHtml = (window.SharedUtils && SharedUtils.escapeHtml)
    || ((s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const toast = (msg, type) => (AppShared.showToast ? AppShared.showToast(msg, type) : null);

  const els = {
    engine: panel.querySelector('#home-ai-engine'),
    install: panel.querySelector('#home-ai-install'),
    makeAll: panel.querySelector('#home-ai-make-all'),
    retryFailed: panel.querySelector('#home-ai-retry-failed'),
    openAudio: panel.querySelector('#home-ai-open-audio'),
    openGuide: panel.querySelector('#home-ai-open-guide'),
    list: panel.querySelector('#home-ai-track-list'),
    coverage: panel.querySelector('#home-ai-coverage'),
  };

  const liveByTrack = new Map(); // trackId -> {stage, percent, queuePosition}
  let installed = null;          // null=未知, true/false
  let webgpuReady = false;
  let queueingAll = false;
  let renderTimer = 0;

  function trackId(track, index) {
    return String(track && track.id != null ? track.id : index);
  }

  function statusOf(track, index) {
    const live = liveByTrack.get(trackId(track, index));
    if (live && live.stage && !['done', 'cancelled', 'error'].includes(live.stage)) return { key: 'working', live };
    if (live && live.stage === 'error') return { key: 'failed' };
    if (track.separationStatus === 'done' || (track.instrumentalFile && track.vocalsFile)) return { key: 'done' };
    if (track.separationStatus === 'processing') return { key: 'working', live: null };
    if (track.separationStatus === 'failed') return { key: 'failed' };
    return { key: 'none' };
  }

  function renderEngine() {
    if (installed === null) { els.engine.textContent = T('home.ai.engineChecking'); return; }
    if (!installed) {
      els.engine.textContent = T('home.ai.engineMissing');
      els.install.hidden = false;
      return;
    }
    els.install.hidden = true;
    els.engine.textContent = webgpuReady ? T('home.ai.engineReadyWebgpu') : T('home.ai.engineReady');
  }

  function render() {
    renderEngine();
    const list = Array.isArray(state.playlist) ? state.playlist : [];
    if (!list.length) {
      els.list.innerHTML = `<div class="playlist-empty">${escapeHtml(T('home.ai.empty'))}</div>`;
      els.coverage.textContent = '';
      els.makeAll.disabled = true;
      els.retryFailed.hidden = true;
      return;
    }
    let done = 0; let pending = 0; let failed = 0;
    const frag = document.createDocumentFragment();
    list.forEach((track, index) => {
      const st = statusOf(track, index);
      if (st.key === 'done') done += 1;
      else if (st.key === 'failed') { failed += 1; pending += 1; }
      else if (st.key === 'none') pending += 1;

      const row = document.createElement('div');
      row.className = 'home-ai-row';
      row.dataset.id = trackId(track, index);

      const title = document.createElement('span');
      title.className = 'home-ai-row-title';
      title.textContent = track.title || T('home.ai.untitled');
      title.title = track.title || '';

      const chip = document.createElement('span');
      const chipClass = { done: 'is-done', working: 'is-working', failed: 'is-failed', none: 'is-none' }[st.key];
      chip.className = `home-ai-chip ${chipClass}`;
      chip.textContent = (st.key === 'working' && st.live)
        ? window.AiSeparation.label(st.live) + (typeof st.live.percent === 'number' ? ` ${st.live.percent}%` : '')
        : T(`home.ai.status.${st.key}`);

      const actions = document.createElement('div');
      actions.className = 'home-ai-row-actions';
      if (st.key === 'none' || st.key === 'failed') {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-sm' + (st.key === 'none' ? ' btn-primary' : '');
        b.textContent = T(st.key === 'failed' ? 'home.ai.retry' : 'home.ai.make');
        b.addEventListener('click', () => makeOne(track, index, b));
        actions.appendChild(b);
      } else if (st.key === 'working') {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-sm btn-ghost';
        b.textContent = '✕';
        b.title = T('aiJob.cancelAction');
        b.setAttribute('aria-label', T('aiJob.cancelAction'));
        b.addEventListener('click', () => cancelOne(track, index, b));
        actions.appendChild(b);
      }

      row.append(title, chip, actions);
      frag.appendChild(row);
    });
    els.list.innerHTML = '';
    els.list.appendChild(frag);
    els.coverage.textContent = T('home.ai.coverage', { done, total: list.length });
    els.makeAll.disabled = queueingAll || pending === 0;
    els.makeAll.textContent = queueingAll ? T('home.ai.queueing') : T('home.ai.makeAll');
    els.retryFailed.hidden = failed === 0;
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 60);
  }

  async function refreshEngine() {
    try {
      const status = await window.AiSeparation.getBundleStatus();
      installed = !!status.available;
      webgpuReady = !!status.webgpuEngineConnected;
    } catch (_) {
      // 讀不到就當未知，不擋操作——makeOne 會再走 ensureReady()
      installed = installed === null ? false : installed;
    }
    render();
  }

  async function startSeparateRequest(id) {
    const res = await PinAuth.fetchWithPin(`/api/library/${encodeURIComponent(id)}/separate`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      const err = new Error(body.error || `HTTP ${res.status}`);
      err.code = body.error;
      throw err;
    }
    return body;
  }

  async function makeOne(track, index, btn) {
    if (btn) { btn.disabled = true; btn.textContent = T('aiJob.preparing'); }
    try {
      if (!await window.AiSeparation.ensureReady()) { if (btn) { btn.disabled = false; render(); } return; }
      await startSeparateRequest(track.id ?? trackId(track, index));
      installed = true;
      render();
    } catch (err) {
      if (err.code === 'ALREADY_PROCESSING') { render(); return; }
      toast(T('home.ai.startFailed', { message: err.message }), 'error');
      if (btn) { btn.disabled = false; render(); }
    }
  }

  async function cancelOne(track, index, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    const ok = await window.AiSeparation.cancel(track.id ?? trackId(track, index));
    if (!ok) {
      toast(T('home.ai.cancelFailed'), 'error');
      render();
    }
    // 成功時 server 廣播 stage:'cancelled'，subscribe 會清狀態並重畫。
  }

  async function queueAll(onlyFailed) {
    if (queueingAll) return;
    const list = Array.isArray(state.playlist) ? state.playlist : [];
    const targets = list.filter((track, index) => {
      const key = statusOf(track, index).key;
      return onlyFailed ? key === 'failed' : (key === 'none' || key === 'failed');
    });
    if (!targets.length) return;
    queueingAll = true;
    render();
    try {
      if (!await window.AiSeparation.ensureReady()) return;
      installed = true;
      let failures = 0;
      for (const track of targets) {
        try {
          await startSeparateRequest(track.id);
        } catch (err) {
          if (err.code !== 'ALREADY_PROCESSING') failures += 1;
        }
        await new Promise((r) => setTimeout(r, 150)); // 逐首送、等 server 收下，別一次噴一堆
      }
      if (failures) toast(T('home.ai.queueAllPartial', { count: failures }), 'warning');
    } finally {
      queueingAll = false;
      render();
    }
  }

  // ─── 事件 ───
  window.AiSeparation.subscribe((data) => {
    if (!data || data.trackId == null) return;
    if (data.stage === 'cancelled' || data.stage === 'done') liveByTrack.delete(String(data.trackId));
    else liveByTrack.set(String(data.trackId), data);
    if (data.stage === 'done' || data.stage === 'error') refreshEngine();
    scheduleRender();
  });

  els.install.addEventListener('click', () => makeAllOrInstall());
  async function makeAllOrInstall() {
    els.install.disabled = true;
    try { await window.AiSeparation.ensureReady(); } catch (_) { /* modal 內處理 */ }
    els.install.disabled = false;
    refreshEngine();
  }
  els.makeAll.addEventListener('click', () => queueAll(false));
  els.retryFailed.addEventListener('click', () => queueAll(true));
  els.openAudio.addEventListener('click', () => {
    if (window.HomePrepTabs) window.HomePrepTabs.show('audio');
    document.getElementById('separation-mode-toggle')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  els.openGuide.addEventListener('click', () => {
    document.getElementById('btn-open-help')?.click();
    setTimeout(() => document.getElementById('help-dual-audio')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 120);
  });

  // 播放清單 DOM 變動 = state.playlist 變了 → 重畫伴奏狀態表
  const listDom = document.getElementById('playlist');
  if (listDom && 'MutationObserver' in window) {
    new MutationObserver(scheduleRender).observe(listDom, { childList: true, subtree: true });
  }
  // 切到本分頁時刷新一次（hidden 由 home-prep-tabs.js 切換）
  if ('MutationObserver' in window) {
    new MutationObserver(() => { if (!panel.hidden) { refreshEngine(); scheduleRender(); } })
      .observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  }
  window.addEventListener('i18n:change', scheduleRender);

  refreshEngine();
  render();
})();
