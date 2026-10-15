'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-halloween-fx-'));
process.env.ELITESAND_DATA_DIR = dataDir;
const { createHalloweenInteractions, cleanSettings, DEFAULT_SETTINGS } = require('../server/services/halloween-interactions');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

function harness({ active = true, donations = [], random = () => 0 } = {}) {
  let clock = 1_000_000;
  const emitted = [];
  const file = path.join(dataDir, `fx-${Math.random().toString(36).slice(2)}.json`);
  const fx = createHalloweenInteractions({
    isActive: () => active,
    emit: (event, payload) => emitted.push({ event, payload }),
    getDonations: () => donations,
    file,
    now: () => clock,
    randomInt: (max) => random(max),
  });
  return { fx, file, emitted, tick: (ms) => { clock += ms; }, setActive: (v) => { active = v; } };
}

const chat = (id, name, text) => ({ chatter_user_id: id, chatter_user_name: name, message: { text } });

test('!treat and !trick pop on the overlay, count per viewer, and respect the per-viewer cooldown', () => {
  const { fx, emitted, tick } = harness();
  assert.equal(fx.handleChat(chat('1', '小熊', '!treat')), true);
  assert.equal(fx.handleChat(chat('1', '小熊', '!TREAT please')), true, '冷卻中也算已處理，不交給點歌');
  assert.equal(fx.handleChat(chat('2', '飄飄', '!trick')), true);
  assert.equal(fx.handleChat(chat('3', '路人', '!點歌 https://youtu.be/x')), false, '其他訊息要交回點歌流程');
  assert.equal(fx.handleChat(chat('3', '路人', 'hello !treat')), false, '指令必須在訊息開頭');
  tick(DEFAULT_SETTINGS.userCooldownSeconds * 1000);
  fx.handleChat(chat('1', '小熊', '!treat'));
  const pops = emitted.filter((e) => e.event === 'halloween:pop').map((e) => `${e.payload.kind}:${e.payload.name}:${e.payload.count}`);
  assert.deepEqual(pops, ['treat:小熊:1', 'trick:飄飄:1', 'treat:小熊:2']);
  const board = fx.board();
  assert.deepEqual(board.top, [{ name: '小熊', treats: 2, tricks: 0 }]);
  assert.equal(board.participants, 2);
  assert.equal(board.totalTreats, 2);
  assert.equal(board.totalTricks, 1);
});

test('chat commands do nothing once the event has ended or chat is turned off', async () => {
  const ended = harness({ active: false });
  assert.equal(ended.fx.handleChat(chat('1', 'a', '!treat')), false);
  const off = harness();
  assert.equal((await off.fx.setSettings({ chatEnabled: false })).ok, true);
  assert.equal(off.fx.handleChat(chat('1', 'a', '!treat')), false);
  assert.equal(off.emitted.filter((e) => e.event === 'halloween:pop').length, 0);
});

test('settings are cleaned: custom commands, no duplicates, no whitespace, rewardId cannot come from the panel', async () => {
  const s = cleanSettings({ treatCommand: '!糖果', trickCommand: '!搗蛋', userCooldownSeconds: 99999 });
  assert.equal(s.treatCommand, '!糖果');
  assert.equal(s.trickCommand, '!搗蛋');
  assert.equal(s.userCooldownSeconds, 3600);
  const same = cleanSettings({ treatCommand: '!x', trickCommand: '!X' });
  assert.equal(same.treatCommand, DEFAULT_SETTINGS.treatCommand);
  assert.equal(cleanSettings({ treatCommand: '! treat' }).treatCommand, DEFAULT_SETTINGS.treatCommand);
  const { fx } = harness();
  const result = await fx.setSettings({ treatCommand: '!糖果', prank: { rewardId: 'attacker-chosen-id' } });
  assert.equal(result.ok, true);
  assert.equal(result.state.settings.prank.rewardId, '');
  assert.equal(fx.handleChat(chat('1', 'a', '!糖果')), true);
});

