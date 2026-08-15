(function () {
  'use strict';

  const card = document.getElementById('lyric-offset-sync-card');
  const toggle = document.getElementById('lyric-offset-sync-enabled');
  const status = document.getElementById('lyric-offset-sync-status');
  if (!card || !toggle || !status) return;

  const t = (key) => (window.I18n ? window.I18n.t(key) : key);
  let state = null;

  function render(key) {
    status.textContent = t(key || (toggle.checked ? 'system.lyricOffsetSyncEnabled' : 'system.lyricOffsetSyncDisabled'));
  }

  async function load() {
    toggle.disabled = true;
    try {
      const response = await fetch('/api/lyric-offset-sync/settings', { cache: 'no-store' });
      const data = await response.json();
      state = data;
      toggle.checked = !!data.enabled;
      toggle.disabled = !data.available;
      render(data.available ? null : 'system.lyricOffsetSyncUnavailable');
    } catch (_) {
      toggle.disabled = true;
      render('system.lyricOffsetSyncUnavailable');
    }
  }

  toggle.addEventListener('change', async () => {
    const previous = state ? !!state.enabled : !toggle.checked;
    toggle.disabled = true;
    render('system.lyricOffsetSyncSaving');
    try {
      const response = await PinAuth.fetchWithPin('/api/lyric-offset-sync/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: toggle.checked }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || !data.ok) throw new Error('save failed');
      state = data.settings;
      toggle.checked = !!state.enabled;
      render();
    } catch (_) {
      toggle.checked = previous;
      render('system.lyricOffsetSyncSaveFailed');
    } finally {
      toggle.disabled = !(state && state.available);
    }
  });

  window.addEventListener('i18n:change', () => {
    if (toggle.disabled && (!state || !state.available)) render('system.lyricOffsetSyncUnavailable');
    else render();
  });

  load();
})();
