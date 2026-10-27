/**
 * 自動對時（直播頁「對齊第一句」旁邊的按鈕＋匯入後自動對時）
 *
 * 按鈕作用在準備區的目標歌曲（AppShared.prepTargetIndex），不需要先播放。
 * 流程：有人聲檔 → 伺服器 offset:auto 算偏移、高信心才套用；沒有 → 先走既有的 AI 分離
 * （沒裝元件會跳出原本的安裝視窗），分離完自動接著對時。目前的歌詞對不上時，伺服器會搜其他來源
 * （逐字優先）換成能對上的那份。套用後可以一鍵還原（換過歌詞也一起還原）。
 * 匯入流程透過 window.AutoSync.syncTrack() 呼叫同一套流程；可同時處理多首，按鈕只顯示目標歌曲的狀態。
 * 演算法與驗證見 server/services/auto-sync.js。
 */
(function () {
  'use strict';

  const button = document.getElementById('offset-auto');
  const undo = document.getElementById('offset-auto-undo');
  // SocketClient 是 socket-client.js 的頂層 const，不在 window 上
  if (!button || !window.AppShared || typeof SocketClient === 'undefined') return;

  const state = AppShared.state;
  const T = (k, v) => (window.I18n ? window.I18n.t(k, v) : k);
  const toast = (msg, type) => AppShared.showToast?.(msg, type);

  const running = new Map();   // trackId → 目前步驟的按鈕文字
  const applied = new Map();   // trackId → 自動對時套用的偏移（還原用）

  function targetTrack() {
    const idx = typeof AppShared.prepTargetIndex === 'function' ? AppShared.prepTargetIndex() : state.currentTrackIndex;
    return state.playlist[idx] || state.playlist[state.currentTrackIndex] || null;
  }

  function render() {
    const track = targetTrack();
    const busy = !!(track && running.has(track.id));
    button.disabled = busy || !track;
    button.textContent = busy ? running.get(track.id) : T('autoSync.button');
    undo.hidden = !(track && applied.has(track.id));
  }

  function setStep(trackId, label) {
    running.set(trackId, label);
    render();
  }

  function requestAnalysis(trackId) {
    return new Promise((resolve) => {
      // 搜歌詞來源可能要十幾秒，逾時放寬
      SocketClient.sendWithCallback('offset:auto', { trackId }, (result, error) => {
        resolve(result || { ok: false, code: error?.code || 'FAILED' });
      }, { timeoutMs: 60000 });
    });
  }

  // 分離這首的人聲並等它完成。回傳 'ready'／'not-installed'（使用者沒裝元件）／'stopped'。
  async function separate(trackId) {
    if (!await window.AiSeparation?.ensureReady()) return 'not-installed';
    let unsubscribe = null;
    const done = new Promise((resolve) => {
      unsubscribe = window.AiSeparation.subscribe((s) => {
        if (String(s.trackId) !== String(trackId)) return;
        if (s.stage === 'done' || s.stage === 'error' || s.stage === 'cancelled') {
          unsubscribe?.();
          resolve(s.stage === 'done' ? 'ready' : 'stopped');
          return;
        }
        setStep(trackId, T('autoSync.separating', { percent: Math.round(s.percent || 0) }));
      }, { replay: false });
    });
    const res = await PinAuth.fetchWithPin(`/api/library/${encodeURIComponent(trackId)}/separate`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok && body.error !== 'ALREADY_PROCESSING') {
      unsubscribe?.();
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return done;
  }

  function resultMessage(result) {
    if (result.ok && result.applied) {
      const seconds = (result.offsetMs >= 0 ? '+' : '') + (result.offsetMs / 1000).toFixed(2);
      if (result.switchedSource) {
        const key = result.wordLevel ? 'autoSync.appliedSwitchedWord' : 'autoSync.appliedSwitched';
        return [T(key, { source: result.switchedSource, seconds }), 'success'];
      }
      return [T('autoSync.applied', { seconds }), 'success'];
    }
    if (result.ok) {
      if (result.reason === 'VERSION_MISMATCH') return [T('autoSync.versionMismatch', { seconds: (result.spreadMs / 1000).toFixed(1) }), 'info'];
      if (result.reason === 'NO_TIMESTAMPS') return [T('autoSync.noTimestamps'), 'info'];
      return [T('autoSync.uncertain'), 'info'];
    }
    const key = { NO_TIMESTAMPS: 'autoSync.noTimestamps', NEEDS_SEPARATION: 'autoSync.noVocals', BUSY: 'autoSync.busy' }[result.code];
    return [key ? T(key) : T('autoSync.failed', { code: result.code || '' }), 'error'];
  }

  // 對一首歌自動對時。withTitle：提示前面加歌名（匯入時可能一次好幾首）
  async function syncTrack(trackId, { withTitle = false } = {}) {
    if (!trackId || running.has(trackId)) return null;
    applied.delete(trackId);
    const title = state.playlist.find((t) => t && t.id === trackId)?.title || '';
    const say = ([msg, type]) => toast(withTitle && title ? `${title}：${msg}` : msg, type);
    let result = null;
    try {
      setStep(trackId, T('autoSync.analyzing'));
      result = await requestAnalysis(trackId);
      if (result.code === 'NEEDS_SEPARATION') {
        const separation = await separate(trackId);
        if (separation !== 'ready') {
          say([T(separation === 'not-installed' ? 'autoSync.needsComponents' : 'autoSync.separationStopped'), 'info']);
          return result;
        }
        setStep(trackId, T('autoSync.analyzing'));
        result = await requestAnalysis(trackId);
        // 分離剛完成時人聲檔名可能還沒寫回清單，稍等再試一次
        if (result.code === 'NEEDS_SEPARATION') {
          await new Promise((r) => setTimeout(r, 1500));
          result = await requestAnalysis(trackId);
        }
      }
      if (result.ok && result.applied) applied.set(trackId, result.offsetMs);
      say(resultMessage(result));
    } catch (err) {
      say([T('autoSync.failed', { code: err.message }), 'error']);
    } finally {
      running.delete(trackId);
      render();
    }
    return result;
  }

  button.addEventListener('click', () => { const track = targetTrack(); if (track) syncTrack(track.id); });
  // 還原由伺服器做：它記得套用前的偏移與（換過來源時）原本的歌詞
  undo.addEventListener('click', () => {
    const track = targetTrack();
    if (!track || !applied.has(track.id)) return;
    const trackId = track.id;
    applied.delete(trackId);
    render();
    SocketClient.sendWithCallback('offset:auto-undo', { trackId }, (result) => {
      if (result && result.ok) toast(T(result.restoredLyrics ? 'autoSync.undoneLyrics' : 'autoSync.undone'), 'info');
      else toast(T('autoSync.undoUnavailable'), 'info');
    });
  });

  SocketClient.on('offset:auto-progress', (data) => {
    if (data && running.has(data.trackId) && data.stage === 'sources') setStep(data.trackId, T('autoSync.searchingSources'));
  });

  // 偏移被別的方式改掉（手動微調、別台遙控器）就不再提供還原
  SocketClient.on('offset:update', (data) => {
    if (applied.has(data.trackId) && !running.has(data.trackId) && data.offset !== applied.get(data.trackId)) {
      applied.delete(data.trackId);
      render();
    }
  });
  document.addEventListener('live-prep:target', render);
  document.addEventListener('playlist:rendered', render);
  window.addEventListener('i18n:change', () => { undo.textContent = T('autoSync.undo'); render(); });
  undo.textContent = T('autoSync.undo');
  render();

  window.AutoSync = Object.freeze({ syncTrack: (trackId) => syncTrack(trackId, { withTitle: true }) });
})();
