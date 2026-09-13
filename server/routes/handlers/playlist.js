/**
 * 播放清單 socket 事件：增刪改排序 + JSON 匯出匯入。
 */

const { createLogger } = require('../../utils/logger');
const { emitToAccessRooms } = require('../../utils/socket-broadcast');
const playlistExportStore = require('../../services/playlist-export-store');
const libraryStore = require('../../services/library-store');
const lyricOffsetSync = require('../../services/lyric-offset-sync');
const { sanitizePlaylist, MAX_PLAYLIST_SIZE, assignFreshEntryIds, ensureEntryIds } = require('../../utils/track-schema');

const log = createLogger('Socket');

// 與 handlers/playback.js 的 romanization:mode 同一份白名單。
const VALID_ROMANIZATION_MODES = ['original', 'romanized', 'both', 'xieyin', 'full'];

/**
 * 新加入清單、本機還沒有這首歌校正記憶時，去問一次社群建議的偏移值當預設。
 * 使用者自己調過（trackOffsets 已有記錄）的一律不覆蓋；查詢期間使用者也可能自己調了，
 * 拿到回應時要再檢查一次同一個條件，避免用舊建議蓋掉使用者剛做的調整。
 */
async function applyCommunityOffsetSuggestion(ctx, io, track) {
  if (!track || !track.id || ctx.trackOffsets.has(track.id)) return;
  const result = await lyricOffsetSync.getSuggestedOffset(track.id).catch(() => null);
  if (!result || typeof result.suggestedOffsetMs !== 'number' || ctx.trackOffsets.has(track.id)) return;
  ctx.trackOffsets.set(track.id, result.suggestedOffsetMs);
  if (ctx.playState.currentTrack && ctx.playState.currentTrack.id === track.id) {
    ctx.playState.currentOffset = result.suggestedOffsetMs;
  }
  io.emit('offset:update', { trackId: track.id, offset: result.suggestedOffsetMs });
  ctx.persistState();
}

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

// playlist:update 是「排序＋面板允許的名稱編輯」契約，不是完整 Track PUT。
// 2000 首同步已改成窄摘要，因此回寫時要以 server 完整 track 為基底，否則 sanitizeTrack()
// 對摘要缺欄位補的 null/default 會洗掉音檔、AI stems、歌詞、LUFS 等權威資料。
function mergePlaylistSummaryWithExisting(cleanPlaylist, previousPlaylist) {
  const previousByEntryId = new Map();
  const previousById = new Map();
  for (const track of previousPlaylist) {
    if (!track) continue;
    if (track.entryId) previousByEntryId.set(track.entryId, track);
    if (track.id && !previousById.has(track.id)) previousById.set(track.id, track);
  }
  return cleanPlaylist.map((track) => {
    const previous = (track.entryId && previousByEntryId.get(track.entryId)) || previousById.get(track.id);
    if (!previous) return track;
    const artistChanged = (track.artist || '') !== (previous.artist || '');
    return {
      ...previous,
      // 這些是目前 UI 明確允許透過 playlist:update 改動的欄位。
      entryId: track.entryId || previous.entryId,
      title: track.title,
      artist: track.artist,
      performer: track.performer || '',
      // sanitizeTrack() 對精簡摘要缺少的欄位會補預設值；單純拖曳排序時不可因此
      // 把既有歌手判定的信心值洗回 0。只有使用者真的改了 artist 才重算這兩欄。
      needsArtistConfirmation: artistChanged ? !track.artist : previous.needsArtistConfirmation,
      artistConfidence: artistChanged ? (track.artist ? 1 : 0) : previous.artistConfidence,
    };
  });
}

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 * @param {ReturnType<import('../../state/app-state').createAppState>} ctx
 */
