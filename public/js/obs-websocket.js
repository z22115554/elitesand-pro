/**
 * OBS WebSocket v5 客戶端（瀏覽器端，面板專用）
 *
 * 面板直接連 OBS 內建的 WebSocket 伺服器（預設 ws://127.0.0.1:4455），做兩件事：
 *   1. 一鍵在目前場景建立「歌詞」「歌單」兩個瀏覽器來源，尺寸自動吃 OBS 畫布大小。
 *   2. 讀取推流狀態（是否開台、開台時間），供歌單章節時間戳參考。
 *
 * 刻意走瀏覽器端而非伺服器端：瀏覽器原生有 WebSocket 與 crypto.subtle（做 v5 的
 * SHA256 認證握手），不必給 Node 伺服器加相依、也不影響可攜包打包。密碼只留在本機
 * 面板記憶體/localStorage，不經過我們的伺服器。
 *
 * 協定摘要（op code）：0 Hello → 1 Identify(送) → 2 Identified；6 Request(送) / 7 Response；5 Event。
 * 認證字串 = base64(sha256( base64(sha256(password+salt)) + challenge ))。
 */
const ObsWs = (() => {
  const OBS_OP = { HELLO: 0, IDENTIFY: 1, IDENTIFIED: 2, EVENT: 5, REQUEST: 6, REQUEST_RESPONSE: 7 };
  const DISPLAY_SOURCE = 'Elitesand 歌詞';
  const SETLIST_SOURCE = 'Elitesand 歌單';

  let socket = null;
  let connected = false;
  let reqSeq = 0;
  const pending = new Map();       // requestId -> {resolve, reject}
  const listeners = {};            // 本地事件：status / stream / error
  let reconnectTimer = null;
  let healthTimer = null;
  let retryCount = 0;
  let lastOptions = null;
  let shouldReconnect = false;
  let connecting = null;
  const HEALTH_CHECK_MS = 15000;

  function emit(evt, data) {
    (listeners[evt] || []).forEach((cb) => { try { cb(data); } catch (e) { /* 靜默 */ } });
  }
  function on(evt, cb) { (listeners[evt] = listeners[evt] || []).push(cb); }

  async function sha256Base64(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  async function buildAuth(password, salt, challenge) {
    const secret = await sha256Base64(password + salt);
    return sha256Base64(secret + challenge);
  }

  function stopHealthCheck() {
    if (healthTimer) clearInterval(healthTimer);
    healthTimer = null;
  }

  function startHealthCheck() {
    stopHealthCheck();
    healthTimer = setInterval(() => {
      if (!connected || !socket) return;
      request('GetVersion').catch(() => {
        // 沒有收到 OBS 回應就關閉這條壞連線，onclose 會接手重連。
        try { socket.close(); } catch (_) { /* 靜默 */ }
      });
    }, HEALTH_CHECK_MS);
  }

  function scheduleReconnect() {
    if (!shouldReconnect || reconnectTimer || !lastOptions) return;
    retryCount = Math.min(retryCount + 1, 6);
    const delay = Math.min(15000, 1000 * (2 ** retryCount));
    emit('status', { connected: false, reconnecting: true, retryInMs: delay });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect(lastOptions).catch(() => {
        // 失敗後由這裡安排下一次；不讓未捕捉的 rejection 汙染 console。
        scheduleReconnect();
      });
    }, delay);
  }

  function publishStreamStatus() {
    return getStreamStatus().then((stream) => {
      emit('stream', stream);
      return stream;
    });
  }

  /**
   * 連線並完成 Identify 握手。
   * @param {{host?:string, port?:number, password?:string}} opts
   * @returns {Promise<void>} 成功 = 已 Identified；失敗 reject（含認證錯誤/連不上）
   */
  function connect(opts = {}) {
    const host = (opts.host || '127.0.0.1').trim();
    const port = opts.port || 4455;
    const password = opts.password || '';
    lastOptions = { host, port, password };
    shouldReconnect = true;
    if (connecting) return connecting;
    emit('status', { connected: false, connecting: true });
    connecting = new Promise((resolve, reject) => {
      let settled = false;
      let ws;
      try { ws = new WebSocket(`ws://${host}:${port}`); socket = ws; }
      catch (e) { reject(new Error('無法建立連線：' + e.message)); return; }

      const failTimer = setTimeout(() => {
        if (!settled) { settled = true; try { ws.close(); } catch (e) {} reject(new Error('連線逾時（OBS 沒開，或 WebSocket 伺服器未啟用/埠號不對）')); }
      }, 6000);

      socket.onmessage = async (raw) => {
        if (socket !== ws) return;
        let msg;
        try { msg = JSON.parse(raw.data); } catch (e) { return; }
        const { op, d } = msg;

        if (op === OBS_OP.HELLO) {
          const identify = { rpcVersion: 1, eventSubscriptions: (1 << 6) }; // Outputs 事件（推流狀態）
          if (d.authentication) {
            if (!password) { clearTimeout(failTimer); settled = true; try { ws.close(); } catch (e) {} reject(new Error('這個 OBS 有設密碼，請填入 WebSocket 密碼')); return; }
            identify.authentication = await buildAuth(password, d.authentication.salt, d.authentication.challenge);
          }
          ws.send(JSON.stringify({ op: OBS_OP.IDENTIFY, d: identify }));
        } else if (op === OBS_OP.IDENTIFIED) {
          clearTimeout(failTimer);
          settled = true;
          connected = true;
          retryCount = 0;
          emit('status', { connected: true, monitoring: true });
          startHealthCheck();
          publishStreamStatus();
          resolve();
        } else if (op === OBS_OP.REQUEST_RESPONSE) {
          const p = pending.get(d.requestId);
          if (p) {
            pending.delete(d.requestId);
            if (d.requestStatus && d.requestStatus.result) p.resolve(d.responseData || {});
            else p.reject(Object.assign(new Error((d.requestStatus && d.requestStatus.comment) || 'OBS 請求失敗'), { code: d.requestStatus && d.requestStatus.code }));
          }
        } else if (op === OBS_OP.EVENT) {
          if (d.eventType === 'StreamStateChanged') {
            publishStreamStatus().catch(() => {
              emit('stream', { active: !!(d.eventData && d.eventData.outputActive), timecode: null });
            });
          }
        }
      };

      ws.onerror = () => {
        if (!settled) { clearTimeout(failTimer); settled = true; reject(new Error('連線錯誤（確認 OBS 已開、工具→WebSocket 伺服器設定已啟用）')); }
        emit('error', {});
      };
      ws.onclose = (ev) => {
        if (socket !== ws) return;
        connected = false;
        socket = null;
        stopHealthCheck();
        pending.forEach((p) => p.reject(new Error('連線已關閉')));
        pending.clear();
        // 握手還沒完成就被關 → OBS 主動拒絕，最常見是密碼錯（v5 用 close code 4009）
        if (!settled) {
          clearTimeout(failTimer);
          settled = true;
          reject(new Error(ev && ev.code === 4009 ? 'WebSocket 密碼不正確' : '連線被 OBS 關閉（密碼錯誤或版本不相容）'));
        }
        emit('status', { connected: false });
        scheduleReconnect();
      };
    });
    connecting.finally(() => { connecting = null; }).catch(() => {});
    return connecting;
  }

  function disconnect() {
    shouldReconnect = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    stopHealthCheck();
    if (socket) { try { socket.close(); } catch (e) {} }
    socket = null; connected = false;
    emit('status', { connected: false, manual: true });
  }

  function request(requestType, requestData) {
    return new Promise((resolve, reject) => {
      if (!connected || !socket) { reject(new Error('尚未連線')); return; }
      const requestId = `r${reqSeq += 1}`;
      pending.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ op: OBS_OP.REQUEST, d: { requestType, requestId, requestData: requestData || {} } }));
      setTimeout(() => { if (pending.has(requestId)) { pending.delete(requestId); reject(new Error('OBS 回應逾時')); } }, 8000);
    });
  }

  /** 建立/更新單一瀏覽器來源（已存在則改成更新 URL/尺寸，讓按鈕可重複按不報錯）。 */
  async function ensureBrowserSource(sceneName, inputName, url, width, height) {
    const inputSettings = { url, width, height };
    try {
      await request('CreateInput', {
        sceneName, inputName, inputKind: 'browser_source', inputSettings, sceneItemEnabled: true,
      });
      return 'created';
    } catch (e) {
      // 601 = ResourceAlreadyExists：改用更新既有來源的設定
      if (e.code === 601 || /already/i.test(e.message)) {
        await request('SetInputSettings', { inputName, inputSettings, overlay: true });
        return 'updated';
      }
      throw e;
    }
  }

  /**
   * 一鍵建立歌詞＋歌單瀏覽器來源到目前場景，尺寸吃 OBS 畫布大小。
   * @param {{displayUrl:string, setlistUrl:string}} urls
   * @returns {Promise<{scene:string, width:number, height:number, display:string, setlist:string}>}
   */
  async function createBrowserSources(urls) {
    const scene = await request('GetCurrentProgramScene');
    const sceneName = scene.currentProgramSceneName || scene.sceneName;
    const video = await request('GetVideoSettings');
    const width = video.baseWidth || 1920;
    const height = video.baseHeight || 1080;
    const display = await ensureBrowserSource(sceneName, DISPLAY_SOURCE, urls.displayUrl, width, height);
    const setlist = await ensureBrowserSource(sceneName, SETLIST_SOURCE, urls.setlistUrl, width, height);
    return { scene: sceneName, width, height, display, setlist };
  }

  async function getStreamStatus() {
    try {
      const s = await request('GetStreamStatus');
      return { active: !!s.outputActive, timecode: s.outputTimecode || null };
    } catch (e) { return { active: false, timecode: null }; }
  }

  return {
    connect, disconnect, request, createBrowserSources, getStreamStatus,
    on, isConnected: () => connected, isReconnecting: () => !!reconnectTimer || !!connecting,
    DISPLAY_SOURCE, SETLIST_SOURCE,
  };
})();

