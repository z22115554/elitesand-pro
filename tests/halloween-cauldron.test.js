'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-halloween-cauldron-'));
process.env.ELITESAND_DATA_DIR = dataDir;
const { createSeasonalEvent } = require('../server/services/seasonal-event');
const { createHalloweenCauldron, cleanSettings, DEFAULT_SETTINGS, INGREDIENTS } = require('../server/services/halloween-cauldron');

test.after(() => fs.rmSync(dataDir, { recursive: true }));

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const unique = () => Math.random().toString(36).slice(2);

function fakeTwitch({ failWith = null } = {}) {
  const calls = [];
  const statuses = [];
  let nextId = 1;
  const rewards = new Map();
  const respond = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
  return {
    calls,
    statuses,
    rewards,
    auth: { userId: 'b1' },
    async requireRedemptionAuthorization() {},
    async helix(url, options = {}) {
      calls.push({ url, method: options.method, body: options.body });
      if (failWith) return respond(failWith, { message: 'nope' });
      const id = new URL(`https://x${url}`).searchParams.get('id');
      if (options.method === 'POST') {
        const reward = { id: `reward-${String(nextId++).padStart(4, '0')}`, ...options.body };
        rewards.set(reward.id, reward);
        return respond(200, { data: [reward] });
      }
      if (!rewards.has(id)) return respond(404, {});
      if (options.method === 'DELETE') { rewards.delete(id); return respond(204, {}); }
      const reward = { ...rewards.get(id), ...options.body };
      rewards.set(id, reward);
      return respond(200, { data: [reward] });
    },
    async updateRewardRedemptionStatus(redemption, status) { statuses.push({ ...redemption, status }); },
  };
}

function harness({ active = true, file = path.join(dataDir, `cauldron-${unique()}.json`), twitch = null } = {}) {
  const event = createSeasonalEvent({
    fileName: `event-${unique()}.json`,
    label: '測試活動',
    logTag: 'TestEvent',
    endsAt: active ? '2099-01-01T00:00:00Z' : '2000-01-01T00:00:00Z',
    styles: ['water', ...INGREDIENTS],
    defaultTiers: { water: 1, candy: 1, ghost: 100, bat: 300, pumpkin: 500, witch: 1000 },
    styleByAmount: true,
    defaults: { title: 't', doneText: 'd', goal: 1000, base: 0 },
    ingredients: INGREDIENTS,
    plainStyle: 'water',
  });
  const emitted = [];
  let clock = 1_000_000;
  const cauldron = createHalloweenCauldron({ event, emit: (name, payload) => emitted.push({ name, payload }), file, now: () => clock++ });
  if (twitch) cauldron.attachTwitch(twitch);
  return { event, cauldron, emitted, file };
}

const redemption = (id, rewardId, user = 'u1', name = '小明') => ({ id, reward: { id: rewardId }, status: 'unfulfilled', user_id: user, user_name: name });

test('points mode: one redemption = 1 part, donations weigh NT$10 per part, plain water fills the pot without voting', async () => {
  const twitch = fakeTwitch();
  const { event, cauldron, emitted } = harness({ twitch });
  assert.equal(cauldron.snapshot().settings.mode, 'points', '預設是頻道點數＋斗內');
  const sync = await cauldron.syncRewards();
  assert.equal(sync.ok, true);
  const ids = Object.fromEntries([...twitch.rewards.values()].map((r) => [r.title, r.id]));
  assert.equal(twitch.rewards.size, 5, '五種材料各一個兌換項目');

  for (let i = 0; i < 6; i++) assert.equal(await cauldron.handleRedemption(redemption(`r${i}`, ids['丟入幽靈之魂'], `u${i}`, `觀眾${i}`)), true);
  await cauldron.handleRedemption(redemption('r9', ids['丟入南瓜泥'], 'u9', '觀眾9'));
  event.addDonation({ name: '大戶', amount: 50, ingredient: 'pumpkin' });
  event.addDonation({ name: '路人', amount: 200 });

  const snap = event.snapshot();
  assert.equal(snap.unit, 'shares');
  assert.equal(snap.goal, DEFAULT_SETTINGS.goalShares);
  assert.equal(snap.cauldron.amounts.ghost, 6);
  assert.equal(snap.cauldron.amounts.pumpkin, 6, '1 次兌換＋NT$50÷10');
  assert.equal(snap.cauldron.plainShares, 20, '清水 NT$200 → 20 份，只算總量');
  assert.equal(snap.total, 32);
  assert.equal(snap.donationTotal, 250, '原本的斗內金額保留給謝幕／回顧卡');
  assert.equal(snap.cauldron.shares.ghost, 0.5);
  assert.deepEqual(snap.cauldron.top3, ['ghost', 'pumpkin']);
  assert.equal(snap.cauldron.voters, 7);
  assert.equal(snap.cauldron.champions.pumpkin, '大戶', '各派大將合併點數與斗內');

  const fulfilled = twitch.statuses.filter((s) => s.status === 'FULFILLED');
  assert.equal(fulfilled.length, 7);
  assert.equal(emitted.filter((e) => e.name === 'halloween:drop').length, 7);
  assert.deepEqual(emitted.find((e) => e.name === 'halloween:drop').payload.ingredient, 'ghost');
});

