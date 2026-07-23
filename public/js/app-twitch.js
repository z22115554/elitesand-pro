/**
 * Twitch 點歌控制面板 bridge。
 * Twitch service 只負責收聊天室事件；實際匯入永遠回到既有 queueYouTubeImport。
 */
(function () {
  'use strict';

  const { escapeHtml } = SharedUtils;
  const el = (id) => document.getElementById(id);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const pending = new Map();
  const busy = new Map();
  const dirty = { commands: false, rules: false, blacklist: false, reward: false, replies: false, custom: false };
  let requestSaved = TwitchRequestSettings.getDefaults();
  let requestDraft = clone(requestSaved);
  let rewardSaved = TwitchRewardSettings.getDefaults();
  let rewardDraft = clone(rewardSaved);
  let replySaved = TwitchReplySettings.getDefaults();
  let replyDraft = clone(replySaved);
  let activeCommandKey = 'request';
  let activeReplyKey = 'received';
  let activeBlacklistId = '';
  let activeCustomCommandId = '';
  let historyEntries = [];
  let focusBeforeManagement = null;
  let lastRuntimeStatus = null;

  function showStatus(message, type) {
    const status = el('twitch-status');
    if (status) status.textContent = message;
    if (typeof AppShared.showToast === 'function' && type) AppShared.showToast(message, type);
  }

  function setStatusChip(id, text, state = 'muted') {
    const chip = el(id);
    if (!chip) return;
    chip.textContent = text;
    chip.dataset.state = state;
  }

  function updateMainStatus() {
    const runtime = lastRuntimeStatus || {};
    const connected = !!runtime.connected;
    const authorized = !!runtime.authorized;
    setStatusChip('twitch-status-connection', connected ? `已連接 ${runtime.broadcasterLogin || 'Twitch'}` : (authorized ? 'Twitch 連線中' : 'Twitch 未連接'), connected ? 'on' : (authorized ? 'warn' : 'off'));
    setStatusChip('twitch-status-request', requestSaved.enabled ? '點歌已開放' : '點歌已暫停', requestSaved.enabled ? 'on' : 'off');
    const rewardStatus = rewardSaved.enabled ? (rewardSaved.paused ? '忠誠點數已暫停' : '忠誠點數已啟用') : '忠誠點數已停用';
    setStatusChip('twitch-status-reward', rewardStatus, rewardSaved.enabled && !rewardSaved.paused ? 'on' : 'muted');
    setStatusChip('twitch-status-replies', replySaved.enabled ? '自動回覆已啟用' : '自動回覆已停用', replySaved.enabled ? 'on' : 'muted');
    const quick = el('twitch-request-quick-toggle');
    if (quick) quick.textContent = requestSaved.enabled ? '暫停點歌' : '開放點歌';
  }

  function applyRewardRuntimeStatus(status) {
    const label = el('twitch-reward-auth-status');
    const reauthorize = el('twitch-reward-reauthorize');
    const summary = el('twitch-reward-synced-summary');
    const syncError = el('twitch-reward-sync-error');
    if (!label || !reauthorize || !summary || !syncError) return;
    const missingRewardScope = Array.isArray(status?.missingScopes) && status.missingScopes.includes('channel:manage:redemptions');
    reauthorize.hidden = !status?.configured || (!!status?.authorized && !missingRewardScope);
    if (!status?.configured) label.textContent = '尚未設定 Twitch Client ID。';
    else if (!status?.authorized) label.textContent = '尚未連接 Twitch；啟用獎勵前需要先授權。';
    else if (missingRewardScope) label.textContent = '目前授權缺少忠誠點數管理權限，請重新連接 Twitch 一次。';
    else if (status.rewardSync?.error) label.textContent = '同步失敗；下方保留 Twitch 上次已確認的狀態。';
    else if (status.reward?.paused && status.reward?.rewardId) label.textContent = '專用獎勵目前暫停兌換。';
    else if (status.reward?.enabled && status.reward?.rewardId && status.rewardSubscriptionReady) label.textContent = '專用獎勵已啟用並監聽兌換。';
    else if (status.reward?.enabled && status.reward?.rewardId) label.textContent = '獎勵已建立；EventSub 正在等待忠誠點數兌換訂閱。';
    else if (status.reward?.rewardId) label.textContent = '專用獎勵已停用；再次開啟並儲存即可恢復。';
    else label.textContent = '尚未建立專用獎勵；開啟後按「儲存並同步 Twitch」。';

    const confirmed = TwitchRewardSettings.normalizeSettings(status?.reward);
    if (confirmed.rewardId) {
      const state = confirmed.enabled ? (confirmed.paused ? '已暫停' : '已啟用') : '已停用';
      const limits = [
        confirmed.maxPerStream > 0 ? `每場 ${confirmed.maxPerStream} 次` : '每場不限',
        confirmed.maxPerUserPerStream > 0 ? `每人每場 ${confirmed.maxPerUserPerStream} 次` : '每人不限',
        confirmed.globalCooldownSeconds > 0 ? `冷卻 ${confirmed.globalCooldownSeconds} 秒` : '無冷卻',
      ].join('｜');
      const runtime = status.rewardSync || {};
      const extras = [];
      if (Number.isSafeInteger(runtime.redemptionsRedeemedCurrentStream)) extras.push(`同步時本場已兌換 ${runtime.redemptionsRedeemedCurrentStream} 次`);
      if (runtime.isInStock === false) extras.push('目前不可兌換');
      summary.textContent = `${state}｜${confirmed.title}｜${Number(confirmed.cost).toLocaleString()} 點｜${limits}${extras.length ? `｜${extras.join('｜')}` : ''}`;
    } else {
      summary.textContent = '尚無 Twitch 已確認的專用獎勵。';
    }
    syncError.textContent = status.rewardSync?.error || '';
    syncError.hidden = !syncError.textContent;
  }

  async function refreshStatus() {
    const statusText = el('twitch-status');
    const connect = el('twitch-connect');
    const deviceLink = el('twitch-device-link');
    const deauthorize = el('twitch-deauthorize');
    try {
      const response = await PinAuth.fetchWithPin('/api/twitch/status');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '無法讀取 Twitch 狀態');
      lastRuntimeStatus = data;
      applyRewardRuntimeStatus(data);
      updateMainStatus();
      if (!data.configured) {
        if (statusText) statusText.textContent = 'Twitch 尚未啟用，請聯絡 Elitesand Pro 開發者。';
        if (connect) connect.disabled = true;
        if (deauthorize) deauthorize.hidden = true;
        return;
      }
      if (connect) connect.disabled = false;
      if (deauthorize) {
        deauthorize.hidden = !data.authorized && !data.deviceAuthorization;
        deauthorize.textContent = data.authorized ? '解除 Twitch 授權' : '取消 Twitch 連接流程';
      }
      if (data.deviceAuthorization) {
        if (statusText) statusText.textContent = `請到 Twitch 輸入代碼：${data.deviceAuthorization.userCode}`;
        if (deviceLink) { deviceLink.href = data.deviceAuthorization.verificationUri; deviceLink.hidden = false; }
        return;
      }
      if (deviceLink) deviceLink.hidden = true;
      if (!data.authorized) {
        if (statusText) statusText.textContent = '尚未連接 Twitch。按「連接 Twitch」後登入並授權聊天室讀寫。';
      } else if (data.connected) {
        if (data.subscriptionState === 'error') {
          if (statusText) statusText.textContent = `Twitch 已連線，但事件訂閱失敗：${data.lastConnectionError || '稍後會重新確認連線'}`;
        } else if (data.subscriptionState === 'subscribing') {
          if (statusText) statusText.textContent = `已連接 ${data.broadcasterLogin || 'Twitch'}，正在訂閱開台、下播與聊天室事件…`;
        } else if (statusText) {
          const pendingText = data.pendingRequestCount ? `；${data.pendingRequestCount} 筆點歌待確認` : '';
          statusText.textContent = `已連接 ${data.broadcasterLogin || 'Twitch'}：正在監聽 ${data.command}${pendingText}。`;
        }
      } else if (data.connectionState === 'reconnecting' && statusText) {
        const seconds = data.nextRetryAt ? Math.max(1, Math.ceil((data.nextRetryAt - Date.now()) / 1000)) : null;
        statusText.textContent = `Twitch 連線中斷，${seconds ? `${seconds} 秒後` : '稍後'}自動重連（第 ${data.reconnectAttempt || 1} 次）${data.lastConnectionError ? `：${data.lastConnectionError}` : ''}`;
      } else if (statusText) {
        statusText.textContent = `已授權 ${data.broadcasterLogin || 'Twitch'}，正在連接 EventSub…`;
      }
    } catch (err) {
      if (statusText) statusText.textContent = `Twitch 狀態讀取失敗：${err.message}`;
      setStatusChip('twitch-status-connection', 'Twitch 狀態讀取失敗', 'off');
    }
  }

  function setDirty(category, value) {
    dirty[category] = !!value;
    const nav = document.querySelector(`[data-twitch-pane="${category}"]`);
    const dot = nav?.querySelector('.twitch-dirty-dot');
    if (dot) dot.hidden = !dirty[category];
    const count = Object.values(dirty).filter(Boolean).length;
    const summary = el('twitch-management-dirty-summary');
    if (summary) summary.textContent = count ? `${count} 個分類有尚未儲存的變更` : '所有設定都已儲存';
  }

  function switchManagementPane(pane) {
    document.querySelectorAll('.twitch-management-nav-item').forEach((button) => {
      const active = button.dataset.twitchPane === pane;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-twitch-pane-content]').forEach((section) => {
      const active = section.dataset.twitchPaneContent === pane;
      section.hidden = !active;
      section.classList.toggle('is-active', active);
    });
    if (pane === 'history') refreshHistory();
  }

  function resetDraftsToSaved() {
    requestDraft = clone(requestSaved);
    rewardDraft = clone(rewardSaved);
    replyDraft = clone(replySaved);
    Object.keys(dirty).forEach((category) => setDirty(category, false));
    renderCommandList();
    loadCommandEditor();
    applyRuleFields();
    renderBlacklistList();
    loadBlacklistEditor();
    renderCustomCommandList();
    loadCustomCommandEditor();
    applyRewardFields();
    renderReplyEvents();
    loadReplyEditor();
  }

  async function closeManagement({ force = false } = {}) {
    const modal = el('twitch-management-modal');
    if (!modal || modal.hidden) return;
    if (!force && Object.values(dirty).some(Boolean)) {
      const confirmed = await window.PanelConfirm?.request({
        title: '放棄尚未儲存的 Twitch 設定？',
        summary: '管理視窗中仍有變更尚未送到伺服器。',
        impact: '選擇放棄後會還原成上次已儲存的設定；待確認點歌不受影響。',
        confirmLabel: '放棄變更',
      });
      if (!confirmed) return;
      resetDraftsToSaved();
    }
    modal.hidden = true;
    const search = el('twitch-settings-search');
    if (search) search.value = '';
    hideSearchResults();
    (focusBeforeManagement && focusBeforeManagement.isConnected ? focusBeforeManagement : el('twitch-management-open'))?.focus();
  }

  function openManagement(pane = 'commands') {
    const modal = el('twitch-management-modal');
    if (!modal) return;
    focusBeforeManagement = document.activeElement;
    if (modal.parentElement !== document.body) document.body.appendChild(modal);
    switchManagementPane(pane);
    modal.hidden = false;
    window.setTimeout(() => (el('twitch-settings-search') || el('twitch-management-title'))?.focus(), 0);
  }

  function hideSearchResults() {
    const results = el('twitch-settings-search-results');
    if (results) { results.hidden = true; results.innerHTML = ''; }
  }

  const searchEntries = [
    { label: '每人冷卻／全域冷卻', category: '指令', terms: '冷卻 cooldown 每人 全域', pane: 'commands', commandKey: 'request', focusId: 'twitch-command-user-cooldown' },
    { label: '目前歌曲指令', category: '指令', terms: '目前歌曲 current song', pane: 'commands', commandKey: 'currentSong', focusId: 'twitch-command-name' },
    { label: '取消點歌指令', category: '指令', terms: '取消 點歌 退款', pane: 'commands', commandKey: 'cancelRequest', focusId: 'twitch-command-name' },
    { label: '待確認總上限', category: '接受規則', terms: '上限 數量 待確認', pane: 'rules', focusId: 'twitch-request-max-pending' },
    { label: '重複歌曲檢查範圍', category: '接受規則', terms: '重複 待確認 播放清單 本場 最近', pane: 'rules', focusId: 'twitch-request-duplicate-scope' },
    { label: '直播場次與公平性', category: '接受規則', terms: '直播 開台 每場 每人 管理員 豁免 連續點歌', pane: 'rules', focusId: 'twitch-request-live-only' },
    { label: '黑名單', category: '黑名單', terms: '黑名單 封鎖 使用者 影片 頻道 關鍵字', pane: 'blacklist', focusId: 'twitch-blacklist-value' },
    { label: '忠誠點數退款', category: '忠誠點數', terms: '退款 忠誠點數 reward redemption', pane: 'reward', focusId: 'twitch-reward-enabled' },
    { label: '忠誠點數退款回覆', category: '聊天室回覆', terms: '退款 回覆 文案 cost', pane: 'replies', replyKey: 'rewardRefunded', focusId: 'twitch-reply-template' },
    { label: '自動回覆總開關', category: '聊天室回覆', terms: '回覆 開關 reply', pane: 'replies', focusId: 'twitch-reply-enabled' },
    { label: '自訂指令', category: '自訂指令', terms: '自訂 指令 回覆 變數 template', pane: 'custom', focusId: 'twitch-custom-name' },
    { label: '點歌規則模擬', category: '測試與預覽', terms: '模擬 規則 預覽 點歌', pane: 'test', focusId: 'twitch-sim-run' },
    { label: '公開 Twitch 測試', category: '測試與預覽', terms: '測試 預覽 公開 twitch', pane: 'test', focusId: 'twitch-reply-test-event' },
    { label: '點歌歷史', category: '歷史', terms: '歷史 結果 退款 完成 拒絕', pane: 'history', focusId: 'twitch-history-refresh' },
  ];

  function focusSearchEntry(entry) {
    if (entry.commandKey) { activeCommandKey = entry.commandKey; renderCommandList(); loadCommandEditor(); }
    if (entry.replyKey) { activeReplyKey = entry.replyKey; renderReplyEvents(); loadReplyEditor(); }
    switchManagementPane(entry.pane);
    hideSearchResults();
    el('twitch-settings-search-status').textContent = `已前往「${entry.category}」的「${entry.label}」。`;
    window.setTimeout(() => el(entry.focusId)?.focus(), 0);
  }

  function updateSettingsSearch() {
    const input = el('twitch-settings-search');
    const results = el('twitch-settings-search-results');
    const status = el('twitch-settings-search-status');
    if (!input || !results || !status) return;
    const query = input.value.trim().toLocaleLowerCase();
    if (!query) {
      hideSearchResults();
      status.textContent = '輸入設定名稱後可直接跳到對應分類。';
      return;
    }
    const matched = searchEntries.filter((entry) => `${entry.label} ${entry.category} ${entry.terms}`.toLocaleLowerCase().includes(query));
    results.innerHTML = '';
    matched.forEach((entry) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'twitch-search-result';
      button.setAttribute('role', 'option');
      button.innerHTML = `${escapeHtml(entry.label)}<span>${escapeHtml(entry.category)}</span>`;
      button.addEventListener('click', () => focusSearchEntry(entry));
      results.appendChild(button);
    });
    results.hidden = matched.length === 0;
    status.textContent = matched.length ? `找到 ${matched.length} 個設定。` : '找不到相符設定；可試試「冷卻」、「退款」、「黑名單」或「目前歌曲」。';
  }

  function initManagementModal() {
    const modal = el('twitch-management-modal');
    if (!modal) return;
    if (modal.parentElement !== document.body) document.body.appendChild(modal);
    el('twitch-management-open')?.addEventListener('click', () => openManagement('commands'));
    el('twitch-history-open')?.addEventListener('click', () => openManagement('history'));
    el('twitch-management-close')?.addEventListener('click', () => closeManagement());
    document.querySelectorAll('.twitch-management-nav-item').forEach((button) => button.addEventListener('click', () => switchManagementPane(button.dataset.twitchPane)));
    el('twitch-settings-search')?.addEventListener('input', updateSettingsSearch);
    modal.addEventListener('click', (event) => { if (event.target === modal) closeManagement(); });
    modal.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeManagement();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter((node) => !node.hidden && !node.closest('[hidden]'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }

  function commandDefinition(key = activeCommandKey) {
    return TwitchRequestSettings.COMMAND_DEFINITIONS.find((definition) => definition.key === key);
  }

  function renderCommandList() {
    const container = el('twitch-command-list');
    if (!container) return;
    container.innerHTML = '';
    let currentGroup = '';
    TwitchRequestSettings.COMMAND_DEFINITIONS.forEach((definition) => {
      if (definition.group !== currentGroup) {
        const label = document.createElement('div');
        label.className = 'twitch-command-group-label';
        label.textContent = definition.group === 'admin' ? '管理員與實況主' : '觀眾自助';
        container.appendChild(label);
        currentGroup = definition.group;
      }
      const settings = requestDraft.commands[definition.key];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `twitch-command-item${definition.key === activeCommandKey ? ' is-active' : ''}`;
      button.dataset.commandKey = definition.key;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', definition.key === activeCommandKey ? 'true' : 'false');
      button.innerHTML = `<span>${escapeHtml(definition.label)}</span><span class="twitch-command-item-state">${settings.enabled ? escapeHtml(settings.command) : '已停用'}</span>`;
      button.addEventListener('click', () => { activeCommandKey = definition.key; renderCommandList(); loadCommandEditor(); });
      container.appendChild(button);
    });
  }

  function loadCommandEditor() {
    const definition = commandDefinition();
    const settings = requestDraft.commands[activeCommandKey];
    if (!definition || !settings) return;
    el('twitch-command-editor-label').textContent = definition.label;
    el('twitch-command-editor-description').textContent = definition.description;
    el('twitch-command-enabled').checked = settings.enabled;
    el('twitch-command-name').value = settings.command;
    el('twitch-command-aliases').value = settings.aliases.join(', ');
    el('twitch-command-permission').value = settings.permissionLevel;
    el('twitch-command-permission').disabled = !!definition.adminOnly;
    el('twitch-command-user-cooldown').value = String(settings.userCooldownSeconds);
    el('twitch-command-global-cooldown').value = String(settings.globalCooldownSeconds);
    validateCommandForm();
  }

  function syncActiveCommandFromFields() {
    const settings = requestDraft.commands[activeCommandKey];
    if (!settings) return;
    settings.enabled = !!el('twitch-command-enabled')?.checked;
    settings.command = el('twitch-command-name')?.value || '';
    settings.aliases = TwitchRequestSettings.parseAliases(el('twitch-command-aliases')?.value || '');
    settings.permissionLevel = commandDefinition()?.adminOnly ? 'moderator' : (el('twitch-command-permission')?.value || 'everyone');
    settings.userCooldownSeconds = Number(el('twitch-command-user-cooldown')?.value);
    settings.globalCooldownSeconds = Number(el('twitch-command-global-cooldown')?.value);
    setDirty('commands', true);
    renderCommandList();
    validateCommandForm();
  }

  function validateCommandForm() {
    const candidate = { ...requestSaved, commands: requestDraft.commands };
    const validation = TwitchRequestSettings.validateSettings(candidate);
    const commandPrefix = `commands.${activeCommandKey}`;
    const error = validation.errors.find((item) => item.field.startsWith(commandPrefix)) || validation.errors.find((item) => item.field.startsWith('commands.'));
    const box = el('twitch-command-form-error');
    const save = el('twitch-command-save');
    if (box) { box.textContent = error?.message || ''; box.hidden = !error; }
    if (save) save.disabled = !validation.ok;
    const definition = commandDefinition();
    const settings = requestDraft.commands[activeCommandKey];
    if (el('twitch-command-preview')) el('twitch-command-preview').textContent = `${settings.enabled ? '啟用' : '停用'}｜${settings.command || '—'}${definition.usage ? ` ${definition.usage}` : (activeCommandKey === 'request' ? ' <YouTube URL>' : '')}｜${definition.description}`;
    return validation;
  }

  function applyRuleFields() {
    el('twitch-request-enabled').checked = requestDraft.enabled;
    el('twitch-request-max-pending').value = String(requestDraft.maxPending);
    el('twitch-request-per-user').value = String(requestDraft.perUserPending);
    el('twitch-request-max-duration').value = String(requestDraft.maxDurationMinutes);
    el('twitch-request-duplicate-scope').value = requestDraft.duplicateScope;
    el('twitch-request-recent-hours').value = String(requestDraft.recentDuplicateHours);
    el('twitch-request-live-only').checked = requestDraft.liveOnly;
    el('twitch-request-per-user-session').value = String(requestDraft.perUserSessionLimit);
    el('twitch-request-session-limit').value = String(requestDraft.sessionRequestLimit);
    el('twitch-request-moderator-exempt').checked = requestDraft.fairnessModeratorExempt;
    el('twitch-request-consecutive-warning').checked = requestDraft.warnConsecutiveRequests;
    validateRuleForm();
  }

  function syncRulesFromFields() {
    requestDraft.enabled = !!el('twitch-request-enabled')?.checked;
    requestDraft.maxPending = Number(el('twitch-request-max-pending')?.value);
    requestDraft.perUserPending = Number(el('twitch-request-per-user')?.value);
    requestDraft.maxDurationMinutes = Number(el('twitch-request-max-duration')?.value);
    requestDraft.duplicateScope = el('twitch-request-duplicate-scope')?.value || 'pending';
    requestDraft.recentDuplicateHours = Number(el('twitch-request-recent-hours')?.value);
    requestDraft.liveOnly = !!el('twitch-request-live-only')?.checked;
    requestDraft.perUserSessionLimit = Number(el('twitch-request-per-user-session')?.value);
    requestDraft.sessionRequestLimit = Number(el('twitch-request-session-limit')?.value);
    requestDraft.fairnessModeratorExempt = !!el('twitch-request-moderator-exempt')?.checked;
    requestDraft.warnConsecutiveRequests = !!el('twitch-request-consecutive-warning')?.checked;
    setDirty('rules', true);
    validateRuleForm();
  }

  function validateRuleForm() {
    const candidate = { ...requestDraft, commands: requestSaved.commands };
    const validation = TwitchRequestSettings.validateSettings(candidate);
    const error = validation.errors.find((item) => !item.field.startsWith('commands.'));
    const box = el('twitch-request-form-error');
    const save = el('twitch-request-save');
    if (box) { box.textContent = error?.message || ''; box.hidden = !error; }
    if (save) save.disabled = !!error;
    const permission = TwitchRequestSettings.PERMISSION_LEVELS.find((item) => item.key === requestSaved.commands.request.permissionLevel)?.label || '所有觀眾';
    const duplicateLabel = TwitchRequestSettings.DUPLICATE_SCOPES.find((item) => item.key === requestDraft.duplicateScope)?.label || '待確認區';
    const recentField = el('twitch-request-recent-hours-field');
    if (recentField) recentField.hidden = requestDraft.duplicateScope !== 'recent';
    const requestCooldown = requestSaved.commands.request.globalCooldownSeconds;
    if (el('twitch-request-cooldown-summary')) el('twitch-request-cooldown-summary').textContent = requestCooldown > 0 ? `所有觀眾共用 ${requestCooldown} 秒；管理員豁免開啟時不受此限制。` : '目前不限制；可到「觀眾指令 → 點歌」設定秒數。';
    const preview = [
      requestDraft.enabled ? '接受點歌' : '暫停點歌', permission,
      `最多 ${requestDraft.maxPending || '—'} 首待確認`,
      requestDraft.perUserPending > 0 ? `每人最多 ${requestDraft.perUserPending} 首` : '每人不限首數',
      requestDraft.maxDurationMinutes > 0 ? `最長 ${requestDraft.maxDurationMinutes} 分鐘` : '不限制歌曲長度',
      requestDraft.duplicateScope === 'recent' ? `檢查最近 ${requestDraft.recentDuplicateHours || '—'} 小時` : `重複範圍：${duplicateLabel}`,
      requestDraft.liveOnly ? '只在直播中接受' : '離線也接受',
      requestDraft.perUserSessionLimit > 0 ? `每人每場 ${requestDraft.perUserSessionLimit} 首` : '每人每場不限',
      requestDraft.sessionRequestLimit > 0 ? `全場 ${requestDraft.sessionRequestLimit} 首` : '全場不限',
      requestDraft.warnConsecutiveRequests ? '連續點歌會提醒' : '不提醒連續點歌',
    ];
    if (el('twitch-request-rule-preview')) el('twitch-request-rule-preview').textContent = preview.join('；');
    return validation;
  }

  function blacklistTypeDefinition(type) {
    return TwitchRequestSettings.BLACKLIST_TYPES.find((item) => item.key === type) || TwitchRequestSettings.BLACKLIST_TYPES[0];
  }

  function blacklistExpiryToInput(value) {
    if (!Number.isFinite(value) || value <= 0) return '';
    const date = new Date(value - new Date(value).getTimezoneOffset() * 60000);
    return date.toISOString().slice(0, 16);
  }

  function blacklistExpiryFromInput(value) {
    if (!value) return null;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : NaN;
  }

  function updateBlacklistHint() {
    const type = el('twitch-blacklist-type')?.value || 'user';
    const hints = {
      user: '輸入 Twitch 使用者 ID、登入名稱或顯示名稱。',
      video: '貼 YouTube 單曲網址或 11 碼影片 ID。',
      channel: '輸入 YouTube 頻道 ID（UC…）或完整頻道名稱。',
      title: '只要影片標題包含這段文字就會擋下，不分大小寫。',
    };
    if (el('twitch-blacklist-value-hint')) el('twitch-blacklist-value-hint').textContent = hints[type] || '';
  }

  function blacklistRuleFromFields() {
    return {
      id: activeBlacklistId || `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      enabled: !!el('twitch-blacklist-enabled')?.checked,
      type: el('twitch-blacklist-type')?.value || 'user',
      value: el('twitch-blacklist-value')?.value || '',
      reason: el('twitch-blacklist-reason')?.value || '',
      expiresAt: blacklistExpiryFromInput(el('twitch-blacklist-expires')?.value || ''),
      moderatorExempt: !!el('twitch-blacklist-moderator-exempt')?.checked,
    };
  }

  function validateBlacklistEditor() {
    const rule = blacklistRuleFromFields();
    const blacklist = requestDraft.blacklist.filter((item) => item.id !== activeBlacklistId).concat(rule);
    const validation = TwitchRequestSettings.validateSettings({ ...requestSaved, blacklist });
    const error = validation.errors.find((item) => item.field.startsWith('blacklist.'));
    const emptyNewRule = !activeBlacklistId && !String(rule.value || '').trim();
    const box = el('twitch-blacklist-form-error');
    if (box) { box.textContent = emptyNewRule ? '' : (error?.message || ''); box.hidden = emptyNewRule || !error; }
    if (el('twitch-blacklist-apply')) el('twitch-blacklist-apply').disabled = emptyNewRule || !!error;
    return { validation, rule };
  }

  function renderBlacklistList() {
    const list = el('twitch-blacklist-list');
    if (!list) return;
    const rules = Array.isArray(requestDraft.blacklist) ? requestDraft.blacklist : [];
    el('twitch-blacklist-count').textContent = `${rules.length} 筆`;
    list.innerHTML = '';
    if (!rules.length) {
      list.innerHTML = '<div class="twitch-blacklist-empty">尚未建立規則。先選類型並填入比對內容。</div>';
      return;
    }
    rules.forEach((rule) => {
      const type = blacklistTypeDefinition(rule.type);
      const expired = rule.expiresAt != null && rule.expiresAt <= Date.now();
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `twitch-blacklist-item${rule.id === activeBlacklistId ? ' is-active' : ''}`;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', rule.id === activeBlacklistId ? 'true' : 'false');
      button.innerHTML = `<span class="twitch-blacklist-item-value">${escapeHtml(rule.value)}</span><span class="twitch-blacklist-item-type">${escapeHtml(type.label)}</span><span class="twitch-blacklist-item-state">${expired ? '已到期' : (rule.enabled ? '啟用中' : '已暫停')} · ${rule.moderatorExempt ? '管理員豁免' : '管理員也套用'}${rule.reason ? ` · ${escapeHtml(rule.reason)}` : ''}</span>`;
      button.addEventListener('click', () => { activeBlacklistId = rule.id; renderBlacklistList(); loadBlacklistEditor(); });
      list.appendChild(button);
    });
  }

  function loadBlacklistEditor() {
    const rule = requestDraft.blacklist.find((item) => item.id === activeBlacklistId) || null;
    el('twitch-blacklist-type').value = rule?.type || 'user';
    el('twitch-blacklist-value').value = rule?.value || '';
    el('twitch-blacklist-reason').value = rule?.reason || '';
    el('twitch-blacklist-expires').value = blacklistExpiryToInput(rule?.expiresAt);
    el('twitch-blacklist-enabled').checked = rule?.enabled !== false;
    el('twitch-blacklist-moderator-exempt').checked = rule?.moderatorExempt !== false;
    el('twitch-blacklist-delete').hidden = !rule;
    el('twitch-blacklist-apply').textContent = rule ? '更新規則' : '加入規則';
    updateBlacklistHint();
    validateBlacklistEditor();
  }

  function applyBlacklistEditor() {
    const { validation, rule } = validateBlacklistEditor();
    if (!validation.ok) return;
    const index = requestDraft.blacklist.findIndex((item) => item.id === activeBlacklistId);
    const normalized = validation.settings.blacklist.find((item) => item.id === rule.id);
    if (index >= 0) requestDraft.blacklist[index] = normalized;
    else requestDraft.blacklist.push(normalized);
    activeBlacklistId = normalized.id;
    setDirty('blacklist', true);
    renderBlacklistList();
    loadBlacklistEditor();
  }

  function customCommandById(id = activeCustomCommandId) {
    return requestDraft.customCommands.find((item) => item.id === id) || null;
  }

  function nextCustomCommandName() {
    const used = new Set();
    requestDraft.customCommands.forEach((item) => {
      used.add(String(item.command || '').toLocaleLowerCase());
      (item.aliases || []).forEach((alias) => used.add(String(alias).toLocaleLowerCase()));
    });
    for (let index = 1; index <= TwitchRequestSettings.LIMITS.customCommands; index += 1) {
      const candidate = '!自訂' + index;
      if (!used.has(candidate.toLocaleLowerCase())) return candidate;
    }
    return '!自訂';
  }

  function newCustomCommand() {
    return {
      id: 'custom_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      enabled: true,
      command: nextCustomCommandName(),
      aliases: [],
      permissionLevel: 'everyone',
      userCooldownSeconds: 10,
      globalCooldownSeconds: 2,
      template: '嗨 {user}！目前播放 {currentTitle}。',
    };
  }

  function setCustomCommandEditorDisabled(disabled) {
    [
      'twitch-custom-enabled',
      'twitch-custom-name',
      'twitch-custom-aliases',
      'twitch-custom-permission',
      'twitch-custom-user-cooldown',
      'twitch-custom-global-cooldown',
      'twitch-custom-template',
    ].forEach((id) => {
      const control = el(id);
      if (control) control.disabled = disabled;
    });
    const variables = el('twitch-custom-variable-buttons');
    variables?.querySelectorAll('button').forEach((button) => { button.disabled = disabled; });
    if (el('twitch-custom-duplicate')) el('twitch-custom-duplicate').hidden = disabled;
    if (el('twitch-custom-delete')) el('twitch-custom-delete').hidden = disabled;
  }

  function renderCustomCommandList() {
    const list = el('twitch-custom-list');
    if (!list) return;
    const commands = Array.isArray(requestDraft.customCommands) ? requestDraft.customCommands : [];
    if (el('twitch-custom-count')) el('twitch-custom-count').textContent = commands.length + ' 個';
    list.innerHTML = '';
    if (!commands.length) {
      const empty = document.createElement('div');
      empty.className = 'twitch-blacklist-empty';
      empty.textContent = '尚未建立自訂指令。新增後只會讀取狀態並回覆聊天室。';
      list.appendChild(empty);
      return;
    }
    commands.forEach((command) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'twitch-command-item' + (command.id === activeCustomCommandId ? ' is-active' : '');
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', command.id === activeCustomCommandId ? 'true' : 'false');
      const title = document.createElement('span');
      title.textContent = command.command || '未命名指令';
      const state = document.createElement('span');
      state.className = 'twitch-command-item-state';
      state.textContent = command.enabled ? (command.permissionLevel || 'everyone') : '已停用';
      button.append(title, state);
      button.addEventListener('click', () => {
        activeCustomCommandId = command.id;
        renderCustomCommandList();
        loadCustomCommandEditor();
      });
      list.appendChild(button);
    });
  }

  function customReplySampleValues(command) {
    return {
      ...TwitchReplySettings.sampleValues(),
      command: command?.command || '!自訂',
    };
  }

  function loadCustomCommandEditor() {
    const command = customCommandById();
    const hasCommand = !!command;
    if (el('twitch-custom-editor-label')) el('twitch-custom-editor-label').textContent = command?.command || '尚未選擇自訂指令';
    if (el('twitch-custom-enabled')) el('twitch-custom-enabled').checked = command?.enabled !== false;
    if (el('twitch-custom-name')) el('twitch-custom-name').value = command?.command || '';
    if (el('twitch-custom-aliases')) el('twitch-custom-aliases').value = (command?.aliases || []).join(', ');
    if (el('twitch-custom-permission')) el('twitch-custom-permission').value = command?.permissionLevel || 'everyone';
    if (el('twitch-custom-user-cooldown')) el('twitch-custom-user-cooldown').value = hasCommand ? String(command.userCooldownSeconds) : '';
    if (el('twitch-custom-global-cooldown')) el('twitch-custom-global-cooldown').value = hasCommand ? String(command.globalCooldownSeconds) : '';
    if (el('twitch-custom-template')) el('twitch-custom-template').value = command?.template || '';
    setCustomCommandEditorDisabled(!hasCommand);
    validateCustomCommandEditor();
  }

  function syncCustomCommandFromFields() {
    const command = customCommandById();
    if (!command) return;
    command.enabled = !!el('twitch-custom-enabled')?.checked;
    command.command = el('twitch-custom-name')?.value || '';
    command.aliases = TwitchRequestSettings.parseAliases(el('twitch-custom-aliases')?.value || '');
    command.permissionLevel = el('twitch-custom-permission')?.value || 'everyone';
    command.userCooldownSeconds = Number(el('twitch-custom-user-cooldown')?.value);
    command.globalCooldownSeconds = Number(el('twitch-custom-global-cooldown')?.value);
    command.template = el('twitch-custom-template')?.value || '';
    setDirty('custom', true);
    renderCustomCommandList();
    validateCustomCommandEditor();
  }

  function validateCustomCommandEditor() {
    const candidate = { ...requestSaved, customCommands: requestDraft.customCommands };
    const whole = TwitchRequestSettings.validateSettings(candidate);
    const command = customCommandById();
    const index = requestDraft.customCommands.findIndex((item) => item.id === activeCustomCommandId);
    const prefix = index >= 0 ? 'customCommands.' + index : 'customCommands';
    const error = whole.errors.find((item) => item.field.startsWith(prefix)) || whole.errors.find((item) => item.field.startsWith('customCommands'));
    const formError = el('twitch-custom-form-error');
    if (formError) {
      formError.textContent = error?.message || '';
      formError.hidden = !error;
    }
    const templateValidation = command ? TwitchRequestSettings.customTemplateValidation(command.template) : null;
    const preview = el('twitch-custom-preview');
    if (preview) {
      preview.textContent = !command
        ? '新增一個自訂指令後，這裡會顯示本機回覆預覽。'
        : (templateValidation?.valid
          ? '預覽：' + TwitchReplySettings.renderTemplate(command.template, customReplySampleValues(command))
          : '預覽暫停：請先修正文案中的變數。');
    }
    if (el('twitch-custom-save')) el('twitch-custom-save').disabled = !whole.ok;
    if (el('twitch-custom-public-test')) el('twitch-custom-public-test').disabled = !command || !whole.ok;
    return whole;
  }

  function insertCustomVariable(variable) {
    const input = el('twitch-custom-template');
    if (!input || input.disabled) return;
    const token = '{' + variable + '}';
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    input.setRangeText(token, start, end, 'end');
    input.focus();
    syncCustomCommandFromFields();
  }

  function createCustomCommand() {
    if (requestDraft.customCommands.length >= TwitchRequestSettings.LIMITS.customCommands) {
      AppShared.showToast('自訂指令最多 ' + TwitchRequestSettings.LIMITS.customCommands + ' 個', 'error');
      return;
    }
    const command = newCustomCommand();
    requestDraft.customCommands.push(command);
    activeCustomCommandId = command.id;
    setDirty('custom', true);
    renderCustomCommandList();
    loadCustomCommandEditor();
    window.setTimeout(() => el('twitch-custom-name')?.focus(), 0);
  }

  function duplicateCustomCommand() {
    const source = customCommandById();
    if (!source) return;
    if (requestDraft.customCommands.length >= TwitchRequestSettings.LIMITS.customCommands) {
      AppShared.showToast('自訂指令最多 ' + TwitchRequestSettings.LIMITS.customCommands + ' 個', 'error');
      return;
    }
    const duplicate = newCustomCommand();
    duplicate.enabled = source.enabled !== false;
    duplicate.permissionLevel = source.permissionLevel || 'everyone';
    duplicate.userCooldownSeconds = Number.isFinite(Number(source.userCooldownSeconds)) ? Number(source.userCooldownSeconds) : 0;
    duplicate.globalCooldownSeconds = Number.isFinite(Number(source.globalCooldownSeconds)) ? Number(source.globalCooldownSeconds) : 0;
    duplicate.template = source.template || '';
    requestDraft.customCommands.push(duplicate);
    activeCustomCommandId = duplicate.id;
    setDirty('custom', true);
    renderCustomCommandList();
    loadCustomCommandEditor();
    AppShared.showToast('已複製為新的自訂指令；別名會留空避免衝突', 'success');
  }

  async function deleteCustomCommand() {
    const command = customCommandById();
    if (!command) return;
    const confirmed = await window.PanelConfirm?.request({
      title: '刪除這個自訂指令？',
      summary: command.command || '未命名指令',
      impact: '儲存前仍可關閉管理視窗放棄這個變更；已儲存的 Twitch 其他設定不受影響。',
      tone: 'danger',
      confirmLabel: '刪除指令',
    });
    if (!confirmed) return;
    requestDraft.customCommands = requestDraft.customCommands.filter((item) => item.id !== command.id);
    activeCustomCommandId = requestDraft.customCommands[0]?.id || '';
    setDirty('custom', true);
    renderCustomCommandList();
    loadCustomCommandEditor();
  }

  async function sendCustomCommandTest() {
    const validation = validateCustomCommandEditor();
    const command = customCommandById();
    if (!validation.ok || !command) return;
    const confirmed = await window.PanelConfirm?.request({
      title: '送出自訂指令公開測試？',
      summary: '將把「' + command.command + '」的範例回覆公開送到目前連接的 Twitch 聊天室。',
      impact: '不會建立點歌、不會下載歌曲，也不會儲存尚未儲存的設定。',
      confirmLabel: '送出測試訊息',
    });
    if (!confirmed) return;
    const button = el('twitch-custom-public-test');
    const status = el('twitch-custom-save-status');
    if (button) button.disabled = true;
    if (status) status.textContent = '正在送出公開測試…';
    SocketClient.sendWithCallback('twitch:custom-command:test', {
      settings: validation.settings,
      commandId: command.id,
    }, (result) => {
      validateCustomCommandEditor();
      if (!result?.ok) {
        if (status) status.textContent = '測試未送出：' + (result?.error || '伺服器沒有回應');
        return;
      }
      if (status) status.textContent = '已送出：' + result.text;
      AppShared.showToast('Twitch 自訂指令測試訊息已送出', 'success');
    });
  }

  function historyResultLabel(result) {
    const labels = {
      pending: '等待確認',
      retrying: '等待重試',
      imported: '已匯入',
      rejected: '已拒絕',
      failed: '失敗',
      canceled: '已取消',
      expired: '等待逾時',
    };
    return labels[result] || '未知結果';
  }

  function historyRewardLabel(reward) {
    if (!reward || reward.status === 'not-applicable') return '';
    const labels = {
      pending: '忠誠點數待處理',
      fulfilled: '忠誠點數已完成',
      refunded: '忠誠點數已退款',
      'refund-failed': '忠誠點數退款待重試',
      'fulfillment-failed': '忠誠點數完成待重試',
    };
    const label = labels[reward.status] || '';
    return label && reward.cost ? label + '（' + Number(reward.cost).toLocaleString('zh-TW') + ' 點）' : label;
  }

  function formatHistoryTime(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return '時間不明';
    return new Date(timestamp).toLocaleString('zh-TW', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  function appendHistoryRows(container, entries) {
    container.innerHTML = '';
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'twitch-activity-empty';
      empty.textContent = '目前還沒有點歌歷史；之後會在這裡看到成功、拒絕、退款與逾時結果。';
      container.appendChild(empty);
      return;
    }
    entries.forEach((entry) => {
      const row = document.createElement('div');
      row.className = container.id === 'twitch-history-list' ? 'twitch-history-row' : 'twitch-activity-row';
      const main = document.createElement('div');
      main.className = row.className + '-main';
      const requester = String(entry?.requester?.name || '觀眾');
      const title = String(entry?.video?.title || entry?.video?.id || '未取得歌曲資訊');
      main.textContent = requester + ' · ' + title;
      const status = document.createElement('div');
      status.className = row.className + '-status';
      status.dataset.result = entry?.result || '';
      status.textContent = historyResultLabel(entry?.result);
      const meta = document.createElement('div');
      meta.className = row.className + '-meta';
      const parts = [
        entry?.source === 'channel-points' ? '忠誠點數' : '聊天室',
        entry?.requestCode ? '#' + entry.requestCode : '',
        formatHistoryTime(entry?.updatedAt || entry?.createdAt),
        historyRewardLabel(entry?.reward),
        entry?.reason ? '原因：' + String(entry.reason) : '',
      ].filter(Boolean);
      meta.textContent = parts.join('｜');
      row.append(main, status, meta);
      container.appendChild(row);
    });
  }

  function renderActivityHistory() {
    const list = el('twitch-activity-list');
    if (list) appendHistoryRows(list, historyEntries.slice(0, 5));
  }

  function renderHistoryList() {
    const list = el('twitch-history-list');
    if (list) appendHistoryRows(list, historyEntries);
  }

  function applyHistory(entries) {
    historyEntries = Array.isArray(entries) ? entries.slice(0, 200) : [];
    renderActivityHistory();
    renderHistoryList();
  }

  function refreshHistory() {
    SocketClient.sendWithCallback('twitch:history:get', { limit: 200 }, (result) => {
      if (result?.ok) applyHistory(result.entries);
    });
  }

  function simulatorPayload() {
    const number = (id) => Math.max(0, Number(el(id)?.value) || 0);
    return {
      viewerRole: el('twitch-sim-role')?.value || 'viewer',
      user: el('twitch-sim-user')?.value || '',
      url: el('twitch-sim-url')?.value || '',
      durationSeconds: number('twitch-sim-duration'),
      title: el('twitch-sim-title')?.value || '',
      artist: el('twitch-sim-artist')?.value || '',
      pendingCount: number('twitch-sim-pending-count'),
      userPendingCount: number('twitch-sim-user-pending-count'),
      sessionUserCount: number('twitch-sim-session-user-count'),
      sessionCount: number('twitch-sim-session-count'),
      streamOnline: !!el('twitch-sim-online')?.checked,
      pendingDuplicate: !!el('twitch-sim-pending-duplicate')?.checked,
      playlistDuplicate: !!el('twitch-sim-playlist-duplicate')?.checked,
      sessionDuplicate: !!el('twitch-sim-session-duplicate')?.checked,
      recentDuplicate: !!el('twitch-sim-recent-duplicate')?.checked,
    };
  }

  function renderSimulatorResult(result, error = '') {
    const box = el('twitch-sim-result');
    if (!box) return;
    box.innerHTML = '';
    if (error) {
      const message = document.createElement('p');
      message.className = 'twitch-sim-summary';
      message.dataset.accepted = 'false';
      message.textContent = '無法模擬：' + error;
      box.appendChild(message);
      return;
    }
    if (!result) return;
    const summary = document.createElement('p');
    summary.className = 'twitch-sim-summary';
    summary.dataset.accepted = result.accepted ? 'true' : 'false';
    summary.textContent = result.accepted ? '模擬結果：會接受這筆點歌' : '模擬結果：會拒絕這筆點歌';
    const checks = document.createElement('ul');
    checks.className = 'twitch-sim-checks';
    (Array.isArray(result.checks) ? result.checks : []).forEach((check) => {
      const item = document.createElement('li');
      item.className = 'twitch-sim-check';
      item.dataset.passed = check.passed ? 'true' : 'false';
      const label = document.createElement('span');
      label.textContent = check.label || '規則';
      const detail = document.createElement('span');
      detail.textContent = check.detail || '';
      item.append(label, detail);
      checks.appendChild(item);
    });
    const reply = document.createElement('p');
    reply.className = 'twitch-sim-reply';
    reply.textContent = result.willReply ? '預計回覆：' + result.finalReply : '預計回覆：不會送出（自動回覆目前關閉）';
    box.append(summary, checks, reply);
  }

  function runSimulator() {
    const button = el('twitch-sim-run');
    const originalText = button?.textContent || '執行模擬';
    if (button) {
      button.disabled = true;
      button.textContent = '正在模擬…';
    }
    SocketClient.sendWithCallback('twitch:simulate', simulatorPayload(), (response) => {
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
      if (!response?.ok) {
        renderSimulatorResult(null, response?.error || '伺服器沒有回應');
        return;
      }
      renderSimulatorResult(response.result);
    });
  }

  function mergeRequestSettingsFromServer(settings) {
    const normalized = TwitchRequestSettings.normalizeSettings(settings);
    requestSaved = normalized;
    if (!dirty.commands) requestDraft.commands = clone(normalized.commands);
    if (!dirty.rules) {
      requestDraft.enabled = normalized.enabled;
      requestDraft.maxPending = normalized.maxPending;
      requestDraft.perUserPending = normalized.perUserPending;
      requestDraft.duplicateScope = normalized.duplicateScope;
      requestDraft.recentDuplicateHours = normalized.recentDuplicateHours;
      requestDraft.maxDurationMinutes = normalized.maxDurationMinutes;
      requestDraft.liveOnly = normalized.liveOnly;
      requestDraft.perUserSessionLimit = normalized.perUserSessionLimit;
      requestDraft.sessionRequestLimit = normalized.sessionRequestLimit;
      requestDraft.fairnessModeratorExempt = normalized.fairnessModeratorExempt;
      requestDraft.warnConsecutiveRequests = normalized.warnConsecutiveRequests;
    }
    if (!dirty.blacklist) requestDraft.blacklist = clone(normalized.blacklist);
    if (!dirty.custom) requestDraft.customCommands = clone(normalized.customCommands);
    renderCommandList();
    loadCommandEditor();
    applyRuleFields();
    renderBlacklistList();
    loadBlacklistEditor();
    if (!customCommandById()) activeCustomCommandId = requestDraft.customCommands[0]?.id || '';
    renderCustomCommandList();
    loadCustomCommandEditor();
    updateMainStatus();
  }

  function saveRequestCategory(category, successMessage) {
    let candidate = { ...requestSaved };
    if (category === 'commands') candidate.commands = requestDraft.commands;
    else if (category === 'blacklist') candidate.blacklist = requestDraft.blacklist;
    else if (category === 'custom') candidate.customCommands = requestDraft.customCommands;
    else candidate = { ...requestDraft, commands: requestSaved.commands, blacklist: requestSaved.blacklist, customCommands: requestSaved.customCommands };
    const validation = TwitchRequestSettings.validateSettings(candidate);
    if (!validation.ok) {
      if (category === 'commands') validateCommandForm();
      else if (category === 'blacklist') validateBlacklistEditor();
      else if (category === 'custom') validateCustomCommandEditor();
      else validateRuleForm();
      return;
    }
    const idPrefix = category === 'commands' ? 'twitch-command' : (category === 'blacklist' ? 'twitch-blacklist' : (category === 'custom' ? 'twitch-custom' : 'twitch-request'));
    const button = el(`${idPrefix}-save`);
    if (button) button.disabled = true;
    SocketClient.sendWithCallback('twitch:request-settings:update', validation.settings, (result) => {
      if (!result?.ok) {
        if (button) button.disabled = false;
        const status = el(`${idPrefix}-save-status`);
        if (status) status.textContent = `儲存失敗：${result?.error || '伺服器沒有回應'}`;
        return;
      }
      const normalized = TwitchRequestSettings.normalizeSettings(result.settings || validation.settings);
      requestSaved = normalized;
      if (category === 'commands') requestDraft.commands = clone(normalized.commands);
      else if (category === 'blacklist') requestDraft.blacklist = clone(normalized.blacklist);
      else if (category === 'custom') requestDraft.customCommands = clone(normalized.customCommands);
      else {
        requestDraft.enabled = normalized.enabled;
        requestDraft.maxPending = normalized.maxPending;
        requestDraft.perUserPending = normalized.perUserPending;
        requestDraft.duplicateScope = normalized.duplicateScope;
        requestDraft.recentDuplicateHours = normalized.recentDuplicateHours;
        requestDraft.maxDurationMinutes = normalized.maxDurationMinutes;
        requestDraft.liveOnly = normalized.liveOnly;
        requestDraft.perUserSessionLimit = normalized.perUserSessionLimit;
        requestDraft.sessionRequestLimit = normalized.sessionRequestLimit;
        requestDraft.fairnessModeratorExempt = normalized.fairnessModeratorExempt;
        requestDraft.warnConsecutiveRequests = normalized.warnConsecutiveRequests;
      }
      setDirty(category, false);
      const status = el(`${idPrefix}-save-status`);
      if (status) status.textContent = successMessage;
      if (!customCommandById()) activeCustomCommandId = requestDraft.customCommands[0]?.id || '';
      renderCommandList(); loadCommandEditor(); applyRuleFields(); renderBlacklistList(); loadBlacklistEditor(); renderCustomCommandList(); loadCustomCommandEditor(); updateMainStatus();
      AppShared.showToast(successMessage, 'success');
    });
  }

  function collectRewardFields() {
    rewardDraft.enabled = !!el('twitch-reward-enabled')?.checked;
    rewardDraft.paused = !!el('twitch-reward-paused')?.checked;
    rewardDraft.title = el('twitch-reward-title')?.value || '';
    rewardDraft.prompt = el('twitch-reward-prompt')?.value || '';
    rewardDraft.cost = Number(el('twitch-reward-cost')?.value);
    rewardDraft.maxPerStream = Number(el('twitch-reward-max-per-stream')?.value);
    rewardDraft.maxPerUserPerStream = Number(el('twitch-reward-max-per-user')?.value);
    rewardDraft.globalCooldownSeconds = Number(el('twitch-reward-global-cooldown')?.value);
    setDirty('reward', true);
    validateRewardForm();
  }

  function applyRewardFields() {
    el('twitch-reward-enabled').checked = rewardDraft.enabled;
    el('twitch-reward-paused').checked = rewardDraft.paused;
    el('twitch-reward-paused').disabled = !rewardDraft.rewardId;
    el('twitch-reward-title').value = rewardDraft.title;
    el('twitch-reward-prompt').value = rewardDraft.prompt;
    el('twitch-reward-cost').value = String(rewardDraft.cost);
    el('twitch-reward-max-per-stream').value = String(rewardDraft.maxPerStream);
    el('twitch-reward-max-per-user').value = String(rewardDraft.maxPerUserPerStream);
    el('twitch-reward-global-cooldown').value = String(rewardDraft.globalCooldownSeconds);
    validateRewardForm();
  }

  function validateRewardForm() {
    const validation = TwitchRewardSettings.validateSettings(rewardDraft);
    const message = validation.errors[0]?.message || '';
    const error = el('twitch-reward-form-error');
    if (error) { error.textContent = message; error.hidden = !message; }
    if (el('twitch-reward-save')) el('twitch-reward-save').disabled = !!message;
    if (el('twitch-reward-preview')) {
      const state = rewardDraft.enabled ? (rewardDraft.paused ? '暫停兌換' : '啟用') : '停用';
      const limits = [
        rewardDraft.maxPerStream > 0 ? `每場 ${rewardDraft.maxPerStream} 次` : '每場不限',
        rewardDraft.maxPerUserPerStream > 0 ? `每人每場 ${rewardDraft.maxPerUserPerStream} 次` : '每人不限',
        rewardDraft.globalCooldownSeconds > 0 ? `冷卻 ${rewardDraft.globalCooldownSeconds} 秒` : '無冷卻',
      ].join('｜');
      el('twitch-reward-preview').textContent = `${state}｜${rewardDraft.title || '—'}｜${Number.isSafeInteger(rewardDraft.cost) ? rewardDraft.cost.toLocaleString() : '—'} 點｜${limits}｜${rewardDraft.prompt || '—'}`;
    }
    return validation;
  }

  function mergeRewardSettingsFromServer(settings) {
    rewardSaved = TwitchRewardSettings.normalizeSettings(settings);
    if (!dirty.reward) rewardDraft = clone(rewardSaved);
    applyRewardFields();
    updateMainStatus();
  }

  function saveRewardSettings(settings, successMessage) {
    const validation = TwitchRewardSettings.validateSettings(settings);
    if (!validation.ok) { validateRewardForm(); return; }
    const save = el('twitch-reward-save');
    if (save) { save.disabled = true; save.textContent = '正在同步…'; }
    SocketClient.sendWithCallback('twitch:reward-settings:update', validation.settings, (result) => {
      if (save) save.textContent = '儲存並同步 Twitch';
      if (!result?.ok) {
        if (save) save.disabled = false;
        const error = el('twitch-reward-form-error');
        if (error) { error.textContent = result?.error || 'Twitch 沒有回應'; error.hidden = false; }
        if (result?.status) {
          lastRuntimeStatus = result.status;
          applyRewardRuntimeStatus(result.status);
        }
        if (el('twitch-reward-save-status')) el('twitch-reward-save-status').textContent = '同步失敗，已保留上次確認狀態';
        return;
      }
      rewardSaved = TwitchRewardSettings.normalizeSettings(result.settings || validation.settings);
      rewardDraft = clone(rewardSaved);
      setDirty('reward', false);
      applyRewardFields();
      lastRuntimeStatus = result.status || lastRuntimeStatus;
      applyRewardRuntimeStatus(lastRuntimeStatus || {});
      el('twitch-reward-save-status').textContent = successMessage;
      updateMainStatus();
      AppShared.showToast(successMessage, 'success');
    });
  }

  function replyDefinition(key = activeReplyKey) {
    return TwitchReplySettings.REPLY_DEFINITIONS.find((definition) => definition.key === key);
  }

  function renderReplyEvents() {
    const container = el('twitch-reply-events');
    const testEvent = el('twitch-reply-test-event');
    if (!container || !testEvent) return;
    container.innerHTML = '';
    testEvent.innerHTML = '';
    TwitchReplySettings.REPLY_GROUPS.forEach((group) => {
      const label = document.createElement('div');
      label.className = 'twitch-reply-group-label';
      label.textContent = group.label;
      container.appendChild(label);
      TwitchReplySettings.REPLY_DEFINITIONS.filter((definition) => definition.group === group.key).forEach((definition) => {
        const reply = replyDraft.replies[definition.key];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `twitch-reply-event${definition.key === activeReplyKey ? ' is-active' : ''}`;
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', definition.key === activeReplyKey ? 'true' : 'false');
        button.innerHTML = `<span>${escapeHtml(definition.label)}</span><span class="twitch-reply-event-state">${reply.enabled ? '開' : '關'}</span>`;
        button.addEventListener('click', () => { activeReplyKey = definition.key; renderReplyEvents(); loadReplyEditor(); });
        container.appendChild(button);
        const option = document.createElement('option');
        option.value = definition.key;
        option.textContent = `${group.label}｜${definition.label}`;
        option.selected = definition.key === activeReplyKey;
        testEvent.appendChild(option);
      });
    });
    updateReplyTestPreview();
  }

  function replySampleValues() {
    const values = TwitchReplySettings.sampleValues();
    values.command = requestDraft.commands.request.command || '!點歌';
    return values;
  }

  function loadReplyEditor() {
    const definition = replyDefinition();
    const reply = replyDraft.replies[activeReplyKey];
    if (!definition || !reply) return;
    const group = TwitchReplySettings.REPLY_GROUPS.find((item) => item.key === definition.group);
    el('twitch-reply-editor').dataset.twitchReplyKey = activeReplyKey;
    el('twitch-reply-editor-label').textContent = definition.label;
    el('twitch-reply-editor-group').textContent = group?.label || '';
    el('twitch-reply-item-enabled').checked = reply.enabled;
    el('twitch-reply-template').value = reply.template;
    validateReplyEditor();
  }

  function syncReplyEditorFromFields() {
    const reply = replyDraft.replies[activeReplyKey];
    if (!reply) return;
    reply.enabled = !!el('twitch-reply-item-enabled')?.checked;
    reply.template = el('twitch-reply-template')?.value || '';
    setDirty('replies', true);
    renderReplyEvents();
    validateReplyEditor();
  }

  function validateReplyEditor() {
    const definition = replyDefinition();
    const reply = replyDraft.replies[activeReplyKey];
    if (!definition || !reply) return null;
    const validation = TwitchReplySettings.validateTemplate(reply.template);
    const editor = el('twitch-reply-editor');
    editor.classList.toggle('is-invalid', !validation.valid);
    el('twitch-reply-item-error').hidden = validation.valid;
    el('twitch-reply-item-error').textContent = validation.errors[0] || '';
    el('twitch-reply-count').textContent = `${Array.from(reply.template).length}/${TwitchReplySettings.MAX_MESSAGE_LENGTH}`;
    el('twitch-reply-preview').textContent = validation.valid
      ? `預覽：${TwitchReplySettings.renderTemplate(reply.template, replySampleValues())}`
      : '預覽暫停：請先修正文案中的變數。';
    const whole = TwitchReplySettings.validateSettings(replyDraft);
    const formError = el('twitch-reply-form-error');
    const message = whole.errors[0]?.message || '';
    if (formError) { formError.textContent = message; formError.hidden = !message; }
    if (el('twitch-reply-save')) el('twitch-reply-save').disabled = !whole.ok;
    if (el('twitch-reply-test-send')) el('twitch-reply-test-send').disabled = !whole.ok;
    updateReplyTestPreview();
    return whole;
  }

  function mergeReplySettingsFromServer(settings) {
    replySaved = TwitchReplySettings.normalizeSettings(settings);
    if (!dirty.replies) replyDraft = clone(replySaved);
    el('twitch-reply-enabled').checked = replyDraft.enabled;
    el('twitch-reply-mode').value = replyDraft.replyMode;
    renderReplyEvents();
    loadReplyEditor();
    updateMainStatus();
  }

  function saveReplySettings(settings, successMessage) {
    const validation = TwitchReplySettings.validateSettings(settings);
    if (!validation.ok) { validateReplyEditor(); return; }
    const save = el('twitch-reply-save');
    if (save) save.disabled = true;
    SocketClient.sendWithCallback('twitch:reply-settings:update', validation.settings, (result) => {
      if (!result?.ok) {
        if (save) save.disabled = false;
        el('twitch-reply-save-status').textContent = `儲存失敗：${result?.error || '伺服器沒有回應'}`;
        return;
      }
      replySaved = TwitchReplySettings.normalizeSettings(result.settings || validation.settings);
      replyDraft = clone(replySaved);
      setDirty('replies', false);
      el('twitch-reply-enabled').checked = replyDraft.enabled;
      el('twitch-reply-mode').value = replyDraft.replyMode;
      renderReplyEvents(); loadReplyEditor(); updateMainStatus();
      el('twitch-reply-save-status').textContent = successMessage;
      AppShared.showToast(successMessage, 'success');
    });
  }

  function updateReplyTestPreview() {
    const select = el('twitch-reply-test-event');
    const preview = el('twitch-reply-test-preview');
    if (!select || !preview) return;
    const reply = replyDraft.replies[select.value];
    const validation = TwitchReplySettings.validateTemplate(reply?.template || '');
    preview.textContent = validation.valid ? `本機預覽：${TwitchReplySettings.renderTemplate(reply.template, replySampleValues())}` : '請先修正文案中的錯誤。';
  }

  async function sendReplyTest() {
    const validation = TwitchReplySettings.validateSettings(replyDraft);
    if (!validation.ok) { validateReplyEditor(); return; }
    const replyKey = el('twitch-reply-test-event')?.value || '';
    const definition = replyDefinition(replyKey);
    if (!definition) return;
    const confirmed = await window.PanelConfirm?.request({
      title: '送出 Twitch 公開測試？',
      summary: `將把「${definition.label}」的範例回覆公開送到目前連接的 Twitch 聊天室。`,
      impact: '不會建立點歌或儲存設定；聊天室中的觀眾會看得到這則測試訊息。',
      confirmLabel: '送出測試訊息',
    });
    if (!confirmed) return;
    const button = el('twitch-reply-test-send');
    const status = el('twitch-reply-test-status');
    if (button) button.disabled = true;
    if (status) status.textContent = '正在送出測試訊息…';
    SocketClient.sendWithCallback('twitch:reply-settings:test', { settings: validation.settings, replyKey }, (result) => {
      if (button) button.disabled = false;
      if (!result?.ok) { if (status) status.textContent = `測試未送出：${result?.error || '伺服器沒有回應'}`; return; }
      if (status) status.textContent = `已送出：${result.text}`;
      AppShared.showToast('Twitch 測試訊息已送出', 'success');
    });
  }

  function initSettingsForms() {
    const commandPermission = el('twitch-command-permission');
    const customPermission = el('twitch-custom-permission');
    TwitchRequestSettings.PERMISSION_LEVELS.forEach((level) => {
      const option = document.createElement('option');
      option.value = level.key;
      option.textContent = level.label;
      commandPermission?.appendChild(option);
      customPermission?.appendChild(option.cloneNode(true));
    });
    const blacklistType = el('twitch-blacklist-type');
    TwitchRequestSettings.BLACKLIST_TYPES.forEach((type) => {
      const option = document.createElement('option');
      option.value = type.key;
      option.textContent = type.label;
      blacklistType?.appendChild(option);
    });
    renderCommandList(); loadCommandEditor(); applyRuleFields(); renderBlacklistList(); loadBlacklistEditor(); renderCustomCommandList(); loadCustomCommandEditor(); applyRewardFields(); renderReplyEvents(); loadReplyEditor(); renderActivityHistory(); renderHistoryList();

    ['twitch-command-enabled', 'twitch-command-name', 'twitch-command-aliases', 'twitch-command-permission', 'twitch-command-user-cooldown', 'twitch-command-global-cooldown'].forEach((id) => {
      const control = el(id);
      control?.addEventListener(control.matches('input[type="text"], input[type="number"]') ? 'input' : 'change', syncActiveCommandFromFields);
    });
    ['twitch-request-enabled', 'twitch-request-max-pending', 'twitch-request-per-user', 'twitch-request-max-duration', 'twitch-request-duplicate-scope', 'twitch-request-recent-hours', 'twitch-request-live-only', 'twitch-request-per-user-session', 'twitch-request-session-limit', 'twitch-request-moderator-exempt', 'twitch-request-consecutive-warning'].forEach((id) => {
      const control = el(id);
      control?.addEventListener(control.matches('input[type="number"]') ? 'input' : 'change', syncRulesFromFields);
    });
    el('twitch-request-edit-cooldown')?.addEventListener('click', () => {
      activeCommandKey = 'request';
      renderCommandList();
      loadCommandEditor();
      switchManagementPane('commands');
      window.setTimeout(() => el('twitch-command-global-cooldown')?.focus(), 0);
    });
    el('twitch-blacklist-type')?.addEventListener('change', () => { updateBlacklistHint(); validateBlacklistEditor(); });
    ['twitch-blacklist-value', 'twitch-blacklist-reason', 'twitch-blacklist-expires'].forEach((id) => el(id)?.addEventListener('input', validateBlacklistEditor));
    ['twitch-blacklist-enabled', 'twitch-blacklist-moderator-exempt'].forEach((id) => el(id)?.addEventListener('change', validateBlacklistEditor));
    el('twitch-blacklist-new')?.addEventListener('click', () => { activeBlacklistId = ''; renderBlacklistList(); loadBlacklistEditor(); el('twitch-blacklist-value')?.focus(); });
    el('twitch-blacklist-apply')?.addEventListener('click', applyBlacklistEditor);
    el('twitch-blacklist-delete')?.addEventListener('click', async () => {
      const rule = requestDraft.blacklist.find((item) => item.id === activeBlacklistId);
      if (!rule) return;
      const confirmed = await window.PanelConfirm?.request({ title: '刪除這筆黑名單規則？', summary: `${blacklistTypeDefinition(rule.type).label}：${rule.value}`, impact: '儲存黑名單前仍可關閉管理視窗放棄變更。', tone: 'danger', confirmLabel: '刪除規則' });
      if (!confirmed) return;
      requestDraft.blacklist = requestDraft.blacklist.filter((item) => item.id !== activeBlacklistId);
      activeBlacklistId = '';
      setDirty('blacklist', true); renderBlacklistList(); loadBlacklistEditor();
    });
    ['twitch-reward-enabled', 'twitch-reward-paused', 'twitch-reward-title', 'twitch-reward-prompt', 'twitch-reward-cost', 'twitch-reward-max-per-stream', 'twitch-reward-max-per-user', 'twitch-reward-global-cooldown'].forEach((id) => {
      const control = el(id);
      control?.addEventListener(control.matches('input[type="checkbox"]') ? 'change' : 'input', collectRewardFields);
    });
    el('twitch-reply-enabled')?.addEventListener('change', () => { replyDraft.enabled = !!el('twitch-reply-enabled').checked; setDirty('replies', true); validateReplyEditor(); });
    el('twitch-reply-mode')?.addEventListener('change', () => { replyDraft.replyMode = el('twitch-reply-mode').value; setDirty('replies', true); validateReplyEditor(); });
    el('twitch-reply-item-enabled')?.addEventListener('change', syncReplyEditorFromFields);
    el('twitch-reply-template')?.addEventListener('input', syncReplyEditorFromFields);
    el('twitch-reply-test-event')?.addEventListener('change', updateReplyTestPreview);
    el('twitch-reply-test-send')?.addEventListener('click', sendReplyTest);
    ['twitch-custom-enabled', 'twitch-custom-name', 'twitch-custom-aliases', 'twitch-custom-permission', 'twitch-custom-user-cooldown', 'twitch-custom-global-cooldown', 'twitch-custom-template'].forEach((id) => {
      const control = el(id);
      control?.addEventListener(control.matches('input[type="text"], input[type="number"], textarea') ? 'input' : 'change', syncCustomCommandFromFields);
    });
    el('twitch-custom-new')?.addEventListener('click', createCustomCommand);
    el('twitch-custom-duplicate')?.addEventListener('click', duplicateCustomCommand);
    el('twitch-custom-delete')?.addEventListener('click', deleteCustomCommand);
    el('twitch-custom-public-test')?.addEventListener('click', sendCustomCommandTest);
    el('twitch-sim-run')?.addEventListener('click', runSimulator);
    el('twitch-history-refresh')?.addEventListener('click', refreshHistory);

    const variables = el('twitch-reply-variable-buttons');
    TwitchReplySettings.VARIABLE_DEFINITIONS.forEach((variable) => {
      const button = document.createElement('button');
      button.className = 'btn btn-sm btn-ghost twitch-reply-variable-button';
      button.type = 'button';
      button.textContent = `{${variable.key}}`;
      button.title = variable.label;
      button.addEventListener('click', () => {
        const input = el('twitch-reply-template');
        const token = `{${variable.key}}`;
        const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
        const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
        input.setRangeText(token, start, end, 'end');
        input.focus();
        syncReplyEditorFromFields();
      });
      variables?.appendChild(button);
    });
    const customVariables = el('twitch-custom-variable-buttons');
    TwitchReplySettings.VARIABLE_DEFINITIONS
      .filter((variable) => TwitchRequestSettings.CUSTOM_COMMAND_VARIABLES.includes(variable.key))
      .forEach((variable) => {
        const button = document.createElement('button');
        button.className = 'btn btn-sm btn-ghost twitch-reply-variable-button';
        button.type = 'button';
        button.textContent = '{' + variable.key + '}';
        button.title = variable.label;
        button.addEventListener('click', () => insertCustomVariable(variable.key));
        customVariables?.appendChild(button);
      });

    el('twitch-command-save')?.addEventListener('click', () => saveRequestCategory('commands', 'Twitch 指令已儲存'));
    el('twitch-request-save')?.addEventListener('click', () => saveRequestCategory('rules', '接受規則已儲存'));
    el('twitch-blacklist-save')?.addEventListener('click', () => saveRequestCategory('blacklist', 'Twitch 黑名單已儲存'));
    el('twitch-custom-save')?.addEventListener('click', () => saveRequestCategory('custom', 'Twitch 自訂指令已儲存'));
    el('twitch-reward-save')?.addEventListener('click', () => saveRewardSettings(rewardDraft, '忠誠點數獎勵已同步'));
    el('twitch-reply-save')?.addEventListener('click', () => saveReplySettings(replyDraft, '聊天室回覆設定已儲存'));
    el('twitch-command-edit-reply')?.addEventListener('click', () => {
      const replyByCommand = { request: 'received', currentSong: 'currentSong', nextSong: 'nextSong', myRequests: 'myRequests', position: 'requestPosition', cancelRequest: 'requestCanceled', rules: 'requestRules', queueSummary: 'queueSummary', adminOpen: 'adminRequestOpened', adminPause: 'adminRequestPaused', adminReject: 'adminRequestRejected', adminRemove: 'adminRequestRemoved', adminPromote: 'adminRequestPromoted', adminSkip: 'adminSkipped' };
      activeReplyKey = replyByCommand[activeCommandKey] || 'received';
      renderReplyEvents(); loadReplyEditor(); switchManagementPane('replies');
      window.setTimeout(() => el('twitch-reply-template')?.focus(), 0);
    });

    el('twitch-command-reset')?.addEventListener('click', async () => {
      const confirmed = await window.PanelConfirm?.request({ title: '還原所有 Twitch 指令？', summary: '所有內建指令的名稱、別名、資格與冷卻會回到預設值。', impact: '接受規則、忠誠點數與回覆文案不受影響。', confirmLabel: '還原指令' });
      if (!confirmed) return;
      requestDraft.commands = clone(TwitchRequestSettings.getDefaults().commands);
      setDirty('commands', true); renderCommandList(); loadCommandEditor(); saveRequestCategory('commands', 'Twitch 指令已還原');
    });
    el('twitch-request-reset')?.addEventListener('click', async () => {
      const confirmed = await window.PanelConfirm?.request({ title: '還原 Twitch 接受規則？', summary: '總開關、待確認上限、重複與時長限制會回到預設值。', impact: '指令、回覆文案與既有待確認點歌不受影響。', confirmLabel: '還原規則' });
      if (!confirmed) return;
      const defaults = TwitchRequestSettings.getDefaults();
      requestDraft = {
        ...requestDraft,
        enabled: defaults.enabled,
        maxPending: defaults.maxPending,
        perUserPending: defaults.perUserPending,
        duplicateScope: defaults.duplicateScope,
        recentDuplicateHours: defaults.recentDuplicateHours,
        maxDurationMinutes: defaults.maxDurationMinutes,
        liveOnly: defaults.liveOnly,
        perUserSessionLimit: defaults.perUserSessionLimit,
        sessionRequestLimit: defaults.sessionRequestLimit,
        fairnessModeratorExempt: defaults.fairnessModeratorExempt,
        warnConsecutiveRequests: defaults.warnConsecutiveRequests,
      };
      setDirty('rules', true); applyRuleFields(); saveRequestCategory('rules', '接受規則已還原');
    });
    el('twitch-blacklist-reset')?.addEventListener('click', async () => {
      const confirmed = await window.PanelConfirm?.request({ title: '清除全部 Twitch 黑名單？', summary: `目前 ${requestDraft.blacklist.length} 筆規則都會移除。`, impact: '不會改動指令、接受規則、忠誠點數或待確認點歌。', tone: 'danger', confirmLabel: '清除全部規則' });
      if (!confirmed) return;
      requestDraft.blacklist = [];
      activeBlacklistId = '';
      setDirty('blacklist', true); renderBlacklistList(); loadBlacklistEditor(); saveRequestCategory('blacklist', 'Twitch 黑名單已清除');
    });
    el('twitch-custom-reset')?.addEventListener('click', async () => {
      const count = requestDraft.customCommands.length;
      const confirmed = await window.PanelConfirm?.request({ title: '清除全部自訂指令？', summary: '目前 ' + count + ' 個自訂指令都會移除。', impact: '不會改動內建指令、接受規則、回覆文案或待確認點歌。', tone: 'danger', confirmLabel: '清除全部指令' });
      if (!confirmed) return;
      requestDraft.customCommands = [];
      activeCustomCommandId = '';
      setDirty('custom', true); renderCustomCommandList(); loadCustomCommandEditor(); saveRequestCategory('custom', 'Twitch 自訂指令已清除');
    });
    el('twitch-reward-reset')?.addEventListener('click', async () => {
      const confirmed = await window.PanelConfirm?.request({ title: '停用並還原忠誠點數獎勵？', summary: 'Twitch 上的專用獎勵會停用，名稱、說明與價格回到預設值。', impact: '不會刪除獎勵或清除 Twitch 授權；既有待確認兌換仍會正常完成或退款。', confirmLabel: '停用並還原' });
      if (!confirmed) return;
      rewardDraft = { ...TwitchRewardSettings.getDefaults(), rewardId: rewardSaved.rewardId };
      setDirty('reward', true); applyRewardFields(); saveRewardSettings(rewardDraft, '忠誠點數獎勵已停用並還原');
    });
    el('twitch-reply-reset')?.addEventListener('click', async () => {
      const confirmed = await window.PanelConfirm?.request({ title: '還原 Twitch 回覆預設值？', summary: '總開關、所有分項、回覆方式與自訂文案都會回到預設值。', impact: 'Twitch 授權、指令與待確認點歌不受影響。', confirmLabel: '還原回覆' });
      if (!confirmed) return;
      replyDraft = TwitchReplySettings.getDefaults();
      setDirty('replies', true); renderReplyEvents(); loadReplyEditor(); saveReplySettings(replyDraft, '聊天室回覆設定已還原');
    });
  }

  function initAuthActions() {
    const connect = el('twitch-connect');
    connect?.addEventListener('click', async () => {
      const authWindow = window.open('', 'elitesand-twitch-login');
      try {
        connect.disabled = true;
        const response = await PinAuth.fetchWithPin('/api/twitch/authorize');
        const data = await response.json();
        if (!response.ok || !data.verificationUri || !data.userCode) throw new Error(data.error || '無法開始 Twitch 授權');
        if (el('twitch-device-link')) { el('twitch-device-link').href = data.verificationUri; el('twitch-device-link').hidden = false; }
        if (authWindow) { authWindow.location.replace(data.verificationUri); showStatus('已開啟 Twitch 登入與授權頁，請依 Twitch 指示完成授權。', 'info'); }
        else {
          // Electron 殼會拒絕空白彈窗（authWindow 為 null）；直接開驗證頁，殼會用系統瀏覽器外開。
          window.open(data.verificationUri, '_blank', 'noopener');
          showStatus(`已開啟 Twitch 授權頁（若未自動開啟，請按「前往 Twitch 輸入代碼」）。代碼：${data.userCode}`, 'info');
        }
      } catch (err) {
        if (authWindow && !authWindow.closed) authWindow.close();
        connect.disabled = false;
        showStatus(`無法開始 Twitch 授權：${err.message}`, 'error');
      }
    });
    el('twitch-deauthorize')?.addEventListener('click', async () => {
      const button = el('twitch-deauthorize');
      const isAuthorized = button.textContent.includes('解除');
      const confirmed = await window.DangerConfirm?.request({ title: isAuthorized ? '確認解除 Twitch 授權' : '確認取消 Twitch 連接流程', summary: isAuthorized ? '這會停止 Twitch EventSub 與聊天室點歌，並移除本機保存的 Twitch 權杖。' : '這會取消目前等待中的 Twitch Device Code 授權流程。', impact: '已收到、尚待確認的 Twitch 點歌會保留；歌曲、歌單與其他設定不會刪除。', phrase: isAuthorized ? '解除 Twitch 授權' : '取消 Twitch 連接', confirmLabel: isAuthorized ? '解除授權' : '取消流程' });
      if (!confirmed) return;
      try {
        button.disabled = true;
        const response = await PinAuth.fetchWithPin('/api/twitch/deauthorize', { method: 'POST' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '解除 Twitch 授權失敗');
        showStatus(data.remoteError ? `本機 Twitch 授權已移除，但暫時無法通知 Twitch：${data.remoteError}` : 'Twitch 授權已解除。', data.remoteError ? 'warning' : 'success');
        await refreshStatus();
      } catch (err) { showStatus(`解除 Twitch 授權失敗：${err.message}`, 'error'); }
      finally { button.disabled = false; }
    });
    el('twitch-reward-reauthorize')?.addEventListener('click', () => el('twitch-connect')?.click());
  }

  function renderRequests() {
    const list = el('twitch-requests-list');
    if (!list) return;
    el('twitch-requests-count').textContent = String(pending.size);
    const badge = el('twitch-nav-badge');
    if (badge) { badge.textContent = String(pending.size); badge.hidden = pending.size === 0; }
    if (el('twitch-reject-all')) el('twitch-reject-all').hidden = pending.size === 0;
    if (!pending.size) { list.innerHTML = '<div class="twitch-request-empty">目前沒有待確認的點歌</div>'; return; }
    list.innerHTML = '';
    for (const req of pending.values()) {
      const isBusy = busy.has(req.requestId);
      const placement = busy.get(req.requestId);
      const row = document.createElement('div');
      row.className = 'twitch-req';
      const title = req.title || '無法取得影片標題';
      const author = req.author || '未知頻道';
      const thumbnail = req.thumbnail && /^https:\/\//i.test(req.thumbnail) ? req.thumbnail : '';
      const requestCode = req.shortId ? ` · 編號 #${escapeHtml(req.shortId)}` : '';
      row.innerHTML = `<div class="twitch-req-info">${thumbnail ? `<img class="twitch-req-thumbnail" src="${escapeHtml(thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="twitch-req-thumbnail twitch-req-thumbnail--empty">無縮圖</div>'}<div class="twitch-req-copy"><div class="twitch-req-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div><div class="twitch-req-author">${escapeHtml(author)}</div><div class="twitch-req-user">點歌者：${escapeHtml(req.requester || '觀眾')}${requestCode}</div>${req.source === 'channel-points' ? `<div class="pi-badge twitch-req-reward">忠誠點數兌換 · ${Number(req.rewardRedemption?.cost || 0).toLocaleString()} 點</div>` : ''}${Array.isArray(req.assessment?.warnings) && req.assessment.warnings.length ? `<div class="pi-badge twitch-req-warning">⚠ ${escapeHtml(req.assessment.warnings.join('；'))}</div>` : req.durationWarning ? '<div class="pi-badge twitch-req-warning">⚠ 影片超過 15 分鐘，請確認後再下載</div>' : ''}<a class="twitch-req-url" href="${escapeHtml(req.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(req.url)}</a></div></div><div class="twitch-req-actions"><button class="btn btn-sm btn-primary" data-act="next"${isBusy ? ' disabled' : ''}>${isBusy ? (placement === 'next' ? '插播下載中…' : '下載中…') : '插到下一首'}</button><button class="btn btn-sm btn-ghost" data-act="end"${isBusy ? ' disabled' : ''}>加入尾端</button><button class="btn btn-sm btn-ghost btn-danger" data-act="reject"${isBusy ? ' disabled' : ''}>${req.source === 'channel-points' ? '拒絕並退款' : '拒絕'}</button></div>`;
      row.querySelector('[data-act="next"]').addEventListener('click', () => confirmRequest(req.requestId, 'next'));
      row.querySelector('[data-act="end"]').addEventListener('click', () => confirmRequest(req.requestId, 'end'));
      row.querySelector('[data-act="reject"]').addEventListener('click', () => rejectRequest(req.requestId));
      list.appendChild(row);
    }
  }

  async function confirmRequest(requestId, placement = 'end') {
    const req = pending.get(requestId);
    if (!req || busy.has(requestId) || typeof AppShared.queueYouTubeImport !== 'function') return;
    busy.set(requestId, placement); renderRequests();
    try {
      const track = await AppShared.queueYouTubeImport(req.url, { source: `Twitch · ${req.requester || req.userName || '觀眾點歌'}`, assessment: req.assessment || null, placement });
      const report = await new Promise((resolve) => SocketClient.sendWithCallback('twitch:song-request:result', { requestId, success: true, title: track && (track.title || track.name), artist: track && track.artist, position: placement === 'next' ? '下一首' : '歌單尾端', queue: Math.max(1, (AppShared.state.playlist || []).findIndex((item) => item && track && item.id === track.id) + 1) }, resolve));
      if (!report?.ok) throw new Error(report?.error || '無法回覆 Twitch 聊天室');
      AppShared.showToast(`${placement === 'next' ? '已插到下一首' : '已加入清單尾端'}：${track?.title || '歌曲'}`, 'success');
      pending.delete(requestId);
    } catch (err) {
      SocketClient.sendWithCallback('twitch:song-request:result', { requestId, success: false, retryable: true, error: err?.message || '下載或匯入失敗' }, () => {});
      AppShared.showToast('聊天室點歌下載失敗', 'error');
    } finally { busy.delete(requestId); renderRequests(); }
  }

  function rejectRequest(requestId) {
    const req = pending.get(requestId);
    if (!req || busy.has(requestId)) return;
    busy.set(requestId, 'reject'); renderRequests();
    SocketClient.sendWithCallback('twitch:song-request:result', { requestId, success: false, rejected: true }, (result) => {
      busy.delete(requestId);
      if (!result?.ok) { renderRequests(); AppShared.showToast(`拒絕失敗：${result?.error || '伺服器沒有回應'}`, 'error'); return; }
      pending.delete(requestId); renderRequests();
      AppShared.showToast(req.source === 'channel-points' ? '已拒絕並退還忠誠點數' : '已略過這首點歌', 'info');
    });
  }

  el('twitch-reject-all')?.addEventListener('click', async () => {
    if (!pending.size) return;
    const confirmed = await window.PanelConfirm?.request({ title: `拒絕全部 ${pending.size} 筆點歌？`, summary: '這些待確認點歌會全部標記為略過。', impact: '已加入播放清單的歌曲與其他設定不受影響。', tone: 'danger', confirmLabel: '全部拒絕' });
    if (!confirmed) return;
    for (const requestId of [...pending.keys()]) rejectRequest(requestId);
  });

  el('twitch-request-quick-toggle')?.addEventListener('click', () => {
    const next = { ...requestSaved, enabled: !requestSaved.enabled };
    const button = el('twitch-request-quick-toggle');
    button.disabled = true;
    SocketClient.sendWithCallback('twitch:request-settings:update', next, (result) => {
      button.disabled = false;
      if (!result?.ok) { AppShared.showToast(`切換點歌狀態失敗：${result?.error || '伺服器沒有回應'}`, 'error'); return; }
      const normalized = TwitchRequestSettings.normalizeSettings(result.settings || next);
      requestSaved = normalized;
      if (!dirty.rules) requestDraft.enabled = normalized.enabled;
      applyRuleFields(); updateMainStatus();
      AppShared.showToast(normalized.enabled ? 'Twitch 點歌已開放' : 'Twitch 點歌已暫停', 'success');
    });
  });

  SocketClient.on('twitch:request-settings:update', mergeRequestSettingsFromServer);
  SocketClient.on('twitch:reward-settings:update', mergeRewardSettingsFromServer);
  SocketClient.on('twitch:reply-settings:update', mergeReplySettingsFromServer);
  SocketClient.on('twitch:history', applyHistory);
  SocketClient.on('twitch:admin-action', (action) => {
    if (!action?.actionId || action.type !== 'skip') return;
    let result = { ok: false, error: '目前沒有可略過的歌曲' };
    try {
      if (typeof AppShared.advanceTrack === 'function' && AppShared.advanceTrack(1)) result = { ok: true };
    } catch (err) {
      result = { ok: false, error: String(err?.message || '桌面面板無法略過歌曲').slice(0, 240) };
    }
    SocketClient.sendWithCallback('twitch:admin-action:result', { actionId: action.actionId, ...result }, () => {});
  });
  SocketClient.on('twitch:song-request', (request) => {
    if (!request?.requestId || !request.url) return;
    pending.set(request.requestId, request); renderRequests();
    AppShared.showToast(`${request.requester || '觀眾'} 點了一首歌，請到「點歌」頁確認`, 'info');
  });
  SocketClient.on('twitch:requests', (requests) => {
    pending.clear();
    if (Array.isArray(requests)) requests.forEach((request) => { if (request?.requestId && request.url) pending.set(request.requestId, request); });
    renderRequests();
  });
  SocketClient.on('twitch:song-request:expired', ({ requestId } = {}) => {
    if (!requestId || !pending.delete(requestId)) return;
    busy.delete(requestId); renderRequests(); AppShared.showToast('有一筆 Twitch 點歌等待過久，已自動取消', 'info');
  });
  SocketClient.on('twitch:song-request:canceled', ({ requestId } = {}) => {
    if (!requestId || !pending.delete(requestId)) return;
    busy.delete(requestId); renderRequests(); AppShared.showToast('觀眾已從聊天室取消一筆待確認點歌', 'info');
  });

  initManagementModal();
  initSettingsForms();
  initAuthActions();
  renderRequests();
  updateMainStatus();
  refreshStatus();
  setInterval(refreshStatus, 10000);
})();
