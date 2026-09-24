/**
 * 中秋募資活動 socket 事件。寫入只限桌面 controller；/moon 疊加層只讀，
 * 連上時由 socket-handler 主動推一份 moon:update（活動已結束則推 moon:ended）。
 * 活動是否結束只在伺服器啟動時判斷一次（見 services/moon-event.js）。
 */
const moonEvent = require('../../services/moon-event');

const MOON_EVENTS = ['moon:config', 'moon:donate', 'moon:remove', 'moon:clear', 'moon:credits', 'moon:celebrate'];

function registerMoonEventHandlers(io, socket) {
  if (socket.clientType !== 'controller') return;

  if (!moonEvent.isActive()) {
    socket.on('moon:get', (_data, ack) => {
      if (typeof ack === 'function') ack({ ok: false, inactive: true });
    });
    for (const event of MOON_EVENTS) {
      socket.on(event, (_data, ack) => {
        if (typeof ack === 'function') ack({ ok: false, inactive: true, error: '中秋活動已結束' });
      });
    }
    return;
  }

  function reply(ack, result) {
    if (result.ok) io.emit('moon:update', result.state);
    if (typeof ack === 'function') ack(result.ok ? { ok: true, state: result.state } : result);
  }

  socket.on('moon:get', (_data, ack) => {
    if (typeof ack === 'function') ack({ ok: true, state: moonEvent.snapshot() });
  });
  socket.on('moon:config', (data, ack) => reply(ack, moonEvent.setConfig(data)));
  socket.on('moon:donate', (data, ack) => reply(ack, moonEvent.addDonation(data)));
  socket.on('moon:remove', (data, ack) => reply(ack, moonEvent.removeDonation(String(data?.id || ''))));
  socket.on('moon:clear', (_data, ack) => reply(ack, moonEvent.clearDonations()));
  // 謝幕名單：純轉播觸發訊號，不寫 state、不持久化。
  socket.on('moon:credits', (_data, ack) => {
    io.emit('moon:credits', { at: Date.now() });
    if (typeof ack === 'function') ack({ ok: true });
  });
  // 手動重播滿月慶祝：同樣純轉播（達標當下的自動慶祝由疊加層自己偵測）。
  socket.on('moon:celebrate', (_data, ack) => {
    io.emit('moon:celebrate', { at: Date.now() });
    if (typeof ack === 'function') ack({ ok: true });
  });
}

module.exports = registerMoonEventHandlers;
