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

  function reconcilePlaylist(nextPlaylist, currentTrackId) {
    const playlist = Array.isArray(nextPlaylist) ? nextPlaylist : [];
    const currentTrackIndex = currentTrackId == null
      ? -1
      : playlist.findIndex((track) => track && track.id === currentTrackId);
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

    return playlist.map((track) => {
      if (!track || track.id !== detailed.id) return track;
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

  return { getTrackIdAtIndex, reconcilePlaylist, mergeCurrentTrackDetails };
});
