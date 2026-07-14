/**
 * 智慧歌詞引擎 v2 - API 聚合瀑布式搜尋 (Phase 4)
 * 
 * Phase 4 增強：
 * - 自動羅馬化：搜尋到歌詞後，非同步產生羅馬拼音
 * - 每行/每字 phonetic 欄位供前端雙語渲染
 * - 羅馬化不阻擋播放：先回傳原文，算好後透過 Socket 即時更新
 */
const he = require('he');
const { krcDecode } = require('./krc-decoder');
const { parseTTML, cleanQuery } = require('./ttml-parser');
const { parseLrc, parseTimestampToMs, msToLrcTime } = require('./lrc-parser');
const { cleanLyrics } = require('./lyrics-cleaner');
const { fetchWithTimeout } = require('../utils/helpers');
const { romanize, addRomanization, needsRomanization } = require('./romanizer');
const { createLogger } = require('../utils/logger');
const log = createLogger('Lyrics');

// ─── 時長驗證閾值（±5 秒）───
const DURATION_TOLERANCE = 5;
// 自動抓取與候選列表共用的來源順位。網易保留為最後備援，不搶使用者指定的五個來源。
const LYRICS_SOURCE_PRIORITY = Object.freeze([
  'betterlyrics', 'paxsenix', 'kugou', 'qqmusic', 'lrclib', 'netease',
]);
const LYRICS_CACHE_VERSION = 'v3-source-priority-credit-cleaning';

// ─── 歌詞快取（記憶體 + 磁碟持久化）───
const fs = require('fs');
const path = require('path');

const lyricsCache = new Map();
const _config = require('../utils/load-config');
const CACHE_TTL = (_config.cacheDays || 7) * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = _config.maxCacheEntries || 500; // 防止快取檔無限膨脹
const CACHE_DIR = path.join(__dirname, '..', '..', 'data');
const CACHE_FILE = path.join(CACHE_DIR, 'lyrics-cache.json');

let _cacheSaveTimer = null;

/**
 * 啟動時從磁碟載入歌詞快取
 * 任何錯誤（檔案不存在、JSON 損毀）都靜默忽略，絕不影響啟動
 */
function loadCacheFromDisk() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return;
    const now = Date.now();
    let loaded = 0;
    for (const [key, value] of entries) {
      if (value && value.timestamp && now - value.timestamp < CACHE_TTL) {
        lyricsCache.set(key, value);
        loaded++;
      }
    }
    log.info(`歌詞快取已載入: ${loaded} 筆 (${CACHE_FILE})`);
  } catch (err) {
    log.warn(`歌詞快取載入失敗（將重新建立）: ${err.message}`);
  }
}

/**
 * 延遲寫入磁碟（5 秒 debounce，避免頻繁 I/O）
 * 羅馬化是非同步完成並就地修改快取物件，延遲寫入也能順帶存到拼音結果
 */
function scheduleCacheSave() {
  if (_cacheSaveTimer) clearTimeout(_cacheSaveTimer);
  _cacheSaveTimer = setTimeout(saveCacheToDisk, 5000);
}

function saveCacheToDisk() {
  _cacheSaveTimer = null;
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

    // 超量時依時間淘汰最舊的項目
    let entries = [...lyricsCache.entries()];
    if (entries.length > MAX_CACHE_ENTRIES) {
      entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      entries = entries.slice(0, MAX_CACHE_ENTRIES);
      lyricsCache.clear();
      for (const [k, v] of entries) lyricsCache.set(k, v);
    }

    // 先寫暫存檔再改名，避免寫入中途斷電造成快取檔損毀
    const tmpFile = CACHE_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(entries), 'utf-8');
    fs.renameSync(tmpFile, CACHE_FILE);
  } catch (err) {
    log.warn(`歌詞快取寫入失敗: ${err.message}`);
  }
}

// 程式結束前盡量把快取落地
process.on('exit', () => {
  if (_cacheSaveTimer) {
    clearTimeout(_cacheSaveTimer);
    try { saveCacheToDisk(); } catch (e) { /* 靜默 */ }
  }
});

loadCacheFromDisk();

// ─── 製作資訊行過濾（參考 Metrolist KuGou.normalize）───
// 許多來源在歌詞開頭/結尾塞「作詞：xxx / 作曲：xxx / Producer: xxx」等非歌詞行，
// 這些不該當成歌詞顯示。只在首尾各 8 行內、且符合製作資訊關鍵字時移除，避免誤砍正文。
// 清洗已集中到 lyrics-cleaner.cleanLyrics（製作資訊 + 純音樂提示 + 重複行 + 空白正規化）。
function stripCreditLines(lines) {
  return cleanLyrics(lines);
}

/**
 * 毫秒轉 mm:ss.xx 標籤（歌詞選擇器預覽用）
 */
