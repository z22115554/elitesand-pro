/**
 * 應用程式狀態容器（單一事實來源）
 *
 * 伺服器所有可變狀態集中在這裡建立：播放狀態、每首歌的記憶（offset/變調/變速/手動歌詞）、
 * 直播 session、setlist 外觀設定。socket 事件 handler 與 Deck HTTP 指令都透過這份 ctx
 * 讀寫狀態，確保多入口（socket / HTTP）看到完全一致的資料。
 *
 * 職責邊界：
 * - 這裡「持有狀態＋提供狀態衍生資料（payload/廣播）＋持久化」
 * - 「事件怎麼回應」屬於 routes/handlers/*，不在這裡
 */

const stateStore = require('../services/state-store');
const setlistStyleSchema = require('../../public/js/setlist-style-schema');
const { createLogger } = require('../utils/logger');
const { sanitizePlaylist, sanitizeJsonObject } = require('../utils/track-schema');

const log = createLogger('State');

// 場景版 setlist 版型（各自持有一份獨立外觀設定；其餘版型共用 shared 份）
const SETLIST_SCENE = ['timeline', 'diagonal', 'constellation'];

/**
 * 建立狀態容器
 * @param {import('socket.io').Server} io - 廣播用
 */
function createAppState(io) {
  // ─── 全局播放狀態 ───
  const playState = {
    currentTrack: null,
    isPlaying: false,
    currentTime: 0,
    playlist: [],
    style: 'cute',
    showRomanization: false,
    romanizationMode: 'original',
    emergencyHide: false,
    // 當前歌曲的時間偏移（毫秒）
    currentOffset: 0,
    // 上次播放狀態更新的精確時間戳（用於 OBS 重連補償）
    lastStateUpdateTimestamp: Date.now(),
    // 變調與變速
    pitchShift: 0,      // 半音偏移，-12 ~ +12
    playbackRate: 1.0,   // 播放速率，0.5 ~ 1.5
    metronomeEnabled: true, // 前奏倒數提示開關
    lyricSettings: {},      // 歌詞外觀/位置設定（由控制面板推送）
    styleOverrides: {},     // 動畫風格微調（速度/放大/光暈等，覆蓋當前 preset）
    setlistTheme: 'glass',  // 直播歌單 OBS 外觀主題（glass/neon/minimal）
    setlistLayout: 'classic', // 直播歌單版型
    // 直播歌單 OBS 外觀細項。預設值單一事實來源見 public/js/setlist-style-schema.js
    setlistStyle: setlistStyleSchema.getDefaultStyle(),
    // 場景版各自獨立的外觀設定（經典＋清單版共用上面的 setlistStyle）
    setlistSceneStyles: {},
  };

  // 場景版各一份完整設定（預設＝共用份的複製）
  SETLIST_SCENE.forEach((k) => { playState.setlistSceneStyles[k] = { ...playState.setlistStyle }; });

  /** 取某版型「生效的那一份」設定 */
  function effSetlistStore(layout) {
    return SETLIST_SCENE.includes(layout) ? playState.setlistSceneStyles[layout] : playState.setlistStyle;
  }

  // ─── 每首歌的記憶（key: track.id）───
  const trackOffsets = new Map();       // offset in ms
  const trackPitch = new Map();         // semitones (-12 ~ 12)
  const trackSpeed = new Map();         // rate (0.5 ~ 1.5)
  const manualLyricsCache = new Map();  // { lyrics, lyricsType, parsedLyrics, source, timestamp }

  // ─── 直播 Session / Setlist ───
  const session = {
    active: false,
    startedAt: null,
    songs: [],
  };

  // ═══════════════════════════════════════════
  // 狀態還原與持久化
  // ═══════════════════════════════════════════

  (function restorePersistedState() {
    const saved = stateStore.loadState();
    if (!saved) return;

    if (Array.isArray(saved.playlist)) playState.playlist = sanitizePlaylist(saved.playlist) || [];
    if (typeof saved.style === 'string') playState.style = saved.style;
    if (saved.styleOverrides && typeof saved.styleOverrides === 'object') playState.styleOverrides = saved.styleOverrides;
    if (typeof saved.romanizationMode === 'string' &&
        ['original', 'romanized', 'both', 'xieyin', 'full'].includes(saved.romanizationMode)) {
      playState.romanizationMode = saved.romanizationMode;
    }
    if (typeof saved.showRomanization === 'boolean') playState.showRomanization = saved.showRomanization;
    if (typeof saved.metronomeEnabled === 'boolean') playState.metronomeEnabled = saved.metronomeEnabled;
    if (saved.lyricSettings && typeof saved.lyricSettings === 'object') {
      playState.lyricSettings = sanitizeJsonObject(saved.lyricSettings) || {};
      // v5 遷移：monet（海報捲軸）模板已移除，殘留在舊 state 的值退回 classic
      if (playState.lyricSettings.template === 'monet') playState.lyricSettings.template = 'classic';
    }

    if (saved.trackOffsets && typeof saved.trackOffsets === 'object') {
      for (const [id, offset] of Object.entries(saved.trackOffsets)) {
        if (typeof offset === 'number') trackOffsets.set(id, offset);
      }
    }
    if (saved.manualLyrics && typeof saved.manualLyrics === 'object') {
      for (const [id, entry] of Object.entries(saved.manualLyrics)) {
        if (entry && typeof entry.lyrics === 'string') manualLyricsCache.set(id, entry);
      }
    }
    if (saved.trackPitch && typeof saved.trackPitch === 'object') {
      for (const [id, v] of Object.entries(saved.trackPitch)) {
        if (typeof v === 'number') trackPitch.set(id, v);
      }
    }
    if (saved.trackSpeed && typeof saved.trackSpeed === 'object') {
      for (const [id, v] of Object.entries(saved.trackSpeed)) {
        if (typeof v === 'number') trackSpeed.set(id, v);
      }
    }
    if (saved.session && typeof saved.session === 'object') {
      if (typeof saved.session.active === 'boolean') session.active = saved.session.active;
      if (typeof saved.session.startedAt === 'number') session.startedAt = saved.session.startedAt;
      if (Array.isArray(saved.session.songs)) session.songs = saved.session.songs;
    }
    if (typeof saved.setlistTheme === 'string') playState.setlistTheme = saved.setlistTheme;
    if (typeof saved.setlistLayout === 'string') playState.setlistLayout = saved.setlistLayout;
    if (saved.setlistStyle && typeof saved.setlistStyle === 'object') {
      playState.setlistStyle = { ...playState.setlistStyle, ...saved.setlistStyle };
    }
    if (saved.setlistSceneStyles && typeof saved.setlistSceneStyles === 'object') {
      SETLIST_SCENE.forEach((k) => {
        if (saved.setlistSceneStyles[k] && typeof saved.setlistSceneStyles[k] === 'object') {
          playState.setlistSceneStyles[k] = { ...playState.setlistSceneStyles[k], ...saved.setlistSceneStyles[k] };
        }
      });
    }
    log.info('狀態已從 state.json 還原');
  })();

  /**
   * 把目前狀態排程寫入磁碟（延遲 3 秒 debounce，呼叫成本趨近於零）
   * 在歌單、設定、offset、手動歌詞變更的地方呼叫
   */
  function persistState() {
    stateStore.scheduleSave(() => ({
      savedAt: Date.now(),
      playlist: playState.playlist,
      style: playState.style,
      styleOverrides: playState.styleOverrides,
      romanizationMode: playState.romanizationMode,
      showRomanization: playState.showRomanization,
      metronomeEnabled: playState.metronomeEnabled,
      lyricSettings: playState.lyricSettings,
      trackOffsets: Object.fromEntries(trackOffsets),
      manualLyrics: Object.fromEntries(manualLyricsCache),
      trackPitch: Object.fromEntries(trackPitch),
      trackSpeed: Object.fromEntries(trackSpeed),
      session: { active: session.active, startedAt: session.startedAt, songs: session.songs },
      setlistTheme: playState.setlistTheme,
      setlistLayout: playState.setlistLayout,
      setlistStyle: playState.setlistStyle,
      setlistSceneStyles: playState.setlistSceneStyles,
    }));
  }

  // ═══════════════════════════════════════════
  // Setlist payload / session 記錄
  // ═══════════════════════════════════════════

  /**
   * 組出 setlist 疊加頁 / 面板需要的完整資料：已唱(songs) + 現在(current) + 未唱(upcoming)。
   * upcoming＝播放清單中「目前歌曲之後」尚未輪到的歌（找不到目前歌時就是整份清單）。
   */
  function setlistPayload() {
    const pl = Array.isArray(playState.playlist) ? playState.playlist : [];
    const cur = playState.currentTrack;
    const playing = !!playState.isPlaying;
    let upcoming = [];
    if (pl.length || cur) {
      const idx = cur ? pl.findIndex((t) => t && t.id === cur.id) : -1;
      // 待命中（選了歌但還沒按播放）的當前歌要排進「接下來」最前面，不能消失：
      //  - cur 在清單內：播放中→取其後；待命→連同 cur 本身（slice 到 idx）。
      //  - cur 不在清單（單獨載入）：待命→自己當接下來第一首；播放中→只列清單其餘。
      //  - 無 cur：整份清單都是接下來。
      let rest;
      if (idx >= 0) rest = pl.slice(playing ? idx + 1 : idx);
      else rest = cur ? (playing ? pl.slice(0) : [cur, ...pl]) : pl.slice(0);
      upcoming = rest.map((t) => ({ title: t.title || '', artist: t.artist || '' }));
    }
    return {
      active: session.active,
      startedAt: session.startedAt,
      songs: [...session.songs],
      current: cur ? { id: cur.id, title: cur.title || '', artist: cur.artist || '', playing: !!playState.isPlaying } : null,
      upcoming,
      theme: playState.setlistTheme || 'glass',
      layout: playState.setlistLayout || 'classic',
      style: { ...playState.setlistStyle }, // 共用份（經典＋清單版）；面板當 shared 用
      sceneStyles: {
        timeline: { ...playState.setlistSceneStyles.timeline },
        diagonal: { ...playState.setlistSceneStyles.diagonal },
        constellation: { ...playState.setlistSceneStyles.constellation },
      },
    };
  }

  function emitSetlist() { io.emit('setlist:update', setlistPayload()); }

  /**
   * 把「目前正在播放的歌」記入已唱歌單——真的開始播放時呼叫（非載入待命）。
   * 用最後一首的 id 去重：同一首連續觸發（播放→暫停→續播、或重複點同一首）不會重覆記錄。
   * 未開台也記錄（offset=0＝沒有時間戳，前端時間全 0 時不顯示時間欄）。
   */
  function recordSessionSong() {
    const t = playState.currentTrack;
    if (!t || !t.id) return;
    const last = session.songs[session.songs.length - 1];
    if (last && last.id === t.id) return;
    const counting = session.active && session.startedAt != null;
    session.songs.push({
      id: t.id,
      title: t.title || '',
      artist: t.artist || '',
      startedAt: Date.now(),
      offset: counting ? Date.now() - session.startedAt : 0,
    });
    emitSetlist();
    persistState();
  }

  // ═══════════════════════════════════════════
  // 狀態衍生資料（廣播 payload）
  // ═══════════════════════════════════════════

  /** 廣播完整播放狀態給所有客戶端 */
  function broadcastState() {
    playState.lastStateUpdateTimestamp = Date.now();
    io.emit('state:sync', getPublicState());
  }

  /** 取得可公開的播放狀態（含 offset 和手動歌詞標記） */
  function getPublicState() {
    // 為播放列表中的每首歌附加 offset 和手動歌詞標記
    const enrichedPlaylist = playState.playlist.map(track => ({
      ...track,
      offset: trackOffsets.get(track.id) || 0,
      pitchShift: trackPitch.has(track.id) ? trackPitch.get(track.id) : 0,
      playbackRate: trackSpeed.has(track.id) ? trackSpeed.get(track.id) : 1.0,
      manualLyrics: !!manualLyricsCache.has(track.id),
    }));

    return {
      currentTrack: playState.currentTrack ? {
        ...playState.currentTrack,
        offset: playState.currentOffset,
        pitchShift: trackPitch.has(playState.currentTrack.id) ? trackPitch.get(playState.currentTrack.id) : 0,
        playbackRate: trackSpeed.has(playState.currentTrack.id) ? trackSpeed.get(playState.currentTrack.id) : 1.0,
        manualLyrics: !!manualLyricsCache.has(playState.currentTrack.id),
      } : null,
      isPlaying: playState.isPlaying,
      currentTime: playState.currentTime,
      playlist: enrichedPlaylist,
      style: playState.style,
      styleOverrides: playState.styleOverrides,
      showRomanization: playState.showRomanization,
      romanizationMode: playState.romanizationMode,
      emergencyHide: playState.emergencyHide,
      currentOffset: playState.currentOffset,
      pitchShift: playState.pitchShift,
      playbackRate: playState.playbackRate,
      metronomeEnabled: playState.metronomeEnabled,
      lyricSettings: playState.lyricSettings,
      // 附帶伺服器時間戳，讓 OBS 重連時計算補償
      serverTimestamp: playState.lastStateUpdateTimestamp,
      // Setlist（含現在/未唱，初次同步即完整）
      session: setlistPayload(),
    };
  }

  /**
   * 取得用於 OBS 重連恢復的完整狀態（含歌詞內容，確保重載後能無縫接軌）
   */
  function getFullRecoveryState() {
    const state = getPublicState();

    if (playState.currentTrack) {
      const trackId = playState.currentTrack.id;
      // 優先使用手動歌詞
      if (manualLyricsCache.has(trackId)) {
        const manual = manualLyricsCache.get(trackId);
        state.currentTrack.lyrics = manual.lyrics;
        state.currentTrack.lyricsType = manual.lyricsType;
        state.currentTrack.parsedLyrics = manual.parsedLyrics;
      } else {
        state.currentTrack.lyrics = playState.currentTrack.lyrics;
        state.currentTrack.lyricsType = playState.currentTrack.lyricsType;
        state.currentTrack.parsedLyrics = playState.currentTrack.parsedLyrics;
      }
    }

    return state;
  }

  /** 取得 track 的有效歌詞（考慮手動覆蓋），無手動覆蓋時回 null */
  function getEffectiveLyrics(trackId) {
    if (manualLyricsCache.has(trackId)) {
      return manualLyricsCache.get(trackId);
    }
    return null;
  }

  return {
    playState,
    trackOffsets,
    trackPitch,
    trackSpeed,
    manualLyricsCache,
    session,
    SETLIST_SCENE,
    effSetlistStore,
    persistState,
    setlistPayload,
    emitSetlist,
    recordSessionSong,
    broadcastState,
    getPublicState,
    getFullRecoveryState,
    getEffectiveLyrics,
  };
}

module.exports = { createAppState, SETLIST_SCENE };