// ─── 設定頁 OBS 連動卡片接線（本檔在 app-* 之後載入，AppShared 已就緒）───
(function wireObsCard() {
  const card = document.getElementById('obs-ws-card');
  if (!card) return;
  const $ = (id) => document.getElementById(id);
  const hostEl = $('obs-ws-host'); const portEl = $('obs-ws-port'); const pwEl = $('obs-ws-password');
  const statusEl = $('obs-ws-status'); const connectBtn = $('obs-ws-connect');
  const createBtn = $('obs-ws-create'); const msgEl = $('obs-ws-msg');

  // 上次成功的連線設定記在 localStorage（密碼也一併，純本機、不上傳；同 vk-* 慣例）
  let savedOptions = null;
  try {
    const saved = JSON.parse(localStorage.getItem('vk-obs-ws') || '{}');
    if (saved.host) hostEl.value = saved.host;
    if (saved.port) portEl.value = saved.port;
    if (saved.password) pwEl.value = saved.password;
    if (saved.host) savedOptions = saved;
  } catch (e) { /* 靜默 */ }

  const showMsg = (t) => { msgEl.textContent = t || ''; msgEl.hidden = !t; };
  function setConnectedUI(state = {}) {
    if (state.connected) {
      statusEl.textContent = '已連線 · 持續監測';
      statusEl.style.color = 'var(--success, #38b36a)';
      connectBtn.textContent = '中斷';
      createBtn.disabled = false;
    } else if (state.reconnecting) {
      const seconds = Math.ceil((state.retryInMs || 0) / 1000);
      statusEl.textContent = `連線中斷 · ${seconds} 秒後重試`;
      statusEl.style.color = 'var(--text-faint)';
      connectBtn.textContent = '停止重連';
      createBtn.disabled = true;
    } else if (state.connecting) {
      statusEl.textContent = '連線中…';
      statusEl.style.color = 'var(--text-faint)';
      connectBtn.textContent = '取消';
      createBtn.disabled = true;
    } else {
      statusEl.textContent = '未連線';
      statusEl.style.color = '';
      connectBtn.textContent = '連線';
      createBtn.disabled = true;
    }
  }

  function parseTimecodeMs(timecode) {
    const parts = String(timecode || '').trim().split(':');
    if (parts.length !== 3) return null;
    const hours = Number(parts[0]); const minutes = Number(parts[1]); const seconds = Number(parts[2]);
    if (![hours, minutes, seconds].every(Number.isFinite)) return null;
    return Math.max(0, Math.round((hours * 3600 + minutes * 60 + seconds) * 1000));
  }

  let observedStreamActive = false;
  function syncSessionWithStream(stream = {}) {
    if (stream.active) {
      const elapsed = parseTimecodeMs(stream.timecode);
      SocketClient.send('session:start', {
        source: 'obs',
        startedAt: elapsed == null ? Date.now() : Date.now() - elapsed,
      });
      observedStreamActive = true;
      showMsg(`OBS 正在推流；直播 Session 已自動同步${stream.timecode ? `（已開台 ${stream.timecode}）` : ''}。`);
    } else if (observedStreamActive) {
      SocketClient.send('session:stop', { source: 'obs' });
      observedStreamActive = false;
      showMsg('OBS 已停止推流，直播 Session 已自動收台。');
    }
  }

  ObsWs.on('status', setConnectedUI);
  ObsWs.on('stream', syncSessionWithStream);

  connectBtn.addEventListener('click', () => {
    if (ObsWs.isConnected() || ObsWs.isReconnecting()) { ObsWs.disconnect(); return; }
    const opts = { host: hostEl.value, port: parseInt(portEl.value, 10) || 4455, password: pwEl.value };
    connectBtn.disabled = true;
    showMsg('');
    ObsWs.connect(opts).then(() => {
      try { localStorage.setItem('vk-obs-ws', JSON.stringify(opts)); } catch (e) { /* 靜默 */ }
      AppShared.showToast('已連上 OBS', 'success');
    }).catch((err) => {
      showMsg(`${err.message || '連線失敗'}；會持續自動重試，按「停止重連」可取消。`);
    }).finally(() => { if (!ObsWs.isReconnecting()) connectBtn.disabled = false; });
  });

  // 重新整理面板、或 OBS 本身重啟後都恢復上次成功設定，持續維持連線。
  if (savedOptions) {
    setTimeout(() => {
      ObsWs.connect(savedOptions).catch(() => {
        showMsg('正在恢復 OBS 連線；會持續自動重試。');
      });
    }, 100);
  }

  createBtn.addEventListener('click', () => {
    const urls = {
      displayUrl: window.location.origin + '/display',
      setlistUrl: window.location.origin + '/setlist',
    };
    createBtn.disabled = true;
    showMsg('建立中…');
    ObsWs.createBrowserSources(urls).then((r) => {
      const verb = (v) => (v === 'created' ? '已建立' : '已更新');
      showMsg(`場景「${r.scene}」（${r.width}×${r.height}）：\n歌詞來源${verb(r.display)}、歌單來源${verb(r.setlist)}。\n若沒看到，檢查該來源是否被其他來源蓋住。`);
      AppShared.showToast('OBS 來源已就緒', 'success');
    }).catch((err) => {
      showMsg('建立失敗：' + (err.message || '未知錯誤'));
      AppShared.showToast('建立來源失敗', 'warning');
    }).finally(() => { createBtn.disabled = !ObsWs.isConnected(); });
  });
})();
