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
const { msToKrcTime, escapeTimedWord } = require('../utils/time-utils');

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
    if (buffer.length > 4 * 1024 * 1024) return null;

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
    const rawText = zlib.inflateSync(decrypted, { maxOutputLength: 4 * 1024 * 1024 }).toString('utf-8');

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
// 酷狗 KRC 把翻譯（type 1）與羅馬音（type 0）放在 [language:base64(JSON)] 這一行，
// lyricContent 依序對應每一個有時間的歌詞行。舊版連這行一起丟掉，酷狗逐字歌詞永遠沒有翻譯。
function krcTranslations(rawText) {
  const m = rawText.match(/^\[language:([A-Za-z0-9+/=\s]+)\]\s*$/m);
  if (!m) return null;
  try {
    const data = JSON.parse(Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf-8'));
    const entry = Array.isArray(data && data.content) ? data.content.find((c) => c && c.type === 1 && Array.isArray(c.lyricContent)) : null;
    return entry ? entry.lyricContent.map((row) => (Array.isArray(row) ? row.join('') : String(row || '')).trim()) : null;
  } catch (_) {
    return null;
  }
}

function parseKrcCustom(rawText) {
  const lines = rawText.split('\n');
  const output = [];
  const translationRows = krcTranslations(rawText);
  const translationLines = [];
  let timedIndex = -1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^\[(ti|ar|al|by|offset):/.test(trimmed)) continue;

    const lineMatch = trimmed.match(/^\[(\d+),(\d+)\](.*)/);
    if (!lineMatch) continue;
    timedIndex += 1;

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
        krcLine += `${escapeTimedWord(word.text)}<${word.start},${word.duration}>`;
      }
      output.push(krcLine);
      const translation = translationRows && translationRows[timedIndex];
      if (translation && translation !== '//' && translation !== fullText.trim()) {
        translationLines.push(`[${timeTag}]${translation.replace(/</g, '＜')}`);
      }
    }
  }

  // 譯文用「[時間]文字」純文字行接在後面（同 appendTranslationLines），parseKrc 會依時間收進對應那一行。
  return output.concat(translationLines).join('\n');
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
        krcLine += `${escapeTimedWord(word.text)}<${word.start},${word.duration}>`;
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
 * 已解密的酷狗 KRC 文字（使用者自己用工具解出來的 .krc 文字檔）轉成內部 KRC 格式。
 * 支援新版 [startMs,durationMs]<wordStart,wordDuration,flag>word 與舊版 XML。
 * @param {string} rawText
 * @returns {string} 轉不出任何一行時回傳空字串
 */
function krcTextToKrc(rawText) {
  const text = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  return text.trim().startsWith('<') ? parseKrcXml(text) : parseKrcCustom(text);
}

module.exports = { krcDecode, krcTextToKrc };
