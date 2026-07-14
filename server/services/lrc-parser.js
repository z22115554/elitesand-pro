/**
 * LRC 格式解析器 v2 (Phase 5)
 * 支援標準 LRC、增強 LRC (Enhanced LRC)、翻譯歌詞、offset 標籤
 * 
 * Phase 5 增強：
 * - 解析 [offset:xxx] 標籤，作為時間偏移預設值
 * - offset 單位為毫秒，正數代表歌詞提前顯示，負數代表延後
 */

const { parseTimestampToMs, msToLrcTime } = require('../utils/time-utils');
const { cleanLyrics } = require('./lyrics-cleaner');

/**
 * 解析 LRC 歌詞文字為結構化行
 * @param {string} lrcText - LRC 格式歌詞
 * @returns {{ lines: Array, offset: number }} { lines: [{ time, text, translation, phonetic }], offset: 毫秒 }
 */
function parseLrc(lrcText) {
  if (!lrcText) return { lines: [], offset: 0 };

  const lines = lrcText.split('\n');
  const parsed = [];
  let offset = 0;

  for (const line of lines) {
    // 解析 offset 標籤：[offset:xxx]（接受 +500 / -500 / 500 三種寫法）
    const offsetMatch = line.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
    if (offsetMatch) {
      offset = parseInt(offsetMatch[1], 10);
      continue;
    }

    // 跳過其他 metadata 標籤（ti, ar, al, by 等）
    if (/^\[(ti|ar|al|by|re|ve|length):/i.test(line.trim())) {
      continue;
    }

    const regex = /\[(\d{2}:\d{2}(?:\.\d{2,3})?)\]/g;
    const timestamps = [];
    let match;

    while ((match = regex.exec(line)) !== null) {
      timestamps.push(parseTimestampToMs(match[1]));
    }

    const text = line.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, '').trim();

    if (timestamps.length > 0 && text) {
      for (const time of timestamps) {
        parsed.push({ time, text, translation: '', phonetic: '' });
      }
    }
  }

  parsed.sort((a, b) => a.time - b.time);
  return { lines: parsed, offset };
}

/**
 * 僅解析 offset 標籤（不需要完整解析歌詞時使用）
 * @param {string} lrcText - LRC 格式歌詞
 * @returns {number} offset 毫秒數
 */
function parseOffset(lrcText) {
  if (!lrcText) return 0;
  const match = lrcText.match(/^\[offset:(-?\d+)\]/mi);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * 解析增強 LRC (Enhanced LRC with word timing)
 * 格式: [mm:ss.xx] <mm:ss.xx> word1 <mm:ss.xx> word2 ...
 */
function parseEnhancedLrc(lrcText) {
  if (!lrcText) return { lines: [], offset: 0 };

  const lines = lrcText.split('\n');
  const parsed = [];
  let offset = 0;

  for (const line of lines) {
    const offsetMatch = line.match(/^\[offset:(-?\d+)\]/i);
    if (offsetMatch) {
      offset = parseInt(offsetMatch[1], 10);
      continue;
    }

    const lineMatch = line.match(/^\[(\d{2}:\d{2}(?:\.\d{2,3})?)\]\s*(.*)/);
    if (!lineMatch) continue;

    const lineTime = parseTimestampToMs(lineMatch[1]);
    const content = lineMatch[2];

    const wordRegex = /(?:<(\d{2}:\d{2}(?:\.\d{2,3})?)>)?([^<\[\]]+)/g;
    const words = [];
    let fullText = '';
    let wordMatch;

    while ((wordMatch = wordRegex.exec(content)) !== null) {
      const wordTime = wordMatch[1] ? parseTimestampToMs(wordMatch[1]) : null;
      const wordText = wordMatch[2].trim();
      if (wordText) {
        fullText += wordText;
        words.push({ text: wordText, start: wordTime, phonetic: '' });
      }
    }

    if (fullText.trim()) {
      parsed.push({
        time: lineTime,
        text: fullText.trim(),
        words: words.length > 0 ? words : null,
        translation: '',
        phonetic: '',
      });
    }
  }

  parsed.sort((a, b) => a.time - b.time);
  return { lines: parsed, offset };
}

/**
 * 解析 SRT 格式字幕
 * @param {string} srtText - SRT 格式字幕
 * @returns {{ lines: Array, offset: number }}
 */
function parseSrt(srtText) {
  if (!srtText) return { lines: [], offset: 0 };

  const blocks = srtText.trim().split(/\n\s*\n/);
  const parsed = [];

  for (const block of blocks) {
    const blockLines = block.trim().split('\n');
    if (blockLines.length < 3) continue;

    // 跳過序號行
    let lineIdx = 0;
    if (/^\d+$/.test(blockLines[0].trim())) {
      lineIdx = 1;
    }

    // 解析時間軸行
    const timeLine = blockLines[lineIdx];
    const timeMatch = timeLine.match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
    );
    if (!timeMatch) continue;

    const startTime = (parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3])) * 1000 + parseInt(timeMatch[4]);
    const endTime = (parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 + parseInt(timeMatch[7])) * 1000 + parseInt(timeMatch[8]);

    // 文字行
    const text = blockLines.slice(lineIdx + 1).join(' ').trim();
    if (!text) continue;

    parsed.push({
      time: startTime,
      duration: endTime - startTime,
      text: text.replace(/<[^>]+>/g, ''), // 移除 HTML 標籤
      phonetic: '',
      words: [],
    });
  }

  parsed.sort((a, b) => a.time - b.time);
  return { lines: parsed, offset: 0 };
}

