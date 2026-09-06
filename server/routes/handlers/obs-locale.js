/**
 * OBS 疊加層顯示語言 socket 事件
 *
 * 為什麼需要這條線：語言在每個頁面是「載入當下解析一次」（?lang= → localStorage →
 * 瀏覽器語言）。OBS 是獨立的 CEF 瀏覽器 profile，讀不到面板的 localStorage，也沒有
 * 任何管道知道面板換語言了——所以中途換語言時 /display、/setlist 會卡在舊語言，
 * 直到使用者重新複製網址、重整來源為止。這裡補上那條缺的傳輸線。
 *
 * 只送專屬事件、不碰 broadcastState()（鐵則 5：整包 state:sync 會讓 OBS 重跑入場動畫）。
 * 這個 handler 只註冊給非唯讀連線：display/setlist 送 obs-locale:* 會被
 * socket-handler 的 READ_ONLY_EVENTS 白名單擋掉，OBS 端無法自己改語言。
 */

const { createLogger } = require('../../utils/logger');
const obsLocale = require('../../utils/obs-locale');

const log = createLogger('Socket');

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 * @param {ReturnType<import('../../state/app-state').createAppState>} ctx
 */
function registerObsLocaleHandlers(io, socket, ctx) {
  const { playState, persistState } = ctx;

  function broadcast() {
    io.emit('obs-locale:update', {
      mode: playState.obsLocale,
      panelLocale: playState.panelLocale,
      locale: obsLocale.effectiveLocale(playState.obsLocale, playState.panelLocale),
    });
  }

  // 面板選單：'follow' 或固定語言代碼。
  socket.on('obs-locale:set', ({ mode } = {}) => {
    const next = obsLocale.normalizeMode(mode);
    if (next !== mode) log.warn(`obs-locale:set 收到未知模式（${mode}），退回 ${next}`);
    if (next === playState.obsLocale) return;
    playState.obsLocale = next;
    broadcast();
    persistState();
  });

  // 面板介面語言變了。mode 若不是 follow，OBS 端不受影響——但仍要記下來，
  // 之後使用者把選單切回「跟隨面板」時才有正確的值可用。
  socket.on('obs-locale:panel', ({ locale } = {}) => {
    const next = obsLocale.normalizeLocale(locale);
    if (next === playState.panelLocale) return;
    playState.panelLocale = next;
    if (playState.obsLocale === obsLocale.FOLLOW) broadcast();
    persistState();
  });
}

module.exports = registerObsLocaleHandlers;
