/**
 * PIN 存取控制 — 前端共用模組
 *
 * 職責：
 * - 讀寫本機儲存的 PIN（localStorage，設定一次記住，除非清除瀏覽器資料）
 * - 幫需要保護的 fetch() 呼叫附加 X-Pin header
 * - 監聽 SocketClient 的 'auth:required'，跳出輸入框讓使用者輸入 PIN 並重新連線
 * - （僅面板頁）管理 PIN：設定／更改／停用
 *
 * 必須在 socket-client.js 之前載入（socket-client.js 的 init() 會讀 PinAuth.get()）。
 */
const PinAuth = (() => {
  const STORAGE_KEY = 'es-pin';

  function get() {
    try { return localStorage.getItem(STORAGE_KEY) || ''; } catch (e) { return ''; }
  }
  function set(pin) {
    try {
      if (pin) localStorage.setItem(STORAGE_KEY, pin);
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* 靜默：無痕模式等環境可能拒絕寫入 */ }
  }
  function clear() { set(''); }

  function headers() {
    const pin = get();
    return pin ? { 'X-Pin': pin } : {};
  }

  /** 帶 PIN header 的 fetch 包裝，給會觸發下載/處理的 API 呼叫用 */
  function fetchWithPin(url, opts) {
    opts = opts || {};
    const h = Object.assign({}, opts.headers || {}, headers());
    return fetch(url, Object.assign({}, opts, { headers: h }));
  }

  // ─── 登入 modal（PIN 錯誤/未提供時擋住操作）───
  function wireRequiredModal() {
    const modal = document.getElementById('pin-required-modal');
    if (!modal) return;
    const input = document.getElementById('pin-required-input');
    const err = document.getElementById('pin-required-error');
    const submit = document.getElementById('pin-required-submit');

    function showError(msg) {
      err.textContent = msg;
      err.classList.add('is-visible');
    }
    function hideError() {
      err.classList.remove('is-visible');
    }

    async function trySubmit() {
      const pin = (input.value || '').trim();
      if (!pin) { showError('請輸入 PIN'); return; }
      submit.disabled = true;
      try {
        const res = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin }),
        });
        const data = await res.json();
        if (data.ok) {
          hideError();
          modal.hidden = true;
          input.value = '';
          if (typeof SocketClient !== 'undefined') SocketClient.reauth(pin);
        } else {
          showError(data.message || 'PIN 不正確');
        }
      } catch (e) {
        showError('驗證失敗，請確認伺服器連線後再試');
      } finally {
        submit.disabled = false;
      }
    }

    submit.addEventListener('click', trySubmit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') trySubmit(); });

    if (typeof SocketClient !== 'undefined') {
      SocketClient.on('auth:required', () => {
        modal.hidden = false;
        setTimeout(() => input.focus(), 50);
      });
      SocketClient.on('auth:ok', () => { modal.hidden = true; });
    }
  }

  // ─── 面板：PIN 管理（設定／更改／停用）───
  // controller.html 沒有這組元素，函式會直接因找不到節點而 no-op。
  function wireManageUI() {
    const card = document.getElementById('pin-settings-card');
    if (!card) return;

    const statusOff = document.getElementById('pin-status-off');
    const statusOn = document.getElementById('pin-status-on');
    const enableBtn = document.getElementById('pin-enable-btn');
    const changeBtn = document.getElementById('pin-change-btn');
    const disableBtn = document.getElementById('pin-disable-btn');

    const modal = document.getElementById('pin-manage-modal');
    const title = document.getElementById('pin-manage-title');
    const currentWrap = document.getElementById('pin-manage-current-wrap');
    const currentInput = document.getElementById('pin-manage-current');
    const newWrap = document.getElementById('pin-manage-new-wrap');
    const newInput = document.getElementById('pin-manage-new');
    const confirmWrap = document.getElementById('pin-manage-confirm-wrap');
    const confirmInput = document.getElementById('pin-manage-confirm');
    const errEl = document.getElementById('pin-manage-error');
    const submitBtn = document.getElementById('pin-manage-submit');
    const cancelBtn = document.getElementById('pin-manage-cancel');

    let mode = 'set'; // 'set' | 'change' | 'disable'

    function refreshStatus() {
      fetch('/api/auth/status').then((r) => r.json()).then((data) => {
        statusOff.hidden = !!data.hasPin;
        statusOn.hidden = !data.hasPin;
        // 卡片預設收合（存取控制設一次很少再動）；但 PIN 目前已啟用時強制展開，
        // 避免使用中的安全設定被藏起來、使用者以為沒設定。
        if (data.hasPin && card.tagName === 'DETAILS') card.open = true;
      }).catch(() => { /* 讀不到就維持現狀，不阻擋介面 */ });
    }

    function showError(msg) { errEl.textContent = msg; errEl.classList.add('is-visible'); }
    function hideError() { errEl.classList.remove('is-visible'); }

    function openModal(m) {
      mode = m;
      hideError();
      currentInput.value = ''; newInput.value = ''; confirmInput.value = '';
      if (m === 'set') {
        title.textContent = '設定 PIN';
        currentWrap.hidden = true; newWrap.hidden = false; confirmWrap.hidden = false;
        submitBtn.textContent = '啟用保護';
      } else if (m === 'change') {
        title.textContent = '更改 PIN';
        currentWrap.hidden = false; newWrap.hidden = false; confirmWrap.hidden = false;
        submitBtn.textContent = '確認更改';
      } else {
        title.textContent = '停用 PIN 保護';
        currentWrap.hidden = false; newWrap.hidden = true; confirmWrap.hidden = true;
        submitBtn.textContent = '停用';
      }
      modal.hidden = false;
      setTimeout(() => (mode === 'disable' ? currentInput : (mode === 'change' ? currentInput : newInput)).focus(), 50);
    }
    function closeModal() { modal.hidden = true; }

    async function submit() {
      hideError();
      if (mode === 'disable') {
        const currentPin = currentInput.value.trim();
        if (!currentPin) { showError('請輸入目前的 PIN'); return; }
        submitBtn.disabled = true;
        try {
          const res = await fetch('/api/auth/clear', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPin }),
          });
          const data = await res.json();
          if (data.ok) {
            clear();
            closeModal();
            refreshStatus();
          } else {
            showError(data.message || '停用失敗');
          }
        } catch (e) {
          showError('請求失敗，請確認伺服器連線');
        } finally {
          submitBtn.disabled = false;
        }
        return;
      }

      const newPin = newInput.value.trim();
      const confirmPin = confirmInput.value.trim();
      const currentPin = currentInput.value.trim();
      if (newPin.length < 4) { showError('PIN 至少需要 4 個字元'); return; }
      if (newPin !== confirmPin) { showError('兩次輸入的 PIN 不一致'); return; }
      if (mode === 'change' && !currentPin) { showError('請輸入目前的 PIN'); return; }

      submitBtn.disabled = true;
      try {
        const res = await fetch('/api/auth/set', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPin, currentPin }),
        });
        const data = await res.json();
        if (data.ok) {
          set(newPin); // 這台裝置自己也記住新 PIN，設定完不用馬上重輸一次
          if (typeof SocketClient !== 'undefined') SocketClient.reauth(newPin);
          closeModal();
          refreshStatus();
        } else {
          showError(data.message || '設定失敗');
        }
      } catch (e) {
        showError('請求失敗，請確認伺服器連線');
      } finally {
        submitBtn.disabled = false;
      }
    }

    enableBtn.addEventListener('click', () => openModal('set'));
    changeBtn.addEventListener('click', () => openModal('change'));
    disableBtn.addEventListener('click', () => openModal('disable'));
    cancelBtn.addEventListener('click', closeModal);
    submitBtn.addEventListener('click', submit);

    refreshStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { wireRequiredModal(); wireManageUI(); });
  } else {
    wireRequiredModal();
    wireManageUI();
  }

  return { get, set, clear, headers, fetchWithPin };
})();
