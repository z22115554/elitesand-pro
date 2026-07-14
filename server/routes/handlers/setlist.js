/**
 * 直播 Session / Setlist socket 事件
 *
 * 涵蓋：開台/收台/重設、setlist 資料查詢、主題/版型/外觀設定、示範資料轉播。
 */

const { createLogger } = require('../../utils/logger');
// 歌單外觀（setlistStyle）預設值 + 驗證邊界的單一事實來源，client 端也讀同一份定義
// （public/js/setlist-style-schema.js，UMD 包裝可同時被 Node require 與瀏覽器 <script> 使用）
const setlistStyleSchema = require('../../../public/js/setlist-style-schema');

const log = createLogger('Socket');

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 * @param {ReturnType<import('../../state/app-state').createAppState>} ctx
 */
function registerSetlistHandlers(io, socket, ctx) {
  const {
    playState, session, SETLIST_SCENE, effSetlistStore,
    persistState, setlistPayload, emitSetlist, recordSessionSong, broadcastState,
  } = ctx;

  socket.on('session:start', ({ source, startedAt } = {}) => {
    const fromObs = source === 'obs';
    const obsStartedAt = Number(startedAt);
    const validObsTime = Number.isFinite(obsStartedAt)
      && obsStartedAt > 0
      && obsStartedAt <= Date.now() + 5000;
    const effectiveStartedAt = fromObs && validObsTime ? obsStartedAt : Date.now();

    // OBS 健康檢查／斷線重連時會再次回報目前正在推流；同一場直播只能初始化一次，
    // 否則重連會把已唱歌單清空。保留既有歌曲與已取得的精確起點。
    if (fromObs && session.active && session.startedAt
      && Math.abs(session.startedAt - effectiveStartedAt) < 15000) {
      return;
    }
    session.active = true;
    session.startedAt = effectiveStartedAt;
    session.songs = [];
    log.info(fromObs ? 'OBS 推流：直播 session 自動開始' : '直播 session 開始');
    // 開台前若已在播放某首，立刻把它記為第一首（offset≈0）→ 不必重點一次歌。
    if (playState.isPlaying && playState.currentTrack) recordSessionSong();
    emitSetlist();
    broadcastState();
    persistState();
  });

  socket.on('session:stop', () => {
    session.active = false;
    log.info('直播 session 結束');
    emitSetlist();
    broadcastState();
    persistState();
  });

  socket.on('session:reset', () => {
    session.active = false;
    session.startedAt = null;
    session.songs = [];
    log.info('直播 session 重設');
    emitSetlist();
    broadcastState();
    persistState();
  });

  socket.on('setlist:get', (_data, ack) => {
    const data = setlistPayload();
    if (typeof ack === 'function') ack(data);
    else socket.emit('setlist:update', data);
  });

  socket.on('setlist:theme', ({ theme } = {}) => {
    const valid = ['glass', 'neon', 'minimal'];
    playState.setlistTheme = valid.includes(theme) ? theme : 'glass';
    io.emit('setlist:theme', { theme: playState.setlistTheme });
    persistState();
  });

  socket.on('setlist:layout', ({ layout } = {}) => {
    const valid = ['classic', 'simple', 'timeline', 'diagonal', 'constellation', 'terminal', 'billboard', 'cards'];
    playState.setlistLayout = valid.includes(layout) ? layout : 'classic';
    io.emit('setlist:layout', { layout: playState.setlistLayout });
    // 連同該版型「生效的那一份」設定推給顯示端，切版型即套對應外觀
    const tgt = SETLIST_SCENE.includes(playState.setlistLayout) ? playState.setlistLayout : 'shared';
    io.emit('setlist:style', { target: tgt, style: { ...effSetlistStore(playState.setlistLayout) } });
    persistState();
  });

  socket.on('setlist:style', (style = {}) => {
    if (!style || typeof style !== 'object') return;
    // 決定寫到哪一份：場景版各自一份，其餘 'shared'
    const target = SETLIST_SCENE.includes(style.target) ? style.target : 'shared';
    const s = target === 'shared' ? playState.setlistStyle : playState.setlistSceneStyles[target];

    // 型別/邊界驗證：單一事實來源見 public/js/setlist-style-schema.js
    // （數值 clamp 到 min~max、enum 限定合法值、color/string 需為字串、boolean 轉型；
    //  不合法的欄位直接忽略，不寫入、不影響其他欄位——比舊版「壞數字退回 0 再 clamp」更安全）。
    setlistStyleSchema.validateAndApply(style, s);

    io.emit('setlist:style', { target, style: { ...s } });
    persistState();
  });

  // 示範資料（面板「載入示範資料」按鈕）：純轉播給所有 /setlist 端（面板內預覽 iframe
  // ＋真實 OBS 瀏覽器來源），不寫入 playState、不 persistState——只是暫時性的畫面展示，
  // 讓使用者調外觀設定時不必真的開台也能看到效果。清除時同樣純轉播，接收端各自回頭
  // 用 setlist:get 拿真實資料還原。
  socket.on('setlist:demo', (data) => {
    if (!data || typeof data !== 'object') return;
    io.emit('setlist:demo', data);
  });

  socket.on('setlist:demo-clear', () => {
    io.emit('setlist:demo-clear');
  });
}

module.exports = registerSetlistHandlers;