test('redemptions: other rewards pass through, duplicates and non-unfulfilled events are ignored', async () => {
  const twitch = fakeTwitch();
  const { cauldron, event } = harness({ twitch });
  await cauldron.syncRewards();
  const ghost = [...twitch.rewards.values()].find((r) => r.title === '丟入幽靈之魂').id;
  assert.equal(await cauldron.handleRedemption(redemption('x1', 'someone-elses-reward')), false, '不是大鍋的兌換要交回搗蛋／點歌');
  assert.equal(await cauldron.handleRedemption(redemption('a1', ghost)), true);
  assert.equal(await cauldron.handleRedemption(redemption('a1', ghost)), true, 'EventSub 重送同一筆');
  assert.equal(await cauldron.handleRedemption({ ...redemption('a2', ghost), status: 'fulfilled' }), true);
  assert.equal(event.snapshot().cauldron.amounts.ghost, 1);
  assert.equal(twitch.statuses.length, 1);
});

test('redemptions are refunded after brewing, in donations-only mode, for a disabled ingredient, and after the event ends', async () => {
  const twitch = fakeTwitch();
  const { cauldron, event } = harness({ twitch });
  await cauldron.syncRewards();
  const id = (title) => [...twitch.rewards.values()].find((r) => r.title === title).id;
  await cauldron.handleRedemption(redemption('b1', id('丟入幽靈之魂')));
  assert.equal(cauldron.brew().ok, true);
  await cauldron.handleRedemption(redemption('b2', id('丟入幽靈之魂')));
  cauldron.resetBrew();
  await cauldron.setSettings({ potions: { bat: { enabled: false } } });
  await cauldron.handleRedemption(redemption('b3', id('丟入蝙蝠翅膀')));
  await cauldron.setSettings({ mode: 'donation' });
  await cauldron.handleRedemption(redemption('b4', id('丟入幽靈之魂')));
  const byId = Object.fromEntries(twitch.statuses.map((s) => [s.id, s.status]));
  assert.deepEqual(byId, { b1: 'FULFILLED', b2: 'CANCELED', b3: 'CANCELED', b4: 'CANCELED' });
  assert.equal(event.snapshot().cauldron.amounts.ghost, 0, '純斗內模式不計點數票（票本身保留）');

  // 活動已結束（啟動時判斷）：兌換項目同步成暫停，萬一還有兌換進來就退點。
  const endedTwitch = fakeTwitch();
  const ended = harness({ active: false, twitch: endedTwitch });
  await ended.cauldron.syncRewards();
  assert.ok([...endedTwitch.rewards.values()].every((r) => r.is_paused === true));
  const endedId = [...endedTwitch.rewards.values()][0].id;
  await ended.cauldron.handleRedemption(redemption('e1', endedId));
  assert.deepEqual(endedTwitch.statuses.map((s) => s.status), ['CANCELED']);
});

