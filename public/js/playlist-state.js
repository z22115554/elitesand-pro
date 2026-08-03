(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PlaylistState = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function getTrackIdAtIndex(playlist, index) {
    if (!Array.isArray(playlist) || !Number.isInteger(index) || index < 0) return null;
    const track = playlist[index];
    return track && track.id != null ? track.id : null;
  }

  function getEntryIdAtIndex(playlist, index) {
    if (!Array.isArray(playlist) || !Number.isInteger(index) || index < 0) return null;
    const track = playlist[index];
    return track && track.entryId != null ? track.entryId : null;
  }

  // currentEntryId 優先：同一首歌在清單裡出現不只一次時，光用歌曲 id 找永遠只會命中
  // 第一個相符的那一列，播到後面重複的那首時會誤判成在播第一首。entryId 是每一列
  // 專屬、加入清單時就分配好的識別碼，不會跟其他列撞到；沒有 entryId 的舊資料
  // （或還沒套用本次修正的舊客戶端）才退回用歌曲 id 找，維持向下相容。
  function reconcilePlaylist(nextPlaylist, currentTrackId, currentEntryId) {
    const playlist = Array.isArray(nextPlaylist) ? nextPlaylist : [];
    let currentTrackIndex = -1;
    if (currentEntryId != null) {
      currentTrackIndex = playlist.findIndex((track) => track && track.entryId === currentEntryId);
    }
    if (currentTrackIndex === -1 && currentTrackId != null) {
      currentTrackIndex = playlist.findIndex((track) => track && track.id === currentTrackId);
    }
    return { playlist, currentTrackIndex };
  }

  // state:sync / playlist:update 的播放清單只送摘要；只有目前歌曲隨 state:sync
  // 附完整歌詞。將那一首合回面板本地清單，讓時間軸編輯與「對齊第一句」仍可讀取資料。
  function mergeCurrentTrackDetails(nextPlaylist, currentTrack, fallbackTrack) {
    const playlist = Array.isArray(nextPlaylist) ? nextPlaylist : [];
    const detailed = currentTrack && currentTrack.id != null ? currentTrack : fallbackTrack;
    if (!detailed || detailed.id == null) return playlist;

    const hasLyricsDetail = Object.prototype.hasOwnProperty.call(detailed, 'lyrics')
      || Object.prototype.hasOwnProperty.call(detailed, 'parsedLyrics');
    if (!hasLyricsDetail) return playlist;

    // 有 entryId 就只合到那一列；沒有（舊資料）才退回用歌曲 id 比對，但這樣重複歌曲時
    // 所有相符的列都會被合併，是已知的向下相容限制，不是本次修正要擴大處理的範圍。
    const matches = (track) => (detailed.entryId != null
      ? track.entryId === detailed.entryId
      : track.id === detailed.id);
    return playlist.map((track) => {
      if (!track || !matches(track)) return track;
      return {
        ...track,
        lyrics: detailed.lyrics == null ? null : detailed.lyrics,
        parsedLyrics: detailed.parsedLyrics == null ? null : detailed.parsedLyrics,
        lyricsType: detailed.lyricsType || track.lyricsType || null,
        hasLyrics: typeof detailed.hasLyrics === 'boolean' ? detailed.hasLyrics : !!detailed.lyrics,
        manualLyrics: typeof detailed.manualLyrics === 'boolean' ? detailed.manualLyrics : !!track.manualLyrics,
      };
    });
  }

  return { getTrackIdAtIndex, getEntryIdAtIndex, reconcilePlaylist, mergeCurrentTrackDetails };
});