function msToLabel(ms) {
  if (typeof ms !== 'number' || ms < 0) return '00:00.00';
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  const cs = Math.floor((ms % 1000) / 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// ─── Apple Music Token 快取 ───
let appleMusicToken = null;
let appleMusicTokenExpiry = 0;

// ─── Socket.io 實例（供羅馬化完成後推播用）───
let _io = null;

/**
 * 設定 Socket.io 實例（由 server/index.js 呼叫）
 */
function setIo(io) {
  _io = io;
}

class LyricsEngine {
  /**
   * 主搜尋入口 - 瀑布式搜尋
   * @param {string} artist
   * @param {string} title
   * @param {number} duration
   * @param {boolean} autoRomanize - 是否自動產生羅馬拼音（預設 true）
   * @returns {Promise<Object|null>} { lyrics, type, source, romanizedLyrics? }
   */
  static async search(artist, title, duration = 0, autoRomanize = true) {
    // 驗證 artist 和 title 為字串
    if (typeof artist !== 'string') {
      log.warn(`search 收到非字串的 artist: ${typeof artist}`);
      artist = String(artist || '');
    }
    if (typeof title !== 'string') {
      log.warn(`search 收到非字串的 title: ${typeof title}`);
      title = String(title || '');
    }

    const query = artist ? `${artist} - ${title}` : title;
    // 排序或清洗規則改變時必須換版本，否則舊快取會讓新順位與 cleaner 看起來完全沒生效。
    const cacheKey = `${LYRICS_CACHE_VERSION}:${query}:${duration}:${autoRomanize}`;

    const cached = lyricsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      log.info(`✓ 使用快取: "${query}"`);
      return cached.result;
    }

    const searchStart = Date.now();
    log.info(`開始搜尋: "${query}" (時長: ${duration}s)`);

    // 使用者指定品質優先：BetterLyrics → Apple Music → 酷狗 → QQ → LRCLIB；網易最後備援。
    const sourceFns = {
      betterlyrics: () => this.searchBetterLyrics(artist, title, duration),
      paxsenix: () => this.searchPaxsenix(artist, title, duration),
      kugou: () => this.searchKugou(artist, title, duration),
      qqmusic: () => this.searchQQMusic(artist, title, duration),
      lrclib: () => this.searchLrclib(artist, title, duration),
      netease: () => this.searchNetease(artist, title, duration),
    };
    const sources = LYRICS_SOURCE_PRIORITY.map((name) => ({ name, fn: sourceFns[name] }));

    for (const source of sources) {
      const sourceStart = Date.now();
      try {
        log.info(`嘗試來源: ${source.name}`);
        const result = await source.fn();
        const sourceDuration = Date.now() - sourceStart;
        if (result && result.lyrics) {
          const totalDuration = Date.now() - searchStart;
          log.info(`✓ 找到歌詞 (來源: ${source.name}, 類型: ${result.type})`);
          log.perf(`lyrics-${source.name}`, sourceDuration, { query });
          log.perf('lyrics-total', totalDuration, { query, source: source.name });

          // 解析歌詞為結構化資料
          const parsedLyrics = result.type === 'krc'
            ? this.parseKrc(result.lyrics)
            : this.parseLrc(result.lyrics);

          // Phase 5: 提取 LRC offset（如果有）
          if (parsedLyrics._lrcOffset !== undefined) {
            result.lrcOffset = parsedLyrics._lrcOffset;
            delete parsedLyrics._lrcOffset;
          }

          // 先回傳原文歌詞（不等待羅馬化）
          result.parsedLyrics = parsedLyrics;

          // 非同步羅馬化（不阻擋回傳）
          if (autoRomanize && needsRomanization(parsedLyrics)) {
            this._asyncRomanize(parsedLyrics, result.type, query);
          }

          lyricsCache.set(cacheKey, { result, timestamp: Date.now() });
          scheduleCacheSave();
          return result;
        } else {
          log.info(`來源 ${source.name} 未找到結果 (${sourceDuration}ms)`);
        }
      } catch (err) {
        const sourceDuration = Date.now() - sourceStart;
        log.warn(`來源 ${source.name} 失敗 (${sourceDuration}ms): ${err.message}`);
      }
    }

    const totalDuration = Date.now() - searchStart;
    log.info(`✗ 所有來源均未找到歌詞 (${totalDuration}ms)`);
    log.perf('lyrics-total', totalDuration, { query, result: 'not_found' });    return null;
  }

  /**
   * 歌詞選擇器專用：並行查詢所有來源，回傳每個來源的候選結果（不只第一個命中）
   * 給使用者手動挑選用。每筆含：來源名稱、類型（逐句 lrc / 逐字 krc）、
   * 時長、前 3 句預覽（含時間軸）、完整歌詞。
   *
   * @param {string} artist
   * @param {string} title
   * @param {number} duration - 音檔時長（秒），用於標記時長吻合度
   * @returns {Promise<Array>} 候選歌詞陣列，依時長吻合度與類型排序
   */
  static async searchAllSources(artist, title, duration = 0) {
    if (typeof artist !== 'string') artist = String(artist || '');
    if (typeof title !== 'string') title = String(title || '');

    const sourceLabels = {
      betterlyrics: 'BetterLyrics',
      paxsenix: 'Apple Music',
      lrclib: 'LRCLIB',
      netease: '網易雲音樂',
      kugou: '酷狗音樂',
      qqmusic: 'QQ音樂',
    };

    // 仍並行查詢全部來源，但顯示順序與自動抓取順位一致。
    const sourceFns = {
      betterlyrics: () => this.searchBetterLyrics(artist, title, duration),
      paxsenix: () => this.searchPaxsenix(artist, title, duration),
      kugou: () => this.searchKugou(artist, title, duration),
      qqmusic: () => this.searchQQMusic(artist, title, duration),
      lrclib: () => this.searchLrclib(artist, title, duration),
      netease: () => this.searchNetease(artist, title, duration),
    };
    const sources = LYRICS_SOURCE_PRIORITY.map((name) => ({ name, fn: sourceFns[name] }));

    // 並行查詢所有來源（互不阻擋，全部跑完才回傳）
    const settled = await Promise.allSettled(
      sources.map(s => s.fn().then(r => ({ name: s.name, result: r })))
    );

    const candidates = [];
    for (const outcome of settled) {
      if (outcome.status !== 'fulfilled' || !outcome.value.result || !outcome.value.result.lyrics) continue;
      const { name, result } = outcome.value;

      try {
        const parsed = result.type === 'krc' ? this.parseKrc(result.lyrics) : this.parseLrc(result.lyrics);
        const lines = Array.isArray(parsed) ? parsed : [];
        if (lines.length === 0) continue;

        // 前 3 句預覽（含時間軸，毫秒轉 mm:ss.xx）
        const preview = lines.slice(0, 3).map(l => ({
          time: l.time,
          timeLabel: msToLabel(l.time),
          text: l.text || '',
        }));

        // 時長吻合度：用「最後一句歌詞的時間」對比音檔長度。
        // 注意：末句時間天生會比歌曲短（前奏/間奏/尾奏），不能用 ±5s 硬比，
        // 否則幾乎永遠判定不吻合。改為「末句不超過歌曲長度太多，且落在結尾 45s 內」。
        const lyricDuration = lines.length > 0 ? Math.round(lines[lines.length - 1].time / 1000) : 0;
        const durationDiff = duration > 0 && lyricDuration > 0 ? Math.abs(duration - lyricDuration) : null;
        const durationMatch = duration > 0 && lyricDuration > 0
          && lyricDuration <= duration + 8
          && (duration - lyricDuration) <= 45;

        candidates.push({
          id: `${name}-${candidates.length}`,
          source: name,
          sourceLabel: sourceLabels[name] || name,
          type: result.type,                       // 'lrc' | 'krc'
          isWordByWord: result.type === 'krc',      // 逐字
          lineCount: lines.length,
          lyricDuration,
          durationDiff,
          durationMatch,
          preview,
          lyrics: result.lyrics,                    // 完整原始歌詞（供選用時直接套用）
          sourcePriority: LYRICS_SOURCE_PRIORITY.indexOf(name),
        });
      } catch (e) {
        log.warn(`解析 ${name} 候選失敗: ${e.message}`);
      }
    }

    // 排序：使用者指定來源順位 → 時長吻合 → 逐字 → 行數。
    candidates.sort((a, b) => {
      if (a.sourcePriority !== b.sourcePriority) return a.sourcePriority - b.sourcePriority;
      if (a.durationMatch !== b.durationMatch) return a.durationMatch ? -1 : 1;
      if (a.isWordByWord !== b.isWordByWord) return a.isWordByWord ? -1 : 1;
      return b.lineCount - a.lineCount;
    });

    log.info(`歌詞選擇器：找到 ${candidates.length} 個候選（${artist} - ${title}）`);
    return candidates;
  }

  /**
   * 非同步羅馬化（背景處理，完成後透過 Socket 推播更新）
   * @param {Array} parsedLyrics - 解析後的歌詞行
   * @param {string} type - 'lrc' | 'krc'
   * @param {string} query - 搜尋查詢（用於日誌）
   */
  static async resolveOriginalArtist(title, duration = 0, resolvers = null, timeoutMs = 2800) {
    const clean = String(title || '').trim();
    if (!clean) return null;
    const defaults = [
      async () => {
        const p = new URLSearchParams({ track_name: clean });
        if (duration > 0) p.set('duration', String(Math.round(duration)));
        const r = await fetchWithTimeout(`https://lrclib.net/api/search?${p}`, { headers: { 'User-Agent': 'ElitesandPro/0.7.2' } }, 2400);
        const rows = r.ok ? await r.json() : [];
        const hit = Array.isArray(rows) ? rows.find(x => !duration || !x.duration || Math.abs(x.duration - duration) <= 12) : null;
        return hit?.artistName || '';
      },
      async () => {
        const r = await fetchWithTimeout(`https://music.163.com/api/search/get/web?s=${encodeURIComponent(clean)}&type=1&limit=5`,
          { headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' } }, 2400);
        const rows = r.ok ? (await r.json()).result?.songs : [];
        return rows?.[0]?.artists?.[0]?.name || '';
      },
      async () => {
        const r = await fetchWithTimeout(`https://shc.y.qq.com/soso/fcgi-bin/search_for_qq_cp?w=${encodeURIComponent(clean)}&format=json&p=1&n=5`,
          { headers: { Referer: 'https://y.qq.com/', 'User-Agent': 'Mozilla/5.0' } }, 2400);
        const rows = r.ok ? (await r.json()).data?.song?.list : [];
        return rows?.[0]?.singer?.[0]?.name || '';
      },
    ];
    const tasks = (resolvers || defaults).slice(0, 3).map(fn => Promise.resolve().then(fn).catch(() => ''));
    const timeout = new Promise(resolve => setTimeout(() => resolve(null), timeoutMs));
    const values = await Promise.race([Promise.all(tasks), timeout]);
    if (!values) return null;
    const normalize = v => String(v || "").normalize("NFKC").toLowerCase().replace(/[\s._-]+/g, "");
    const groups = new Map();
    for (const value of values) {
      const label = String(value || '').trim(); const key = normalize(label);
      if (!key) continue;
      const group = groups.get(key) || { artist: label, count: 0 }; group.count++; groups.set(key, group);
    }
    const candidates = [...groups.values()].sort((a, b) => b.count - a.count);
    if (candidates[0]?.count >= 2) return { artist: candidates[0].artist, confidence: candidates[0].count === 3 ? 0.95 : 0.82, candidates: candidates.map(x => x.artist) };
    return { artist: '', confidence: 0, candidates: candidates.map(x => x.artist) };
  }

  /**
   * 非同步羅馬化（背景處理，完成後透過 Socket 推播更新）
   * @param {Array} parsedLyrics - 解析後的歌詞行
   * @param {string} type - 'lrc' | 'krc'
   * @param {string} query - 搜尋查詢（用於日誌）
   */
  static async _asyncRomanize(parsedLyrics, type, query) {
    const romanizeStart = Date.now();
    try {
      log.info(`開始非同步羅馬化: "${query}"`);
      const romanized = await addRomanization(parsedLyrics);

      // 更新 parsedLyrics 中的 phonetic 與 xieyin（諧音）欄位
      for (let i = 0; i < parsedLyrics.length; i++) {
        if (romanized[i]) {
          parsedLyrics[i].phonetic = romanized[i].phonetic;
          parsedLyrics[i].xieyin = romanized[i].xieyin;   // 諧音：之前漏複製，導致諧音永遠不顯示
          if (parsedLyrics[i].words && romanized[i].words) {
            for (let j = 0; j < parsedLyrics[i].words.length; j++) {
              if (romanized[i].words[j]) {
                parsedLyrics[i].words[j].phonetic = romanized[i].words[j].phonetic;
                parsedLyrics[i].words[j].xieyin = romanized[i].words[j].xieyin;
              }
            }
          }
        }
      }

      const romanizeDuration = Date.now() - romanizeStart;

      // 透過 Socket 廣播羅馬化更新
      if (_io) {
        _io.emit('lyrics:romanized', { parsedLyrics, type, query });
        log.info(`✓ 羅馬化完成，已推播: "${query}" (${romanizeDuration}ms)`);
        log.perf('lyrics-romanize', romanizeDuration, { query });
      }

      // 羅馬化結果是就地寫入快取物件的，補一次存檔讓拼音也持久化
      scheduleCacheSave();
    } catch (err) {
      const romanizeDuration = Date.now() - romanizeStart;
      log.warn(`羅馬化失敗: "${query}" (${romanizeDuration}ms): ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════
  // 統一評分函數
  // ═══════════════════════════════════════════

  static scoreMatch({ artist, title, duration, songArtist, songTitle, songDuration, isCover = false }) {
    let score = 0;
    const nArtist = (artist || '').toLowerCase().trim();
    const nTitle = (title || '').toLowerCase().trim();
    const nSongArtist = (songArtist || '').toLowerCase().trim();
    const nSongTitle = (songTitle || '').toLowerCase().trim();

    if (nTitle && nSongTitle) {
      if (nSongTitle.includes(nTitle) || nTitle.includes(nSongTitle)) score += 10;
    }

    if (nArtist && nSongArtist) {
      if (nSongArtist.includes(nArtist) || nArtist.includes(nSongArtist)) {
        score += 8;
      } else {
        const romanizedArtist = romanize(nArtist).toLowerCase();
        const romanizedSongArtist = romanize(nSongArtist).toLowerCase();
        if (romanizedArtist !== nArtist || romanizedSongArtist !== nSongArtist) {
          if (romanizedSongArtist.includes(romanizedArtist) || romanizedArtist.includes(romanizedSongArtist)) {
            score += 6;
          }
        }
        const normalizedA = nArtist.replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
        const normalizedB = nSongArtist.replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
        if (normalizedB.includes(normalizedA) || normalizedA.includes(normalizedB)) {
          score += 5;
        }
      }
    }

    if (duration > 0 && songDuration > 0) {
      const diff = Math.abs(songDuration - duration);
      if (diff <= 2) score += 15;
      else if (diff <= 5) score += 10;
      else if (diff <= 10) score += 3;
    }

    if (isCover) {
      if (nSongTitle.includes('cover') || nSongTitle.includes('翻唱') || nSongArtist.includes('cover')) {
        score += 5;
      }
    } else {
      if (nSongTitle.includes('cover') || nSongTitle.includes('翻唱')) {
        score -= 8;
      }
    }

    return score;
  }

  static detectCover(artist, title) {
    const combined = `${artist} ${title}`.toLowerCase();
    return /cover|翻唱|covered by|arrangement|arr\./i.test(combined);
  }

  // ═══════════════════════════════════════════
  // 來源 1: BetterLyrics
  // ═══════════════════════════════════════════

  static async searchBetterLyrics(artist, title, duration) {
    const cleanedTitle = cleanQuery(title);
    const cleanedArtist = cleanQuery(artist);

    const params = new URLSearchParams();
    params.set('s', cleanedTitle);
    if (cleanedArtist) params.set('a', cleanedArtist);
    if (duration > 0) params.set('d', Math.round(duration).toString());

    const url = `https://lyrics-api.boidu.dev/getLyrics?${params.toString()}`;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
    };
    // boidu 對「未快取」的歌回 401 並要求 X-API-Key；有設 key 才帶（沒 key 仍可抓已快取的熱門歌）。
    const apiKey = process.env.BETTERLYRICS_API_KEY || _config.betterLyricsApiKey;
    if (apiKey) headers['X-API-Key'] = apiKey;
    const response = await fetchWithTimeout(url, { headers }, 15000);

    if (!response.ok) return null;
    const data = await response.json();
    if (!data.ttml) return null;

    const krcText = parseTTML(data.ttml);
    if (!krcText) return null;

    return { lyrics: krcText, type: 'krc', source: 'betterlyrics' };
  }

  // ═══════════════════════════════════════════
  // 來源 2: Paxsenix / Apple Music
  // ═══════════════════════════════════════════

  static async searchPaxsenix(artist, title, duration) {
    try {
      const token = await this.getAppleMusicToken();
      if (!token) return null;

      const searchQuery = encodeURIComponent(`${cleanQuery(artist)} ${cleanQuery(title)}`.trim());
      const searchUrl = `https://amp-api.music.apple.com/v1/catalog/us/search?term=${searchQuery}&types=songs&limit=25&l=en-US&platform=web&format[resources]=map&include[songs]=artists&extend=artistUrl`;

      const searchRes = await fetchWithTimeout(searchUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Origin': 'https://music.apple.com',
          'Referer': 'https://music.apple.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:95.0) Gecko/20100101 Firefox/95.0',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      }, 12000);

      if (!searchRes.ok) return null;

      const searchData = await searchRes.json();
      const songs = searchData.results?.songs?.data;
      if (!songs || songs.length === 0) return null;

      const matchedSong = this.findAppleMusicMatch(searchData, artist, title, duration);
      if (!matchedSong) return null;

      const lyricsUrl = `https://lyrics.paxsenix.org/apple-music/lyrics?id=${matchedSong.id}`;
      const lyricsRes = await fetchWithTimeout(lyricsUrl, {
        headers: { 'User-Agent': 'ElitesandPro/0.6.0' },
      }, 12000);

      if (!lyricsRes.ok) return null;
      const lyricsData = await lyricsRes.json();

      if (lyricsData.ttmlContent) {
        const krcText = parseTTML(lyricsData.ttmlContent);
        if (krcText) return { lyrics: krcText, type: 'krc', source: 'paxsenix' };
      }

      if (lyricsData.elrc) return { lyrics: lyricsData.elrc, type: 'lrc', source: 'paxsenix' };
      if (lyricsData.elrcMultiPerson) return { lyrics: lyricsData.elrcMultiPerson, type: 'lrc', source: 'paxsenix' };

      if (lyricsData.content && Array.isArray(lyricsData.content) && lyricsData.content.length > 0) {
        const krcText = this.paxsenixContentToKrc(lyricsData.content);
        if (krcText) return { lyrics: krcText, type: 'krc', source: 'paxsenix' };
      }

      if (lyricsData.plain) return { lyrics: lyricsData.plain, type: 'txt', source: 'paxsenix' };

      return null;
    } catch (e) {
      log.warn('Paxsenix 搜尋失敗: ' + e.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════
  // 來源 3: LRCLIB
  // ═══════════════════════════════════════════

  static async searchLrclib(artist, title, duration) {
    const cleanedTitle = cleanQuery(title);
    const cleanedArtist = cleanQuery(artist);

    const strategies = [];

    const exactParams = new URLSearchParams();
    if (cleanedArtist) exactParams.set('artist_name', cleanedArtist);
    exactParams.set('track_name', cleanedTitle);
    if (duration > 0) exactParams.set('duration', Math.round(duration).toString());
    strategies.push(`https://lrclib.net/api/search?${exactParams.toString()}`);

    const nameParams = new URLSearchParams();
    if (cleanedArtist) nameParams.set('artist_name', cleanedArtist);
    nameParams.set('track_name', cleanedTitle);
    strategies.push(`https://lrclib.net/api/search?${nameParams.toString()}`);

    strategies.push(`https://lrclib.net/api/search?q=${encodeURIComponent(`${cleanedArtist} ${cleanedTitle}`.trim())}`);
    strategies.push(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanedTitle)}`);

    for (const url of strategies) {
      try {
        const response = await fetchWithTimeout(url, {
          headers: { 'User-Agent': 'ElitesandPro/0.6.0' },
        }, 12000);
        if (!response.ok) continue;

        const results = await response.json();
        if (!Array.isArray(results) || results.length === 0) continue;

        let filtered = results;
        if (duration > 0) {
          const withDuration = results.filter(r => r.duration && Math.abs(r.duration - duration) <= DURATION_TOLERANCE);
          if (withDuration.length > 0) filtered = withDuration;
        }

        const synced = filtered.find(r => r.syncedLyrics);
        if (synced?.syncedLyrics) return { lyrics: synced.syncedLyrics, type: 'lrc', source: 'lrclib' };

        const plain = filtered.find(r => r.plainLyrics);
        if (plain?.plainLyrics) return { lyrics: plain.plainLyrics, type: 'txt', source: 'lrclib' };
      } catch { continue; }
    }

    return null;
  }

  // ═══════════════════════════════════════════
  // 來源 4: 網易雲音樂
  // ═══════════════════════════════════════════

  static async searchNetease(artist, title, duration) {
    const isCover = this.detectCover(artist, title);
    // 搜尋字串先正規化（去括號/feat/官方影片字樣），命中率更高（參考 Metrolist）
    const q = `${cleanQuery(artist)} ${cleanQuery(title)}`.trim() || `${artist} ${title}`.trim();

    for (const endpoint of [
      `https://music.163.com/api/search/get/web?s=${encodeURIComponent(q)}&type=1&offset=0&limit=10`,
      `https://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(q)}&type=1&offset=0&limit=10`,
    ]) {
      try {
        const response = await fetchWithTimeout(endpoint, {
          headers: { 'Referer': 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        }, 10000);
        if (!response.ok) continue;

        const data = await response.json();
        if (!data.result?.songs?.length) continue;

        const matchedSong = this.findBestMatch(data.result.songs, artist, title, duration, isCover);
        if (!matchedSong) continue;

        const lyricUrl = `https://music.163.com/api/song/lyric?id=${matchedSong.id}&lv=1&tv=1`;
        const lyricRes = await fetchWithTimeout(lyricUrl, {
          headers: { 'Referer': 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        }, 10000);
        if (!lyricRes.ok) continue;

        const lyricData = await lyricRes.json();
        let lrcText = lyricData.lrc?.lyric || '';
        if (!lrcText) continue;

        const tlyric = lyricData.tlyric?.lyric || '';
        if (tlyric) lrcText = this.mergeBilingualLrc(lrcText, tlyric);

        return { lyrics: lrcText, type: 'lrc', source: 'netease' };
      } catch { continue; }
    }

    return null;
  }

  // ═══════════════════════════════════════════
  // 來源 5: Kugou
  // ═══════════════════════════════════════════

  static async searchKugou(artist, title, duration) {
    const q = `${cleanQuery(artist)} ${cleanQuery(title)}`.trim() || `${artist} ${title}`.trim();
    const searchQuery = encodeURIComponent(q);
    let hash = null;

    try {
      const mobileUrl = `https://mobileservice.kugou.com/api/v3/search/song?keyword=${searchQuery}&page=1&pagesize=10`;
      const mobileRes = await fetchWithTimeout(mobileUrl, {}, 10000);
      if (mobileRes.ok) {
        const mobileData = await mobileRes.json();
        if (mobileData.data?.info?.length > 0) {
          for (const song of mobileData.data.info) {
            if (duration > 0 && song.duration && Math.abs(song.duration - duration) <= DURATION_TOLERANCE) {
              hash = song.hash;
              break;
            }
          }
          if (!hash) hash = mobileData.data.info[0].hash;
        }
      }
    } catch (e) {
      log.warn('Kugou mobile search 失敗: ' + e.message);
    }

    let candidates = null;

    if (hash) {
      try {
        const krcsUrl = `https://krcs.kugou.com/search?ver=1&man=yes&client=pc&hash=${hash}&album_audio_id=0`;
        const krcsRes = await fetchWithTimeout(krcsUrl, {}, 10000);
        if (krcsRes.ok) {
          const krcsData = await krcsRes.json();
          if (krcsData.candidates?.length > 0) candidates = krcsData.candidates;
        }
      } catch (e) {
        log.warn('Kugou krcs search 失敗: ' + e.message);
      }
    }

    if (!candidates) {
      try {
        const searchUrl = `https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${searchQuery}&duration=${duration > 0 ? Math.round(duration * 1000) : 0}`;
        const searchRes = await fetchWithTimeout(searchUrl, {}, 10000);
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          if (searchData.candidates?.length > 0) candidates = searchData.candidates;
        }
      } catch (e) {
        log.warn('Kugou lyrics search 失敗: ' + e.message);
      }
    }

    if (!candidates?.length) return null;

    let matched = candidates.find(c => c.productFrom === '官方推荐歌词') || candidates[0];
    if (duration > 0) {
      const durationMatch = candidates.find(c => {
        const cDuration = c.duration ? c.duration / 1000 : 0;
        return cDuration > 0 && Math.abs(cDuration - duration) <= DURATION_TOLERANCE;
      });
      if (durationMatch) matched = durationMatch;
    }

    const lrcUrl = `https://lyrics.kugou.com/download?ver=1&client=pc&id=${matched.id}&accesskey=${matched.accesskey}&fmt=krc&lrcid=${matched.lrcid || 0}`;
    const lrcRes = await fetchWithTimeout(lrcUrl, {}, 10000);
    if (!lrcRes.ok) return null;

    const lrcData = await lrcRes.json();
    if (!lrcData.content) return null;

    try {
      const krcContent = Buffer.from(lrcData.content, 'base64');
      const decoded = krcDecode(krcContent);
      if (decoded) return { lyrics: decoded, type: 'krc', source: 'kugou' };
    } catch (e) {
      log.warn('KRC 解碼失敗，嘗試 LRC 降級: ' + e.message);
    }

    if (lrcData.lrccontent) {
      return { lyrics: Buffer.from(lrcData.lrccontent, 'base64').toString('utf-8'), type: 'lrc', source: 'kugou' };
    }

    return null;
  }

  // ═══════════════════════════════════════════
  // 來源 6: QQ音樂
  // ═══════════════════════════════════════════

  static async searchQQMusic(artist, title, duration) {
    const isCover = this.detectCover(artist, title);

    try {
      const q = `${cleanQuery(artist)} ${cleanQuery(title)}`.trim() || `${artist} ${title}`.trim();
      const searchQuery = encodeURIComponent(q);
      const searchUrl = `https://shc.y.qq.com/soso/fcgi-bin/search_for_qq_cp?w=${searchQuery}&format=json&p=1&n=10`;

      const searchRes = await fetchWithTimeout(searchUrl, {
        headers: { 'Referer': 'https://y.qq.com/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      }, 10000);
      if (!searchRes.ok) return null;

      const searchData = await searchRes.json();
      const songs = searchData.data?.song?.list;
      if (!songs?.length) return null;

      let matchedSong = null;
      let bestScore = -1;

      for (const song of songs) {
        const songArtist = (song.singer?.[0]?.name || '').toLowerCase().trim();
        const songTitle = (song.songname || '').toLowerCase().trim();
        const songDuration = song.interval || 0;

        const score = this.scoreMatch({
          artist, title, duration,
          songArtist, songTitle,
          songDuration,
          isCover,
        });

        if (score > bestScore) {
          bestScore = score;
          matchedSong = song;
        }
      }

      if (!matchedSong?.songmid) return null;

      const lyricUrl = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${matchedSong.songmid}&g_tk=5381&format=json&inCharset=utf8&outCharset=utf-8&nobase64=1`;
      const lyricRes = await fetchWithTimeout(lyricUrl, {
        headers: { 'Referer': 'https://y.qq.com/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      }, 10000);
      if (!lyricRes.ok) return null;

      const lyricData = await lyricRes.json();
      const hasError = (lyricData.retcode !== undefined && lyricData.retcode !== 0) ||
                       (lyricData.code !== undefined && lyricData.code !== 0);
      if (hasError && !lyricData.lyric) return null;

      let lrcText = lyricData.lyric || '';
      if (!lrcText) return null;

      const trans = lyricData.trans || '';
      if (trans) lrcText = this.mergeBilingualLrc(lrcText, trans);

      return { lyrics: lrcText, type: 'lrc', source: 'qqmusic' };
    } catch (e) {
      log.warn('QQ音樂搜尋失敗: ' + e.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════
  // 輔助方法
  // ═══════════════════════════════════════════

  static findBestMatch(songs, artist, title, duration, isCover = false) {
    if (!songs?.length) return null;

    let bestMatch = null;
    let bestScore = -1;

    for (const song of songs) {
      const songArtist = (song.artists?.[0]?.name || song.artistName || '').toLowerCase().trim();
      const songTitle = (song.name || song.title || '').toLowerCase().trim();
      const songDuration = (song.duration || song.dt || 0) / 1000;

      const score = this.scoreMatch({
        artist, title, duration,
        songArtist, songTitle,
        songDuration,
        isCover,
      });

      if (score > bestScore) {
        bestScore = score;
        bestMatch = song;
      }
    }

    return bestMatch;
  }

  static findAppleMusicMatch(searchData, artist, title, duration) {
    const songs = searchData.results?.songs?.data;
    if (!songs?.length) return null;

    const resources = searchData.resources?.songs || {};
    const isCover = this.detectCover(artist, title);

    let bestMatch = null;
    let bestScore = -1;

    for (const song of songs) {
      const songResource = resources[song.id];
      if (!songResource) continue;

      const attrs = songResource.attributes || {};
      const score = this.scoreMatch({
        artist, title, duration,
        songArtist: (attrs.artistName || '').toLowerCase().trim(),
        songTitle: (attrs.name || '').toLowerCase().trim(),
        songDuration: attrs.durationInMillis ? attrs.durationInMillis / 1000 : 0,
        isCover,
      });

      if (score > bestScore) {
        bestScore = score;
        bestMatch = song;
      }
    }

    return bestMatch;
  }

  /**
   * 只供 YouTube 低信心標題校正。歌名必須實際出現在輸入內容，不能只靠歌手或時長猜測，
   * 避免「楊丞琳 如願」被目錄中另一首楊丞琳歌曲覆蓋。
   */
  static async resolveAppleMusicMetadata({ artist = '', title = '', rawTitle = '', duration = 0 } = {}) {
    const token = await this.getAppleMusicToken();
    if (!token || !title) return null;

    const normalize = (value) => String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/official|musicvideo|lyrics?|karaoke|instrumental|offvocal|backingtrack/gi, '')
      .replace(/官方|完整版|動態歌詞|动态歌词|伴奏|純伴奏|纯伴奏|消音|導唱|导唱|主題曲|主题曲|片尾曲|片頭曲|片头曲/gi, '')
      .replace(/[^\p{L}\p{N}]+/gu, '');
    const inputTitle = normalize(title);
    const inputArtist = normalize(artist);
    const inputAll = normalize(`${rawTitle} ${artist} ${title}`);
    if (inputTitle.length < 2) return null;

    const term = cleanQuery(`${artist} ${title}`.trim()).slice(0, 120);
    const url = `https://amp-api.music.apple.com/v1/catalog/tw/search?term=${encodeURIComponent(term)}&types=songs&limit=20&l=zh-Hant-TW&platform=web&format[resources]=map&include[songs]=artists`;
    const response = await fetchWithTimeout(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Origin': 'https://music.apple.com',
        'Referer': 'https://music.apple.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    }, 12000);
    if (!response.ok) return null;

    const data = await response.json();
    const songs = data.results?.songs?.data || [];
    const resources = data.resources?.songs || {};
    let best = null;
    let bestScore = 0;

    for (const song of songs) {
      const attrs = song.attributes || resources[song.id]?.attributes || {};
      const songTitle = normalize(attrs.name);
      const songArtist = normalize(attrs.artistName);
      if (songTitle.length < 2) continue;

      // 強制 title evidence：目錄歌名必須包含於原輸入，或輸入歌名明確包含目錄歌名。
      const titleContained = inputAll.includes(songTitle) || inputTitle.includes(songTitle) || songTitle.includes(inputTitle);
      if (!titleContained) continue;

      let score = songTitle === inputTitle ? 80 : 58;
      if (inputArtist && (songArtist.includes(inputArtist) || inputArtist.includes(songArtist))) score += 28;
      else if (songArtist && inputAll.includes(songArtist)) score += 22;
      if (duration > 0 && attrs.durationInMillis > 0) {
        const diff = Math.abs(attrs.durationInMillis / 1000 - duration);
        if (diff <= 5) score += 10;
        else if (diff <= 15) score += 5;
      }
      if (score > bestScore) {
        bestScore = score;
        best = { artist: attrs.artistName || artist, title: attrs.name || title, confidence: Math.min(0.98, score / 100) };
      }
    }

    return bestScore >= 58 ? best : null;
  }

  static async getAppleMusicToken() {
    if (appleMusicToken && Date.now() < appleMusicTokenExpiry - 300000) {
      return appleMusicToken;
    }

    const tokenStart = Date.now();
    try {
      const pageRes = await fetchWithTimeout('https://beta.music.apple.com', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      }, 10000);
      if (!pageRes.ok) return null;

      const pageHtml = await pageRes.text();
      const jsMatch = pageHtml.match(/src="([^"]*index~[^"]*\.js)"/);
      if (!jsMatch) return null;

      const jsUrl = jsMatch[1].startsWith('http') ? jsMatch[1] : `https://beta.music.apple.com${jsMatch[1]}`;
      const jsRes = await fetchWithTimeout(jsUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      }, 10000);
      if (!jsRes.ok) return null;

      const jsText = await jsRes.text();
      // 完整 JWT 三段式（header.payload.signature），比舊版 /eyJh([^"]*)/ 穩，避免抓到截斷或非 token 字串
      const tokenMatch = jsText.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
      if (!tokenMatch) return null;

      appleMusicToken = tokenMatch[0];
      appleMusicTokenExpiry = Date.now() + 50 * 60 * 1000;
      const tokenDuration = Date.now() - tokenStart;
      log.info('✓ 取得 Apple Music Token (' + tokenDuration + 'ms)');
      log.perf('apple-music-token', tokenDuration);
      return appleMusicToken;
    } catch (e) {
      const tokenDuration = Date.now() - tokenStart;
      log.warn('Apple Music Token 取得失敗 (' + tokenDuration + 'ms): ' + e.message);
      return null;
    }
  }

  static paxsenixContentToKrc(content) {
    if (!Array.isArray(content) || content.length === 0) return null;

    const lines = [];
    for (const line of content) {
      if (line.timestamp == null) continue;

      const lineStartMs = line.timestamp;
      const lineDurationMs = line.duration || (line.endtime ? line.endtime - line.timestamp : 0);
      if (lineDurationMs <= 0) continue;

      const words = [];
      let fullText = '';

      if (Array.isArray(line.text)) {
        for (const word of line.text) {
          if (!word.text) continue;
          fullText += word.text;
          words.push({
            text: word.text,
            start: Math.max(0, word.timestamp - lineStartMs),
            duration: Math.max(0, word.duration || 0),
          });
        }
      }

      if (fullText.trim() && words.length > 0) {
        const timeTag = msToLrcTime(lineStartMs);
        let krcLine = `[${timeTag}]<${lineDurationMs}>`;
        for (const word of words) {
          krcLine += `${word.text}<${word.start},${word.duration}>`;
        }
        lines.push(krcLine);
      }
    }

    return lines.length > 0 ? lines.join('\n') : null;
  }

  static mergeBilingualLrc(original, translation) {
    const origLines = original.split('\n');
    const transMap = {};

    translation.split('\n').forEach((line) => {
      const match = line.match(/^\[(\d{2}:\d{2}\.\d{2,3})\](.*)/);
      if (match) transMap[match[1]] = match[2].trim();
    });

    return origLines.map((line) => {
      const match = line.match(/^\[(\d{2}:\d{2}\.\d{2,3})\](.*)/);
      if (match && transMap[match[1]]) {
        return `${line}\n[${match[1]}]${transMap[match[1]]}`;
      }
      return line;
    }).join('\n');
  }

  static parseLrc(lrcText) {
    const { lines, offset } = parseLrc(lrcText);
    let decoded = lines.map(p => ({ ...p, text: he.decode(p.text) }));
    decoded = stripCreditLines(decoded);
    // Store offset for this track (caller should check and apply)
    if (offset && offset !== 0 && decoded._lrcOffset === undefined) {
      decoded._lrcOffset = offset;
    }
    return decoded;
  }

  static parseKrc(krcText) {
    if (!krcText) return [];

    const lines = krcText.split('\n');
    const parsed = [];

    for (const line of lines) {
      const lineMatch = line.match(/^\[(\d{2}:\d{2}\.\d{2,3})\]<(\d+)>/);
      if (!lineMatch) continue;

      const lineTime = parseTimestampToMs(lineMatch[1]);
      const lineDuration = parseInt(lineMatch[2], 10);
      const remaining = line.substring(line.indexOf('>') + 1);

      const words = [];
      const wordRegex = /([^<\[\]]+)(?:<(\d+),(\d+)>)/g;
      let wordMatch;
      let fullText = '';

      while ((wordMatch = wordRegex.exec(remaining)) !== null) {
        let wordText = he.decode(wordMatch[1]);
        // 清理混入文字的數字計時殘留（某些來源的 KRC 格式不規範）
        wordText = wordText.replace(/\d+\.?\d*,\d+\.?\d*>?/g, '').replace(/>\s*$/g, '');
        if (!wordText.trim()) continue;
        fullText += wordText;
        words.push({
          text: wordText,
          start: parseInt(wordMatch[2], 10),
          duration: parseInt(wordMatch[3], 10),
          phonetic: '',
        });
      }

      if (words.length > 0) {
        parsed.push({ time: lineTime, duration: lineDuration, text: fullText, words, phonetic: '' });
      }
    }

    parsed.sort((a, b) => a.time - b.time);
    return stripCreditLines(parsed);
  }

  static clearCache() {
    lyricsCache.clear();
  }
}

module.exports = { LyricsEngine, setIo, LYRICS_SOURCE_PRIORITY };
