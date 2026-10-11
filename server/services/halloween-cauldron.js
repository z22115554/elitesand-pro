/**
 * 萬聖節「魔女的大鍋」：data/halloween-cauldron.json（設計：docs/HALLOWEEN-CAULDRON.md）
 *
 * 觀眾往鍋裡丟材料（五種，對應五種名牌），材料比例決定主播最後熬出哪一瓶藥水。兩種模式：
 *  - donation（純斗內）：斗內記帳時選材料，NT$1＝1 份。
 *  - points（頻道點數＋斗內）：程式在 Twitch 建五個兌換項目，兌換一次＝1 份，全自動；
 *    斗內選填，每 donationPerShare 元＝1 份（比重較高）。完全沒人記斗內也能玩。
 *
 * 斗內紀錄仍在 halloween-event（名牌、謝幕照舊）；這裡只存設定、點數票、熬煮結果與兌換項目 id。
 * 比例只在這裡算一次，經 halloween-event 的快照裝飾掛勾（setDecorator）塞進 halloween:update，
 * 疊加層與面板只負責顯示。points 模式把快照的 total／goal 換成份數，進度、達標慶祝都直接沿用。
 *
 * 兌換攔截點只有一個（TwitchService.setRedemptionInterceptor），由 server/index.js 串接：
 * 先問大鍋、不是大鍋的兌換才交給 halloween-interactions（搗蛋幽靈），再交回點歌流程。
 */
const path = require('path');
const { createLogger } = require('../utils/logger');
const { createJsonStore } = require('./json-store');
const { dataDir: DATA_DIR } = require('../utils/app-paths');

const log = createLogger('HalloweenCauldron');

const INGREDIENTS = Object.freeze(['candy', 'ghost', 'bat', 'pumpkin', 'witch']);
const MODES = Object.freeze(['donation', 'points']);
const MAX_VOTERS = 5000;
const MAX_NAME_LENGTH = 25;
const MAX_POTION_NAME = 20;
const MAX_REWARD_TEXT = 120;
const MAX_REWARD_TITLE = 45;
// 前兩名差距在投票總份數的 1% 以內算平手，熬出雙色藥水。
const TIE_RATIO = 0.01;
const BROADCAST_THROTTLE_MS = 1000;

// Twitch 兌換項目的底色（對應材料的液體顏色）。
const REWARD_COLORS = Object.freeze({ candy: '#F5A3C0', ghost: '#C3AEEB', bat: '#6B3FA0', pumpkin: '#F28A1E', witch: '#20152B' });

const DEFAULT_POTIONS = Object.freeze({
  candy: Object.freeze({ enabled: true, name: '甜蜜藥水', reward: '', title: '丟入糖漿' }),
  ghost: Object.freeze({ enabled: true, name: '幽魂藥水', reward: '', title: '丟入幽靈之魂' }),
  bat: Object.freeze({ enabled: true, name: '夜宴藥水', reward: '', title: '丟入蝙蝠翅膀' }),
  pumpkin: Object.freeze({ enabled: true, name: '豐收藥水', reward: '', title: '丟入南瓜泥' }),
  witch: Object.freeze({ enabled: true, name: '魔女藥水', reward: '', title: '丟入黑貓的毛' }),
});

const DEFAULT_SETTINGS = Object.freeze({
  mode: 'points',
  potions: DEFAULT_POTIONS,
  bonusReward: '',
  donationPerShare: 10,
  goalShares: 500,
  rewardCost: 300,
  maxPerStream: 5,
  cooldownSeconds: 0,
});

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}

function cleanPotions(input, fallback) {
  const potions = {};
  for (const key of INGREDIENTS) {
    const raw = input?.[key] || {};
    const base = fallback?.[key] || DEFAULT_POTIONS[key];
    potions[key] = {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
      name: cleanText(raw.name, MAX_POTION_NAME) || base.name,
      // 內容可以清空（還沒想好企劃），所以只有欄位不存在時才沿用舊值。
      reward: raw.reward === undefined ? base.reward : cleanText(raw.reward, MAX_REWARD_TEXT),
      title: cleanText(raw.title, MAX_REWARD_TITLE) || base.title,
    };
  }
  return potions;
}

