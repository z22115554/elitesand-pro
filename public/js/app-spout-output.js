'use strict';

// Electron-only control surface for the existing /display -> Spout bridge.
// Browser and OBS sessions never receive this API, so the card stays hidden.
(function () {
  const shell = window.ElitesandShell;
  const api = shell?.spout;
  const card = document.getElementById('spout-output-card');
  if (!api || !card) return;

  const fields = {
    senderName: document.getElementById('spout-sender-name'),
    width: document.getElementById('spout-width'),
    height: document.getElementById('spout-height'),
    fps: document.getElementById('spout-fps'),
  };
  const status = document.getElementById('spout-output-status');
  const message = document.getElementById('spout-output-message');
  const metrics = document.getElementById('spout-output-metrics');
  const start = document.getElementById('spout-output-start');
  const stop = document.getElementById('spout-output-stop');
  let pending = false;
  let latest = null;
  let statusPollTimer = null;
  let lastPerfSample = null;

  const t = (key, fallback, values) => {
    const translated = window.I18n?.t?.(key, values);
    return translated && translated !== key ? translated : fallback;
  };
  const readOptions = () => ({
    senderName: fields.senderName.value.trim(),
    width: Number.parseInt(fields.width.value, 10),
    height: Number.parseInt(fields.height.value, 10),
    fps: Number.parseInt(fields.fps.value, 10),
  });
  const writeOptions = (options = {}) => {
    fields.senderName.value = options.senderName || '';
    fields.width.value = Number.isInteger(options.width) ? String(options.width) : '';
    fields.height.value = Number.isInteger(options.height) ? String(options.height) : '';
    fields.fps.value = Number.isInteger(options.fps) ? String(options.fps) : '30';
  };
  const setPending = (value) => {
    pending = value;
    [...Object.values(fields), start, stop].forEach((element) => { if (element) element.disabled = value; });
    if (value && status) status.textContent = t('spout.starting', '正在更新輸出…');
  };
  const stopStatusPolling = () => {
    if (statusPollTimer !== null) window.clearTimeout(statusPollTimer);
    statusPollTimer = null;
  };
  const pollStatusUntilSettled = () => {
    stopStatusPolling();
    const poll = async () => {
      try {
        const snapshot = await api.getStatus();
        render(snapshot);
        const state = snapshot?.output?.state;
        if (state === 'starting' || state === 'running') {
          statusPollTimer = window.setTimeout(poll, state === 'starting' ? 200 : 1000);
        }
      } catch (error) {
        render({ ...(latest || {}), output: { state: 'error', lastError: error } });
      }
    };
    void poll();
  };
  const render = (snapshot) => {
    if (!snapshot) return;
    latest = snapshot;
    writeOptions(snapshot.options);
    const output = snapshot.output || { state: 'idle' };
    const running = output.state === 'running';
    const active = running || output.state === 'starting';
    if (status) {
      status.classList.toggle('saved', running);
      status.classList.toggle('error', output.state === 'error');
      status.textContent = output.state === 'running'
        ? t('spout.running', '輸出中')
        : output.state === 'starting'
          ? t('spout.starting', '正在更新輸出…')
        : output.state === 'error'
          ? t('spout.error', '輸出發生錯誤')
          : t('spout.idle', '尚未啟動');
    }
    if (message) {
      const native = output.native || {};
      const now = performance.now();
      const sent = Number(native.framesSent);
      let fps = '—';
      if (Number.isFinite(sent)) {
        if (lastPerfSample && now > lastPerfSample.at) {
          fps = String(Math.max(0, Math.round((sent - lastPerfSample.sent) * 1000 / (now - lastPerfSample.at))));
        }
        lastPerfSample = { sent, at: now };
      }
      const lastMs = Number.isFinite(Number(native.lastGpuSyncMs)) ? Number(native.lastGpuSyncMs).toFixed(2) : '—';
      const avgMs = Number.isFinite(Number(native.avgGpuSyncMs)) ? Number(native.avgGpuSyncMs).toFixed(2) : '—';
      message.textContent = output.state === 'error'
        ? t('spout.errorDetail', '無法啟動 Spout 輸出：{message}', { message: output.lastError?.message || '' })
        : running
          ? t('spout.runningPerfHint', 'Shoost 請選擇「{name}」。GPU 同步：最近 {lastMs} ms，平均 {avgMs} ms，送出約 {fps} fps。', {
            name: output.senderName, lastMs, avgMs, fps,
          })
          : t('spout.idleHint', '預設不會自動啟動；開始後在 Shoost 的 Spout 捕捉選擇 Sender 名稱。');
    }
    if (metrics) {
      const native = output.native || {};
      const sent = Number.isFinite(Number(native.framesSent)) ? Number(native.framesSent) : 0;
      const received = Number.isFinite(Number(output.framesReceived)) ? Number(output.framesReceived) : 0;
      const dropped = Number.isFinite(Number(native.framesDropped)) ? Number(native.framesDropped) : 0;
      const timeouts = Number.isFinite(Number(native.gpuSyncTimeouts)) ? Number(native.gpuSyncTimeouts) : 0;
      metrics.hidden = !active;
      metrics.textContent = active
        ? t('spout.metrics', '畫面：送出 {sent}／收到 {received}，丟棄 {dropped}，GPU 同步逾時 {timeouts}。', {
          sent, received, dropped, timeouts,
        })
        : '';
    }
    if (!pending) {
      // Changing size or sender while frames are live would silently produce a
      // second sender. Stop first, edit, then start the selected output again.
      Object.values(fields).forEach((field) => { if (field) field.disabled = active; });
      if (start) start.disabled = active;
      if (stop) stop.disabled = !active;
    }
    if (!active) {
      lastPerfSample = null;
      stopStatusPolling();
    }
  };
  const save = async () => {
    setPending(true);
    try { render(await api.saveSettings(readOptions())); }
    catch (error) { render({ ...(latest || {}), output: { state: 'error', lastError: error } }); }
    finally { setPending(false); render(latest); }
  };

  card.hidden = false;
  Promise.resolve(api.getStatus()).then((snapshot) => {
    render(snapshot);
    if (snapshot?.output?.state === 'starting' || snapshot?.output?.state === 'running') pollStatusUntilSettled();
  }).catch((error) => render({ options: readOptions(), output: { state: 'error', lastError: error } }));
  Object.values(fields).forEach((field) => field?.addEventListener('change', save));
  start?.addEventListener('click', async () => {
    setPending(true);
    try {
      const snapshot = await api.start(readOptions());
      render(snapshot);
      if (snapshot?.output?.state === 'starting') pollStatusUntilSettled();
    }
    catch (error) { render({ ...(latest || {}), output: { state: 'error', lastError: error } }); }
    finally { setPending(false); render(latest); }
  });
  stop?.addEventListener('click', async () => {
    setPending(true);
    try {
      stopStatusPolling();
      render(await api.stop());
    }
    catch (error) { render({ ...(latest || {}), output: { state: 'error', lastError: error } }); }
    finally { setPending(false); render(latest); }
  });
  window.addEventListener('i18n:change', () => render(latest));
  window.addEventListener('beforeunload', stopStatusPolling, { once: true });
})();
