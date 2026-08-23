// The panel never checks, downloads, or applies updates. In an Electron shell
// this button only asks the main process to show a native confirmation and,
// after consent, relaunch into the next cold-start gate.
(function () {
  'use strict';
  const button = document.getElementById('restart-update-check-btn');
  if (!button) return;
  const restart = window.ElitesandShell?.restartForUpdateCheck;
  if (typeof restart !== 'function') {
    button.hidden = true;
    return;
  }
  button.addEventListener('click', () => { void restart(); });
})();
