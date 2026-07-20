'use strict';

// Only the Electron shell opts into the frameless app chrome. Browser and OBS
// sessions keep their existing layout with no extra title strip.
if (new URLSearchParams(window.location.search).get('electronShell') === '1') {
  document.documentElement.classList.add('electron-shell');
}

const shell = window.ElitesandShell;
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
