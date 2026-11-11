'use strict';

// 核心回歸測試（lyrics-settings）。由 tests/run-tests.js 依序載入，不要單獨執行。
const {
  fs,
  path,
  os,
  failed,
  cloneJson,
  test,
  testAsync,
  eq,
  ok,
} = require('./core-harness');
const { runStateStoreChild } = require('./core-harness').shared;

// ═══════════════════════════════════════════
console.log('\n📦 9. 歌詞選擇器與歌詞設定');
// ═══════════════════════════════════════════
const { LyricsEngine, LYRICS_SOURCE_PRIORITY, cacheEntryIsFresh } = require('../server/services/lyrics-engine');
const { ProviderHealthRegistry } = require('../server/services/provider-health');

test('自動歌詞來源優先序符合設定', () => {
  eq(LYRICS_SOURCE_PRIORITY.join('>'), 'betterlyrics>paxsenix>kugou>qqmusic>lrclib>netease');
});

test('TTML ttm:agent：對唱歌曲的逐字歌詞帶出 line.singer（a/b/both）', () => {
  const { parseTTML } = require('../server/services/ttml-parser');
  const ttml = `<?xml version="1.0"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
<head><metadata>
<ttm:agent type="person" xml:id="v1"/>
<ttm:agent type="person" xml:id="v2"/>
<ttm:agent type="group" xml:id="v3"/>
</metadata></head>
<body><div>
<p begin="1.000" end="3.000" ttm:agent="v1"><span begin="1.000" end="2.000">You</span><span begin="2.000" end="3.000">say</span></p>
<p begin="3.000" end="5.000" ttm:agent="v2"><span begin="3.000" end="4.000">I</span><span begin="4.000" end="5.000">stay</span></p>
<p begin="5.000" end="7.000" ttm:agent="v1"><span begin="5.000" end="6.000">we</span><span begin="6.000" end="7.000">go</span></p>
<p begin="7.000" end="9.000" ttm:agent="v3"><span begin="7.000" end="8.000">to</span><span begin="8.000" end="9.000">gether</span></p>
</div></body></tt>`;
  const krc = parseTTML(ttml);
  ok(krc && krc.includes(''), 'KRC 字串含聲部標記 sentinel');
  const parsed = LyricsEngine.parseKrc(krc);
  eq(parsed.length, 4);
  eq(parsed[0].singer, 'a');
  eq(parsed[1].singer, 'b');
  eq(parsed[2].singer, 'a');
  eq(parsed[3].singer, 'both');
  ok(parsed.every((l) => !('singerLabel' in l)), 'TTML 路徑不帶 singerLabel（KTV 只上色不標男女）');
  ok(!parsed[0].text.includes(''), '文字不殘留 sentinel');
  eq(parsed[0].text, 'Yousay');
});

test('TTML ttm:agent：agent 掛在 <div> 上時 <p> 繼承', () => {
  const { parseTTML } = require('../server/services/ttml-parser');
  const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
<head><metadata><ttm:agent type="person" xml:id="v1"/><ttm:agent type="person" xml:id="v2"/></metadata></head>
<body>
<div ttm:agent="v1"><p begin="1.0" end="2.0"><span begin="1.0" end="2.0">alpha</span></p></div>
<div ttm:agent="v2"><p begin="2.0" end="3.0"><span begin="2.0" end="3.0">beta</span></p></div>
<div ttm:agent="v1"><p begin="3.0" end="4.0" ttm:agent="v2"><span begin="3.0" end="4.0">gamma</span></p></div>
</body></tt>`;
  const parsed = LyricsEngine.parseKrc(parseTTML(ttml));
  eq(parsed.length, 3);
  eq(parsed[0].singer, 'a', '繼承 <div> 的 v1');
  eq(parsed[1].singer, 'b', '繼承 <div> 的 v2');
  eq(parsed[2].singer, 'b', '<p> 自己的 agent 優先於 <div>');
});

test('TTML：背景和聲 (ttm:role=x-bg) 與翻譯行不混進主歌詞', () => {
  const { parseTTML } = require('../server/services/ttml-parser');
  const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
<head><metadata><ttm:agent type="person" xml:id="v1"/></metadata></head>
<body><div>
<p begin="1.0" end="4.0" ttm:agent="v1"><span begin="1.0" end="2.0">hold</span><span begin="2.0" end="3.0">on</span><span ttm:role="x-bg" begin="1.5" end="3.5"><span begin="1.5" end="2.0">(oh)</span><span begin="3.0" end="3.5">(yeah)</span></span><span begin="3.0" end="4.0">tight</span></p>
<p begin="4.0" end="5.0" ttm:role="x-translation"><span begin="4.0" end="5.0">抓緊</span></p>
</div></body></tt>`;
  const parsed = LyricsEngine.parseKrc(parseTTML(ttml));
  eq(parsed.length, 1, '翻譯整行 <p> 被跳過');
  eq(parsed[0].text, 'holdontight', '背景和聲不混入主唱行');
});

