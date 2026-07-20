/**
 * 統一音量（響度正規化）的增益計算。
 * 伺服器在匯入/回填時用 ffmpeg ebur128 量出每首歌的 integrated loudness（LUFS），
 * 播放端把每首歌拉到同一目標響度：增益 = TARGET_LUFS - 實測值，夾在 ±12 dB。
 * 沒有量測值（舊歌尚未回填、量測失敗）一律回 0 dB＝維持原音量。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LoudnessGain = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TARGET_LUFS = -14; // 串流平台慣例（Spotify/YouTube）
  var MAX_ADJUST_DB = 12;
  // ebur128 對極端素材（近無聲）會回報到 -70；正常音樂不會超出這個範圍，
  // 範圍外視為量測異常，不套用增益比套錯增益安全。
  var MIN_VALID_LUFS = -70;
  var MAX_VALID_LUFS = 0;

  function computeTrackGainDb(lufs) {
    if (typeof lufs !== 'number' || !isFinite(lufs)) return 0;
    if (lufs < MIN_VALID_LUFS || lufs >= MAX_VALID_LUFS) return 0;
    var db = TARGET_LUFS - lufs;
    return Math.max(-MAX_ADJUST_DB, Math.min(MAX_ADJUST_DB, db));
  }

  function dbToLinear(db) {
    return Math.pow(10, db / 20);
  }

  return { TARGET_LUFS: TARGET_LUFS, MAX_ADJUST_DB: MAX_ADJUST_DB, computeTrackGainDb: computeTrackGainDb, dbToLinear: dbToLinear };
}));
