'use strict';

/**
 * 練唱 OBS 疊加層：面板（controller）送來的練唱畫面資料，只轉給 practice-overlay 房間。
 *
 * - 外觀設定以伺服器為真實來源（鐵則 4），存在 dataDir/practice-overlay.json。
 * - 畫面資料（時鐘、軌跡、填色、評等事件）只在記憶體轉送；只保留最後的歌、時鐘與分數，
 *   讓中途連上（或重新整理）的 OBS 來源能立刻接上，不寫 state.json、不觸發 broadcastState（鐵則 5）。
 * - 同時開了好幾個面板時，只跟「最近換歌、跳轉或正在播放」的那一個；用 socket.id 判斷，不信任面板自報的 ID。
 * - 所有欄位都在這裡重新驗證與設上限：OBS 來源只會拿到這裡組出來的資料。
 */
const path = require('path');
const { createLogger } = require('../utils/logger');
const { createJsonStore } = require('./json-store');
const { dataDir: DATA_DIR } = require('../utils/app-paths');
const { CONTROL_ROOM } = require('../utils/socket-broadcast');

const log = createLogger('PracticeOverlay');
const ROOM = 'practice-overlay';
const EVENT = 'practice:overlay';
// 演出風格與外觀預設只有一份：前端 public/js/practice/practice-fx.js（面板與疊加層共用）
const PracticeFx = require('../../public/js/practice/practice-fx');
const FX_IDS = PracticeFx.FX_IDS;
const TRAIL_MODES = ['ribbon', 'bars', 'raw'];
const POSITIONS = ['bottom', 'top'];
const TAGS = ['PERFECT', 'GREAT', 'GOOD', 'MISS'];
const TECHNIQUES = ['VIBRATO', 'LONG TONE', 'SLIDE'];
const MAX_NOTES = 40000;
const MAX_LINES = 2000;
const MAX_FRAME_TRAIL = 120;      // 50ms 一包、10ms 一點：正常約 5 點，留餘裕給短暫卡頓
const MAX_FRAME_NOTES = 64;
const MAX_FILLS_PER_NOTE = 64;
const MIN_FRAME_INTERVAL_MS = 20; // 每個面板最多約 50 包／秒

const STYLE_DEFAULT = PracticeFx.STYLE_DEFAULT;

const finite = (value, lo, hi, fallback = lo) => (Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : fallback);
const color = (value, fallback) => (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : fallback);
const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

function sanitizeStyle(input = {}) {
  const s = input && typeof input === 'object' ? input : {};
  return {
    fx: pick(s.fx, FX_IDS, STYLE_DEFAULT.fx),
    bg: typeof s.bg === 'boolean' ? s.bg : STYLE_DEFAULT.bg,
    bgOpacity: Math.round(finite(s.bgOpacity, 0, 100, STYLE_DEFAULT.bgOpacity)),
    bgColor: color(s.bgColor, STYLE_DEFAULT.bgColor),
    note: color(s.note, STYLE_DEFAULT.note),
    fill: color(s.fill, STYLE_DEFAULT.fill),
    voice: color(s.voice, STYLE_DEFAULT.voice),
    off: color(s.off, STYLE_DEFAULT.off),
    edge: typeof s.edge === 'boolean' ? s.edge : STYLE_DEFAULT.edge,
    pos: pick(s.pos, POSITIONS, STYLE_DEFAULT.pos),
    laneH: Math.round(finite(s.laneH, 20, 60, STYLE_DEFAULT.laneH)),
    score: typeof s.score === 'boolean' ? s.score : STYLE_DEFAULT.score,
    lyrics: typeof s.lyrics === 'boolean' ? s.lyrics : STYLE_DEFAULT.lyrics,
    result: typeof s.result === 'boolean' ? s.result : STYLE_DEFAULT.result,
    trailMode: pick(s.trailMode, TRAIL_MODES, STYLE_DEFAULT.trailMode),
  };
}

/** OBS 只需要畫面上會出現的東西：音符、歌詞文字與時間。原唱音高曲線（contour）不送。 */
function sanitizeSong(input) {
  if (!input || typeof input !== 'object') return null;
  const duration = finite(input.duration, 0, 20 * 60, 0);
  if (!duration) return null;
  const lines = (Array.isArray(input.lines) ? input.lines : []).slice(0, MAX_LINES).map((line) => ({
    start: round(finite(line && line.start, 0, duration)), end: round(finite(line && line.end, 0, duration)),
    text: String((line && line.text) || '').slice(0, 500),
    words: (Array.isArray(line && line.words) ? line.words : []).slice(0, 400).map((w) => ({
      text: String((w && w.text) || '').slice(0, 80), start: round(finite(w && w.start, 0, duration)), end: round(finite(w && w.end, 0, duration)) })),
  }));
  const notes = (Array.isArray(input.notes) ? input.notes : []).slice(0, MAX_NOTES)
    .filter((n) => n && Number.isFinite(n.start) && Number.isFinite(n.end) && n.end > n.start && Number.isInteger(n.midi))
    .map((n) => ({ start: round(finite(n.start, 0, duration)), end: round(finite(n.end, 0, duration)), midi: Math.round(finite(n.midi, 1, 140)),
      line: Math.round(finite(n.line, 0, MAX_LINES)), word: Math.round(finite(n.word, 0, 400)), excluded: n.excluded ? String(n.excluded).slice(0, 40) : null }));
  return { key: String(input.key || '').slice(0, 128), title: String(input.title || '').slice(0, 200), duration, lines, notes };
}