test('TTML ttm:agent：solo 歌（只有一個 agent）不輸出聲部標記', () => {
  const { parseTTML } = require('../server/services/ttml-parser');
  const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
<head><metadata><ttm:agent type="person" xml:id="v1"/></metadata></head>
<body><div>
<p begin="1.000" end="2.000" ttm:agent="v1"><span begin="1.000" end="2.000">solo</span></p>
<p begin="2.000" end="3.000" ttm:agent="v1"><span begin="2.000" end="3.000">line</span></p>
<p begin="3.000" end="4.000" ttm:agent="v1"><span begin="3.000" end="4.000">only</span></p>
</div></body></tt>`;
  const krc = parseTTML(ttml);
  ok(krc && !krc.includes(''), '單一 agent 不夾 sentinel');
  const parsed = LyricsEngine.parseKrc(krc);
  ok(parsed.every((l) => !('singer' in l)), '沒有 line.singer');
});

test('歌詞 negative cache 使用 24 小時、正常結果沿用一般 TTL', () => {
  const now = Date.now();
  ok(cacheEntryIsFresh({ result: null, negative: true, timestamp: now - 23 * 60 * 60 * 1000 }, now));
  ok(!cacheEntryIsFresh({ result: null, negative: true, timestamp: now - 25 * 60 * 60 * 1000 }, now));
  ok(cacheEntryIsFresh({ result: { lyrics: 'ok' }, timestamp: now - 25 * 60 * 60 * 1000 }, now));
});

test('找不到歌詞會命中 negative cache，不重打六個來源', () => {
  const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-lyrics-negative-'));
  const enginePath = path.join(__dirname, '..', 'server', 'services', 'lyrics-engine.js');
  const script = `
    const { LyricsEngine, LYRICS_SOURCE_PRIORITY } = require(process.argv[1]);
    const method = { betterlyrics:'searchBetterLyrics', paxsenix:'searchPaxsenix', kugou:'searchKugou', qqmusic:'searchQQMusic', lrclib:'searchLrclib', netease:'searchNetease' };
    let calls = 0;
    for (const name of LYRICS_SOURCE_PRIORITY) LyricsEngine[method[name]] = async () => { calls += 1; return null; };
    (async () => { await LyricsEngine.search('cache-test', 'missing', 123, false); await LyricsEngine.search('cache-test', 'missing', 123, false); process.stdout.write('__RESULT__' + calls); process.exit(0); })();
  `;
  try {
    const result = require('child_process').spawnSync(process.execPath, ['-e', script, enginePath], {
      encoding: 'utf8', env: { ...process.env, ELITESAND_DATA_DIR: tempData }, timeout: 10000,
    });
    eq(result.status, 0, result.stderr || 'negative cache 子程序失敗: ');
    // 第一次搜尋打 7 次：六個來源各一次，加上網易雲這一格在 LRCLIB 之前先問的那次逐字（YRC／AMLL）。
    // 第二次搜尋命中 negative cache，一次都不該再打。
    eq(Number((result.stdout.split('__RESULT__')[1] || '').trim()), 7);
  } finally { fs.rmSync(tempData, { recursive: true, force: true }); }
});

test('歌詞搜尋遙測：每個來源同一次搜尋只記一次，不隨 title variant 重複灌水', () => {
  // 用會產生「原文 + 去掉尾端英文回聲」兩個 title variant 的標題，確保每個
  // 來源真的被試超過一次——這樣才驗證得到 search() 裡按來源去重的邏輯，
  // 而不是巧合下只跑了一輪就通過。
  const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-lyrics-telemetry-'));
  const enginePath = path.join(__dirname, '..', 'server', 'services', 'lyrics-engine.js');
  const script = `
    const { LyricsEngine, LYRICS_SOURCE_PRIORITY } = require(process.argv[1]);
    const usageTelemetry = require(require('path').join(require('path').dirname(process.argv[1]), 'usage-telemetry'));
    const method = { betterlyrics:'searchBetterLyrics', paxsenix:'searchPaxsenix', kugou:'searchKugou', qqmusic:'searchQQMusic', lrclib:'searchLrclib', netease:'searchNetease' };
    const callCounts = {};
    for (const name of LYRICS_SOURCE_PRIORITY) {
      callCounts[name] = 0;
      LyricsEngine[method[name]] = async () => {
        callCounts[name] += 1;
        // netease 故意在第一個 title variant 沒中，第二個才中——逼搜尋真的
        // 跨過第二輪 variant，這樣其餘 5 個來源才會被試兩次，才測得到「試了
        // 兩次但只記一次」這件事。若一輪就中，迴圈馬上 return，永遠測不到。
        // 網易雲這一格每輪會被問兩次（LRCLIB 之前先問逐字、最後再問一次），所以第 4 次才是第二輪的最後一次。
        if (name === 'netease' && callCounts[name] >= 4) return { lyrics: '[00:00.00]hello', type: 'lrc' };
        return null;
      };
    }
    const sourceCalls = [];
    const outcomeCalls = [];
    usageTelemetry.recordLyricSource = (source, hit) => { sourceCalls.push([source, hit]); return true; };
    usageTelemetry.recordOutcome = (family, ok, code) => { outcomeCalls.push([family, ok, code]); return true; };
    (async () => {
      const result = await LyricsEngine.search('漢字之歌', '漢字之歌 Song Title Echo', 123, false);
      process.stdout.write('__RESULT__' + JSON.stringify({
        found: !!result, callCounts, sourceCalls, outcomeCalls,
      }));
      process.exit(0);
    })();
  `;
  try {
    const result = require('child_process').spawnSync(process.execPath, ['-e', script, enginePath], {
      encoding: 'utf8', env: { ...process.env, ELITESAND_DATA_DIR: tempData }, timeout: 10000,
    });
    ok(result.status === 0, result.stderr || '歌詞遙測子程序失敗: ');
    const payload = JSON.parse((result.stdout.split('__RESULT__')[1] || '{}').trim());

    ok(payload.found, 'netease 應該命中: ');
    // netease 故意設計成第二輪 variant 才中，逼所有 5 個其他來源真的被試兩次
    // （每個 variant 一次）——這樣才是在測「試了兩次但只記一次」，不是巧合下
    // 只跑了一輪就通過。
    const others0 = LYRICS_SOURCE_PRIORITY.filter((n) => n !== 'netease');
    ok(others0.every((n) => payload.callCounts[n] === 2), '測試前提不成立：其餘來源沒有真的被試兩輪: ');
    eq(payload.callCounts.netease, 4, 'netease 每輪問兩次（先逐字、後逐句），第二輪最後一次才 hit: ');

    // 不論底層被試了幾次，每個來源在遙測裡只能出現一筆
    const sourceNames = payload.sourceCalls.map((entry) => entry[0]);
    eq(new Set(sourceNames).size, sourceNames.length, '同一次搜尋裡每個來源只能記一次，不可重複: ');
    eq(sourceNames.length, LYRICS_SOURCE_PRIORITY.length, '六個來源應該各記一次: ');

    const netease = payload.sourceCalls.find((entry) => entry[0] === 'netease');
    ok(netease && netease[1] === true, 'netease 命中應記為 hit: ');
    const others = payload.sourceCalls.filter((entry) => entry[0] !== 'netease');
    ok(others.every((entry) => entry[1] === false), '沒命中的來源應記為 miss: ');

    eq(payload.outcomeCalls.length, 1, 'family 層 outcome 只該記一次: ');
    eq(payload.outcomeCalls[0][0], 'lyrics');
    eq(payload.outcomeCalls[0][1], true);
  } finally { fs.rmSync(tempData, { recursive: true, force: true }); }
});

test('歌詞搜尋遙測：全部來源都沒找到時，family 記 no_match，'
  + 'skipped 的來源不計入命中率', () => {
  const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-lyrics-telemetry-miss-'));
  const enginePath = path.join(__dirname, '..', 'server', 'services', 'lyrics-engine.js');
  const script = `
    const { LyricsEngine, LYRICS_SOURCE_PRIORITY } = require(process.argv[1]);
    const usageTelemetry = require(require('path').join(require('path').dirname(process.argv[1]), 'usage-telemetry'));
    const method = { betterlyrics:'searchBetterLyrics', paxsenix:'searchPaxsenix', kugou:'searchKugou', qqmusic:'searchQQMusic', lrclib:'searchLrclib', netease:'searchNetease' };
    for (const name of LYRICS_SOURCE_PRIORITY) LyricsEngine[method[name]] = async () => null;
    const sourceCalls = [];
    const outcomeCalls = [];
    usageTelemetry.recordLyricSource = (source, hit) => { sourceCalls.push([source, hit]); return true; };
    usageTelemetry.recordOutcome = (family, ok, code) => { outcomeCalls.push([family, ok, code]); return true; };
    (async () => {
      const result = await LyricsEngine.search('no-such-artist', 'no-such-title-xyz', 999, false);
      process.stdout.write('__RESULT__' + JSON.stringify({ found: !!result, sourceCalls, outcomeCalls }));
      process.exit(0);
    })();
  `;
  try {
    const result = require('child_process').spawnSync(process.execPath, ['-e', script, enginePath], {
      encoding: 'utf8', env: { ...process.env, ELITESAND_DATA_DIR: tempData }, timeout: 10000,
    });
    ok(result.status === 0, result.stderr || '歌詞遙測子程序失敗: ');
    const payload = JSON.parse((result.stdout.split('__RESULT__')[1] || '{}').trim());

    ok(!payload.found, '應該找不到: ');
    ok(payload.sourceCalls.every((entry) => entry[1] === false), '全部來源都該記 miss: ');
    eq(payload.outcomeCalls.length, 1);
    eq(payload.outcomeCalls[0][0], 'lyrics');
    eq(payload.outcomeCalls[0][1], false);
    eq(payload.outcomeCalls[0][2], 'no_match', '找不到時 family 失敗碼要是 no_match: ');
  } finally { fs.rmSync(tempData, { recursive: true, force: true }); }
});

testAsync('歌詞來源連續失敗會暫停，冷卻後自動恢復', async () => {
  let now = 1000;
  const health = new ProviderHealthRegistry({ failureThreshold: 2, cooldownMs: 100, timeoutMs: 50, now: () => now });
  await health.execute('fixture', async () => { throw new Error('offline'); });
  await health.execute('fixture', async () => { throw new Error('offline'); });
  eq(health.snapshot(['fixture'])[0].state, 'paused');
  const skipped = await health.execute('fixture', async () => ({ lyrics: '不應執行' }));
  eq(skipped.status, 'skipped');
  now += 101;
  const recovered = await health.execute('fixture', async () => ({ lyrics: '[00:00.00]ok' }));
  eq(recovered.status, 'success');
  eq(health.snapshot(['fixture'])[0].state, 'available');
});

testAsync('歌詞來源逾時會被統計為 timeout', async () => {
  const health = new ProviderHealthRegistry({ timeoutMs: 5 });
  const result = await health.execute('slow', () => new Promise(() => {}));
  eq(result.status, 'timeout');
  eq(health.snapshot(['slow'])[0].timeouts, 1);
});

testAsync('searchAllSources 離線時回傳空陣列不崩潰', async () => {
  const r = await LyricsEngine.searchAllSources('nonexistent', 'song', 180);
  ok(Array.isArray(r), '應回傳陣列: ');
});

test('lyric-settings 可被 state-store 持久化', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-lyrics-'));
  try {
    const result = runStateStoreChild(dataDir, [
      "const store=require(process.argv[1]); const snapshot={savedAt:Date.now(),playlist:[],lyricSettings:{fontSize:56,color:'#ff0000',verticalPosition:'center'}};",
      "store.scheduleSave(()=>snapshot); store.saveNow();",
      "process.stdout.write('__STATE_RESULT__'+JSON.stringify(store.loadState()));",
    ].join('\n'));
    ok(result && result.lyricSettings, 'lyricSettings 應被保存: ');
    eq(result.lyricSettings.fontSize, 56);
    eq(result.lyricSettings.color, '#ff0000');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

const { TwitchService, reconnectDelay, CONNECT_WATCHDOG_MS } = require('../server/services/twitch-service');
const TwitchReplySettings = require('../public/js/twitch-reply-settings');
const TwitchRequestSettings = require('../public/js/twitch-request-settings');
const TwitchRewardSettings = require('../public/js/twitch-reward-settings');

test('Twitch 自訂回覆契約涵蓋點歌生命週期、管理員操作與變數拼字', () => {
  eq(TwitchReplySettings.REPLY_DEFINITIONS.length, 45);
  const defaults = TwitchReplySettings.getDefaults();
  eq(defaults.enabled, true);
  eq(defaults.replies.retryableFailure.enabled, false);
  eq(TwitchReplySettings.validateTemplate('完成：{title}').valid, true);
  eq(TwitchReplySettings.renderTemplate('完成：{title}', { title: '測試歌曲' }), '完成：測試歌曲');
  const typo = TwitchReplySettings.validateTemplate('完成：{titel}');
  eq(typo.valid, false);
  ok(typo.errors[0].includes('{titel}'));
  eq(TwitchReplySettings.validateTemplate('完成：{title').valid, false);
  eq(TwitchReplySettings.validateTemplate('完成：｛title｝').valid, false);
  eq(TwitchReplySettings.validateTemplate('還要 {seconds} 秒，上限 {limit}，長度 {duration}').valid, true);
  eq(TwitchReplySettings.validateTemplate('已退款 {cost} 點').valid, true);
  eq(TwitchReplySettings.validateTemplate('目前 {currentTitle}，下一首 {nextTitle}，待確認 {requestCount} 首').valid, true);
  eq(TwitchReplySettings.validateTemplate('待確認編號 #{requestId}').valid, true);
  eq(TwitchReplySettings.REPLY_GROUPS.length, 5);
});

test('Twitch 忠誠點數獎勵契約限制名稱、說明、價格、原生限制與可管理 reward id', () => {
  const defaults = TwitchRewardSettings.getDefaults();
  eq(defaults.enabled, false);
  eq(defaults.cost, 1000);
  eq(defaults.paused, false);
  eq(defaults.maxPerStream, 0);
  eq(defaults.maxPerUserPerStream, 0);
  eq(defaults.globalCooldownSeconds, 0);
  eq(TwitchRewardSettings.validateSettings(defaults).ok, true);
  eq(TwitchRewardSettings.validateSettings({ ...defaults, title: '' }).ok, false);
  eq(TwitchRewardSettings.validateSettings({ ...defaults, title: '獎'.repeat(46) }).ok, false);
  eq(TwitchRewardSettings.validateSettings({ ...defaults, prompt: '說'.repeat(201) }).ok, false);
  eq(TwitchRewardSettings.validateSettings({ ...defaults, cost: 0 }).ok, false);
  eq(TwitchRewardSettings.validateSettings({ ...defaults, rewardId: '../bad' }).ok, false);
  eq(TwitchRewardSettings.validateSettings({ ...defaults, maxPerStream: -1 }).ok, false);
  eq(TwitchRewardSettings.validateSettings({ ...defaults, maxPerUserPerStream: 1.5 }).ok, false);
  eq(TwitchRewardSettings.validateSettings({ ...defaults, globalCooldownSeconds: 59 }).ok, false);
  eq(TwitchRewardSettings.validateSettings({ ...defaults, globalCooldownSeconds: 604801 }).ok, false);
  eq(TwitchRewardSettings.validateSettings({ ...defaults, globalCooldownSeconds: 60 }).ok, true);
});

test('Twitch 點歌規則契約驗證自訂指令、別名與聊天室徽章權限', () => {
  const settings = TwitchRequestSettings.getDefaults();
  settings.commands.request = { ...settings.commands.request, command: '!唱歌', aliases: ['!song', '!來一首'], permissionLevel: 'subscriber' };
  const validation = TwitchRequestSettings.validateSettings(settings);
  eq(validation.ok, true);
  eq(TwitchRequestSettings.matchCommand('!SONG https://youtu.be/dQw4w9WgXcQ', settings).argument, 'https://youtu.be/dQw4w9WgXcQ');
  eq(TwitchRequestSettings.matchCommand('!目前歌曲', settings).key, 'currentSong');
  eq(TwitchRequestSettings.matchCommand('!來一首', settings).command, '!來一首');
  eq(TwitchRequestSettings.matchCommand('!唱歌曲 https://youtu.be/dQw4w9WgXcQ', settings), null);
  eq(TwitchRequestSettings.permissionAllows({ badges: [{ set_id: 'subscriber' }] }, 'subscriber'), true);
  eq(TwitchRequestSettings.permissionAllows({ badges: [{ set_id: 'vip' }] }, 'subscriber'), true);
  eq(TwitchRequestSettings.permissionAllows({ badges: [] }, 'subscriber'), false);
  eq(TwitchRequestSettings.permissionAllows({ chatter_user_id: '7', broadcaster_user_id: '7', badges: [] }, 'moderator'), true);
  eq(TwitchRequestSettings.COMMAND_DEFINITIONS.length, 14);
  eq(settings.commands.adminOpen.enabled, false);
  const adminMatch = TwitchRequestSettings.matchCommand('!開放點歌', { ...settings, commands: { ...settings.commands, adminOpen: { ...settings.commands.adminOpen, enabled: true } } });
  eq(adminMatch.definition.adminOnly, true);
  const conflict = TwitchRequestSettings.clone(settings);
  conflict.commands.currentSong.command = '!song';
  eq(TwitchRequestSettings.validateSettings(conflict).ok, false);
  const invalid = TwitchRequestSettings.clone(settings);
  invalid.commands.request.command = '唱歌';
  eq(TwitchRequestSettings.validateSettings(invalid).ok, false);
  const compromisedAdmin = TwitchRequestSettings.clone(settings);
  compromisedAdmin.commands.adminOpen.permissionLevel = 'everyone';
  eq(TwitchRequestSettings.validateSettings(compromisedAdmin).ok, false);
  const legacy = TwitchRequestSettings.normalizeSettings({ enabled: true, command: '!舊點歌', aliases: ['!old'], permissionLevel: 'vip', cooldownSeconds: 12, maxPending: 9, perUserPending: 2, rejectDuplicates: true, maxDurationMinutes: 20 });
  eq(legacy.commands.request.command, '!舊點歌');
  eq(legacy.commands.request.userCooldownSeconds, 12);
  eq(legacy.commands.currentSong.command, '!目前歌曲');
  eq(legacy.duplicateScope, 'pending');
  const fairness = TwitchRequestSettings.getDefaults();
  fairness.duplicateScope = 'recent';
  fairness.recentDuplicateHours = 48;
  fairness.liveOnly = true;
  fairness.perUserSessionLimit = 3;
  fairness.sessionRequestLimit = 40;
  eq(TwitchRequestSettings.validateSettings(fairness).ok, true);
  eq(TwitchRequestSettings.validateSettings({ ...fairness, recentDuplicateHours: 0 }).ok, false);
});

testAsync('Twitch 管理員聊天室指令僅允許管理員、共用短編號，並由指定桌面面板執行略過', async () => {
  const replies = [];
  const persisted = [];
  const panelActions = [];
  const service = new TwitchService({
    config: { twitchClientId: '' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => true,
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => true },
    onRequestSettingsChange: async (settings) => { persisted.push(settings); },
    onPanelAction: (action) => { panelActions.push(action); return 'desktop-controller-1'; },
  });
  const settings = TwitchRequestSettings.getDefaults();
  ['adminOpen', 'adminPause', 'adminReject', 'adminRemove', 'adminPromote', 'adminSkip'].forEach((key) => { settings.commands[key].enabled = true; });
  service.setRequestSettings(settings);
  service.fetchYouTubeMetadata = async (url) => ({
    title: url.includes('9bZ') ? '第二首' : '第一首', author: '測試頻道', thumbnail: '', metadataAvailable: true, duration: 180, assessment: { warningTypes: [] },
  });
  service.sendConfiguredReply = async (_event, key, values = {}) => { replies.push({ key, values }); return { sent: true }; };
  const moderator = { message_id: 'mod', chatter_user_id: 'mod-1', chatter_user_name: 'mod', badges: [{ set_id: 'moderator' }], message: { text: '' } };
  const viewer = { message_id: 'viewer', chatter_user_id: 'viewer-1', chatter_user_name: 'viewer', badges: [], message: { text: '' } };

  viewer.message.text = '!開放點歌';
  await service.handleChatMessage(viewer);
  eq(replies.at(-1).key, 'permissionDenied');
  moderator.message.text = '!暫停點歌';
  await service.handleChatMessage(moderator);
  eq(service.requestSettings.enabled, false);
  eq(persisted.length, 1);
  moderator.message.text = '!開放點歌';
  await service.handleChatMessage(moderator);
  eq(service.requestSettings.enabled, true);

  await service.handleSongRequestInput({ event: viewer, requestId: 'pending-one', url: 'https://youtu.be/dQw4w9WgXcQ', command: '!點歌', source: 'chat' });
  await service.handleSongRequestInput({ event: { ...viewer, chatter_user_id: 'viewer-2', chatter_user_name: 'other' }, requestId: 'pending-two', url: 'https://youtu.be/9bZkp7q19f0', command: '!點歌', source: 'chat' });
  const [first, second] = service.getPendingRequests();
  ok(/^[A-F0-9]{6}$/.test(first.shortId));
  ok(/^[A-F0-9]{6}$/.test(second.shortId));

  moderator.message.text = `!提升順位 #${second.shortId}`;
  await service.handleChatMessage(moderator);
  eq(service.getPendingRequests()[0].requestId, 'pending-two');
  moderator.message.text = `!拒絕點歌 ${second.shortId}`;
  await service.handleChatMessage(moderator);
  eq(service.getPendingRequests().length, 1);
  ok(replies.some((reply) => reply.key === 'adminRequestRejected'));

  moderator.message.text = '!略過歌曲';
  await service.handleChatMessage(moderator);
  eq(panelActions.length, 1);
  eq(await service.completeAdminPanelAction({ actionId: panelActions[0].actionId, socketId: 'other-controller', ok: true }), false);
  eq(await service.completeAdminPanelAction({ actionId: panelActions[0].actionId, socketId: 'desktop-controller-1', ok: true }), true);
  eq(replies.at(-1).key, 'adminSkipped');

  moderator.message.text = '!移除點歌 @viewer';
  await service.handleChatMessage(moderator);
  eq(service.getPendingRequests().length, 0);
  service.stop();
});

