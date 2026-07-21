const TwitchReplySettings = require('../../../public/js/twitch-reply-settings');
const TwitchRequestSettings = require('../../../public/js/twitch-request-settings');
const { createLogger } = require('../../utils/logger');

const log = createLogger('TwitchSocket');

/**
 * Twitch 控制事件只掛給桌面 controller。手機遙控器與 OBS 客戶端都不能修改回覆設定，
 * 也不能替桌面面板回報下載結果。
 */
function registerTwitchHandlers(io, socket, ctx, { getTwitchService }) {
  if (socket.clientType !== 'controller') return;

  socket.on('twitch:song-request:result', async (result, ack) => {
    const twitchService = getTwitchService();
    if (!twitchService) {
      if (typeof ack === 'function') ack({ ok: false, error: '目前無法處理 Twitch 點歌結果' });
      return;
    }
    try {
      await twitchService.completeSongRequest(result);
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      log.error(`回報 Twitch 點歌結果失敗: ${err.message}`);
      if (typeof ack === 'function') ack({ ok: false, error: '無法回覆 Twitch 聊天室，請稍後重試' });
    }
  });

  socket.on('twitch:reply-settings:update', (incoming, ack) => {
    const validation = TwitchReplySettings.validateSettings(incoming);
    if (!validation.ok) {
      if (typeof ack === 'function') ack({ ok: false, error: validation.errors[0]?.message || 'Twitch 回覆設定格式無效' });
      return;
    }
    ctx.playState.twitchReplySettings = validation.settings;
    const twitchService = getTwitchService();
    if (twitchService) twitchService.setReplySettings(validation.settings);
    io.emit('twitch:reply-settings:update', validation.settings);
    ctx.persistState((result) => {
      if (typeof ack === 'function') ack(result?.ok === false ? result : { ok: true, settings: validation.settings });
    });
  });

  socket.on('twitch:request-settings:update', (incoming, ack) => {
    const validation = TwitchRequestSettings.validateSettings(incoming);
    if (!validation.ok) {
      if (typeof ack === 'function') ack({ ok: false, error: validation.errors[0]?.message || 'Twitch 點歌設定格式無效' });
      return;
    }
    ctx.playState.twitchRequestSettings = validation.settings;
    const twitchService = getTwitchService();
    if (twitchService) twitchService.setRequestSettings(validation.settings);
    io.emit('twitch:request-settings:update', validation.settings);
    ctx.persistState((result) => {
      if (typeof ack === 'function') ack(result?.ok === false ? result : { ok: true, settings: validation.settings });
    });
  });

  socket.on('twitch:reply-settings:test', async (payload, ack) => {
    const validation = TwitchReplySettings.validateSettings(payload?.settings);
    const replyKey = typeof payload?.replyKey === 'string' ? payload.replyKey : '';
    const knownReply = TwitchReplySettings.REPLY_DEFINITIONS.some((definition) => definition.key === replyKey);
    if (!validation.ok || !knownReply) {
      if (typeof ack === 'function') ack({
        ok: false,
        error: validation.errors[0]?.message || '找不到要測試的 Twitch 回覆項目',
      });
      return;
    }
    const twitchService = getTwitchService();
    if (!twitchService) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Twitch 服務尚未啟用' });
      return;
    }
    try {
      const result = await twitchService.sendReplyTest(validation.settings, replyKey);
      if (typeof ack === 'function') ack({ ok: true, ...result });
    } catch (err) {
      log.warn(`Twitch 回覆測試未送出: ${err.message}`);
      if (typeof ack === 'function') ack({ ok: false, error: err.message || 'Twitch 測試訊息未送出' });
    }
  });
}

module.exports = registerTwitchHandlers;
