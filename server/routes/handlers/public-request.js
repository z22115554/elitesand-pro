/**
 * 公開點歌頁：面板端控制事件（啟用／停用／重新產生連結／選擇公開歌單／核准／拒絕）。
 *
 * 跟 handlers/twitch.js 一樣只掛給桌面 controller：手機遙控器與 OBS 客戶端都不需要、
 * 也不應該能改動這裡的設定或核准觀眾的點歌請求。
 */
const { createLogger } = require('../../utils/logger');
const { insertTracksIntoPlaylist } = require('./playlist');

const log = createLogger('PublicRequestSocket');

function registerPublicRequestHandlers(io, socket, ctx, { getRelayService }) {
  if (socket.clientType !== 'controller') return;

  socket.on('public-request:status', (payload, ack) => {
    const service = getRelayService();
    if (typeof ack === 'function') ack(service ? { ok: true, status: service.getStatus() } : { ok: false, error: '公開點歌頁服務尚未啟動' });
  });

  socket.on('public-request:enable', async (payload, ack) => {
    const service = getRelayService();
    if (!service) { if (typeof ack === 'function') ack({ ok: false, error: '公開點歌頁服務尚未啟動' }); return; }
    try {
      const result = await service.enable();
      if (typeof ack === 'function') ack(result);
    } catch (err) {
      log.warn(`公開點歌頁啟用失敗：${err.message}`);
      if (typeof ack === 'function') ack({ ok: false, error: '公開點歌頁啟用失敗' });
    }
  });

  socket.on('public-request:disable', (payload, ack) => {
    const service = getRelayService();
    if (!service) { if (typeof ack === 'function') ack({ ok: false, error: '公開點歌頁服務尚未啟動' }); return; }
    if (typeof ack === 'function') ack(service.disable());
  });

  socket.on('public-request:rotate-link', async (payload, ack) => {
    const service = getRelayService();
    if (!service) { if (typeof ack === 'function') ack({ ok: false, error: '公開點歌頁服務尚未啟動' }); return; }
    try {
      const result = await service.rotateLink();
      if (typeof ack === 'function') ack(result);
    } catch (err) {
      log.warn(`公開點歌頁重新產生連結失敗：${err.message}`);
      if (typeof ack === 'function') ack({ ok: false, error: '重新產生連結失敗' });
    }
  });

  socket.on('public-request:set-catalog', (payload, ack) => {
    const service = getRelayService();
    if (!service) { if (typeof ack === 'function') ack({ ok: false, error: '公開點歌頁服務尚未啟動' }); return; }
    const result = service.setCatalogPlaylistId(payload?.playlistId);
    if (typeof ack === 'function') ack(result);
  });

  socket.on('public-request:list', (payload, ack) => {
    const service = getRelayService();
    if (typeof ack === 'function') ack({ ok: true, requests: service ? service.getPendingRequests() : [] });
  });

  socket.on('public-request:approve', (payload, ack) => {
    const service = getRelayService();
    if (!service) { if (typeof ack === 'function') ack({ ok: false, error: '公開點歌頁服務尚未啟動' }); return; }
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId : '';
    const mode = payload?.placement === 'next' ? 'insert-next' : 'add';
    const approved = service.approve(requestId);
    if (!approved.ok) { if (typeof ack === 'function') ack(approved); return; }
    const result = insertTracksIntoPlaylist(ctx, io, [approved.track], { mode });
    // 核准不是「先刪請求再碰碰運氣」：播放清單滿了、資料驗證失敗等最後一步
    // 拒絕加入時，請求要回到待核准清單，讓主播可以先整理清單再重試。
    if (!result.ok && typeof service.restorePendingRequest === 'function') {
      service.restorePendingRequest(approved.request);
    }
    if (typeof ack === 'function') ack(result);
  });

  socket.on('public-request:reject', (payload, ack) => {
    const service = getRelayService();
    if (!service) { if (typeof ack === 'function') ack({ ok: false, error: '公開點歌頁服務尚未啟動' }); return; }
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId : '';
    if (typeof ack === 'function') ack(service.reject(requestId));
  });
}

module.exports = registerPublicRequestHandlers;
