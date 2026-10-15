/**
 * 萬聖節觀眾互動：data/halloween-interactions.json
 *
 * - 要糖果、小幽靈、搗蛋嚇人各有聊天指令與頻道點數開關，共用排行／抽獎統計。
 * - 聊天有每人冷卻；點數有各獎勵的全頻道冷卻，成功後完成兌換，活動結束或關閉時取消兌換退點數。
 * - 糖果排行：依 !treat 次數排名，謝幕名單會公布「糖果王」。
 * - 抽獎：從聊天參加者、斗內者或兩者合併的名單裡抽，可依糖果數加權、可排除已中獎者。
 *
 * 只透過 TwitchService 的兩個攔截點接觸 Twitch（setChatInterceptor／setRedemptionInterceptor），
 * 點歌的指令、冷卻與兌換流程完全不受影響。活動是否進行沿用 halloween-event 的啟動時判斷。
 */
const path = require('path');
const crypto = require('crypto');
const { createLogger } = require('../utils/logger');
const { createJsonStore } = require('./json-store');
const { dataDir: DATA_DIR } = require('../utils/app-paths');

const log = createLogger('HalloweenFx');

const MAX_VIEWERS = 5000;
const MAX_WINNERS = 100;
const BOARD_SIZE = 10;
const BOARD_THROTTLE_MS = 1000;
const MAX_COMMAND_LENGTH = 24;
const MAX_REWARD_TITLE = 45;
const MAX_NAME_LENGTH = 25;
const RAFFLE_POOLS = Object.freeze(['chat', 'donors', 'all']);
// 抽獎揭曉的時長（秒）：名字輪轉多久、得主停在畫面上多久。
const RAFFLE_SPIN_SECONDS = Object.freeze({ min: 1, max: 30, fallback: 3 });
const RAFFLE_HOLD_SECONDS = Object.freeze({ min: 2, max: 60, fallback: 7 });

const DEFAULT_SETTINGS = Object.freeze({
  chatEnabled: true,
  treatChatEnabled: true,
  trickChatEnabled: true,
  trickCommand: '!trick',
  treatCommand: '!treat',
  userCooldownSeconds: 30,
  rewards: Object.freeze({
    treat: Object.freeze({ enabled: false, rewardId: '', title: '萬聖節要糖果', prompt: '讓糖果飄過畫面，累積糖果排行！', cost: 100, cooldownSeconds: 10 }),
    trick: Object.freeze({ enabled: false, rewardId: '', title: '萬聖節小幽靈', prompt: '讓一隻小幽靈飄過畫面！', cost: 100, cooldownSeconds: 10 }),
  }),
  prank: Object.freeze({
    chatEnabled: false,
    command: '!scare',
    enabled: false,
    rewardId: '',
    title: '萬聖節搗蛋',
    prompt: '讓幽靈跳出來嚇主播一下！',
    cost: 300,
    cooldownSeconds: 60,
  }),
});

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}

// 指令：一個不含空白的字，例如 !trick、!糖果；大小寫不分。
function cleanCommand(value, fallback) {
  const text = cleanText(value, MAX_COMMAND_LENGTH);
  if (!text || /\s/.test(text)) return fallback;
  return text;
}

