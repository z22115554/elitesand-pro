/**
 * 歌曲筆記 socket 事件（只在非唯讀 socket 註冊；OBS 疊加層、唯讀端不在 READ_ONLY_EVENTS，送不進來）。
 * 更新只推給 control 房間：筆記是主播私用，絕不可 io.emit（會送到 /display、/setlist）。
 */
const songNotes = require('../../services/song-notes');
const { emitToControlClients } = require('../../utils/socket-broadcast');

function registerSongNotesHandlers(io, socket) {
  socket.on('song-notes:get', (data, ack) => {
    if (typeof ack !== 'function') return;
    const trackId = data && data.trackId;
    if (trackId == null || trackId === '') { ack({ ok: false, error: 'invalid' }); return; }
    ack({ ok: true, trackId: String(trackId), notes: songNotes.get(trackId) });
  });

  socket.on('song-notes:set', (data, ack) => {
    const reply = (result) => { if (typeof ack === 'function') ack(result); };
    if (!data || typeof data !== 'object' || data.trackId == null) { reply({ ok: false, error: 'invalid' }); return; }
    const partial = {};
    if (Object.prototype.hasOwnProperty.call(data, 'songNote')) partial.songNote = data.songNote;
    if (Object.prototype.hasOwnProperty.call(data, 'lines')) partial.lines = data.lines;
    if (!Object.keys(partial).length) { reply({ ok: false, error: 'invalid' }); return; }
    const saved = songNotes.set(data.trackId, partial);
    if (!saved) { reply({ ok: false, error: 'invalid' }); return; }
    const trackId = String(data.trackId).trim();
    emitToControlClients(io, 'song-notes:updated', { trackId, notes: saved });
    reply({ ok: true, trackId, notes: saved });
  });
}

module.exports = registerSongNotesHandlers;
