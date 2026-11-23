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
const LRC_TIMESTAMP_SOURCE = '(?:\\d+:)?\\d{1,3}:\\d{2}(?:[.:]\\d{1,3})?';
function escapeTimedWord(text) {
  return String(text).replace(/[&<>\[\]]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '[': '&#91;', ']': '&#93;' }[char]));
}
function parseTimestampToMs(tag) {
  if (typeof tag === 'number') return tag;
  const value = String(tag).replace(/^\[|\]$/g, '');
  const normalized = /^(\d+):(\d{2}):(\d{1,3})$/.test(value) ? value.replace(/:(\d{1,3})$/, '.$1') : value;
  const match = normalized.match(/^(?:(\d+):)?(\d+):(\d{2})(?:[.:](\d{1,3}))?$/);
  if (!match) return 0;
  const hours = Number(match[1] || 0), minutes = Number(match[2]), seconds = Number(match[3]);
  if (seconds > 59 || (match[1] && minutes > 59)) return 0;
  return (hours * 3600 + minutes * 60 + seconds) * 1000 + Number((match[4] || '').padEnd(3, '0'));
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
  const rounded = Math.max(0, Math.round(ms));
  return `${msToLrcTime(rounded).split('.')[0]}.${String(rounded % 1000).padStart(3, '0')}`;
}

module.exports = {
  LRC_TIMESTAMP_SOURCE,
  escapeTimedWord,
  parseTimestampToMs,
  msToLrcTime,
  msToKrcTime,
};