function fakeTwitch() {
  const calls = [];
  return {
    calls,
    auth: { userId: 'broadcaster' },
    async requireRedemptionAuthorization() {},
    async helix(url, options) {
      calls.push({ url, method: options.method, body: options.body });
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'prank-reward-1' }] }) };
    },
    async updateRewardRedemptionStatus(redemption, status) { calls.push({ status, id: redemption.id, rewardId: redemption.rewardId }); },
    setChatInterceptor(fn) { this.chat = fn; },
    setRedemptionInterceptor(fn) { this.redeem = fn; },
  };
}

test('the prank reward is created on Twitch, fulfilled when played, refunded when off or ended, and deduplicated', async () => {
  const h = harness();
  const twitch = fakeTwitch();
  h.fx.attachTwitch(twitch);
  assert.equal(typeof twitch.chat, 'function');
  const created = await h.fx.setSettings({ prank: { enabled: true, cost: 500, cooldownSeconds: 30 } });
  assert.equal(created.ok, true);
  assert.equal(created.state.settings.prank.rewardId, 'prank-reward-1');
  assert.equal(twitch.calls[0].method, 'POST');
  assert.equal(twitch.calls[0].body.cost, 500);
  assert.equal(twitch.calls[0].body.should_redemptions_skip_request_queue, false, '要保留在佇列裡才能退點數');

  const redeem = (id, rewardId = 'prank-reward-1') => twitch.redeem({ id, reward: { id: rewardId }, user_id: '9', user_name: '搗蛋鬼', status: 'unfulfilled' });
  assert.equal(await redeem('r1'), true);
  assert.equal(await redeem('r1'), true, '重複的兌換只處理一次');
  assert.equal(await redeem('r2', 'song-request-reward'), false, '別的獎勵交回點歌流程');
  assert.deepEqual(h.emitted.filter((e) => e.event === 'halloween:prank').map((e) => e.payload.name), ['搗蛋鬼']);
  assert.ok(twitch.calls.some((c) => c.status === 'FULFILLED' && c.id === 'r1'));

  const disabled = await h.fx.setSettings({ prank: { enabled: false } });
  assert.equal(disabled.state.settings.prank.rewardId, 'prank-reward-1', '關閉時保留同一個獎勵');
  assert.equal(twitch.calls.at(-1).method, 'PATCH');
  assert.equal(twitch.calls.at(-1).body.is_enabled, false);
  assert.equal(await redeem('r3'), true);
  assert.ok(twitch.calls.some((c) => c.status === 'CANCELED' && c.id === 'r3'), '關閉時兌換要退點數');

  await h.fx.setSettings({ prank: { enabled: true } });
  h.setActive(false);
  assert.equal(await redeem('r4'), true);
  assert.ok(twitch.calls.some((c) => c.status === 'CANCELED' && c.id === 'r4'), '活動結束後兌換要退點數');
  assert.equal(h.emitted.filter((e) => e.event === 'halloween:prank').length, 1);
});

test('a prank reward that cannot sync keeps the old settings and reports why', async () => {
  const h = harness();
  const failing = fakeTwitch();
  failing.helix = async () => ({ ok: false, status: 403, json: async () => ({}) });
  h.fx.attachTwitch(failing);
  const result = await h.fx.setSettings({ chatEnabled: false, prank: { enabled: true } });
  assert.equal(result.ok, false);
  assert.match(result.error, /忠誠點數/);
  assert.equal(result.state.settings.prank.enabled, false);
  assert.equal(result.state.settings.chatEnabled, true);
});

test('raffle draws from the chosen pool, can weight by participation, and skips past winners', () => {
  const donations = [{ name: '大戶', amount: 1000 }, { name: '大戶', amount: 500 }, { name: '小熊', amount: 50 }];
  const picks = [];
  const h = harness({ donations, random: (max) => { picks.push(max); return max - 1; } });
  h.fx.handleChat(chat('1', '小熊', '!treat'));
  h.fx.handleChat(chat('2', '飄飄', '!trick'));

  const first = h.fx.drawRaffle({ pool: 'all', weighted: false });
  assert.equal(first.ok, true);
  assert.equal(picks.at(-1), 3, '小熊同時是聊天與斗內，只算一張籤：小熊、飄飄、大戶');
  assert.equal(first.winner.poolSize, 3);
  const raffleEvent = h.emitted.find((e) => e.event === 'halloween:raffle').payload;
  assert.equal(raffleEvent.winner, first.winner.name);
  assert.ok(raffleEvent.names.includes(first.winner.name));

  const second = h.fx.drawRaffle({ pool: 'all', weighted: false });
  assert.notEqual(second.winner.name, first.winner.name, '已中獎者不再抽');
  assert.equal(second.winner.poolSize, 2);

  h.fx.clearWinners();
  h.fx.drawRaffle({ pool: 'donors', weighted: true, announce: false });
  assert.equal(picks.at(-1), 3, '加權時大戶兩筆斗內算兩張、小熊一張');
  assert.equal(h.emitted.filter((e) => e.event === 'halloween:raffle').length, 2, 'announce:false 不在 OBS 揭曉');

  const empty = harness().fx.drawRaffle({ pool: 'chat' });
  assert.equal(empty.ok, false);
});

