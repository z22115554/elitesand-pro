/**
 * 播放控制 socket 事件
 *
 * 涵蓋：播放/暫停/seek/上下首、歌詞同步管線（line/word/sync/romanized 純轉播）、
 * 動畫風格與微調、顯示模式（拼音/諧音）、緊急隱藏、變調變速、前奏倒數、音訊錯誤轉播。
 */

const { createLogger } = require('../../utils/logger');
const libraryStore = require('../../services/library-store');
const { addRomanization, needsRomanization } = require('../../services/romanizer');
const { sanitizeTrack, sanitizeJsonObject } = require('../../utils/track-schema');

const log = createLogger('Socket');

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 * @param {ReturnType<import('../../state/app-state').createAppState>} ctx
 */
function registerPlaybackHandlers(io, socket, ctx) {
  const {
    playState, trackOffsets, trackPitch, trackSpeed, manualLyricsCache,
    persistState, emitSetlist, recordSessionSong, broadcastState, getEffectiveLyrics,
  } = ctx;

  socket.on('play:track', (track) => {
    // 驗證 track 必須有 id 和 title
    if (!track || typeof track !== 'object') {
      log.warn(`play:track 收到無效的 track 物件: ${socket.id}`);
      return;
    }
    if (!track.id || typeof track.id !== 'string') {
      log.warn(`play:track 缺少有效的 track.id: ${socket.id}`);
      return;
    }
    if (!track.title || typeof track.title !== 'string') {
      log.warn(`play:track 缺少有效的 track.title: ${socket.id}`);
      return;
    }

    track = sanitizeTrack(track);
    if (!track) {
      log.warn(`play:track schema 驗證失敗: ${socket.id}`);
      return;
    }
    const trackId = track.id;
    // autoplay：面板「真的要播」=true；「載入待命/自動切歌待命」=false。
    // 待命時只載入歌曲（讓顯示端載歌詞），不算開始唱、也不記入已唱歌單。
    const autoplay = track.autoplay !== false;

    // 載入手動歌詞（如果有）
    const manualLyrics = getEffectiveLyrics(trackId);
    if (manualLyrics) {
      track.lyrics = manualLyrics.lyrics;
      track.lyricsType = manualLyrics.lyricsType;
      track.parsedLyrics = manualLyrics.parsedLyrics;
    }

    // 套用該首記憶的 offset / 變調 / 變速（每首獨立，切歌自動回該首的設定）
    const offset = trackOffsets.get(trackId) || 0;
    const savedPitch = trackPitch.has(trackId) ? trackPitch.get(trackId) : 0;
    const savedSpeed = trackSpeed.has(trackId) ? trackSpeed.get(trackId) : 1.0;
    track.pitchShift = savedPitch;
    track.playbackRate = savedSpeed;
    playState.currentTrack = track;
    playState.isPlaying = autoplay;
    playState.currentTime = 0;
    playState.currentOffset = offset;
    playState.pitchShift = savedPitch;
    playState.playbackRate = savedSpeed;
    playState.emergencyHide = false;
    playState.lastStateUpdateTimestamp = Date.now();

    log.info(`播放歌曲: ${track.title} (id: ${trackId}, offset: ${offset}ms, pitch: ${savedPitch}, speed: ${savedSpeed}x)`);

    // 媒體庫：記錄一次播放 + 累加播放次數（連同歌詞/檔名/變調一起存）
    try { libraryStore.recordPlay(track); } catch (e) { /* 不影響播放 */ }

    io.emit('play:track', {
      ...track,
      offset,
      pitchShift: savedPitch,
      playbackRate: savedSpeed,
      manualLyrics: !!manualLyricsCache.has(trackId),
      // 面板據此判斷這是不是自己剛送出的回音（io.emit 會連寄件者自己也收到一份），
      // 不落地進 playState，純粹給面板的 play:track 監聽器做來源判斷用。
      _originSocketId: socket.id,
      // 面板只該聽從「非面板」來源（遙控器）的指令；万一使用者不小心開了兩個面板分頁，
      // 兩邊都是 clientType='controller'，若面板也對其他面板的廣播做出反應，
      // 會形成互相驅動對方換歌→再廣播→對方又反應的無窮迴圈。
      _originClientType: socket.clientType,
    });
    // 廣播該首記憶的變調/變速，讓面板與顯示端套用（每首切換時自動還原）
    io.emit('pitch:update', savedPitch);
    io.emit('speed:update', savedSpeed);
    broadcastState();

    // Setlist：先廣播一次（更新「現在/未唱」）；只有「真的開始播」才記入已唱歌單。
    // 載入待命（autoplay=false，例如自動切到下一首）不記錄 → 等使用者按播放才算唱。
    emitSetlist();
    if (autoplay) recordSessionSong();

    persistState();

    // ─── 嚴重 bug 修正：播放時補做羅馬化 ───
    // 面板握有的 track.parsedLyrics 可能是「羅馬化完成前」的副本（匯入當下非同步羅馬化
    // 還沒跑完／或那時這首不是當前歌），於是顯示端拿到沒有 phonetic/xieyin 的歌詞 →
    // 逐句歌詞的拼音/諧音「不顯示」。這裡在每次播放時，若歌詞缺羅馬化就即時補做並廣播，
    // 確保拼音/諧音一定會出現（逐字 KRC 也以整句羅馬化）。
    try {
      const pl = track.parsedLyrics;
      if (Array.isArray(pl) && pl.length > 0 && needsRomanization(pl) &&
          !pl.some(l => l && (l.phonetic || l.xieyin))) {
        addRomanization(pl).then((romanized) => {
          for (let i = 0; i < pl.length; i++) {
            if (!romanized[i]) continue;
            pl[i].phonetic = romanized[i].phonetic;
            pl[i].xieyin = romanized[i].xieyin;
            if (pl[i].words && romanized[i].words) {
              for (let j = 0; j < pl[i].words.length && j < romanized[i].words.length; j++) {
                if (romanized[i].words[j]) {
                  pl[i].words[j].phonetic = romanized[i].words[j].phonetic;
                  pl[i].words[j].xieyin = romanized[i].words[j].xieyin;
                }
              }
            }
          }
          // 只在仍是當前歌時推播，避免快速切歌時把舊歌詞蓋上去
          if (playState.currentTrack && playState.currentTrack.id === trackId) {
            io.emit('lyrics:romanized', { parsedLyrics: pl, type: track.lyricsType || 'lrc', query: track.title });
            log.info(`播放時補羅馬化完成並推播: ${track.title}`);
          }
          // 把已羅馬化的歌詞存回媒體庫，之後拉回來即時還原、不必再羅馬化
          try { libraryStore.updateMeta(trackId, { lyrics: track.lyrics, lyricsType: track.lyricsType || 'lrc', parsedLyrics: pl }); } catch (e) { /* 靜默 */ }
        }).catch((e) => log.warn(`播放時補羅馬化失敗: ${e.message}`));
      }
    } catch (e) { /* 不影響播放 */ }
  });

  socket.on('play:toggle', (val) => {
    // 有給明確布林值就採用（用於「載入待命=暫停」同步），否則切換
    playState.isPlaying = (typeof val === 'boolean') ? val : !playState.isPlaying;
    playState.lastStateUpdateTimestamp = Date.now();
    log.info(`播放切換: ${playState.isPlaying ? '播放' : '暫停'}`);
    io.emit('play:toggle', playState.isPlaying);
    // 從待命「開始播放」這一刻才算唱這首 → 記入已唱歌單（去重避免暫停/續播重覆記錄）。
    if (playState.isPlaying) recordSessionSong();
    emitSetlist(); // 現在/未唱狀態（playing 旗標）同步
    broadcastState();
  });

  socket.on('play:seek', (time) => {
    playState.currentTime = time;
    playState.lastStateUpdateTimestamp = Date.now();
    io.emit('play:seek', time);
  });

  socket.on('play:prev', () => {
    io.emit('play:prev');
  });

  socket.on('play:next', () => {
    io.emit('play:next');
  });

  // ─── 歌詞同步管線（純轉播）───

  socket.on('lyrics:line', (data) => {
    io.emit('lyrics:line', data);
  });

  socket.on('lyrics:word', (data) => {
    io.emit('lyrics:word', data);
  });

  socket.on('lyrics:sync', (data) => {
    playState.currentTime = data.currentTime;
    playState.lastStateUpdateTimestamp = Date.now();
    io.emit('lyrics:sync', data);
  });

  // 羅馬化歌詞即時更新（來自 LyricsEngine 後台處理）
  socket.on('lyrics:romanized', (data) => {
    io.emit('lyrics:romanized', data);
  });

  // ─── 動畫風格 ───

  socket.on('style:change', (style) => {
    // 防呆：曾有前端 bug 誤發 undefined（socket 序列化成 null）把 state 汙染成 null，
    // 之後每次轉播都讓顯示端刷「未知風格」警告。非字串一律不落地。
    if (typeof style !== 'string' || !style) return;
    playState.style = style;
    // 切換 preset 時清掉舊微調，避免上一個風格的覆蓋值殘留到新風格
    playState.styleOverrides = {};
    log.info(`風格切換: ${style}`);
    io.emit('style:change', style);
    io.emit('style:override', playState.styleOverrides);
    broadcastState();
    persistState();
  });

  // 動畫風格微調（覆蓋當前 preset 的動畫參數）
  socket.on('style:override', (overrides) => {
    const clean = sanitizeJsonObject(overrides);
    playState.styleOverrides = (clean && typeof clean === 'object' && !Array.isArray(clean)) ? clean : {};
    io.emit('style:override', playState.styleOverrides);
    broadcastState();
    persistState();
  });

  // ─── 顯示模式（拼音/諧音）───

  socket.on('romanization:toggle', (enabled) => {
    playState.showRomanization = enabled;
    io.emit('romanization:toggle', enabled);
  });

  socket.on('romanization:mode', (mode) => {
    const VALID_MODES = ['original', 'romanized', 'both', 'xieyin', 'full'];
    if (!VALID_MODES.includes(mode)) {
      log.warn(`忽略無效的顯示模式: ${mode}`);
      return;
    }
    playState.romanizationMode = mode;
    log.info(`顯示模式: ${mode}`);
    io.emit('romanization:mode', mode);
    broadcastState();
    persistState();
  });

  // ─── 緊急隱藏（最高優先權，即時回應）───

  socket.on('emergency:hide', () => {
    playState.emergencyHide = true;
    log.info('緊急隱藏: 啟用');
    io.emit('emergency:hide');
  });

  socket.on('emergency:show', () => {
    playState.emergencyHide = false;
    log.info('緊急隱藏: 停用');
    io.emit('emergency:show');
  });

  socket.on('emergency:toggle', () => {
    playState.emergencyHide = !playState.emergencyHide;
    log.info(`緊急隱藏切換: ${playState.emergencyHide ? '啟用' : '停用'}`);
    if (playState.emergencyHide) {
      io.emit('emergency:hide');
    } else {
      io.emit('emergency:show');
    }
  });

  // ─── 音訊錯誤通知（轉播給所有端）───

  socket.on('audio:error', (data) => {
    log.error(`音訊錯誤: ${data.trackId} - ${data.message}`);
    io.emit('audio:error', data);
  });

  socket.on('audio:skip', (data) => {
    log.info(`自動跳過: ${data.trackId}`);
    io.emit('audio:skip', data);
  });

  // ─── 變調與變速 ───

  socket.on('pitch:change', (semitones) => {
    // 驗證 semitones 為數字且在 -12 到 12 之間
    if (typeof semitones !== 'number' || !isFinite(semitones)) {
      log.warn(`pitch:change 收到無效的 semitones: ${semitones}`);
      return;
    }
    if (semitones < -12 || semitones > 12) {
      log.warn(`pitch:change semitones 超出範圍: ${semitones} (允許 -12 ~ 12)`);
      return;
    }
    playState.pitchShift = Math.max(-12, Math.min(12, semitones));
    playState.lastStateUpdateTimestamp = Date.now();
    log.info(`變調: ${playState.pitchShift} 半音`);
    // 記住「這首歌」的變調（0＝清除記憶，回預設）
    if (playState.currentTrack) {
      const id = playState.currentTrack.id;
      if (playState.pitchShift === 0) trackPitch.delete(id); else trackPitch.set(id, playState.pitchShift);
      try { libraryStore.updateMeta(id, { pitchShift: playState.pitchShift }); } catch (e) { /* 靜默 */ }
    }
    io.emit('pitch:update', playState.pitchShift);
    broadcastState();
    persistState();
  });

  socket.on('speed:change', (rate) => {
    // 驗證 rate 為數字且在 0.5 到 1.5 之間
    if (typeof rate !== 'number' || !isFinite(rate)) {
      log.warn(`speed:change 收到無效的 rate: ${rate}`);
      return;
    }
    if (rate < 0.5 || rate > 1.5) {
      log.warn(`speed:change rate 超出範圍: ${rate} (允許 0.5 ~ 1.5)`);
      return;
    }
    playState.playbackRate = Math.max(0.5, Math.min(1.5, rate));
    playState.lastStateUpdateTimestamp = Date.now();
    log.info(`變速: ${playState.playbackRate}x`);
    // 記住「這首歌」的變速（1.0＝清除記憶，回預設）
    if (playState.currentTrack) {
      const id = playState.currentTrack.id;
      if (playState.playbackRate === 1.0) trackSpeed.delete(id); else trackSpeed.set(id, playState.playbackRate);
      try { libraryStore.updateMeta(id, { playbackRate: playState.playbackRate }); } catch (e) { /* 靜默 */ }
    }
    io.emit('speed:update', playState.playbackRate);
    broadcastState();
    persistState();
  });

  // 前奏倒數提示開關
  socket.on('metronome:toggle', (enabled) => {
    playState.metronomeEnabled = typeof enabled === 'boolean' ? enabled : !playState.metronomeEnabled;
    log.info(`前奏倒數: ${playState.metronomeEnabled ? '啟用' : '停用'}`);
    io.emit('metronome:update', playState.metronomeEnabled);
    broadcastState();
    persistState();
  });
}

module.exports = registerPlaybackHandlers;
