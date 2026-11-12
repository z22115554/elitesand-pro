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
 * - 訂閱／贈訂／揪團的「全畫面演出」（kind: alert）走同一條佇列：伺服器只決定演哪一級、哪一種、
 *   演多久，畫面由 /display 內嵌的 /alert-show/stage.html 畫。演出清單與秒數讀
 *   public/alert-show/catalog.json（tools/alert-show/build.js 產生），不必載入引擎。
 * - 唱歌時收到的演出（全畫面演出、揪團小卡）預設先排進「等待中」，歌曲暫停或唱完、
 *   再等設定的秒數才演（跟 BGM 的兩個恢復延遲同一套概念）。點歌明信片跟著歌走，不受影響。
 *   試播不等，模擬 Twitch 事件照真實規則等。
 */

const path = require('path');

const KIND_POSTCARD = 'postcard';
const KIND_RAID = 'raid';
const KIND_ALERT = 'alert';

const CATALOG = require('../../public/alert-show/catalog.json');
const TIER_BY_ID = new Map(CATALOG.tiers.map((tier) => [tier.id, tier]));
const GIFT_STEPS = Object.freeze(['g5', 'g10', 'g25', 'g50', 'g100']); // g1 固定是 1 份
const RAID_STEPS = Object.freeze(['r2', 'r3', 'r4']);                    // r1 固定是 1 人
const RAID_MODES = Object.freeze(['card', 'show']);

const ANCHORS = Object.freeze(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
// 揪團感謝的外觀：classic 簡潔漸層、gold 金箔舞台、neon 霓虹、sakura 櫻花、stage 舞台彩帶。
// 點歌明信片的外觀：paper 紙本、gold 金箔、polaroid 拍立得、neon 霓虹、sakura 櫻花。
const POSTCARD_STYLES = Object.freeze(['paper', 'gold', 'polaroid', 'neon', 'sakura']);
const RAID_STYLES = Object.freeze(['gold', 'neon', 'sakura', 'stage', 'classic']);

// 位置各自設定：揪團感謝通常想放在醒目的上方，明信片常放在不擋臉的下方角落。
const DEFAULTS = Object.freeze({
  raid: Object.freeze({ enabled: false, minViewers: 1, durationSec: 8, style: 'gold', anchor: 'top-right', mode: 'card' }),
  alerts: Object.freeze({
    subEnabled: false,
    giftEnabled: false,
    volume: 70,
    giftMin: Object.freeze({ g5: CATALOG.giftMin.g5, g10: CATALOG.giftMin.g10, g25: CATALOG.giftMin.g25, g50: CATALOG.giftMin.g50, g100: CATALOG.giftMin.g100 }),
    raidMin: Object.freeze({ r2: CATALOG.raidMin.r2, r3: CATALOG.raidMin.r3, r4: CATALOG.raidMin.r4 }),
    off: Object.freeze([]),
    character: Object.freeze({ girl: 'default', mascot: 'default', face: Object.freeze({ x: 0.49, y: 0.15, s: 0.12 }), rev: 0 }),
    timing: Object.freeze({ singing: 'wait', pauseDelaySec: 3, endDelaySec: 5, bgm: 'duck', bgmDuck: 25 }),
  }),
  postcard: Object.freeze({ durationSec: 10, style: 'paper', anchor: 'top-right' }),
});

function pickAnchor(...candidates) {
  return candidates.find((value) => ANCHORS.includes(value)) || 'top-right';
}

const LIMITS = Object.freeze({
  raidMinViewersMin: 1, raidMinViewersMax: 10000,
  raidDurationMin: 4, raidDurationMax: 15,
  postcardDurationMin: 6, postcardDurationMax: 20,
  thresholdMax: 100000,
  alertCountMax: 9999999,
});

const MAX_QUEUE = 6;
const MAX_WAITING = 30; // 唱歌時累積的演出上限（一首歌五分鐘內很難超過）
const MAX_ARMED_POSTCARDS = 100;
const MAX_SEEN_EVENTS = 200;
const TEXT_LIMITS = Object.freeze({ title: 120, artist: 80, name: 40, message: 140, channel: 40 });
const ALERT_START_SLACK_MS = 1500; // 舞台第一次載入（字型、道具圖）要一點時間，多留一些再接下一個

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

/** 門檻要一級比一級高：使用者填反了就往上推，不讓兩級搶同一個數字。 */
function normalizeSteps(input, current, steps, firstMin) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  let floor = firstMin;
  for (const id of steps) {
    const value = clampInt(src[id], current[id], floor, LIMITS.thresholdMax);
    out[id] = Math.max(floor, value);
    floor = out[id] + 1;
  }
  return out;
}

