/**
 * 共用時間工具模組
 * 
 * 統一所有時間戳解析與格式化函數，消除 krc-decoder / ttml-parser /
 * lrc-parser / lyrics-engine 之間的重複定義。
 */

/**
 * LRC 時間戳轉毫秒
 * 支援 [mm:ss.xx] 和 [mm:ss.xxx] 兩種格式
 * @param {string|number} tag - LRC 時間戳字串
 * @returns {number} 毫秒數
 */
function parseTimestampToMs(tag) {
  if (typeof tag === 'number') return tag;
  const match = String(tag).match(/(\d+):(\d+)\.(\d+)/);
  if (!match) return 0;
  // 補齊到 3 位毫秒：[mm:ss.xx] → xx0, [mm:ss.xxx] → xxx
  const padThird = match[3].length === 2 ? match[3] + '0' : match[3];
  return (parseInt(match[1], 10) * 60 + parseInt(match[2], 10)) * 1000 + parseInt(padThird, 10);
}

/**
 * 毫秒 → LRC 時間戳 [mm:ss.xx]
 * @param {number} ms - 毫秒
 * @returns {string} e.g. "01:23.45"
 */
function msToLrcTime(ms) {
  const totalMs = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((totalMs % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

/**
 * 毫秒 → KRC 時間標籤 [mm:ss.xx]（與 LRC 格式相同，保留別名以增強語意）
 * @param {number} ms - 毫秒
 * @returns {string}
 */
function msToKrcTime(ms) {
  return msToLrcTime(ms);
}

module.exports = {
  parseTimestampToMs,
  msToLrcTime,
  msToKrcTime,
};
