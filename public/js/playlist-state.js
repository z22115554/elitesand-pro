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

  return { getTrackIdAtIndex, reconcilePlaylist };
});