function cleanSettings(input, fallback = DEFAULT_SETTINGS) {
  return {
    mode: MODES.includes(input?.mode) ? input.mode : fallback.mode,
    potions: cleanPotions(input?.potions, fallback.potions),
    bonusReward: input?.bonusReward === undefined ? fallback.bonusReward : cleanText(input.bonusReward, MAX_REWARD_TEXT),
    donationPerShare: clampInt(input?.donationPerShare, 1, 100, fallback.donationPerShare),
    goalShares: clampInt(input?.goalShares, 1, 1_000_000, fallback.goalShares),
    rewardCost: clampInt(input?.rewardCost, 1, 1_000_000, fallback.rewardCost),
    maxPerStream: clampInt(input?.maxPerStream, 0, 1000, fallback.maxPerStream),
    cooldownSeconds: clampInt(input?.cooldownSeconds, 0, 3600, fallback.cooldownSeconds),
  };
}

function cleanVotes(raw) {
  const votes = {};
  for (const key of INGREDIENTS) votes[key] = clampInt(raw?.[key], 0, 1e9, 0);
  return votes;
}

function cleanVoter(raw) {
  const name = cleanText(raw?.name, MAX_NAME_LENGTH);
  if (!name) return null;
  return { name, votes: cleanVotes(raw?.votes) };
}

function cleanRewardIds(raw) {
  const ids = {};
  for (const key of INGREDIENTS) {
    const id = raw?.[key];
    if (typeof id === 'string' && /^[a-z0-9-]{8,80}$/i.test(id)) ids[key] = id;
  }
  return ids;
}

function cleanBrew(raw) {
  if (!raw || typeof raw !== 'object' || !INGREDIENTS.includes(raw.winner)) return null;
  const tie = Array.isArray(raw.tie) ? raw.tie.filter((k) => INGREDIENTS.includes(k)).slice(0, 2) : null;
  const shares = {};
  for (const key of INGREDIENTS) shares[key] = Math.min(Math.max(Number(raw.shares?.[key]) || 0, 0), 1);
  return {
    at: Number.isFinite(raw.at) ? raw.at : Date.now(),
    mode: MODES.includes(raw.mode) ? raw.mode : 'points',
    winner: raw.winner,
    tie: tie && tie.length === 2 ? tie : null,
    shares,
    totalShares: Math.max(Number(raw.totalShares) || 0, 0),
    reachedGoal: raw.reachedGoal === true,
    // 主播按「收起藥水」後 OBS 不再顯示藥水卡；結果本身保留。
    hidden: raw.hidden === true,
  };
}

/**
 * @param {object} deps
 * @param {object} deps.event   halloween-event 服務（snapshot／setDecorator／isActive）
 * @param {(event: string, payload: any) => void} deps.emit 廣播給所有 socket
 * @param {string} [deps.file]
 */
