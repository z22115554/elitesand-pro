/**
 * 直播中的破壞性操作確認。
 *
 * 不使用瀏覽器原生 confirm，讓確認留在面板內，並把每次操作的實際影響明確列出。
 * 高風險動作要求輸入動作名稱；一般確認用 PanelConfirm，維持相同的鍵盤與焦點行為。
 */
(function () {
  'use strict';

  const modal = document.getElementById('danger-confirm-modal');
  const title = document.getElementById('danger-confirm-title');
  const summary = document.getElementById('danger-confirm-summary');
  const impact = document.getElementById('danger-confirm-impact');
  const phraseText = document.getElementById('danger-confirm-phrase');
  const input = document.getElementById('danger-confirm-input');
  const inputField = document.getElementById('danger-confirm-input-field');
  const cancel = document.getElementById('danger-confirm-cancel');
  const submit = document.getElementById('danger-confirm-submit');

  let pending = null;
  let expectedPhrase = '';
  let requiresPhrase = true;
  let previousFocus = null;

  function close(accepted) {
    if (!pending) return;
    const resolve = pending;
    pending = null;
    modal.hidden = true;
    input.value = '';
    submit.disabled = true;
    expectedPhrase = '';
    requiresPhrase = true;
    inputField.hidden = false;
    modal.classList.remove('is-neutral');
    const focusTarget = previousFocus;
    previousFocus = null;
    if (focusTarget && document.contains(focusTarget)) focusTarget.focus();
    resolve(accepted);
  }

  function inputMatches() {
    return !requiresPhrase || input.value.trim() === expectedPhrase;
  }

  function updateSubmitState() {
    submit.disabled = !inputMatches();
  }

  function request(options) {
    if (!modal || !title || !summary || !impact || !phraseText || !input || !inputField || !cancel || !submit) {
      // 寧可不執行，也不要在彈窗資源意外缺失時退回瀏覽器原生確認。
      return Promise.resolve(false);
    }
    if (pending) return Promise.resolve(false);

    const config = options && typeof options === 'object' ? options : {};
    requiresPhrase = config.requirePhrase !== false;
    expectedPhrase = requiresPhrase ? String(config.phrase || '確認').trim() : '';
    if (requiresPhrase && !expectedPhrase) return Promise.resolve(false);

    title.textContent = String(config.title || '確認此操作');
    summary.textContent = String(config.summary || '這個動作會變更資料。');
    impact.textContent = String(config.impact || '請確認這正是你要做的動作。');
    input.value = '';
    inputField.hidden = !requiresPhrase;
    modal.classList.toggle('is-neutral', config.tone === 'neutral');
    phraseText.textContent = expectedPhrase;
    input.placeholder = requiresPhrase ? `輸入「${expectedPhrase}」` : '';
    submit.textContent = String(config.confirmLabel || (requiresPhrase ? expectedPhrase : '確認'));
    submit.disabled = requiresPhrase;
    previousFocus = document.activeElement;
    modal.hidden = false;
    requestAnimationFrame(() => (requiresPhrase ? input : submit).focus());

    return new Promise((resolve) => { pending = resolve; });
  }

  function requestSimple(options) {
    const config = options && typeof options === 'object' ? options : {};
    return request({ ...config, requirePhrase: false, tone: config.tone || 'neutral' });
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
  window.PanelConfirm = { request: requestSimple };
})();
