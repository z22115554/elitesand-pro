/**
 * Mac 內測版的一次性告知＋面板端探測（server/services/mac-beta-diagnostics.js）。
 *
 * 伺服器說「不是 Mac 內測版」時這支什麼都不做：不探測顯示卡、不問麥克風、不顯示任何東西。
 * 是 Mac 內測版時：
 *   1. 第一次啟動顯示一次告知，按「知道了」之後伺服器才開始回報；
 *   2. 只在本機 Electron 視窗（不是手機遙控）探測 navigator.gpu 與麥克風權限狀態，
 *      送回本機伺服器——原始的顯示卡廠商字串只在伺服器端分類，不會被轉送出去。
 */
(function () {
  'use strict';

  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const headers = () => (typeof AccessAuth !== 'undefined' ? AccessAuth.headers() : {});

  async function getStatus() {
    try {
      const response = await fetch('/api/mac-beta-diag/status', { cache: 'no-store', headers: headers() });
      return response.ok ? await response.json() : null;
    } catch (_) {
      return null;
    }
  }

  function post(url, body) {
    const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) };
    if (typeof PinAuth !== 'undefined' && PinAuth.fetchWithPin) return PinAuth.fetchWithPin(url, options);
    return fetch(url, options);
  }

  async function probeGpu() {
    const result = { api: false, adapter: false, shaderF16: false, vendor: '' };
    try {
      if (!navigator.gpu || typeof navigator.gpu.requestAdapter !== 'function') return result;
      result.api = true;
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return result;
      result.adapter = true;
      result.shaderF16 = !!(adapter.features && adapter.features.has('shader-f16'));
      let info = adapter.info;
      if (!info && typeof adapter.requestAdapterInfo === 'function') info = await adapter.requestAdapterInfo();
      result.vendor = info && typeof info.vendor === 'string' ? info.vendor : '';
    } catch (_) { /* 探測失敗就照目前拿到的回報 */ }
    return result;
  }

  async function micState() {
    try {
      if (!navigator.permissions || typeof navigator.permissions.query !== 'function') return { state: 'unsupported' };
      const status = await navigator.permissions.query({ name: 'microphone' });
      return { state: ['granted', 'denied', 'prompt'].includes(status.state) ? status.state : 'unsupported', status };
    } catch (_) {
      return { state: 'unsupported' };
    }
  }

  async function reportClientInfo() {
    const [gpu, mic] = await Promise.all([probeGpu(), micState()]);
    try { await post('/api/mac-beta-diag/client', { gpu, mic: mic.state }); } catch (_) { /* 安靜失敗 */ }
    // 使用者之後在練唱頁允許或拒絕麥克風時，再回報一次新的狀態
    if (mic.status && 'onchange' in mic.status) {
      mic.status.onchange = () => {
        const state = ['granted', 'denied', 'prompt'].includes(mic.status.state) ? mic.status.state : 'unsupported';
        post('/api/mac-beta-diag/client', { mic: state }).catch(() => {});
      };
    }
  }

  function anotherDialogOpen() {
    const pinPending = document.documentElement.dataset.pinOnboarding === 'pending';
    return pinPending || Array.from(document.querySelectorAll('[aria-modal="true"]'))
      .some((el) => !el.hidden && el.getClientRects().length);
  }

  function showNotice() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal';
      overlay.id = 'mac-beta-diag-modal';
      const card = document.createElement('div');
      card.className = 'modal-card modal-card--small';
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');
      card.setAttribute('aria-labelledby', 'mac-beta-diag-title');
      const head = document.createElement('div');
      head.className = 'modal-head';
      const title = document.createElement('h3');
      title.id = 'mac-beta-diag-title';
      title.textContent = t('macBetaDiag.title');
      head.appendChild(title);
      const body = document.createElement('div');
      body.className = 'modal-body';
      for (const key of ['macBetaDiag.intro', 'macBetaDiag.collects', 'macBetaDiag.excludes', 'macBetaDiag.optOut']) {
        const p = document.createElement('p');
        p.className = 'sub';
        p.textContent = t(key);
        body.appendChild(p);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-primary modal-submit';
      button.textContent = t('macBetaDiag.ack');
      button.addEventListener('click', async () => {
        button.disabled = true;
        let ok = false;
        try { ok = (await post('/api/mac-beta-diag/ack')).ok; } catch (_) { ok = false; }
        overlay.remove();
        resolve(ok);
      });
      body.appendChild(button);
      card.appendChild(head);
      card.appendChild(body);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      button.focus();
    });
  }

  async function init(startedAt = Date.now()) {
    const status = await getStatus();
    if (!status || !status.macBeta || !status.available || !status.local) return;
    if (status.noticeRequired) {
      // 使用條款、PIN 設定、新手導覽這些對話框先處理完再出來，最多等兩分鐘
      if (anotherDialogOpen() && Date.now() - startedAt < 2 * 60 * 1000) {
        setTimeout(() => init(startedAt), 1500);
        return;
      }
      if (!await showNotice()) return;
      const after = await getStatus();
      if (after && after.collecting) reportClientInfo();
      return;
    }
    if (status.collecting) reportClientInfo();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init());
  else init();
})();
