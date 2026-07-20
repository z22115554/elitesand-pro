'use strict';

// Only the Electron shell opts into the frameless app chrome. Browser and OBS
// sessions keep their existing layout with no extra title strip.
if (new URLSearchParams(window.location.search).get('electronShell') === '1') {
  document.documentElement.classList.add('electron-shell');
}

const shell = window.ElitesandShell;
if (shell?.windowControl) {
  window.addEventListener('DOMContentLoaded', () => {
    const minimize = document.getElementById('electron-window-minimize');
    const maximize = document.getElementById('electron-window-maximize');
    const close = document.getElementById('electron-window-close');
    if (!minimize || !maximize || !close) return;

    const updateMaximizeButton = (isMaximized) => {
      maximize.classList.toggle('is-maximized', Boolean(isMaximized));
      maximize.setAttribute('aria-label', isMaximized ? '還原視窗' : '最大化');
    };
    minimize.addEventListener('click', () => shell.windowControl('minimize'));
    maximize.addEventListener('click', () => shell.windowControl('toggle-maximize'));
    close.addEventListener('click', () => shell.windowControl('close'));
    shell.onWindowMaximized?.(updateMaximizeButton);
  });
}

if (shell?.onCloseRequested && shell?.decideClose) {
  window.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('electron-close-modal');
    const toTray = document.getElementById('electron-close-to-tray');
    const quit = document.getElementById('electron-close-quit');
    if (!modal || !toTray || !quit) return;

    shell.onCloseRequested(() => {
      modal.hidden = false;
      toTray.focus();
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
