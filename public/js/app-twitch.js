/**
 * Twitch 點歌控制面板 bridge。
 * Twitch service 只負責收聊天室事件；實際匯入永遠回到既有 queueYouTubeImport，
 * 因此一次只跑一個 yt-dlp/ffmpeg 工作。下載結果再回傳 server，由 server 回覆聊天室。
 */
(function () {
  'use strict';

  function showStatus(message, type) {
    const el = document.getElementById('twitch-status');
    if (el) el.textContent = message;
    if (typeof AppShared.showToast === 'function' && type) AppShared.showToast(message, type);
  }

  async function refreshStatus() {
    const el = document.getElementById('twitch-status');
    const button = document.getElementById('twitch-connect');
    const deviceLink = document.getElementById('twitch-device-link');
    const deauthorize = document.getElementById('twitch-deauthorize');
    try {
      const response = await PinAuth.fetchWithPin('/api/twitch/status');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '無法讀取 Twitch 狀態');
      if (!data.configured) {
        if (el) el.textContent = 'Twitch 尚未啟用，請聯絡 Elitesand Pro 開發者。';
        if (button) button.disabled = true;
        if (deauthorize) deauthorize.hidden = true;
        return;
      }
      if (button) button.disabled = false;
      if (deauthorize) {
        deauthorize.hidden = !data.authorized && !data.deviceAuthorization;
        deauthorize.textContent = data.authorized ? '解除 Twitch 授權' : '取消 Twitch 連接流程';
      }
      if (data.deviceAuthorization) {
        if (el) el.textContent = `請到 Twitch 輸入代碼：${data.deviceAuthorization.userCode}`;
        if (deviceLink) { deviceLink.href = data.deviceAuthorization.verificationUri; deviceLink.hidden = false; }
        return;
      }
      if (deviceLink) deviceLink.hidden = true;
      if (!data.authorized) {
        if (el) el.textContent = '尚未連接 Twitch。按「連接 Twitch」後登入並授權聊天室讀寫。';
      } else if (data.connected) {
        if (data.subscriptionState === 'error') {
          if (el) el.textContent = `Twitch 已連線，但事件訂閱失敗：${data.lastConnectionError || '稍後會重新確認連線'}`;
        } else if (data.subscriptionState === 'subscribing') {
          if (el) el.textContent = `已連接 ${data.broadcasterLogin || 'Twitch'}，正在訂閱開台、下播與聊天室事件…`;
        } else if (el) {
          const pendingText = data.pendingRequestCount ? `；${data.pendingRequestCount} 筆點歌待確認` : '';
          el.textContent = `已連接 ${data.broadcasterLogin || 'Twitch'}：正在監聽開台、下播與 ${data.command}${pendingText}。`;
        }
      } else if (data.connectionState === 'reconnecting' && el) {
        const seconds = data.nextRetryAt ? Math.max(1, Math.ceil((data.nextRetryAt - Date.now()) / 1000)) : null;
        el.textContent = `Twitch 連線中斷，${seconds ? `${seconds} 秒後` : '稍後'}自動重連（第 ${data.reconnectAttempt || 1} 次）${data.lastConnectionError ? `：${data.lastConnectionError}` : ''}`;
      } else if (el) {
        el.textContent = `已授權 ${data.broadcasterLogin || 'Twitch'}，正在連接 EventSub…`;
      }
    } catch (err) {
      if (el) el.textContent = `Twitch 狀態讀取失敗：${err.message}`;
    }
  }

  const connect = document.getElementById('twitch-connect');
  if (connect) {
    connect.addEventListener('click', async () => {
      // 必須在使用者點擊的同步時機開窗，才不會被瀏覽器當成 popup 擋掉。
      const authWindow = window.open('', 'elitesand-twitch-login');
      try {
        connect.disabled = true;
        const response = await PinAuth.fetchWithPin('/api/twitch/authorize');
        const data = await response.json();
        if (!response.ok || !data.verificationUri || !data.userCode) throw new Error(data.error || '無法開始 Twitch 授權');
        const deviceLink = document.getElementById('twitch-device-link');
        if (deviceLink) { deviceLink.href = data.verificationUri; deviceLink.hidden = false; }
        if (authWindow) {
          authWindow.location.replace(data.verificationUri);
          showStatus('已開啟 Twitch 登入與授權頁，請依 Twitch 指示完成授權。', 'info');
        } else {
          showStatus(`請按「前往 Twitch 輸入代碼」，輸入：${data.userCode}`, 'info');
        }
      } catch (err) {
        if (authWindow && !authWindow.closed) authWindow.close();
        connect.disabled = false;
        showStatus(`無法開始 Twitch 授權：${err.message}`, 'error');
      }
    });
  }

  // ─── 聊天室點歌：確認制（不自動下載）───
  // 觀眾送來的點歌只進「待確認」清單，由主播在首頁按「確認下載」才真的走匯入佇列，
  // 避免觀眾亂點就自動下載洗版。拒絕則回覆聊天室、不下載。
  const deauthorize = document.getElementById('twitch-deauthorize');
  if (deauthorize) {
    deauthorize.addEventListener('click', async () => {
      const isAuthorized = deauthorize.textContent.includes('解除');
      const confirmed = await window.DangerConfirm?.request({
        title: isAuthorized ? '確認解除 Twitch 授權' : '確認取消 Twitch 連接流程',
        summary: isAuthorized ? '這會停止 Twitch EventSub 與聊天室點歌，並移除本機保存的 Twitch 權杖。' : '這會取消目前等待中的 Twitch Device Code 授權流程。',
        impact: '已收到、尚待你確認的 Twitch 點歌會保留在點歌確認頁；歌曲、歌單與其他設定都不會刪除。之後可隨時重新連接 Twitch。',
        phrase: isAuthorized ? '解除 Twitch 授權' : '取消 Twitch 連接',
        confirmLabel: isAuthorized ? '解除授權' : '取消流程',
      });
      if (!confirmed) return;
      try {
        deauthorize.disabled = true;
        const response = await PinAuth.fetchWithPin('/api/twitch/deauthorize', { method: 'POST' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '解除 Twitch 授權失敗');
        if (data.remoteRevoked) showStatus('Twitch 授權已解除，本機權杖與遠端授權都已移除。', 'success');
        else if (data.remoteAlreadyInvalid) showStatus('本機 Twitch 授權已移除；Twitch 回報此權杖原本已失效。', 'success');
        else if (data.remoteError) showStatus(`本機 Twitch 授權已移除，但暫時無法通知 Twitch：${data.remoteError}`, 'warning');
        else showStatus('Twitch 連接流程已取消。', 'success');
        await refreshStatus();
      } catch (err) {
        showStatus(`解除 Twitch 授權失敗：${err.message}`, 'error');
      } finally {
        deauthorize.disabled = false;
      }
    });
  }

  const { escapeHtml } = SharedUtils;
  const pending = new Map();  // requestId -> request
  const busy = new Map();     // requestId -> placement（避免重複點，並顯示下載目的）

  const el = (id) => document.getElementById(id);

  function renderRequests() {
    const card = el('twitch-requests');
    const list = el('twitch-requests-list');
    const count = el('twitch-requests-count');
    if (!card || !list) return;
    if (count) count.textContent = String(pending.size);
    const badge = el('twitch-nav-badge');
    if (badge) { badge.textContent = String(pending.size); badge.hidden = pending.size === 0; }
    const rejectAll = el('twitch-reject-all');
    if (rejectAll) rejectAll.hidden = pending.size === 0;

    if (pending.size === 0) {
      list.innerHTML = '<div class="twitch-request-empty">目前沒有待確認的點歌</div>';
      return;
    }

    list.innerHTML = '';
    for (const req of pending.values()) {
      const isBusy = busy.has(req.requestId);
      const placement = busy.get(req.requestId);
      const row = document.createElement('div');
      row.className = 'twitch-req';
      const title = req.title || '無法取得影片標題';
      const author = req.author || '未知頻道';
      const thumbnail = req.thumbnail && /^https:\/\//i.test(req.thumbnail) ? req.thumbnail : '';
      row.innerHTML =
        `<div class="twitch-req-info">
          ${thumbnail
            ? `<img class="twitch-req-thumbnail" src="${escapeHtml(thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
            : `<div class="twitch-req-thumbnail twitch-req-thumbnail--empty">無縮圖</div>`}
          <div class="twitch-req-copy">
            <div class="twitch-req-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
            <div class="twitch-req-author">${escapeHtml(author)}</div>
            <div class="twitch-req-user">點歌者：${escapeHtml(req.requester || '觀眾')}</div>
            ${Array.isArray(req.assessment?.warnings) && req.assessment.warnings.length
              ? `<div class="pi-badge twitch-req-warning">⚠ ${escapeHtml(req.assessment.warnings.join('；'))}</div>`
              : req.durationWarning ? '<div class="pi-badge twitch-req-warning">⚠ 影片超過 15 分鐘，請確認後再下載</div>' : ''}
            <a class="twitch-req-url" href="${escapeHtml(req.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(req.url)}</a>
          </div>
        </div>
        <div class="twitch-req-actions">
          <button class="btn btn-sm btn-primary" data-act="next"${isBusy ? ' disabled' : ''}>${isBusy ? (placement === 'next' ? '插播下載中…' : '下載中…') : '插到下一首'}</button>
          <button class="btn btn-sm btn-ghost" data-act="end"${isBusy ? ' disabled' : ''}>加入尾端</button>
          <button class="btn btn-sm btn-ghost btn-danger" data-act="reject"${isBusy ? ' disabled' : ''}>拒絕</button>
        </div>`;
      row.querySelector('[data-act="next"]').addEventListener('click', () => confirmRequest(req.requestId, 'next'));
      row.querySelector('[data-act="end"]').addEventListener('click', () => confirmRequest(req.requestId, 'end'));
      row.querySelector('[data-act="reject"]').addEventListener('click', () => rejectRequest(req.requestId));
      list.appendChild(row);
    }
  }

  async function confirmRequest(requestId, placement = 'end') {
    const req = pending.get(requestId);
    if (!req || busy.has(requestId) || typeof AppShared.queueYouTubeImport !== 'function') return;
    busy.set(requestId, placement);
    renderRequests();
    try {
      const track = await AppShared.queueYouTubeImport(req.url, {
        source: `Twitch · ${req.requester || req.userName || '觀眾點歌'}`,
        assessment: req.assessment || null,
        placement,
      });
      const report = await new Promise((resolve) => SocketClient.sendWithCallback('twitch:song-request:result', {
        requestId, success: true, title: track && (track.title || track.name),
      }, resolve));
      if (!report?.ok) throw new Error(report?.error || '無法回覆 Twitch 聊天室');
      AppShared.showToast(`${placement === 'next' ? '已插到下一首' : '已加入清單尾端'}：${track && track.title ? track.title : '歌曲'}`, 'success');
      pending.delete(requestId);
    } catch (err) {
      // 仍保留 server 端 pending request：主播可重試，成功後聊天室仍會收到最終成功回覆。
      SocketClient.sendWithCallback('twitch:song-request:result', {
        requestId, success: false, retryable: true, error: err && err.message ? err.message : '下載或匯入失敗',
      }, () => {});
      AppShared.showToast('聊天室點歌下載失敗', 'error');
      // 失敗保留在清單，主播可再試一次
    } finally {
      busy.delete(requestId);
      renderRequests();
    }
  }

  function rejectRequest(requestId) {
    const req = pending.get(requestId);
    if (!req || busy.has(requestId)) return;
    busy.set(requestId, 'reject');
    renderRequests();
    SocketClient.sendWithCallback('twitch:song-request:result', { requestId, success: false, rejected: true }, (result) => {
      busy.delete(requestId);
      if (!result?.ok) {
        renderRequests();
        AppShared.showToast(`拒絕失敗：${result?.error || '伺服器沒有回應'}`, 'error');
        return;
      }
      pending.delete(requestId);
      renderRequests();
      AppShared.showToast('已略過這首點歌', 'info');
    });
  }

  const rejectAllButton = el('twitch-reject-all');
  if (rejectAllButton) rejectAllButton.addEventListener('click', async () => {
    if (!pending.size) return;
    const confirmed = await window.PanelConfirm?.request({
      title: `拒絕全部 ${pending.size} 筆點歌？`,
      summary: '這些待確認點歌會全部標記為略過。',
      impact: '已加入播放清單的歌曲與其他設定不受影響。',
      tone: 'danger',
      confirmLabel: '全部拒絕',
    });
    if (!confirmed) return;
    for (const requestId of [...pending.keys()]) rejectRequest(requestId);
  });

  SocketClient.on('twitch:song-request', (request) => {
    if (!request || !request.requestId || !request.url) return;
    pending.set(request.requestId, request);
    renderRequests();
    AppShared.showToast(`${request.requester || '觀眾'} 點了一首歌，請到「點歌」頁確認`, 'info');
  });

  // 面板剛重整／重新連線時，從 server 還原尚未處理的 request，不讓主播因重新整理而看不到點歌。
  SocketClient.on('twitch:requests', (requests) => {
    pending.clear();
    if (Array.isArray(requests)) requests.forEach((request) => {
      if (request && request.requestId && request.url) pending.set(request.requestId, request);
    });
    renderRequests();
  });

  SocketClient.on('twitch:song-request:expired', ({ requestId } = {}) => {
    if (!requestId || !pending.delete(requestId)) return;
    busy.delete(requestId);
    renderRequests();
    AppShared.showToast('有一筆 Twitch 點歌等待過久，已自動取消', 'info');
  });

  refreshStatus();
  setInterval(refreshStatus, 10000);
})();
