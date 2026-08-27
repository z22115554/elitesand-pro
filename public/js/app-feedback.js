/* 程式內問題回報 — 面板端。
 *
 * 流程刻意分成兩步：填表 → 預覽 → 送出。預覽的內容由伺服器組出來（不是前端自己拼），
 * 而送出時伺服器會用同一份表單重新組一次，所以「你看到的就是實際送出的」這個承諾
 * 在架構上成立，不是靠前端自律。
 *
 * 降級路徑是這個功能的一半價值：中繼沒設定、關閉、離線或被限流時，一律讓使用者
 * 「複製全文」貼到 Discord 或信件。任何情況下都不能讓使用者填完卻沒有出路。
 */
(function () {
  'use strict';

  const DRAFT_KEY = 'elitesand-feedback-draft-v1';
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);

  const dom = {
    card: document.getElementById('feedback-card'),
    modal: document.getElementById('feedback-modal'),
    modalClose: document.getElementById('feedback-modal-close'),
    openBtn: document.getElementById('feedback-open-btn'),
    launchBtn: document.getElementById('feedback-launch-btn'),
    type: document.getElementById('feedback-type'),
    title: document.getElementById('feedback-title'),
    description: document.getElementById('feedback-description'),
    steps: document.getElementById('feedback-steps'),
    actual: document.getElementById('feedback-actual'),
    expected: document.getElementById('feedback-expected'),
    contact: document.getElementById('feedback-contact'),
    includeDiagnostics: document.getElementById('feedback-include-diagnostics'),
    previewBtn: document.getElementById('feedback-preview-btn'),
    clearBtn: document.getElementById('feedback-clear-btn'),
    formError: document.getElementById('feedback-form-error'),
    previewPanel: document.getElementById('feedback-preview-panel'),
    previewText: document.getElementById('feedback-preview-text'),
    previewSize: document.getElementById('feedback-preview-size'),
    submitBtn: document.getElementById('feedback-submit-btn'),
    copyBtn: document.getElementById('feedback-copy-btn'),
    backBtn: document.getElementById('feedback-back-btn'),
    status: document.getElementById('feedback-status'),
  };
  if (!dom.card || !dom.previewBtn) return;

  const FIELDS = ['type', 'title', 'description', 'steps', 'actual', 'expected', 'contact'];
  let canSubmit = false;
  // 冪等鍵：同一份報告重送要帶同一個值，中繼才不會開出第二張 issue。
  // 送出成功後才換新的——網路失敗時使用者按第二次仍是「同一份」。
  let requestId = null;
  let submitting = false;
  let collecting = false;
  let previewSpoutDiagnostics = null;

  function toast(message, type) {
    if (window.AppShared && window.AppShared.showToast) window.AppShared.showToast(message, type);
  }

  function readForm() {
    return {
      schemaVersion: 1,
      type: dom.type.value,
      title: dom.title.value,
      description: dom.description.value,
      steps: dom.steps.value,
      actual: dom.actual.value,
      expected: dom.expected.value,
      contact: dom.contact.value,
      includeDiagnostics: !!dom.includeDiagnostics.checked,
      locale: window.I18n ? window.I18n.current() : 'zh-TW',
    };
  }

  async function attachSpoutDiagnostics(report) {
    if (report.type !== 'spout' || !report.includeDiagnostics) return report;
    try {
      const diagnostics = await window.ElitesandShell?.spout?.getIssueDiagnostics?.();
      if (diagnostics && typeof diagnostics === 'object') report.spoutDiagnostics = diagnostics;
    } catch (_) {
      // Diagnostics are helpful but never allowed to block a user's report.
    }
    return report;
  }

  // ─── 草稿：送出失敗時使用者填的東西絕不能不見 ───
  function saveDraft() {
    try {
      const draft = {};
      FIELDS.forEach((field) => { draft[field] = dom[field].value; });
      draft.includeDiagnostics = !!dom.includeDiagnostics.checked;
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (_) { /* 無痕模式等環境可能拒絕寫入，草稿只是便利功能 */ }
  }

  function loadDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (!draft) return;
      FIELDS.forEach((field) => { if (typeof draft[field] === 'string') dom[field].value = draft[field]; });
      if (typeof draft.includeDiagnostics === 'boolean') dom.includeDiagnostics.checked = draft.includeDiagnostics;
    } catch (_) { /* 草稿損毀就當作沒有 */ }
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (_) { /* 同上 */ }
  }

  // ─── 驗證錯誤：伺服器只回欄位與代碼，訊息在這裡挑既有翻譯組出來 ───
  const FIELD_LABEL_KEYS = {
    type: 'feedback.fieldType',
    title: 'feedback.fieldTitle',
    description: 'feedback.fieldDescription',
    steps: 'feedback.fieldSteps',
    actual: 'feedback.fieldActual',
    expected: 'feedback.fieldExpected',
    contact: 'feedback.fieldContact',
    schemaVersion: 'feedback.fieldSchema',
  };
  const ERROR_CODE_KEYS = {
    TOO_SHORT: 'feedback.errorTooShort',
    TOO_LONG: 'feedback.errorTooLong',
    TOO_MANY: 'feedback.errorTooMany',
    INVALID_TYPE: 'feedback.errorInvalidType',
    UNSUPPORTED_SCHEMA: 'feedback.errorUnsupportedSchema',
    PREVIEW_FAILED: 'feedback.previewFailed',
  };

  // 動態文字一律「存語意、不存字串」，切語言時才能重繪（見本檔結尾的 i18n:change）。
  // 直接把翻譯後的字塞進 textContent 是這個專案踩過的坑：畫面會卡在切換前的語言。
  let formErrors = null;   // 伺服器回的 [{ field, code }]
  let statusState = null;  // { key, vars, isError }
  let previewBytes = null; // 預覽大小，KB 文案本身要跟著語言走

  function showFormError(errors) {
    formErrors = errors && errors.length ? errors : null;
    renderFormError();
  }

  function renderFormError() {
    const message = (formErrors || [])
      .map((error) => t(ERROR_CODE_KEYS[error.code] || 'feedback.errorGeneric', {
        field: t(FIELD_LABEL_KEYS[error.field] || error.field),
      }))
      .join('\n');
    dom.formError.textContent = message;
    dom.formError.hidden = !message;
  }

  function setStatus(key, vars, isError) {
    statusState = key ? { key, vars: vars || {}, isError: !!isError } : null;
    renderStatus();
  }

  function renderStatus() {
    if (!statusState) {
      dom.status.textContent = '';
      dom.status.classList.remove('feedback-error');
      return;
    }
    // key 可以是單一 key 或多個 key（例如「送出失敗」＋「內容還在，可以複製」）
    const keys = Array.isArray(statusState.key) ? statusState.key : [statusState.key];
    dom.status.textContent = keys.map((key) => t(key, statusState.vars)).join(' ');
    dom.status.classList.toggle('feedback-error', statusState.isError);
  }

  // 收集中時顯示暫時文案；結束後交還給 I18n.apply()，由 data-i18n 還原成當下語言的標籤。
  function renderCollectingLabel() {
    if (collecting) {
      dom.previewBtn.textContent = t('feedback.collecting');
    } else if (window.I18n) {
      window.I18n.apply(dom.previewBtn);
    } else {
      dom.previewBtn.textContent = t('feedback.previewBtn');
    }
  }

  function renderPreviewSize() {
    dom.previewSize.textContent = previewBytes == null
      ? ''
      : t('feedback.previewSize', { size: Math.ceil(previewBytes / 1024) });
  }

  function showPreview(text, byteLength) {
    dom.previewText.textContent = text;
    previewBytes = byteLength;
    renderPreviewSize();
    dom.previewPanel.hidden = false;
    // 中繼沒啟用時不是隱藏按鈕，而是明說原因並留下複製路徑——
    // 隱藏按鈕會讓使用者以為功能壞了。
    dom.submitBtn.hidden = !canSubmit;
    setStatus(canSubmit ? null : 'feedback.relayDisabled');
    dom.previewText.focus();
  }

  // 預覽失敗（非欄位驗證問題）也走同一套 errors 結構，才能一起隨語言重繪。
  const PREVIEW_FAILED_ERROR = [{ field: null, code: 'PREVIEW_FAILED' }];

  async function requestPreview() {
    showFormError(null);
    dom.previewBtn.disabled = true;
    // 第一次預覽要實際探測 yt-dlp 與 FFmpeg，可能要兩三秒。沒有這行提示的話
    // 使用者只會看到一顆按不動的按鈕，會以為壞了。
    // 收集中的暫時文案不寫回 textContent 之外的狀態；還原時直接重跑 I18n.apply()，
    // 這樣即使使用者在請求進行中切換語言，按鈕也會回到「當下語言」的正確標籤。
    collecting = true;
    renderCollectingLabel();
    try {
      const report = await attachSpoutDiagnostics(readForm());
      previewSpoutDiagnostics = report.spoutDiagnostics || null;
      const response = await PinAuth.fetchWithPin('/api/feedback/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || !data.ok) {
        showFormError(data && data.errors ? data.errors : PREVIEW_FAILED_ERROR);
        return;
      }
      canSubmit = !!data.canSubmit;
      showPreview(data.preview, data.byteLength);
    } catch (_) {
      showFormError(PREVIEW_FAILED_ERROR);
    } finally {
      collecting = false;
      dom.previewBtn.disabled = false;
      renderCollectingLabel();
    }
  }

  const SUBMIT_ERROR_KEYS = {
    RATE_LIMITED: 'feedback.errorRateLimited',
    NETWORK_ERROR: 'feedback.errorNetwork',
    DISABLED: 'feedback.relayDisabled',
    PAYLOAD_TOO_LARGE: 'feedback.errorTooLarge',
  };

  async function submitReport() {
    if (submitting) return;
    submitting = true;
    dom.submitBtn.disabled = true;
    setStatus('feedback.submitting');
    if (!requestId) requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      const report = readForm();
      if (report.type === 'spout' && report.includeDiagnostics && previewSpoutDiagnostics) {
        report.spoutDiagnostics = previewSpoutDiagnostics;
      } else {
        await attachSpoutDiagnostics(report);
      }
      const response = await PinAuth.fetchWithPin('/api/feedback/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign(report, { requestId })),
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data && data.ok) {
        clearDraft();
        requestId = null;
        setStatus('feedback.submitted', { id: data.reportId });
        toast(t('feedback.submitted', { id: data.reportId }), 'success');
        dom.submitBtn.hidden = true;
        return;
      }
      const code = (data && data.code) || 'BACKEND_UNAVAILABLE';
      setStatus([SUBMIT_ERROR_KEYS[code] || 'feedback.errorBackend', 'feedback.fallbackCopy'], null, true);
    } catch (_) {
      setStatus(['feedback.errorNetwork', 'feedback.fallbackCopy'], null, true);
    } finally {
      submitting = false;
      dom.submitBtn.disabled = false;
    }
  }

  async function copyPreview() {
    const text = dom.previewText.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
      toast(t('feedback.copied'), 'success');
    } catch (_) {
      // clipboard API 在非安全來源（區網 http）會被擋；選取起來讓使用者自己按 Ctrl+C。
      const range = document.createRange();
      range.selectNodeContents(dom.previewText);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      toast(t('feedback.copyManual'), 'warning');
    }
  }

  function clearForm() {
    FIELDS.forEach((field) => {
      if (dom[field].tagName === 'SELECT') dom[field].selectedIndex = 0;
      else dom[field].value = '';
    });
    dom.includeDiagnostics.checked = true;
    dom.previewPanel.hidden = true;
    showFormError(null);
    setStatus(null);
    previewBytes = null;
    previewSpoutDiagnostics = null;
    requestId = null;
    clearDraft();
  }

  // select 在部分瀏覽器只發 change 不發 input，兩個都接才不會漏存問題類型。
  FIELDS.forEach((field) => {
    dom[field].addEventListener('input', () => { previewSpoutDiagnostics = null; saveDraft(); });
    dom[field].addEventListener('change', () => { previewSpoutDiagnostics = null; saveDraft(); });
  });
  dom.includeDiagnostics.addEventListener('change', () => { previewSpoutDiagnostics = null; saveDraft(); });
  dom.previewBtn.addEventListener('click', requestPreview);
  dom.clearBtn.addEventListener('click', clearForm);
  dom.submitBtn.addEventListener('click', submitReport);
  dom.copyBtn.addEventListener('click', copyPreview);
  dom.backBtn.addEventListener('click', () => {
    dom.previewPanel.hidden = true;
    dom.title.focus();
  });

  // ─── Modal 開關：首頁臨時按鈕與設定頁入口共用同一個 modal，同一份表單狀態 ───
  function openModal() {
    if (!dom.modal) return;
    dom.modal.hidden = false;
    dom.title.focus();
  }
  function closeModal() {
    if (dom.modal) dom.modal.hidden = true;
  }
  if (dom.openBtn) dom.openBtn.addEventListener('click', openModal);
  if (dom.launchBtn) dom.launchBtn.addEventListener('click', openModal);
  if (dom.modalClose) dom.modalClose.addEventListener('click', closeModal);
  if (dom.modal) {
    dom.modal.addEventListener('click', (event) => { if (event.target === dom.modal) closeModal(); });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !dom.modal || dom.modal.hidden) return;
    closeModal();
  });

  // 切換語言時重繪所有動態文字。專案裡每個有動態文字的模組都做同一件事
  // （app-twitch、app-playlist、error-handler…），漏掉的話畫面會一半日文一半中文。
  window.addEventListener('i18n:change', () => {
    renderFormError();
    renderStatus();
    renderPreviewSize();
    renderCollectingLabel();
  });

  loadDraft();

  // ─── 上次未正常關閉的提示 ───
  // 刻意只有「查看內容」與「不用了」，**沒有「直接傳送」**：直接傳送等於在使用者
  // 沒看過內容的情況下送出診斷，違反 EULA 第七條第 6 項寫的「送出前會顯示實際將
  // 傳送的完整內容供你確認」。要送就走跟手動回報一模一樣的預覽流程。
  const CRASH_HANDLED_KEY = 'elitesand-crash-handled-v1';

  function crashAlreadyHandled(eventKey) {
    try { return localStorage.getItem(CRASH_HANDLED_KEY) === String(eventKey); } catch (_) { return false; }
  }
  function markCrashHandled(eventKey) {
    // 記的是「哪一次當機已經處理過」而不是布林值：下次真的又當機（不同的
    // previousStartedAt）仍然會問，但同一次事件重整頁面不會一直跳。
    try { localStorage.setItem(CRASH_HANDLED_KEY, String(eventKey)); } catch (_) { /* 無痕模式 */ }
  }

  // 共用的預填開啟：當機／更新失敗都走同一條路——預填、其餘欄位留給使用者補充，
  // 一律要按預覽才送得出去，絕不因為是「自動偵測到的問題」就跳過確認。
  function openPrefilled({ type, title, actual, includeDiagnostics = true } = {}) {
    if (type) dom.type.value = type;
    if (title && !dom.title.value.trim()) dom.title.value = title;
    if (actual && !dom.actual.value.trim()) dom.actual.value = actual;
    if (includeDiagnostics) dom.includeDiagnostics.checked = true;
    saveDraft();
    if (window.I18n) window.I18n.apply(dom.modal);
    openModal();
    dom.description.focus();
  }

  function showCrashBanner(eventKey) {
    const banner = document.getElementById('crash-banner');
    if (!banner) return;
    banner.hidden = false;
    const finish = () => { banner.hidden = true; markCrashHandled(eventKey); };
    document.getElementById('crash-review')?.addEventListener('click', () => {
      finish();
      openPrefilled({ type: 'app-error', title: t('crash.prefillTitle'), actual: t('crash.prefillActual') });
    }, { once: true });
    document.getElementById('crash-dismiss')?.addEventListener('click', finish, { once: true });
  }

  // 更新套用失敗的回報入口：呼叫端（app-restart-update-check.js）只負責在失敗時
  // 顯示 banner，實際預填/送出仍全部走這裡同一套「先預覽才送出」的流程。
  function showUpdateFailBanner({ title, actual } = {}) {
    const banner = document.getElementById('update-fail-banner');
    if (!banner) return;
    banner.hidden = false;
    const finish = () => { banner.hidden = true; };
    document.getElementById('update-fail-review')?.addEventListener('click', () => {
      finish();
      openPrefilled({ type: 'app-error', title, actual });
    }, { once: true });
    document.getElementById('update-fail-dismiss')?.addEventListener('click', finish, { once: true });
  }

  window.AppFeedback = Object.freeze({ showUpdateFailBanner });

  // 先問一次中繼狀態，讓「送出」按鈕在預覽前就決定好要不要出現。
  fetch('/api/feedback/status', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      canSubmit = !!(data && data.enabled);
      if (!data || !data.lastSessionCrashed) return;
      const eventKey = data.lastSessionStartedAt || 'unknown';
      if (!crashAlreadyHandled(eventKey)) showCrashBanner(eventKey);
    })
    .catch(() => { canSubmit = false; });
})();
