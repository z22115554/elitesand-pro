/**
 * 媒體庫 socket 事件：查詢/刪除/清空/即時還原/音檔清理。
 *
 * 注意：sendWithCallback → socket.emit(event, data, ack)，故 server 端收到 (data, ack)
 */

const libraryStore = require('../../services/library-store');
const mediaStorage = require('../../services/media-storage');
const { emitToControlClients } = require('../../utils/socket-broadcast');

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 * @param {ReturnType<import('../../state/app-state').createAppState>} ctx
 */
function registerLibraryHandlers(io, socket, ctx) {
  const { playState } = ctx;

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
    const list = libraryStore.getLibrary();
    if (typeof ack === 'function') ack(list); else socket.emit('library:list', list);
  });

  socket.on('library:remove', (id, ack) => {
    const removed = libraryStore.remove(id);
    emitToControlClients(io, 'library:list', libraryStore.getLibrary());
    if (typeof ack === 'function') ack({ ok: removed, error: removed ? null : '找不到媒體庫項目' });
  });

  socket.on('library:clear', (_data, ack) => {
    libraryStore.clear();
    emitToControlClients(io, 'library:list', libraryStore.getLibrary());
    if (typeof ack === 'function') ack({ ok: true });
  });

  // 從媒體庫即時還原一首歌：本機音檔還在就直接組 track 回傳（含記憶的歌詞/拼音/諧音/變調，
  // 零下載、零重新羅馬化）；音檔不在才回 needsDownload 讓前端走 YouTube 重抓。
  socket.on('library:reimport', (id, ack) => {
    const reply = (r) => { if (typeof ack === 'function') ack(r); };
    const entry = libraryStore.getEntry(id);
    if (!entry) { reply({ error: 'not_found' }); return; }

    if (entry.filename && libraryStore.audioExists(entry.filename)) {
      const track = {
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
        // AI 人聲分離：這支 handler 手動列了一份自己的欄位白名單，跟
        // sanitizeTrack() 的白名單是兩份分開的東西——只改 sanitizeTrack 那邊，
        // 這裡沒同步加，分離過的歌一經過「加入清單」就會被這裡重新組出的 track
        // 蓋掉，看起來像「又變回沒分離」（實際上是媒體庫紀錄沒事，前端顯示的
        // playState.playlist 那份被這裡的白名單漏掉的欄位重置了）。
        vocalsFile: entry.vocalsFile || null,
        instrumentalFile: entry.instrumentalFile || null,
        separationStatus: entry.separationStatus || 'none',
      };
      reply({ track });
    } else if (entry.url) {
      reply({ needsDownload: true, url: entry.url });
    } else {
      reply({ error: 'no_audio_no_url' });
    }
  });

  socket.on('library:cleanupAudio', (_data, ack) => {
    // 保留目前播放清單仍在用的音檔，其餘刪除（庫保留 YT 網址可重抓）
    const keep = new Set(playState.playlist.map(t => t.filename).filter(Boolean));
    const result = libraryStore.cleanupAudio(keep);
    if (typeof ack === 'function') ack({ ok: true, ...result });
  });
}

module.exports = registerLibraryHandlers;
