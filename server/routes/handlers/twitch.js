const TwitchReplySettings = require('../../../public/js/twitch-reply-settings');
const TwitchRequestSettings = require('../../../public/js/twitch-request-settings');
const TwitchRewardSettings = require('../../../public/js/twitch-reward-settings');
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

  socket.on('twitch:admin-action:result', async (payload, ack) => {
    const twitchService = getTwitchService();
    const actionId = typeof payload?.actionId === 'string' ? payload.actionId : '';
    if (!twitchService || !actionId || typeof payload?.ok !== 'boolean') {
      if (typeof ack === 'function') ack({ ok: false, error: '管理員操作回報格式無效' });
      return;
    }
    try {
      const accepted = await twitchService.completeAdminPanelAction({
        actionId,
        ok: payload.ok,
        error: typeof payload.error === 'string' ? payload.error.slice(0, 240) : '',
        socketId: socket.id,
      });
      if (typeof ack === 'function') ack(accepted ? { ok: true } : { ok: false, error: '這項管理員操作已逾時或不存在' });
    } catch (err) {
      log.warn(`Twitch 管理員操作回報失敗: ${err.message}`);
      if (typeof ack === 'function') ack({ ok: false, error: '無法回覆 Twitch 聊天室' });
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

  socket.on('twitch:reward-settings:update', async (incoming, ack) => {
    const validation = TwitchRewardSettings.validateSettings(incoming);
    if (!validation.ok) {
      if (typeof ack === 'function') ack({ ok: false, error: validation.errors[0]?.message || 'Twitch 忠誠點數設定格式無效' });
      return;
    }
    const twitchService = getTwitchService();
    if (!twitchService) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Twitch 服務尚未啟用' });
      return;
    }
    try {
      const settings = await twitchService.syncManagedReward(validation.settings);
      ctx.playState.twitchRewardSettings = settings;
      twitchService.setRewardSettings(settings);
      io.emit('twitch:reward-settings:update', settings);
      ctx.persistState((result) => {
        if (typeof ack === 'function') ack(result?.ok === false ? result : { ok: true, settings, status: twitchService.status() });
      });
    } catch (err) {
      log.warn(`Twitch 忠誠點數獎勵同步失敗: ${err.message}`);
      if (typeof ack === 'function') ack({
        ok: false,
        error: err.message || '無法同步 Twitch 忠誠點數獎勵',
        status: twitchService.status(),
      });
    }
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

  socket.on('twitch:custom-command:test', async (payload, ack) => {
    const validation = TwitchRequestSettings.validateSettings(payload?.settings);
    const commandId = typeof payload?.commandId === 'string' ? payload.commandId : '';
    if (!validation.ok || !/^[A-Za-z0-9_-]{1,80}$/.test(commandId)) {
      if (typeof ack === 'function') ack({ ok: false, error: validation.errors[0]?.message || '自訂指令測試資料無效' });
      return;
    }
    const twitchService = getTwitchService();
    if (!twitchService) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Twitch 服務尚未啟用' });
      return;
    }
    try {
      const result = await twitchService.sendCustomCommandTest(validation.settings, commandId);
      if (typeof ack === 'function') ack({ ok: true, ...result });
    } catch (err) {
      log.warn(`Twitch 自訂指令公開測試未送出: ${err.message}`);
      if (typeof ack === 'function') ack({ ok: false, error: err.message || '自訂指令測試訊息未送出' });
    }
  });

  socket.on('twitch:history:get', (payload, ack) => {
    const twitchService = getTwitchService();
    if (!twitchService) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Twitch 服務尚未啟用' });
      return;
    }
    const limit = Math.max(1, Math.min(200, Number.parseInt(payload?.limit, 10) || 80));
    if (typeof ack === 'function') ack({ ok: true, entries: twitchService.getRequestHistory(limit) });
  });

  socket.on('twitch:simulate', (payload, ack) => {
    const twitchService = getTwitchService();
    if (!twitchService || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
      if (typeof ack === 'function') ack({ ok: false, error: '模擬資料無效' });
      return;
    }
    try {
      if (typeof ack === 'function') ack({ ok: true, result: twitchService.simulateSongRequest(payload) });
    } catch (err) {
      log.warn(`Twitch 點歌模擬失敗: ${err.message}`);
      if (typeof ack === 'function') ack({ ok: false, error: err.message || '無法執行點歌模擬' });
    }
  });
}

module.exports = registerTwitchHandlers;
