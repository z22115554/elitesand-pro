/**
 * 媒體庫 socket 事件：查詢/刪除/清空/即時還原/音檔清理。
 *
 * 注意：sendWithCallback → socket.emit(event, data, ack)，故 server 端收到 (data, ack)
 */

const libraryStore = require('../../services/library-store');
const savedPlaylists = require('../../services/saved-playlists');
const mediaStorage = require('../../services/media-storage');
const { emitToControlClients, emitToAccessRooms } = require('../../utils/socket-broadcast');
const { sanitizePlaylist, MAX_PLAYLIST_SIZE, assignFreshEntryIds } = require('../../utils/track-schema');
const { applyCommunityOffsetSuggestion } = require('./playlist');
const { createLogger } = require('../../utils/logger');

const log = createLogger('Socket');

/**
 * 從媒體庫紀錄組出可直接加入播放清單的 track（含記憶的歌詞/拼音/變調/AI stems）。
 * 只在音檔還在時使用；音檔不在的要走 YouTube 重抓（面板 app.js 的匯入佇列）。
 *
 * 這裡是一份手動欄位白名單，跟 sanitizeTrack() 的白名單是分開的兩份——sanitizeTrack 加了
 * 新欄位這裡沒同步，分離過的歌一經「加入清單」就會被這裡組出的 track 蓋掉，看起來像
 * 「又變回沒分離」（媒體庫紀錄其實沒事，是 playState.playlist 那份被漏掉的欄位重置了）。
 */
function buildTrackFromEntry(entry) {
  return {
    id: entry.id,
    title: entry.title,
    artist: entry.artist || '',
    performer: entry.performer || '',
    uploader: entry.uploader || '',
    isCover: entry.isCover === true,
    artistConfidence: entry.artistConfidence || 0,
    needsArtistConfirmation: entry.needsArtistConfirmation === true,
    artistCandidates: entry.artistCandidates || [],
    cover: entry.cover || null,
    duration: entry.duration || 0,
    filename: entry.filename,
    url: entry.url || null,
    source: entry.source || (entry.url ? 'youtube' : 'local'),
    lyrics: entry.lyrics || null,
    lyricsType: entry.lyricsType || 'lrc',
    parsedLyrics: Array.isArray(entry.parsedLyrics) ? entry.parsedLyrics : null,
    pitchShift: typeof entry.pitchShift === 'number' ? entry.pitchShift : 0,
    playbackRate: typeof entry.playbackRate === 'number' ? entry.playbackRate : 1.0,
    vocalsFile: entry.vocalsFile || null,
    instrumentalFile: entry.instrumentalFile || null,
    separationStatus: entry.separationStatus || 'none',
  };
}

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 * @param {ReturnType<import('../../state/app-state').createAppState>} ctx
 */
