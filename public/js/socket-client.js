/**
 * Socket.io 客戶端通訊模組 v3 (Phase 5)
 * 負責與後端即時雙向通訊
 * 
 * Phase 5 新增事件：
 * - offset:adjust / offset:set / offset:reset / offset:update
 * - lyrics:manual / lyrics:updated
 * - playlist:export / playlist:import / playlist:exported
 * - state:request / state:recovery
 * - audio:error / audio:skip
 */
const SocketClient = (() => {
  let socket = null;
  let isConnected = false;
  const listeners = {};

  let _clientType = null;

  /**
   * 初始化連線
   * @param {string} clientType - 'controller' | 'display' | 'remote' | 'setlist'
   */
  function init(clientType) {
    _clientType = clientType;
    // display/setlist（OBS 疊加層）伺服器端永遠豁免 PIN，這裡帶不帶 pin 都無所謂；
    // controller/remote（面板/手機遙控）若伺服器設了 PIN，握手驗證失敗會收到
    // connect_error('PIN_REQUIRED')，交給 pin-auth.js 跳出輸入框後呼叫 reauth() 重試。
    const pin = (typeof PinAuth !== 'undefined') ? PinAuth.get() : '';
    socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      auth: { clientType, pin },
    });

    socket.on('connect', () => {
      isConnected = true;
      console.log('[Socket] 已連線:', socket.id);
      socket.emit('client:type', clientType);
      emit('connection-change', true);
      emit('auth:ok');
    });

    socket.on('disconnect', (reason) => {
      isConnected = false;
      console.warn('[Socket] 斷線:', reason);
      emit('connection-change', false);
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket] 連線錯誤:', err.message);
      if (err.message === 'PIN_REQUIRED') emit('auth:required');
    });

    // ─── 接收事件註冊 ───

    // 基礎播放控制
    socket.on('state:sync', (state) => emit('state:sync', state));
    socket.on('play:track', (track) => emit('play:track', track));
    socket.on('play:toggle', (isPlaying) => emit('play:toggle', isPlaying));
    socket.on('play:seek', (time) => emit('play:seek', time));
    socket.on('play:prev', () => emit('play:prev'));
    socket.on('play:next', () => emit('play:next'));

    // 歌詞同步
    socket.on('lyrics:line', (data) => emit('lyrics:line', data));
    socket.on('lyrics:word', (data) => emit('lyrics:word', data));
    socket.on('lyrics:sync', (data) => emit('lyrics:sync', data));
    socket.on('lyrics:romanized', (data) => emit('lyrics:romanized', data));

    // Phase 5: 歌詞更新（手動覆蓋後）
    socket.on('lyrics:updated', (data) => emit('lyrics:updated', data));

    // 風格 / 羅馬拼音
    socket.on('style:change', (style) => emit('style:change', style));
    socket.on('style:override', (o) => emit('style:override', o));
    socket.on('romanization:toggle', (enabled) => emit('romanization:toggle', enabled));
    socket.on('romanization:mode', (mode) => emit('romanization:mode', mode));

    // 緊急隱藏
    socket.on('emergency:hide', () => emit('emergency:hide'));
    socket.on('emergency:show', () => emit('emergency:show'));

    // 播放列表
    socket.on('playlist:update', (playlist) => emit('playlist:update', playlist));
    socket.on('youtube:progress', (data) => emit('youtube:progress', data));
    socket.on('server:alert', (data) => emit('server:alert', data));

    // Phase 5: 播放列表匯出結果
    socket.on('playlist:exported', (data) => emit('playlist:exported', data));

    // Phase 5: 時間偏移
    socket.on('offset:update', (data) => emit('offset:update', data));

    // Phase 5: OBS 狀態恢復
    socket.on('state:recovery', (state) => emit('state:recovery', state));

    // Phase 5: 音訊錯誤
    socket.on('audio:error', (data) => emit('audio:error', data));
    socket.on('audio:skip', (data) => emit('audio:skip', data));

    // 媒體庫
    socket.on('library:list', (list) => emit('library:list', list));

    // Setlist
    socket.on('setlist:update', (data) => emit('setlist:update', data));
    socket.on('setlist:theme', (data) => emit('setlist:theme', data));
    socket.on('setlist:style', (data) => emit('setlist:style', data));
    socket.on('setlist:layout', (data) => emit('setlist:layout', data));
    // 示範資料：純轉播、不落地存檔，讓面板預覽與真實 OBS 來源都能看到同一份假資料
    socket.on('setlist:demo', (data) => emit('setlist:demo', data));
    socket.on('setlist:demo-clear', () => emit('setlist:demo-clear'));
    socket.on('client:counts', (data) => emit('client:counts', data));
    // Twitch 點歌：只由桌面控制面板消費，處理完成後回傳結果讓 server 回覆聊天室。
    socket.on('twitch:song-request', (data) => emit('twitch:song-request', data));
    socket.on('twitch:requests', (data) => emit('twitch:requests', data));
    socket.on('twitch:song-request:expired', (data) => emit('twitch:song-request:expired', data));

    // 歌詞外觀設定：顯示端據此直接套 CSS 變數（不重渲染、不重跑動畫）。
    // 先前漏接此行 → OBS 只能靠 state:sync 拿設定，連帶每次都重渲染當前行＝拖滑桿卡頓。
    socket.on('lyric-settings:update', (data) => emit('lyric-settings:update', data));

    // Phase 7: 變調與變速
    socket.on('pitch:update', (semitones) => emit('pitch:update', semitones));
    socket.on('speed:update', (rate) => emit('speed:update', rate));
    socket.on('metronome:update', (enabled) => emit('metronome:update', enabled));
  }

  /**
   * 發送事件
   */
  function send(event, data) {
    if (socket && isConnected) {
      socket.emit(event, data);
    } else {
      console.warn(`[Socket] 無法發送 (未連線): ${event}`);
      emit('operation:error', { event, message: '伺服器未連線，操作沒有送出' });
      return false;
    }
    return true;
  }

  /**
   * 發送事件（帶 callback，用於需要回應的請求）
   */
  function sendWithCallback(event, data, callback) {
    if (socket && isConnected) {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return; done = true;
        emit('operation:error', { event, message: '伺服器回應逾時，操作可能未完成' });
        if (callback) callback(null, { code: 'TIMEOUT' });
      }, 8000);
      socket.emit(event, data, (...args) => {
        if (done) return; done = true; clearTimeout(timer);
        if (callback) callback(...args);
      });
    } else {
      console.warn(`[Socket] 無法發送 (未連線): ${event}`);
      emit('operation:error', { event, message: '伺服器未連線，操作沒有送出' });
      if (callback) callback(null, { code: 'DISCONNECTED' });
    }
  }

  /**
   * 註冊事件監聽
   */
  function on(event, callback) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
  }

  /**
   * 移除事件監聽
   */
  function off(event, callback) {
    if (!listeners[event]) return;
    if (callback) {
      listeners[event] = listeners[event].filter((cb) => cb !== callback);
    } else {
      delete listeners[event];
    }
  }

  /**
   * 觸發本地事件
   */
  function emit(event, data) {
    if (listeners[event]) {
      listeners[event].forEach((cb) => {
        try {
          cb(data);
        } catch (err) {
          console.error(`[Socket] 事件處理錯誤 (${event}):`, err);
        }
      });
    }
  }

  function connected() {
    return isConnected;
  }

  function getId() {
    return socket ? socket.id : null;
  }

  /**
   * 用新輸入的 PIN 重新連線（PinAuth 的登入 modal 驗證成功後呼叫）。
   */
  function reauth(pin) {
    if (typeof PinAuth !== 'undefined') PinAuth.set(pin);
    if (!socket) return;
    socket.auth = { clientType: _clientType, pin };
    socket.disconnect();
    socket.connect();
  }

  return {
    init,
    send,
    sendWithCallback,
    on,
    off,
    connected,
    getId,
    reauth,
  };
})();
