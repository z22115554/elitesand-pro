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

  // ── 尾奏中暫停＝唱完 ──
  // 很多歌尾奏很長或結尾有一大段空白，主播常在音樂播完前就按暫停換下一首。
  // 只暫停的話程式不知道這首已經唱完：OBS 歌詞停在最後一句、歌單一直顯示「正在播放」。
  // 規則：最後一句歌詞已經唱完（或距離音訊結尾不到幾秒）時按暫停，停滿 OUTRO_PAUSE_FINISH_MS
  // 仍沒續播，就照「自然播完」收尾。歌詞還沒唱完時暫停（中途聊天）一律不動。
  const OUTRO_PAUSE_FINISH_MS = 8000;
  // 面板可調：0＝關閉；其餘夾在 3～30 秒；壞值回預設 8 秒（伺服器與面板共用同一份驗證）
  const OUTRO_PAUSE_FINISH_SEC_DEFAULT = OUTRO_PAUSE_FINISH_MS / 1000;
  const OUTRO_PAUSE_FINISH_SEC_CHOICES = Object.freeze([0, 3, 5, 8, 10, 15, 20, 30]);
  function normalizeOutroPauseFinishSec(value) {
    const n = Number(value);
    if (value === null || value === '' || typeof value === 'boolean' || !Number.isFinite(n)) return OUTRO_PAUSE_FINISH_SEC_DEFAULT;
    if (n <= 0) return 0;
    return Math.max(3, Math.min(30, Math.round(n)));
  }
  const NEAR_AUDIO_END_MS = 5000;
  const NO_DURATION_LAST_LINE_MS = 5000; // 同 karaoke.js getLyricsEndTime：沒有長度資訊時估 5 秒

  /** 最後一句有字歌詞的結束時間（ms，歌詞時間軸）；沒有歌詞回傳 null。 */
  function lyricsEndMs(lines) {
    if (!Array.isArray(lines)) return null;
    let end = null;
    for (const line of lines) {
      if (!line || typeof line.time !== 'number' || !Number.isFinite(line.time)) continue;
      if (!String(line.text || '').trim()) continue;
      let lineEnd = line.time + NO_DURATION_LAST_LINE_MS;
      if (Number.isFinite(line.duration) && line.duration > 0) {
        lineEnd = line.time + line.duration;
      } else if (Array.isArray(line.words) && line.words.length) {
        // 逐字時間是相對於句首（見 karaoke.js 的 lineStartTime + word.start）
        const last = line.words[line.words.length - 1];
        if (last && Number.isFinite(last.start)) lineEnd = line.time + last.start + (Number(last.duration) || 0);
      }
      if (end === null || lineEnd > end) end = lineEnd;
    }
    return end;
  }

  /**
   * 暫停當下是否已在尾奏／結尾空白（可視為唱完）。
   * positionMs：音訊位置；offsetMs：歌詞偏移（顯示端 adjusted = 音訊時間 + offset）；durationMs：音訊長度，未知給 0。
   */
  function isPastLyrics({ lines, positionMs, offsetMs = 0, durationMs = 0 } = {}) {
    const position = Number(positionMs);
    if (!Number.isFinite(position) || position <= 0) return false;
    const duration = Number(durationMs);
    if (Number.isFinite(duration) && duration > 0 && duration - position <= NEAR_AUDIO_END_MS) return true;
    const end = lyricsEndMs(lines);
    if (end === null) return false; // 沒有時間軸歌詞就無從判斷尾奏，只靠「接近音訊結尾」
    return position + (Number(offsetMs) || 0) >= end;
  }

  return { nextAfterEnded, manualAdvance, lyricsEndMs, isPastLyrics, OUTRO_PAUSE_FINISH_MS, NEAR_AUDIO_END_MS,
    OUTRO_PAUSE_FINISH_SEC_DEFAULT, OUTRO_PAUSE_FINISH_SEC_CHOICES, normalizeOutroPauseFinishSec };
}));
