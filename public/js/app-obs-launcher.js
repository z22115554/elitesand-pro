/**
 * OBS 啟動頁（🔬 原型）：「拖到 OBS 直接建立來源」＋來源不綁 port。
 *
 * 兩種拖法，依執行環境自動選：
 * - 桌面版（ElitesandShell 存在）：dragstart 先 preventDefault，再請主程序用 startDrag 拖出
 *   data/obs-sources/*.html 實體檔。OBS 收到 .html 檔會建「本機檔案」瀏覽器來源，那個檔
 *   自己會去找主程式在哪個 port（server/services/obs-launcher.js）。
 * - 一般瀏覽器開面板：拖不了檔案，退回拖 URL（text/uri-list），OBS 會建 URL 瀏覽器來源，
 *   port 綁死在網址裡——跟現在複製網址的做法等價，只是少貼一次。
 *
 * 檔案路徑由 /api/obs-launcher 提供，只拿來顯示與複製；拖曳時 renderer 不指定路徑，
 * 主程序只認 lyrics / setlist 兩個 kind。
 */
(function () {
  'use strict';
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const root = document.getElementById('obs-launcher');
  if (!root) return;

  const shell = window.ElitesandShell;
  const canDragFile = !!(shell && typeof shell.startObsLauncherDrag === 'function');
  const hint = document.getElementById('obs-launcher-mode-hint');
  let paths = null;

  function toast(message, type) {
    if (typeof ErrorHandler !== 'undefined' && ErrorHandler.showToast) ErrorHandler.showToast(message, type || 'info');
  }

  function targetUrl(kind) {
    // 跟 app-style-sync.js 的 buildObsUrl 同一條規則：非 loopback 才需要 Source Token。
    const url = new URL(kind === 'setlist' ? '/setlist' : '/display', window.location.origin);
    if (typeof AccessAuth !== 'undefined' && AccessAuth.sourceToken()) url.searchParams.set('source', AccessAuth.sourceToken());
    return url.toString();
  }

  function render() {
    root.hidden = !paths;
    if (!paths) return;
    const lyrics = document.getElementById('obs-launcher-path-lyrics');
    const setlist = document.getElementById('obs-launcher-path-setlist');
    if (lyrics) lyrics.textContent = paths.files?.lyrics || '';
    if (setlist) setlist.textContent = paths.files?.setlist || '';
    if (hint) {
      hint.textContent = t(canDragFile ? 'system.obsLauncherHintFile' : 'system.obsLauncherHintUrl');
      hint.dataset.i18n = canDragFile ? 'system.obsLauncherHintFile' : 'system.obsLauncherHintUrl';
    }
  }

  function refresh() {
    const request = typeof PinAuth !== 'undefined' ? PinAuth.fetchWithPin('/api/obs-launcher', { cache: 'no-store' }) : fetch('/api/obs-launcher', { cache: 'no-store' });
    return request.then((res) => (res.ok ? res.json() : null)).then((data) => {
      paths = data && data.files ? data : null;
      render();
    }).catch(() => { paths = null; render(); });
  }

  root.querySelectorAll('.obs-launcher-chip').forEach((chip) => {
    const kind = chip.dataset.launcher;
    chip.addEventListener('dragstart', (event) => {
      chip.classList.add('dragging');
      if (canDragFile) {
        // Electron：交給主程序做 OS 層級的檔案拖曳；這裡的 HTML5 drag 必須取消，否則兩個拖曳互搶。
        event.preventDefault();
        shell.startObsLauncherDrag(kind);
        setTimeout(() => chip.classList.remove('dragging'), 300);
        return;
      }
      const url = targetUrl(kind);
      try {
        event.dataTransfer.effectAllowed = 'copyLink';
        event.dataTransfer.setData('text/uri-list', url);
        event.dataTransfer.setData('text/plain', url);
      } catch (_) { /* 少數環境不允許自訂 dataTransfer，交給預設行為 */ }
    });
    chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
  });

  root.querySelectorAll('[data-launcher-copy]').forEach((button) => {
    button.addEventListener('click', () => {
      const file = paths?.files?.[button.dataset.launcherCopy];
      if (!file) return;
      navigator.clipboard.writeText(file).then(() => toast(t('system.obsLauncherCopied'), 'success')).catch(() => {
        const textarea = document.createElement('textarea');
        textarea.value = file;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        toast(t('system.obsLauncherCopied'), 'success');
      });
    });
  });

  // 桌面殼因預設 port 被占而改用備援：持續顯示一個不會自動消失的橫幅（docs/
  // ELECTRON-SHELL-SPEC.md I1 修訂），不是只在剛開面板時彈一次 toast——toast 會被錯過，
  // 而且「提示消失了」不代表「port 恢復正常了」，只代表使用者沒看到而已。用拖放建的
  // OBS 來源不受影響（自己找 port）；貼網址建的要改網址或改用拖放。
  const portFallbackBanner = document.getElementById('port-fallback-banner');
  const portFallbackBannerText = document.getElementById('port-fallback-banner-text');
  let portFallbackPollTimer = null;

  function checkPortFallback() {
    fetch('/api/health', { cache: 'no-store' }).then((res) => (res.ok ? res.json() : null)).then((health) => {
      const active = !!(health && health.portFallbackFrom && health.port);
      if (portFallbackBanner) portFallbackBanner.hidden = !active;
      if (active && portFallbackBannerText) {
        portFallbackBannerText.textContent = t('system.portFallbackNotice', { from: health.portFallbackFrom, to: health.port });
      }
    }).catch(() => { /* 探測失敗維持上一次已知狀態，不因單次網路波動就把橫幅收掉 */ });
  }

  document.addEventListener('view:change', (event) => {
    if (event.detail && event.detail.view === 'general') { refresh(); checkPortFallback(); }
  });
  window.addEventListener('i18n:change', () => { render(); checkPortFallback(); });
  refresh();
  checkPortFallback();
  // 面板可能開著跨整場直播；定期重查，備援狀態消失（例如重開機後 3000 空出來了）
  // 橫幅才會跟著收掉，不會一直顯示過期資訊。
  portFallbackPollTimer = setInterval(checkPortFallback, 60000);
  window.addEventListener('beforeunload', () => { if (portFallbackPollTimer) clearInterval(portFallbackPollTimer); });
})();