function registerPlaylistHandlers(io, socket, ctx) {
  const {
    playState, trackOffsets, manualLyricsCache,
    persistState, emitSetlist, broadcastState, getPublicPlaylist, getReadOnlyPlaylist = () => [], reconcilePlaybackProgress,
  } = ctx;

  function emitPlaylistUpdate() {
    emitToAccessRooms(io, 'playlist:update', getPublicPlaylist(), getReadOnlyPlaylist());
  }

  socket.on('playlist:update', (playlist, ack) => {
    const clean = sanitizePlaylist(playlist);
    if (!clean) { log.warn('playlist:update 收到非陣列資料'); if (typeof ack === 'function') ack({ ok: false, error: '播放清單格式無效' }); return; }
    const preserved = ensureEntryIds(mergePlaylistSummaryWithExisting(clean, playState.playlist));
    playState.playlist = preserved;
    if (typeof reconcilePlaybackProgress === 'function') reconcilePlaybackProgress();
    syncNamesToLibrary(preserved);
    emitPlaylistUpdate();
    emitSetlist(); // 未唱清單跟著清單變動更新
    broadcastState();
    persistState();
    if (typeof ack === 'function') ack({ ok: true, playlist: preserved });
  });

  socket.on('playlist:add', (tracks, ack) => {
    const clean = sanitizePlaylist(tracks);
    if (!clean) {
      log.warn('playlist:add 收到非陣列資料');
      if (typeof ack === 'function') ack({ ok: false, error: '播放清單格式無效' });
      return;
    }
    const added = assignFreshEntryIds(clean.slice(0, Math.max(0, MAX_PLAYLIST_SIZE - playState.playlist.length)));
    if (added.length === 0) {
      if (typeof ack === 'function') ack({ ok: false, error: `播放清單已達 ${MAX_PLAYLIST_SIZE} 首上限` });
      return;
    }
    playState.playlist.push(...added);
    emitPlaylistUpdate();
    emitSetlist();
    broadcastState();
    persistState();
    if (typeof ack === 'function') ack({ ok: true, added: added.length, tracks: added });
    added.forEach((track) => {
      applyCommunityOffsetSuggestion(ctx, io, track)
        .catch((error) => log.warn(`歌詞偏移建議值套用失敗：${error.message}`));
    });
  });

  // 直播中的 Twitch 點歌需要以伺服器的正式播放狀態判定「下一首」，不能相信
  // 任一控制端可能已落後的本機索引。沒有目前歌曲時，安全地退回清單尾端。
  socket.on('playlist:insert-next', (track, ack) => {
    const clean = sanitizePlaylist([track]);
    if (!clean?.length) {
      if (typeof ack === 'function') ack({ ok: false, error: '歌曲資料無效，無法插播' });
      return;
    }
    if (playState.playlist.length >= MAX_PLAYLIST_SIZE) {
      if (typeof ack === 'function') ack({ ok: false, error: `播放清單已達 ${MAX_PLAYLIST_SIZE} 首上限` });
      return;
    }

    let currentIndex = playState.playlist.indexOf(playState.currentTrack);
    if (currentIndex < 0 && playState.currentTrack?.entryId) {
      currentIndex = playState.playlist.findIndex((item) => item.entryId === playState.currentTrack.entryId);
    }
    if (currentIndex < 0 && playState.currentTrack?.id) {
      // 沒有 entryId 的舊資料才退回用歌曲 id 找（重複歌曲時可能找到錯的那一列，僅供相容）。
      currentIndex = playState.playlist.findIndex((item) => item.id === playState.currentTrack.id);
    }
    const insertAt = currentIndex >= 0 ? currentIndex + 1 : playState.playlist.length;
    const [insertedTrack] = assignFreshEntryIds(clean);
    playState.playlist.splice(insertAt, 0, insertedTrack);
    emitPlaylistUpdate();
    emitSetlist();
    broadcastState();
    persistState();
    if (typeof ack === 'function') {
      ack({ ok: true, insertAt, placement: currentIndex >= 0 ? 'next' : 'end', track: insertedTrack });
    }
    applyCommunityOffsetSuggestion(ctx, io, insertedTrack)
      .catch((error) => log.warn(`歌詞偏移建議值套用失敗：${error.message}`));
  });

  // 目前面板不用這條（改用整份 playlist:update，見 app-playlist.js 的註解），但它仍是
  // 任何 controller/remote 都能呼叫的事件。只用 id 過濾會把「同一首歌在這場加了兩次」
  // 的兩列一起刪掉——entryId 存在的唯一理由就是分辨這種重複列（見 track-schema.js）。
  // 相容寫法：仍接受純字串 trackId（舊語意），另外接受 { entryId } 精準刪一列。
  socket.on('playlist:remove', (payload) => {
    const entryId = payload && typeof payload === 'object' ? payload.entryId : null;
    const trackId = payload && typeof payload === 'object' ? payload.trackId : payload;
    if (typeof entryId === 'string' && entryId) {
      playState.playlist = playState.playlist.filter((t) => t.entryId !== entryId);
    } else {
      playState.playlist = playState.playlist.filter((t) => t.id !== trackId);
    }
    if (typeof reconcilePlaybackProgress === 'function') reconcilePlaybackProgress();
    // 從播放清單移除不等於刪除歌曲記憶。offset / 手動歌詞仍以 track.id
    // 保留在 state.json，日後從媒體庫或重新匯入同一首歌時自動恢復。
    // 只有使用者明確執行歌詞／同步重設時才應清除對應資料。
    emitPlaylistUpdate();
    emitSetlist();
    broadcastState();
    persistState();
  });

  socket.on('playlist:reorder', (playlist) => {
    const clean = sanitizePlaylist(playlist);
    if (!clean) return log.warn('playlist:reorder 收到非陣列資料');
    playState.playlist = ensureEntryIds(preserveLyricsFromExisting(clean, playState.playlist));
    if (typeof reconcilePlaybackProgress === 'function') reconcilePlaybackProgress();
    emitPlaylistUpdate();
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
        t => playState.currentTrack && (
          playState.currentTrack.entryId
            ? t.entryId === playState.currentTrack.entryId
            : t.id === playState.currentTrack.id
        )
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
    // 匯入整份清單一律視為全新的列（就算是重新匯入自己先前匯出的檔案），
    // 避免不同來源匯入的 entryId 剛好相同造成混淆。
    playState.playlist = assignFreshEntryIds(clean);
    if (playState.playedEntryIds instanceof Set) playState.playedEntryIds.clear();
    playState.lastPlayedEntryId = null;
    playState.currentTrack = null;
    playState.currentTrackStarted = false;
    playState.isPlaying = false;
    playState.currentTime = 0;

    // 恢復 offset 和手動歌詞
    for (const track of clean) {
      if (track.offset) {
        trackOffsets.set(track.id, track.offset);
      }
      if (track.manualLyrics) {
        manualLyricsCache.set(track.id, track.manualLyrics);
      }
    }

    // 恢復風格設定。匯入檔是使用者可自行編輯的 JSON，驗證標準必須跟 style:change／
    // romanization:mode 兩個 socket 事件一致（見 handlers/playback.js）——否則手改過的
    // 清單能把非法值寫進 playState 並廣播到顯示端，症狀是「重開程式就好」的難查 bug。
    if (typeof data.style === 'string' && data.style) playState.style = data.style;
    if (VALID_ROMANIZATION_MODES.includes(data.romanizationMode)) {
      playState.romanizationMode = data.romanizationMode;
    }

    emitPlaylistUpdate();
    emitSetlist();
    broadcastState();
    persistState();
    log.info(`播放清單匯入完成: ${playState.playlist.length} 首`);
    if (typeof ack === 'function') ack({ ok: true, playlist: playState.playlist });
  });
}

module.exports = registerPlaylistHandlers;
// 供其他 handler（如 library.js 的 savedPlaylists:load）重用：任何把新歌加進即時
// playState.playlist 的路徑，都該套上同一份「有社群偏移建議就自動帶入」邏輯，
// 不要各自重寫一份 push/broadcast/persist 而漏掉這一步。
module.exports.applyCommunityOffsetSuggestion = applyCommunityOffsetSuggestion;
