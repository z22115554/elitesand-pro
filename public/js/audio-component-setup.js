/** Panel-only audio tools setup. Downloading always requires a user action. */
(() => {
  'use strict';
  const t = (key, vars) => window.I18n.t(key, vars);
  const postponedKey = 'elitesand-audio-setup-postponed-v1';
  let pending = null;
  let current = null;
  let settleStartup;
  const api = {
    startupSettled: false,
    whenStartupSettled: new Promise((resolve) => { settleStartup = resolve; }),
    ensureReady,
  };
  window.AudioComponentSetup = api;

  async function check() {
    // The server invalidates this cache after install or a downloaded pair is
    // removed. Normal checks also respect its forced-probe cooldown.
    const response = await fetch('/api/system-check', {
      cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(t('audioSetup.checkFailed'));
    const result = await response.json();
    if (!result.ffmpeg || typeof result.ffmpeg.available !== 'boolean') throw new Error(t('audioSetup.checkFailed'));
    return result.ffmpeg;
  }

  function ensureReady(options = {}) {
    if (options.signal?.aborted) return Promise.resolve(false);
    // Startup, imports and repeated clicks share one prompt/download.
    if (!pending) pending = run(options).finally(() => { pending = null; });
    if (!options.signal) return pending;
    const operation = pending;
    return new Promise((resolve, reject) => {
      const abort = () => { current?.close(false); finish(false); };
      const finish = (value, error) => {
        options.signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(value);
      };
      options.signal.addEventListener('abort', abort, { once: true });
      operation.then((value) => finish(value), (error) => finish(false, error));
    });
  }

  async function run({ startup = false, signal } = {}) {
    await window.EulaGate?.whenCleared;
    if (signal?.aborted) return false;
    let tools;
    let error = '';
    try { tools = await check(); } catch (failure) { error = failure.message; }
    if (signal?.aborted) return false;
    if (tools?.available) return true;
    if (startup) {
      try { if (sessionStorage.getItem(postponedKey) === '1') return false; } catch (_) { /* optional preference */ }
    }
    return prompt(tools, error, signal);
  }

  function prompt(tools, initialError, signal) {
    const modal = document.getElementById('audio-setup-modal');
    const install = document.getElementById('audio-setup-install');
    const later = document.getElementById('audio-setup-later');
    const status = document.getElementById('audio-setup-status');
    const progress = document.getElementById('audio-setup-progress');
    const sources = document.getElementById('audio-setup-sources');
    const size = document.getElementById('audio-setup-size');
    const previousFocus = document.activeElement;
    return new Promise((resolve) => {
      let closed = false, busy = false, polling = null, pollBusy = false;
      let lastStatus = null, error = initialError;
      let paintedTools;
      const render = () => {
        if (paintedTools !== tools) {
          paintedTools = tools;
          sources.replaceChildren();
          for (const source of tools?.download?.sources || []) {
            const link = document.createElement('a');
            link.href = source.url; link.textContent = source.label;
            link.target = '_blank'; link.rel = 'noopener noreferrer'; sources.appendChild(link);
          }
        }
        const maxMB = tools?.download?.maxBytes / (1024 * 1024);
        size.textContent = t('audioSetup.size', { size: Number.isFinite(maxMB) ? Math.ceil(maxMB) : 300 });
        install.disabled = busy;
        install.textContent = t(busy ? 'audioSetup.installing' : error ? 'audioSetup.retry' : 'audioSetup.install');
        later.textContent = t(busy ? 'audioSetup.background' : 'audioSetup.later');
        status.classList.toggle('audio-setup-error', !!error);
        if (error) status.textContent = t('audioSetup.failed', { error });
        else if (busy) {
          const percent = Number(lastStatus?.percent);
          status.textContent = lastStatus?.stage === 'download' && lastStatus?.totalBytes
            ? t('guide.ffmpegDownloadingProgress', {
              percent: Math.max(0, Math.min(100, Math.floor(percent || 0))),
              downloaded: (lastStatus.downloadedBytes / 1048576).toFixed(1),
              total: (lastStatus.totalBytes / 1048576).toFixed(1),
              speed: ((lastStatus.speedBytesPerSec || 0) / 1048576).toFixed(2),
            }) : t(lastStatus?.stage === 'download' ? 'audioSetup.installing' : 'audioSetup.verifying');
        } else status.textContent = t('audioSetup.missing');
        progress.hidden = !busy;
        if (lastStatus?.stage === 'download' && lastStatus?.totalBytes) progress.value = Number(lastStatus.percent) || 0;
        else progress.removeAttribute('value');
      };
      const poll = async () => {
        if (closed || pollBusy) return;
        pollBusy = true;
        try {
          const response = await fetch('/api/ffmpeg/download/status', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
          if (response.ok && !closed) { lastStatus = await response.json(); render(); }
        } catch (_) { /* The POST owns the terminal result. */ }
        finally { pollBusy = false; }
      };
      const close = (ready) => {
        if (closed) return;
        closed = true;
        clearInterval(polling);
        install.removeEventListener('click', download);
        later.removeEventListener('click', onLater);
        modal.removeEventListener('cancel', onCancel);
        document.removeEventListener('keydown', trapFocus, true);
        window.removeEventListener('i18n:change', render);
        signal?.removeEventListener('abort', onAbort);
        if (modal.open) modal.close();
        current = null;
        if (!ready) { try { sessionStorage.setItem(postponedKey, '1'); } catch (_) { /* optional */ } }
        if (previousFocus?.isConnected) previousFocus.focus();
        resolve(ready);
      };
      const onLater = () => close(false);
      const onCancel = (event) => { event.preventDefault(); close(false); };
      const onAbort = () => close(false);
      const trapFocus = (event) => {
        if (event.key !== 'Tab' || !modal.open) return;
        event.stopImmediatePropagation();
        const targets = [...modal.querySelectorAll('a[href], button:not([disabled])')];
        const first = targets[0], last = targets[targets.length - 1];
        if (!modal.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      };
      const download = async () => {
        if (busy || closed) return;
        busy = true; error = ''; lastStatus = null; render();
        later.focus();
        void poll(); polling = setInterval(poll, 500);
        try {
          // If the initial local check failed, retry it before asking for consent
          // to download: the source/size must be visible before starting a transfer.
          if (!tools) {
            tools = await check();
            if (tools.available) close(true);
            else { busy = false; render(); }
            return;
          }
          // Also idempotently reuses an installation already started in Settings.
          const response = await PinAuth.fetchWithPin('/api/ffmpeg/download', {
            method: 'POST', signal: AbortSignal.timeout(12 * 60 * 1000),
          });
          const result = await response.json();
          if (!response.ok || !result.ok) throw new Error(result.reason || t('guide.ffmpegDownloadFailed'));
          const verified = await check();
          if (!verified.available) throw new Error(t('audioSetup.checkFailed'));
          window.dispatchEvent(new CustomEvent('elitesand:ffmpeg-invalidated'));
          if (!closed) close(true);
        } catch (failure) {
          if (!closed) { error = failure.message; busy = false; render(); install.focus(); }
        } finally { clearInterval(polling); }
      };
      current = { close };
      install.addEventListener('click', download);
      later.addEventListener('click', onLater);
      modal.addEventListener('cancel', onCancel);
      document.addEventListener('keydown', trapFocus, true);
      signal?.addEventListener('abort', onAbort, { once: true });
      window.addEventListener('i18n:change', render);
      render(); modal.showModal(); install.focus();
    });
  }

  async function init() {
    try { await ensureReady({ startup: true }); }
    finally { api.startupSettled = true; settleStartup(); }
  }
  // PIN authentication must remain reachable even if it arrives after the
  // initial local health check. Never keep a native dialog above the PIN gate.
  if (typeof SocketClient !== 'undefined') SocketClient.on('auth:required', () => current?.close(false));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else void init();
})();
