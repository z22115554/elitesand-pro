/**
 * 萬聖節活動 socket 事件。募資（halloween:*）走 handlers/seasonal-event.js 共用邏輯；
 * 觀眾互動（halloween:fx:*、halloween:raffle:*）只給桌面 controller，資料在
 * services/halloween-interactions.js。活動結束後互動事件一律回 inactive。
 */
const halloweenEvent = require('../../services/halloween-event');
const { createSeasonalEventHandlers } = require('./seasonal-event');

const registerSeasonal = createSeasonalEventHandlers({ prefix: 'halloween', service: halloweenEvent, endedError: '萬聖節活動已結束' });

const FX_EVENTS = ['halloween:fx:get', 'halloween:fx:settings', 'halloween:fx:reset', 'halloween:raffle:draw', 'halloween:raffle:clear'];
// 魔女的大鍋（services/halloween-cauldron.js）：設定、熬煮、點數票、Twitch 兌換項目。
const CAULDRON_EVENTS = ['halloween:cauldron:get', 'halloween:cauldron:settings', 'halloween:cauldron:brew',
  'halloween:cauldron:reset', 'halloween:cauldron:potion', 'halloween:cauldron:clear-votes', 'halloween:cauldron:sync',
  'halloween:cauldron:remove-rewards'];

function registerHalloweenEventHandlers(io, socket, { getInteractions, getCauldron } = {}) {
  registerSeasonal(io, socket);
  if (socket.clientType !== 'controller') return;

  const fx = () => (halloweenEvent.isActive() && typeof getInteractions === 'function' ? getInteractions() : null);
  const cauldron = () => (halloweenEvent.isActive() && typeof getCauldron === 'function' ? getCauldron() : null);
  const respond = (ack, result) => { if (typeof ack === 'function') ack(result); };
  const inactive = { ok: false, inactive: true, error: '萬聖節活動已結束' };

  for (const event of CAULDRON_EVENTS) {
    socket.on(event, async (data, ack) => {
      const service = cauldron();
      if (!service) { respond(ack, inactive); return; }
      try {
        let result;
        if (event === 'halloween:cauldron:get') result = { ok: true, state: service.snapshot() };
        else if (event === 'halloween:cauldron:settings') result = await service.setSettings(data);
        else if (event === 'halloween:cauldron:brew') result = service.brew();
        else if (event === 'halloween:cauldron:reset') result = service.resetBrew();
        else if (event === 'halloween:cauldron:potion') result = service.setPotionHidden(data?.hidden === true);
        else if (event === 'halloween:cauldron:clear-votes') result = service.clearVotes();
        else if (event === 'halloween:cauldron:sync') { const sync = await service.syncRewards(); result = { ...sync, state: service.snapshot() }; }
        else result = await service.removeRewards();
        // 其他開著的面板一起更新（halloween:update 由服務自己廣播）。
        if (result.state && event !== 'halloween:cauldron:get') io.emit('halloween:cauldron:update', result.state);
        respond(ack, result);
      } catch (err) {
        respond(ack, { ok: false, error: err.message || '操作失敗' });
      }
    });
  }

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
