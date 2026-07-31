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
  };

  function showFormError(message) {
    dom.formError.textContent = message;
    dom.formError.hidden = !message;
  }

  function describeValidationErrors(errors) {
    return (errors || [])
      .map((error) => t(ERROR_CODE_KEYS[error.code] || 'feedback.errorGeneric', {
        field: t(FIELD_LABEL_KEYS[error.field] || error.field),
      }))
      .join('\n');
  }

  function setStatus(message, isError) {
    dom.status.textContent = message || '';
    dom.status.classList.toggle('feedback-error', !!isError);
  }

  function showPreview(text, byteLength) {
    dom.previewText.textContent = text;
    dom.previewSize.textContent = t('feedback.previewSize', { size: Math.ceil(byteLength / 1024) });
    dom.previewPanel.hidden = false;
    // 中繼沒啟用時不是隱藏按鈕，而是明說原因並留下複製路徑——
    // 隱藏按鈕會讓使用者以為功能壞了。
    dom.submitBtn.hidden = !canSubmit;
    setStatus(canSubmit ? '' : t('feedback.relayDisabled'));
    dom.previewText.focus();
  }

  async function requestPreview() {
    showFormError('');
    dom.previewBtn.disabled = true;
    // 第一次預覽要實際探測 yt-dlp 與 FFmpeg，可能要兩三秒。沒有這行提示的話
    // 使用者只會看到一顆按不動的按鈕，會以為壞了。
    const originalLabel = dom.previewBtn.textContent;
    dom.previewBtn.textContent = t('feedback.collecting');
    try {
      const response = await PinAuth.fetchWithPin('/api/feedback/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(readForm()),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || !data.ok) {
        showFormError(data && data.errors ? describeValidationErrors(data.errors) : t('feedback.previewFailed'));
        return;
      }
      canSubmit = !!data.canSubmit;
      showPreview(data.preview, data.byteLength);
    } catch (_) {
      showFormError(t('feedback.previewFailed'));
    } finally {
      dom.previewBtn.disabled = false;
      dom.previewBtn.textContent = originalLabel;
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
    setStatus(t('feedback.submitting'));
    if (!requestId) requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      const response = await PinAuth.fetchWithPin('/api/feedback/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign(readForm(), { requestId })),
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data && data.ok) {
        clearDraft();
        requestId = null;
        setStatus(t('feedback.submitted', { id: data.reportId }));
        toast(t('feedback.submitted', { id: data.reportId }), 'success');
        dom.submitBtn.hidden = true;
        return;
      }
      const code = (data && data.code) || 'BACKEND_UNAVAILABLE';
      setStatus(`${t(SUBMIT_ERROR_KEYS[code] || 'feedback.errorBackend')} ${t('feedback.fallbackCopy')}`, true);
    } catch (_) {
      setStatus(`${t('feedback.errorNetwork')} ${t('feedback.fallbackCopy')}`, true);
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
    showFormError('');
    setStatus('');
    requestId = null;
    clearDraft();
  }

  // select 在部分瀏覽器只發 change 不發 input，兩個都接才不會漏存問題類型。
  FIELDS.forEach((field) => {
    dom[field].addEventListener('input', saveDraft);
    dom[field].addEventListener('change', saveDraft);
  });
  dom.includeDiagnostics.addEventListener('change', saveDraft);
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

  loadDraft();

  // 先問一次中繼狀態，讓「送出」按鈕在預覽前就決定好要不要出現。
  fetch('/api/feedback/status', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => { canSubmit = !!(data && data.enabled); })
    .catch(() => { canSubmit = false; });
})();
