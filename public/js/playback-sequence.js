/**
 * 播放結束後的下一步規則。
 * 單曲模式播完後清空目前歌曲，等待使用者主動按下一首；連續模式才自動播放下一首。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PlaybackSequence = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function nextAfterEnded(currentIndex, playlistLength, continuousPlay) {
    const index = Number(currentIndex);
    const length = Number(playlistLength);
    if (!Number.isInteger(index) || !Number.isInteger(length) || length <= 0) return null;
    if (!continuousPlay) return null;
    if (index < 0 || index >= length - 1) return null;
    return { index: index + 1, autoplay: true };
  }

  function manualAdvance(currentIndex, playlistLength, lastPlayedIndex, delta) {
    const current = Number(currentIndex);
    const length = Number(playlistLength);
    const cursor = Number(lastPlayedIndex);
    const direction = Number(delta) >= 0 ? 1 : -1;
    if (!Number.isInteger(length) || length <= 0) return -1;
    if (Number.isInteger(current) && current >= 0 && current < length) {
      return direction > 0
        ? (current < length - 1 ? current + 1 : 0)
        : (current > 0 ? current - 1 : length - 1);
    }
    if (Number.isInteger(cursor) && cursor >= 0 && cursor < length) {
      return direction > 0 ? (cursor + 1) % length : cursor;
    }
    return direction > 0 ? 0 : length - 1;
  }

  return { nextAfterEnded, manualAdvance };
}));
