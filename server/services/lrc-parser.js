/**
 * LRC 格式解析器 v2 (Phase 5)
 * 支援標準 LRC、增強 LRC (Enhanced LRC)、翻譯歌詞、offset 標籤
 * 
 * Phase 5 增強：
 * - 解析 [offset:xxx] 標籤，作為時間偏移預設值
 * - offset 單位為毫秒，正數代表歌詞提前顯示，負數代表延後
 */

const { parseTimestampToMs, msToLrcTime, LRC_TIMESTAMP_SOURCE } = require('../utils/time-utils');
const { cleanLyrics } = require('./lyrics-cleaner');

// 增強 LRC（A2 extension）的逐字時間 <mm:ss.xx>：目前逐字顯示只吃 KRC，這裡至少要從文字裡拿掉，
// 不然畫面上會直接出現「<00:01.00>Hel<00:01.50>lo」。
const ENHANCED_WORD_TAG_RE = /<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g;

/**
 * 解析 LRC 歌詞文字為結構化行
 * @param {string} lrcText - LRC 格式歌詞
 * @returns {{ lines: Array, offset: number }} { lines: [{ time, text, translation, phonetic }], offset: 毫秒 }
 */
function parseLrc(lrcText) {
  if (!lrcText) return { lines: [], offset: 0 };

  const lines = lrcText.split('\n');
  const parsed = [];
  const endMarkers = [];
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

    const regex = new RegExp(`\\[(${LRC_TIMESTAMP_SOURCE})\\]`, 'g');
    const timestamps = [];
    let match;

    while ((match = regex.exec(line)) !== null) {
      timestamps.push(parseTimestampToMs(match[1]));
    }

    let text = line.replace(new RegExp(`\\[${LRC_TIMESTAMP_SOURCE}\\]`, 'g'), '');
    if (ENHANCED_WORD_TAG_RE.test(text)) {
      ENHANCED_WORD_TAG_RE.lastIndex = 0;
      text = text.replace(ENHANCED_WORD_TAG_RE, '').replace(/[ \t]{2,}/g, ' ');
    }
    ENHANCED_WORD_TAG_RE.lastIndex = 0;
    text = text.trim();

    if (timestamps.length > 0 && text) {
      for (const time of timestamps) {
        parsed.push({ time, text, translation: '', phonetic: '' });
      }
    } else if (timestamps.length > 0) {
      endMarkers.push(...timestamps);
    }
  }

  parsed.sort((a, b) => a.time - b.time);
  // 只有時間、沒有字的空行＝上一句在這裡結束（間奏前最常見）。舊版直接丟掉，上一句就一路掛到
  // 下一句才換，間奏 30 秒都停在畫面上。換算成上一句的 duration（模板都認 line.duration）。
  for (const end of endMarkers) {
    let prev = null;
    for (const line of parsed) { if (line.time < end) prev = line; else break; }
    if (prev && !(prev.duration > 0)) {
      // 雙語 LRC 同一時間有原文＋譯文兩行（之後會併成一行）：同一時間的每一行都要帶上。
      for (const line of parsed) if (line.time === prev.time) line.duration = end - prev.time;
    }
  }
  return { lines: parsed, offset };
}

/**
 * 僅解析 offset 標籤（不需要完整解析歌詞時使用）
 * @param {string} lrcText - LRC 格式歌詞
 * @returns {number} offset 毫秒數
 */
function parseOffset(lrcText) {
  if (!lrcText) return 0;
  const match = lrcText.match(/^\[offset:\s*([+-]?\d+)\s*\]/mi);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * 解析 SRT 格式字幕
 * @param {string} srtText - SRT 格式字幕
 * @returns {{ lines: Array, offset: number }}
 */
function parseSrt(srtText) {
  if (!srtText) return { lines: [], offset: 0 };

  const blocks = srtText.replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
  const parsed = [];

  for (const block of blocks) {
    const blockLines = block.trim().split('\n');
    if (blockLines.length < 2) continue;

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
      // 移除 HTML 標籤與 ASS/SSA 的定位覆寫碼（字幕軟體輸出的 {\an8}、{\i1} 會原樣顯示在歌詞上）
      text: text.replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/\s{2,}/g, ' ').trim(),
      phonetic: '',
      words: [],
    });
  }

  parsed.sort((a, b) => a.time - b.time);
  return { lines: parsed, offset: 0 };
}

/**
 * WebVTT 時間字串（HH:MM:SS.mmm 或 MM:SS.mmm）轉毫秒，失敗回傳 null
 */
function vttTimeToMs(str) {
  const m = str.match(/^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})$/);
  if (!m) return null;
  return ((parseInt(m[1] || '0', 10) * 3600) + parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) * 1000 + parseInt(m[4], 10);
}

