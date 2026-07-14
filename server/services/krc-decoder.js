/**
 * KRC 解密與解碼器
 * 
 * KRC 是酷狗音樂的逐字歌詞格式，採用 zlib 壓縮 + XOR 加密。
 * 解碼流程：
 * 1. 跳過前 4 bytes 的 header (krc1/krc2)
 * 2. XOR 解密（使用固定金鑰）
 * 3. zlib 解壓縮
 * 4. 解析逐字歌詞格式
 * 
 * 解壓後的格式有兩種：
 * - 舊版 XML: <line start="0" duration="5000"><text .../></line>
 * - 新版自定義: [startMs,durationMs]<wordStart,wordDuration,flag>word...
 */
const zlib = require('zlib');
const { msToKrcTime, parseTimestampToMs, msToSrtTime } = require('../utils/time-utils');

// KRC XOR 加密金鑰（酷狗固定金鑰）
const KRC_KEY = [
  0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47,
  0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69,
];

/**
 * 解碼 KRC 二進位資料
 * @param {Buffer} buffer - KRC 原始二進位資料
 * @returns {string|null} 解碼後的歌詞文字（標準 KRC 逐字格式）
 */
function krcDecode(buffer) {
  try {
    if (!Buffer.isBuffer(buffer)) {
      buffer = Buffer.from(buffer);
    }

    const header = buffer.toString('ascii', 0, 4);
    if (header !== 'krc1' && header !== 'krc2') {
      console.warn('[KRC] 無效的 KRC header:', header);
      return null;
    }

    // XOR 解密
    const encrypted = buffer.slice(4);
    const decrypted = Buffer.alloc(encrypted.length);
    for (let i = 0; i < encrypted.length; i++) {
      decrypted[i] = encrypted[i] ^ KRC_KEY[i % KRC_KEY.length];
    }

    // zlib 解壓縮
    const rawText = zlib.inflateSync(decrypted).toString('utf-8');

    // 偵測格式並解析
    return rawText.trim().startsWith('<')
      ? parseKrcXml(rawText)
      : parseKrcCustom(rawText);
  } catch (err) {
    console.error('[KRC] 解碼失敗:', err.message);
    return null;
  }
}

/**
 * 解析新版 KRC 自定義格式
 * 格式：[startMs,durationMs]<wordStart,wordDuration,flag>word...
 */
function parseKrcCustom(rawText) {
  const lines = rawText.split('\n');
  const output = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^\[(ti|ar|al|by|offset):/.test(trimmed)) continue;

    const lineMatch = trimmed.match(/^\[(\d+),(\d+)\](.*)/);
    if (!lineMatch) continue;

    const lineStartMs = parseInt(lineMatch[1], 10);
    const lineDurationMs = parseInt(lineMatch[2], 10);
    const content = lineMatch[3];

    const words = [];
    let fullText = '';
    const wordRegex = /<(\d+),(\d+),(\d+)>([^<]*)/g;
    let wordMatch;

    while ((wordMatch = wordRegex.exec(content)) !== null) {
      const wordText = decodeKrcEntities(wordMatch[4]);
      if (wordText) {
        fullText += wordText;
        words.push({
          text: wordText,
          start: parseInt(wordMatch[1], 10),
          duration: parseInt(wordMatch[2], 10),
          phonetic: '',
        });
      }
    }

    if (fullText.trim() && words.length > 0) {
      const timeTag = msToKrcTime(lineStartMs);
      let krcLine = `[${timeTag}]<${lineDurationMs}>`;
      for (const word of words) {
        krcLine += `${word.text}<${word.start},${word.duration}>`;
      }
      output.push(krcLine);
    }
  }

  return output.join('\n');
}

/**
 * 解析舊版 KRC XML 結構
 */
function parseKrcXml(xmlText) {
  const lines = [];
  const lineRegex = /<line\s+start="(\d+)"\s+duration="(\d+)">([\s\S]*?)<\/line>/g;
  let lineMatch;

  while ((lineMatch = lineRegex.exec(xmlText)) !== null) {
    const lineStart = parseInt(lineMatch[1], 10);
    const lineDuration = parseInt(lineMatch[2], 10);
    const lineContent = lineMatch[3];

    const words = [];
    let fullText = '';
    const wordRegex = /<text\s+start="(\d+)"\s+duration="(\d+)"\s+(?:vertical="[^"]*"\s+)?content="([^"]*)"/g;
    let wordMatch;

    while ((wordMatch = wordRegex.exec(lineContent)) !== null) {
      const wordContent = decodeKrcEntities(wordMatch[3]);
      fullText += wordContent;
      words.push({
        text: wordContent,
        start: parseInt(wordMatch[1], 10),
        duration: parseInt(wordMatch[2], 10),
        phonetic: '',
      });
    }

    if (fullText.trim() && words.length > 0) {
      const timeTag = msToKrcTime(lineStart);
      let krcLine = `[${timeTag}]<${lineDuration}>`;
      for (const word of words) {
        krcLine += `${word.text}<${word.start},${word.duration}>`;
      }
      lines.push(krcLine);
    }
  }

  return lines.join('\n');
}

/**
 * 解碼 KRC 中的 HTML 實體
 */
function decodeKrcEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

/**
 * 將 KRC 逐字格式轉換為 LRC 逐行格式
 */
function krcToLrc(krcText) {
  const lines = krcText.split('\n');
  const lrcLines = [];

  for (const line of lines) {
    const match = line.match(/^\[(\d{2}:\d{2}\.\d{2,3})\]<\d+>(.*)/);
    if (match) {
      lrcLines.push(`[${match[1]}]${match[2].replace(/<\d+,\d+>/g, '')}`);
    }
  }

  return lrcLines.join('\n');
}

module.exports = { krcDecode, krcToLrc };
