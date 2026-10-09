/**
 * 萬聖節活動 socket 事件。募資（halloween:*）走 handlers/seasonal-event.js 共用邏輯；
 * 觀眾互動（halloween:fx:*、halloween:raffle:*）只給桌面 controller，資料在
 * services/halloween-interactions.js。活動結束後互動事件一律回 inactive。
 */
const halloweenEvent = require('../../services/halloween-event');
const { createSeasonalEventHandlers } = require('./seasonal-event');

const registerSeasonal = createSeasonalEventHandlers({ prefix: 'halloween', service: halloweenEvent, endedError: '萬聖節活動已結束' });

const FX_EVENTS = ['halloween:fx:get', 'halloween:fx:settings', 'halloween:fx:reset', 'halloween:raffle:draw', 'halloween:raffle:clear'];

function registerHalloweenEventHandlers(io, socket, { getInteractions } = {}) {
  registerSeasonal(io, socket);
  if (socket.clientType !== 'controller') return;

  const fx = () => (halloweenEvent.isActive() && typeof getInteractions === 'function' ? getInteractions() : null);
  const respond = (ack, result) => { if (typeof ack === 'function') ack(result); };
  const inactive = { ok: false, inactive: true, error: '萬聖節活動已結束' };

  for (const event of FX_EVENTS) {
    socket.on(event, async (data, ack) => {
      const service = fx();
      if (!service) { respond(ack, inactive); return; }
      try {
        let result;
        if (event === 'halloween:fx:get') result = { ok: true, state: service.snapshot() };
        else if (event === 'halloween:fx:settings') result = await service.setSettings(data);
        else if (event === 'halloween:fx:reset') result = service.resetBoard();
        else if (event === 'halloween:raffle:draw') result = service.drawRaffle(data || {});
        else result = service.clearWinners();
        // 設定、排行、得主變動要讓其他開著的面板一起更新。
        if (result.ok && event !== 'halloween:fx:get') io.emit('halloween:fx:update', result.state);
        respond(ack, result);
      } catch (err) {
        respond(ack, { ok: false, error: err.message || '操作失敗' });
      }
    });
  }
}

module.exports = registerHalloweenEventHandlers;