/**
 * 解析 WebVTT (.vtt) 字幕
 * 跳過 WEBVTT 標頭、NOTE / STYLE / REGION 區塊；忽略 cue identifier 與 cue settings；
 * 移除 <v Singer>、<c.x>、<00:00:01.000> 等標籤並解碼常見 HTML 實體。
 * @param {string} vttText - WebVTT 格式字幕
 * @returns {{ lines: Array, offset: number }}
 */
function parseVtt(vttText) {
  if (!vttText) return { lines: [], offset: 0 };

  const normalized = vttText.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = normalized.split(/\n\s*\n/);
  const parsed = [];
  const timingRe = /^((?:\d+:)?\d{2}:\d{2}\.\d{3})\s*-->\s*((?:\d+:)?\d{2}:\d{2}\.\d{3})(?:\s.*)?$/;

  for (const block of blocks) {
    const blockLines = block.trim().split('\n');
    if (!blockLines[0] || !blockLines[0].trim()) continue;

    // 標頭、註解、樣式、區域區塊不含字幕
    if (/^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/.test(blockLines[0].trim())) continue;

    // 找時間軸行（前一行可能是 cue identifier，略過即可）
    const timingIdx = blockLines.findIndex(l => timingRe.test(l.trim()));
    if (timingIdx === -1) continue;

    const timeMatch = blockLines[timingIdx].trim().match(timingRe);
    const startTime = vttTimeToMs(timeMatch[1]);
    const endTime = vttTimeToMs(timeMatch[2]);
    if (startTime === null || endTime === null) continue;

    const text = blockLines.slice(timingIdx + 1).join(' ')
      .replace(/<\/?[^>]+>/g, '') // 移除 <v Singer>、<c.x>、</c>、<00:00:01.000> 等標籤
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .trim();
    if (!text) continue;

    parsed.push({
      time: startTime,
      duration: endTime - startTime,
      text,
      phonetic: '',
      words: [],
    });
  }

  parsed.sort((a, b) => a.time - b.time);
  return { lines: parsed, offset: 0 };
}

/**
 * 自動偵測格式並解析歌詞
 * @param {string} text - 歌詞文字
 * @returns {{ lines: Array, offset: number, type: string }}
 */
function autoParseLyrics(text) {
  if (!text) return { lines: [], offset: 0, type: 'txt' };

  const trimmed = text.replace(/\r\n?/g, '\n').trim();

  // 偵測 WebVTT 格式（需在 SRT 之前）
  if (/^\uFEFF?WEBVTT/.test(trimmed)) {
    const result = parseVtt(trimmed);
    return { ...result, lines: cleanLyrics(result.lines), type: 'vtt' };
  }

  // 偵測 SRT 格式
  if (/^(?:\d+\s*\n)?\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(trimmed)) {
    const result = parseSrt(trimmed);
    return { ...result, lines: cleanLyrics(result.lines), type: 'srt' };
  }

  // 偵測 KRC 格式
  if (new RegExp(`^\\[${LRC_TIMESTAMP_SOURCE}\\]<\\d+>`).test(trimmed)) {
    // KRC 由 LyricsEngine.parseKrc 處理
    return { lines: [], offset: 0, type: 'krc' };
  }

  // 偵測 LRC 格式（有時間標籤）
  if (new RegExp(`\\[${LRC_TIMESTAMP_SOURCE}\\]`).test(trimmed)) {
    const result = parseLrc(trimmed);
    return { ...result, lines: cleanLyrics(result.lines), type: 'lrc' };
  }

  // 純文字：貼上路徑（如「貼上歌詞」對話框）沒有時間軸，最容易夾帶作詞/作曲/出品/授權
  // 聲明等雜訊（歌曲清洗的主要來源），這裡跟其他來源一樣統一走 cleanLyrics。
  // 清洗後才依最終行數重新編排 5 秒間隔的佔位時間戳，避免砍掉開頭幾行後，
  // 第一句正文的時間戳留著原本的空隙（例如砍了 5 行製作資訊，第一句卻還是從 25 秒開始）。
  // Genius 等歌詞網站貼過來的段落標題（[Verse 1]、[Chorus: 某某]、[副歌]）不是要唱的句子；
  // 純文字沒有時間軸，留著會被當成一句排進 5 秒一格的佔位時間、顯示在畫面上。
  const SECTION_HEADER_RE = /^\[(?:verse|chorus|pre-?chorus|post-?chorus|bridge|intro|outro|hook|refrain|interlude|instrumental|break|drop|rap|主歌|副歌|間奏|间奏|前奏|尾奏|橋段|桥段|導歌|导歌)(?![A-Za-z])[^\]]{0,40}\]$/i;
  const rawLines = trimmed.split('\n').filter(l => l.trim() && !SECTION_HEADER_RE.test(l.trim())).map((text, i) => ({
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
  parseVtt,
  autoParseLyrics,
  msToLrcTime,
  parseTimestampToMs,
};
