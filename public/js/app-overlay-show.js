/**
 * 面板「觀眾演出」設定：點歌明信片與揪團感謝的開關、秒數、位置與試播。
 * 設定以伺服器為準（overlay-show-settings.json），這裡不存 localStorage（鐵則 4）。
 */
(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const card = el('overlay-show-card');
  if (!card || typeof SocketClient === 'undefined') return;

  const fields = {
    raidEnabled: el('overlay-show-raid-enabled'),
    raidMin: el('overlay-show-raid-min'),
    raidSeconds: el('overlay-show-raid-seconds'),
    raidStyle: el('overlay-show-raid-style'),
    postcardSeconds: el('overlay-show-postcard-seconds'),
    postcardStyle: el('overlay-show-postcard-style'),
    anchor: el('overlay-show-anchor'),
  };

  function toast(message, type) {
    if (window.AppShared && typeof window.AppShared.showToast === 'function') window.AppShared.showToast(message, type);
  }

  function render(settings) {
    if (!settings) return;
    if (fields.raidEnabled) fields.raidEnabled.checked = !!settings.raid?.enabled;
    if (fields.raidMin && document.activeElement !== fields.raidMin) fields.raidMin.value = settings.raid?.minViewers ?? 1;
    if (fields.raidSeconds && document.activeElement !== fields.raidSeconds) fields.raidSeconds.value = settings.raid?.durationSec ?? 7;
    if (fields.postcardSeconds && document.activeElement !== fields.postcardSeconds) fields.postcardSeconds.value = settings.postcard?.durationSec ?? 10;
    if (fields.postcardStyle) fields.postcardStyle.value = settings.postcard?.style || 'paper';
    if (fields.raidStyle) fields.raidStyle.value = settings.raid?.style || 'gold';
    if (fields.anchor) fields.anchor.value = settings.anchor || 'top-right';
  }

  function collect() {
    return {
      anchor: fields.anchor ? fields.anchor.value : undefined,
      raid: {
        enabled: !!fields.raidEnabled?.checked,
        minViewers: Number(fields.raidMin?.value),
        durationSec: Number(fields.raidSeconds?.value),
        style: fields.raidStyle ? fields.raidStyle.value : undefined,
      },
      postcard: {
        durationSec: Number(fields.postcardSeconds?.value),
        style: fields.postcardStyle ? fields.postcardStyle.value : undefined,
      },
    };
  }

  function save() {
    SocketClient.sendWithCallback('overlay-show:settings:update', collect(), (result) => {
      if (!result?.ok) { toast(result?.error || t('overlayShow.saveFailed'), 'error'); return; }
      render(result.settings); // 伺服器夾過範圍後的值才是真值
    });
  }

  function load() {
    SocketClient.sendWithCallback('overlay-show:settings:get', {}, (result) => {
      if (result?.ok) render(result.settings);
    });
  }

  Object.values(fields).forEach((field) => field && field.addEventListener('change', save));

  function test(kind) {
    SocketClient.sendWithCallback('overlay-show:test', { kind }, (result) => {
      if (!result?.ok) toast(result?.error || t('overlayShow.testFailed'), 'error');
    });
  }
  el('overlay-show-test-postcard')?.addEventListener('click', () => test('postcard'));
  el('overlay-show-test-raid')?.addEventListener('click', () => test('raid'));
  el('overlay-show-skip')?.addEventListener('click', () => SocketClient.sendWithCallback('overlay-show:skip', {}, () => {}));

  SocketClient.on('overlay-show:settings', render);
  SocketClient.on('connection-change', (connected) => { if (connected) load(); });
  load();
})();
