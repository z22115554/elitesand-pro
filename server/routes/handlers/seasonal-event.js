/**
 * 限時節慶活動的 socket 事件（中秋 moon:*、萬聖節 halloween:*）。寫入只限桌面 controller；
 * 疊加層只讀，連上時由 socket-handler 主動推一份 <prefix>:update（活動已結束則推 <prefix>:ended）。
 * 活動是否結束只在伺服器啟動時判斷一次（見 services/seasonal-event.js）。
 */
function createSeasonalEventHandlers({ prefix, service, endedError }) {
  const events = ['config', 'donate', 'edit', 'remove', 'clear', 'credits', 'celebrate'].map((name) => `${prefix}:${name}`);

  return function registerSeasonalEventHandlers(io, socket) {
    if (socket.clientType !== 'controller') return;

    if (!service.isActive()) {
      socket.on(`${prefix}:get`, (_data, ack) => {
        if (typeof ack === 'function') ack({ ok: false, inactive: true });
      });
      for (const event of events) {
        socket.on(event, (_data, ack) => {
          if (typeof ack === 'function') ack({ ok: false, inactive: true, error: endedError });
        });
      }
      return;
    }

    function reply(ack, result) {
      if (result.ok) io.emit(`${prefix}:update`, result.state);
      if (typeof ack === 'function') ack(result.ok ? { ok: true, state: result.state } : result);
    }

    socket.on(`${prefix}:get`, (_data, ack) => {
      if (typeof ack === 'function') ack({ ok: true, state: service.snapshot() });
    });
    socket.on(`${prefix}:config`, (data, ack) => reply(ack, service.setConfig(data)));
    socket.on(`${prefix}:donate`, (data, ack) => reply(ack, service.addDonation(data)));
    // 事後改材料（只有帶材料的活動支援，例如萬聖節大鍋）。
    socket.on(`${prefix}:edit`, (data, ack) => reply(ack, service.updateDonation(data)));
    socket.on(`${prefix}:remove`, (data, ack) => reply(ack, service.removeDonation(String(data?.id || ''))));
    socket.on(`${prefix}:clear`, (_data, ack) => reply(ack, service.clearDonations()));
    // 謝幕名單：純轉播觸發訊號，不寫 state、不持久化。
    socket.on(`${prefix}:credits`, (_data, ack) => {
      io.emit(`${prefix}:credits`, { at: Date.now() });
      if (typeof ack === 'function') ack({ ok: true });
    });
    // 手動重播達標慶祝：同樣純轉播（達標當下的自動慶祝由疊加層自己偵測）。
    socket.on(`${prefix}:celebrate`, (_data, ack) => {
      io.emit(`${prefix}:celebrate`, { at: Date.now() });
      if (typeof ack === 'function') ack({ ok: true });
    });
  };
}

module.exports = { createSeasonalEventHandlers };
