/*
 * SYNCDIAG — 暫時性診斷模組（2026-09-03）
 * ─────────────────────────────────────────────────────────────────────────────
 * 目的：追一個「開發機重現不出、只在使用者直播時出現」的分離播放人聲/伴奏延遲。
 * 使用者已取得回報者同意蒐集其電腦資訊。
 *
 * ⚠ 只有這一版帶診斷。確認問題後，連同下列全部一起整批移除：
 *   - 本檔 public/js/sync-diag.js 與 index.html 的 <script>
 *   - public/vendor/soundtouch-worklet.js 標了「SYNCDIAG」的 frame/stall 回報
 *   - public/js/soundtouch-engine.js 標了「SYNCDIAG」的欄位與 getSyncSample/getStallStats
 *   - public/js/app-playback.js 的 _syncDiag* 區塊與呼叫點
 *   - server/routes/api.js 的 /api/diag/sync-log 與 /api/diag/collect
 *   - electron/shell.js 的 ELITESAND_SHELL_DEVTOOLS
 *
 * 效能：刻意不影響直播。
 *   - 無自己的高頻 timer；Δ 取樣搭 app-playback 既有的 3 秒 tick。
 *   - 一次性快照（裝置/GPU/版本）只在啟動跑一次。
 *   - 環境輪詢 60 秒一次、且只在播放中；重活（tasklist/nvidia-smi/ffprobe）全在
 *     server 子行程，不在 renderer、不在音訊執行緒。
 *   - console + 批次 POST（4 秒一次），fire-and-forget，全程 try/catch。
 */
