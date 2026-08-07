/**
 * 播放結束後的下一步規則。
 * 單曲模式只預載下一首，連續模式才自動播放；最後一首一律自然停止。
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
    if (index < 0 || index >= length - 1) return null;
    return { index: index + 1, autoplay: !!continuousPlay };
  }

  return { nextAfterEnded };
}));