test('donations-only mode counts NT$1 per part, keeps money as the unit, and leaves channel points alone', async () => {
  const twitch = fakeTwitch();
  const { cauldron, event } = harness({ twitch });
  const result = await cauldron.setSettings({ mode: 'donation' });
  assert.equal(result.ok, true);
  assert.equal(twitch.calls.length, 0, '純斗內且從沒建過兌換項目：不碰 Twitch');
  event.addDonation({ name: 'a', amount: 300, ingredient: 'witch' });
  event.addDonation({ name: 'b', amount: 100, ingredient: 'candy' });
  const snap = event.snapshot();
  assert.equal(snap.unit, 'money');
  assert.equal(snap.total, 400);
  assert.equal(snap.goal, 1000, '目標沿用活動設定的金額');
  assert.equal(snap.cauldron.amounts.witch, 300);
  assert.equal(snap.cauldron.shares.witch, 0.75);
});

test('brewing: needs a vote, picks the biggest share, ties within 1% brew a two-color potion, goal makes it deluxe', async () => {
  const { cauldron, event } = harness();
  await cauldron.setSettings({ mode: 'donation' });
  event.addDonation({ name: 'w', amount: 999 });
  assert.equal(cauldron.brew().ok, false, '只有清水不能熬');

  event.addDonation({ name: 'a', amount: 500, ingredient: 'ghost' });
  event.addDonation({ name: 'b', amount: 496, ingredient: 'pumpkin' });
  const tie = cauldron.brew();
  assert.equal(tie.ok, true);
  assert.equal(tie.state.brew.winner, 'ghost');
  assert.deepEqual(tie.state.brew.tie, ['ghost', 'pumpkin']);
  assert.equal(tie.state.brew.reachedGoal, true, '999＋996 ≥ 目標 1000');
  assert.equal(cauldron.brew().ok, false, '熬過了不能再熬');

  event.addDonation({ name: 'c', amount: 1000, ingredient: 'candy' });
  assert.equal(event.snapshot().cauldron.brew.winner, 'ghost', '熬好之後的斗內不改變結果');
  assert.equal(cauldron.setPotionHidden(true).state.brew.hidden, true);
  assert.equal(event.snapshot().cauldron.brew.hidden, true);
  cauldron.resetBrew();
  const again = cauldron.brew();
  assert.equal(again.state.brew.winner, 'candy');
  assert.equal(again.state.brew.tie, null);
});

test('a disabled ingredient keeps its votes but cannot win or share the pie', async () => {
  const { cauldron, event } = harness();
  await cauldron.setSettings({ mode: 'donation', potions: { witch: { enabled: false } } });
  event.addDonation({ name: 'a', amount: 900, ingredient: 'witch' });
  event.addDonation({ name: 'b', amount: 100, ingredient: 'bat' });
  const snap = event.snapshot();
  assert.equal(snap.cauldron.amounts.witch, 900);
  assert.equal(snap.cauldron.shares.witch, 0);
  assert.equal(snap.cauldron.shares.bat, 1);
  assert.equal(cauldron.brew().state.brew.winner, 'bat');
});

test('Twitch rewards: created for enabled ingredients, paused (not deleted) in donations-only mode, recreated when deleted on Twitch, removed only on request', async () => {
  const twitch = fakeTwitch();
  const { cauldron } = harness({ twitch });
  await cauldron.setSettings({ potions: { witch: { enabled: false, reward: '主播接受懲罰' }, ghost: { reward: '怪談朗讀' } }, maxPerStream: 3, rewardCost: 500 });
  const posts = twitch.calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 4, '關掉的材料不建立兌換項目');
  const ghost = posts.find((c) => c.body.title === '丟入幽靈之魂').body;
  assert.equal(ghost.cost, 500);
  assert.equal(ghost.max_per_user_per_stream, 3);
  assert.equal(ghost.is_max_per_user_per_stream_enabled, true);
  assert.equal(ghost.is_paused, false);
  assert.equal(ghost.should_redemptions_skip_request_queue, false, '要能退點，不可跳過佇列');
  assert.match(ghost.prompt, /幽魂藥水.*怪談朗讀/);

  twitch.calls.length = 0;
  await cauldron.setSettings({ mode: 'donation' });
  const paused = twitch.calls.filter((c) => c.method === 'PATCH');
  assert.equal(paused.length, 4);
  assert.ok(paused.every((c) => c.body.is_paused === true), '切到純斗內：全部暫停，不刪除');

  const someId = [...twitch.rewards.keys()][0];
  twitch.rewards.delete(someId);
  twitch.calls.length = 0;
  await cauldron.setSettings({ mode: 'points' });
  assert.equal(twitch.calls.filter((c) => c.method === 'POST').length, 1, '在 Twitch 後台被刪掉的那個重新建立');

  const removed = await cauldron.removeRewards();
  assert.equal(removed.ok, true);
  assert.equal(twitch.rewards.size, 0);
  assert.ok(removed.state.rewards.every((r) => !r.created));
});

