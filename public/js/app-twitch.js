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

  // ─── 點歌指令與規則設定 ───
  const requestNumber = (id) => Number(el(id)?.value);

  function collectRequestSettings() {
    return {
      enabled: !!el('twitch-request-enabled')?.checked,
      command: el('twitch-request-command')?.value || '',
      aliases: TwitchRequestSettings.parseAliases(el('twitch-request-aliases')?.value || ''),
      permissionLevel: el('twitch-request-permission')?.value || 'everyone',
      cooldownSeconds: requestNumber('twitch-request-cooldown'),
      maxPending: requestNumber('twitch-request-max-pending'),
      perUserPending: requestNumber('twitch-request-per-user'),
      rejectDuplicates: !!el('twitch-request-reject-duplicates')?.checked,
      maxDurationMinutes: requestNumber('twitch-request-max-duration'),
    };
  }

  function replySampleValues() {
    const values = TwitchReplySettings.sampleValues();
    values.command = el('twitch-request-command')?.value.trim() || TwitchRequestSettings.getDefaults().command;
    return values;
  }

  function updateRequestRulePreview(settings = collectRequestSettings()) {
    const preview = el('twitch-request-rule-preview');
    if (!preview) return;
    const permission = TwitchRequestSettings.PERMISSION_LEVELS.find((item) => item.key === settings.permissionLevel)?.label || '所有觀眾';
    const commands = [settings.command || '—', ...TwitchRequestSettings.parseAliases(settings.aliases)].join('、');
    const rules = [
      settings.enabled ? '接受點歌' : '暫停點歌',
      permission,
      settings.cooldownSeconds > 0 ? `每人 ${settings.cooldownSeconds} 秒冷卻` : '無冷卻',
      `總共最多 ${settings.maxPending || '—'} 首待確認`,
      settings.perUserPending > 0 ? `每人最多 ${settings.perUserPending} 首待確認` : '每人不限首數',
      settings.maxDurationMinutes > 0 ? `最長 ${settings.maxDurationMinutes} 分鐘` : '不限制歌曲長度',
      settings.rejectDuplicates ? '拒絕重複影片' : '允許重複影片',
    ];
    preview.textContent = `${commands}｜${rules.join('；')}`;
  }

  function validateRequestForm() {
    const validation = TwitchRequestSettings.validateSettings(collectRequestSettings());
    const error = validation.errors[0]?.message || '';
    const formError = el('twitch-request-form-error');
    const save = el('twitch-request-save');
    if (formError) { formError.textContent = error; formError.hidden = !error; }
    if (save) save.disabled = !!error;
    updateRequestRulePreview(validation.ok ? validation.settings : collectRequestSettings());
    return validation;
  }

  function markRequestSettingsChanged() {
    const status = el('twitch-request-save-status');
    if (status) status.textContent = '尚未儲存';
    validateRequestForm();
    TwitchReplySettings.REPLY_DEFINITIONS.forEach((definition) => {
      const item = document.querySelector(`[data-twitch-reply-key="${definition.key}"]`);
      if (item) updateReplyItem(item, definition);
    });
    updateReplyTestPreview();
  }

  function applyRequestSettings(settings, { savedMessage = '' } = {}) {
    const normalized = TwitchRequestSettings.normalizeSettings(settings);
    el('twitch-request-enabled').checked = normalized.enabled;
    el('twitch-request-command').value = normalized.command;
    el('twitch-request-aliases').value = normalized.aliases.join(', ');
    el('twitch-request-permission').value = normalized.permissionLevel;
    el('twitch-request-cooldown').value = String(normalized.cooldownSeconds);
    el('twitch-request-max-pending').value = String(normalized.maxPending);
    el('twitch-request-per-user').value = String(normalized.perUserPending);
    el('twitch-request-reject-duplicates').checked = normalized.rejectDuplicates;
    el('twitch-request-max-duration').value = String(normalized.maxDurationMinutes);
    const status = el('twitch-request-save-status');
    if (status) status.textContent = savedMessage;
    validateRequestForm();
    updateReplyTestPreview();
  }

  function buildRequestSettingsForm() {
    const permission = el('twitch-request-permission');
    if (!permission) return;
    permission.innerHTML = '';
    TwitchRequestSettings.PERMISSION_LEVELS.forEach((level) => {
      const option = document.createElement('option');
      option.value = level.key;
      option.textContent = level.label;
      permission.appendChild(option);
    });
    applyRequestSettings(TwitchRequestSettings.getDefaults());
  }

  function saveRequestSettings(settings, successMessage) {
    const validation = TwitchRequestSettings.validateSettings(settings);
    if (!validation.ok) { validateRequestForm(); return; }
    const save = el('twitch-request-save');
    if (save) save.disabled = true;
    SocketClient.sendWithCallback('twitch:request-settings:update', validation.settings, (result) => {
      if (!result?.ok) {
        if (save) save.disabled = false;
        showStatus(`點歌規則儲存失敗：${result?.error || '伺服器沒有回應'}`, 'error');
        return;
      }
      applyRequestSettings(result.settings || validation.settings, { savedMessage: successMessage });
      AppShared.showToast(successMessage, 'success');
    });
  }

  // ─── 聊天室自動回覆設定 ───
  let activeReplyTemplate = null;

  function updateReplyTestPreview() {
    const select = el('twitch-reply-test-event');
    const preview = el('twitch-reply-test-preview');
    if (!select || !preview) return;
    const item = document.querySelector(`[data-twitch-reply-key="${select.value}"]`);
    const template = item?.querySelector('[data-role="template"]')?.value || '';
    const validation = TwitchReplySettings.validateTemplate(template);
    preview.textContent = validation.valid
      ? `將送出：【回覆測試】${TwitchReplySettings.renderTemplate(template, replySampleValues())}`
      : '請先修正文案中的錯誤。';
  }

  function collectReplySettings() {
    const settings = {
      enabled: !!el('twitch-reply-enabled')?.checked,
      replyMode: el('twitch-reply-mode')?.value || 'reply',
      replies: {},
    };
    TwitchReplySettings.REPLY_DEFINITIONS.forEach((definition) => {
      const item = document.querySelector(`[data-twitch-reply-key="${definition.key}"]`);
      settings.replies[definition.key] = {
        enabled: !!item?.querySelector('[data-role="enabled"]')?.checked,
        template: item?.querySelector('[data-role="template"]')?.value || '',
      };
    });
    return settings;
  }

  function updateReplyItem(item, definition) {
    const input = item.querySelector('[data-role="template"]');
    const error = item.querySelector('[data-role="error"]');
    const count = item.querySelector('[data-role="count"]');
    const preview = item.querySelector('[data-role="preview"]');
    const validation = TwitchReplySettings.validateTemplate(input.value);
    item.classList.toggle('is-invalid', !validation.valid);
    error.hidden = validation.valid;
    error.textContent = validation.errors[0] || '';
    count.textContent = `${Array.from(input.value).length}/${TwitchReplySettings.MAX_MESSAGE_LENGTH}`;
    if (validation.valid) {
      preview.textContent = `預覽：${TwitchReplySettings.renderTemplate(input.value, replySampleValues())}`;
    } else {
      preview.textContent = `預覽：${definition.defaultTemplate}`;
    }
    return validation.valid;
  }

  function validateReplyForm() {
    let firstError = '';
    TwitchReplySettings.REPLY_DEFINITIONS.forEach((definition) => {
      const item = document.querySelector(`[data-twitch-reply-key="${definition.key}"]`);
      if (!item || updateReplyItem(item, definition)) return;
      if (!firstError) firstError = `${definition.label}：${item.querySelector('[data-role="error"]').textContent}`;
    });
    const validation = TwitchReplySettings.validateSettings(collectReplySettings());
    if (!firstError && !validation.ok) firstError = validation.errors[0]?.message || '回覆設定格式無效。';
    const formError = el('twitch-reply-form-error');
    const save = el('twitch-reply-save');
    if (formError) { formError.textContent = firstError; formError.hidden = !firstError; }
    if (save) save.disabled = !!firstError;
    return !firstError;
  }

  function markReplySettingsChanged() {
    const status = el('twitch-reply-save-status');
    if (status) status.textContent = '有尚未儲存的變更';
    validateReplyForm();
    updateReplyTestPreview();
  }

  function buildReplySettingsForm() {
    const container = el('twitch-reply-items');
    const variableButtons = el('twitch-reply-variable-buttons');
    const testEvent = el('twitch-reply-test-event');
    if (!container || !variableButtons || !testEvent) return;

    testEvent.innerHTML = '';
    TwitchReplySettings.REPLY_DEFINITIONS.forEach((definition) => {
      const option = document.createElement('option');
      option.value = definition.key;
      option.textContent = definition.label;
      testEvent.appendChild(option);
    });

    variableButtons.innerHTML = '';
    TwitchReplySettings.VARIABLE_DEFINITIONS.forEach((variable) => {
      const button = document.createElement('button');
      button.className = 'btn btn-sm btn-ghost twitch-reply-variable-button';
      button.type = 'button';
      button.dataset.variable = variable.key;
      button.textContent = `{${variable.key}}`;
      button.title = variable.label;
      button.addEventListener('click', () => {
        const input = activeReplyTemplate || container.querySelector('[data-role="template"]');
        if (!input) return;
        const token = `{${variable.key}}`;
        const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
        const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
        input.setRangeText(token, start, end, 'end');
        input.focus();
        activeReplyTemplate = input;
        markReplySettingsChanged();
      });
      variableButtons.appendChild(button);
    });

    container.innerHTML = '';
    const defaults = TwitchReplySettings.getDefaults();
    TwitchReplySettings.REPLY_DEFINITIONS.forEach((definition) => {
      const item = document.createElement('div');
      item.className = 'twitch-reply-item';
      item.dataset.twitchReplyKey = definition.key;
      item.innerHTML = `
        <div class="twitch-reply-item-head">
          <div class="twitch-reply-item-label">${escapeHtml(definition.label)}</div>
          <label class="switch"><input data-role="enabled" type="checkbox"><span class="track"></span></label>
        </div>
        <textarea class="input twitch-reply-template" data-role="template" maxlength="${TwitchReplySettings.MAX_MESSAGE_LENGTH}" aria-label="${escapeHtml(definition.label)}回覆文字"></textarea>
        <div class="twitch-reply-item-meta"><span class="twitch-reply-preview" data-role="preview"></span><span data-role="count"></span></div>
        <div class="twitch-reply-item-error" data-role="error" hidden></div>`;
      const input = item.querySelector('[data-role="template"]');
      const enabled = item.querySelector('[data-role="enabled"]');
      input.value = defaults.replies[definition.key].template;
      enabled.checked = defaults.replies[definition.key].enabled;
      input.addEventListener('focus', () => { activeReplyTemplate = input; });
      input.addEventListener('input', markReplySettingsChanged);
      enabled.addEventListener('change', markReplySettingsChanged);
      container.appendChild(item);
      updateReplyItem(item, definition);
    });
    updateReplyTestPreview();
  }

  function applyReplySettings(settings, { savedMessage = '' } = {}) {
    const normalized = TwitchReplySettings.normalizeSettings(settings);
    const master = el('twitch-reply-enabled');
    const mode = el('twitch-reply-mode');
    if (master) master.checked = normalized.enabled;
    if (mode) mode.value = normalized.replyMode;
    TwitchReplySettings.REPLY_DEFINITIONS.forEach((definition) => {
      const item = document.querySelector(`[data-twitch-reply-key="${definition.key}"]`);
      if (!item) return;
      item.querySelector('[data-role="enabled"]').checked = normalized.replies[definition.key].enabled;
      item.querySelector('[data-role="template"]').value = normalized.replies[definition.key].template;
      updateReplyItem(item, definition);
    });
    const status = el('twitch-reply-save-status');
    if (status) status.textContent = savedMessage;
    validateReplyForm();
    updateReplyTestPreview();
  }

  async function sendReplyTest() {
    if (!validateReplyForm()) return;
    const replyKey = el('twitch-reply-test-event')?.value || '';
    const definition = TwitchReplySettings.REPLY_DEFINITIONS.find((item) => item.key === replyKey);
    if (!definition) return;
    const confirmed = await window.PanelConfirm?.request({
      title: '送出 Twitch 測試訊息？',
      summary: `將把「${definition.label}」的範例回覆公開送到目前連接的 Twitch 聊天室。`,
      impact: '不會建立點歌或儲存設定；聊天室中的觀眾會看得到這則測試訊息。',
      confirmLabel: '送出測試訊息',
    });
    if (!confirmed) return;
    const button = el('twitch-reply-test-send');
    const status = el('twitch-reply-test-status');
    if (button) button.disabled = true;
    if (status) { status.textContent = '正在送出測試訊息…'; status.classList.remove('val--danger'); }
    SocketClient.sendWithCallback('twitch:reply-settings:test', {
      settings: collectReplySettings(),
      replyKey,
    }, (result) => {
      if (button) button.disabled = false;
      if (!result?.ok) {
        if (status) { status.textContent = `測試未送出：${result?.error || '伺服器沒有回應'}`; status.classList.add('val--danger'); }
        return;
      }
      if (status) { status.textContent = `已送出：${result.text}`; status.classList.remove('val--danger'); }
      AppShared.showToast('Twitch 測試訊息已送出', 'success');
    });
  }

  function saveReplySettings(settings, successMessage) {
    const validation = TwitchReplySettings.validateSettings(settings);
    if (!validation.ok) {
      validateReplyForm();
      return;
    }
    const save = el('twitch-reply-save');
    if (save) save.disabled = true;
    SocketClient.sendWithCallback('twitch:reply-settings:update', validation.settings, (result) => {
      if (!result?.ok) {
        if (save) save.disabled = false;
        showStatus(`回覆設定儲存失敗：${result?.error || '伺服器沒有回應'}`, 'error');
        return;
      }
      applyReplySettings(result.settings || validation.settings, { savedMessage: successMessage });
      AppShared.showToast(successMessage, 'success');
    });
  }

  buildRequestSettingsForm();
  buildReplySettingsForm();
  applyReplySettings(TwitchReplySettings.getDefaults());
  [
    'twitch-request-enabled',
    'twitch-request-command',
    'twitch-request-aliases',
    'twitch-request-permission',
    'twitch-request-cooldown',
    'twitch-request-max-pending',
    'twitch-request-per-user',
    'twitch-request-reject-duplicates',
    'twitch-request-max-duration',
  ].forEach((id) => {
    const control = el(id);
    const eventName = control?.matches('input[type="text"], input[type="number"]') ? 'input' : 'change';
    control?.addEventListener(eventName, markRequestSettingsChanged);
  });
  el('twitch-request-save')?.addEventListener('click', () => saveRequestSettings(collectRequestSettings(), '點歌規則已儲存'));
  el('twitch-request-reset')?.addEventListener('click', async () => {
    const confirmed = await window.PanelConfirm?.request({
      title: '還原 Twitch 點歌規則？',
      summary: '指令、使用者資格、冷卻與佇列限制會回到預設值。',
      impact: '聊天室自動回覆文案不會受影響。',
      confirmLabel: '還原預設值',
    });
    if (!confirmed) return;
    const defaults = TwitchRequestSettings.getDefaults();
    applyRequestSettings(defaults);
    saveRequestSettings(defaults, '點歌規則已還原');
  });
  el('twitch-reply-enabled')?.addEventListener('change', markReplySettingsChanged);
  el('twitch-reply-mode')?.addEventListener('change', markReplySettingsChanged);
  el('twitch-reply-test-event')?.addEventListener('change', updateReplyTestPreview);
  el('twitch-reply-test-send')?.addEventListener('click', sendReplyTest);
  el('twitch-reply-save')?.addEventListener('click', () => saveReplySettings(collectReplySettings(), '聊天室回覆設定已儲存'));
  el('twitch-reply-reset')?.addEventListener('click', async () => {
    const confirmed = await window.PanelConfirm?.request({
      title: '還原 Twitch 回覆預設值？',
      summary: '總開關、所有分項開關、回覆方式與自訂文案都會回到預設值。',
      impact: 'Twitch 授權、待確認點歌與其他設定不受影響。',
      confirmLabel: '還原預設值',
    });
    if (!confirmed) return;
    const defaults = TwitchReplySettings.getDefaults();
    applyReplySettings(defaults);
    saveReplySettings(defaults, '聊天室回覆設定已還原');
  });

  SocketClient.on('twitch:request-settings:update', (settings) => applyRequestSettings(settings, { savedMessage: '設定已同步' }));
  SocketClient.on('twitch:reply-settings:update', (settings) => applyReplySettings(settings, { savedMessage: '設定已同步' }));

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
        requestId,
        success: true,
        title: track && (track.title || track.name),
        artist: track && track.artist,
        position: placement === 'next' ? '下一首' : '歌單尾端',
        queue: Math.max(1, (AppShared.state.playlist || []).findIndex((item) => item && track && item.id === track.id) + 1),
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
