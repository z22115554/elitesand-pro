/**
 * 歌詞相關 socket 事件
 *
 * 涵蓋：每首歌的時間偏移（offset）、歌詞外觀/位置設定、手動歌詞覆蓋（貼上/上傳）。
 */

const { createLogger } = require('../../utils/logger');
const { LyricsEngine } = require('../../services/lyrics-engine');
const { addRomanization, needsRomanization } = require('../../services/romanizer');
const { sanitizeParsedLyrics, sanitizeJsonObject, MAX_LYRICS_LENGTH, MAX_OFFSET_MS } = require('../../utils/track-schema');
const lyricOffsetSync = require('../../services/lyric-offset-sync');

const log = createLogger('Socket');

// 使用者還在按 +/-0.1s 微調時不要每按一下就送一次；等 10 秒沒再變動才算「定案值」。
const LYRIC_OFFSET_SYNC_DEBOUNCE_MS = 10000;

function scheduleLyricOffsetSync(ctx, trackId, offsetMs) {
  const timers = ctx.lyricOffsetSyncTimers;
  const existing = timers.get(trackId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    timers.delete(trackId);
    lyricOffsetSync.submitOffset({ videoId: trackId, offsetMs })
      .catch((error) => log.warn(`歌詞偏移回饋送出失敗：${error.message}`));
  }, LYRIC_OFFSET_SYNC_DEBOUNCE_MS);
  if (typeof timer.unref === 'function') timer.unref();
  timers.set(trackId, timer);
}

function cancelLyricOffsetSync(ctx, trackId) {
  const existing = ctx.lyricOffsetSyncTimers.get(trackId);
  if (existing) {
    clearTimeout(existing);
    ctx.lyricOffsetSyncTimers.delete(trackId);
  }
}