test('T6 自訂指令只允許白名單變數，並拒絕拼字、全形括號與內建指令衝突', () => {
  const settings = TwitchRequestSettings.getDefaults();
  settings.customCommands = [{
    id: 'now_playing',
    enabled: true,
    command: '!資訊',
    aliases: ['!info'],
    permissionLevel: 'everyone',
    userCooldownSeconds: 10,
    globalCooldownSeconds: 2,
    template: '{user}，目前：{currentTitle}／下一首：{nextTitle}，待確認 {requestCount} 首。',
  }];
  const validation = TwitchRequestSettings.validateSettings(settings);
  eq(validation.ok, true);
  const matched = TwitchRequestSettings.matchCommand('!INFO', validation.settings);
  eq(matched.kind, 'custom');
  eq(matched.key, 'now_playing');
  const typo = TwitchRequestSettings.clone(settings);
  typo.customCommands[0].template = '目前 {currenTitle}';
  eq(TwitchRequestSettings.validateSettings(typo).ok, false);
  const fullWidth = TwitchRequestSettings.clone(settings);
  fullWidth.customCommands[0].template = '目前 ｛currentTitle｝';
  eq(TwitchRequestSettings.validateSettings(fullWidth).ok, false);
  const conflict = TwitchRequestSettings.clone(settings);
  conflict.customCommands[0].command = '!點歌';
  eq(TwitchRequestSettings.validateSettings(conflict).ok, false);
});

