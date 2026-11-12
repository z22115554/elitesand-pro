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
    raidMode: el('overlay-show-raid-mode'),
    postcardSeconds: el('overlay-show-postcard-seconds'),
    postcardStyle: el('overlay-show-postcard-style'),
    raidAnchor: el('overlay-show-raid-anchor'),
    postcardAnchor: el('overlay-show-postcard-anchor'),
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
    if (fields.raidAnchor) fields.raidAnchor.value = settings.raid?.anchor || 'top-right';
    if (fields.raidMode) fields.raidMode.value = settings.raid?.mode === 'show' ? 'show' : 'card';
    syncRaidMode();
    if (fields.postcardAnchor) fields.postcardAnchor.value = settings.postcard?.anchor || 'top-right';
  }

  /** 全畫面演出不吃小卡的外觀、位置、秒數：選了就把那三欄收起來，免得以為調了有用。 */
  function syncRaidMode() {
    const show = fields.raidMode && fields.raidMode.value === 'show';
    card.querySelectorAll('[data-raid-card-only]').forEach((node) => { node.hidden = !!show; });
  }

  function collect() {
    return {
      raid: {
        enabled: !!fields.raidEnabled?.checked,
        minViewers: Number(fields.raidMin?.value),
        durationSec: Number(fields.raidSeconds?.value),
        style: fields.raidStyle ? fields.raidStyle.value : undefined,
        anchor: fields.raidAnchor ? fields.raidAnchor.value : undefined,
        mode: fields.raidMode ? fields.raidMode.value : undefined,
      },
      postcard: {
        durationSec: Number(fields.postcardSeconds?.value),
        style: fields.postcardStyle ? fields.postcardStyle.value : undefined,
        anchor: fields.postcardAnchor ? fields.postcardAnchor.value : undefined,
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
  fields.raidMode?.addEventListener('change', syncRaidMode);

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