function sanitizeClock(input) {
  if (!input || typeof input !== 'object') return null;
  return { playing: input.playing === true, t: round(finite(input.t, 0, 20 * 60)), at: Date.now(), tempo: round(finite(input.tempo, 0.5, 1.5, 1)) };
}

function sanitizeScore(input) {
  if (!input || typeof input !== 'object') return null;
  const target = input.target == null ? null : round(finite(input.target, 0, 100), 2);
  return { target, unscorable: input.unscorable === true, result: sanitizeResult(input.result) };
}

function sanitizeResult(input) {
  if (!input || typeof input !== 'object') return null;
  const tiers = {}; for (const k of TAGS) tiers[k] = Math.round(finite(input.tiers && input.tiers[k], 0, 10000));
  const tech = {}; for (const k of TECHNIQUES) tech[k] = Math.round(finite(input.tech && input.tech[k], 0, 10000));
  return { score: input.score == null ? null : round(finite(input.score, 0, 100), 2), source: input.source === 'demo' ? 'demo' : 'mic',
    seconds: round(finite(input.seconds, 0, 20 * 60), 1), excluded: round(finite(input.excluded, 0, 20 * 60), 1),
    lines: Math.round(finite(input.lines, 0, MAX_LINES)), maxCombo: Math.round(finite(input.maxCombo, 0, MAX_LINES)),
    at: Math.round(finite(input.at, 0, 8.64e15)), tiers, tech };
}

/** 兩格合成一格：增量（軌跡、音符、事件）接起來，狀態（時鐘、游標、分數）取新的。 */
function mergeFrames(a, b) {
  return { type: 'frame', clock: b.clock || a.clock, trail: [...a.trail, ...b.trail].slice(-MAX_FRAME_TRAIL),
    notes: [...a.notes, ...b.notes].slice(-MAX_FRAME_NOTES), user: b.user || a.user, score: b.score || a.score,
    events: [...a.events, ...b.events].slice(-8) };
}

function sanitizeFrame(input) {
  const trail = (Array.isArray(input.trail) ? input.trail : []).slice(-MAX_FRAME_TRAIL).map((p) => (p && p.gap
    ? { t: round(finite(p.t, 0, 1200)), gap: true }
    : { t: round(finite(p && p.t, 0, 1200)), raw: round(finite(p && p.raw, 0, 140), 2), ribbon: round(finite(p && p.ribbon, 0, 140), 2),
      bar: Math.round(finite(p && p.bar, 0, 140)), ok: !!(p && p.ok), near: !!(p && p.near), v: round(finite(p && p.v, 0, 1), 2) }));
  const notes = (Array.isArray(input.notes) ? input.notes : []).slice(0, MAX_FRAME_NOTES).filter(Array.isArray).map(([i, fills, hit, seen, voiced]) => [
    Math.round(finite(i, 0, MAX_NOTES)),
    (Array.isArray(fills) ? fills : []).slice(-MAX_FILLS_PER_NOTE).filter(Array.isArray).map(([a, b]) => [round(finite(a, 0, 1200)), round(finite(b, 0, 1200))]),
    round(finite(hit, 0, 60)), round(finite(seen, 0, 60)), round(finite(voiced, 0, 60))]);
  const user = input.user && typeof input.user === 'object' ? { t: round(finite(input.user.t, 0, 1200)), midi: round(finite(input.user.midi, 0, 140), 2) } : null;
  const events = (Array.isArray(input.events) ? input.events : []).slice(0, 8).map((ev) => {
    if (ev && ev.k === 'rating' && TAGS.includes(ev.tag)) return { k: 'rating', tag: ev.tag, combo: Math.round(finite(ev.combo, 0, MAX_LINES)) };
    if (ev && ev.k === 'tag' && ev.g && TECHNIQUES.includes(ev.g.tag)) return { k: 'tag', g: { tag: ev.g.tag, t: round(finite(ev.g.t, 0, 1200)), midi: Math.round(finite(ev.g.midi, 1, 140)) } };
    return null;
  }).filter(Boolean);
  return { type: 'frame', clock: sanitizeClock(input.clock), trail, notes, user, score: sanitizeScore(input.score), events };
}

