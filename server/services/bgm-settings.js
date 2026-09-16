/**
 * BGM 待機音樂的可調參數（音量／兩個恢復延遲）：伺服器端持久化與面板端 UI 共用同一份
 * clamp 範圍，避免兩邊各自寫一份數字上下限、日後改一邊忘記改另一邊。
 *
 * 兩個延遲的存在原因：使用者實測回報「唱歌暫停/播完後 BGM 立刻接回來」太突兀，可能還在
 * 調整麥克風、準備下一首歌；不清楚競品（歌回救星）確切怎麼算這段空白時間，所以直接做成
 * 使用者自己可調的參數，不是我們猜一個數字硬編碼。
 */
'use strict';

const DEFAULTS = Object.freeze({
  volume: 70,
  pauseResumeDelayMs: 3000,
  endResumeDelayMs: 5000,
});

const LIMITS = Object.freeze({
  volumeMin: 0, volumeMax: 100,
  delayMsMin: 0, delayMsMax: 15000,
});

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** 只挑出這三個可調欄位並夾在合法範圍內；其餘欄位（enabled/playing）不在這裡管理。 */
function clampSettings(input, current = DEFAULTS) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    volume: clampNumber(source.volume, current.volume, LIMITS.volumeMin, LIMITS.volumeMax),
    pauseResumeDelayMs: clampNumber(source.pauseResumeDelayMs, current.pauseResumeDelayMs, LIMITS.delayMsMin, LIMITS.delayMsMax),
    endResumeDelayMs: clampNumber(source.endResumeDelayMs, current.endResumeDelayMs, LIMITS.delayMsMin, LIMITS.delayMsMax),
  };
}

module.exports = { DEFAULTS, LIMITS, clampSettings };
