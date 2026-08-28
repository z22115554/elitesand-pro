/* 首頁「準備工作」分頁切換（重構 Stage 1）
 *
 * 純前端 UI：只切 .prep-panel 的 hidden 與 .prep-tab 的 is-active／aria-selected。
 * 不碰 app-state、不發 socket、不動任何被移進 panel 的既有元件（它們的 id 與事件綁定
 * 完全不變，仍由各自的 app-*.js 處理）。跟 Twitch 管理頁的 pane 切換是同一種模式。
 */
(function () {
  'use strict';

  var root = document.querySelector('.kara-prep');
  if (!root) return;

  var tabs = Array.prototype.slice.call(root.querySelectorAll('.prep-tab'));
  var panels = Array.prototype.slice.call(root.querySelectorAll('.prep-panel'));
  if (!tabs.length || !panels.length) return;

  function activate(name) {
    tabs.forEach(function (tab) {
      var on = tab.getAttribute('data-prep-tab') === name;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panels.forEach(function (panel) {
      var on = panel.getAttribute('data-prep-panel') === name;
      panel.hidden = !on;
    });
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      activate(tab.getAttribute('data-prep-tab'));
    });
  });

  // 讓 nav.js 的「跳到教學目標」等流程可以指定要開哪一頁：
  // window.HomePrepTabs.show('add' | 'sync' | 'audio' | 'obs' | 'session')
  window.HomePrepTabs = { show: activate };
})();