function createHalloweenCauldron({ event, emit, file = path.join(DATA_DIR, 'halloween-cauldron.json'), now = () => Date.now() }) {
  let settings = cleanSettings(null);
  let votes = cleanVotes(null);
  const voters = new Map();
  let rewardIds = {};
  let brew = null;
  let saveTimer = null;
  let broadcastTimer = null;
  let twitch = null;
  let rewardStatus = { ok: null, error: '' };
  const seenRedemptions = new Map();

  const diskStore = createJsonStore({
    file,
    label: '萬聖節大鍋',
    defaultValue: () => ({ settings: cleanSettings(null), votes: cleanVotes(null), voters: {}, rewardIds: {}, brew: null }),
    validate: (doc) => doc && typeof doc === 'object' && doc.settings && typeof doc.settings === 'object',
    logger: log,
  });

  (function load() {
    const loaded = diskStore.load();
    settings = cleanSettings(loaded?.settings);
    votes = cleanVotes(loaded?.votes);
    for (const [key, raw] of Object.entries(loaded?.voters || {}).slice(0, MAX_VOTERS)) {
      const voter = cleanVoter(raw);
      if (voter) voters.set(String(key).slice(0, 120), voter);
    }
    rewardIds = cleanRewardIds(loaded?.rewardIds);
    brew = cleanBrew(loaded?.brew);
  })();

  function saveNow() {
    saveTimer = null;
    try {
      return diskStore.save({ settings, votes, voters: Object.fromEntries(voters), rewardIds, brew });
    } catch (err) {
      log.warn(`萬聖節大鍋寫入失敗: ${err.message}`);
      return false;
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 800);
  }

  // ─── 份數與比例 ───

  /** 斗內換成份數：純斗內 NT$1＝1 份；點數模式每 donationPerShare 元＝1 份。 */
  function donationShares(amount) {
    return settings.mode === 'points' ? amount / settings.donationPerShare : amount;
  }

  function tally(donations) {
    const byIngredient = {};
    for (const key of INGREDIENTS) byIngredient[key] = settings.mode === 'points' ? votes[key] : 0;
    let plain = 0;
    for (const d of donations || []) {
      const shares = donationShares(Number(d.amount) || 0);
      if (INGREDIENTS.includes(d.ingredient)) byIngredient[d.ingredient] += shares;
      else plain += shares;
    }
    // 關掉的材料：票保留、顯示成灰色，但不能當第一名，也不算進比例的分母。
    const counted = INGREDIENTS.filter((key) => settings.potions[key].enabled);
    const votingTotal = counted.reduce((sum, key) => sum + byIngredient[key], 0);
    const shares = {};
    for (const key of INGREDIENTS) shares[key] = votingTotal > 0 && settings.potions[key].enabled ? byIngredient[key] / votingTotal : 0;
    const ranked = counted.filter((key) => byIngredient[key] > 0).sort((a, b) => byIngredient[b] - byIngredient[a]);
    const allVotes = INGREDIENTS.reduce((sum, key) => sum + byIngredient[key], 0);
    return { byIngredient, plain, votingTotal, totalShares: allVotes + plain, shares, ranked };
  }

  function publicPotions() {
    return Object.fromEntries(INGREDIENTS.map((key) => [key, { ...settings.potions[key] }]));
  }

  /** halloween-event 快照的裝飾：加上大鍋欄位；點數模式把 total／goal 換成份數。 */
  function decorate(base) {
    const t = tally(base.donations);
    const cauldron = {
      mode: settings.mode,
      potions: publicPotions(),
      bonusReward: settings.bonusReward,
      donationPerShare: settings.donationPerShare,
      goalShares: settings.goalShares,
      shares: t.shares,
      amounts: Object.fromEntries(INGREDIENTS.map((key) => [key, Math.round(t.byIngredient[key] * 10) / 10])),
      top3: t.ranked.slice(0, 3),
      totalShares: Math.round(t.totalShares),
      plainShares: Math.round(t.plain),
      pointVotes: INGREDIENTS.reduce((sum, key) => sum + votes[key], 0),
      voters: settings.mode === 'points' ? voters.size : 0,
      champions: champions(base.donations),
      brew,
    };
    if (settings.mode !== 'points') return { ...base, unit: 'money', cauldron };
    return { ...base, unit: 'shares', donationTotal: base.total, total: cauldron.totalShares, goal: settings.goalShares, cauldron };
  }

  event.setDecorator(decorate);

  // 點數兌換可能一秒好幾筆；整份快照（含斗內清單）最多每秒推一次，動畫靠 halloween:drop。
  function scheduleBroadcast() {
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      emit('halloween:update', event.snapshot());
    }, BROADCAST_THROTTLE_MS);
  }

  function broadcastNow() {
    if (broadcastTimer) { clearTimeout(broadcastTimer); broadcastTimer = null; }
    emit('halloween:update', event.snapshot());
  }

  function snapshot() {
    return {
      active: event.isActive(),
      settings: { ...settings, potions: publicPotions() },
      rewards: INGREDIENTS.map((key) => ({ ingredient: key, created: !!rewardIds[key] })),
      rewardStatus: { ...rewardStatus },
      twitchReady: !!twitch,
      brew,
    };
  }

  // ─── Twitch 兌換項目 ───

  /** 這個材料的兌換項目此刻應該開放兌換嗎？ */
  function rewardOpen(key) {
    return event.isActive() && settings.mode === 'points' && settings.potions[key].enabled && !brew;
  }

  function rewardBody(key) {
    const potion = settings.potions[key];
    const body = {
      title: potion.title,
      prompt: `投給「${potion.name}」${potion.reward ? `：${potion.reward}` : ''}`.slice(0, 200),
      cost: settings.rewardCost,
      is_user_input_required: false,
      // 不跳過佇列：記到鍋裡才完成兌換；熬煮後、活動結束或關掉時可以退點數。
      should_redemptions_skip_request_queue: false,
      is_max_per_user_per_stream_enabled: settings.maxPerStream > 0,
      is_global_cooldown_enabled: settings.cooldownSeconds > 0,
      background_color: REWARD_COLORS[key],
      // 暫停＝觀眾看得到但不能兌換；材料被關掉才整個隱藏。
      is_enabled: potion.enabled,
      is_paused: !rewardOpen(key),
    };
    if (settings.maxPerStream > 0) body.max_per_user_per_stream = settings.maxPerStream;
    if (settings.cooldownSeconds > 0) body.global_cooldown_seconds = settings.cooldownSeconds;
    return body;
  }

  function twitchError(response, data) {
    if (response.status === 401) return new Error('Twitch 忠誠點數權限不足，請重新連接 Twitch');
    if (response.status === 403) return new Error('此頻道尚未開放忠誠點數（需要是 Twitch 聯盟或合作夥伴），或這個獎勵不是由 Elitesand Pro 建立');
    return new Error(data?.message || `Twitch 獎勵同步失敗（${response.status}）`);
  }

  /**
   * 讓 Twitch 上的五個兌換項目符合目前狀態：該開的建立／恢復、該停的暫停。
   * 純斗內模式且從沒建過就什麼都不做（不碰沒用點數的主播的頻道）。
   */
  async function syncRewards() {
    const wanted = settings.mode === 'points';
    const hasAny = INGREDIENTS.some((key) => rewardIds[key]);
    if (!wanted && !hasAny) { rewardStatus = { ok: null, error: '' }; return { ok: true }; }
    try {
      if (!twitch) throw new Error('需要先在「Twitch 點歌」分頁連接 Twitch');
      await twitch.requireRedemptionAuthorization();
      const query = `broadcaster_id=${encodeURIComponent(twitch.auth.userId)}`;
      for (const key of INGREDIENTS) {
        let id = rewardIds[key];
        let response = null;
        if (id) {
          response = await twitch.helix(`/channel_points/custom_rewards?${query}&id=${encodeURIComponent(id)}`, { method: 'PATCH', body: rewardBody(key) });
          // 主播在 Twitch 後台手動刪掉了：重新建立。
          if (response.status === 404) { id = ''; delete rewardIds[key]; }
        }
        if (!id) {
          if (!wanted || !settings.potions[key].enabled) continue;
          response = await twitch.helix(`/channel_points/custom_rewards?${query}`, { method: 'POST', body: rewardBody(key) });
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw twitchError(response, data);
        const reward = Array.isArray(data.data) ? data.data[0] : null;
        if (!reward?.id) throw new Error('Twitch 沒有回傳可管理的獎勵識別碼');
        rewardIds[key] = reward.id;
      }
      rewardStatus = { ok: true, error: '' };
      scheduleSave();
      return { ok: true };
    } catch (err) {
      rewardStatus = { ok: false, error: err.message || 'Twitch 獎勵同步失敗' };
      scheduleSave();
      log.warn(`大鍋兌換項目同步失敗：${rewardStatus.error}`);
      return { ok: false, error: rewardStatus.error };
    }
  }

  /** 主播按「移除兌換項目」才刪；平常只暫停，觀眾不會看到項目突然消失。 */
  async function removeRewards() {
    try {
      if (!twitch) throw new Error('需要先在「Twitch 點歌」分頁連接 Twitch');
      await twitch.requireRedemptionAuthorization();
      const query = `broadcaster_id=${encodeURIComponent(twitch.auth.userId)}`;
      for (const key of INGREDIENTS) {
        const id = rewardIds[key];
        if (!id) continue;
        const response = await twitch.helix(`/channel_points/custom_rewards?${query}&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!response.ok && response.status !== 404) {
          const data = await response.json().catch(() => ({}));
          throw twitchError(response, data);
        }
        delete rewardIds[key];
      }
      rewardStatus = { ok: null, error: '' };
      scheduleSave();
      return { ok: true, state: snapshot() };
    } catch (err) {
      return { ok: false, error: err.message || '移除失敗', state: snapshot() };
    }
  }

  async function setRedemptionStatus(redemption, status) {
    try {
      await twitch?.updateRewardRedemptionStatus(redemption, status);
    } catch (err) {
      log.warn(`大鍋兌換狀態更新失敗（${status}）：${err.message}`);
    }
  }

  function viewerFor(redemptionEvent) {
    const key = String(redemptionEvent?.user_id || redemptionEvent?.user_login || '').trim().toLocaleLowerCase();
    const name = cleanText(redemptionEvent?.user_name || redemptionEvent?.user_login || '', MAX_NAME_LENGTH);
    if (!key || !name) return null;
    let voter = voters.get(key);
    if (!voter) {
      if (voters.size >= MAX_VOTERS) return { name, voter: null };
      voter = { name, votes: cleanVotes(null) };
      voters.set(key, voter);
    }
    voter.name = name;
    return { name, voter };
  }

  /** 兌換攔截點：是大鍋的兌換項目就回 true（不再往下交給搗蛋或點歌）。 */
  async function handleRedemption(redemptionEvent, fallbackId) {
    const rewardId = String(redemptionEvent?.reward?.id || '');
    const key = rewardId ? INGREDIENTS.find((k) => rewardIds[k] === rewardId) : null;
    if (!key) return false;
    if (redemptionEvent.status && !/^unfulfilled$/i.test(redemptionEvent.status)) return true;
    const id = String(redemptionEvent.id || fallbackId || '');
    if (!id || seenRedemptions.has(id)) return true;
    seenRedemptions.set(id, now());
    if (seenRedemptions.size > 1000) seenRedemptions.delete(seenRedemptions.keys().next().value);
    const redemption = { id, rewardId };
    // 熬煮後、活動結束、切到純斗內、材料被關掉：退點數。
    if (!rewardOpen(key)) {
      await setRedemptionStatus(redemption, 'CANCELED');
      return true;
    }
    votes[key] += 1;
    const found = viewerFor(redemptionEvent);
    if (found?.voter) found.voter.votes[key] += 1;
    scheduleSave();
    emit('halloween:drop', { ingredient: key, name: found?.name || '?', weight: 1, source: 'points', at: now() });
    scheduleBroadcast();
    await setRedemptionStatus(redemption, 'FULFILLED');
    return true;
  }

  // ─── 面板操作 ───

  async function setSettings(input) {
    const next = cleanSettings(input, settings);
    const rewardChanged = JSON.stringify(INGREDIENTS.map((key) => [settings.potions[key], settings.mode]))
      !== JSON.stringify(INGREDIENTS.map((key) => [next.potions[key], next.mode]))
      || next.rewardCost !== settings.rewardCost || next.maxPerStream !== settings.maxPerStream
      || next.cooldownSeconds !== settings.cooldownSeconds;
    settings = next;
    scheduleSave();
    let sync = { ok: true };
    if (rewardChanged) sync = await syncRewards();
    broadcastNow();
    // 設定本身一定存得進去；兌換項目同步失敗只是附帶的錯誤訊息（例如頻道不是聯盟）。
    return { ok: true, syncError: sync.ok ? '' : sync.error, state: snapshot() };
  }

  function brewNow() {
    if (brew) return { ok: false, error: '已經熬過了；要重來請先按「重新開鍋」', state: snapshot() };
    const snap = event.snapshot();
    const t = tally(snap.donations);
    if (!t.ranked.length) return { ok: false, error: '鍋裡只有清水，還不能熬', state: snapshot() };
    const [first, second] = t.ranked;
    const tie = second && (t.byIngredient[first] - t.byIngredient[second]) <= t.votingTotal * TIE_RATIO ? [first, second] : null;
    brew = {
      at: now(),
      mode: settings.mode,
      winner: first,
      tie,
      shares: t.shares,
      totalShares: Math.round(t.totalShares),
      reachedGoal: (Number(snap.total) || 0) >= (Number(snap.goal) || Infinity),
    };
    scheduleSave();
    broadcastNow();
    syncRewards();
    return { ok: true, state: snapshot() };
  }

  function setPotionHidden(hidden) {
    if (!brew) return { ok: false, error: '還沒有熬出藥水', state: snapshot() };
    brew = { ...brew, hidden: hidden === true };
    scheduleSave();
    broadcastNow();
    return { ok: true, state: snapshot() };
  }

  function resetBrew() {
    brew = null;
    scheduleSave();
    broadcastNow();
    syncRewards();
    return { ok: true, state: snapshot() };
  }

  /** 清除點數票（斗內不動）。預演完、正式開始前用。 */
  function clearVotes() {
    votes = cleanVotes(null);
    voters.clear();
    scheduleSave();
    broadcastNow();
    return { ok: true, state: snapshot() };
  }

  /** 謝幕「各派大將」：每種材料貢獻最多份數的人（點數＋斗內合併，依名字）。 */
  function champions(donations) {
    const byName = new Map();
    const add = (name, key, amount) => {
      const k = name.toLocaleLowerCase();
      const row = byName.get(k) || { name, amounts: {} };
      row.amounts[key] = (row.amounts[key] || 0) + amount;
      byName.set(k, row);
    };
    if (settings.mode === 'points') {
      for (const v of voters.values()) for (const key of INGREDIENTS) if (v.votes[key] > 0) add(v.name, key, v.votes[key]);
    }
    for (const d of donations || []) if (INGREDIENTS.includes(d.ingredient)) add(d.name, d.ingredient, donationShares(d.amount));
    const result = {};
    for (const key of INGREDIENTS) {
      let best = null;
      for (const row of byName.values()) if ((row.amounts[key] || 0) > (best?.amounts[key] || 0)) best = row;
      if (best) result[key] = best.name;
    }
    return result;
  }

  function attachTwitch(service) {
    twitch = service || null;
  }

  process.on('exit', () => { if (saveTimer) { clearTimeout(saveTimer); try { saveNow(); } catch (e) { /* 靜默 */ } } });

  return {
    snapshot, setSettings, brew: brewNow, resetBrew, setPotionHidden, clearVotes, syncRewards, removeRewards,
    handleRedemption, attachTwitch, champions, decorate, saveNow,
    INGREDIENTS, DEFAULT_SETTINGS,
  };
}

module.exports = { createHalloweenCauldron, cleanSettings, INGREDIENTS, DEFAULT_SETTINGS };
