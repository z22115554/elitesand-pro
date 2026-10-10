/**
 * Elitesand Pro — 說明頁搜尋（2026-10-04 說明頁 v2）
 *
 * 比對五種語言（I18n.searchText）：英文介面打中文也找得到。命中的問答自動展開；
 * 搜尋時把上方的檢查／最短路徑／清單區塊收起來（用 class，不碰 nav.js 自己管理的 hidden）。
 */
(function () {
  'use strict';

  const input = document.getElementById('help-search');
  const empty = document.getElementById('help-search-empty');
  const body = input && input.closest('.help-body');
  if (!input || !body) return;

  const items = () => Array.from(body.querySelectorAll('.help-faq-item, .help-map-row'));
  const textOf = (node) => (window.I18n && typeof window.I18n.searchText === 'function'
    ? window.I18n.searchText(node)
    : node.textContent).toLowerCase();
  const wasOpen = new WeakMap();

  function apply() {
    const q = input.value.trim().toLowerCase();
    let hits = 0;
    items().forEach((node) => {
      const hit = !q || textOf(node).includes(q);
      node.hidden = !hit;
      if (hit) hits += 1;
      if (node.tagName !== 'DETAILS') return;
      if (q && hit) {
        if (!wasOpen.has(node)) wasOpen.set(node, node.open);
        node.open = true;
      } else if (!q && wasOpen.has(node)) {
        node.open = wasOpen.get(node);
        wasOpen.delete(node);
      }
    });
    body.querySelectorAll('.help-block').forEach((block) => {
      block.hidden = !!q && !block.querySelector('.help-faq-item:not([hidden]), .help-map-row:not([hidden])');
    });
    body.classList.toggle('is-help-searching', !!q);
    if (empty) empty.hidden = !(q && hits === 0);
  }

  input.addEventListener('input', apply);
  window.addEventListener('i18n:change', apply);
})();