testAsync('T6 自訂指令只讀取狀態並回覆，不建立點歌或下載', async () => {
  const chat = [];
  let dispatches = 0;
  const service = new TwitchService({
    config: { twitchClientId: '' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => { dispatches += 1; return true; },
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
    sessionStore: { load: () => null, save: () => true }, historyStore: { load: () => [], save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => true },
    getPlaybackSnapshot: () => ({ playlist: [{ title: '目前歌曲', artist: '歌手' }, { title: '下一首' }], currentTrackIndex: 0 }),
  });
  const settings = TwitchRequestSettings.getDefaults();
  settings.customCommands = [{
    id: 'queue_info', enabled: true, command: '!資訊', aliases: [], permissionLevel: 'everyone',
    userCooldownSeconds: 0, globalCooldownSeconds: 0,
    template: '{user}：{currentTitle}，下一首 {nextTitle}，待確認 {requestCount}。',
  }];
  service.setRequestSettings(settings);
  service.sendChatReply = async (_event, text) => { chat.push(text); };
  await service.handleChatMessage({
    chatter_user_id: 'viewer-1', chatter_user_name: 'viewer', badges: [],
    message: { text: '!資訊' },
  });
  eq(dispatches, 0);
  eq(service.pendingRequests.size, 0);
  ok(chat[0].includes('目前歌曲'));
  ok(chat[0].includes('下一首'));
  service.stop();
});

testAsync('T6 點歌歷史以安全欄位保存完整結果，並清除過期資料', async () => {
  const saved = [];
  const staleAt = Date.now() - 91 * 24 * 60 * 60 * 1000;
  const historyStore = {
    load: () => [{
      id: 'stale-entry', source: 'chat', requester: { id: 'old', name: 'old' },
      video: { id: 'dQw4w9WgXcQ', title: 'old', artist: '', url: 'https://youtu.be/dQw4w9WgXcQ' },
      createdAt: staleAt, updatedAt: staleAt, result: 'failed', reason: '', reward: { status: 'not-applicable', cost: 0 },
    }],
    save: (entries) => { saved.splice(0, saved.length, ...cloneJson(entries)); return true; },
  };
  const service = new TwitchService({
    config: { twitchClientId: '' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => true,
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
    sessionStore: { load: () => null, save: () => true }, historyStore,
    authStore: { load: () => null, save: () => true, clear: () => true },
  });
  service.fetchYouTubeMetadata = async () => ({ title: '測試歌曲', author: '測試歌手', duration: 180, assessment: { warningTypes: [] } });
  service.sendConfiguredReply = async () => ({ sent: true });
  const event = { chatter_user_id: 'viewer-1', chatter_user_name: 'viewer', badges: [] };
  await service.handleSongRequestInput({
    event, requestId: 'history-request', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=private',
    command: '!點歌', source: 'chat',
  });
  const pending = service.getPendingRequests()[0];
  eq(service.getRequestHistory(10).length, 1);
  eq(service.getRequestHistory(10)[0].result, 'pending');
  eq(service.getRequestHistory(10)[0].video.url, 'https://youtu.be/dQw4w9WgXcQ');
  ok(!JSON.stringify(service.getRequestHistory(10)).includes('private'));
  await service.completeSongRequest({ requestId: pending.requestId, success: true, title: '測試歌曲', artist: '測試歌手' });
  const entry = service.getRequestHistory(10)[0];
  eq(entry.result, 'imported');
  eq(entry.requester.name, 'viewer');
  ok(saved.length === 1);
  service.stop();
});

test('T6 本機點歌規則模擬不建立待確認點歌、不下載也不送聊天室訊息', () => {
  let dispatches = 0;
  const service = new TwitchService({
    config: { twitchClientId: '' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => { dispatches += 1; return true; },
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
    sessionStore: { load: () => null, save: () => true }, historyStore: { load: () => [], save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => true },
  });
  const result = service.simulateSongRequest({
    viewerRole: 'viewer', user: '模擬觀眾', url: 'https://youtu.be/dQw4w9WgXcQ',
    title: '模擬歌曲', artist: '模擬歌手', durationSeconds: 180, streamOnline: true,
  });
  eq(result.accepted, true);
  eq(service.pendingRequests.size, 0);
  eq(dispatches, 0);
  eq(service.getRequestHistory(10).length, 0);
  eq(service.simulateSongRequest({ viewerRole: 'viewer', url: 'not-a-url' }).accepted, false);
  service.stop();
});

test('T6 管理視窗包含安全自訂指令、規則模擬、歷史與控制端 socket 守衛', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public', 'js', 'app-twitch.js'), 'utf8');
  const handler = fs.readFileSync(path.join(root, 'server', 'routes', 'handlers', 'twitch.js'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'server', 'services', 'twitch-service.js'), 'utf8');
  for (const token of ['twitch-custom-list', 'twitch-custom-duplicate', 'twitch-sim-run', 'twitch-history-list', 'twitch-custom-public-test']) {
    ok(html.includes(token), '缺少 T6 管理介面：' + token);
  }
  ok(app.includes('function duplicateCustomCommand()'));
  ok(app.includes("SocketClient.on('twitch:history', applyHistory)"));
  ok(handler.includes("socket.on('twitch:simulate'") && handler.includes("socket.on('twitch:history:get'"));
  ok(service.includes('HISTORY_MAX_ENTRIES = 5000') && service.includes('HISTORY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000'));
  ok(service.includes('simulateSongRequest') && service.includes('handleCustomCommand'));
});

test('Twitch 黑名單契約正規化四種規則、到期時間與管理員豁免', () => {
  const settings = TwitchRequestSettings.getDefaults();
  settings.blacklist = [
    { id: 'user_rule', enabled: true, type: 'user', value: '@ViewerOne', reason: '惡意點歌', expiresAt: null, moderatorExempt: true },
    { id: 'video_rule', enabled: true, type: 'video', value: 'https://youtu.be/dQw4w9WgXcQ', reason: '', expiresAt: null, moderatorExempt: false },
    { id: 'channel_rule', enabled: true, type: 'channel', value: 'UC_TEST_CHANNEL', reason: '', expiresAt: Date.now() + 60000, moderatorExempt: true },
    { id: 'title_rule', enabled: true, type: 'title', value: 'Rick Roll', reason: '', expiresAt: Date.now() - 1000, moderatorExempt: true },
  ];
  const validation = TwitchRequestSettings.validateSettings(settings);
  eq(validation.ok, true);
  eq(validation.settings.blacklist[0].value, 'viewerone');
  eq(validation.settings.blacklist[1].value, 'dQw4w9WgXcQ');
  eq(TwitchRequestSettings.findBlacklistMatch(validation.settings, { event: { chatter_user_login: 'VIEWERONE' }, phase: 'pre' }).id, 'user_rule');
  eq(TwitchRequestSettings.findBlacklistMatch(validation.settings, { event: { chatter_user_login: 'viewerone', badges: [{ set_id: 'moderator' }] }, phase: 'pre' }), null);
  eq(TwitchRequestSettings.findBlacklistMatch(validation.settings, { videoId: 'dQw4w9WgXcQ', phase: 'pre' }).id, 'video_rule');
  eq(TwitchRequestSettings.findBlacklistMatch(validation.settings, { metadata: { title: '任意歌曲', channelId: 'UC_TEST_CHANNEL' }, phase: 'post' }).id, 'channel_rule');
  eq(TwitchRequestSettings.findBlacklistMatch(validation.settings, { metadata: { title: 'Rick Roll 官方 MV' }, phase: 'post' }), null);
  const invalid = TwitchRequestSettings.clone(settings);
  invalid.blacklist[1].value = '不是影片';
  eq(TwitchRequestSettings.validateSettings(invalid).ok, false);
});

testAsync('Twitch 黑名單在 metadata 前後各擋一次，忠誠點數先退款才回覆', async () => {
  const events = [];
  const service = new TwitchService({
    config: { twitchClientId: '' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => { events.push('accepted'); return true; },
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => true },
  });
  const rule = (id, type, value, reason = '') => ({ id, enabled: true, type, value, reason, expiresAt: null, moderatorExempt: true });
  const settings = TwitchRequestSettings.getDefaults();
  settings.blacklist = [rule('blocked_user', 'user', 'viewer-1', '使用者已封鎖')];
  service.setRequestSettings(settings);
  let metadataCalls = 0;
  service.fetchYouTubeMetadata = async () => { metadataCalls += 1; return { title: '測試歌曲', author: '封鎖頻道', channelId: 'UC_BLOCKED', duration: 180, assessment: {} }; };
  service.updateRewardRedemptionStatus = async (_redemption, status) => { events.push(`refund:${status}`); };
  service.sendConfiguredReply = async (_event, key, values = {}) => { events.push(`reply:${key}:${values.reason || ''}`); return { sent: true }; };
  const event = { chatter_user_id: 'viewer-1', chatter_user_name: 'viewer' };
  const redemption = { id: 'redeem-blocked', rewardId: 'reward-1', cost: 1000 };
  eq(await service.handleSongRequestInput({ event, requestId: 'blocked-pre', url: 'https://youtu.be/dQw4w9WgXcQ', command: '!點歌', source: 'channel-points', redemption }), false);
  eq(metadataCalls, 0);
  eq(events[0], 'refund:CANCELED');
  ok(events[1].startsWith('reply:rewardRefunded:'));
  eq(service.pendingRequests.size, 0);

  const postSettings = TwitchRequestSettings.getDefaults();
  postSettings.blacklist = [rule('blocked_channel', 'channel', 'UC_BLOCKED', '頻道已封鎖'), rule('blocked_title', 'title', '禁止關鍵字')];
  service.setRequestSettings(postSettings);
  events.length = 0;
  eq(await service.handleSongRequestInput({ event: { chatter_user_id: 'viewer-2' }, requestId: 'blocked-post', url: 'https://youtu.be/9bZkp7q19f0', command: '!點歌', source: 'chat' }), false);
  eq(metadataCalls, 1);
  ok(events[0].startsWith('reply:blockedRequest:頻道已封鎖'));
  eq(service.pendingRequests.size, 0);
  service.stop();
});

test('Twitch EventSub 重連採指數退避並有上限', () => {
  eq(reconnectDelay(1, () => 0.5), 3000);
  eq(reconnectDelay(2, () => 0.5), 6000);
  eq(reconnectDelay(10, () => 0.5), 60000);
});

test('Twitch EventSub welcome watchdog closes a stalled socket and returns to retry', () => {
  const timers = [];
  const fakeTimers = {
    setTimeout(fn, delay) { const timer = { fn, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
  };
  const sockets = [];
  const originalWebSocket = globalThis.WebSocket;
  class FakeWebSocket {
    constructor() { this.handlers = {}; this.closed = false; sockets.push(this); }
    on(event, handler) { this.handlers[event] = handler; }
    close() { this.closed = true; this.handlers.close?.(); }
  }
  globalThis.WebSocket = FakeWebSocket;
  try {
    const retries = [];
    const service = new TwitchService({
      config: { twitchClientId: 'fixture' },
      onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => true,
      onSongRequestExpired: () => {},
      pendingStore: { load: () => [], save: () => true },
      sessionStore: { load: () => null, save: () => true },
      historyStore: { load: () => [], save: () => true },
      authStore: { load: () => null, save: () => true, clear: () => true },
      timers: fakeTimers,
    });
    service.auth = { accessToken: 'token', userId: 'user', refreshToken: 'refresh', scopes: [] };
    service.scheduleReconnect = (reason) => retries.push(reason);
    service.connectEventSub();
    eq(sockets.length, 1);
    eq(timers.length, 1);
    eq(timers[0].delay, CONNECT_WATCHDOG_MS);
    timers[0].fn();
    ok(sockets[0].closed, '逾時連線必須主動關閉');
    eq(service.ws, null);
    ok(retries[0].includes('逾時'), '逾時後必須走既有退避重連');
    service.stop();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

testAsync('Twitch EventSub keepalive watchdog and revocation never leave a false connected state', async () => {
  const timers = [];
  const fakeTimers = {
    setTimeout(fn, delay) { const timer = { fn, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
  };
  let cleared = 0;
  const socket = { closed: false, close() { this.closed = true; } };
  const retries = [];
  const service = new TwitchService({
    config: { twitchClientId: 'fixture' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => true,
    onSongRequestExpired: () => {},
    pendingStore: { load: () => [], save: () => true },
    sessionStore: { load: () => null, save: () => true },
    historyStore: { load: () => [], save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => { cleared += 1; return true; } },
    timers: fakeTimers,
  });
  service.auth = { accessToken: 'token', userId: 'user', refreshToken: 'refresh', scopes: [] };
  service.ws = socket;
  service.createSubscription = async () => {};
  service.refreshLiveState = async () => {};
  service.scheduleReconnect = (reason) => retries.push(reason);
  await service.handleWebSocketMessage(JSON.stringify({
    metadata: { message_type: 'session_welcome' },
    payload: { session: { id: 'session-1', keepalive_timeout_seconds: 30 } },
  }), socket);
  eq(timers.at(-1).delay, 35000);
  timers.at(-1).fn();
  eq(service.ws, null);
  ok(socket.closed, 'keepalive 逾時必須主動關閉 stale socket');
  ok(retries.at(-1).includes('keepalive'));

  const revokedSocket = { closed: false, close() { this.closed = true; } };
  service.ws = revokedSocket;
  service.wsSessionId = 'session-2';
  service.auth = { accessToken: 'token', userId: 'user', refreshToken: 'refresh', scopes: [] };
  await service.handleWebSocketMessage(JSON.stringify({
    metadata: { message_type: 'revocation' },
    payload: { subscription: { status: 'authorization_revoked' } },
  }), revokedSocket);
  eq(service.auth, null);
  eq(cleared, 1);
  eq(service.connectionState, 'authorization_required');
  ok(revokedSocket.closed, '撤銷後必須主動關閉舊 socket');
  service.stop();
});

test('Twitch status observation reports a safe lifecycle without changing a disabled service', () => {
  const statuses = [];
  const service = new TwitchService({
    config: { twitchClientId: '', twitchRequestCommand: '!song' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => true,
    onSongRequestExpired: () => {},
    onStatusChange: (status) => statuses.push(status),
    pendingStore: { load: () => [], save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => true },
  });

  service.start();
  eq(statuses.at(-1).connectionState, 'disabled');
  ok(!Object.prototype.hasOwnProperty.call(statuses.at(-1), 'accessToken'));
  service.stop();
  eq(statuses.at(-1).connectionState, 'stopped');
});

test('Twitch 待確認點歌可跨 service 重啟還原', () => {
  let saved = [];
  const pendingStore = {
    load: () => JSON.parse(JSON.stringify(saved)),
    save: (value) => { saved = JSON.parse(JSON.stringify(value)); return true; },
  };
  const options = {
    config: { twitchClientId: '', twitchRequestCommand: '!點歌' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => true,
    onSongRequestExpired: () => {}, pendingStore,
  };
  const first = new TwitchService(options);
  const createdAt = Date.now();
  first.pendingRequests.set('persist-1', {
    requestId: 'persist-1', url: 'https://youtu.be/dQw4w9WgXcQ', requester: 'viewer',
    title: 'fixture', author: 'channel', thumbnail: '', metadataAvailable: true,
    videoId: 'dQw4w9WgXcQ', duration: 212, durationWarning: false,
    event: { chatter_user_name: 'viewer', message_id: 'chat-parent-1', ignored: '不應保存' },
    retryableReplySent: true,
    createdAt, expiresAt: createdAt + 60000,
  });
  first.persistPendingRequests();
  first.stop();
  eq(saved.length, 1);
  eq(saved[0].event.chatter_user_name, 'viewer');
  eq(saved[0].event.message_id, 'chat-parent-1');
  eq(saved[0].retryableReplySent, true);
  ok(!Object.prototype.hasOwnProperty.call(saved[0].event, 'ignored'));

  const second = new TwitchService(options);
  eq(second.getPendingRequests().length, 1);
  eq(second.status().pendingRequestCount, 1);
  second.stop();
});

testAsync('Twitch 點歌會套用自訂指令、總開關與聊天室徽章權限', async () => {
  const accepted = [];
  const replies = [];
  const service = new TwitchService({
    config: { twitchClientId: '' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: (request) => { accepted.push(request); return true; },
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => true },
  });
  service.setRequestSettings({
    ...TwitchRequestSettings.getDefaults(), command: '!唱歌', aliases: ['!song'], permissionLevel: 'subscriber',
  });
  service.sendConfiguredReply = async (_event, key, values) => { replies.push({ key, values }); return { sent: true }; };
  service.fetchYouTubeMetadata = async () => ({
    title: '測試歌曲', author: '測試頻道', thumbnail: '', metadataAvailable: true, duration: 180, assessment: { warningTypes: [] },
  });
  await service.handleChatMessage({
    message_id: 'denied', chatter_user_id: 'viewer-1', chatter_user_name: 'viewer', badges: [],
    message: { text: '!song https://youtu.be/dQw4w9WgXcQ' },
  });
  eq(replies.at(-1).key, 'permissionDenied');
  eq(accepted.length, 0);

  await service.handleChatMessage({
    message_id: 'accepted', chatter_user_id: 'sub-1', chatter_user_name: 'subscriber', badges: [{ set_id: 'subscriber' }],
    message: { text: '!SONG https://youtu.be/dQw4w9WgXcQ' },
  });
  eq(replies.at(-1).key, 'received');
  eq(accepted.length, 1);
  eq(accepted[0].requesterId, 'sub-1');

  service.setRequestSettings({ ...TwitchRequestSettings.getDefaults(), enabled: false, command: '!唱歌' });
  await service.handleChatMessage({ message_id: 'paused', message: { text: '!唱歌 https://youtu.be/9bZkp7q19f0' } });
  eq(replies.at(-1).key, 'requestDisabled');
  eq(accepted.length, 1);
  service.stop();
});

testAsync('Twitch 點歌會執行冷卻、每人上限、重複與歌曲長度規則', async () => {
  const accepted = [];
  const replies = [];
  const service = new TwitchService({
    config: { twitchClientId: '' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: (request) => { accepted.push(request); return true; },
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => true },
  });
  service.sendConfiguredReply = async (_event, key, values) => { replies.push({ key, values }); return { sent: true }; };
  service.fetchYouTubeMetadata = async (url) => ({
    title: '測試歌曲', author: '測試頻道', thumbnail: '', metadataAvailable: true,
    duration: url.includes('longvideo01') ? 181 : 180, assessment: { warningTypes: [] },
  });
  service.setRequestSettings({ ...TwitchRequestSettings.getDefaults(), cooldownSeconds: 60 });
  await service.handleChatMessage({ message_id: 'cool-1', chatter_user_id: 'same-user', message: { text: '!點歌 https://youtu.be/dQw4w9WgXcQ' } });
  await service.handleChatMessage({ message_id: 'cool-2', chatter_user_id: 'same-user', message: { text: '!點歌 https://youtu.be/9bZkp7q19f0' } });
  eq(replies.at(-1).key, 'cooldownActive');
  ok(replies.at(-1).values.seconds > 0);

  service.setRequestSettings({ ...TwitchRequestSettings.getDefaults(), perUserPending: 1 });
  await service.handleChatMessage({ message_id: 'limit-1', chatter_user_id: 'same-user', message: { text: '!點歌 https://youtu.be/3JZ_D3ELwOQ' } });
  eq(replies.at(-1).key, 'userLimitReached');
  eq(replies.at(-1).values.limit, 1);

  service.setRequestSettings({ ...TwitchRequestSettings.getDefaults(), duplicateScope: 'allow' });
  await service.handleChatMessage({ message_id: 'duplicate-ok', chatter_user_id: 'other-user', message: { text: '!點歌 https://youtu.be/dQw4w9WgXcQ' } });
  eq(replies.at(-1).key, 'received');
  eq(accepted.length, 2);

  service.setRequestSettings({ ...TwitchRequestSettings.getDefaults(), maxDurationMinutes: 3 });
  await service.handleChatMessage({ message_id: 'too-long', chatter_user_id: 'third-user', message: { text: '!點歌 https://youtu.be/longvideo01' } });
  eq(replies.at(-1).key, 'durationExceeded');
  eq(replies.at(-1).values.duration, '3:01');
  eq(accepted.length, 2);
  service.stop();
});

test('Twitch 重複歌曲範圍涵蓋待確認、播放清單、本場、最近與完全允許', () => {
  let savedSession = {
    online: true,
    session: { startedAt: Date.now(), acceptedCount: 1, byUser: {}, lastRequesterId: '', lastRequesterName: '' },
    recent: [{ videoId: 'recent00001', requesterId: 'viewer', requesterName: 'viewer', acceptedAt: Date.now(), sessionStartedAt: Date.now() }],
  };
  const service = new TwitchService({
    config: { twitchClientId: '' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => true,
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
    sessionStore: { load: () => cloneJson(savedSession), save: (value) => { savedSession = cloneJson(value); return true; } },
    authStore: { load: () => null, save: () => true, clear: () => true },
    getPlaybackSnapshot: () => ({
      playlist: [{ id: 'playlist001', title: '正式清單' }],
      session: { songs: [{ id: 'session0001', title: '本場已唱' }] },
    }),
  });
  service.pendingRequests.set('pending', { videoId: 'pending0001' });
  const rules = TwitchRequestSettings.getDefaults();
  service.setRequestSettings({ ...rules, duplicateScope: 'pending' });
  eq(service.duplicateScopeMatch('pending0001'), '待確認區');
  eq(service.duplicateScopeMatch('playlist001'), null);
  service.setRequestSettings({ ...rules, duplicateScope: 'playlist' });
  eq(service.duplicateScopeMatch('playlist001'), '正式播放清單');
  service.setRequestSettings({ ...rules, duplicateScope: 'session' });
  eq(service.duplicateScopeMatch('session0001'), '本場已唱');
  service.setRequestSettings({ ...rules, duplicateScope: 'recent', recentDuplicateHours: 24 });
  eq(service.duplicateScopeMatch('recent00001'), '最近 24 小時');
  service.setRequestSettings({ ...rules, duplicateScope: 'allow' });
  eq(service.duplicateScopeMatch('pending0001'), null);
  service.stop();
});

testAsync('Twitch 直播場次上限會跨重啟保存，管理員可豁免公平性限制', async () => {
  let savedSession = null;
  const sessionStore = {
    load: () => savedSession ? cloneJson(savedSession) : { online: false, session: { startedAt: null, acceptedCount: 0, byUser: {}, lastRequesterId: '', lastRequesterName: '' }, recent: [] },
    save: (value) => { savedSession = cloneJson(value); return true; },
  };
  const accepted = [];
  const replies = [];
  const options = {
    config: { twitchClientId: '' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: (request) => { accepted.push(request.videoId); return true; },
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true }, sessionStore,
    authStore: { load: () => null, save: () => true, clear: () => true },
  };
  const service = new TwitchService(options);
  service.setRequestSettings({
    ...TwitchRequestSettings.getDefaults(), duplicateScope: 'allow', liveOnly: true,
    perUserSessionLimit: 1, sessionRequestLimit: 2, fairnessModeratorExempt: true,
  });
  service.fetchYouTubeMetadata = async () => ({ title: '測試歌曲', author: '頻道', thumbnail: '', metadataAvailable: true, duration: 180, assessment: { warningTypes: [] } });
  service.sendConfiguredReply = async (_event, key, values = {}) => { replies.push({ key, values }); return { sent: true }; };
  const request = (id, user, badges = []) => service.handleSongRequestInput({
    event: { chatter_user_id: user, chatter_user_name: user, badges }, requestId: id,
    url: `https://youtu.be/${id.padEnd(11, '0').slice(0, 11)}`, command: '!點歌', source: 'chat',
  });
  eq(await request('offline', 'viewer-a'), false);
  eq(replies.at(-1).key, 'streamOffline');
  eq(await request('mod-offline', 'moderator', [{ set_id: 'moderator' }]), true);
  service.startRequestSession(1700000000000);
  eq(await request('first', 'viewer-a'), true);
  eq(await request('second', 'viewer-a'), false);
  eq(replies.at(-1).key, 'sessionUserLimit');
  eq(await request('third', 'viewer-b'), true);
  eq(await request('fourth', 'viewer-c'), false);
  eq(replies.at(-1).key, 'sessionLimit');
  eq(await request('mod-limit', 'moderator', [{ set_id: 'moderator' }]), true);
  eq(service.status().requestSession.acceptedCount, 3);
  service.stop();

  const restored = new TwitchService(options);
  eq(restored.status().streamOnline, true);
  eq(restored.status().requestSession.acceptedCount, 3);
  eq(restored.requestSession.session.byUser['viewer-a'], 1);
  restored.stop();
});

testAsync('Twitch 同一人連續點歌只提醒，不會改動收到順序', async () => {
  const accepted = [];
  const replies = [];
  const service = new TwitchService({
    config: { twitchClientId: '' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: (request) => { accepted.push(request.videoId); return true; },
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
    sessionStore: { load: () => null, save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => true },
  });
  service.setRequestSettings({ ...TwitchRequestSettings.getDefaults(), duplicateScope: 'allow', warnConsecutiveRequests: true });
  service.fetchYouTubeMetadata = async () => ({ title: '測試歌曲', author: '頻道', thumbnail: '', metadataAvailable: true, duration: 180, assessment: { warningTypes: [] } });
  service.sendConfiguredReply = async (_event, key) => { replies.push(key); return { sent: true }; };
  const event = { chatter_user_id: 'same-viewer', chatter_user_name: '同一位觀眾' };
  await service.handleSongRequestInput({ event, requestId: 'first', url: 'https://youtu.be/dQw4w9WgXcQ', command: '!點歌', source: 'chat' });
  await service.handleSongRequestInput({ event, requestId: 'second', url: 'https://youtu.be/9bZkp7q19f0', command: '!點歌', source: 'chat' });
  eq(accepted.join(','), 'dQw4w9WgXcQ,9bZkp7q19f0');
  eq(replies.join(','), 'received,received,consecutiveRequesterWarning');
  service.stop();
});

testAsync('Twitch 全域點歌冷卻會擋一般觀眾，但不擋已設定豁免的管理員', async () => {
  const accepted = [];
  const replies = [];
  const service = new TwitchService({
    config: { twitchClientId: '' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: (request) => { accepted.push(request.videoId); return true; },
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
    sessionStore: { load: () => null, save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => true },
  });
  const settings = TwitchRequestSettings.getDefaults();
  settings.duplicateScope = 'allow';
  settings.commands.request.globalCooldownSeconds = 60;
  service.setRequestSettings(settings);
  service.fetchYouTubeMetadata = async () => ({ title: '測試歌曲', author: '頻道', thumbnail: '', metadataAvailable: true, duration: 180, assessment: { warningTypes: [] } });
  service.sendConfiguredReply = async (_event, key) => { replies.push(key); return { sent: true }; };
  await service.handleChatMessage({ message_id: 'first', chatter_user_id: 'viewer-a', badges: [], message: { text: '!點歌 https://youtu.be/dQw4w9WgXcQ' } });
  await service.handleChatMessage({ message_id: 'blocked', chatter_user_id: 'viewer-b', badges: [], message: { text: '!點歌 https://youtu.be/9bZkp7q19f0' } });
  await service.handleChatMessage({ message_id: 'moderator', chatter_user_id: 'mod-1', badges: [{ set_id: 'moderator' }], message: { text: '!點歌 https://youtu.be/3JZ_D3ELwOQ' } });
  eq(replies.join(','), 'received,cooldownActive,received');
  eq(accepted.join(','), 'dQw4w9WgXcQ,3JZ_D3ELwOQ');
  service.stop();
});

testAsync('Twitch 自助指令只查詢目前狀態，不會觸發匯入或暴露本機網址', async () => {
  // CI 註冊同步測試可能超過一分鐘；等註冊結束才建立有期限的點歌 fixture。
  await new Promise((resolve) => setImmediate(resolve));
  const accepted = [];
  const replies = [];
  const now = Date.now();
  const service = new TwitchService({
    config: { twitchClientId: '' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: (request) => { accepted.push(request); return true; },
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => true },
    getPlaybackSnapshot: () => ({
      currentTrack: { id: 'track-1', title: '現在唱', artist: '歌手甲' },
      playlist: [
        { id: 'track-1', title: '現在唱', artist: '歌手甲' },
        { id: 'track-2', title: '下一首', artist: '歌手乙' },
      ],
    }),
  });
  service.sendConfiguredReply = async (_event, key, values = {}) => { replies.push({ key, values }); return { sent: true }; };
  service.pendingRequests.set('own-1', {
    requestId: 'own-1', requesterId: 'viewer-1', requester: 'viewer', title: '待確認甲', author: '頻道甲',
    createdAt: now - 2000, expiresAt: now + 60000, event: {},
  });
  service.pendingRequests.set('other-1', {
    requestId: 'other-1', requesterId: 'viewer-2', requester: 'other', title: '待確認乙', author: '頻道乙',
    createdAt: now - 1000, expiresAt: now + 60000, event: {},
  });
  const event = (id, command) => ({ message_id: id, chatter_user_id: 'viewer-1', chatter_user_name: 'viewer', message: { text: command } });

  await service.handleChatMessage(event('self-current', '!目前歌曲'));
  eq(replies.at(-1).key, 'currentSong');
  eq(replies.at(-1).values.currentTitle, '現在唱');
  await service.handleChatMessage(event('self-next', '!下一首'));
  eq(replies.at(-1).key, 'nextSong');
  eq(replies.at(-1).values.nextTitle, '下一首');
  await service.handleChatMessage(event('self-own', '!我的點歌'));
  eq(replies.at(-1).key, 'myRequests');
  eq(replies.at(-1).values.requestCount, 1);
  await service.handleChatMessage(event('self-position', '!順位'));
  eq(replies.at(-1).key, 'requestPosition');
  eq(replies.at(-1).values.position, 1);
  await service.handleChatMessage(event('self-rules', '!點歌規則'));
  eq(replies.at(-1).key, 'requestRules');
  ok(replies.at(-1).values.reason.includes('目前開放'));
  await service.handleChatMessage(event('self-queue', '!歌單'));
  eq(replies.at(-1).key, 'queueSummary');
  eq(replies.at(-1).values.queue, 1);
  ok(!JSON.stringify(replies.at(-1)).includes('127.0.0.1'));
  ok(!JSON.stringify(replies.at(-1)).includes('localhost'));
  const disabledSettings = TwitchRequestSettings.getDefaults();
  disabledSettings.commands.currentSong.enabled = false;
  service.setRequestSettings(disabledSettings);
  const replyCountBeforeDisabled = replies.length;
  await service.handleChatMessage(event('self-current-disabled', '!目前歌曲'));
  eq(replies.length, replyCountBeforeDisabled);
  eq(accepted.length, 0);
  service.stop();
});

testAsync('Twitch 各指令有獨立的每人與全域冷卻', async () => {
  const replies = [];
  const service = new TwitchService({
    config: { twitchClientId: '' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => true,
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => true },
    getPlaybackSnapshot: () => ({ currentTrack: { id: 'track-1', title: '現在唱', artist: '歌手甲' }, playlist: [] }),
  });
  const settings = TwitchRequestSettings.getDefaults();
  settings.commands.currentSong.userCooldownSeconds = 0;
  settings.commands.currentSong.globalCooldownSeconds = 30;
  service.setRequestSettings(settings);
  service.sendConfiguredReply = async (_event, key, values = {}) => { replies.push({ key, values }); return { sent: true }; };

  await service.handleChatMessage({ message_id: 'global-1', chatter_user_id: 'viewer-1', message: { text: '!目前歌曲' } });
  eq(replies.at(-1).key, 'currentSong');
  await service.handleChatMessage({ message_id: 'global-2', chatter_user_id: 'viewer-2', message: { text: '!目前歌曲' } });
  eq(replies.at(-1).key, 'cooldownActive');
  ok(replies.at(-1).values.seconds > 0);
  await service.handleChatMessage({ message_id: 'next-independent', chatter_user_id: 'viewer-2', message: { text: '!下一首' } });
  eq(replies.at(-1).key, 'noNextSong');
  service.stop();
});

testAsync('Twitch 取消點歌只移除本人最新待確認項目，忠誠點數須退款成功才移除', async () => {
  // 保留真實的到期判斷，避免 fixture 在同步測試註冊期間就已過期。
  await new Promise((resolve) => setImmediate(resolve));
  const canceled = [];
  const replies = [];
  const now = Date.now();
  const service = new TwitchService({
    config: { twitchClientId: '' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => true,
    onSongRequestCanceled: (requestId) => canceled.push(requestId),
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => true },
  });
  service.sendConfiguredReply = async (_event, key, values = {}) => { replies.push({ key, values }); return { sent: true }; };
  const own = (requestId, createdAt, extra = {}) => ({
    requestId, requesterId: 'viewer-1', requester: 'viewer', title: requestId, author: '測試頻道',
    createdAt, expiresAt: now + 60000, event: {}, ...extra,
  });
  service.pendingRequests.set('own-old', own('own-old', now - 3000));
  service.pendingRequests.set('own-new', own('own-new', now - 2000));
  service.pendingRequests.set('other', { ...own('other', now - 1000), requesterId: 'viewer-2' });
  const event = { chatter_user_id: 'viewer-1', chatter_user_name: 'viewer', message: { text: '!取消點歌' } };

  await service.cancelLatestPendingRequest(event);
  ok(service.pendingRequests.has('own-old'));
  ok(!service.pendingRequests.has('own-new'));
  ok(service.pendingRequests.has('other'));
  eq(canceled.at(-1), 'own-new');
  eq(replies.at(-1).key, 'requestCanceled');

  const reward = own('reward-own', now, { rewardRedemption: { id: 'redeem-1', rewardId: 'reward-1', cost: 1200 } });
  service.pendingRequests.set(reward.requestId, reward);
  service.updateRewardRedemptionStatus = async () => { throw new Error('Twitch unavailable'); };
  await service.cancelLatestPendingRequest(event);
  ok(service.pendingRequests.has(reward.requestId));
  eq(replies.at(-1).key, 'requestCancelFailed');

  service.updateRewardRedemptionStatus = async (_redemption, status) => eq(status, 'CANCELED');
  await service.cancelLatestPendingRequest(event);
  ok(!service.pendingRequests.has(reward.requestId));
  eq(canceled.at(-1), reward.requestId);
  eq(replies.at(-1).key, 'rewardRefunded');
  service.stop();
});

testAsync('Twitch 忠誠點數設定會同步原生限制、暫停狀態並採用 Twitch 實際回傳值', async () => {
  const service = new TwitchService({
    config: { twitchClientId: 'fixture-client' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => true,
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => true },
  });
  service.auth = {
    accessToken: 'fixture', refreshToken: 'fixture', expiresAt: Date.now() + 600000,
    userId: 'broadcaster-1', scopes: ['user:read:chat', 'user:write:chat', 'channel:manage:redemptions'],
  };
  service.ensureToken = async () => true;
  const calls = [];
  service.helix = async (requestPath, options) => {
    calls.push({ requestPath, options });
    const body = options.body;
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{
        id: 'reward-managed-1',
        title: body.title,
        prompt: body.prompt,
        cost: body.cost,
        is_enabled: body.is_enabled,
        is_paused: body.is_paused ?? false,
        is_in_stock: true,
        redemptions_redeemed_current_stream: 2,
        cooldown_expires_at: null,
        max_per_stream_setting: { is_enabled: body.is_max_per_stream_enabled, max_per_stream: body.max_per_stream || 0 },
        max_per_user_per_stream_setting: { is_enabled: body.is_max_per_user_per_stream_enabled, max_per_user_per_stream: body.max_per_user_per_stream || 0 },
        global_cooldown_setting: { is_enabled: body.is_global_cooldown_enabled, global_cooldown_seconds: body.global_cooldown_seconds || 0 },
      }] }),
    };
  };
  const created = await service.syncManagedReward({
    ...TwitchRewardSettings.getDefaults(), enabled: true, title: '點一首歌', cost: 2500,
    maxPerStream: 20, maxPerUserPerStream: 2, globalCooldownSeconds: 90,
  });
  eq(created.rewardId, 'reward-managed-1');
  eq(calls[0].options.method, 'POST');
  eq(calls[0].options.body.is_user_input_required, true);
  eq(calls[0].options.body.should_redemptions_skip_request_queue, false);
  eq(calls[0].options.body.is_max_per_stream_enabled, true);
  eq(calls[0].options.body.max_per_stream, 20);
  eq(calls[0].options.body.max_per_user_per_stream, 2);
  eq(calls[0].options.body.global_cooldown_seconds, 90);
  eq(Object.prototype.hasOwnProperty.call(calls[0].options.body, 'is_paused'), false);
  eq(created.maxPerStream, 20);
  eq(service.status().rewardSync.redemptionsRedeemedCurrentStream, 2);

  const paused = await service.syncManagedReward({ ...created, paused: true });
  eq(paused.paused, true);
  eq(calls[1].options.method, 'PATCH');
  eq(calls[1].options.body.is_paused, true);

  const disabled = await service.syncManagedReward({ ...paused, enabled: false, paused: false });
  eq(disabled.rewardId, 'reward-managed-1');
  eq(calls[2].options.method, 'PATCH');
  eq(calls[2].options.body.is_enabled, false);
  eq(calls[2].options.body.is_paused, false);
  service.stop();
});

testAsync('Twitch 忠誠點數同步失敗會保留上次已確認狀態與錯誤', async () => {
  const service = new TwitchService({
    config: { twitchClientId: 'fixture-client' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => true,
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => true },
  });
  service.auth = {
    accessToken: 'fixture', refreshToken: 'fixture', expiresAt: Date.now() + 600000,
    userId: 'broadcaster-1', scopes: ['channel:manage:redemptions'],
  };
  service.ensureToken = async () => true;
  const confirmed = { ...TwitchRewardSettings.getDefaults(), enabled: true, rewardId: 'reward-managed-1', cost: 1500, maxPerStream: 12 };
  service.setRewardSettings(confirmed);
  service.helix = async () => ({ ok: false, status: 500, json: async () => ({ message: 'temporary failure' }) });
  let failed = false;
  try { await service.syncManagedReward({ ...confirmed, cost: 9999, maxPerStream: 3 }); } catch (err) { failed = err.message === 'temporary failure'; }
  ok(failed);
  eq(service.status().reward.cost, 1500);
  eq(service.status().reward.maxPerStream, 12);
  eq(service.status().rewardSync.state, 'error');
  eq(service.status().rewardSync.error, 'temporary failure');
  service.stop();
});

testAsync('Twitch 忠誠點數兌換進入同一待確認流程，成功完成、規則拒絕退款且事件去重', async () => {
  const accepted = [];
  const replies = [];
  const statuses = [];
  const service = new TwitchService({
    config: { twitchClientId: 'fixture-client' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: (request) => { accepted.push(request); return true; },
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => true },
  });
  service.setRewardSettings({ ...TwitchRewardSettings.getDefaults(), enabled: true, rewardId: 'reward-managed-1', cost: 2500 });
  service.fetchYouTubeMetadata = async () => ({
    title: '測試歌曲', author: '測試頻道', thumbnail: '', metadataAvailable: true, duration: 180, assessment: { warningTypes: [] },
  });
  service.sendConfiguredReply = async (_event, key, values) => { replies.push({ key, values }); return { sent: true }; };
  service.updateRewardRedemptionStatus = async (redemption, status) => { statuses.push({ redemption, status }); };

  const redemption = {
    id: 'redeem-1', status: 'unfulfilled', user_id: 'viewer-1', user_name: 'viewer', user_login: 'viewer',
    user_input: 'https://youtu.be/dQw4w9WgXcQ', reward: { id: 'reward-managed-1', cost: 2500 },
  };
  await service.handleRewardRedemption(redemption, 'event-1');
  eq(accepted.length, 1);
  eq(accepted[0].source, 'channel-points');
  eq(accepted[0].rewardRedemption.id, 'redeem-1');
  eq(replies.at(-1).key, 'rewardReceived');
  ok(service.pendingRequests.has('reward:redeem-1'));
  await service.completeSongRequest({ requestId: 'reward:redeem-1', success: true, title: '測試歌曲', position: '歌單尾端' });
  eq(statuses.at(-1).status, 'FULFILLED');
  eq(replies.at(-1).key, 'rewardFulfilled');
  ok(!service.pendingRequests.has('reward:redeem-1'));

  const invalid = {
    id: 'redeem-2', status: 'unfulfilled', user_id: 'viewer-2', user_name: 'viewer2', user_login: 'viewer2',
    user_input: '不是連結', reward: { id: 'reward-managed-1', cost: 2500 },
  };
  await service.handleRewardRedemption(invalid, 'event-2');
  eq(statuses.at(-1).status, 'CANCELED');
  eq(replies.at(-1).key, 'rewardRefunded');
  eq(replies.at(-1).values.cost, 2500);
  const statusCount = statuses.length;
  await service.handleRewardRedemption(invalid, 'event-2-duplicate');
  eq(statuses.length, statusCount);
  service.setRewardSettings({ ...service.rewardSettings, paused: true });
  await service.handleRewardRedemption({ ...redemption, id: 'redeem-paused' }, 'event-paused');
  eq(accepted.length, 1);
  service.stop();
});

testAsync('Twitch EventSub 在新版授權下會訂閱忠誠點數兌換事件', async () => {
  const service = new TwitchService({
    config: { twitchClientId: 'fixture-client' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => true,
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => true },
  });
  service.auth = {
    accessToken: 'fixture', refreshToken: 'fixture', expiresAt: Date.now() + 600000,
    userId: 'broadcaster-1', scopes: ['user:read:chat', 'user:write:chat', 'channel:manage:redemptions'],
  };
  const subscriptions = [];
  service.createSubscription = async (type, condition) => subscriptions.push({ type, condition });
  service.refreshLiveState = async () => false;
  await service.handleWebSocketMessage(JSON.stringify({
    metadata: { message_type: 'session_welcome' },
    payload: { session: { id: 'session-1' } },
  }));
  eq(subscriptions.length, 6);
  const raidSubscription = subscriptions.find((item) => item.type === 'channel.raid');
  ok(raidSubscription, '要訂閱入站揪團');
  eq(raidSubscription.condition.to_broadcaster_user_id, 'broadcaster-1', '揪團是「到本頻道」的方向，不是 from');
  ok(subscriptions.some((item) => item.type === 'channel.channel_points_custom_reward_redemption.add'));
  ok(subscriptions.some((item) => item.type === 'channel.channel_points_custom_reward_redemption.update'));
  eq(service.status().rewardSubscriptionReady, true);
  service.stop();
});

testAsync('Twitch 忠誠點數逾時退款失敗會保留待確認，成功後才移除', async () => {
  const expired = [];
  const service = new TwitchService({
    config: { twitchClientId: 'fixture-client' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => true,
    onSongRequestExpired: (requestId) => expired.push(requestId),
    pendingStore: { load: () => [], save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => true },
  });
  const requestId = 'reward:redeem-expired';
  const request = {
    requestId, createdAt: Date.now() - 31 * 60 * 1000, expiresAt: Date.now() - 1000,
    title: '逾時歌曲', author: '測試頻道', url: 'https://youtu.be/dQw4w9WgXcQ', event: {},
    rewardRedemption: { id: 'redeem-expired', rewardId: 'reward-managed-1', cost: 1000 },
  };
  service.pendingRequests.set(requestId, request);
  service.updateRewardRedemptionStatus = async () => { throw new Error('temporary Twitch failure'); };
  let failed = false;
  try { await service.expireRequest(requestId, request); } catch (_) { failed = true; }
  ok(failed);
  ok(service.pendingRequests.has(requestId));
  ok(request.expiresAt > Date.now());
  service.clearRequestExpiry(requestId);

  service.updateRewardRedemptionStatus = async (_redemption, status) => eq(status, 'CANCELED');
  service.sendConfiguredReply = async (_event, key) => { eq(key, 'rewardRefunded'); return { sent: true }; };
  await service.expireRequest(requestId, request);
  ok(!service.pendingRequests.has(requestId));
  eq(expired[0], requestId);
  service.stop();
});

testAsync('Twitch 回覆總開關、分項開關與自訂變數會套到實際訊息', async () => {
  const service = new TwitchService({
    config: { twitchClientId: '', twitchRequestCommand: '!唱歌' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => true,
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => true },
  });
  const settings = TwitchReplySettings.getDefaults();
  settings.replyMode = 'plain';
  settings.replies.importSuccess.template = '{user} 的 {title} 已放到{position}，順位 {queue}';
  service.setReplySettings(settings);
  const sent = [];
  service.sendChatReply = async (event, text, options) => { sent.push({ event, text, options }); };
  await service.sendConfiguredReply({ chatter_user_name: 'viewer' }, 'importSuccess', {
    title: '測試歌曲', position: '歌單尾端', queue: 3,
  });
  eq(sent[0].text, 'viewer 的 測試歌曲 已放到歌單尾端，順位 3');
  eq(sent[0].options.mode, 'plain');

  settings.replies.importSuccess.enabled = false;
  service.setReplySettings(settings);
  await service.sendConfiguredReply({ chatter_user_name: 'viewer' }, 'importSuccess', { title: '不應送出' });
  eq(sent.length, 1);
  settings.replies.importSuccess.enabled = true;
  settings.enabled = false;
  service.setReplySettings(settings);
  await service.sendConfiguredReply({ chatter_user_name: 'viewer' }, 'importSuccess', { title: '仍不應送出' });
  eq(sent.length, 1);
  service.stop();
});

testAsync('Twitch 測試回覆使用目前文案與範例變數，但不受開關狀態阻擋', async () => {
  const service = new TwitchService({
    config: { twitchClientId: '', twitchRequestCommand: '!唱歌' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => true,
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => true },
  });
  const settings = TwitchReplySettings.getDefaults();
  settings.enabled = false;
  settings.replies.received.enabled = false;
  settings.replies.received.template = '{user} 測試 {command}：{title}';
  service.setRequestSettings({ ...TwitchRequestSettings.getDefaults(), command: '!唱歌' });
  let sent = null;
  service.sendChatReply = async (event, text, options) => { sent = { event, text, options }; };
  const result = await service.sendReplyTest(settings, 'received');
  eq(result.replyKey, 'received');
  eq(result.text, '【回覆測試】viewer123 測試 !唱歌：測試歌曲');
  eq(sent.text, result.text);
  eq(sent.options.mode, 'plain');
  service.stop();
});

testAsync('Twitch 原生串接回覆帶 parent message id，並識別 HTTP 200 但未送出的訊息', async () => {
  const service = new TwitchService({
    config: { twitchClientId: 'fixture', twitchRequestCommand: '!點歌' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => true,
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
  });
  service.auth = { accessToken: 'fixture', refreshToken: 'fixture', expiresAt: Date.now() + 600000, userId: '1' };
  service.ensureToken = async () => true;
  let sentBody = null;
  service.helix = async (_path, options) => {
    sentBody = options.body;
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: [{ is_sent: true }] }) };
  };
  await service.sendChatReply({ chatter_user_name: 'viewer', message_id: 'parent-123' }, '完成', { mode: 'reply' });
  eq(sentBody.reply_parent_message_id, 'parent-123');
  eq(sentBody.message, '完成');

  service.helix = async () => ({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ data: [{ is_sent: false, drop_reason: { message: 'Automod held' } }] }),
  });
  let threw = false;
  try { await service.sendChatReply({ chatter_user_name: 'viewer' }, '會被擋下', { mode: 'plain' }); } catch (err) {
    threw = true;
    ok(err.message.includes('Automod held'));
  }
  eq(threw, true);
  service.stop();
});

test('Twitch 回覆與點歌規則 socket 只接受 controller，並由 server 再驗證', () => {
  const registerTwitchHandlers = require('../server/routes/handlers/twitch');
  const handlers = {};
  const emitted = [];
  const socket = { clientType: 'controller', on: (event, handler) => { handlers[event] = handler; } };
  const service = {
    setReplySettings: (settings) => { service.settings = settings; },
    setRequestSettings: (settings) => { service.requestSettings = settings; },
  };
  const ctx = {
    playState: {
      twitchReplySettings: TwitchReplySettings.getDefaults(),
      twitchRequestSettings: TwitchRequestSettings.getDefaults(),
    },
    persistState: (callback) => callback({ ok: true }),
  };
  registerTwitchHandlers({ emit: (event, payload) => emitted.push({ event, payload }) }, socket, ctx, { getTwitchService: () => service });
  ok(typeof handlers['twitch:reply-settings:update'] === 'function');

  const invalid = TwitchReplySettings.getDefaults();
  invalid.replies.received.template = '收到 {titel}';
  let invalidAck = null;
  handlers['twitch:reply-settings:update'](invalid, (result) => { invalidAck = result; });
  eq(invalidAck.ok, false);
  ok(invalidAck.error.includes('{titel}'));

  const valid = TwitchReplySettings.getDefaults();
  valid.replies.received.template = '收到 {title}';
  let validAck = null;
  handlers['twitch:reply-settings:update'](valid, (result) => { validAck = result; });
  eq(validAck.ok, true);
  eq(ctx.playState.twitchReplySettings.replies.received.template, '收到 {title}');
  eq(service.settings.replies.received.template, '收到 {title}');
  eq(emitted.at(-1).event, 'twitch:reply-settings:update');

  ok(typeof handlers['twitch:request-settings:update'] === 'function');
  const invalidRequest = { ...TwitchRequestSettings.getDefaults(), command: '點歌' };
  let invalidRequestAck = null;
  handlers['twitch:request-settings:update'](invalidRequest, (result) => { invalidRequestAck = result; });
  eq(invalidRequestAck.ok, false);
  const validRequest = { ...TwitchRequestSettings.getDefaults(), command: '!唱歌', aliases: ['!song'], maxPending: 12 };
  let validRequestAck = null;
  handlers['twitch:request-settings:update'](validRequest, (result) => { validRequestAck = result; });
  eq(validRequestAck.ok, true);
  eq(ctx.playState.twitchRequestSettings.commands.request.command, '!唱歌');
  eq(service.requestSettings.maxPending, 12);
  eq(emitted.at(-1).event, 'twitch:request-settings:update');

  const remoteHandlers = {};
  registerTwitchHandlers({ emit: () => {} }, { clientType: 'remote', on: (event, handler) => { remoteHandlers[event] = handler; } }, ctx, { getTwitchService: () => service });
  ok(!remoteHandlers['twitch:reply-settings:update']);
  ok(!remoteHandlers['twitch:request-settings:update']);
  ok(!remoteHandlers['twitch:reward-settings:update']);
});

testAsync('Twitch 忠誠點數設定 socket 只接受 controller，server 同步獎勵後才持久化', async () => {
  const registerTwitchHandlers = require('../server/routes/handlers/twitch');
  const handlers = {};
  const emitted = [];
  const service = {
    syncManagedReward: async (settings) => ({ ...settings, rewardId: 'reward-managed-1' }),
    setRewardSettings: (settings) => { service.settings = settings; },
    status: () => ({ rewardAuthorized: true, rewardSubscriptionReady: true }),
  };
  const ctx = {
    playState: { twitchRewardSettings: TwitchRewardSettings.getDefaults() },
    persistState: (callback) => callback({ ok: true }),
  };
  registerTwitchHandlers(
    { emit: (event, payload) => emitted.push({ event, payload }) },
    { clientType: 'controller', on: (event, handler) => { handlers[event] = handler; } },
    ctx,
    { getTwitchService: () => service },
  );
  const invalid = await new Promise((resolve) => handlers['twitch:reward-settings:update']({
    ...TwitchRewardSettings.getDefaults(), cost: 0,
  }, resolve));
  eq(invalid.ok, false);
  const valid = await new Promise((resolve) => handlers['twitch:reward-settings:update']({
    ...TwitchRewardSettings.getDefaults(), enabled: true,
  }, resolve));
  eq(valid.ok, true);
  eq(valid.settings.rewardId, 'reward-managed-1');
  eq(ctx.playState.twitchRewardSettings.rewardId, 'reward-managed-1');
  eq(service.settings.enabled, true);
  eq(emitted.at(-1).event, 'twitch:reward-settings:update');
  service.syncManagedReward = async () => { throw new Error('temporary Twitch failure'); };
  service.status = () => ({
    reward: { ...service.settings },
    rewardSync: { state: 'error', error: 'temporary Twitch failure' },
  });
  const failed = await new Promise((resolve) => handlers['twitch:reward-settings:update']({
    ...service.settings, cost: 9999,
  }, resolve));
  eq(failed.ok, false);
  eq(failed.status.reward.cost, service.settings.cost);
  eq(failed.status.rewardSync.error, 'temporary Twitch failure');
  eq(ctx.playState.twitchRewardSettings.cost, service.settings.cost);
});

testAsync('Twitch 測試回覆 socket 只接受已知項目並回傳實際送出文字', async () => {
  const registerTwitchHandlers = require('../server/routes/handlers/twitch');
  const handlers = {};
  const socket = { clientType: 'controller', on: (event, handler) => { handlers[event] = handler; } };
  const service = {
    sendReplyTest: async (settings, replyKey) => ({ replyKey, text: `測試：${settings.replies[replyKey].template}` }),
    setReplySettings: () => {},
  };
  const ctx = {
    playState: { twitchReplySettings: TwitchReplySettings.getDefaults() },
    persistState: (callback) => callback({ ok: true }),
  };
  registerTwitchHandlers({ emit: () => {} }, socket, ctx, { getTwitchService: () => service });
  ok(typeof handlers['twitch:reply-settings:test'] === 'function');

  const invalidResult = await new Promise((resolve) => handlers['twitch:reply-settings:test']({
    settings: TwitchReplySettings.getDefaults(), replyKey: 'not-real',
  }, resolve));
  eq(invalidResult.ok, false);

  const validResult = await new Promise((resolve) => handlers['twitch:reply-settings:test']({
    settings: TwitchReplySettings.getDefaults(), replyKey: 'received',
  }, resolve));
  eq(validResult.ok, true);
  eq(validResult.replyKey, 'received');
  ok(validResult.text.includes('已收到你的點歌'));
});

test('Twitch 點歌頁有指令規則、回覆測試、變數驗證與各自還原入口', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '../public/js/app-twitch.js'), 'utf8');
  const panelCss = fs.readFileSync(path.join(__dirname, '../public/css/panel.css'), 'utf8');
  const state = fs.readFileSync(path.join(__dirname, '../server/state/app-state.js'), 'utf8');
  ok(html.includes('id="twitch-management-modal"') && html.includes('id="twitch-management-open"'));
  ok(html.includes('id="twitch-settings-search"') && html.includes('id="twitch-settings-search-results"'));
  ok(html.includes('id="twitch-command-list"') && html.includes('id="twitch-command-enabled"'));
  ok(html.includes('id="twitch-command-name"') && html.includes('id="twitch-command-aliases"'));
  ok(html.includes('id="twitch-command-permission"') && html.includes('id="twitch-command-user-cooldown"'));
  ok(html.includes('id="twitch-command-global-cooldown"') && html.includes('id="twitch-command-save"'));
  ok(html.includes('id="twitch-reply-enabled"') && html.includes('id="twitch-reply-events"'));
  ok(html.includes('id="twitch-reply-reset"') && html.includes('還原回覆預設值'));
  ok(html.includes('id="twitch-reply-test-event"') && html.includes('id="twitch-reply-test-send"'));
  eq((html.match(/id="twitch-reply-template"/g) || []).length, 1);
  ok(html.includes('id="twitch-request-max-pending"') && html.includes('id="twitch-request-per-user"'));
  ok(html.includes('id="twitch-request-max-duration"') && html.includes('id="twitch-request-duplicate-scope"'));
  ok(html.includes('id="twitch-request-live-only"') && html.includes('id="twitch-request-per-user-session"'));
  ok(html.includes('id="twitch-request-session-limit"') && html.includes('id="twitch-request-moderator-exempt"'));
  ok(html.includes('id="twitch-request-consecutive-warning"') && html.includes('id="twitch-request-edit-cooldown"'));
  ok(html.includes('id="twitch-request-rule-preview"') && html.includes('id="twitch-request-reset"'));
  ok(html.includes('id="twitch-blacklist-list"') && html.includes('id="twitch-blacklist-type"'));
  ok(html.includes('id="twitch-blacklist-value"') && html.includes('id="twitch-blacklist-save"'));
  ok(client.includes('TwitchRequestSettings.BLACKLIST_TYPES') && client.includes("saveRequestCategory('blacklist'"));
  ok(html.includes('id="twitch-reward-enabled"') && html.includes('id="twitch-reward-cost"'));
  ok(html.includes('id="twitch-reward-title"') && html.includes('id="twitch-reward-prompt"'));
  ok(html.includes('id="twitch-reward-paused"') && html.includes('id="twitch-reward-max-per-stream"'));
  ok(html.includes('id="twitch-reward-max-per-user"') && html.includes('id="twitch-reward-global-cooldown"'));
  ok(html.includes('id="twitch-reward-synced-summary"') && html.includes('id="twitch-reward-sync-error"'));
  ok(html.includes('id="twitch-reward-preview"') && html.includes('id="twitch-reward-reauthorize"'));
  ok(html.includes('id="twitch-reward-save"') && html.includes('停用並還原'));
  ok(client.includes("'twitch:reply-settings:test'") && client.includes('送出 Twitch 公開測試？'));
  const twitchView = html.match(/data-view="twitch"[\s\S]*?<\/div><!-- \/view twitch -->/)?.[0] || '';
  ok(twitchView.includes('id="twitch-management-modal"'), 'Twitch 管理中心必須放在 Twitch 點歌頁: ');
  const generalView = html.match(/data-view="general"[\s\S]*?<\/div><!-- \/view general -->/)?.[0] || '';
  ok(!generalView.includes('id="twitch-management-modal"'), '連線與系統頁不可重複 Twitch 管理中心: ');
  ok(html.indexOf('/js/twitch-request-settings.js') < html.indexOf('/js/twitch-reply-settings.js'));
  ok(html.indexOf('/js/twitch-reward-settings.js') < html.indexOf('/js/twitch-reply-settings.js'));
  ok(html.indexOf('/js/twitch-reply-settings.js') < html.indexOf('/js/app-twitch.js'));
  ok(client.includes('TwitchReplySettings.validateTemplate') && client.includes("'twitch:reply-settings:update'"));
  ok(client.includes('TwitchRequestSettings.validateSettings') && client.includes("'twitch:request-settings:update'"));
  ok(client.includes('TwitchRewardSettings.validateSettings') && client.includes("'twitch:reward-settings:update'"));
  ok(client.includes('result?.status') && client.includes('已保留上次確認狀態'));
  ok(client.includes('event.stopPropagation();') && client.includes('closeManagement();'), 'Twitch 管理中心的 Esc 不可被共用確認框用同一個事件立刻關掉: ');
  ok(client.includes('預覽暫停：請先修正文案中的變數。') && client.includes("el('twitch-reply-test-send').disabled = !whole.ok"), '非法回覆變數必須停用預覽與公開測試: ');
  ok(panelCss.includes('.twitch-management-layout {') && panelCss.includes('grid-template-columns: 210px minmax(0, 1fr);'), 'Twitch 管理中心需保留固定導覽與可縮內容區: ');
  ok(panelCss.includes('.twitch-management-pane[hidden]') && panelCss.includes('.twitch-settings-search-results[hidden]'), 'Twitch 管理中心的 hidden 元件不可被 flex/grid 覆寫: ');
  ok(panelCss.includes('@media (max-width: 860px)') && panelCss.includes('grid-template-columns: 1fr;'), 'Twitch 管理中心在窄視窗需切成單欄: ');
  const modalLayer = Number(panelCss.match(/\.modal \{[^}]*z-index:\s*(\d+)/)?.[1]);
  const windowBarLayer = Number(panelCss.match(/html\.electron-shell \.desktop-windowbar \{[^}]*z-index:\s*(\d+)/)?.[1]);
  const confirmationLayer = Number(panelCss.match(/\.danger-confirm-modal,\s*\.electron-close-modal \{[^}]*z-index:\s*(\d+)/)?.[1]);
  ok(confirmationLayer > modalLayer && confirmationLayer > windowBarLayer, '共用確認與關閉程式警告必須高於 Twitch 管理視窗及 Electron 標題列: ');
  ok(state.includes('twitchReplySettings: playState.twitchReplySettings'), 'Twitch 回覆設定必須寫入 state.json: ');
  ok(state.includes('twitchRequestSettings: playState.twitchRequestSettings'), 'Twitch 點歌規則必須寫入 state.json: ');
  ok(state.includes('twitchRewardSettings: playState.twitchRewardSettings'), 'Twitch 忠誠點數設定必須寫入 state.json: ');
});

testAsync('Twitch 聊天回覆遇到 5xx 會退避重試', async () => {
  const pendingStore = { load: () => [], save: () => true };
  const service = new TwitchService({
    config: { twitchClientId: 'fixture', twitchRequestCommand: '!點歌' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => true,
    onSongRequestExpired: () => {}, pendingStore,
  });
  service.auth = { accessToken: 'fixture', refreshToken: 'fixture', expiresAt: Date.now() + 600000, userId: '1' };
  service.ensureToken = async () => true;
  let attempts = 0;
  service.helix = async () => {
    attempts += 1;
    return attempts < 3
      ? { ok: false, status: 503, headers: { get: () => null }, json: async () => ({ message: 'busy' }) }
      : { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
  };
  await service.sendChatReply({ chatter_user_name: 'viewer' }, 'ok');
  eq(attempts, 3);
  service.stop();
});