function cleanSettings(input, fallback = DEFAULT_SETTINGS) {
  const prankIn = input?.prank || {};
  const prankBase = fallback.prank || DEFAULT_SETTINGS.prank;
  const settings = {
    chatEnabled: typeof input?.chatEnabled === 'boolean' ? input.chatEnabled : fallback.chatEnabled,
    treatChatEnabled: typeof input?.treatChatEnabled === 'boolean' ? input.treatChatEnabled : fallback.treatChatEnabled,
    trickChatEnabled: typeof input?.trickChatEnabled === 'boolean' ? input.trickChatEnabled : fallback.trickChatEnabled,
    trickCommand: cleanCommand(input?.trickCommand, fallback.trickCommand),
    treatCommand: cleanCommand(input?.treatCommand, fallback.treatCommand),
    userCooldownSeconds: clampInt(input?.userCooldownSeconds, 0, 3600, fallback.userCooldownSeconds),
    rewards: Object.fromEntries(['treat', 'trick'].map((kind) => [kind,
      cleanReward(input?.rewards?.[kind], fallback.rewards?.[kind] || DEFAULT_SETTINGS.rewards[kind])])),
    prank: {
      chatEnabled: typeof prankIn.chatEnabled === 'boolean' ? prankIn.chatEnabled : prankBase.chatEnabled,
      command: cleanCommand(prankIn.command, prankBase.command),
      enabled: typeof prankIn.enabled === 'boolean' ? prankIn.enabled : prankBase.enabled,
      rewardId: typeof prankIn.rewardId === 'string' && /^[a-z0-9-]{8,80}$/i.test(prankIn.rewardId) ? prankIn.rewardId
        : (prankIn.rewardId === '' ? '' : prankBase.rewardId),
      title: cleanText(prankIn.title, MAX_REWARD_TITLE) || prankBase.title,
      prompt: cleanText(prankIn.prompt, 200) || prankBase.prompt,
      cost: clampInt(prankIn.cost, 1, 1_000_000, prankBase.cost),
      cooldownSeconds: clampInt(prankIn.cooldownSeconds, 0, 3600, prankBase.cooldownSeconds),
    },
  };
  if (settings.trickCommand.toLocaleLowerCase() === settings.treatCommand.toLocaleLowerCase()) {
    settings.trickCommand = fallback.trickCommand;
    settings.treatCommand = fallback.treatCommand;
  }
  // 舊設定可能早已把 !scare 用作糖果／小幽靈指令；新增嚇人指令不可覆蓋舊指令。
  const used = new Set([settings.trickCommand, settings.treatCommand].map((v) => v.toLocaleLowerCase()));
  if (used.has(settings.prank.command.toLocaleLowerCase())) {
    settings.prank.command = [prankBase.command, '!scare', '!scare2', '!scare3']
      .find((command) => !used.has(command.toLocaleLowerCase()));
  }
  return settings;
}

function cleanReward(input = {}, base) {
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : base.enabled,
    rewardId: typeof input?.rewardId === 'string' && /^[a-z0-9-]{8,80}$/i.test(input.rewardId) ? input.rewardId
      : (input?.rewardId === '' ? '' : base.rewardId),
    title: cleanText(input?.title, MAX_REWARD_TITLE) || base.title,
    prompt: cleanText(input?.prompt, 200) || base.prompt,
    cost: clampInt(input?.cost, 1, 1_000_000, base.cost),
    cooldownSeconds: clampInt(input?.cooldownSeconds, 0, 3600, base.cooldownSeconds),
  };
}

function cleanViewer(raw) {
  const name = cleanText(raw?.name, MAX_NAME_LENGTH);
  if (!name) return null;
  return {
    name,
    treats: clampInt(raw?.treats, 0, 1e9, 0),
    tricks: clampInt(raw?.tricks, 0, 1e9, 0),
    pranks: clampInt(raw?.pranks, 0, 1e9, 0),
    lastAt: Number.isFinite(raw?.lastAt) ? raw.lastAt : 0,
  };
}

function cleanWinner(raw) {
  const name = cleanText(raw?.name, MAX_NAME_LENGTH);
  if (!name) return null;
  return {
    key: cleanText(raw?.key, 120) || `name:${name.toLocaleLowerCase()}`,
    name,
    pool: RAFFLE_POOLS.includes(raw?.pool) ? raw.pool : 'all',
    poolSize: clampInt(raw?.poolSize, 1, 1e6, 1),
    at: Number.isFinite(raw?.at) ? raw.at : Date.now(),
  };
}

