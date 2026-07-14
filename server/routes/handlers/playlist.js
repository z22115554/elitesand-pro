/**
 * 播放清單 socket 事件：增刪改排序 + JSON 匯出匯入。
 */

const { createLogger } = require('../../utils/logger');
const playlistExportStore = require('../../services/playlist-export-store');
const libraryStore = require('../../services/library-store');
const { sanitizePlaylist, MAX_PLAYLIST_SIZE } = require('../../utils/track-schema');

const log = createLogger('Socket');

/**
 * 播放清單改名（或任何 title/artist 變動）同步回媒體庫，讓兩邊名稱一致。
 * updateMeta 只更新「已存在」的記錄，不會無中生有；只在名稱真的不同時才寫，避免無謂存檔。
 */
function syncNamesToLibrary(tracks) {
  for (const track of tracks) {
    if (!track || !track.id) continue;
    const entry = libraryStore.getEntry(track.id);
    if (!entry) continue;
    const artist = track.artist || '';
    if (entry.title !== track.title || (entry.artist || '') !== artist || entry.performer !== track.performer) {
      libraryStore.updateMeta(track.id, { title: track.title, artist, performer: track.performer || '',
        needsArtistConfirmation: !artist, artistConfidence: artist ? 1 : (track.artistConfidence || 0) });
    }
  }
}

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 * @param {ReturnType<import('../../state/app-state').createAppState>} ctx
 */
function registerPlaylistHandlers(io, socket, ctx) {
  const {
    playState, trackOffsets, manualLyricsCache,
    persistState, emitSetlist, broadcastState,
  } = ctx;

  socket.on('playlist:update', (playlist, ack) => {
    const clean = sanitizePlaylist(playlist);
    if (!clean) { log.warn('playlist:update 收到非陣列資料'); if (typeof ack === 'function') ack({ ok: false, error: '播放清單格式無效' }); return; }
    playState.playlist = clean;
    syncNamesToLibrary(clean);
    io.emit('playlist:update', clean);
    emitSetlist(); // 未唱清單跟著清單變動更新
    broadcastState();
    persistState();
    if (typeof ack === 'function') ack({ ok: true, playlist: clean });
  });

  socket.on('playlist:add', (tracks) => {
    const clean = sanitizePlaylist(tracks);
    if (!clean) return log.warn('playlist:add 收到非陣列資料');
    playState.playlist.push(...clean.slice(0, Math.max(0, MAX_PLAYLIST_SIZE - playState.playlist.length)));
    io.emit('playlist:update', playState.playlist);
    emitSetlist();
    broadcastState();
    persistState();
  });

  socket.on('playlist:remove', (trackId) => {
    playState.playlist = playState.playlist.filter((t) => t.id !== trackId);
    // 同時清除對應的 offset 和手動歌詞
    trackOffsets.delete(trackId);
    manualLyricsCache.delete(trackId);
    io.emit('playlist:update', playState.playlist);
    emitSetlist();
    broadcastState();
    persistState();
  });

  socket.on('playlist:reorder', (playlist) => {
    const clean = sanitizePlaylist(playlist);
    if (!clean) return log.warn('playlist:reorder 收到非陣列資料');
    playState.playlist = clean;
    io.emit('playlist:update', clean);
    emitSetlist();
    broadcastState();
    persistState();
  });

  function buildExportData() {
    return {
      version: '5.0',
      timestamp: Date.now(),
      playlist: playState.playlist.map(track => ({
        ...track,
        offset: trackOffsets.get(track.id) || 0,
        manualLyrics: manualLyricsCache.has(track.id)
          ? manualLyricsCache.get(track.id)
          : null,
      })),
      currentTrackIndex: playState.playlist.findIndex(
        t => playState.currentTrack && t.id === playState.currentTrack.id
      ),
      style: playState.style,
      romanizationMode: playState.romanizationMode,
    };
  }

  // 匯出播放清單為 JSON（回傳給前端自行下載存檔）
  // 注意：前端用 SocketClient.sendWithCallback('playlist:export', null, cb) 呼叫，
  // 等於 socket.emit('playlist:export', null, ackFn)——會送兩個參數，callback（ack）
  // 是「第二個」參數，不是第一個。之前這裡只宣告一個參數會把 callback 誤綁到 null，
  // 導致 ack 永遠沒被呼叫、前端 sendWithCallback 的回呼永遠不會觸發（匯出按鈕「沒反應」）。
  socket.on('playlist:export', (_data, callback) => {
    const exportData = buildExportData();
    log.info('播放清單匯出');
    if (typeof callback === 'function') {
      callback(exportData);
    } else {
      socket.emit('playlist:exported', exportData);
    }
  });

  // ─── 匯出/匯入改走伺服器固定資料夾（使用者要求：不跳系統檔案總管）───
  // 匯出：App 內跳「取名」小視窗，確認後存進 data/playlist-exports/，不經瀏覽器下載。
  // 匯入：App 內跳「選擇清單」，直接列出這個資料夾裡有什麼，不跳系統「開啟檔案」視窗。

  // 存一份具名的匯出檔到伺服器固定資料夾
  socket.on('playlist:export-save', (name, callback) => {
    try {
      const filename = playlistExportStore.save(name, buildExportData());
      if (typeof callback === 'function') callback({ ok: true, filename });
    } catch (e) {
      log.warn(`playlist:export-save 失敗: ${e.message}`);
      if (typeof callback === 'function') callback({ ok: false, error: e.message });
    }
  });

  // 列出伺服器固定資料夾裡所有已匯出的播放清單
  socket.on('playlist:export-list', (_data, callback) => {
    const files = playlistExportStore.list();
    if (typeof callback === 'function') callback(files);
  });

  // 讀取指定的匯出檔內容（供選擇後直接匯入）
  socket.on('playlist:export-load', (filename, callback) => {
    const data = playlistExportStore.load(filename);
    if (typeof callback === 'function') callback(data);
  });

  // 匯入播放清單
  socket.on('playlist:import', (data, ack) => {
    if (!data || !Array.isArray(data.playlist)) {
      log.warn('playlist:import 收到無效的資料格式');
      if (typeof ack === 'function') ack({ ok: false, error: '無效的播放清單格式' }); return;
    }

    // 驗證播放清單長度上限（500 首）
    if (data.playlist.length > MAX_PLAYLIST_SIZE) {
      log.warn(`playlist:import 播放清單過大: ${data.playlist.length} 首 (上限 ${MAX_PLAYLIST_SIZE})`);
      if (typeof ack === 'function') ack({ ok: false, error: `播放清單超過 ${MAX_PLAYLIST_SIZE} 首上限` }); return;
    }

    const clean = sanitizePlaylist(data.playlist);
    if (!clean) { if (typeof ack === 'function') ack({ ok: false, error: '播放清單內容無效' }); return; }
    playState.playlist = clean;

    // 恢復 offset 和手動歌詞
    for (const track of clean) {
      if (track.offset) {
        trackOffsets.set(track.id, track.offset);
      }
      if (track.manualLyrics) {
        manualLyricsCache.set(track.id, track.manualLyrics);
      }
    }

    // 恢復風格設定
    if (data.style) playState.style = data.style;
    if (data.romanizationMode) playState.romanizationMode = data.romanizationMode;

    io.emit('playlist:update', playState.playlist);
    broadcastState();
    persistState();
    log.info(`播放清單匯入完成: ${playState.playlist.length} 首`);
    if (typeof ack === 'function') ack({ ok: true, playlist: playState.playlist });
  });
}

module.exports = registerPlaylistHandlers;