window.SyncDiag = (() => {
  const SESSION = Math.random().toString(36).slice(2, 10);
  const startedAtMs = Date.now();
  let buf = [];
  let flushTimer = null;
  let started = false;
  let envTimer = null;
  let longtasks = 0;
  let longtaskMs = 0;
  const clk = { t0c: null, t0p: null };

  function _post(url, body) {
    try {
      const f = (typeof PinAuth !== 'undefined' && PinAuth.fetchWithPin)
        ? PinAuth.fetchWithPin
        : ((...a) => fetch(...a));
      f(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => { /* 診斷用，失敗就算了 */ });
    } catch (e) { /* 靜默 */ }
  }

  function _flush() {
    flushTimer = null;
    if (!buf.length) return;
    const lines = buf.splice(0, buf.length);
    _post('/api/diag/sync-log', { session: SESSION, lines });
  }

  function line(s) {
    try {
      console.log(s);
      buf.push(new Date().toISOString().slice(11, 23) + ' ' + s);
      if (buf.length > 400) buf.shift();
      if (!flushTimer) flushTimer = setTimeout(_flush, 4000);
    } catch (e) { /* 靜默 */ }
  }

  function _gpuInfo() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return 'no-webgl';
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const r = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      const v = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      return String(v) + ' / ' + String(r);
    } catch (e) { return 'gpu-probe-failed'; }
  }

  async function _collectClientHeader(stCtx) {
    const h = { session: SESSION, ts: new Date().toISOString() };
    try {
      h.ua = navigator.userAgent;
      h.cores = navigator.hardwareConcurrency || null;
      h.deviceMemoryGB = navigator.deviceMemory || null;
      h.lang = navigator.language;
      h.screen = `${screen.width}x${screen.height}@${window.devicePixelRatio}`;
      h.gpu = _gpuInfo();
    } catch (e) { /* 靜默 */ }
    try { if (performance.memory) h.jsHeapMB = Math.round(performance.memory.usedJSHeapSize / 1048576); } catch (e) { /* 靜默 */ }
    try {
      if (stCtx) {
        h.audioContext = {
          sampleRate: stCtx.sampleRate,
          state: stCtx.state,
          baseLatencyMs: stCtx.baseLatency != null ? +(stCtx.baseLatency * 1000).toFixed(1) : null,
          outputLatencyMs: stCtx.outputLatency != null ? +(stCtx.outputLatency * 1000).toFixed(1) : null,
        };
      }
    } catch (e) { /* 靜默 */ }
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      h.audioDevices = devs
        .filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput')
        .map((d) => ({ kind: d.kind, label: d.label || '(no label)', id: (d.deviceId || '').slice(0, 8) }));
    } catch (e) { h.audioDevices = 'enumerate-failed'; }
    try {
      h.settings = {
        separationMode: localStorage.getItem('vk-separation-mode'),
        dualAudioMode: localStorage.getItem('vk-dual-audio-mode'),
        dualSyncOffsetMs: localStorage.getItem('vk-dual-audio-sync-offset-ms'),
        dualHeadphoneDevice: (localStorage.getItem('vk-dual-audio-headphone-device') || '').slice(0, 8),
        dualStreamDevice: (localStorage.getItem('vk-dual-audio-stream-device') || '').slice(0, 8),
        vocalsVolume: localStorage.getItem('vk-separation-vocals-volume'),
        compLatencyMs: localStorage.getItem('vk-separation-comp-latency-ms'),
      };
    } catch (e) { /* 靜默 */ }
    line('[SyncDiag] CLIENT-HEADER ' + JSON.stringify(h));
    _post('/api/diag/collect', { session: SESSION, kind: 'server-header' });
  }

  function _longtaskObserver() {
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) { longtasks += 1; longtaskMs += e.duration; }
      });
      obs.observe({ entryTypes: ['longtask'] });
    } catch (e) { /* 不支援就算了 */ }
  }

  function _ensureEnvPoll() {
    if (envTimer) return;
    // 只在播放中被 tick() 呼叫 → 60 秒一次觸發 server 端環境快照（tasklist / nvidia-smi）
    envTimer = setInterval(() => {
      _post('/api/diag/collect', { session: SESSION, kind: 'env-sample' });
    }, 60000);
    _post('/api/diag/collect', { session: SESSION, kind: 'env-sample' }); // 立刻先來一筆
  }

  function stopEnvPoll() { if (envTimer) { clearInterval(envTimer); envTimer = null; } }

  // ── 對外 ──

  function start(stCtx) {
    if (started) return;
    started = true;
    try { _collectClientHeader(stCtx); } catch (e) { /* 靜默 */ }
    _longtaskObserver();
  }

  /** app-playback 每 3 秒呼叫一次；payload 是它算好的 Δ 行，這裡補音訊/系統快照。 */
  function tick(payload, stCtx) {
    let extra = ` sess=${((Date.now() - startedAtMs) / 1000).toFixed(0)}s longtask=${longtasks}/${Math.round(longtaskMs)}ms`;
    try {
      if (stCtx) {
        const ol = stCtx.outputLatency;
        extra += ` outLat=${ol != null ? (ol * 1000).toFixed(1) : '?'}ms bLat=${stCtx.baseLatency != null ? (stCtx.baseLatency * 1000).toFixed(1) : '?'}ms state=${stCtx.state}`;
        if (clk.t0c == null) { clk.t0c = stCtx.currentTime; clk.t0p = performance.now(); }
        const driftMs = ((stCtx.currentTime - clk.t0c) - (performance.now() - clk.t0p) / 1000) * 1000;
        extra += ` clkDrift=${driftMs.toFixed(0)}ms`;
      }
    } catch (e) { /* 靜默 */ }
    line(payload + extra);
    _ensureEnvPoll();
  }

  function event(name, extra) {
    line(`[SyncDiag] [mark:${name}]${extra ? ' ' + extra : ''}`);
  }

  /** 每首分離歌開始播放時呼叫：觸發 server 端對三個檔案 ffprobe。 */
  function trackProbe(instrumentalFile, vocalsFile, originalFile, tag) {
    line(`[SyncDiag] ══ TRACK ${tag || ''} ══`);
    _post('/api/diag/collect', { session: SESSION, kind: 'track-probe', instrumentalFile, vocalsFile, originalFile });
  }

  return { start, tick, event, trackProbe, line, stopEnvPoll, SESSION };
})();
