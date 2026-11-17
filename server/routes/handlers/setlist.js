/**
 * 直播 Session / Setlist socket 事件
 *
 * 涵蓋：開台/收台/重設、setlist 資料查詢、主題/版型/外觀設定、示範資料轉播。
 */

const { createLogger } = require('../../utils/logger');
const { SETLIST_LAYOUTS } = require('../../state/app-state');
// 歌單外觀（setlistStyle）預設值 + 驗證邊界的單一事實來源，client 端也讀同一份定義
// （public/js/setlist-style-schema.js，UMD 包裝可同時被 Node require 與瀏覽器 <script> 使用）
const setlistStyleSchema = require('../../../public/js/setlist-style-schema');

const log = createLogger('Socket');

// 同一場直播的開台時間容差（OBS 推流計時與 Twitch started_at 會差幾秒），跟 startTwitchSession 一致。
const SAME_STREAM_TOLERANCE_MS = 60000;

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 * @param {ReturnType<import('../../state/app-state').createAppState>} ctx
 */
function registerSetlistHandlers(io, socket, ctx) {
  const {
    playState, session, effSetlistStore,
    persistState, setlistPayload, emitSetlist, recordSessionSong, markTrackPlayed, broadcastState,
  } = ctx;

  function normalizeSessionSource(source) {
    return ['obs', 'twitch', 'manual'].includes(source) ? source : 'manual';
  }

  function resetPlayedHistory({ preserveCurrent = false } = {}) {
    playState.playedEntryIds.clear();
    playState.lastPlayedEntryId = null;
    if (preserveCurrent && playState.currentTrack && playState.currentTrackStarted) {
      markTrackPlayed(playState.currentTrack);
    }
  }

  function emitTemplateStyle(target) {
    const style = { ...effSetlistStore(target) };
    io.emit('setlist:style', { target, style });
    // 過渡期照顧快取中的舊 OBS 頁面：它們只認 shared；新版會優先套 target。
    if (target !== 'shared') io.emit('setlist:style', { target: 'shared', style });
  }

  socket.on('session:start', ({ source, startedAt } = {}) => {
    const sessionSource = normalizeSessionSource(source);
    const fromObs = sessionSource === 'obs';
    const obsStartedAt = Number(startedAt);
    const validObsTime = Number.isFinite(obsStartedAt)
      && obsStartedAt > 0
      && obsStartedAt <= Date.now() + 5000;
    const effectiveStartedAt = fromObs && validObsTime ? obsStartedAt : Date.now();

    // OBS 健康檢查／斷線重連時會再次回報目前正在推流；同一場直播只能初始化一次，
    // 否則重連會把已唱歌單清空。保留既有歌曲與已取得的精確起點。
    // 「同一場直播」看開台時間，不看是誰開的：同時連了 OBS 與 Twitch 時，Twitch 開台事件會把
    // source 改成 twitch，之後 OBS WebSocket 一重連就回報推流中——只比 source 的話會被當成新的一場，
    // 已唱歌單整個清空（Twitch 那邊重連時又反過來清一次）。兩邊回報的開台時間差幾秒，給 60 秒容差。
    const sameStream = fromObs && session.startedAt
      && Math.abs(session.startedAt - effectiveStartedAt) < SAME_STREAM_TOLERANCE_MS;
    if (sameStream && session.active) {
      return;
    }
    // 直播開到一半才手動按開台（或 Twitch 先開），之後才連上 OBS：OBS 說推流比目前這場 Session
    // 更早就開始了，代表目前這場就是這次直播的一部分——改用 OBS 的開台時間、把已唱歌曲的時間點
    // 一起往後挪，不清空。（比 Session 晚開始的推流才是真正的新一場，照舊重來。）
    if (fromObs && session.active && session.startedAt && effectiveStartedAt < session.startedAt) {
      const shift = session.startedAt - effectiveStartedAt;
      session.songs = session.songs.map((song) => (song && Number.isFinite(song.offset) ? { ...song, offset: song.offset + shift } : song));
      session.startedAt = effectiveStartedAt;
      session.source = sessionSource;
      log.info('OBS 推流比目前的直播 Session 更早開始：沿用同一場、改用 OBS 的開台時間');
      emitSetlist();
      broadcastState();
      persistState();
      return;
    }
    // 同一場直播被誤收台後又回報推流中（OBS 查詢逾時、WebSocket 重連、斷線重推）：
    // 開台時間對得上就是同一場，接回原本的 Session，不可把已唱歌單清空。
    if (sameStream && !session.active) {
      session.active = true;
      session.source = sessionSource;
      log.info('OBS 推流：同一場直播的 Session 已接回（保留已唱歌單）');
      if (playState.isPlaying && playState.currentTrack) recordSessionSong();
      emitSetlist();
      broadcastState();
      persistState();
      return;
    }
    session.active = true;
    session.startedAt = effectiveStartedAt;
    session.source = sessionSource;
    session.songs = [];
    // playedEntryIds 是 setlist「已唱／未唱」真正使用的持久化進度。只清 session.songs
    // 會讓上一場甚至解除安裝前的已唱狀態在新直播繼續殘留。新場次必須一起歸零；若
    // 開台前已經在播歌，保留目前這一首為 current/played，避免它又跑回 upcoming。
    resetPlayedHistory({ preserveCurrent: true });
    log.info(fromObs ? 'OBS 推流：直播 session 自動開始' : '直播 session 開始');
    // 開台前若已在播放某首，立刻把它記為第一首（offset≈0）→ 不必重點一次歌。
    if (playState.isPlaying && playState.currentTrack) recordSessionSong();
    emitSetlist();
    broadcastState();
    persistState();
    // 已唱歌單走到這裡已經自動歸零；播放清單還留著上一場的歌時，讓面板問一次要不要
    // 順便清空。只在真的是新場次（通過上面的重連去重判斷）才問，避免斷線重連狂跳窗。
    if (playState.playlist.length > 0) {
      io.emit('session:new-start', { startedAt: effectiveStartedAt, source: sessionSource });
    }
  });

  socket.on('session:stop', ({ source } = {}) => {
    const sessionSource = ['obs', 'twitch', 'manual'].includes(source) ? source : null;
    // OBS 與 Twitch 都可能回報「未直播」。只能停止自己建立的 Session；
    // 來源未知的舊版資料則可由第一個權威回報安全收掉。
    if (sessionSource && session.source && session.source !== sessionSource) return;
    session.active = false;
    session.source = null;
    log.info('直播 session 結束');
    emitSetlist();
    broadcastState();
    persistState();
  });

  socket.on('session:reset', () => {
    session.active = false;
    session.startedAt = null;
    session.source = null;
    session.songs = [];
    // 「重設直播」就是使用者可預期的清除入口；同步清除 setlist 真正依賴的持久化
    // 播放進度，否則畫面雖然 songs=[]，已唱欄位仍會從 playedEntryIds 立刻長回來。
    resetPlayedHistory();
    log.info('直播 session 重設（已清除已唱進度）');
    emitSetlist();
    broadcastState();
    persistState();
  });

  // 已唱歌單單獨刪一筆——不用整場清空。常見情境：點錯歌被誤記進已唱、切歌太快連點兩次。
  // 用 entryId 定位（不能用 id：同一首歌可能在這場唱兩次，id 會重複，刪錯會刪到另一筆）。
  socket.on('session:remove-song', ({ entryId } = {}) => {
    if (typeof entryId !== 'string' || !entryId) return;
    const idx = session.songs.findIndex((s) => s && s.entryId === entryId);
    if (idx === -1) return;
    const [removed] = session.songs.splice(idx, 1);
    // 「點錯歌被誤記進已唱」刪掉之後，這首應該回到接下來／未唱；只刪 session.songs 的話，
    // playedEntryIds 仍把它當成唱過，OBS 歌單的「接下來」跟面板清單的已唱標記都不會回來。
    // 同一列在這場被唱過不只一次（還有別筆紀錄指向它）時，保留已唱。
    const rowEntryId = typeof removed.playlistEntryId === 'string' ? removed.playlistEntryId : '';
    const stillRecorded = rowEntryId && session.songs.some((s) => s && s.playlistEntryId === rowEntryId);
    const progressChanged = !!rowEntryId && !stillRecorded && playState.playedEntryIds.delete(rowEntryId);
    log.info(`已唱歌單移除單筆：${removed.title || removed.id}`);
    emitSetlist();
    if (progressChanged) broadcastState();
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
    const valid = SETLIST_LAYOUTS;
    playState.setlistLayout = valid.includes(layout) ? layout : 'classic';
    io.emit('setlist:layout', { layout: playState.setlistLayout });
    // 連同該版型「生效的那一份」設定推給顯示端，切版型即套對應外觀
    emitTemplateStyle(playState.setlistLayout);
    persistState();
  });

  socket.on('setlist:style', (style = {}, ack) => {
    if (!style || typeof style !== 'object') return;
    // 每個模板只寫回自己的快照；未知 target 安全退回 classic。
    const target = SETLIST_LAYOUTS.includes(style.target) ? style.target : 'classic';
    const s = effSetlistStore(target);

    // 型別/邊界驗證：單一事實來源見 public/js/setlist-style-schema.js
    // （數值 clamp 到 min~max、enum 限定合法值、color/string 需為字串、boolean 轉型；
    //  不合法的欄位直接忽略，不寫入、不影響其他欄位——比舊版「壞數字退回 0 再 clamp」更安全）。
    setlistStyleSchema.validateAndApply(style, s);

    emitTemplateStyle(target);
    persistState((result) => {
      if (typeof ack === 'function') ack(result);
    });
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
