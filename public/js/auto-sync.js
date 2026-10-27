/**
 * 自動對時（直播頁「對齊第一句」旁邊的按鈕）
 *
 * 作用在準備區的目標歌曲（AppShared.prepTargetIndex），不需要先播放。
 * 流程：有人聲檔 → 伺服器 offset:auto 算偏移、高信心才套用；沒有 → 先走既有的 AI 分離
 * （沒裝元件會跳出原本的安裝視窗），分離完自動接著對時。目前的歌詞對不上時，伺服器會搜其他來源
 * （逐字優先）換成能對上的那份。套用後可以一鍵還原（換過歌詞也一起還原）。
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

  let busyTrackId = null;
  let lastApplied = null; // { trackId, offsetMs }
  let unsubscribe = null;

  function targetTrack() {
    const idx = typeof AppShared.prepTargetIndex === 'function' ? AppShared.prepTargetIndex() : state.currentTrackIndex;
    return state.playlist[idx] || state.playlist[state.currentTrackIndex] || null;
  }

  function setBusy(trackId, label) {
    busyTrackId = trackId;
    button.textContent = label || T('autoSync.button');
    render();
  }

  function render() {
    const track = targetTrack();
    button.disabled = !!busyTrackId || !track;
    undo.hidden = !(lastApplied && track && lastApplied.trackId === track.id);
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
    const done = new Promise((resolve) => {
      unsubscribe?.();
      unsubscribe = window.AiSeparation.subscribe((s) => {
        if (String(s.trackId) !== String(trackId)) return;
        if (s.stage === 'done' || s.stage === 'error' || s.stage === 'cancelled') {
          unsubscribe?.(); unsubscribe = null;
          resolve(s.stage === 'done' ? 'ready' : 'stopped');
          return;
        }
        setBusy(trackId, T('autoSync.separating', { percent: Math.round(s.percent || 0) }));
      }, { replay: false });
    });
    const res = await PinAuth.fetchWithPin(`/api/library/${encodeURIComponent(trackId)}/separate`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok && body.error !== 'ALREADY_PROCESSING') {
      unsubscribe?.(); unsubscribe = null;
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return done;
  }

  async function run() {
    const track = targetTrack();
    if (!track || busyTrackId) return;
    const trackId = track.id;
    lastApplied = null;
    render();
    try {
      setBusy(trackId, T('autoSync.analyzing'));
      let result = await requestAnalysis(trackId);
      if (result.code === 'NEEDS_SEPARATION') {
        const separation = await separate(trackId);
        if (separation !== 'ready') {
          toast(T(separation === 'not-installed' ? 'autoSync.needsComponents' : 'autoSync.separationStopped'), 'info');
          return;
        }
        setBusy(trackId, T('autoSync.analyzing'));
        result = await requestAnalysis(trackId);
        // 分離剛完成時人聲檔名可能還沒寫回清單，稍等再試一次
        if (result.code === 'NEEDS_SEPARATION') {
          await new Promise((r) => setTimeout(r, 1500));
          result = await requestAnalysis(trackId);
        }
      }
      if (result.ok && result.applied) {
        lastApplied = { trackId, offsetMs: result.offsetMs };
        const seconds = (result.offsetMs >= 0 ? '+' : '') + (result.offsetMs / 1000).toFixed(2);
        if (result.switchedSource) {
          const key = result.wordLevel ? 'autoSync.appliedSwitchedWord' : 'autoSync.appliedSwitched';
          toast(T(key, { source: result.switchedSource, seconds }), 'success');
        } else {
          toast(T('autoSync.applied', { seconds }), 'success');
        }
      } else if (result.ok) {
        if (result.reason === 'VERSION_MISMATCH') {
          toast(T('autoSync.versionMismatch', { seconds: (result.spreadMs / 1000).toFixed(1) }), 'info');
        } else if (result.reason === 'NO_TIMESTAMPS') {
          toast(T('autoSync.noTimestamps'), 'info');
        } else {
          toast(T('autoSync.uncertain'), 'info');
        }
      } else {
        const key = { NO_TIMESTAMPS: 'autoSync.noTimestamps', NEEDS_SEPARATION: 'autoSync.noVocals', BUSY: 'autoSync.busy' }[result.code];
        toast(key ? T(key) : T('autoSync.failed', { code: result.code || '' }), 'error');
      }
    } catch (err) {
      toast(T('autoSync.failed', { code: err.message }), 'error');
    } finally {
      setBusy(null);
      render();
    }
  }

  button.addEventListener('click', run);
  // 還原由伺服器做：它記得套用前的偏移與（換過來源時）原本的歌詞
  undo.addEventListener('click', () => {
    if (!lastApplied) return;
    const { trackId } = lastApplied;
    lastApplied = null;
    render();
    SocketClient.sendWithCallback('offset:auto-undo', { trackId }, (result) => {
      if (result && result.ok) toast(T(result.restoredLyrics ? 'autoSync.undoneLyrics' : 'autoSync.undone'), 'info');
      else toast(T('autoSync.undoUnavailable'), 'info');
    });
  });

  SocketClient.on('offset:auto-progress', (data) => {
    if (data && data.trackId === busyTrackId && data.stage === 'sources') setBusy(busyTrackId, T('autoSync.searchingSources'));
  });

  // 偏移被別的方式改掉（手動微調、別台遙控器）就不再提供還原
  SocketClient.on('offset:update', (data) => {
    if (lastApplied && data.trackId === lastApplied.trackId && data.offset !== lastApplied.offsetMs) {
      lastApplied = null;
      render();
    }
  });
  document.addEventListener('live-prep:target', render);
  document.addEventListener('playlist:rendered', render);
  window.addEventListener('i18n:change', () => { if (!busyTrackId) setBusy(null); undo.textContent = T('autoSync.undo'); });
  setBusy(null);
  undo.textContent = T('autoSync.undo');
  render();
})();
