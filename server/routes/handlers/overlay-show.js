/**
 * OBS 互動演出（點歌明信片、揪團感謝）：只有桌面面板能讀寫設定、試播、略過。
 * 手機遙控器與 OBS 客戶端都不該能改動，也不該能觸發演出。
 */
'use strict';

function registerOverlayShowHandlers(io, socket, { getOverlayShow }) {
  // OBS 顯示端一連上就給它目前的設定：有開全畫面演出的話，先把舞台載好，第一次演出才不會慢半拍。
  // 只送出設定內容（開關、門檻、音量），不給它任何修改或觸發的事件。
  if (socket.clientType === 'display' || socket.clientType === 'display-preview' || socket.clientType === 'display-spout') {
    const service = getOverlayShow();
    if (service) socket.emit('overlay-show:settings', service.getSettings());
    return;
  }
  if (socket.clientType !== 'controller') return;

  const reply = (ack, body) => { if (typeof ack === 'function') ack(body); };

  socket.on('overlay-show:settings:get', (payload, ack) => {
    const service = getOverlayShow();
    reply(ack, service ? { ok: true, settings: service.getSettings() } : { ok: false, error: '互動演出服務尚未啟動' });
  });

  socket.on('overlay-show:settings:update', (payload, ack) => {
    const service = getOverlayShow();
    if (!service) { reply(ack, { ok: false, error: '互動演出服務尚未啟動' }); return; }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) { reply(ack, { ok: false, error: '設定格式無效' }); return; }
    reply(ack, { ok: true, settings: service.updateSettings(payload) });
  });

  socket.on('overlay-show:test', (payload, ack) => {
    const service = getOverlayShow();
    if (!service) { reply(ack, { ok: false, error: '互動演出服務尚未啟動' }); return; }
    const kind = payload && payload.kind;
    if (kind !== 'postcard' && kind !== 'raid' && kind !== 'alert') { reply(ack, { ok: false, error: '不認得的演出類型' }); return; }
    const options = kind === 'alert'
      ? { tier: payload.tier, variant: payload.variant, count: payload.count, name: typeof payload.name === 'string' ? payload.name : '' }
      : {};
    reply(ack, service.test(kind, options) ? { ok: true } : { ok: false, error: '演出佇列已滿，請稍後再試' });
  });

  socket.on('overlay-show:skip', (payload, ack) => {
    const service = getOverlayShow();
    if (service) service.skip();
    reply(ack, { ok: !!service });
  });
}

module.exports = registerOverlayShowHandlers;
