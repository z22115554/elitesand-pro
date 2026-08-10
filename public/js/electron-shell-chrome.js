'use strict';

// Only the Electron shell opts into the frameless app chrome. Browser and OBS
// sessions keep their existing layout with no extra title strip.
const shellQuery = new URLSearchParams(window.location.search);
if (shellQuery.get('electronShell') === '1') {
  document.documentElement.classList.add('electron-shell');

  // electron/shell.js appends ?lang= exactly once, straight from the marker
  // electron/installer.nsh left behind for the language picked in the
  // install wizard. I18n's own query-param handling already makes this the
  // first screen's language, but resolveLocale() does not persist a
  // query-sourced value — without this, the very next normal launch (no
  // ?lang= anymore) would fall back to the OS/browser locale and could
  // silently revert. setLocale() persists it so it sticks. This script runs
  // in <head>, before i18n.js (near the end of body) has assigned
  // window.I18n, so the call has to wait for DOMContentLoaded.
  const installerLang = shellQuery.get('lang');
  if (installerLang) {
    window.addEventListener('DOMContentLoaded', () => {
      window.I18n?.setLocale?.(installerLang);
    });
  }
}

const shell = window.ElitesandShell;
if (shell?.windowControl) {
  window.addEventListener('DOMContentLoaded', () => {
    const minimize = document.getElementById('electron-window-minimize');
    const maximize = document.getElementById('electron-window-maximize');
    const close = document.getElementById('electron-window-close');
    if (!minimize || !maximize || !close) return;

    let lastIsMaximized = false;
    const translate = (key, fallback) => window.I18n?.t(key) || fallback;
    const updateMaximizeButton = (isMaximized) => {
      lastIsMaximized = Boolean(isMaximized);
      maximize.classList.toggle('is-maximized', lastIsMaximized);
      maximize.setAttribute('aria-label', lastIsMaximized
        ? translate('window.restore', '還原視窗')
        : translate('window.maximize', '最大化'));
    };
    minimize.addEventListener('click', () => shell.windowControl('minimize'));
    maximize.addEventListener('click', () => shell.windowControl('toggle-maximize'));
    close.addEventListener('click', () => shell.windowControl('close'));
    shell.onWindowMaximized?.(updateMaximizeButton);
    window.addEventListener('i18n:change', () => updateMaximizeButton(lastIsMaximized));
  });
}

if (shell?.onCloseRequested && shell?.decideClose) {
  window.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('electron-close-modal');
    const cancel = document.getElementById('electron-close-cancel');
    const toTray = document.getElementById('electron-close-to-tray');
    const quit = document.getElementById('electron-close-quit');
    if (!modal || !cancel || !toTray || !quit) return;

    // 取消＝什麼都不做：關窗事件已在殼端 preventDefault，通知殼放棄本次關閉即可。
    const dismiss = () => {
      modal.hidden = true;
      shell.decideClose('cancel');
    };
    shell.onCloseRequested(() => {
      modal.hidden = false;
      cancel.focus();
    });
    cancel.addEventListener('click', dismiss);
    modal.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    });
    toTray.addEventListener('click', () => {
      modal.hidden = true;
      shell.decideClose('tray');
    });
    quit.addEventListener('click', () => {
      modal.hidden = true;
      shell.decideClose('quit');
    });
  });
}