test('TwitchService hands chat and redemptions to the interceptors first, and a failing interceptor never blocks song requests', async () => {
  const { TwitchService } = require('../server/services/twitch-service');
  const service = Object.create(TwitchService.prototype);
  let songFlowReached = 0;
  // handleChatMessage 一進入點歌流程就會讀 requestSettings；用 getter 記錄有沒有走到那裡。
  Object.defineProperty(service, 'requestSettings', { get() { songFlowReached += 1; return null; } });
  Object.defineProperty(service, 'rewardSettings', { get() { songFlowReached += 1; return { enabled: false }; } });

  service.setChatInterceptor((event) => event.message.text === '!treat');
  await service.handleChatMessage({ message: { text: '!treat' } }, 'm1');
  assert.equal(songFlowReached, 0, '攔截成功的訊息不進點歌流程');
  await service.handleChatMessage({ message: { text: 'hello' } }, 'm2');
  assert.equal(songFlowReached, 1, '沒攔截的訊息照常進點歌流程');

  service.setChatInterceptor(() => { throw new Error('boom'); });
  await service.handleChatMessage({ message: { text: '!treat' } }, 'm3');
  assert.equal(songFlowReached, 2, '攔截函式出錯時退回點歌流程');

  service.setRedemptionInterceptor(async () => true);
  await service.handleRewardRedemption({ id: 'r', reward: { id: 'x' } }, 'f');
  assert.equal(songFlowReached, 2, '攔截成功的兌換不進點歌流程');
  service.setRedemptionInterceptor(async () => { throw new Error('boom'); });
  await service.handleRewardRedemption({ id: 'r2', reward: { id: 'x' } }, 'f');
  assert.equal(songFlowReached, 3, '兌換攔截出錯時退回點歌流程');
});

test('raffle reveal timing comes from the panel and is clamped (spin 1–30 s, hold 2–60 s; defaults 3 s / 7 s)', () => {
  const { fx, emitted } = harness({ donations: [{ name: 'a', amount: 1 }, { name: 'b', amount: 1 }] });
  fx.drawRaffle({ pool: 'donors', excludeWinners: false });
  fx.drawRaffle({ pool: 'donors', excludeWinners: false, spinSeconds: 12, holdSeconds: 20 });
  fx.drawRaffle({ pool: 'donors', excludeWinners: false, spinSeconds: 999, holdSeconds: 0 });
  const timing = emitted.filter((e) => e.event === 'halloween:raffle').map((e) => [e.payload.spinMs, e.payload.holdMs]);
  assert.deepEqual(timing, [[3000, 7000], [12000, 20000], [30000, 2000]]);
});


function pointsTwitch() {
  const twitch = fakeTwitch();
  let counter = 0;
  twitch.helix = async (url, options) => {
    twitch.calls.push({ url, ...options });
    const id = options.method === 'POST' ? `points-reward-${++counter}` : new URLSearchParams(url.split('?')[1]).get('id');
    return { ok: true, status: 200, json: async () => ({ data: [{ id }] }) };
  };
  return twitch;
}
const redemption = (id, rewardId, userId = '42') => ({ id, reward: { id: rewardId }, user_id: userId, user_name: '糖果熊', status: 'unfulfilled' });