function registerLibraryHandlers(io, socket, ctx) {
  const {
    playState, persistState,
    emitSetlist = () => {}, broadcastState = () => {},
    getPublicPlaylist = () => playState.playlist, getReadOnlyPlaylist = () => [],
  } = ctx;

  // Storage locations are a desktop-shell capability. A phone remote may use
  // normal library controls, but it must never select filesystem paths.
  socket.on('library:storage:get', (_data, ack) => {
    if (typeof ack !== 'function') return;
    if (socket.clientType !== 'controller') {
      ack({ ok: false, error: 'desktop_only' });
      return;
    }
    ack({ ok: true, ...mediaStorage.status() });
  });

  socket.on('library:storage:migrate', (data, ack) => {
    const reply = (result) => { if (typeof ack === 'function') ack(result); };
    if (socket.clientType !== 'controller') {
      reply({ ok: false, error: 'desktop_only' });
      return;
    }
    if (playState.isPlaying) {
      reply({ ok: false, error: 'stop_playback_first' });
      return;
    }
    try {
      reply({ ok: true, ...mediaStorage.migrateToParent(data?.parentDir) });
    } catch (error) {
      reply({ ok: false, error: 'migration_failed', message: error.message });
    }
  });

  socket.on('library:get', (_data, ack) => {
    const list = libraryStore.getLibrarySummary();
    if (typeof ack === 'function') ack(list); else socket.emit('library:list', list);
  });

  socket.on('library:remove', (id, ack) => {
    const removed = libraryStore.remove(id);
    // playlist 可能仍引用這首歌。library 移除後立刻排程 state，讓它改存完整 fallback，
    // 必須早於 library 的 2s debounce 真正把 entry 從磁碟移除。
    if (removed) {
      persistState();
      if (savedPlaylists.pruneTrackIds([id])) broadcastSavedPlaylists();
    }
    emitToControlClients(io, 'library:list', libraryStore.getLibrarySummary());
    if (typeof ack === 'function') ack({ ok: removed, error: removed ? null : '找不到媒體庫項目' });
  });

  socket.on('library:clear', (_data, ack) => {
    const cleared = libraryStore.clear();
    if (cleared) {
      persistState();
      if (savedPlaylists.pruneTrackIds(null)) broadcastSavedPlaylists();
    }
    emitToControlClients(io, 'library:list', libraryStore.getLibrarySummary());
    if (typeof ack === 'function') ack({ ok: cleared, error: cleared ? null : '無法安全保存目前播放清單，媒體庫未清空' });
  });

  // 從媒體庫即時還原一首歌：本機音檔還在就直接組 track 回傳（含記憶的歌詞/拼音/諧音/變調，
  // 零下載、零重新羅馬化）；音檔不在才回 needsDownload 讓前端走 YouTube 重抓。
  socket.on('library:reimport', (id, ack) => {
    const reply = (r) => { if (typeof ack === 'function') ack(r); };
    const entry = libraryStore.getEntry(id);
    if (!entry) { reply({ error: 'not_found' }); return; }

    if (entry.filename && libraryStore.audioExists(entry.filename)) {
      const track = buildTrackFromEntry(entry);
      reply({ track });
    } else if (entry.url) {
      reply({ needsDownload: true, url: entry.url });
    } else {
      reply({ error: 'no_audio_no_url' });
    }
  });

  socket.on('library:cleanupAudio', (_data, ack) => {
    // 一首歌可能同時引用原檔／人聲／伴奏三個實體資產。播放清單、待命/播放中的
    // currentTrack，以及仍在分離中的來源都不可被 cleanup 刪掉。
    const keep = libraryStore.getProcessingMediaFilenames();
    for (const track of playState.playlist) libraryStore.collectMediaFilenames(track, keep);
    libraryStore.collectMediaFilenames(playState.currentTrack, keep);
    const result = libraryStore.cleanupAudio(keep);
    emitToControlClients(io, 'library:list', libraryStore.getLibrarySummary());
    if (typeof ack === 'function') ack({ ok: true, ...result });
  });

  // ─── 儲存歌單：媒體庫 id 的有序集合，一首歌可在多個歌單 ───
  // 只在這裡（非唯讀 socket）註冊；顯示端／唯讀端沒有任何歌單事件。
  function broadcastSavedPlaylists() {
    emitToControlClients(io, 'savedPlaylists:list', savedPlaylists.list());
  }
  const reply = (ack, result) => { if (typeof ack === 'function') ack(result); };

  socket.on('savedPlaylists:get', (_data, ack) => {
    const list = savedPlaylists.list();
    if (typeof ack === 'function') ack(list); else socket.emit('savedPlaylists:list', list);
  });

  socket.on('savedPlaylists:create', (data, ack) => {
    const result = savedPlaylists.create({ name: data?.name, trackIds: data?.trackIds });
    if (result.ok) broadcastSavedPlaylists();
    reply(ack, result);
  });

  socket.on('savedPlaylists:rename', (data, ack) => {
    const result = savedPlaylists.rename(data?.id, data?.name);
    if (result.ok) broadcastSavedPlaylists();
    reply(ack, result);
  });

  socket.on('savedPlaylists:delete', (id, ack) => {
    const result = savedPlaylists.remove(id);
    if (result.ok) broadcastSavedPlaylists();
    reply(ack, result);
  });

  socket.on('savedPlaylists:addTracks', (data, ack) => {
    // 只收媒體庫裡真的存在的 id，避免面板送來過期快取的 id 變成永遠載不出來的幽靈項目
    const trackIds = (Array.isArray(data?.trackIds) ? data.trackIds : [])
      .filter((id) => libraryStore.getEntry(id));
    const result = savedPlaylists.addTracks(data?.id, trackIds);
    if (result.ok && result.added) broadcastSavedPlaylists();
    reply(ack, result);
  });

  socket.on('savedPlaylists:removeTracks', (data, ack) => {
    const result = savedPlaylists.removeTracks(data?.id, data?.trackIds);
    if (result.ok && result.removed) broadcastSavedPlaylists();
    reply(ack, result);
  });

  socket.on('savedPlaylists:setOrder', (data, ack) => {
    const result = savedPlaylists.setOrder(data?.id, data?.trackIds);
    if (result.ok && result.changed) broadcastSavedPlaylists();
    reply(ack, result);
  });

  // 伺服器端整份載入：音檔還在的歌一次組好、依歌單順序附加到播放清單末端（等同 playlist:add），
  // 音檔不在的回給呼叫端自行決定要不要重抓——YouTube 下載一律只能走面板 app.js 的匯入佇列
  // （鐵則 12），伺服器這裡絕不自己啟動下載。手機遙控器沒有匯入佇列，就只載入現成的。
  socket.on('savedPlaylists:load', (data, ack) => {
    const playlist = savedPlaylists.get(data?.id);
    if (!playlist) { reply(ack, { ok: false, error: 'not_found' }); return; }
    const exists = libraryStore.getAudioExistsLookup();
    const ready = [];
    const needsDownload = [];
    let missing = 0;
    for (const trackId of playlist.trackIds) {
      const entry = libraryStore.getEntry(trackId);
      if (!entry) { missing++; continue; }
      if (entry.filename && exists(entry.filename)) ready.push(buildTrackFromEntry(entry));
      else if (entry.url) needsDownload.push({ id: entry.id, title: entry.title || '', url: entry.url });
      else missing++;
    }
    const clean = sanitizePlaylist(ready) || [];
    const room = Math.max(0, MAX_PLAYLIST_SIZE - playState.playlist.length);
    const added = assignFreshEntryIds(clean.slice(0, room));
    const overflow = clean.length - added.length;
    if (added.length) {
      playState.playlist.push(...added);
      emitToAccessRooms(io, 'playlist:update', getPublicPlaylist(), getReadOnlyPlaylist());
      emitSetlist();
      broadcastState();
      persistState();
    }
    reply(ack, { ok: true, added: added.length, overflow, needsDownload, missing, total: playlist.trackIds.length });
    // 跟 playlist:add／playlist:insert-next 同一套：新加進即時播放清單的歌，本機還沒有
    // 校正記憶時去問一次社群建議偏移值。漏掉這步的話，同一首歌從收藏歌單載入會拿不到
    // 別人已經校正過的歌詞偏移，跟從搜尋加入的體驗不一致。
    added.forEach((track) => {
      applyCommunityOffsetSuggestion(ctx, io, track)
        .catch((error) => log.warn(`歌詞偏移建議值套用失敗：${error.message}`));
    });
  });
}

module.exports = registerLibraryHandlers;
