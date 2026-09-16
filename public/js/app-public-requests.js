/**
 * 公開點歌頁控制面板 bridge。
 * 中繼連線與待核准佇列都在伺服器端（song-request-relay-service.js）；這裡只負責
 * 顯示狀態／分享連結／QR、選擇要公開哪一份歌單，以及核准／拒絕待處理的點歌請求。
 */
(function () {
  'use strict';

  const { escapeHtml } = SharedUtils;
  const el = (id) => document.getElementById(id);
  const fallbackCatalog = Object.freeze({ ...(window.I18n?.catalogs?.['zh-TW'] || {}) });
  const fallbackT = (key, vars = {}) => {
    const template = fallbackCatalog[key];
    return typeof template === 'string'
      ? template.replace(/\{([^}]+)\}/g, (token, name) => Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : token)
      : '';
  };
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : fallbackT(key, vars));
  const ALL_CATALOG_PLAYLIST_ID = '__all-library__';

  let lastStatus = { configured: false, enabled: false, connected: false, connecting: false, publicSlug: '', shareUrl: '', publishedPlaylistId: '', isCustomSlug: false, customSlugAttemptsRemaining: 3 };
  let pendingRequests = [];
  let playlists = [];
  const busy = new Set();

  function currentPlaylistIds() {
    try {
      const ids = window.VKState?.getPlaylistIds?.();
      return Array.isArray(ids) ? ids.filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }

  function setStatusChip(text, state) {
    const chip = el('public-request-status-connection');
    if (!chip) return;
    chip.textContent = text;
    chip.dataset.state = state;
  }

  function renderStatus() {
    const toggle = el('public-request-enable-toggle');
    if (toggle) toggle.checked = lastStatus.enabled;

    if (!lastStatus.configured) {
      setStatusChip(t('publicRequest.statusUnconfigured'), 'off');
    } else if (!lastStatus.enabled) {
      setStatusChip(t('publicRequest.statusDisabled'), 'muted');
    } else if (lastStatus.connected) {
      setStatusChip(t('publicRequest.statusConnected'), 'on');
    } else if (lastStatus.reconnectSuppressed) {
      setStatusChip(t('publicRequest.statusReplaced'), 'warn');
    } else if (lastStatus.connecting) {
      setStatusChip(t('publicRequest.statusConnecting'), 'warn');
    } else {
      setStatusChip(t('publicRequest.statusReconnecting'), 'warn');
    }

    const shareRow = el('public-request-share-row');
    const shareInput = el('public-request-share-url');
    const qr = el('public-request-qr');
    const showShare = lastStatus.enabled && !!lastStatus.shareUrl;
    if (shareRow) shareRow.hidden = !showShare;
    if (showShare) {
      if (shareInput) shareInput.value = lastStatus.shareUrl;
      // QR 由伺服器端用既有的 qrcode 套件產生（跟 device-access.js 的 LAN 配對 QR 同一套），
      // 面板只負責顯示 data URL，不在瀏覽器端重新產生。
      if (qr && lastStatus.qrDataUrl) qr.src = lastStatus.qrDataUrl;
    }

    // 已經是自訂網址時，「重新產生連結」（隨機亂碼）這顆按鈕就沒有意義了：使用者
    // 要換網址直接打新的自訂字串即可，不需要兩個入口做同一件事。
    const rotateBtn = el('public-request-rotate-link');
    if (rotateBtn) rotateBtn.hidden = !!lastStatus.isCustomSlug;

    const remaining = Number.isFinite(lastStatus.customSlugAttemptsRemaining) ? lastStatus.customSlugAttemptsRemaining : 3;
    const remainingEl = el('public-request-slug-remaining');
    if (remainingEl) remainingEl.textContent = remaining > 0 ? t('publicRequest.slugRemaining', { count: remaining }) : t('publicRequest.slugExhausted');
    const slugInput = el('public-request-custom-slug');
    const applyBtn = el('public-request-apply-slug');
    if (slugInput) slugInput.disabled = remaining <= 0;
    if (applyBtn) applyBtn.disabled = remaining <= 0;

    const select = el('public-request-catalog-select');
    if (select && select.value !== lastStatus.publishedPlaylistId) select.value = lastStatus.publishedPlaylistId || '';
  }

  function renderCatalogOptions() {
    const select = el('public-request-catalog-select');
    if (!select) return;
    const previous = select.value;
    select.innerHTML = '';
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = t('publicRequest.catalogNone');
    select.appendChild(emptyOption);
    const allOption = document.createElement('option');
    allOption.value = ALL_CATALOG_PLAYLIST_ID;
    allOption.textContent = t('publicRequest.catalogAll');
    select.appendChild(allOption);
    playlists.forEach((playlist) => {
      const option = document.createElement('option');
      option.value = playlist.id;
      option.textContent = `${playlist.name}（${playlist.trackIds.length}）`;
      select.appendChild(option);
    });
    select.value = lastStatus.publishedPlaylistId || previous || '';

    const empty = el('public-request-catalog-empty');
    const createButton = el('public-request-create-catalog');
    if (empty) empty.hidden = playlists.length > 0;
    if (createButton) createButton.disabled = currentPlaylistIds().length === 0;
  }

  function renderPending() {
    const list = el('public-request-pending-list');
    const count = el('public-request-pending-count');
    if (count) count.textContent = String(pendingRequests.length);
    if (!list) return;
    if (!pendingRequests.length) {
      list.innerHTML = `<div class="twitch-request-empty">${escapeHtml(t('publicRequest.pendingEmpty'))}</div>`;
      return;
    }
    list.innerHTML = pendingRequests.map((request) => {
      const isBusy = busy.has(request.requestId);
      const meta = [request.artist, request.displayName ? t('publicRequest.requestedBy', { name: request.displayName }) : '']
        .filter(Boolean).map(escapeHtml).join(' · ');
      return `
        <div class="twitch-history-row" data-request-id="${escapeHtml(request.requestId)}">
          <div>
            <div class="label">${escapeHtml(request.title)}</div>
            ${meta ? `<div class="sub">${meta}</div>` : ''}
            ${request.note ? `<div class="sub">${escapeHtml(request.note)}</div>` : ''}
          </div>
          <div class="twitch-live-actions">
            <button class="btn btn-sm" type="button" data-action="reject" ${isBusy ? 'disabled' : ''}>${escapeHtml(t('publicRequest.reject'))}</button>
            <button class="btn btn-sm" type="button" data-action="approve-end" ${isBusy ? 'disabled' : ''}>${escapeHtml(t('publicRequest.approveEnd'))}</button>
            <button class="btn btn-sm btn-primary" type="button" data-action="approve-next" ${isBusy ? 'disabled' : ''}>${escapeHtml(t('publicRequest.approveNext'))}</button>
          </div>
        </div>`;
    }).join('');
  }

  function withBusy(requestId, fn) {
    if (busy.has(requestId)) return;
    busy.add(requestId);
    renderPending();
    fn(() => { busy.delete(requestId); renderPending(); });
  }

  function approve(requestId, placement) {
    withBusy(requestId, (done) => {
      SocketClient.sendWithCallback('public-request:approve', { requestId, placement }, (result) => {
        done();
        if (!result?.ok) AppShared.showToast(result?.error || t('publicRequest.approveFailed'), 'error');
        else AppShared.showToast(t('publicRequest.approved'), 'success');
      });
    });
  }

  function reject(requestId) {
    withBusy(requestId, (done) => {
      SocketClient.sendWithCallback('public-request:reject', { requestId }, (result) => {
        done();
        if (!result?.ok) AppShared.showToast(result?.error || t('publicRequest.rejectFailed'), 'error');
      });
    });
  }

  el('public-request-pending-list')?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-request-id]');
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!row || !action) return;
    const requestId = row.dataset.requestId;
    if (action === 'reject') reject(requestId);
    else if (action === 'approve-next') approve(requestId, 'next');
    else if (action === 'approve-end') approve(requestId, 'end');
  });

  el('public-request-enable-toggle')?.addEventListener('change', (event) => {
    const checked = event.target.checked;
    event.target.disabled = true;
    const event_ = checked ? 'public-request:enable' : 'public-request:disable';
    SocketClient.sendWithCallback(event_, {}, (result) => {
      event.target.disabled = false;
      if (!result?.ok) {
        event.target.checked = !checked;
        AppShared.showToast(result?.error || t('publicRequest.toggleFailed'), 'error');
      }
    });
  });

  el('public-request-rotate-link')?.addEventListener('click', (event) => {
    event.target.disabled = true;
    SocketClient.sendWithCallback('public-request:rotate-link', {}, (result) => {
      event.target.disabled = false;
      if (!result?.ok) AppShared.showToast(result?.error || t('publicRequest.rotateFailed'), 'error');
      else AppShared.showToast(t('publicRequest.rotated'), 'success');
    });
  });

  el('public-request-apply-slug')?.addEventListener('click', (event) => {
    const input = el('public-request-custom-slug');
    const customSlug = (input?.value || '').trim();
    if (!customSlug) return;
    event.target.disabled = true;
    SocketClient.sendWithCallback('public-request:rotate-link', { customSlug }, (result) => {
      event.target.disabled = false;
      if (!result?.ok) {
        AppShared.showToast(result?.error || t('publicRequest.slugApplyFailed'), 'error');
        return;
      }
      if (input) input.value = '';
      AppShared.showToast(t('publicRequest.slugApplied'), 'success');
    });
  });

  el('public-request-copy-link')?.addEventListener('click', async () => {
    const value = el('public-request-share-url')?.value || '';
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      AppShared.showToast(t('publicRequest.linkCopied'), 'success');
    } catch (_) {
      el('public-request-share-url')?.select();
    }
  });

  el('public-request-catalog-select')?.addEventListener('change', (event) => {
    SocketClient.sendWithCallback('public-request:set-catalog', { playlistId: event.target.value }, (result) => {
      if (!result?.ok) {
        AppShared.showToast(result?.error || t('publicRequest.catalogFailed'), 'error');
        renderCatalogOptions();
        return;
      }
      lastStatus = result;
      renderStatus();
      renderCatalogOptions();
    });
  });

  el('public-request-create-catalog')?.addEventListener('click', (event) => {
    const button = event.currentTarget;
    const trackIds = currentPlaylistIds();
    if (!trackIds.length) {
      AppShared.showToast(t('publicRequest.catalogCreateEmpty'), 'error');
      return;
    }
    button.disabled = true;
    const baseName = t('publicRequest.catalogDefaultName');
    const existingNames = new Set(playlists.map((playlist) => playlist.name));
    let name = baseName;
    let suffix = 2;
    while (existingNames.has(name)) name = `${baseName} ${suffix++}`;
    SocketClient.sendWithCallback('savedPlaylists:create', { name, trackIds }, (created) => {
      if (!created?.ok || !created.playlist) {
        button.disabled = false;
        AppShared.showToast(created?.error || t('publicRequest.catalogCreateFailed'), 'error');
        return;
      }
      playlists = playlists.filter((playlist) => playlist.id !== created.playlist.id).concat([created.playlist]);
      renderCatalogOptions();
      const select = el('public-request-catalog-select');
      if (select) select.value = created.playlist.id;
      SocketClient.sendWithCallback('public-request:set-catalog', { playlistId: created.playlist.id }, (result) => {
        button.disabled = false;
        if (!result?.ok) {
          AppShared.showToast(result?.error || t('publicRequest.catalogFailed'), 'error');
          return;
        }
        lastStatus = result;
        renderStatus();
        renderCatalogOptions();
        AppShared.showToast(t('publicRequest.catalogCreated', { name: created.playlist.name }), 'success');
      });
    });
  });

  SocketClient.on('public-request:status', (status) => {
    if (!status) return;
    lastStatus = status;
    renderStatus();
    renderCatalogOptions();
  });
  SocketClient.on('public-request:list', (requests) => {
    pendingRequests = Array.isArray(requests) ? requests : [];
    renderPending();
  });
  SocketClient.on('public-request:new', (request) => {
    if (!request?.requestId) return;
    if (!pendingRequests.some((item) => item.requestId === request.requestId)) pendingRequests.push(request);
    renderPending();
    AppShared.showToast(t('publicRequest.newRequest', { title: request.title }), 'info');
  });
  SocketClient.on('savedPlaylists:list', (list) => {
    playlists = Array.isArray(list) ? list : [];
    renderCatalogOptions();
  });
  SocketClient.on('state:sync', () => {
    if (!playlists.length) renderCatalogOptions();
  });

  function refreshSavedPlaylists() {
    if (!SocketClient.connected()) return;
    SocketClient.sendWithCallback('savedPlaylists:get', null, (list) => {
      playlists = Array.isArray(list) ? list : [];
      renderCatalogOptions();
    });
  }

  // 初次載入可能早於 Socket 握手；連線完成後一定要補查一次，否則重整後
  // savedPlaylists:get 會在未連線時被丟掉，選單就會錯誤地只剩「尚未選擇」。
  SocketClient.on('connection-change', (connected) => {
    if (connected) refreshSavedPlaylists();
  });
  refreshSavedPlaylists();

  renderStatus();
  renderPending();
  window.addEventListener('i18n:change', () => { renderStatus(); renderPending(); renderCatalogOptions(); });
})();