function createPracticeOverlay({ file = path.join(DATA_DIR, 'practice-overlay.json') } = {}) {
  const store = createJsonStore({
    file, label: '練唱 OBS 外觀',
    defaultValue: () => ({ style: { ...STYLE_DEFAULT } }),
    serialize: (doc) => doc, deserialize: (doc) => doc,
    validate: (doc) => doc && typeof doc === 'object' && doc.style && typeof doc.style === 'object',
    logger: log,
  });
  let style = sanitizeStyle(store.load().style);
  let saveTimer = null;
  let activeSocketId = null;
  const snapshot = { song: null, clock: null, score: null };
  const lastFrameAt = new Map();
  const pendingFrames = new Map();   // 面板 id → 還沒到送出間隔、先合併起來的那一格

  function persistSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { store.save({ style }); } catch (error) { log.warn(`練唱 OBS 外觀存檔失敗：${error.message}`); }
    }, 400);
    if (saveTimer.unref) saveTimer.unref();
  }

  function emit(io, message) {
    if (io && typeof io.to === 'function') io.to(ROOM).emit(EVENT, message);
  }

  /** 面板（controller）送來的一則訊息。回傳要轉給疊加層的內容（測試用），不合法就回 null。 */
  function handle(io, socket, message) {
    if (!socket || socket.clientType !== 'controller' || !message || typeof message !== 'object') return null;
    const id = socket.id;
    if (message.type === 'style') {
      style = sanitizeStyle({ ...style, ...message.style });
      persistSoon();
      const out = { type: 'style', style };
      emit(io, out);
      // 其他開著的面板也同步（外觀誰改都算）
      if (typeof socket.to === 'function') socket.to(CONTROL_ROOM).emit('practice:style', style);
      return out;
    }
    if (message.type === 'song') {
      const song = sanitizeSong(message.song);
      if (!song) return null;
      activeSocketId = id; snapshot.song = song; snapshot.clock = null; snapshot.score = null;
      const out = { type: 'song', song };
      emit(io, out);
      return out;
    }
    if (message.type === 'seek') {
      activeSocketId = id;   // 跳轉一定是這個面板上的實際操作：直接接手
      const out = { type: 'seek', offset: round(finite(message.offset, 0, 1200)) };
      emit(io, out);
      return out;
    }
    if (message.type === 'frame') {
      const frame = sanitizeFrame(message);
      const playing = frame.clock && frame.clock.playing;
      if (activeSocketId && activeSocketId !== id && !playing) return null; // 閒置的其他面板不能把畫面拉回去
      if (playing) activeSocketId = id;
      // 太密的格子不丟掉、併進下一包：評等事件、軌跡與唱完的結算都在增量資料裡，丟了 OBS 就永遠缺那一段
      const queued = pendingFrames.get(id);
      if (queued) { queued.frame = mergeFrames(queued.frame, frame); return null; }
      const wait = MIN_FRAME_INTERVAL_MS - (Date.now() - (lastFrameAt.get(id) || 0));
      if (wait > 0) {
        const entry = { frame, timer: null };
        entry.timer = setTimeout(() => { pendingFrames.delete(id); sendFrame(io, id, entry.frame); }, wait);
        if (entry.timer.unref) entry.timer.unref();
        pendingFrames.set(id, entry);
        return null;
      }
      return sendFrame(io, id, frame);
    }
    if (message.type === 'clear') {
      if (activeSocketId !== id) return null;
      snapshot.song = null; snapshot.clock = null; snapshot.score = null; activeSocketId = null;
      const out = { type: 'clear' };
      emit(io, out);
      return out;
    }
    return null;
  }

  function sendFrame(io, id, frame) {
    lastFrameAt.set(id, Date.now());
    if (frame.clock) snapshot.clock = frame.clock;
    if (frame.score) snapshot.score = frame.score;
    emit(io, frame);
    return frame;
  }

  /** OBS 疊加層連上（或重新整理）時推一份目前狀態。 */
  function greet(socket) {
    if (typeof socket.join === 'function') socket.join(ROOM);
    socket.emit(EVENT, { type: 'style', style });
    if (snapshot.song) socket.emit(EVENT, { type: 'song', song: snapshot.song });
    if (snapshot.clock || snapshot.score) socket.emit(EVENT, { type: 'frame', clock: snapshot.clock, score: snapshot.score, trail: [], notes: [], events: [], user: null });
  }

  /** 面板斷線：若它正在播放，OBS 停在當下的時間點，不要讓時鐘一直往前推。 */
  function disconnect(io, socketId) {
    lastFrameAt.delete(socketId);
    const queued = pendingFrames.get(socketId);
    if (queued) { clearTimeout(queued.timer); pendingFrames.delete(socketId); sendFrame(io, socketId, queued.frame); }
    if (activeSocketId !== socketId) return;
    activeSocketId = null;
    const c = snapshot.clock;
    if (c && c.playing) {
      snapshot.clock = { ...c, playing: false, t: round(c.t + ((Date.now() - c.at) / 1000) * (c.tempo || 1)), at: Date.now() };
      emit(io, { type: 'frame', clock: snapshot.clock, score: snapshot.score, trail: [], notes: [], events: [], user: null });
    }
  }

  return { handle, greet, disconnect, getStyle: () => style, getSnapshot: () => ({ ...snapshot, activeSocketId }), flush: () => { clearTimeout(saveTimer); store.save({ style }); } };
}

module.exports = { createPracticeOverlay, sanitizeStyle, sanitizeSong, sanitizeFrame, mergeFrames, STYLE_DEFAULT, ROOM, EVENT, FX_IDS };