/** 停用清單：只收目錄裡真的有的「等級:第幾種」，而且每一級至少留一種。 */
function normalizeOff(input, current) {
  const list = Array.isArray(input) ? input : (Array.isArray(current) ? current : []);
  const seen = new Set();
  for (const item of list) {
    const [tierId, indexText] = String(item).split(':');
    const tier = TIER_BY_ID.get(tierId);
    const index = Number(indexText);
    if (tier && Number.isInteger(index) && index >= 0 && index < tier.variants.length) seen.add(`${tierId}:${index}`);
  }
  for (const tier of CATALOG.tiers) {
    if (tier.variants.every((variant) => seen.has(`${tier.id}:${variant.index}`))) seen.delete(`${tier.id}:0`);
  }
  return [...seen].sort();
}

const SINGING_MODES = Object.freeze(['wait', 'now']);
const BGM_MODES = Object.freeze(['duck', 'pause', 'none']);

/** 唱歌時的演出時機，以及演出時 BGM 怎麼讓路。 */
function normalizeTiming(input, current) {
  const src = input && typeof input === 'object' ? input : {};
  const cur = current && typeof current === 'object' ? current : DEFAULTS.alerts.timing;
  return {
    singing: SINGING_MODES.includes(src.singing) ? src.singing : (SINGING_MODES.includes(cur.singing) ? cur.singing : 'wait'),
    pauseDelaySec: clampInt(src.pauseDelaySec, cur.pauseDelaySec ?? 3, 0, 30),
    endDelaySec: clampInt(src.endDelaySec, cur.endDelaySec ?? 5, 0, 60),
    bgm: BGM_MODES.includes(src.bgm) ? src.bgm : (BGM_MODES.includes(cur.bgm) ? cur.bgm : 'duck'),
    bgmDuck: clampInt(src.bgmDuck, cur.bgmDuck ?? 25, 0, 90),
  };
}

const GIRL_MODES = Object.freeze(['default', 'custom']);
const MASCOT_MODES = Object.freeze(['default', 'custom', 'none']);

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * 角色圖：girl／mascot 用內建或使用者上傳的（檔案在資料夾，見 server/routes/api/alert-show-assets.js），
 * face 是臉在圖裡的位置（比例），rev 是上傳時間，換圖後 OBS 靠它重新抓圖、不吃快取。
 */
function normalizeCharacter(input, current) {
  const src = input && typeof input === 'object' ? input : {};
  const cur = current && typeof current === 'object' ? current : DEFAULTS.alerts.character;
  const curFace = cur.face && typeof cur.face === 'object' ? cur.face : DEFAULTS.alerts.character.face;
  const face = src.face && typeof src.face === 'object' ? src.face : {};
  return {
    girl: GIRL_MODES.includes(src.girl) ? src.girl : (GIRL_MODES.includes(cur.girl) ? cur.girl : 'default'),
    mascot: MASCOT_MODES.includes(src.mascot) ? src.mascot : (MASCOT_MODES.includes(cur.mascot) ? cur.mascot : 'default'),
    face: {
      x: Math.round(clampNumber(face.x, curFace.x, 0, 1) * 1000) / 1000,
      y: Math.round(clampNumber(face.y, curFace.y, 0, 1) * 1000) / 1000,
      s: Math.round(clampNumber(face.s, curFace.s, 0.05, 0.35) * 1000) / 1000,
    },
    rev: Math.floor(clampNumber(src.rev, Number(cur.rev) || 0, 0, Number.MAX_SAFE_INTEGER)),
  };
}

