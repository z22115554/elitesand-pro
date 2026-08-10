(function () {
  'use strict';

  const card = document.getElementById('usage-telemetry-card');
  const toggle = document.getElementById('usage-telemetry-enabled');
  const status = document.getElementById('usage-telemetry-status');
  if (!card || !toggle || !status) return;

  const t = (key) => (window.I18n ? window.I18n.t(key) : key);
  let state = null;

  function render(key) {
    status.textContent = t(key || (toggle.checked ? 'system.usageEnabled' : 'system.usageDisabled'));
  }

  async function load() {
    toggle.disabled = true;
    try {
      const response = await fetch('/api/usage/settings', { cache: 'no-store' });
      const data = await response.json();
      state = data;
      toggle.checked = !!data.enabled;
      toggle.disabled = !data.available;
      render(data.available ? null : 'system.usageUnavailable');
    } catch (_) {
      toggle.disabled = true;
      render('system.usageUnavailable');
    }
  }

  toggle.addEventListener('change', async () => {
    const previous = state ? !!state.enabled : !toggle.checked;
    toggle.disabled = true;
    render('system.usageSaving');
    try {
      const response = await PinAuth.fetchWithPin('/api/usage/settings', {
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
      render('system.usageSaveFailed');
    } finally {
      toggle.disabled = !(state && state.available);
    }
  });

  window.addEventListener('i18n:change', () => {
    if (toggle.disabled && (!state || !state.available)) render('system.usageUnavailable');
    else render();
  });

  load();
})();
