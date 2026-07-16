/**
 * 歌詞相關 socket 事件
 *
 * 涵蓋：每首歌的時間偏移（offset）、歌詞外觀/位置設定、手動歌詞覆蓋（貼上/上傳）。
 */

const { createLogger } = require('../../utils/logger');
const { LyricsEngine } = require('../../services/lyrics-engine');
const { addRomanization, needsRomanization } = require('../../services/romanizer');
const { sanitizeParsedLyrics, sanitizeJsonObject, MAX_LYRICS_LENGTH } = require('../../utils/track-schema');

const log = createLogger('Socket');

const LYRIC_TEMPLATES = ['classic', 'luminous', 'partita', 'tilt', 'mindscape', 'ktv', 'columnflow'];

function sanitizeLyricTemplateSettings(value) {
  if (!value || typeof value !== 'object') return undefined;
  const out = {};
  LYRIC_TEMPLATES.forEach((id) => {
    if (value[id] && typeof value[id] === 'object') {
      out[id] = { ...value[id], template: id };
      delete out[id].lyricTemplateSettings;
      delete out[id].lyricPresets;
      if (id === 'columnflow' && out[id].columnflowVariant && !['sen', 'fuda'].includes(out[id].columnflowVariant)) {
        delete out[id].columnflowVariant;
      }
      if (id === 'columnflow' && out[id].columnflowPlacement && !['left', 'right', 'split'].includes(out[id].columnflowPlacement)) {
        delete out[id].columnflowPlacement;
      }
    }
  });
  return out;
}

function sanitizeLyricPresets(value) {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((p) => p && typeof p.name === 'string' && p.settings && typeof p.settings === 'object')
    .slice(0, 24)
    .map((p, i) => ({
      id: String(p.id || Date.now() + '-' + i),
      name: p.name.slice(0, 40),
      settings: { ...p.settings },
    }));
}

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 * @param {ReturnType<import('../../state/app-state').createAppState>} ctx
 */
