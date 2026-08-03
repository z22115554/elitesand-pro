/*
 * 面板 modal 的共用鍵盤焦點管理。
 *
 * 各功能仍自行決定何時開關 hidden、預設要 focus 哪個欄位；本檔只補齊共通的
 * 初始焦點、Tab 限制與關閉後回到觸發點。這樣不會把歌詞、PIN、歌單等流程綁成同一套
 * 開關邏輯，也不會影響 /display、/setlist、/controller（它們沒有載入本檔）。
 */
(() => {
  'use strict';

  const MODAL_SELECTOR = '.modal';
  const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  const previousFocus = new WeakMap();
  let lastOutsideFocus = document.activeElement;

  function dialogFor(modal) {
    if (modal.matches('[role="dialog"][aria-modal="true"]')) return modal;
    return modal.querySelector('[role="dialog"][aria-modal="true"]');
  }

  function isVisible(element) {
    return !!(element && !element.hidden && !element.closest('[hidden]') && element.getClientRects().length);
  }

  function visibleModal() {
    return [...document.querySelectorAll(MODAL_SELECTOR)].find((modal) => !modal.hidden && dialogFor(modal));
  }

  function focusableIn(modal) {
    return [...modal.querySelectorAll(FOCUSABLE_SELECTOR)]
      .filter((element) => isVisible(element) && element.tabIndex >= 0);
  }

  function focusInitial(modal) {
    const dialog = dialogFor(modal);
    if (!dialog || dialog.contains(document.activeElement)) return;
    requestAnimationFrame(() => {
      if (modal.hidden || dialog.contains(document.activeElement)) return;
      const preferred = [...modal.querySelectorAll('[data-modal-initial-focus]')].find(isVisible);
      const target = preferred || focusableIn(modal)[0] || dialog;
      if (target === dialog && !dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
      target.focus();
    });
  }

  function opened(modal) {
    if (previousFocus.has(modal)) return;
    previousFocus.set(modal, lastOutsideFocus);
    focusInitial(modal);
  }

  function closed(modal) {
    const target = previousFocus.get(modal);
    previousFocus.delete(modal);
    if (!target || !document.contains(target)) return;
    requestAnimationFrame(() => {
      if (!visibleModal()) target.focus();
    });
  }

  document.addEventListener('focusin', (event) => {
    if (!visibleModal()) lastOutsideFocus = event.target;
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const modal = visibleModal();
    if (!modal) return;
    const targets = focusableIn(modal);
    const dialog = dialogFor(modal);
    if (!targets.length) {
      event.preventDefault();
      if (dialog && !dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
      dialog?.focus();
      return;
    }
    const first = targets[0];
    const last = targets[targets.length - 1];
    if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }, true);

  const observer = new MutationObserver((records) => {
    records.forEach((record) => {
      const modal = record.target;
      if (!modal.matches?.(MODAL_SELECTOR)) return;
      if (modal.hidden) closed(modal);
      else if (dialogFor(modal)) opened(modal);
    });
  });
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
})();
