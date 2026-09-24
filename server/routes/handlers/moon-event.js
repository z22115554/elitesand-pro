/**
 * 中秋募資活動 socket 事件。寫入只限桌面 controller；/moon 疊加層只讀，
 * 連上時由 socket-handler 主動推一份 moon:update。
 */
const moonEvent = require('../../services/moon-event');

function registerMoonEventHandlers(io, socket) {
  if (socket.clientType !== 'controller') return;

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
}

module.exports = registerMoonEventHandlers;