function interactionRewardBody(prank, includeEnabled = true) {
  const body = {
    title: prank.title,
    prompt: prank.prompt,
    cost: prank.cost,
    is_user_input_required: false,
    // 不跳過佇列：成功播出才完成兌換，活動結束或功能關閉時可以退點數。
    should_redemptions_skip_request_queue: false,
    is_global_cooldown_enabled: prank.cooldownSeconds > 0,
    background_color: '#E8650C',
  };
  if (prank.cooldownSeconds > 0) body.global_cooldown_seconds = prank.cooldownSeconds;
  if (includeEnabled) body.is_enabled = prank.enabled;
  return body;
}

/**
 * @param {object} deps
 * @param {() => boolean} deps.isActive    萬聖節活動是否進行中
 * @param {(event: string, payload: any) => void} deps.emit 廣播給所有 socket（面板與疊加層）
 * @param {() => Array<{name: string, amount: number}>} deps.getDonations 斗內清單（抽獎用）
 * @param {string} [deps.file]
 */
function createHalloweenInteractions({ isActive, emit, getDonations, file = path.join(DATA_DIR, 'halloween-interactions.json'), now = () => Date.now(), randomInt = crypto.randomInt }) {
  let settings = cleanSettings(null);
  const viewers = new Map();
  let winners = [];
  let saveTimer = null;
  let boardTimer = null;
  let twitch = null;
  let settingsQueue = Promise.resolve();
  const cooldowns = new Map();
  const seenRedemptions = new Map();

  const diskStore = createJsonStore({
    file,
    label: '萬聖節互動',
    defaultValue: () => ({ settings: cleanSettings(null), viewers: {}, winners: [] }),
    validate: (doc) => doc && typeof doc === 'object' && doc.viewers && typeof doc.viewers === 'object',
    logger: log,
  });

  (function load() {
    const loaded = diskStore.load();
    settings = cleanSettings(loaded?.settings);
    for (const [key, raw] of Object.entries(loaded?.viewers || {}).slice(0, MAX_VIEWERS)) {
      const viewer = cleanViewer(raw);
      if (viewer) viewers.set(String(key).slice(0, 120), viewer);
    }
    winners = (Array.isArray(loaded?.winners) ? loaded.winners : []).map(cleanWinner).filter(Boolean).slice(-MAX_WINNERS);
  })();

  function saveNow() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    try {
      return diskStore.save({ settings, viewers: Object.fromEntries(viewers), winners });
    } catch (err) {
      log.warn(`萬聖節互動寫入失敗: ${err.message}`);
      return false;
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 800);
  }

  function board() {
    const ranked = [...viewers.values()]
      .filter((v) => v.treats > 0)
      .sort((a, b) => b.treats - a.treats || a.lastAt - b.lastAt);
    let totalTreats = 0;
    let totalTricks = 0;
    let totalPranks = 0;
    let participants = 0;
    for (const v of viewers.values()) {
      totalTreats += v.treats;
      totalTricks += v.tricks;
      totalPranks += v.pranks;
      if (v.treats + v.tricks + v.pranks > 0) participants += 1;
    }
    return {
      top: ranked.slice(0, BOARD_SIZE).map(({ name, treats, tricks }) => ({ name, treats, tricks })),
      participants, totalTreats, totalTricks, totalPranks,
    };
  }

  function publicSettings() {
    return { ...settings, prank: { ...settings.prank }, rewards: Object.fromEntries(
      Object.entries(settings.rewards).map(([kind, reward]) => [kind, { ...reward }])) };
  }

  function snapshot() {
    return { active: isActive(), settings: publicSettings(), board: board(), winners: winners.slice().reverse() };
  }

  // 排行變動時最多每秒推一次，聊天室刷 !treat 時不會每則訊息都廣播整份排行。
  function scheduleBoard() {
    if (boardTimer) return;
    boardTimer = setTimeout(() => {
      boardTimer = null;
      emit('halloween:board', board());
    }, BOARD_THROTTLE_MS);
  }

  function viewerFor(event) {
    const key = String(event?.chatter_user_id || event?.user_id || event?.chatter_user_login || '').trim().toLocaleLowerCase();
    const name = cleanText(event?.chatter_user_name || event?.user_name || event?.chatter_user_login || '', MAX_NAME_LENGTH);
    if (!key || !name) return null;
    let viewer = viewers.get(key);
    if (!viewer) {
      if (viewers.size >= MAX_VIEWERS) return null;
      viewer = { name, treats: 0, tricks: 0, pranks: 0, lastAt: 0 };
      viewers.set(key, viewer);
    }
    viewer.name = name;
    return { key, viewer };
  }

  /** 聊天攔截點：是 !trick／!treat 就回 true（含冷卻中被忽略的情況），其餘交回點歌流程。 */
  function handleChat(event) {
    if (!isActive() || !settings.chatEnabled) return false;
    const word = String(event?.message?.text || '').trim().split(/\s+/)[0]?.toLocaleLowerCase() || '';
    if (!word) return false;
    const kind = word === settings.treatCommand.toLocaleLowerCase() ? 'treat'
      : word === settings.trickCommand.toLocaleLowerCase() ? 'trick'
        : word === settings.prank.command.toLocaleLowerCase() ? 'prank' : null;
    if (!kind) return false;
    if (kind === 'prank' ? !settings.prank.chatEnabled : !settings[`${kind}ChatEnabled`]) return false;
    const found = viewerFor(event);
    if (!found) return true;
    const at = now();
    const until = cooldowns.get(found.key) || 0;
    if (at < until) return true;
    cooldowns.set(found.key, at + settings.userCooldownSeconds * 1000);
    if (cooldowns.size > MAX_VIEWERS) {
      for (const [key, expires] of cooldowns) if (expires <= at) cooldowns.delete(key);
    }
    recordInteraction(kind, found);
    return true;
  }

  // 點數兌換使用 Twitch 獎勵的冷卻，不受免費聊天指令的冷卻影響。
  function recordInteraction(kind, found) {
    const at = now();
    const field = kind === 'prank' ? 'pranks' : kind === 'treat' ? 'treats' : 'tricks';
    found.viewer[field] += 1;
    found.viewer.lastAt = at;
    scheduleSave();
    scheduleBoard();
    emit(kind === 'prank' ? 'halloween:prank' : 'halloween:pop',
      { kind, name: found.viewer.name, count: found.viewer[field], at });
  }

  async function setRedemptionStatus(redemption, status) {
    try {
      await twitch?.updateRewardRedemptionStatus(redemption, status);
    } catch (err) {
      log.warn(`萬聖節兌換狀態更新失敗（${status}）：${err.message}`);
    }
  }

  /** 兌換攔截點：本活動三種獎勵皆在此處處理，其他獎勵交回點歌流程。 */
  async function handleRedemption(redemptionEvent, fallbackId) {
    const rewardId = String(redemptionEvent?.reward?.id || '');
    const kind = ['treat', 'trick', 'prank'].find((key) => {
      const reward = key === 'prank' ? settings.prank : settings.rewards[key];
      return reward.rewardId && rewardId === reward.rewardId;
    });
    if (!kind) return false;
    const reward = kind === 'prank' ? settings.prank : settings.rewards[kind];
    if (redemptionEvent.status && !/^unfulfilled$/i.test(redemptionEvent.status)) return true;
    const id = String(redemptionEvent.id || fallbackId || '');
    if (!id || seenRedemptions.has(id)) return true;
    seenRedemptions.set(id, now());
    if (seenRedemptions.size > 500) seenRedemptions.delete(seenRedemptions.keys().next().value);
    const redemption = { id, rewardId };
    if (!isActive() || !reward.enabled) {
      await setRedemptionStatus(redemption, 'CANCELED');
      return true;
    }
    const found = viewerFor(redemptionEvent);
    if (!found) {
      await setRedemptionStatus(redemption, 'CANCELED');
      return true;
    }
    recordInteraction(kind, found);
    await setRedemptionStatus(redemption, 'FULFILLED');
    return true;
  }

  /** 建立或更新 Twitch 獎勵；關閉時保留 ID，下次打開沿用同一個。 */
  async function syncInteractionReward(prank) {
    if (!twitch) throw new Error('Twitch 尚未啟用');
    await twitch.requireRedemptionAuthorization();
    const query = `broadcaster_id=${encodeURIComponent(twitch.auth.userId)}`;
    let rewardId = prank.rewardId;
    let response = null;
    if (rewardId) {
      response = await twitch.helix(`/channel_points/custom_rewards?${query}&id=${encodeURIComponent(rewardId)}`, {
        method: 'PATCH', body: interactionRewardBody(prank),
      });
      if (response.status === 404) rewardId = '';
    }
    if (!rewardId) {
      if (!prank.enabled) return { ...prank, rewardId: '' };
      response = await twitch.helix(`/channel_points/custom_rewards?${query}`, { method: 'POST', body: interactionRewardBody(prank) });
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) throw new Error('Twitch 忠誠點數權限不足，請重新連接 Twitch');
      if (response.status === 403) throw new Error('此頻道尚未開放忠誠點數，或這個獎勵不是由 Elitesand Pro 建立');
      throw new Error(data.message || `Twitch 獎勵同步失敗（${response.status}）`);
    }
    const reward = Array.isArray(data.data) ? data.data[0] : null;
    if (!reward?.id) throw new Error('Twitch 沒有回傳可管理的獎勵識別碼');
    return { ...prank, rewardId: reward.id };
  }

  async function applySettings(input) {
    const commands = [cleanCommand(input?.treatCommand, settings.treatCommand),
      cleanCommand(input?.trickCommand, settings.trickCommand),
      cleanCommand(input?.prank?.command, settings.prank.command)].map((command) => command.toLocaleLowerCase());
    if (new Set(commands).size !== commands.length) {
      return { ok: false, error: '三種互動請使用不同的聊天指令', state: snapshot() };
    }
    const next = cleanSettings(input, settings);
    // rewardId 只能由同步結果寫入，面板送來的值一律忽略。
    next.prank.rewardId = settings.prank.rewardId;
    for (const kind of ['treat', 'trick']) next.rewards[kind].rewardId = settings.rewards[kind].rewardId;
    let synced = false;
    for (const kind of ['prank', 'treat', 'trick']) {
      const current = kind === 'prank' ? settings.prank : settings.rewards[kind];
      const wanted = kind === 'prank' ? next.prank : next.rewards[kind];
      const changed = JSON.stringify(interactionRewardBody(wanted)) !== JSON.stringify(interactionRewardBody(current));
      if (!changed || (!wanted.enabled && !current.rewardId)) continue;
      try {
        const updated = await syncInteractionReward(wanted);
        if (kind === 'prank') settings.prank = next.prank = updated;
        else settings.rewards[kind] = next.rewards[kind] = updated;
        // 每個遠端獎勵成功後立即記下 ID；後續獎勵失敗，重試也不會重建已成功的獎勵。
        synced = true;
        saveNow();
      } catch (err) {
        return { ok: false, error: `${synced ? '部分獎勵已同步，請重試其餘設定。' : ''}${err.message}`, state: snapshot() };
      }
    }
    settings = next;
    scheduleSave();
    return { ok: true, state: snapshot() };
  }

  function setSettings(input) {
    const result = settingsQueue.then(() => applySettings(input));
    settingsQueue = result.catch(() => {});
    return result;
  }

  function resetBoard() {
    viewers.clear();
    cooldowns.clear();
    scheduleSave();
    emit('halloween:board', board());
    return { ok: true, state: snapshot() };
  }

  function rafflePool(pool, weighted) {
    const entries = new Map();
    const add = (key, name, weight) => {
      const prev = entries.get(key);
      if (prev) prev.weight += weight;
      else entries.set(key, { key, name, weight });
    };
    if (pool === 'chat' || pool === 'all') {
      for (const v of viewers.values()) {
        const count = v.treats + v.tricks + v.pranks;
        if (count > 0) add(`name:${v.name.toLocaleLowerCase()}`, v.name, weighted ? count : 1);
      }
    }
    if (pool === 'donors' || pool === 'all') {
      for (const d of getDonations() || []) {
        const name = cleanText(d?.name, MAX_NAME_LENGTH);
        if (!name) continue;
        const key = `name:${name.toLocaleLowerCase()}`;
        // 同一人多筆斗內：加權時每筆算一次，不加權時合併成一張籤。
        if (!weighted && entries.has(key)) continue;
        add(key, name, 1);
      }
    }
    if (!weighted) for (const e of entries.values()) e.weight = 1;
    return [...entries.values()];
  }

  function drawRaffle(options = {}) {
    const pool = RAFFLE_POOLS.includes(options.pool) ? options.pool : 'all';
    const weighted = options.weighted === true;
    const excludeWinners = options.excludeWinners !== false;
    const taken = new Set(winners.map((w) => w.key));
    const entries = rafflePool(pool, weighted).filter((e) => !excludeWinners || !taken.has(e.key));
    if (!entries.length) return { ok: false, error: '名單裡沒有可以抽的人', state: snapshot() };
    const total = entries.reduce((sum, e) => sum + e.weight, 0);
    let ticket = randomInt(total);
    let picked = entries[entries.length - 1];
    for (const e of entries) {
      if (ticket < e.weight) { picked = e; break; }
      ticket -= e.weight;
    }
    const winner = { key: picked.key, name: picked.name, pool, poolSize: entries.length, at: now() };
    winners.push(winner);
    if (winners.length > MAX_WINNERS) winners = winners.slice(-MAX_WINNERS);
    scheduleSave();
    if (options.announce !== false) {
      // 給疊加層跑「名字輪轉」動畫用的候選名單（最多 30 個，一定包含得主）。
      const names = entries.map((e) => e.name).filter((n) => n !== picked.name).slice(0, 29);
      const spinSeconds = clampInt(options.spinSeconds, RAFFLE_SPIN_SECONDS.min, RAFFLE_SPIN_SECONDS.max, RAFFLE_SPIN_SECONDS.fallback);
      const holdSeconds = clampInt(options.holdSeconds, RAFFLE_HOLD_SECONDS.min, RAFFLE_HOLD_SECONDS.max, RAFFLE_HOLD_SECONDS.fallback);
      emit('halloween:raffle', {
        winner: picked.name, poolSize: entries.length, names: [...names, picked.name], at: winner.at,
        spinMs: spinSeconds * 1000, holdMs: holdSeconds * 1000,
      });
    }
    return { ok: true, winner, state: snapshot() };
  }

  function clearWinners() {
    winners = [];
    scheduleSave();
    return { ok: true, state: snapshot() };
  }

  function attachTwitch(service) {
    twitch = service;
    if (!service) return;
    service.setChatInterceptor?.((event) => handleChat(event));
    service.setRedemptionInterceptor?.((event, fallbackId) => handleRedemption(event, fallbackId));
  }

  process.on('exit', () => { if (saveTimer) { clearTimeout(saveTimer); try { saveNow(); } catch (e) { /* 靜默 */ } } });

  return {
    snapshot, board, setSettings, resetBoard, drawRaffle, clearWinners, attachTwitch,
    handleChat, handleRedemption, saveNow,
    DEFAULT_SETTINGS, RAFFLE_POOLS,
  };
}

module.exports = { createHalloweenInteractions, cleanSettings, DEFAULT_SETTINGS, RAFFLE_POOLS };