/**
 * 將結構化歌詞轉回 LRC 格式文字
 */
function toLrcString(lines, offset = 0) {
  if (!lines || lines.length === 0) return '';
  let result = '';
  if (offset !== 0) {
    result += `[offset:${offset}]\n`;
  }
  result += lines.map((line) => `[${msToLrcTime(line.time)}]${line.text}`).join('\n');
  return result;
}

/**
 * 自動偵測格式並解析歌詞
 * @param {string} text - 歌詞文字
 * @returns {{ lines: Array, offset: number, type: string }}
 */
function autoParseLyrics(text) {
  if (!text) return { lines: [], offset: 0, type: 'txt' };

  const trimmed = text.trim();

  // 偵測 SRT 格式
  if (/^\d+\s*\n\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(trimmed)) {
    const result = parseSrt(trimmed);
    return { ...result, lines: cleanLyrics(result.lines), type: 'srt' };
  }

  // 偵測 KRC 格式
  if (/^\[\d{2}:\d{2}\.\d{2,3}\]<\d+>/.test(trimmed)) {
    // KRC 由 LyricsEngine.parseKrc 處理
    return { lines: [], offset: 0, type: 'krc' };
  }

  // 偵測 LRC 格式（有時間標籤）
  if (/\[\d{2}:\d{2}/.test(trimmed)) {
    const result = parseLrc(trimmed);
    return { ...result, lines: cleanLyrics(result.lines), type: 'lrc' };
  }

  // 純文字：貼上路徑（如「貼上歌詞」對話框）沒有時間軸，最容易夾帶作詞/作曲/出品/授權
  // 聲明等雜訊（歌曲清洗的主要來源），這裡跟其他來源一樣統一走 cleanLyrics。
  // 清洗後才依最終行數重新編排 5 秒間隔的佔位時間戳，避免砍掉開頭幾行後，
  // 第一句正文的時間戳留著原本的空隙（例如砍了 5 行製作資訊，第一句卻還是從 25 秒開始）。
  const rawLines = trimmed.split('\n').filter(l => l.trim()).map((text, i) => ({
    time: i * 5000,
    text: text.trim(),
    phonetic: '',
    words: [],
  }));
  const cleaned = cleanLyrics(rawLines).map((l, i) => ({ ...l, time: i * 5000 }));
  return { lines: cleaned, offset: 0, type: 'txt' };
}

module.exports = {
  parseLrc,
  parseOffset,
  parseEnhancedLrc,
  parseSrt,
  toLrcString,
  autoParseLyrics,
  msToLrcTime,
  parseTimestampToMs,
};
