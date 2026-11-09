'use strict';

/**
 * OBS 互動演出佇列：點歌明信片、Twitch 揪團感謝共用同一條「一次只演一個」的軌道。
 *
 * 設計取捨：
 * - 演出是純轉播（io.emit），不寫 playState、不進 state:sync，OBS 重載後不會殘留前一張
 *   （比照 setlist:demo，鐵則 5／9）。
 * - 所有文字進來先過 cleanText（去控制字元、截長度）；顯示端一律 textContent，不吃 HTML。
 * - 明信片只在「主播核准時明確勾了允許上畫面」才會登記（armPostcard），預設不上畫面。
 *   登記只放記憶體、有上限；重啟後沒演的明信片不補演，寧可不演也不誤演。
 * - 揪團事件依 Twitch message id 去重（EventSub 重連／重送時同一筆不會演兩次）。
 */

const path = require('path');

const KIND_POSTCARD = 'postcard';
const KIND_RAID = 'raid';

const ANCHORS = Object.freeze(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
// 揪團感謝的外觀：classic 簡潔漸層、gold 金箔舞台、neon 霓虹、sakura 櫻花、stage 舞台彩帶。
// 點歌明信片的外觀：paper 紙本、gold 金箔、polaroid 拍立得、neon 霓虹、sakura 櫻花。
const POSTCARD_STYLES = Object.freeze(['paper', 'gold', 'polaroid', 'neon', 'sakura']);
const RAID_STYLES = Object.freeze(['gold', 'neon', 'sakura', 'stage', 'classic']);

// 位置各自設定：揪團感謝通常想放在醒目的上方，明信片常放在不擋臉的下方角落。
const DEFAULTS = Object.freeze({
  raid: Object.freeze({ enabled: false, minViewers: 1, durationSec: 8, style: 'gold', anchor: 'top-right' }),
  postcard: Object.freeze({ durationSec: 10, style: 'paper', anchor: 'top-right' }),
});

function pickAnchor(...candidates) {
  return candidates.find((value) => ANCHORS.includes(value)) || 'top-right';
}

const LIMITS = Object.freeze({
  raidMinViewersMin: 1, raidMinViewersMax: 10000,
  raidDurationMin: 4, raidDurationMax: 15,
  postcardDurationMin: 6, postcardDurationMax: 20,
});

const MAX_QUEUE = 6;
const MAX_ARMED_POSTCARDS = 100;
const MAX_SEEN_EVENTS = 200;
const TEXT_LIMITS = Object.freeze({ title: 120, artist: 80, name: 40, message: 140, channel: 40 });

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** 去掉控制字元／換行、收斂空白、截長度。顯示端另外只用 textContent。 */
function cleanText(value, max) {
  return String(value == null ? '' : value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeSettings(input, current = DEFAULTS) {
  const src = input && typeof input === 'object' ? input : {};
  const raid = src.raid && typeof src.raid === 'object' ? src.raid : {};
  const postcard = src.postcard && typeof src.postcard === 'object' ? src.postcard : {};
  // 舊版只有一個共用的 src.anchor：沒有各自的值時兩邊都沿用它。
  return {
    raid: {
      enabled: typeof raid.enabled === 'boolean' ? raid.enabled : !!current.raid.enabled,
      minViewers: clampInt(raid.minViewers, current.raid.minViewers, LIMITS.raidMinViewersMin, LIMITS.raidMinViewersMax),
      durationSec: clampInt(raid.durationSec, current.raid.durationSec, LIMITS.raidDurationMin, LIMITS.raidDurationMax),
      style: RAID_STYLES.includes(raid.style) ? raid.style : (RAID_STYLES.includes(current.raid.style) ? current.raid.style : DEFAULTS.raid.style),
      anchor: pickAnchor(raid.anchor, src.anchor, current.raid.anchor, current.anchor),
    },
    postcard: {
      durationSec: clampInt(postcard.durationSec, current.postcard.durationSec, LIMITS.postcardDurationMin, LIMITS.postcardDurationMax),
      style: POSTCARD_STYLES.includes(postcard.style) ? postcard.style : (POSTCARD_STYLES.includes(current.postcard.style) ? current.postcard.style : DEFAULTS.postcard.style),
      anchor: pickAnchor(postcard.anchor, src.anchor, current.postcard.anchor, current.anchor),
    },
  };
}

function createDiskSettingsStore() {
  const { createJsonStore } = require('./json-store');
  const { dataDir } = require('../utils/app-paths');
  const { createLogger } = require('../utils/logger');
  const log = createLogger('OverlayShow');
  return createJsonStore({
    file: path.join(dataDir, 'overlay-show-settings.json'),
    label: '互動演出設定',
    defaultValue: () => normalizeSettings(DEFAULTS),
    migrations: new Map([[0, (legacy) => ({ schemaVersion: 1, settings: normalizeSettings(legacy) })]]),
    serialize: (settings) => ({ settings }),
    deserialize: (document) => normalizeSettings(document.settings),
    validate: (document) => !!document && typeof document.settings === 'object',
    logger: log,
  });
}

/**
 * @param {object} deps
 * @param {(event:string,payload:object)=>void} deps.emit      廣播給 OBS 顯示端
 * @param {{load:Function,save:Function}} [deps.store]         設定存取；不給就用磁碟版
 * @param {{setTimeout:Function,clearTimeout:Function}} [deps.timers]
 */
function createOverlayShow({ emit, store = null, timers = globalThis, now = Date.now, onSettingsChange = null } = {}) {
  const send = typeof emit === 'function' ? emit : () => {};
  const settingsStore = store || createDiskSettingsStore();
  let settings;
  try { settings = normalizeSettings(settingsStore.load()); } catch (_) { settings = normalizeSettings(DEFAULTS); }

  let seq = 0;
  let active = null;
  let activeTimer = null;
  const queue = [];
  const armed = new Map();       // entryId -> postcard（尚未演出）
  const shownEntries = new Set(); // 已演過的 entryId，避免暫停再播又演一次
  const seenEvents = [];

  function nextId() { seq += 1; return `show-${now().toString(36)}-${seq}`; }

  function persist() {
    try { settingsStore.save(settings); } catch (_) { /* 存不了就只活在記憶體，不影響演出 */ }
    if (typeof onSettingsChange === 'function') {
      try { onSettingsChange(getSettings()); } catch (_) { /* 觀測失敗不影響演出 */ }
    }
  }

  function getSettings() {
    return {
      raid: { ...settings.raid },
      postcard: { ...settings.postcard },
    };
  }

  function updateSettings(partial) {
    settings = normalizeSettings(partial, settings);
    persist();
    return getSettings();
  }

  function finishActive() {
    if (activeTimer) { timers.clearTimeout(activeTimer); activeTimer = null; }
    if (!active) return;
    const done = active;
    active = null;
    send('overlay-show:clear', { id: done.id, kind: done.kind });
    playNext();
  }

  function playNext() {
    if (active || !queue.length) return;
    active = queue.shift();
    send('overlay-show:play', {
      id: active.id,
      kind: active.kind,
      durationMs: active.durationMs,
      anchor: active.kind === KIND_RAID ? settings.raid.anchor : settings.postcard.anchor,
      payload: active.payload,
    });
    activeTimer = timers.setTimeout(finishActive, active.durationMs + 600); // 多留一點讓退場動畫跑完
    if (activeTimer && typeof activeTimer.unref === 'function') activeTimer.unref();
  }

  function enqueue(show) {
    if (queue.length >= MAX_QUEUE) return null;
    const full = { id: nextId(), ...show };
    queue.push(full);
    playNext();
    return full.id;
  }

  function rememberEvent(eventId) {
    if (!eventId) return false;
    if (seenEvents.includes(eventId)) return true;
    seenEvents.push(eventId);
    if (seenEvents.length > MAX_SEEN_EVENTS) seenEvents.shift();
    return false;
  }

  // ─── 揪團感謝 ───

  function handleRaid({ eventId = '', fromName = '', viewers = 0 } = {}) {
    if (rememberEvent(String(eventId || ''))) return { ok: false, reason: 'duplicate' };
    if (!settings.raid.enabled) return { ok: false, reason: 'disabled' };
    const count = Math.max(0, Math.floor(Number(viewers) || 0));
    if (count < settings.raid.minViewers) return { ok: false, reason: 'below-min' };
    const name = cleanText(fromName, TEXT_LIMITS.channel);
    if (!name) return { ok: false, reason: 'no-name' };
    const id = enqueue({
      kind: KIND_RAID,
      durationMs: settings.raid.durationSec * 1000,
      payload: { name, viewers: count, style: settings.raid.style },
    });
    return id ? { ok: true, id } : { ok: false, reason: 'queue-full' };
  }

  // ─── 點歌明信片 ───

  /** 主播核准且勾了「允許留言上畫面」才呼叫。message 空白就不登記。 */
  function armPostcard(entryId, { title = '', artist = '', name = '', message = '' } = {}) {
    const key = String(entryId || '');
    const text = cleanText(message, TEXT_LIMITS.message);
    if (!key || !text) return false;
    if (!armed.has(key) && armed.size >= MAX_ARMED_POSTCARDS) {
      armed.delete(armed.keys().next().value);
    }
    armed.set(key, {
      title: cleanText(title, TEXT_LIMITS.title),
      artist: cleanText(artist, TEXT_LIMITS.artist),
      name: cleanText(name, TEXT_LIMITS.name),
      message: text,
    });
    shownEntries.delete(key);
    return true;
  }

  function dropPostcard(entryId) {
    armed.delete(String(entryId || ''));
  }

  function removePostcards() {
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (queue[i].kind === KIND_POSTCARD) queue.splice(i, 1);
    }
    if (active && active.kind === KIND_POSTCARD) finishActive();
  }

  /** 換歌／停止／清空：立刻收掉明信片，不留上一首的卡。 */
  function onTrackChanged() {
    removePostcards();
  }

  /** 歌曲真的開始播放（含暫停後再播）：登記過、還沒演過的明信片在這時播一次。 */
  function onTrackPlaying(track) {
    const key = String(track?.entryId || '');
    if (!key || shownEntries.has(key)) return null;
    const card = armed.get(key);
    if (!card) return null;
    armed.delete(key);
    shownEntries.add(key);
    if (shownEntries.size > MAX_ARMED_POSTCARDS * 2) shownEntries.delete(shownEntries.values().next().value);
    return enqueue({
      kind: KIND_POSTCARD,
      durationMs: settings.postcard.durationSec * 1000,
      payload: {
        title: card.title || cleanText(track.title, TEXT_LIMITS.title),
        artist: card.artist || cleanText(track.artist, TEXT_LIMITS.artist),
        name: card.name,
        message: card.message,
        style: settings.postcard.style,
      },
    });
  }

  // ─── 主播操作 ───

  function skip() { finishActive(); return true; }

  function clearAll() {
    queue.length = 0;
    finishActive();
  }

  /** 測試演出：不看啟用開關、不看人數門檻，也不進去重表。 */
  function test(kind) {
    if (kind === KIND_RAID) {
      return enqueue({ kind: KIND_RAID, durationMs: settings.raid.durationSec * 1000, payload: { name: 'SampleChannel', viewers: 23, style: settings.raid.style } });
    }
    if (kind === KIND_POSTCARD) {
      return enqueue({
        kind: KIND_POSTCARD,
        durationMs: settings.postcard.durationSec * 1000,
        payload: { title: 'Sample Song', artist: 'Sample Artist', name: 'Sample', message: 'Thanks for the stream! Please sing this one for my friend.', style: settings.postcard.style },
      });
    }
    return null;
  }

  function snapshot() {
    return { active: active ? { id: active.id, kind: active.kind } : null, queued: queue.length, armed: armed.size };
  }

  return {
    getSettings, updateSettings,
    handleRaid, armPostcard, dropPostcard, onTrackChanged, onTrackPlaying,
    skip, clearAll, test, snapshot,
  };
}

module.exports = {
  createOverlayShow, normalizeSettings, cleanText,
  DEFAULTS, LIMITS, ANCHORS, RAID_STYLES, POSTCARD_STYLES, KIND_POSTCARD, KIND_RAID, MAX_QUEUE,
};