test('each effect supports independent chat and points; paid interactions bypass free-chat cooldown and enter the same raffle', async () => {
  const h = harness();
  const twitch = pointsTwitch(); h.fx.attachTwitch(twitch);
  const result = await h.fx.setSettings({
    treatChatEnabled: false,
    rewards: { treat: { enabled: true, cost: 250 }, trick: { enabled: true, cost: 150 } },
    prank: { enabled: true, chatEnabled: true, command: '!boo' },
  });
  assert.equal(result.ok, true);
  const settings = result.state.settings;
  assert.equal(new Set([settings.prank.rewardId, settings.rewards.treat.rewardId, settings.rewards.trick.rewardId]).size, 3);
  assert.equal(h.fx.handleChat(chat('42', '糖果熊', '!treat')), false);
  assert.equal(h.fx.handleChat(chat('42', '糖果熊', '!trick')), true);
  assert.equal(await twitch.redeem(redemption('t1', settings.rewards.treat.rewardId)), true);
  await twitch.redeem(redemption('t2', settings.rewards.treat.rewardId));
  await twitch.redeem(redemption('g1', settings.rewards.trick.rewardId));
  await Promise.all([twitch.redeem(redemption('p1', settings.prank.rewardId)), twitch.redeem(redemption('p1', settings.prank.rewardId))]);
  await twitch.redeem(redemption('t1', settings.rewards.treat.rewardId));
  await twitch.redeem({ ...redemption('completed', settings.rewards.treat.rewardId), status: 'fulfilled' });
  assert.equal(await twitch.redeem(redemption('other', 'song-request')), false);
  assert.deepEqual([h.fx.board().totalTreats, h.fx.board().totalTricks, h.fx.board().totalPranks, h.fx.board().participants], [2, 2, 1, 1]);
  assert.equal(h.emitted.filter(e => e.event === 'halloween:pop').length, 4);
  assert.equal(h.emitted.filter(e => e.event === 'halloween:prank').length, 1);
  assert.equal(twitch.calls.filter(c => c.status === 'FULFILLED').length, 4);
  assert.equal(h.fx.drawRaffle({ pool: 'chat', announce: false }).winner.name, '糖果熊');
  h.tick(30_000);
  h.fx.handleChat(chat('9', '嚇人鬼', '!BOO'));
  assert.equal(h.fx.board().totalPranks, 2);
  await h.fx.setSettings({ chatEnabled: false });
  assert.equal(h.fx.handleChat(chat('10', '路人', '!boo')), false);
  await twitch.redeem(redemption('still-paid', settings.prank.rewardId));
  assert.equal(h.fx.board().totalPranks, 3, '關閉聊天不影響點數');
});

test('prank chat can run without Twitch or a points reward and all three command switches are independent', async () => {
  const h = harness();
  assert.equal(h.fx.handleChat(chat('1', '鬼', '!scare')), false, '新增免費指令預設關閉');
  const result = await h.fx.setSettings({ prank: { chatEnabled: true }, trickChatEnabled: false });
  assert.equal(result.ok, true);
  assert.equal(h.fx.handleChat(chat('1', '鬼', '!scare')), true);
  assert.equal(h.fx.handleChat(chat('2', '鬼二', '!trick')), false);
  assert.equal(h.fx.handleChat(chat('2', '鬼二', '!treat')), true);
  assert.equal(h.fx.board().participants, 2, '只用嚇人指令的人也計入參加人數');
  assert.equal(h.fx.board().totalPranks, 1);
  assert.equal(h.emitted.filter(e => e.event === 'halloween:prank').length, 1);
  await h.fx.setSettings({ prank: { chatEnabled: false } });
  h.tick(30_000);
  assert.equal(h.fx.handleChat(chat('1', '鬼', '!scare')), false);
  assert.equal((await h.fx.setSettings({ prank: { command: '!TREAT' } })).ok, false);
});