function registerLyricsHandlers(io, socket, ctx) {
  const {
    playState, trackOffsets, manualLyricsCache,
    persistState, broadcastState,
  } = ctx;

  // ─── 時間偏移控制 ───

  socket.on('offset:adjust', (data) => {
    const { trackId, delta } = data;

    // 驗證 trackId 為字串
    if (!trackId || typeof trackId !== 'string') {
      log.warn(`offset:adjust 收到無效的 trackId: ${trackId}`);
      return;
    }
    // 驗證 delta 為數字
    if (typeof delta !== 'number' || !isFinite(delta)) {
      log.warn(`offset:adjust 收到無效的 delta: ${delta}`);
      return;
    }

    // 將 delta 限制在 ±10s 範圍內
    const clampedDelta = Math.max(-10000, Math.min(10000, delta));

    const currentOffset = trackOffsets.get(trackId) || 0;
    const newOffset = currentOffset + clampedDelta;
    trackOffsets.set(trackId, newOffset);

    // 如果是當前播放的歌曲，更新即時 offset
    if (playState.currentTrack && playState.currentTrack.id === trackId) {
      playState.currentOffset = newOffset;
    }

    log.info(`Offset 調整: ${trackId}: ${currentOffset}ms → ${newOffset}ms (Δ${clampedDelta}ms)`);

    io.emit('offset:update', { trackId, offset: newOffset });
    broadcastState();
    persistState();
  });

  socket.on('offset:set', (data) => {
    const { trackId, offset } = data;

    // 驗證 trackId 為字串
    if (!trackId || typeof trackId !== 'string') {
      log.warn(`offset:set 收到無效的 trackId: ${trackId}`);
      return;
    }
    // 驗證 offset 為數字
    if (typeof offset !== 'number' || !isFinite(offset)) {
      log.warn(`offset:set 收到無效的 offset: ${offset}`);
      return;
    }

    // 將 offset 限制在 ±10000ms 範圍內
    const clampedOffset = Math.max(-10000, Math.min(10000, offset));
    trackOffsets.set(trackId, clampedOffset);

    if (playState.currentTrack && playState.currentTrack.id === trackId) {
      playState.currentOffset = clampedOffset;
    }

    log.info(`Offset 設定: ${trackId}: ${clampedOffset}ms`);

    io.emit('offset:update', { trackId, offset: clampedOffset });
    broadcastState();
  });

  socket.on('offset:reset', (trackId) => {
    if (!trackId) return;

    trackOffsets.delete(trackId);

    if (playState.currentTrack && playState.currentTrack.id === trackId) {
      playState.currentOffset = 0;
    }

    log.info(`Offset 重置: ${trackId}`);
    io.emit('offset:update', { trackId, offset: 0 });
    broadcastState();
    persistState();
  });

  // ─── 歌詞外觀/位置設定 ───

  socket.on('lyric-settings:update', (settings, ack) => {
    settings = sanitizeJsonObject(settings);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      if (typeof ack === 'function') ack({ ok: false, error: '歌詞設定格式無效' });
      return;
    }
    // 排版模板白名單防呆：未知值不落地，避免顯示端收到無法辨識的模板 id
    if (settings.template && !LYRIC_TEMPLATES.includes(settings.template)) {
      delete settings.template;
    }
    const templateSettings = sanitizeLyricTemplateSettings(settings.lyricTemplateSettings);
    if (templateSettings) settings.lyricTemplateSettings = templateSettings;
    else delete settings.lyricTemplateSettings;
    const lyricPresets = sanitizeLyricPresets(settings.lyricPresets);
    if (lyricPresets) settings.lyricPresets = lyricPresets;
    else delete settings.lyricPresets;
    // 動畫強度（folia 系模板用）白名單
    if (settings.animationIntensity && !['calm', 'normal', 'chaotic'].includes(settings.animationIntensity)) {
      delete settings.animationIntensity;
    }
    // 歌詞水平位置白名單
    if (settings.lyricPosition && !['center', 'left', 'right', 'split'].includes(settings.lyricPosition)) {
      delete settings.lyricPosition;
    }
    if (settings.columnflowVariant && !['sen', 'fuda'].includes(settings.columnflowVariant)) {
      delete settings.columnflowVariant;
    }
    if (settings.columnflowPlacement && !['left', 'right', 'split'].includes(settings.columnflowPlacement)) {
      delete settings.columnflowPlacement;
    }
    // 合併（容許部分更新）
    playState.lyricSettings = { ...playState.lyricSettings, ...settings };
    // 只發 lyric-settings:update（顯示端據此直接套 CSS 變數）。
    // 不再 broadcastState()：整包 state:sync 會讓顯示端跑到 setRomanizationMode/狀態恢復等流程、
    // 重渲染當前行 → 每次拖滑桿 OBS 都重跑入場動畫+粒子（卡頓感來源）。設定本來就不需要整包同步。
    io.emit('lyric-settings:update', playState.lyricSettings);
    persistState((result) => {
      if (typeof ack === 'function') ack(result);
    });
  });

  // ─── 手動歌詞覆蓋 ───

  socket.on('lyrics:manual', (data) => {
    if (!data || typeof data !== 'object') return;
    const { trackId, lyrics, lyricsType } = data;
    let parsedLyrics = data.parsedLyrics;

    // 驗證 trackId 為字串
    if (!trackId || typeof trackId !== 'string') {
      log.warn('lyrics:manual 收到無效的 trackId');
      return;
    }
    // 驗證 lyrics 為非空字串
    if (!lyrics || typeof lyrics !== 'string' || !lyrics.trim()) {
      log.warn(`lyrics:manual 收到無效的歌詞內容: trackId=${trackId}`);
      return;
    }
    // 驗證歌詞長度上限（5MB）
    if (lyrics.length > MAX_LYRICS_LENGTH) {
      log.warn(`lyrics:manual 歌詞內容過大: ${lyrics.length} bytes (上限 1MB), trackId=${trackId}`);
      return;
    }

    if (Array.isArray(parsedLyrics)) parsedLyrics = sanitizeParsedLyrics(parsedLyrics);

    // 若前端沒帶 parsedLyrics（例如從「歌詞選擇器」套用，parsedLyrics 為 null），
    // 伺服器自行解析，否則後面的羅馬化 / 諧音判斷拿到 null 會直接跳過 → 拼音諧音永遠不出現。
    if (!Array.isArray(parsedLyrics) || parsedLyrics.length === 0) {
      try {
        parsedLyrics = (lyricsType === 'krc')
          ? LyricsEngine.parseKrc(lyrics)
          : LyricsEngine.parseLrc(lyrics);
      } catch (e) {
        log.warn(`lyrics:manual 伺服器端解析失敗: ${e.message}`);
        parsedLyrics = null;
      }
    }

    manualLyricsCache.set(trackId, {
      lyrics,
      lyricsType: lyricsType || 'lrc',
      parsedLyrics: parsedLyrics || null,
      source: 'manual',
      timestamp: Date.now(),
    });

    log.info(`手動歌詞已暫存: ${trackId} (類型: ${lyricsType || 'lrc'}, ${lyrics.length} 字元)`);

    // 同步更新 playState.playlist 裡對應的項目（不限目前播放中的那首）。
    // 沒有這步的話：getPublicState() 組 enrichedPlaylist 時是 `...playState.playlist 裡的舊物件`，
    // 只補 offset/pitch/manualLyrics 布林值，不含歌詞內容——下一次任何 broadcastState()（幾乎每個
    // socket 事件都會觸發）都會用這份「沒有歌詞」的舊快照覆蓋掉面板剛套用好的歌詞準備度顯示。
    const plTrack = playState.playlist.find((t) => t && t.id === trackId);
    if (plTrack) {
      plTrack.lyrics = lyrics;
      plTrack.lyricsType = lyricsType || 'lrc';
      plTrack.parsedLyrics = parsedLyrics;
    }

    // 如果是當前播放的歌曲，即時更新歌詞
    if (playState.currentTrack && playState.currentTrack.id === trackId) {
      playState.currentTrack.lyrics = lyrics;
      playState.currentTrack.lyricsType = lyricsType || 'lrc';
      playState.currentTrack.parsedLyrics = parsedLyrics;

      // 通知所有客戶端更新歌詞
      io.emit('lyrics:updated', {
        trackId,
        lyrics,
        lyricsType: lyricsType || 'lrc',
        parsedLyrics,
        source: 'manual',
      });
    }

    broadcastState();
    persistState();

    // 手動歌詞也要羅馬化 + 諧音（非同步處理，不阻擋回應）
    // 修正：原本手動貼上的日文歌詞不會產生羅馬拼音與諧音行
    if (parsedLyrics && Array.isArray(parsedLyrics) && needsRomanization(parsedLyrics)) {
      addRomanization(parsedLyrics)
        .then((romanized) => {
          // 更新快取中的 parsedLyrics
          const cached = manualLyricsCache.get(trackId);
          if (cached) cached.parsedLyrics = romanized;

          // 若仍是當前歌曲，推播羅馬化結果給顯示端
          if (playState.currentTrack && playState.currentTrack.id === trackId) {
            playState.currentTrack.parsedLyrics = romanized;
            io.emit('lyrics:romanized', {
              parsedLyrics: romanized,
              type: lyricsType || 'lrc',
              query: 'manual:' + trackId,
            });
            log.info(`✓ 手動歌詞羅馬化完成: ${trackId}`);
          }
        })
        .catch((err) => {
          log.warn(`手動歌詞羅馬化失敗（不影響顯示原文）: ${err.message}`);
        });
    }
  });
}

module.exports = registerLyricsHandlers;