test('reward sync failures are reported but the settings still save (e.g. channel is not an affiliate)', async () => {
  const { cauldron } = harness({ twitch: fakeTwitch({ failWith: 403 }) });
  // 只改目標份數不需要同步 Twitch；改點數才會同步兌換項目。
  const result = await cauldron.setSettings({ goalShares: 777, rewardCost: 999 });
  assert.equal(result.ok, true);
  assert.match(result.syncError, /聯盟/);
  assert.equal(result.state.settings.goalShares, 777);
  assert.equal(result.state.rewardStatus.ok, false);
  const noTwitch = harness();
  const sync = await noTwitch.cauldron.syncRewards();
  assert.equal(sync.ok, false);
  assert.match(sync.error, /連接 Twitch/);
});

test('settings are cleaned and reward ids can only come from Twitch, never from the panel', async () => {
  const s = cleanSettings({ mode: 'hack', donationPerShare: 0, goalShares: -5, rewardCost: 'x', maxPerStream: 99999,
    potions: { ghost: { name: 'x'.repeat(50), reward: '  ', enabled: 'yes' } }, rewardIds: { ghost: 'evil' } });
  assert.equal(s.mode, DEFAULT_SETTINGS.mode);
  assert.equal(s.donationPerShare, 1);
  assert.equal(s.goalShares, 1);
  assert.equal(s.rewardCost, DEFAULT_SETTINGS.rewardCost);
  assert.equal(s.maxPerStream, 1000);
  assert.equal(s.potions.ghost.name.length, 20);
  assert.equal(s.potions.ghost.reward, '', '企劃內容可以清空');
  assert.equal(s.potions.ghost.enabled, true);
  assert.equal('rewardIds' in s, false);
});

test('votes, voters and the brewing result survive a restart; the live overlay state does not need the panel', async () => {
  const file = path.join(dataDir, `persist-${unique()}.json`);
  const twitch = fakeTwitch();
  const first = harness({ file, twitch });
  await first.cauldron.syncRewards();
  const ghost = [...twitch.rewards.values()].find((r) => r.title === '丟入幽靈之魂').id;
  await first.cauldron.handleRedemption(redemption('p1', ghost));
  first.cauldron.brew();
  assert.equal(first.cauldron.saveNow(), true);
  const second = harness({ file, twitch });
  const snap = second.event.snapshot();
  assert.equal(second.cauldron.snapshot().brew.winner, 'ghost');
  assert.equal(second.cauldron.snapshot().rewards.filter((r) => r.created).length, 5);
  assert.equal(snap.cauldron.voters, 1);
  // 新實例的事件服務是新的（斗內 0），但點數票從大鍋存檔讀回來。
  assert.equal(snap.cauldron.amounts.ghost, 1);
});

test('server wiring: the cauldron gets the single redemption slot first, then the prank reward, then song requests', () => {
  const index = read('server/index.js');
  assert.match(index, /halloweenCauldron\.handleRedemption\(event, fallbackId\)\) \|\| halloweenInteractions\.handleRedemption\(event, fallbackId\)/);
  assert.ok(index.indexOf('halloweenInteractions.attachTwitch(twitch)') < index.indexOf('twitch.setRedemptionInterceptor('),
    '大鍋的串接必須在搗蛋幽靈註冊之後，否則會被蓋掉');
  const handler = read('server/routes/handlers/halloween-event.js');
  assert.match(handler, /if \(socket\.clientType !== 'controller'\) return;[\s\S]*CAULDRON_EVENTS/, '大鍋寫入只限桌面面板');
  const page = read('public/halloween.html');
  assert.match(page, /id="cauldron-liquid"/);
  assert.ok(read('public/index.html').includes('/js/app-halloween-cauldron.js'));
});
