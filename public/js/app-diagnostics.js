/* User-requested support bundle. The server creates the ZIP in memory and
   applies its own redaction; this client only starts the local download. */
(function () {
  'use strict';

  const dom = window.AppShared?.dom;
  const button = dom?.diagnosticExportBtn;
  const reliabilitySummary = dom?.reliabilityEvidenceSummary;
  const reliabilityResetBtn = dom?.reliabilityResetBtn;
  const R12_MINIMUM_OBSERVED_MS = 4 * 60 * 60 * 1000;
  if (!button) return;

  function filenameFromDisposition(value) {
    const match = /filename="?([^";]+)"?/i.exec(value || '');
    return match ? match[1] : 'elitesand-pro-diagnostic.zip';
  }

  function formatDuration(ms) {
    const totalMinutes = Math.max(0, Math.floor(Number(ms || 0) / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `${hours} 小時 ${minutes} 分`;
    if (totalMinutes > 0) return `${totalMinutes} 分`;
    return '未滿 1 分';
  }

  function renderReliabilityEvidence(evidence) {
    if (!reliabilitySummary || !evidence || typeof evidence !== 'object') return;
    const obs = evidence.obs || {};
    const twitch = evidence.twitch || {};
    const observedMs = Math.max(0, Number(evidence.observedMs) || 0);
    const parts = [`本場已記錄 ${formatDuration(observedMs)}`];
    parts.push(observedMs >= R12_MINIMUM_OBSERVED_MS
      ? '四小時時長門檻已達成'
      : `距四小時時長門檻還差 ${formatDuration(R12_MINIMUM_OBSERVED_MS - observedMs)}`);
    if (obs.bothSourcesSeen) {
      parts.push(`OBS 歌詞／歌單同時連線 ${formatDuration(obs.bothSourcesConnectedMs)}`);
      parts.push(obs.interruptions ? `曾中斷 ${obs.interruptions} 次` : '未偵測到來源中斷');
    } else if (obs.displaySeen || obs.setlistSeen) {
      parts.push('OBS 兩個正式來源尚未同時連線');
    } else {
      parts.push('尚未偵測到正式 OBS 來源');
    }
    if (twitch.configured) {
      parts.push(twitch.connected ? 'Twitch 目前已連線' : `Twitch 狀態：${twitch.connectionState || '未連線'}`);
    } else {
      parts.push('Twitch 未啟用，不列入本場觀測');
    }
    reliabilitySummary.textContent = parts.join(' · ');
  }

  async function resetReliabilityEvidence() {
    if (!reliabilityResetBtn) return;
    const original = reliabilityResetBtn.textContent;
    reliabilityResetBtn.disabled = true;
    reliabilityResetBtn.textContent = '正在開始記錄…';
    try {
      const response = await (typeof PinAuth !== 'undefined'
        ? PinAuth.fetchWithPin('/api/diagnostics/reliability/reset', { method: 'POST' })
        : fetch('/api/diagnostics/reliability/reset', { method: 'POST' }));
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || '無法開始新的穩定性記錄，請稍後再試。');
      renderReliabilityEvidence(data.evidence);
      AppShared.showToast('已開始新一場直播穩定性記錄；不會變更歌曲、歌詞或設定。', 'success');
    } catch (error) {
      AppShared.showToast(error.message || '無法開始新的穩定性記錄，請稍後再試。', 'error');
    } finally {
      reliabilityResetBtn.disabled = false;
      reliabilityResetBtn.textContent = original;
    }
  }

  async function exportDiagnosticBundle() {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = '正在建立診斷包…';
    try {
      const response = await (typeof PinAuth !== 'undefined'
        ? PinAuth.fetchWithPin('/api/diagnostics/export', { cache: 'no-store' })
        : fetch('/api/diagnostics/export', { cache: 'no-store' }));
      if (!response.ok) {
        let message = '無法建立診斷包，請稍後再試。';
        try { message = (await response.json()).error || message; } catch (_) { /* keep safe fallback */ }
        throw new Error(message);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = filenameFromDisposition(response.headers.get('content-disposition'));
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      AppShared.showToast('診斷包已下載；分享前可先自行開啟檢查內容。', 'success');
    } catch (error) {
      AppShared.showToast(error.message || '無法建立診斷包，請稍後再試。', 'error');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  button.addEventListener('click', exportDiagnosticBundle);
  reliabilityResetBtn?.addEventListener('click', resetReliabilityEvidence);
  if (typeof SocketClient !== 'undefined') {
    SocketClient.on('client:counts', (counts = {}) => renderReliabilityEvidence(counts.runtimeEvidence));
  }
})();
