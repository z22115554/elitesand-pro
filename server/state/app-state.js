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

const crypto = require('crypto');
const stateStore = require('../services/state-store');
const setlistStyleSchema = require('../../public/js/setlist-style-schema');
const twitchReplySettings = require('../../public/js/twitch-reply-settings');
const twitchRequestSettings = require('../../public/js/twitch-request-settings');
const twitchRewardSettings = require('../../public/js/twitch-reward-settings');
const obsLocale = require('../utils/obs-locale');
const { createLogger } = require('../utils/logger');
const { sanitizePlaylist, sanitizeJsonObject } = require('../utils/track-schema');
const libraryStore = require('../services/library-store');
const { emitToAccessRooms } = require('../utils/socket-broadcast');

const log = createLogger('State');
const STATE_SYNC_WARN_BYTES = 512 * 1024;
const STATE_SYNC_LOG_EVERY = 100;
const STATE_SYNC_WARN_INTERVAL_MS = 60 * 1000;
const READ_ONLY_TRACK_FIELDS = ['filename', 'url', 'cover', 'originalName', 'audioAvailable', 'audioMissing'];

// OBS / setlist renderers need song identity and lyrics, but never the media
// file location or its original remote source. Keep this as a narrow,
// explicit deny-list so access-room payloads cannot accidentally leak them.
function redactTrackForReadOnly(track) {
  if (!track || typeof track !== 'object') return track;
  const safe = { ...track };
  for (const field of READ_ONLY_TRACK_FIELDS) delete safe[field];
  return safe;
}

function getDefaultLyricSettings() {
  return {
    template: 'classic',
    lyricTemplateSettings: {
      classic: { template: 'classic', fontSize: 56, color: '#8f8f8f', activeColor: '#febc6c', verticalPosition: 'flex-end' },
      pulse: { template: 'pulse', fontSize: 50, color: '#ddfe9f', activeColor: '#38ff45', verticalPosition: 'center' },
      facet: { template: 'facet', fontSize: 45, color: '#9181bb', activeColor: '#5d0a94', verticalPosition: 'center' },
      drift: { template: 'drift', fontSize: 45, color: '#c0ff38', activeColor: '#ffc800', verticalPosition: 'center', animationIntensity: 'calm' },
      aura: { template: 'aura', fontSize: 72, color: '#ffffff', activeColor: '#14a5ff', verticalPosition: 'center' },
      ktv: { template: 'ktv', fontSize: 40, color: '#ffffff', activeColor: '#0400ff', verticalPosition: 'center', ktvInterludeText: '', ktvEndingText: '' },
      columnflow: { template: 'columnflow', fontFamily: "'Noto Serif TC', 'PMingLiU', serif", fontWeight: 600, fontSize: 48, color: '#f4efe5', activeColor: '#f0c978', shadow: '0 1px 7px rgba(0,0,0,.72)', verticalPosition: 'center', columnflowVariant: 'sen', columnflowEntrance: 'native', columnflowPlacement: 'split', columnflowMaxLines: 4, animationIntensity: 'normal' },
      paperstrip: { template: 'paperstrip', fontWeight: 600, fontSize: 56, color: '#111111', activeColor: '#111111', shadow: 'none', verticalPosition: 'center', lyricPosition: 'center', letterSpacing: 1, paperstripOrient: 'horizontal', paperstripColor: '#ffffff' },
      mirror: { template: 'mirror', fontWeight: 900, fontSize: 60, color: '#ffffff', activeColor: '#ffffff', shadow: 'none', verticalPosition: 'center', lyricPosition: 'split', stageSafeMargin: 13, letterSpacing: 1, animationIntensity: 'normal' },
      particle: { template: 'particle', fontFamily: '', fontWeight: 400, fontSize: 64, color: '#f6f0e5', activeColor: '#e97855', animationIntensity: 'normal', lyricPosition: 'center', verticalPosition: 'center', paddingX: 96, paddingY: 90, stageSafeMargin: 13, particleOrient: 'vertical' },
      lightboard: { template: 'lightboard', fontSize: 44, fontWeight: 400, color: 'rgba(255,176,60,0.5)', activeColor: '#ffce8a', shadow: 'none', verticalPosition: 'center', lyricPosition: 'center', lightboardFont: 'cubic11', lightboardPan: true, lightboardIdleMarquee: true, lightboardIdleGapMs: 2500, lightboardSlideIn: false },
      typewriter: { template: 'typewriter', fontWeight: 700, fontSize: 36, color: '#f4f7fa', activeColor: '#a9cfe5', shadow: 'none', verticalPosition: 'center', lyricPosition: 'split', paddingX: 96, twBubbleRight: '#0b93f6', twBubbleLeft: '#3b3b3d', twStickerEnabled: true, twStickerGapMs: 6000 },
    },
  };
}

