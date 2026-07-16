/**
 * 直播中的破壞性操作確認。
 *
 * 瀏覽器的 confirm 容易因習慣性按 Enter 而誤觸；此模組要求使用者輸入動作名稱，
 * 並把每次操作的實際影響明確列出。只用於會一次影響大量資料的動作，單首移除
 * 仍維持較輕量的確認，避免日常操作變得笨重。
 */
(function () {
  'use strict';

  const modal = document.getElementById('danger-confirm-modal');
  const title = document.getElementById('danger-confirm-title');
  const summary = document.getElementById('danger-confirm-summary');
  const impact = document.getElementById('danger-confirm-impact');
  const phraseText = document.getElementById('danger-confirm-phrase');
  const input = document.getElementById('danger-confirm-input');
  const cancel = document.getElementById('danger-confirm-cancel');
  const submit = document.getElementById('danger-confirm-submit');

  let pending = null;
  let expectedPhrase = '';
  let previousFocus = null;

  function close(accepted) {
    if (!pending) return;
    const resolve = pending;
    pending = null;
    modal.hidden = true;
    input.value = '';
    submit.disabled = true;
    expectedPhrase = '';
    const focusTarget = previousFocus;
    previousFocus = null;
    if (focusTarget && document.contains(focusTarget)) focusTarget.focus();
    resolve(accepted);
  }

  function inputMatches() {
    return input.value.trim() === expectedPhrase;
  }

  function updateSubmitState() {
    submit.disabled = !inputMatches();
  }

  function request(options) {
    if (!modal || !title || !summary || !impact || !phraseText || !input || !cancel || !submit) {
      // 寧可不執行，也不要在彈窗資源意外缺失時退回只有一鍵的確認。
      return Promise.resolve(false);
    }
    if (pending) return Promise.resolve(false);

    const config = options && typeof options === 'object' ? options : {};
    expectedPhrase = String(config.phrase || '確認').trim();
    if (!expectedPhrase) return Promise.resolve(false);

    title.textContent = String(config.title || '確認此操作');
    summary.textContent = String(config.summary || '這個動作會變更資料。');
    impact.textContent = String(config.impact || '請確認這正是你要做的動作。');
    phraseText.textContent = expectedPhrase;
    input.value = '';
    input.placeholder = `輸入「${expectedPhrase}」`;
    submit.textContent = String(config.confirmLabel || expectedPhrase);
    submit.disabled = true;
    previousFocus = document.activeElement;
    modal.hidden = false;
    requestAnimationFrame(() => input.focus());

    return new Promise((resolve) => { pending = resolve; });
  }

  cancel.addEventListener('click', () => close(false));
  submit.addEventListener('click', () => {
    if (inputMatches()) close(true);
  });
  input.addEventListener('input', updateSubmitState);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && inputMatches()) {
      event.preventDefault();
      close(true);
    }
  });
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close(false);
  });
  document.addEventListener('keydown', (event) => {
    if (!pending || event.key !== 'Escape') return;
    event.preventDefault();
    close(false);
  });

  window.DangerConfirm = { request };
})();