const LYRIC_TEMPLATES = ['classic', 'pulse', 'facet', 'drift', 'aura', 'ktv', 'columnflow', 'paperstrip', 'mirror', 'typewriter', 'lightboard'];

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
      if (id === 'columnflow' && out[id].columnflowEntrance && !['native', 'drift'].includes(out[id].columnflowEntrance)) {
        delete out[id].columnflowEntrance;
      }
      if (id === 'columnflow' && out[id].columnflowPlacement && !['left', 'right', 'split'].includes(out[id].columnflowPlacement)) {
        delete out[id].columnflowPlacement;
      }
      if (id === 'columnflow' && out[id].columnflowMaxLines !== undefined) {
        if (!Number.isInteger(out[id].columnflowMaxLines) || out[id].columnflowMaxLines < 1 || out[id].columnflowMaxLines > 6) {
          delete out[id].columnflowMaxLines;
        }
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
const KNOWN_LYRIC_SOURCES = ['betterlyrics', 'paxsenix', 'kugou', 'qqmusic', 'lrclib', 'netease', 'manual'];
const normLyricSource = (value) => (KNOWN_LYRIC_SOURCES.includes(value) ? value : 'manual');

function registerLyricsHandlers(io, socket, ctx) {
  const {
    playState, trackOffsets, manualLyricsCache,
    persistState,
  } = ctx;

  // 目前播放中或清單裡對應 trackId 的所有 track 物件（currentTrack 與 playlist 項可能不同參照）。
  const tracksById = (trackId) => {
    const list = [];
    if (playState.currentTrack && playState.currentTrack.id === trackId) list.push(playState.currentTrack);
    for (const t of (Array.isArray(playState.playlist) ? playState.playlist : [])) {
      if (t && t.id === trackId && !list.includes(t)) list.push(t);
    }
    return list;
  };
  const lyricsSourceOf = (trackId) => {
    const t = tracksById(trackId)[0];
    return (t && t.lyricsSource) || '';
  };
  // 把某個偏移值記進「該 track × 該來源」的桶子（換來源後切回來時可還原）。
  const rememberOffsetForSource = (trackId, source, ms) => {
    if (!source) return;
    for (const t of tracksById(trackId)) {
      t.lyricsOffsetsBySource = { ...(t.lyricsOffsetsBySource || {}), [source]: ms };
    }
  };

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

    // 限制的是「調整後的總偏移」，不是單次 delta——先前只夾住單次 delta，累積多次小幅微調
    // （±0.1s／±0.5s 按鈕）就能繞過上限，跟「對齊第一句」一次到位卻被砍掉的結果不一致。
    const currentOffset = trackOffsets.get(trackId) || 0;
    const newOffset = Math.max(-MAX_OFFSET_MS, Math.min(MAX_OFFSET_MS, currentOffset + delta));
    trackOffsets.set(trackId, newOffset);

    // 如果是當前播放的歌曲，更新即時 offset
    if (playState.currentTrack && playState.currentTrack.id === trackId) {
      playState.currentOffset = newOffset;
    }

    rememberOffsetForSource(trackId, lyricsSourceOf(trackId), newOffset);

    log.info(`Offset 調整: ${trackId}: ${currentOffset}ms → ${newOffset}ms (Δ${delta}ms)`);

    io.emit('offset:update', { trackId, offset: newOffset });
    // offset:update 是所有即時端都已訂閱的細粒度事件；不再讓連按對齊鍵
    // 夾帶完整 state:sync，重連時仍會從已更新的 playState 取得正確初始值。
    persistState();
    scheduleLyricOffsetSync(ctx, trackId, newOffset);
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

    const clampedOffset = Math.max(-MAX_OFFSET_MS, Math.min(MAX_OFFSET_MS, offset));
    trackOffsets.set(trackId, clampedOffset);

    if (playState.currentTrack && playState.currentTrack.id === trackId) {
      playState.currentOffset = clampedOffset;
    }

    rememberOffsetForSource(trackId, lyricsSourceOf(trackId), clampedOffset);

    log.info(`Offset 設定: ${trackId}: ${clampedOffset}ms`);

    io.emit('offset:update', { trackId, offset: clampedOffset });
    persistState();
    scheduleLyricOffsetSync(ctx, trackId, clampedOffset);
  });

  socket.on('offset:reset', (trackId) => {
    if (!trackId) return;

    trackOffsets.delete(trackId);
    cancelLyricOffsetSync(ctx, trackId);
    rememberOffsetForSource(trackId, lyricsSourceOf(trackId), 0);

    if (playState.currentTrack && playState.currentTrack.id === trackId) {
      playState.currentOffset = 0;
    }

    log.info(`Offset 重置: ${trackId}`);
    io.emit('offset:update', { trackId, offset: 0 });
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
    if (settings.columnflowEntrance && !['native', 'drift'].includes(settings.columnflowEntrance)) {
      delete settings.columnflowEntrance;
    }
    if (settings.columnflowPlacement && !['left', 'right', 'split'].includes(settings.columnflowPlacement)) {
      delete settings.columnflowPlacement;
    }
    if (settings.columnflowMaxLines !== undefined
      && (!Number.isInteger(settings.columnflowMaxLines) || settings.columnflowMaxLines < 1 || settings.columnflowMaxLines > 6)) {
      delete settings.columnflowMaxLines;
    }
    // 燈牌只吃兩款真點陣字型；未知值不落地（顯示端會退回 cubic11，但別讓髒值進 state）
    if (settings.lightboardFont && !['cubic11', 'boutique9x9'].includes(settings.lightboardFont)) {
      delete settings.lightboardFont;
    }
    // 燈牌間奏跑馬門檻：夾在 1.5–20 秒
    if (settings.lightboardIdleGapMs !== undefined) {
      const g = Math.round(Number(settings.lightboardIdleGapMs));
      settings.lightboardIdleGapMs = Number.isFinite(g) ? Math.max(1500, Math.min(20000, g)) : 2500;
    }
    // 紙帶逐字排向白名單
    if (settings.paperstripOrient && !['horizontal', 'vertical'].includes(settings.paperstripOrient)) {
      delete settings.paperstripOrient;
    }
    // KTV 間奏／結尾自訂字樣：字串、去頭尾空白、限長 40；非字串直接丟掉
    for (const key of ['ktvInterludeText', 'ktvEndingText']) {
      if (settings[key] === undefined) continue;
      if (typeof settings[key] !== 'string') { delete settings[key]; continue; }
      settings[key] = settings[key].replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40);
    }
    // 對話氣泡長間奏貼圖：開關布林化、門檻夾在 3–20 秒
    if (settings.twStickerEnabled !== undefined) {
      settings.twStickerEnabled = !!settings.twStickerEnabled;
    }
    if (settings.twStickerGapMs !== undefined) {
      const g = Math.round(Number(settings.twStickerGapMs));
      settings.twStickerGapMs = Number.isFinite(g) ? Math.max(3000, Math.min(20000, g)) : 6000;
    }
    // 本機字型資源只接受掃描器產生的 opaque ID。實際檔案路徑從不進 state，也不接受
    // 客戶端拼出的 URL；顯示端仍會由 API 再做一次 ID/realpath 驗證。
    // 空字串／null 是「明確清除」：切回內建字體堆疊時，必須把舊的本機字型資源 ID 一起寫掉，
    // 否則 delete 掉這個鍵 → 合併時保留舊值 → 顯示端每次重連都把舊字型 FontFace 疊回堆疊最前面
    // （使用者實測：選過本機字型後怎麼換都換不掉、連內建 Noto 都被蓋住）。
    for (const key of ['fontAssetId', 'fontFamilyLatinAssetId']) {
      if (settings[key] === undefined) continue;
      if (settings[key] === '' || settings[key] === null) { settings[key] = ''; continue; }
      if (typeof settings[key] !== 'string' || !/^[A-Za-z0-9_-]{16,32}$/.test(settings[key])) {
        delete settings[key];
      }
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
    const newSource = normLyricSource(data.source);

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
      source: newSource,
      timestamp: Date.now(),
    });

    log.info(`手動歌詞已暫存: ${trackId} (類型: ${lyricsType || 'lrc'}, ${lyrics.length} 字元)`);

    // 同步更新 playState.playlist 裡對應的項目（不限目前播放中的那首）。
    // P2 的清單摘要雖不再送 lyrics／parsedLyrics，仍從這份原始資料推導 hasLyrics／lyricsType；
    // 若不回寫，下一次 broadcastState() 仍會把面板剛套用好的歌詞準備度覆蓋掉。
    // 換歌詞來源時的時間偏移記憶：把目前偏移存進「舊來源」桶子，載入「新來源」的
    // （沒調過就是 0）。這樣 Apple→QQ→Apple 來回切不用每次重調。
    const oldSource = lyricsSourceOf(trackId);
    if (oldSource && oldSource !== newSource) {
      rememberOffsetForSource(trackId, oldSource, trackOffsets.get(trackId) || 0);
      const bucket = (tracksById(trackId)[0] || {}).lyricsOffsetsBySource || {};
      const restored = Number.isFinite(bucket[newSource]) ? bucket[newSource] : 0;
      trackOffsets.set(trackId, restored);
      if (playState.currentTrack && playState.currentTrack.id === trackId) playState.currentOffset = restored;
      io.emit('offset:update', { trackId, offset: restored });
      log.info(`歌詞來源 ${oldSource}→${newSource}：偏移切換為 ${restored}ms`);
    }
    for (const t of tracksById(trackId)) t.lyricsSource = newSource;

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
        source: newSource,
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
