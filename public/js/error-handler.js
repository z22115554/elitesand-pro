/**
 * Elitesand Pro 前端統一錯誤處理與通知系統
 * 
 * 功能：
 * - 全域錯誤捕獲 (window.onerror, unhandledrejection)
 * - 增強版 Toast 通知（支援 info/success/warning/error 四種類型）
 * - 連線狀態變更通知
 * - 音訊錯誤通知
 * - 輸入驗證工具函數
 * - 防呆檢查
 */
const ErrorHandler = (() => {
  const { escapeHtml } = SharedUtils;

  // Toast 佇列（支援多條同時顯示）
  let toastContainer = null;
  let toastQueue = [];
  const MAX_TOASTS = 5;
  const TOAST_DURATION = 4000;
  const HISTORY_KEY = 'elite-error-history-v1';
  const MAX_HISTORY = 30;
  let initialized = false;
  let errorHistory = loadHistory();

  // 錯誤計數器（防止錯誤訊息洗版）
  let errorCounts = {};
  const MAX_SAME_ERROR = 3; // 同一錯誤最多顯示 3 次
  const ERROR_COOLDOWN = 10000; // 10 秒冷卻

  /**
   * 初始化錯誤處理系統
   */
  function init() {
    if (initialized) return;
    initialized = true;
    // 建立 Toast 容器
    toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      toastContainer.className = 'toast-container';
      document.body.appendChild(toastContainer);
    }

    // 全域錯誤捕獲
    window.addEventListener('error', (event) => {
      logError('Global', event.message, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
      // 不阻止預設行為，讓開發者工具也能看到
    });

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      logError('Promise', reason?.message || String(reason), {
        stack: reason?.stack,
      });
    });

    bindHistoryUI();
    renderHistory();

    console.log('[ErrorHandler] 已初始化');
  }

  /**
   * 顯示 Toast 通知
   */
  function showToast(message, type = 'info', duration = TOAST_DURATION) {
    if (!toastContainer) init();

    // 防洗版：同一訊息冷卻
    const key = `${type}:${message}`;
    const now = Date.now();
    if (errorCounts[key]) {
      if (errorCounts[key].count >= MAX_SAME_ERROR && now - errorCounts[key].lastTime < ERROR_COOLDOWN) {
        return; // 冷卻中，不顯示
      }
      errorCounts[key].count++;
      errorCounts[key].lastTime = now;
    } else {
      errorCounts[key] = { count: 1, lastTime: now };
    }

    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;

    toast.innerHTML = `
      <span class="toast-dot"></span>
      <span class="toast-message">${escapeHtml(message)}</span>
      <button class="toast-close" title="關閉" aria-label="關閉">&times;</button>
    `;

    // 關閉按鈕
    toast.querySelector('.toast-close').addEventListener('click', () => {
      removeToast(toast);
    });

    toastContainer.appendChild(toast);
    toastQueue.push(toast);

    // 限制同時顯示數量
    while (toastQueue.length > MAX_TOASTS) {
      removeToast(toastQueue[0]);
    }

    // 入場動畫
    requestAnimationFrame(() => {
      toast.classList.add('toast-visible');
    });

    // 自動消失
    if (duration > 0) {
      toast._timeout = setTimeout(() => {
        removeToast(toast);
      }, duration);
    }

    // 同時記錄到 console
    const consoleFn = type === 'error' ? console.error : type === 'warning' ? console.warn : console.log;
    consoleFn(`[${type.toUpperCase()}] ${message}`);
    if (type === 'error' || type === 'warning') recordError(type === 'error' ? '操作錯誤' : '警告', message);
  }

  function removeToast(toast) {
    if (!toast || !toast.parentNode) return;
    clearTimeout(toast._timeout);
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-exit');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
      toastQueue = toastQueue.filter(t => t !== toast);
    }, 300);
  }

  /**
   * 記錄錯誤到 console（結構化格式）
   */
  function logError(source, message, extra = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, source, message, ...extra };
    console.error(`[ErrorHandler][${source}] ${message}`, logEntry);
    recordError(source, message);
  }

  function redact(value) {
    return String(value || '')
      .replace(/\b(Bearer|OAuth)\s+[A-Za-z0-9._~-]+/gi, '$1 [redacted]')
      .replace(/("(?:access|refresh)_?token"\s*:\s*")[^"]+/gi, '$1[redacted]')
      .replace(/\bPIN\s*[:=]\s*\d+/gi, 'PIN: [redacted]')
      .slice(0, 1000);
  }

  function loadHistory() {
    try {
      const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(value) ? value.slice(0, MAX_HISTORY) : [];
    } catch (_) { return []; }
  }

  function saveHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(errorHistory)); } catch (_) { /* 儲存額滿不影響主流程 */ }
  }

  function recordError(source, message) {
    const entry = { timestamp: new Date().toISOString(), source: redact(source), message: redact(message) };
    const latest = errorHistory[0];
    if (latest && latest.source === entry.source && latest.message === entry.message
      && Date.now() - Date.parse(latest.timestamp) < 1000) return;
    errorHistory.unshift(entry);
    errorHistory = errorHistory.slice(0, MAX_HISTORY);
    saveHistory();
    renderHistory();
  }

  function renderHistory() {
    const list = document.getElementById('error-history-list');
    const count = document.getElementById('error-history-count');
    if (count) count.textContent = String(errorHistory.length);
    if (!list) return;
    list.textContent = '';
    if (!errorHistory.length) {
      const empty = document.createElement('div');
      empty.className = 'error-history-empty';
      empty.textContent = '目前沒有錯誤記錄';
      list.appendChild(empty);
      return;
    }
    for (const entry of errorHistory) {
      const item = document.createElement('div');
      item.className = 'error-history-item';
      const head = document.createElement('div');
      head.className = 'error-history-item-head';
      const source = document.createElement('span');
      source.textContent = entry.source;
      const time = document.createElement('time');
      time.textContent = new Date(entry.timestamp).toLocaleString('zh-TW', { hour12: false });
      const message = document.createElement('div');
      message.className = 'error-history-item-message';
      message.textContent = entry.message;
      head.append(source, time);
      item.append(head, message);
      list.appendChild(item);
    }
  }

  function historyText() {
    return errorHistory.map(entry => `[${entry.timestamp}] [${entry.source}] ${entry.message}`).join('\n');
  }

  function bindHistoryUI() {
    const copy = document.getElementById('error-history-copy');
    const clear = document.getElementById('error-history-clear');
    if (copy) copy.addEventListener('click', async () => {
      if (!errorHistory.length) return showToast('目前沒有錯誤記錄', 'info');
      try {
        await navigator.clipboard.writeText(historyText());
        showToast('錯誤記錄已複製', 'success');
      } catch (_) { showToast('無法存取剪貼簿，請檢查瀏覽器權限', 'error'); }
    });
    if (clear) clear.addEventListener('click', () => {
      errorHistory = [];
      saveHistory();
      renderHistory();
      showToast('錯誤記錄已清除', 'info');
    });
  }

  // ═══════════════════════════════════════════
  // 輸入驗證工具（防呆）
  // ═══════════════════════════════════════════

  /**
   * 驗證 YouTube URL 格式
   */
  function validateYouTubeUrl(url) {
    if (!url || typeof url !== 'string') {
      return { valid: false, message: '請輸入 YouTube 連結' };
    }
    const trimmed = url.trim();
    if (!trimmed) {
      return { valid: false, message: '請輸入 YouTube 連結' };
    }
    const patterns = [
      /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]+/,
      /^https?:\/\/youtu\.be\/[\w-]+/,
      /^https?:\/\/(www\.)?youtube\.com\/shorts\/[\w-]+/,
      /^https?:\/\/(www\.)?youtube\.com\/embed\/[\w-]+/,
      /^https?:\/\/music\.youtube\.com\/watch\?v=[\w-]+/,
    ];
    const isValid = patterns.some(p => p.test(trimmed));
    if (!isValid) {
      return { valid: false, message: '無效的 YouTube 連結格式，請確認連結正確' };
    }
    return { valid: true, url: trimmed };
  }

  /**
   * 驗證音訊檔案
   */
  function validateAudioFile(file) {
    if (!file) {
      return { valid: false, message: '未選擇檔案' };
    }
    const allowed = ['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.aac', '.wma'];
    const ext = '.' + (file.name || '').split('.').pop().toLowerCase();
    if (!allowed.includes(ext)) {
      return { valid: false, message: `不支援的格式 ${ext}，僅支援: ${allowed.join(', ')}` };
    }
    const maxSize = 200 * 1024 * 1024; // 200MB
    if (file.size > maxSize) {
      return { valid: false, message: `檔案過大 (${(file.size / 1024 / 1024).toFixed(1)}MB)，上限 200MB` };
    }
    return { valid: true };
  }

  /**
   * 驗證歌詞檔案
   */
  function validateLyricsFile(file) {
    if (!file) {
      return { valid: false, message: '未選擇歌詞檔案' };
    }
    const allowed = ['.lrc', '.srt', '.txt'];
    const ext = '.' + (file.name || '').split('.').pop().toLowerCase();
    if (!allowed.includes(ext)) {
      return { valid: false, message: `不支援的格式 ${ext}，僅支援: ${allowed.join(', ')}` };
    }
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return { valid: false, message: `歌詞檔案過大 (${(file.size / 1024 / 1024).toFixed(1)}MB)，上限 5MB` };
    }
    return { valid: true };
  }

  /**
   * 驗證歌詞文字內容
   */
  function validateLyricsContent(content) {
    if (!content || typeof content !== 'string') {
      return { valid: false, message: '請輸入歌詞內容' };
    }
    const trimmed = content.trim();
    if (!trimmed) {
      return { valid: false, message: '歌詞內容不能為空' };
    }
    if (trimmed.length > 1000000) { // 1MB 文字上限
      return { valid: false, message: '歌詞內容過長，上限 1 百萬字元' };
    }
    return { valid: true, content: trimmed };
  }

  /**
   * 限制數值範圍
   */
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * 防抖函數
   */
  function debounce(fn, delay = 300) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  /**
   * 安全的 JSON 解析
   */
  function safeJsonParse(str, fallback = null) {
    try {
      return JSON.parse(str);
    } catch (e) {
      return fallback;
    }
  }

  /**
   * 安全的 fetch 封裝（含超時和錯誤處理）
   */
  async function safeFetch(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        let errorMsg = `請求失敗 (${response.status})`;
        try {
          const data = JSON.parse(text);
          errorMsg = data.error || data.details || errorMsg;
        } catch (e) {
          // 非 JSON 回應
        }
        throw new Error(errorMsg);
      }

      return await response.json();
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Error('請求逾時，請檢查網路連線');
      }
      throw err;
    }
  }

  return {
    init,
    showToast,
    logError,
    validateYouTubeUrl,
    validateAudioFile,
    validateLyricsFile,
    validateLyricsContent,
    clamp,
    debounce,
    safeJsonParse,
    safeFetch,
    getHistory: () => errorHistory.map(entry => ({ ...entry })),
    clearHistory: () => { errorHistory = []; saveHistory(); renderHistory(); },
  };
})();
