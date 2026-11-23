'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../utils/logger');
const { dataDir } = require('../utils/app-paths');
const log = createLogger('RetiredEvents');
const ID = /^[a-z0-9-]{8,80}$/i;
const RETRY_MS = 20000;

function readArchive(file) {
  for (const candidate of [file, `${file}.last-good`]) {
    try {
      if (fs.statSync(candidate).size > 16 * 1024 * 1024) continue;
      const doc = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (Number(doc?.schemaVersion || 0) > 1) return null;
      return doc;
    } catch (error) {
      if (error.code !== 'ENOENT') log.warn(`活動紀錄暫時無法讀取：${path.basename(candidate)}`);
    }
  }
  return null;
}

function retiredRewardIds(directory = dataDir) {
  const cauldron = readArchive(path.join(directory, 'halloween-cauldron.json'));
  const fx = readArchive(path.join(directory, 'halloween-interactions.json'));
  return [...new Set([
    ...['candy', 'ghost', 'bat', 'pumpkin', 'witch'].map(key => cauldron?.rewardIds?.[key]),
    fx?.settings?.rewards?.treat?.rewardId, fx?.settings?.rewards?.trick?.rewardId,
    fx?.settings?.prank?.rewardId,
  ].filter(value => typeof value === 'string' && ID.test(value)))];
}

function createRetiredEventCleanup({ twitch, directory = dataDir, timers = globalThis }) {
  const ids = new Set(retiredRewardIds(directory));
  let inFlight = null, timer = null, complete = false, stopped = false;

  function retry() {
    if (stopped || timer || !ids.size) return;
    timer = timers.setTimeout(() => { timer = null; run(); }, RETRY_MS);
    timer?.unref?.();
  }

  async function reconcile() {
    await twitch.requireRedemptionAuthorization();
    const broadcaster = encodeURIComponent(twitch.auth.userId);
    for (const rewardId of ids) {
      if (stopped) return;
      const query = `broadcaster_id=${broadcaster}&id=${encodeURIComponent(rewardId)}`;
      const paused = await twitch.helix(`/channel_points/custom_rewards?${query}`, {
        method: 'PATCH', body: { is_paused: true },
      });
      if (paused.status === 404) continue; // It was already removed upstream.
      if (!paused.ok) throw new Error(`暫停已到期獎勵失敗（${paused.status}）`);
      let cursor = '';
      const seen = new Set();
      const pending = new Set();
      do {
        if (stopped) return;
        const response = await twitch.helix(`/channel_points/custom_rewards/redemptions?broadcaster_id=${broadcaster}&reward_id=${encodeURIComponent(rewardId)}&status=UNFULFILLED&first=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`);
        if (!response.ok) throw new Error(`讀取已到期兌換失敗（${response.status}）`);
        const page = await response.json();
        if (!Array.isArray(page?.data)) throw new Error('已到期兌換回應格式錯誤');
        for (const redemption of page.data) {
          if (stopped) return;
          if (typeof redemption.id !== 'string' || !ID.test(redemption.id)) throw new Error('無效的兌換識別碼');
          pending.add(redemption.id);
        }
        cursor = String(page.pagination?.cursor || '');
        if (cursor && (seen.has(cursor) || seen.size >= 100)) throw new Error('已到期兌換分頁異常');
        if (cursor) seen.add(cursor);
      } while (cursor);
      // Enumerate before changing status so cancellation cannot move the next
      // page underneath a cursor in the filtered UNFULFILLED result set.
      for (const id of pending) {
        if (stopped) return;
        const result = await twitch.updateRewardRedemptionStatus({ id, rewardId }, 'CANCELED');
        if (!result?.confirmed) throw new Error('已到期兌換結算狀態尚未確認');
      }
    }
    complete = !stopped;
  }

  function run() {
    if (stopped || complete || !ids.size) return Promise.resolve();
    if (inFlight) return inFlight;
    if (timer) timers.clearTimeout(timer);
    timer = null;
    inFlight = reconcile().catch(error => {
      log.warn(`已到期活動清理稍後重試：${error.message}`);
      retry();
    }).finally(() => { inFlight = null; });
    return inFlight;
  }

  async function handleRedemption(event, fallbackId) {
    const rewardId = String(event?.reward?.id || '');
    if (!ids.has(rewardId)) return false;
    if (event.status && !/^unfulfilled$/i.test(event.status)) return true;
    const id = String(event.id || fallbackId || '');
    if (!ID.test(id)) return true;
    try {
      const result = await twitch.updateRewardRedemptionStatus({ id, rewardId }, 'CANCELED');
      if (!result?.confirmed) throw new Error('已到期兌換結算狀態尚未確認');
    }
    catch (error) { complete = false; log.warn(`已到期兌換退款稍後重試：${error.message}`); retry(); }
    return true;
  }

  return {
    run, handleRedemption, start: retry,
    stop() { stopped = true; if (timer) timers.clearTimeout(timer); timer = null; },
    hasRewards: () => ids.size > 0,
  };
}

module.exports = { retiredRewardIds, createRetiredEventCleanup };
