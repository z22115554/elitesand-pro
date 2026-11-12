/**
 * OBS 互動演出（點歌明信片、揪團感謝）：只有桌面面板能讀寫設定、試播、略過。
 * 手機遙控器與 OBS 客戶端都不該能改動，也不該能觸發演出。
 */
'use strict';

const { toSupportEvent } = require('../../services/twitch-service');

const DISPLAY_CLIENT_TYPES = new Set(['display', 'display-preview', 'display-spout']);

/**
 * OBS 顯示端一連上就給它目前的設定：有開全畫面演出的話，先把舞台與角色圖載好，第一次演出才不會慢半拍。
 * 顯示端是唯讀連線，registerOverlayShowHandlers 不會為它註冊，所以這支由 socket-handler 在唯讀檢查之外呼叫。
 * 只送出設定內容（開關、門檻、音量、角色圖），不給它任何修改或觸發的事件。
 */
function sendSettingsToDisplay(socket, service) {
  if (!service || !DISPLAY_CLIENT_TYPES.has(socket.clientType)) return false;
  socket.emit('overlay-show:settings', service.getSettings());
  return true;
}

/**
 * 模擬事件：照 Twitch EventSub 的欄位名稱組出通知內容。
 * gift 一次送多份是 community_sub_gift；一份是沒有 community_gift_id 的 sub_gift（指定送給某人）。
 */
function buildSimulatedEvent(payload) {
  const src = payload && typeof payload === 'object' ? payload : {};
  const name = typeof src.name === 'string' && src.name.trim() ? src.name.slice(0, 60) : 'TestViewer';
  const count = Math.max(1, Math.min(100000, Math.floor(Number(src.count) || 1)));
  const base = { chatter_user_name: name, chatter_user_login: name.toLowerCase(), chatter_is_anonymous: false };
  switch (src.type) {
    case 'sub': return { notification: { ...base, notice_type: 'sub', sub: { sub_tier: '1000', is_prime: false } } };
    case 'resub': return { notification: { ...base, notice_type: 'resub', resub: { cumulative_months: 6, sub_tier: '1000' } } };
    case 'gift':
    case 'gift-anon': {
      const who = src.type === 'gift-anon' ? { chatter_user_name: 'AnAnonymousGifter', chatter_user_login: 'ananonymousgifter', chatter_is_anonymous: true } : base;
      if (count === 1) return { notification: { ...who, notice_type: 'sub_gift', sub_gift: { recipient_user_name: 'Lucky', sub_tier: '1000', community_gift_id: null } } };
      return { notification: { ...who, notice_type: 'community_sub_gift', community_sub_gift: { id: 'sim', total: count, sub_tier: '1000' } } };
    }
    case 'raid': return { raid: { from_broadcaster_user_name: name, viewers: count } };
    default: return null;
  }
}

function registerOverlayShowHandlers(io, socket, { getOverlayShow }) {
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

  socket.on('overlay-show:status:get', (payload, ack) => {
    const service = getOverlayShow();
    reply(ack, service ? { ok: true, status: service.status() } : { ok: false });
  });

  socket.on('overlay-show:waiting:release', (payload, ack) => {
    const service = getOverlayShow();
    if (service) service.releaseWaiting();
    reply(ack, { ok: !!service });
  });

  socket.on('overlay-show:waiting:clear', (payload, ack) => {
    const service = getOverlayShow();
    if (service) service.clearWaiting();
    reply(ack, { ok: !!service });
  });

  // 模擬 Twitch 事件：做成跟 EventSub 一樣的通知內容，走同一個轉換（toSupportEvent）與同一套規則
  // （開關、門檻、唱歌時等待、名字清洗）。跟「試播」不同：試播不管規則、一定馬上演。
  socket.on('overlay-show:simulate', (payload, ack) => {
    const service = getOverlayShow();
    if (!service) { reply(ack, { ok: false, error: '互動演出服務尚未啟動' }); return; }
    const event = buildSimulatedEvent(payload);
    if (!event) { reply(ack, { ok: false, error: '不認得的模擬事件' }); return; }
    const eventId = `sim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (event.raid) {
      reply(ack, { ...service.handleRaid({ eventId, fromName: event.raid.from_broadcaster_user_name, viewers: event.raid.viewers }), simulated: true });
      return;
    }
    const support = toSupportEvent(event.notification, eventId);
    if (!support) { reply(ack, { ok: false, reason: 'ignored', simulated: true }); return; }
    reply(ack, { ...service.handleSupport(support), simulated: true });
  });

  socket.on('overlay-show:skip', (payload, ack) => {
    const service = getOverlayShow();
    if (service) service.skip();
    reply(ack, { ok: !!service });
  });
}

module.exports = registerOverlayShowHandlers;
module.exports.sendSettingsToDisplay = sendSettingsToDisplay;
module.exports.buildSimulatedEvent = buildSimulatedEvent;