function normalizeAlerts(input, current) {
  const src = input && typeof input === 'object' ? input : {};
  return {
    subEnabled: typeof src.subEnabled === 'boolean' ? src.subEnabled : !!current.subEnabled,
    giftEnabled: typeof src.giftEnabled === 'boolean' ? src.giftEnabled : !!current.giftEnabled,
    volume: clampInt(src.volume, current.volume, 0, 100),
    giftMin: normalizeSteps(src.giftMin, current.giftMin, GIFT_STEPS, 2),
    raidMin: normalizeSteps(src.raidMin, current.raidMin, RAID_STEPS, 2),
    off: normalizeOff(src.off, current.off),
    character: normalizeCharacter(src.character, current.character),
    timing: normalizeTiming(src.timing, current.timing),
  };
}

/** 份數／人數落在哪一級：取「門檻不超過這個數字」裡最高的那一級。 */
function tierForCount(count, firstId, steps, mins) {
  let best = firstId;
  for (const id of steps) if (count >= mins[id]) best = id;
  return best;
}

function normalizeSettings(input, current = DEFAULTS) {
  const src = input && typeof input === 'object' ? input : {};
  const currentAlerts = current.alerts && typeof current.alerts === 'object' ? { ...DEFAULTS.alerts, ...current.alerts } : DEFAULTS.alerts;
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
      mode: RAID_MODES.includes(raid.mode) ? raid.mode : (RAID_MODES.includes(current.raid.mode) ? current.raid.mode : DEFAULTS.raid.mode),
    },
    alerts: normalizeAlerts(src.alerts, currentAlerts),
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
function createOverlayShow({ emit, store = null, timers = globalThis, now = Date.now, onSettingsChange = null, random = Math.random } = {}) {
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
  const lastVariant = new Map(); // 等級 -> 上一次演的第幾種（同一級不連續重複）
  const waiting = [];            // 唱歌中先擱著的演出（還沒進佇列）
  let songPlaying = false;
  let releaseTimer = null;
  let releaseAt = 0;

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
      alerts: {
        ...settings.alerts,
        giftMin: { ...settings.alerts.giftMin },
        raidMin: { ...settings.alerts.raidMin },
        off: [...settings.alerts.off],
        character: { ...settings.alerts.character, face: { ...settings.alerts.character.face } },
        timing: { ...settings.alerts.timing },
      },
    };
  }

  function updateSettings(partial) {
    settings = normalizeSettings(partial, settings);
    persist();
    if (settings.alerts.timing.singing === 'now' && waiting.length) releaseWaiting(); // 改成「馬上演」：等待中的也不用再等
    return getSettings();
  }

  // ─── 唱歌時先等一下 ───

  /** 會被「唱歌中」擋住的種類：全畫面演出與揪團小卡。明信片跟著歌走，不擋。 */
  function holdsForSong(show) {
    return show.kind !== KIND_POSTCARD && !show.bypassWait;
  }

  function status() {
    return { waiting: waiting.length, releaseAt: releaseAt || null, songPlaying, serverNow: now() };
  }

  function emitStatus() {
    send('overlay-show:status', status());
  }

  function clearReleaseTimer() {
    if (releaseTimer) { timers.clearTimeout(releaseTimer); releaseTimer = null; }
    releaseAt = 0;
  }

  /** 等待中的全部移進佇列，一個接一個演。 */
  function releaseWaiting() {
    clearReleaseTimer();
    if (waiting.length) {
      queue.push(...waiting.splice(0));
      playNext();
    }
    emitStatus();
    return true;
  }

  function clearWaiting() {
    clearReleaseTimer();
    waiting.length = 0;
    emitStatus();
    return true;
  }

  /**
   * 歌曲狀態（由播放 handler 呼叫）。playing=true：開始唱；false 時 reason 是 'pause'（暫停）或 'end'（唱完、停止、換歌待命）。
   * 開始唱的那一刻，佇列裡還沒開演的全畫面演出也退回等待（正在演的那一個讓它演完）。
   */
  function setSongState(playing, reason = 'end') {
    const next = !!playing;
    if (next) {
      clearReleaseTimer();
      if (settings.alerts.timing.singing === 'wait') {
        const held = [];
        for (let i = queue.length - 1; i >= 0; i -= 1) {
          if (holdsForSong(queue[i])) held.unshift(queue.splice(i, 1)[0]);
        }
        if (held.length) waiting.unshift(...held);
      }
      songPlaying = true;
      emitStatus();
      return;
    }
    const changed = songPlaying;
    songPlaying = false;
    if (waiting.length && (changed || !releaseTimer)) {
      clearReleaseTimer();
      const sec = reason === 'pause' ? settings.alerts.timing.pauseDelaySec : settings.alerts.timing.endDelaySec;
      releaseAt = now() + sec * 1000;
      releaseTimer = timers.setTimeout(() => { releaseTimer = null; releaseAt = 0; releaseWaiting(); }, sec * 1000);
      if (releaseTimer && typeof releaseTimer.unref === 'function') releaseTimer.unref();
    }
    emitStatus();
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
    // 卡片多留一點讓退場動畫跑完；全畫面演出要等舞台載入，留更多。
    activeTimer = timers.setTimeout(finishActive, active.durationMs + (active.kind === KIND_ALERT ? ALERT_START_SLACK_MS : 600));
    if (activeTimer && typeof activeTimer.unref === 'function') activeTimer.unref();
  }

  function enqueue(show) {
    if (songPlaying && settings.alerts.timing.singing === 'wait' && holdsForSong(show)) {
      if (waiting.length >= MAX_WAITING) return null;
      const held = { id: nextId(), ...show };
      waiting.push(held);
      emitStatus();
      return held.id;
    }
    if (queue.length >= MAX_QUEUE) return null;
    const full = { id: nextId(), ...show };
    queue.push(full);
    playNext();
    return full.id;
  }

  function isWaiting(id) {
    return waiting.some((show) => show.id === id);
  }

  function rememberEvent(eventId) {
    if (!eventId) return false;
    if (seenEvents.includes(eventId)) return true;
    seenEvents.push(eventId);
    if (seenEvents.length > MAX_SEEN_EVENTS) seenEvents.shift();
    return false;
  }

  // ─── 訂閱／贈訂／揪團的全畫面演出 ───

  /** 從這一級「沒被停用」的演出裡挑一種；有兩種以上時不跟上一次重複。 */
  function pickVariant(tierId) {
    const tier = TIER_BY_ID.get(tierId);
    let pool = tier.variants.map((variant) => variant.index).filter((index) => !settings.alerts.off.includes(`${tierId}:${index}`));
    if (!pool.length) pool = [0];
    const last = lastVariant.get(tierId);
    if (pool.length > 1 && last != null) pool = pool.filter((index) => index !== last);
    const pick = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
    lastVariant.set(tierId, pick);
    return pick;
  }

  function enqueueAlert(tierId, { variant = null, count = 0, name = '', bypassWait = false } = {}) {
    const tier = TIER_BY_ID.get(tierId);
    if (!tier) return null;
    const index = Number.isInteger(variant) && tier.variants[variant] ? variant : pickVariant(tierId);
    return enqueue({
      kind: KIND_ALERT,
      bypassWait,
      durationMs: Math.round(tier.variants[index].dur * 1000),
      payload: {
        tier: tierId,
        variant: index,
        n: tierId === 'sub' ? 0 : clampInt(count, 1, 1, LIMITS.alertCountMax),
        name: cleanText(name, TEXT_LIMITS.name),
        volume: settings.alerts.volume,
      },
    });
  }

  /**
   * Twitch 的訂閱類通知。type：sub（新訂閱）／resub（續訂分享）／gift（贈訂，count＝這一次送出的份數）。
   * 匿名贈訂 name 留空，畫面上顯示各語言的「觀眾」。
   */
  function handleSupport({ eventId = '', type = '', name = '', count = 1 } = {}) {
    if (type !== 'sub' && type !== 'resub' && type !== 'gift') return { ok: false, reason: 'unknown-type' };
    if (rememberEvent(String(eventId || ''))) return { ok: false, reason: 'duplicate' };
    if (type === 'gift') {
      if (!settings.alerts.giftEnabled) return { ok: false, reason: 'disabled' };
      const total = Math.max(1, Math.floor(Number(count) || 1));
      const tierId = tierForCount(total, 'g1', GIFT_STEPS, settings.alerts.giftMin);
      const id = enqueueAlert(tierId, { count: total, name });
      return id ? { ok: true, id, tier: tierId, waiting: isWaiting(id) } : { ok: false, reason: 'queue-full' };
    }
    if (!settings.alerts.subEnabled) return { ok: false, reason: 'disabled' };
    const id = enqueueAlert('sub', { name });
    return id ? { ok: true, id, tier: 'sub', waiting: isWaiting(id) } : { ok: false, reason: 'queue-full' };
  }

  // ─── 揪團感謝 ───

  function handleRaid({ eventId = '', fromName = '', viewers = 0 } = {}) {
    if (rememberEvent(String(eventId || ''))) return { ok: false, reason: 'duplicate' };
    if (!settings.raid.enabled) return { ok: false, reason: 'disabled' };
    const count = Math.max(0, Math.floor(Number(viewers) || 0));
    if (count < settings.raid.minViewers) return { ok: false, reason: 'below-min' };
    const name = cleanText(fromName, TEXT_LIMITS.channel);
    if (!name) return { ok: false, reason: 'no-name' };
    if (settings.raid.mode === 'show') {
      const tierId = tierForCount(count, 'r1', RAID_STEPS, settings.alerts.raidMin);
      const showId = enqueueAlert(tierId, { count: Math.max(1, count), name });
      return showId ? { ok: true, id: showId, tier: tierId, waiting: isWaiting(showId) } : { ok: false, reason: 'queue-full' };
    }
    const id = enqueue({
      kind: KIND_RAID,
      durationMs: settings.raid.durationSec * 1000,
      payload: { name, viewers: count, style: settings.raid.style },
    });
    return id ? { ok: true, id, waiting: isWaiting(id) } : { ok: false, reason: 'queue-full' };
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
    waiting.length = 0;
    clearReleaseTimer();
    finishActive();
    emitStatus();
  }

  /** 測試演出：不看啟用開關、不看人數門檻，也不進去重表。 */
  function test(kind, options = {}) {
    if (kind === KIND_ALERT) {
      const tier = TIER_BY_ID.get(String(options.tier || ''));
      if (!tier) return null;
      const fallback = tier.group === 'gift'
        ? (tier.id === 'g1' ? 1 : settings.alerts.giftMin[tier.id])
        : (tier.group === 'raid' ? (tier.id === 'r1' ? Math.max(1, settings.raid.minViewers) : settings.alerts.raidMin[tier.id]) : 0);
      const variant = Number(options.variant);
      return enqueueAlert(tier.id, {
        bypassWait: true, // 試播是主播自己按的，馬上演
        variant: Number.isInteger(variant) ? variant : null,
        count: clampInt(options.count, fallback, 1, LIMITS.alertCountMax),
        name: options.name == null || options.name === '' ? 'SampleViewer' : options.name,
      });
    }
    if (kind === KIND_RAID) {
      if (settings.raid.mode === 'show') {
        const tierId = tierForCount(23, 'r1', RAID_STEPS, settings.alerts.raidMin);
        return enqueueAlert(tierId, { count: 23, name: 'SampleChannel', bypassWait: true });
      }
      return enqueue({ kind: KIND_RAID, bypassWait: true, durationMs: settings.raid.durationSec * 1000, payload: { name: 'SampleChannel', viewers: 23, style: settings.raid.style } });
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
    return { active: active ? { id: active.id, kind: active.kind } : null, queued: queue.length, armed: armed.size, waiting: waiting.length, songPlaying };
  }

  return {
    getSettings, updateSettings,
    handleRaid, handleSupport, armPostcard, dropPostcard, onTrackChanged, onTrackPlaying,
    skip, clearAll, test, snapshot,
    setSongState, releaseWaiting, clearWaiting, status,
  };
}

module.exports = {
  createOverlayShow, normalizeSettings, cleanText,
  DEFAULTS, LIMITS, ANCHORS, RAID_STYLES, RAID_MODES, POSTCARD_STYLES, KIND_POSTCARD, KIND_RAID, KIND_ALERT, MAX_QUEUE,
  CATALOG, GIFT_STEPS, RAID_STEPS, tierForCount, MAX_WAITING,
};