test('points rewards reuse IDs, ignore injected IDs, and cancel disabled, ended, or invalid redemptions', async () => {
  const h = harness(); const twitch = pointsTwitch(); h.fx.attachTwitch(twitch);
  const initial = await h.fx.setSettings({ rewards: { treat: { enabled: true, rewardId: 'attacker-id', cost: 220, cooldownSeconds: 0 }, trick: { enabled: true } } });
  const { treat, trick } = initial.state.settings.rewards;
  assert.notEqual(treat.rewardId, 'attacker-id');
  assert.equal(twitch.calls[0].body.cost, 220);
  assert.equal(twitch.calls[0].body.is_global_cooldown_enabled, false);
  assert.equal(twitch.calls[0].body.should_redemptions_skip_request_queue, false);
  await h.fx.setSettings({ rewards: { treat: { enabled: false }, trick: { cost: 400 } } });
  await twitch.redeem(redemption('off', treat.rewardId));
  await twitch.redeem({ id: 'invalid', reward: { id: trick.rewardId }, status: 'unfulfilled' });
  h.setActive(false);
  await twitch.redeem(redemption('ended', trick.rewardId));
  assert.deepEqual(twitch.calls.filter(c => c.status === 'CANCELED').map(c => c.id), ['off', 'invalid', 'ended']);
  assert.equal(h.fx.board().participants, 0);
  assert.equal(h.emitted.length, 0);
  await h.fx.setSettings({ rewards: { treat: { enabled: true } } });
  assert.equal(h.fx.snapshot().settings.rewards.treat.rewardId, treat.rewardId);
  assert.equal(twitch.calls.filter(c => c.method === 'POST').length, 2);
});

test('partial sync retains successful IDs on disk and retries only the remaining reward', async () => {
  const h = harness(); const twitch = pointsTwitch(); const success = twitch.helix;
  twitch.helix = async (url, options) => options.body.title === DEFAULT_SETTINGS.rewards.trick.title
    ? { ok: false, status: 403, json: async () => ({}) } : success(url, options);
  h.fx.attachTwitch(twitch);
  const input = { rewards: { treat: { enabled: true }, trick: { enabled: true } } };
  const failed = await h.fx.setSettings(input);
  assert.equal(failed.ok, false);
  assert.equal(failed.state.settings.rewards.treat.enabled, true);
  assert.equal(failed.state.settings.rewards.trick.enabled, false);
  const saved = JSON.parse(fs.readFileSync(h.file, 'utf8'));
  assert.equal(saved.settings.rewards.treat.rewardId, failed.state.settings.rewards.treat.rewardId);
  twitch.helix = success;
  const retried = await h.fx.setSettings(input);
  assert.equal(retried.ok, true);
  assert.equal(retried.state.settings.rewards.treat.rewardId, saved.settings.rewards.treat.rewardId);
  assert.equal(twitch.calls.filter(c => c.method === 'POST').length, 2);
});

test('concurrent saves do not create duplicate rewards, and snapshots cannot alter authoritative reward settings', async () => {
  const h = harness(); const twitch = pointsTwitch(); h.fx.attachTwitch(twitch);
  const input = { rewards: { treat: { enabled: true } } };
  const results = await Promise.all([h.fx.setSettings(input), h.fx.setSettings(input)]);
  assert.ok(results.every(r => r.ok));
  assert.equal(twitch.calls.filter(c => c.method === 'POST').length, 1);
  results[0].state.settings.rewards.treat.enabled = false;
  assert.equal(h.fx.snapshot().settings.rewards.treat.enabled, true);
  await twitch.redeem(redemption('persisted-treat', h.fx.snapshot().settings.rewards.treat.rewardId));
  h.fx.saveNow();
  const loaded = createHalloweenInteractions({ isActive: () => true, emit() {}, getDonations: () => [], file: h.file });
  assert.equal(loaded.snapshot().settings.rewards.treat.rewardId, h.fx.snapshot().settings.rewards.treat.rewardId);
  assert.equal(loaded.board().totalTreats, 1);
  assert.equal(cleanSettings({ prank: { enabled: true, rewardId: 'legacy-prank-id' } }).prank.rewardId, 'legacy-prank-id');
  assert.equal(cleanSettings({ prank: { enabled: true } }).rewards.treat.enabled, false);
  const legacyCommands = cleanSettings({ treatCommand: '!scare', trickCommand: '!scare2' });
  assert.equal(legacyCommands.treatCommand, '!scare');
  assert.equal(legacyCommands.trickCommand, '!scare2');
  assert.equal(legacyCommands.prank.command, '!scare3', '新增指令不可搶走既有指令');
});