// 所有歌單模板都各自持有一份外觀設定。舊 state 的 shared/scene 資料在載入時遷移。
const SETLIST_SCENE = ['timeline', 'diagonal', 'constellation'];
const SETLIST_LAYOUTS = ['classic', 'simple', 'timeline', 'diagonal', 'constellation', 'terminal', 'billboard', 'cards', 'signal', 'index', 'label', 'glow', 'round', 'pager', 'flap', 'note', 'film'];

/**
 * 建立狀態容器
 * @param {import('socket.io').Server} io - 廣播用
 */
function createAppState(io) {
  const stateSyncMetrics = {
    samples: 0,
    lastBytes: 0,
    maxBytes: 0,
    lastEstimatedLegacyBytes: 0,
    lastSavingsBytes: 0,
    maxSavingsBytes: 0,
    lastPlaylistLength: 0,
    lastMeasuredAt: null,
    lastWarnedAt: 0,
  };
  // ─── 全局播放狀態 ───
  const playState = {
    currentTrack: null,
    isPlaying: false,
    // Distinguishes an unstarted standby track from a track paused after playback began.
    currentTrackStarted: false,
    currentTime: 0,
    // 播放清單進度不能只靠 currentTrack 推算：歌曲自然播畢後 currentTrack 會清空，
    // 但已唱／未唱狀態仍必須保留，重開程式後也不能全部退回未唱。
    playedEntryIds: new Set(),
    lastPlayedEntryId: null,
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
    lyricSettings: getDefaultLyricSettings(), // 歌詞外觀/位置設定（由控制面板推送）
    styleOverrides: {},     // 動畫風格微調（速度/放大/光暈等，覆蓋當前 preset）
    // OBS 疊加層（/display、/setlist）用哪個語言顯示。'follow' = 跟著面板當下的語言，
    // 其餘為固定語言代碼（面板中文、疊加層英文給國際觀眾這種需求）。
    // 面板語言本身是裝置端偏好（localStorage），OBS 是另一個瀏覽器 profile 拿不到，
    // 所以 panelLocale 由面板推上來、存在這裡，重開只有 OBS 的情況才不會退回預設語言。
    obsLocale: 'follow',
    panelLocale: 'zh-TW',
    setlistTheme: 'glass',  // 直播歌單 OBS 外觀主題（glass/neon/minimal）
    setlistLayout: 'classic', // 直播歌單版型
    // 直播歌單 OBS 外觀細項：每個模板一份，預設值單一事實來源見 schema。
    setlistTemplateStyles: {},
    // Twitch 聊天室回覆設定；面板與 server 共用 public/js/twitch-reply-settings.js 契約。
    twitchReplySettings: twitchReplySettings.getDefaults(),
    twitchRequestSettings: twitchRequestSettings.getDefaults(),
    twitchRewardSettings: twitchRewardSettings.getDefaults(),
  };

  SETLIST_LAYOUTS.forEach((layout) => {
    playState.setlistTemplateStyles[layout] = setlistStyleSchema.getDefaultStyle();
  });

  /** 取某版型「生效的那一份」設定 */
  function effSetlistStore(layout) {
    return playState.setlistTemplateStyles[SETLIST_LAYOUTS.includes(layout) ? layout : 'classic'];
  }

  // ─── 每首歌的記憶（key: track.id）───
  const trackOffsets = new Map();       // offset in ms
  const trackPitch = new Map();         // semitones (-12 ~ 12)
  const trackSpeed = new Map();         // rate (0.5 ~ 1.5)
  const manualLyricsCache = new Map();  // { lyrics, lyricsType, parsedLyrics, source, timestamp }
  // trackId -> debounce Timeout；歌詞偏移社群回饋用，見 handlers/lyrics.js。放在這裡
  // （而不是 handler 模組頂層）是因為要跟這個 app-state 實例同壽命，不能被其他測試用的
  // app-state 實例共用到。
  const lyricOffsetSyncTimers = new Map();

  function playlistEntryId(track) {
    return track && typeof track.entryId === 'string' && track.entryId ? track.entryId : null;
  }

  function findPlaylistTrack({ entryId, trackId } = {}) {
    if (entryId) {
      const exact = playState.playlist.find((track) => playlistEntryId(track) === entryId);
      if (exact) return exact;
    }
    if (trackId) return playState.playlist.find((track) => track && track.id === trackId) || null;
    return null;
  }

  function markTrackPlayed(track) {
    const entryId = playlistEntryId(track);
    if (!entryId) return false;
    playState.playedEntryIds.add(entryId);
    playState.lastPlayedEntryId = entryId;
    return true;
  }

  function reconcilePlaybackProgress() {
    const validEntryIds = new Set(playState.playlist.map(playlistEntryId).filter(Boolean));
    for (const entryId of playState.playedEntryIds) {
      if (!validEntryIds.has(entryId)) playState.playedEntryIds.delete(entryId);
    }
    if (playState.lastPlayedEntryId && !validEntryIds.has(playState.lastPlayedEntryId)) {
      playState.lastPlayedEntryId = null;
    }
    if (playState.currentTrack) {
      const current = findPlaylistTrack({
        entryId: playlistEntryId(playState.currentTrack),
        trackId: playState.currentTrack.id,
      });
      if (!current) {
        playState.currentTrack = null;
        playState.currentTrackStarted = false;
        playState.isPlaying = false;
        playState.currentTime = 0;
      }
    }
  }

  // ─── 直播 Session / Setlist ───
  const session = {
    active: false,
    startedAt: null,
    // 來源是直播狀態的權威；舊版 state 沒有此欄位時保留 null，交由首次 OBS／Twitch
    // 回報確認，不可假裝仍在直播。
    source: null,
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
      if (['obs', 'twitch', 'manual'].includes(saved.session.source)) session.source = saved.session.source;
      // 舊資料可能沒有 entryId（單獨刪除功能加入前存的）——補齊，否則這些歌永遠刪不掉。
      if (Array.isArray(saved.session.songs)) {
        session.songs = saved.session.songs.map((s) => (s && s.entryId ? s : { ...s, entryId: crypto.randomUUID() }));
      }
    }
    if (typeof saved.obsLocale === 'string') playState.obsLocale = obsLocale.normalizeMode(saved.obsLocale);
    if (typeof saved.panelLocale === 'string') playState.panelLocale = obsLocale.normalizeLocale(saved.panelLocale);
    if (typeof saved.setlistTheme === 'string') playState.setlistTheme = saved.setlistTheme;
    if (typeof saved.setlistLayout === 'string') playState.setlistLayout = saved.setlistLayout;
    // v1 相容：舊 shared 樣式先複製給每個模板，三個場景的獨立值再覆蓋。
    if (saved.setlistStyle && typeof saved.setlistStyle === 'object') {
      SETLIST_LAYOUTS.forEach((layout) => {
        playState.setlistTemplateStyles[layout] = { ...playState.setlistTemplateStyles[layout], ...saved.setlistStyle };
      });
    }
    if (saved.setlistSceneStyles && typeof saved.setlistSceneStyles === 'object') {
      SETLIST_SCENE.forEach((k) => {
        if (saved.setlistSceneStyles[k] && typeof saved.setlistSceneStyles[k] === 'object') {
          playState.setlistTemplateStyles[k] = { ...playState.setlistTemplateStyles[k], ...saved.setlistSceneStyles[k] };
        }
      });
    }
    // v2：模板快照是權威，放在舊資料之後以便升級時保留使用者後來的個別調整。
    if (saved.setlistTemplateStyles && typeof saved.setlistTemplateStyles === 'object') {
      SETLIST_LAYOUTS.forEach((layout) => {
        if (saved.setlistTemplateStyles[layout] && typeof saved.setlistTemplateStyles[layout] === 'object') {
          playState.setlistTemplateStyles[layout] = { ...playState.setlistTemplateStyles[layout], ...saved.setlistTemplateStyles[layout] };
        }
      });
    }
    if (saved.twitchReplySettings && typeof saved.twitchReplySettings === 'object') {
      playState.twitchReplySettings = twitchReplySettings.normalizeSettings(saved.twitchReplySettings);
    }
    if (saved.twitchRequestSettings && typeof saved.twitchRequestSettings === 'object') {
      playState.twitchRequestSettings = twitchRequestSettings.normalizeSettings(saved.twitchRequestSettings);
    }
    if (saved.twitchRewardSettings && typeof saved.twitchRewardSettings === 'object') {
      playState.twitchRewardSettings = twitchRewardSettings.normalizeSettings(saved.twitchRewardSettings);
    }

    const savedPlayback = saved.playback && typeof saved.playback === 'object'
      ? saved.playback
      : null;
    if (savedPlayback) {
      if (Array.isArray(savedPlayback.playedEntryIds)) {
        for (const entryId of savedPlayback.playedEntryIds) {
          if (typeof entryId === 'string' && entryId) playState.playedEntryIds.add(entryId);
        }
      }
      if (typeof savedPlayback.lastPlayedEntryId === 'string') {
        playState.lastPlayedEntryId = savedPlayback.lastPlayedEntryId;
      }

      const restoredTrack = findPlaylistTrack({
        entryId: typeof savedPlayback.currentEntryId === 'string' ? savedPlayback.currentEntryId : null,
        trackId: typeof savedPlayback.currentTrackId === 'string' ? savedPlayback.currentTrackId : null,
      });
      if (restoredTrack) {
        playState.currentTrack = { ...restoredTrack, autoplay: false };
        playState.currentTrackStarted = savedPlayback.currentTrackStarted === true;
        // 只記得播到哪一首，不記歌曲內秒數。意外重開後從該首開頭重新準備。
        playState.currentTime = 0;
        // 重開後只恢復待命／暫停狀態，不可自行出聲；使用者按播放後從頭開始。
        playState.isPlaying = false;
        playState.currentOffset = trackOffsets.get(restoredTrack.id) || 0;
        playState.pitchShift = trackPitch.has(restoredTrack.id) ? trackPitch.get(restoredTrack.id) : 0;
        playState.playbackRate = trackSpeed.has(restoredTrack.id) ? trackSpeed.get(restoredTrack.id) : 1.0;
        if (playState.currentTrackStarted) markTrackPlayed(restoredTrack);
      }
    }

    // 升級前的 state.json 沒有 playback.playedEntryIds。利用既有的已唱 session 記錄，
    // 依清單順序回填一次，讓使用者更新後不會看到所有歌曲突然變回未唱。
    if (playState.playedEntryIds.size === 0 && session.songs.length > 0) {
      const used = new Set();
      let searchFrom = 0;
      for (const song of session.songs) {
        let index = playState.playlist.findIndex((track, i) => i >= searchFrom
          && track && track.id === song.id && !used.has(playlistEntryId(track)));
        if (index < 0) {
          index = playState.playlist.findIndex((track) => track && track.id === song.id
            && !used.has(playlistEntryId(track)));
        }
        if (index < 0) continue;
        const entryId = playlistEntryId(playState.playlist[index]);
        if (!entryId) continue;
        used.add(entryId);
        playState.playedEntryIds.add(entryId);
        playState.lastPlayedEntryId = entryId;
        searchFrom = index + 1;
      }
    }
    reconcilePlaybackProgress();
    log.info('狀態已從 state.json 還原');
  })();

  /**
   * 把目前狀態排程寫入磁碟（延遲 800ms debounce，呼叫成本趨近於零）
   * 在歌單、設定、offset、手動歌詞變更的地方呼叫
   */
  function persistState(callback) {
    stateStore.scheduleSave(() => ({
      schemaVersion: stateStore.CURRENT_STATE_SCHEMA_VERSION,
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
      playback: {
        currentEntryId: playlistEntryId(playState.currentTrack),
        currentTrackId: playState.currentTrack ? playState.currentTrack.id : null,
        currentTrackStarted: !!playState.currentTrackStarted,
        playedEntryIds: [...playState.playedEntryIds],
        lastPlayedEntryId: playState.lastPlayedEntryId,
      },
      session: { active: session.active, startedAt: session.startedAt, source: session.source, songs: session.songs },
      obsLocale: playState.obsLocale,
      panelLocale: playState.panelLocale,
      setlistTheme: playState.setlistTheme,
      setlistLayout: playState.setlistLayout,
      setlistTemplateStyles: playState.setlistTemplateStyles,
      twitchReplySettings: playState.twitchReplySettings,
      twitchRequestSettings: playState.twitchRequestSettings,
      twitchRewardSettings: playState.twitchRewardSettings,
    }), callback);
  }

  // ═══════════════════════════════════════════
  // Setlist payload / session 記錄
  // ═══════════════════════════════════════════

  /**
   * 組出 setlist 疊加頁 / 面板需要的完整資料：已唱(songs) + 現在(current) + 未唱(upcoming)。
   * upcoming＝播放清單中「目前歌曲之後」尚未輪到的歌（找不到目前歌時就是整份清單）。
   */
  // styles 僅屬於 setlist 顯示與控制面板；絕不能跟著每次 state:sync
  // 廣播給所有角色。正式 setlist:update 仍保留完整資料供初始載入。
  function setlistPayload({ includeStyles = true } = {}) {
    const pl = Array.isArray(playState.playlist) ? playState.playlist : [];
    const cur = playState.currentTrack;
    const currentTrackStarted = !!playState.currentTrackStarted;
    const playedEntryIds = playState.playedEntryIds;
    const isCurrentTrack = (track) => {
      if (!cur || !track) return false;
      const curEntryId = playlistEntryId(cur);
      const trackEntryId = playlistEntryId(track);
      return curEntryId && trackEntryId ? curEntryId === trackEntryId : track.id === cur.id;
    };
    let upcoming = [];
    if (pl.length || cur) {
      // 同 play:track：優先用 entryId 定位，避免重複歌曲時「接下來」清單從錯的位置切出去。
      const idx = cur
        ? (cur.entryId
          ? pl.findIndex((t) => t && t.entryId === cur.entryId)
          : pl.findIndex((t) => t && t.id === cur.id))
        : -1;
      // 待命中（選了歌但還沒按播放）的當前歌要排進「接下來」最前面，不能消失：
      //  - cur 在清單內：播放中→取其後；待命→連同 cur 本身（slice 到 idx）。
      //  - cur 不在清單（單獨載入）：待命→自己當接下來第一首；播放中→只列清單其餘。
      //  - 無 cur：整份清單都是接下來。
      let rest;
      // 已唱狀態以實際開始播放過的 entryId 為準，而不是只靠目前索引切片。
      // 這樣自然播畢清空 currentTrack、或程式意外關閉重開後，已唱歌曲仍不會回到未唱。
      if (idx >= 0 && !currentTrackStarted) {
        rest = pl.filter((track) => !playedEntryIds.has(playlistEntryId(track)));
      } else if (idx < 0 && cur && !currentTrackStarted) {
        rest = [cur, ...pl.filter((track) => !playedEntryIds.has(playlistEntryId(track)))];
      } else {
        rest = pl.filter((track) => !isCurrentTrack(track)
          && !playedEntryIds.has(playlistEntryId(track)));
      }
      upcoming = rest.map((t) => ({ title: t.title || '', artist: t.artist || '' }));
    }
    const payload = {
      active: session.active,
      startedAt: session.startedAt,
      source: session.source,
      songs: [...session.songs],
      current: cur ? { id: cur.id, title: cur.title || '', artist: cur.artist || '', playing: !!playState.isPlaying } : null,
      upcoming,
      theme: playState.setlistTheme || 'glass',
      layout: playState.setlistLayout || 'classic',
    };
    if (!includeStyles) return payload;
    return {
      ...payload,
      styles: Object.fromEntries(SETLIST_LAYOUTS.map((layout) => [layout, { ...playState.setlistTemplateStyles[layout] }])),
      // 舊版 OBS 頁面仍讀 style / sceneStyles；新版以 styles 為權威。
      style: { ...effSetlistStore(playState.setlistLayout) },
      sceneStyles: Object.fromEntries(SETLIST_SCENE.map((layout) => [layout, { ...playState.setlistTemplateStyles[layout] }])),
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
      entryId: crypto.randomUUID(), // 同一首歌可能唱兩次（id 重複），單獨刪除要認這個才唯一
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
    const exists = libraryStore.getAudioExistsLookup();
    const payload = getPublicState(exists);
    const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    const nextSample = stateSyncMetrics.samples + 1;
    // 「舊結構」估算只在記錄點序列化，避免為了量測又在每次廣播重建一份大型 payload。
    const shouldEstimateLegacy = nextSample === 1 || nextSample % STATE_SYNC_LOG_EVERY === 0;
    let estimatedLegacyBytes = stateSyncMetrics.lastEstimatedLegacyBytes;
    let savingsBytes = stateSyncMetrics.lastSavingsBytes;
    if (shouldEstimateLegacy) {
      const publicPlaylistBytes = Buffer.byteLength(JSON.stringify(payload.playlist), 'utf8');
      const legacyPlaylistBytes = Buffer.byteLength(JSON.stringify(getLegacyPlaylist(exists)), 'utf8');
      estimatedLegacyBytes = bytes - publicPlaylistBytes + legacyPlaylistBytes;
      savingsBytes = Math.max(0, estimatedLegacyBytes - bytes);
    }
    const measuredAt = Date.now();
    stateSyncMetrics.samples += 1;
    stateSyncMetrics.lastBytes = bytes;
    stateSyncMetrics.maxBytes = Math.max(stateSyncMetrics.maxBytes, bytes);
    if (shouldEstimateLegacy) {
      stateSyncMetrics.lastEstimatedLegacyBytes = estimatedLegacyBytes;
      stateSyncMetrics.lastSavingsBytes = savingsBytes;
      stateSyncMetrics.maxSavingsBytes = Math.max(stateSyncMetrics.maxSavingsBytes, savingsBytes);
    }
    stateSyncMetrics.lastPlaylistLength = payload.playlist.length;
    stateSyncMetrics.lastMeasuredAt = measuredAt;

    if (stateSyncMetrics.samples === 1 || stateSyncMetrics.samples % STATE_SYNC_LOG_EVERY === 0) {
      log.info(`state:sync payload ${bytes} bytes（舊結構估計 ${estimatedLegacyBytes}、節省 ${savingsBytes}；playlist=${payload.playlist.length}, sample=${stateSyncMetrics.samples}）`);
    }
    if (bytes >= STATE_SYNC_WARN_BYTES && measuredAt - stateSyncMetrics.lastWarnedAt >= STATE_SYNC_WARN_INTERVAL_MS) {
      stateSyncMetrics.lastWarnedAt = measuredAt;
      log.warn(`state:sync payload 已達 ${bytes} bytes（playlist=${payload.playlist.length}），P2 應評估拆分同步事件`);
    }

    emitToAccessRooms(io, 'state:sync', payload, getReadOnlyState(exists));
  }

  function getStateSyncMetrics() {
    return { ...stateSyncMetrics };
  }

  function getTrackPayload(track, { includeLyrics = false, offset, exists } = {}) {
    if (!track) return null;
    const manual = manualLyricsCache.get(track.id);
    const { lyrics, parsedLyrics, manualLyrics: _storedManualLyrics, ...summary } = track;
    const effectiveLyrics = manual ? manual.lyrics : lyrics;
    const effectiveLyricsType = manual ? manual.lyricsType : track.lyricsType;
    const effectiveParsedLyrics = manual ? manual.parsedLyrics : parsedLyrics;
    const payload = {
      ...summary,
      lyricsType: effectiveLyricsType || null,
      hasLyrics: !!effectiveLyrics || (Array.isArray(effectiveParsedLyrics) && effectiveParsedLyrics.length > 0),
      offset: typeof offset === 'number' ? offset : (trackOffsets.get(track.id) || 0),
      pitchShift: trackPitch.has(track.id) ? trackPitch.get(track.id) : 0,
      playbackRate: trackSpeed.has(track.id) ? trackSpeed.get(track.id) : 1.0,
      manualLyrics: !!manual,
      ...libraryStore.audioStatus(track, exists),
    };
    if (includeLyrics) {
      payload.lyrics = effectiveLyrics == null ? null : effectiveLyrics;
      payload.parsedLyrics = effectiveParsedLyrics == null ? null : effectiveParsedLyrics;
    }
    return payload;
  }

  /** 可傳給所有端點的清單摘要；歌詞內容只隨目前歌曲發送。 */
  function getPublicPlaylist(exists = libraryStore.getAudioExistsLookup()) {
    return playState.playlist.map(track => getTrackPayload(track, { exists }));
  }

  function getReadOnlyPlaylist(exists = libraryStore.getAudioExistsLookup()) {
    return getPublicPlaylist(exists).map(redactTrackForReadOnly);
  }

  // 僅供 P2 量測舊 payload 用，絕不可拿去 io.emit。
  function getLegacyPlaylist(exists = libraryStore.getAudioExistsLookup()) {
    return playState.playlist.map(track => getTrackPayload(track, { includeLyrics: true, exists }));
  }

  /** 取得可公開的播放狀態：清單是摘要，currentTrack 保留完整歌詞供播放／編輯／OBS 恢復。 */
  function getPublicState(exists = libraryStore.getAudioExistsLookup()) {
    const enrichedPlaylist = getPublicPlaylist(exists);

    return {
      currentTrack: playState.currentTrack
        ? getTrackPayload(playState.currentTrack, { includeLyrics: true, offset: playState.currentOffset, exists })
        : null,
      isPlaying: playState.isPlaying,
      currentTrackStarted: !!playState.currentTrackStarted,
      currentTime: playState.currentTime,
      playedEntryIds: [...playState.playedEntryIds],
      lastPlayedEntryId: playState.lastPlayedEntryId,
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
      session: setlistPayload({ includeStyles: false }),
    };
  }

  /**
   * 取得用於 OBS 重連恢復的完整狀態（含歌詞內容，確保重載後能無縫接軌）
   */
  function getFullRecoveryState() {
    return getPublicState();
  }

  /** Full lyrics remain available to OBS, but media path/source fields do not. */
  function getReadOnlyState(exists = libraryStore.getAudioExistsLookup()) {
    const publicState = getPublicState(exists);
    return {
      ...publicState,
      currentTrack: redactTrackForReadOnly(publicState.currentTrack),
      playlist: publicState.playlist.map(redactTrackForReadOnly),
    };
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
    lyricOffsetSyncTimers,
    session,
    SETLIST_SCENE,
    SETLIST_LAYOUTS,
    effSetlistStore,
    persistState,
    setlistPayload,
    emitSetlist,
    recordSessionSong,
    markTrackPlayed,
    reconcilePlaybackProgress,
    broadcastState,
    getStateSyncMetrics,
    getPublicPlaylist,
    getReadOnlyPlaylist,
    getPublicState,
    getFullRecoveryState,
    getReadOnlyState,
    redactTrackForReadOnly,
    getEffectiveLyrics,
  };
}

module.exports = { createAppState, SETLIST_SCENE, SETLIST_LAYOUTS };
