'use strict';

// 核心回歸測試（youtube-flow）。由 tests/run-tests.js 依序載入，不要單獨執行。
const {
  fs,
  readApiRoutesSource,
  path,
  os,
  test,
  testAsync,
  eq,
  ok,
} = require('./core-harness');
const staticContracts = require('./static-contracts');
const ytdlpCompatibility = require('../server/services/ytdlp-compatibility');
const stateStoreModulePath = path.join(__dirname, '..', 'server', 'services', 'state-store.js');
const { spawnSync: spawnStateStore } = require('child_process');
const { LyricsEngine, LYRICS_SOURCE_PRIORITY, cacheEntryIsFresh } = require('../server/services/lyrics-engine');
const AudioProcessor = require('../server/services/audio-processor');
const { makeTestJsonStore } = require('./core-harness').shared;

console.log('\n📦 12. YouTube 單次流程、翻唱辨識與佇列');
test('yt-dlp before_dl 使用完整 info dict 格式，不可使用會輸出 NA 的舊 %(json)j', () => {
  eq(AudioProcessor._metadataPrintTemplateForTest(), 'before_dl:__ES_META__%()j');
});
test('yt-dlp 403 fallback keeps the client until both HLS routes fail', () => {
  const plan = AudioProcessor._downloadStrategyPlanForTest();
  eq(plan.primary.format, 'bestaudio/best');
  eq(plan.primary.concurrentFragments, 4);
  eq(plan.hls.map((strategy) => strategy.id).join(','), 'hls-audio,hls-combined');
  eq(plan.hls.map((strategy) => strategy.format).join(','), 'bestaudio[protocol^=m3u8],best[protocol^=m3u8]');
  eq(plan.hls.map((strategy) => strategy.concurrentFragments).join(','), '1,1', 'HLS recovery must not fetch fragments concurrently: ');
  ok(plan.hls.every((strategy) => strategy.extractorArgs.join(',') === '--extractor-args,youtube:player_client=web_safari'), 'HLS recovery must use the HLS-capable web_safari client: ');
  eq(plan.clientFallbacks.map((strategy) => strategy.id).join(','), 'android-audio,ios-audio');
});

test('YouTube 安全救援鏈：預設匿名 → EJS → mweb PO slot，三層都不帶 Cookie', () => {
  const plan = AudioProcessor._downloadStrategyPlanForTest();
  eq(plan.primary.id, 'primary-audio');
  eq(plan.ejs.id, 'ejs-audio');
  ok(plan.ejs.extraArgs.join(' ').includes('ejs:github'), 'EJS fallback 必須只用 yt-dlp 官方 GitHub component: ');
  eq(plan.potMweb.id, 'pot-mweb-audio');
  ok(plan.potMweb.extractorArgs.join(' ').includes('player_client=mweb'), 'PO Token slot 必須使用 mweb client: ');
  eq(plan.potMweb.providerCandidate, 'bgutil-ytdlp-pot-provider');
  eq(plan.potMweb.providerVersion, '2.0.0');
  eq(plan.potMweb.providerMode, 'http');
  eq(plan.potMweb.providerEndpoint, 'http://127.0.0.1:4416');
  for (const strategy of [plan.primary, plan.ejs, plan.potMweb, ...plan.hls, ...plan.clientFallbacks]) {
    eq((strategy.cookieArgs || []).length, 0, `${strategy.id} 匿名鏈不可預先帶 Cookie: `);
  }
});

test('YouTube PO Provider 預選：bgutil 2.0.0 僅列入候選，不自動下載或打包', () => {
  const preferred = AudioProcessor._preferredPotProviderForTest();
  eq(preferred.id, 'bgutil-ytdlp-pot-provider');
  eq(preferred.version, '2.0.0');
  eq(preferred.license, 'GPL-3.0-only');
  eq(preferred.mode, 'http');
  eq(preferred.host, '127.0.0.1');
  eq(preferred.port, 4416);
  eq(preferred.minNodeMajor, 20);
  eq(preferred.client, 'mweb');
  eq(preferred.tokenContext, 'gvs');
  eq(preferred.status, 'preselected');
  eq(preferred.autoInstall, false, '預選不等於匯入時自動下載第三方 provider: ');
  eq(preferred.bundled, false, 'GPLv3 provider 在合規打包完成前不得直接隨主程式散布: ');
});

test('bgutil 2.0.0 預選必須附完整 GPLv3、來源與 sidecar 聲明，且打包流程會帶入 licenses/', () => {
  const legalDir = path.join(__dirname, '..', 'third-party-licenses', 'bgutil-ytdlp-pot-provider');
  const license = fs.readFileSync(path.join(legalDir, 'LICENSE.txt'), 'utf8');
  const source = fs.readFileSync(path.join(legalDir, 'SOURCE.txt'), 'utf8');
  const notice = fs.readFileSync(path.join(legalDir, 'NOTICE.txt'), 'utf8');
  const thirdParty = fs.readFileSync(path.join(__dirname, '..', 'THIRD-PARTY-NOTICES.txt'), 'utf8');
  const portable = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-portable.ps1'), 'utf8');

  ok(license.includes('GNU GENERAL PUBLIC LICENSE') && license.includes('Version 3, 29 June 2007'), '必須保留 upstream 完整 GPLv3 文字: ');
  ok(source.includes('Version selected by Elitesand Pro: 2.0.0'), '來源聲明必須固定精確版本: ');
  ok(source.includes('37169ee2656e08c5c2e5dc9df4c598c0cb4c88a8'), '來源聲明必須固定 upstream tag commit: ');
  ok(source.includes('archive/refs/tags/2.0.0.zip'), '必須提供精確版本的 Corresponding Source 取得位置: ');
  ok(source.includes('PRESELECTED') && source.includes('not yet bundled'), '目前不可誤稱 provider 已隨程式散布: ');
  ok(notice.includes('NOT BUNDLED / NOT AUTO-INSTALLED'), 'sidecar notice 必須標明目前未打包狀態: ');
  ok(thirdParty.includes('bgutil-ytdlp-pot-provider 2.0.0') && thirdParty.includes('GNU GPL v3'), '總第三方聲明必須列出 bgutil 與 GPLv3: ');
  ok(portable.includes('$BgutilLegalSource') && portable.includes('LICENSE.txt') && portable.includes('SOURCE.txt') && portable.includes('NOTICE.txt'), 'portable/installer 打包流程必須帶入 bgutil legal material 並 fail closed: ');
});

test('YouTube yt-dlp 呼叫固定 --no-config 並顯式指定目前 Node runtime，避免全域設定偷帶 Cookie', () => {
  const args = AudioProcessor._ytdlpRuntimeArgsForTest();
  ok(args.includes('--no-config'), '所有內建 YouTube 呼叫都應忽略使用者全域 yt-dlp.conf: ');
  const index = args.indexOf('--js-runtimes');
  ok(index >= 0 && /^node(?::.+)?$/i.test(String(args[index + 1] || '')), '必須顯式指定 Node JS runtime: ');
});

test('舊版 yt-dlp 不認得 --js-runtimes／--remote-components：依 --help 偵測，不支援就不帶', () => {
  const ytdlpCaps = require('../server/utils/ytdlp-capabilities');
  const modern = ytdlpCaps._parseHelpForTest('  --js-runtimes RUNTIME\n  --remote-components COMPONENT\n');
  const legacy = ytdlpCaps._parseHelpForTest('  --no-config\n  --extractor-args KEY:ARGS\n');
  eq(modern.jsRuntimes, true);
  eq(modern.remoteComponents, true);
  eq(legacy.jsRuntimes, false);
  eq(legacy.remoteComponents, false);

  const legacyArgs = AudioProcessor._ytdlpRuntimeArgsForTest(legacy);
  ok(legacyArgs.includes('--no-config'), '舊版仍要忽略全域 yt-dlp.conf: ');
  ok(!legacyArgs.includes('--js-runtimes'), '舊版不可帶 --js-runtimes，否則連匿名匯入都會失敗: ');
  ok(AudioProcessor._ytdlpRuntimeArgsForTest(modern).includes('--js-runtimes'), '新版要顯式指定 JS runtime: ');

  const withEjs = ['--remote-components', 'ejs:github', '--extractor-args', 'youtube:player_client=mweb'];
  eq(ytdlpCaps.stripUnsupported(withEjs, legacy).join(' '), '--extractor-args youtube:player_client=mweb');
  eq(ytdlpCaps.stripUnsupported(withEjs, modern).join(' '), withEjs.join(' '));
});

testAsync('相容性探針不連 GitHub（不帶 ejs:github），只在 yt-dlp 支援時才帶 --js-runtimes', async () => {
  const runWith = (helpText) => async (command, args) => {
    if (args.includes('--help')) return { stdout: helpText, stderr: '' };
    runWith.lastArgs = args;
    return { stdout: `${ytdlpCompatibility.PROBE_VIDEO_ID}\n`, stderr: '' };
  };
  ytdlpCompatibility._resetForTests();
  await ytdlpCompatibility.probe({ execFileImpl: runWith('  --js-runtimes RUNTIME\n  --remote-components C\n') });
  ok(runWith.lastArgs.includes('--js-runtimes'), '新版 yt-dlp 的探針要帶 JS runtime: ');
  ok(!runWith.lastArgs.includes('--remote-components') && !runWith.lastArgs.includes('ejs:github'), '探針不可每次連 GitHub 抓 EJS: ');

  ytdlpCompatibility._resetForTests();
  await ytdlpCompatibility.probe({ execFileImpl: runWith('  --no-config\n') });
  ok(!runWith.lastArgs.includes('--js-runtimes'), '舊版 yt-dlp 的探針不可帶未知參數: ');
  ok(runWith.lastArgs.includes('--no-config'));
  ytdlpCompatibility._resetForTests();
});

test('YouTube Cookie 最後手段只接受固定瀏覽器名稱，不接受任意 profile/path 注入', () => {
  eq(AudioProcessor._normalizeCookieBrowserForTest('EDGE'), 'edge');
  eq(AudioProcessor._normalizeCookieBrowserForTest('chrome'), 'chrome');
  eq(AudioProcessor._normalizeCookieBrowserForTest('firefox'), 'firefox');
  eq(AudioProcessor._normalizeCookieBrowserForTest('chrome:C:\\Users\\me'), '');
  eq(AudioProcessor._normalizeCookieBrowserForTest('../../cookie.txt'), '');
});

test('YouTube 登入救援：API 僅接收瀏覽器名稱，前端必須明確詢問且工作結束即清掉', () => {
  const api = readApiRoutesSource();
  const frontend = fs.readFileSync(path.join(__dirname, '../public/js/app-youtube-import.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  ok(api.includes("AudioProcessor.normalizeCookieBrowser(requestedCookieBrowser)"), '後端要白名單驗證 cookieBrowser: ');
  ok(api.includes("code: 'INVALID_COOKIE_BROWSER'"), '任意 cookie source 必須拒絕: ');
  ok(api.includes("code: 'COOKIE_BROWSER_LOCAL_ONLY'"), '瀏覽器 Cookie fallback 必須拒絕 LAN/遠端控制端: ');
  ok(api.includes('isLoopbackAddress(getClientAddress(req))'), 'Cookie fallback 與提示都必須綁定真實 socket loopback: ');
  ok(api.includes('browserCookieFallback: classified.browserCookieFallback === true'), '只有明確 auth 分類才提示最後救援: ');
  ok(html.includes('id="youtube-cookie-modal"') && html.includes('id="youtube-cookie-browser"'), '必須有獨立登入狀態確認視窗: ');
  ok(frontend.includes('requestBrowserCookieRetry()'), '前端必須由使用者明確選擇後才重試: ');
  ok(frontend.includes("&& !job.isBatch"), '播放清單批次不得逐首跳登入視窗: ');
  ok(frontend.includes("job.cookieBrowser = '';"), '工作結束後不可把瀏覽器登入來源留在歷史 job: ');
  ok(!frontend.includes('cookies.txt'), '前端不可要求或保存 cookies.txt: ');
});

test('YouTube nightly fallback 只允許 Installer 的可信可寫 yt-dlp 工作副本', () => {
  const updater = fs.readFileSync(path.join(__dirname, '../server/services/ytdlp-updater.js'), 'utf8');
  const shell = fs.readFileSync(path.join(__dirname, '../electron/shell.js'), 'utf8');
  ok(updater.includes("process.env.ELITESAND_PACKAGED !== '1'"), 'portable/dev 不可被匯入流程自動改 yt-dlp: ');
  ok(updater.includes("process.env.ELITESAND_YTDLP_MUTABLE !== '1'"), '唯讀 seed 不可被 nightly fallback 修改: ');
  ok(updater.includes("nightlyRelease.stageVerifiedRelease"), '相容性救援必須驗證官方 Nightly binary: ');
  ok(updater.includes('writeApprovedRuntimeTrust(currentVersion)'), 'nightly 成功後必須重新寫可信 runtime hash: ');
  ok(shell.includes("ELITESAND_YTDLP_NODE_PATH: path.join(packagedTools, 'updater-node.exe')"), 'Installer 應把隨附 Node runtime 明確交給 yt-dlp EJS: ');
  const portableBuild = fs.readFileSync(path.join(__dirname, '../tools/build-portable.ps1'), 'utf8');
  ok(portableBuild.includes('Node.js 22 or newer is required for packaged yt-dlp EJS support'), '打包時必須拒絕 Node 21 以下，避免產出無法解 EJS 的 runtime: ');
  const audio = fs.readFileSync(path.join(__dirname, '../server/services/audio-processor.js'), 'utf8');
  ok(audio.includes('if (activeYtDlpJobs > 1)'), '另一個 yt-dlp 工作執行中時不可就地替換 runtime: ');
});

testAsync('yt-dlp 一律走 nightly：版本檢查看 nightly repo、更新與啟動切換都用 nightly，打包能處理 nightly 授權', async () => {
  const updaterPath = path.join(__dirname, '../server/services/ytdlp-updater.js');
  const updater = fs.readFileSync(updaterPath, 'utf8');
  const releaseSource = fs.readFileSync(path.join(__dirname, '../server/services/ytdlp-verified-release.js'), 'utf8');
  ok(releaseSource.includes('repos/yt-dlp/yt-dlp-nightly-builds/releases/latest'), '版本檢查要比對 nightly，否則 nightly 永遠被當成比穩定版新: ');
  ok(!updater.includes("['-U']"), '手動更新不可再用 -U（會停在穩定版）: ');
  const ytdlpUpdater = require(updaterPath);
  eq(ytdlpUpdater.isNightlyVersion('2026.09.16.232951'), true);
  eq(ytdlpUpdater.isNightlyVersion('2026.08.19'), false);
  eq(ytdlpUpdater.isNightlyVersion(''), false);
  const prevPackaged = process.env.ELITESAND_PACKAGED;
  delete process.env.ELITESAND_PACKAGED;
  try {
    const result = await ytdlpUpdater.ensureNightlyChannel();
    eq(result.skipped, true, '開發環境／portable 啟動時不可自動改 yt-dlp: ');
  } finally {
    if (prevPackaged !== undefined) process.env.ELITESAND_PACKAGED = prevPackaged;
  }
  const server = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  ok(server.includes('ensureNightlyChannel()'), '啟動時要把既有穩定版安裝換成 nightly: ');
  const portableBuild = fs.readFileSync(path.join(__dirname, '../tools/build-portable.ps1'), 'utf8');
  ok(portableBuild.includes('yt-dlp-nightly-builds/releases/tags/$YtdlpVersion') && portableBuild.includes('$YtdlpLicenseRef'),
    'nightly 版號在主 repo 沒有 tag，打包必須改到上游 commit 取授權，否則 build 會失敗: ');
});

test('YouTube 登入救援對話框用白話，不出現內部技術名詞', () => {
  const i18n = require('../public/js/i18n');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  ok(html.includes('data-i18n="youtubeAuth.browserHint"'), '要提示 Chrome／Edge 失敗時怎麼辦: ');
  for (const locale of i18n.LOCALES) {
    for (const key of ['youtubeAuth.title', 'youtubeAuth.summary', 'youtubeAuth.risk', 'youtubeAuth.browser', 'youtubeAuth.browserHint', 'youtubeAuth.cancel', 'youtubeAuth.retry']) {
      const text = String(i18n.catalogs[locale][key] || '');
      ok(text.trim(), `${locale}.${key} 不得為空: `);
      ok(!/nightly|EJS|yt-dlp|Cookie|cookie/.test(text), `${locale}.${key} 不可出現技術名詞: `);
    }
  }
});

test('官方影片 Remaster 後綴不會讓歌手與歌名顛倒', () => {
  const x = AudioProcessor.resolveTrackIdentity({ title: 'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)' });
  eq(x.artist, 'Rick Astley'); eq(x.title, 'Never Gonna Give You Up');
});
test('極短非歌曲影片不做 Apple Music 歌手猜測', () => {
  ok(!AudioProcessor.shouldResolveAppleMetadata({ duration: 19 }, { confidence: 0.35 }, false));
  ok(AudioProcessor.shouldResolveAppleMetadata({ duration: 213 }, { confidence: 0.68 }, false));
});
test('一般官方歌曲影片：結構化 metadata 優先', () => {
  const x = AudioProcessor.resolveTrackIdentity({ title: 'Uploader - Wrong', track: '夜に駆ける', artist: 'YOASOBI', uploader: 'Label' });
  eq(x.title, '夜に駆ける'); eq(x.artist, 'YOASOBI');
});
test('結構化 metadata 本身填反時（track=歌手、artist=歌名），命中已知歌手清單會調正方向', () => {
  const x = AudioProcessor.resolveTrackIdentity({ title: 'YOASOBI《夜に駆ける》Official Music Video', track: 'YOASOBI', artist: '夜に駆ける' });
  eq(x.artist, 'YOASOBI'); eq(x.title, '夜に駆ける');
});
test('影片夠長就一律查 Apple Music 官方時長，不再受信心分數限制', () => {
  ok(AudioProcessor.shouldResolveAppleMetadata({ duration: 213 }, { confidence: 1 }, false));
});
test('Apple Music metadata 經 provider health 包裝後仍保留非 lyrics 型成功結果', async () => {
  const original = LyricsEngine._resolveAppleMusicMetadataInner;
  try {
    LyricsEngine._resolveAppleMusicMetadataInner = async () => ({
      artist: 'Aimer', title: '残響散歌', confidence: 0.98, durationSec: 184.898,
    });
    const result = await LyricsEngine.resolveAppleMusicMetadata({ artist: 'Aimer', title: '残響散歌' });
    eq(result.artist, 'Aimer');
    eq(result.title, '残響散歌');
    eq(result.durationSec, 184.898);
  } finally {
    LyricsEngine._resolveAppleMusicMetadataInner = original;
  }
});
test('標題含歌手與歌名：可正確拆解', () => {
  const x = AudioProcessor.resolveTrackIdentity({ title: 'Aimer - 残響散歌' }); eq(x.artist, 'Aimer'); eq(x.title, '残響散歌');
});
test('翻唱影片：uploader 不會成為原唱', () => {
  const info = { title: '残響散歌 Cover covered by VTuber', uploader: 'VTuber Channel' };
  ok(AudioProcessor.detectCover(info));
  const x = AudioProcessor.resolveTrackIdentity(info); ok(x.artist !== info.uploader);
});
test('翻唱偵測：常見翻唱用語命中', () => {
  ok(AudioProcessor.detectCover({ title: '夜に駆ける／歌ってみた' }));
  ok(AudioProcessor.detectCover({ title: 'Lemon (Piano Cover)' }));
  ok(AudioProcessor.detectCover({ title: 'Song', description: 'Vocal Cover by someone' }));
});
test('翻唱偵測：封面／圖片語意不誤判為翻唱', () => {
  ok(!AudioProcessor.detectCover({ title: 'YOASOBI - 群青', description: 'New album cover revealed! cover art by X' }));
  ok(!AudioProcessor.detectCover({ title: 'Aimer - 残響散歌 (Official)', description: 'cover image credit: someone' }));
  ok(!AudioProcessor.detectCover({ title: 'Album Cover Reveal' }));
});
test('歌名存在但原唱不存在：安全保留空字串', () => {
  const x = AudioProcessor.resolveTrackIdentity({ title: 'ただ声一つ' }); eq(x.artist, ''); ok(!!x.title);
});
test('上傳者不是原唱：不在標題中便不採用', () => {
  const x = AudioProcessor.resolveTrackIdentity({ title: '群青 Official Music Video', uploader: 'ForwardMusic' }); eq(x.artist, '');
});
testAsync('原唱反查超時：立即停止並回傳 null', async () => {
  const result = await LyricsEngine.resolveOriginalArtist('Test', 0, [() => new Promise(() => {})], 30); eq(result, null);
});
testAsync('多來源歌手結果不一致：不自動填入', async () => {
  const result = await LyricsEngine.resolveOriginalArtist('Test', 0, [async () => 'A', async () => 'B', async () => 'C'], 100);
  eq(result.artist, ''); eq(result.candidates.length, 3);
});
testAsync('多來源一致：至少兩票才確認原唱', async () => {
  const result = await LyricsEngine.resolveOriginalArtist('Test', 0, [async () => 'Aimer', async () => 'Aimer', async () => 'Other'], 100);
  eq(result.artist, 'Aimer'); ok(result.confidence >= 0.8);
});
testAsync('同一 video ID 同時請求只執行一次', async () => {
  const original = AudioProcessor._processYouTube; let calls = 0;
  AudioProcessor._processYouTube = async () => { calls++; await new Promise(r => setTimeout(r, 30)); return { id: 'zzTEST00001', title: 'x' }; };
  try {
    const [a, b] = await Promise.all([
      AudioProcessor.processYouTube('https://youtu.be/zzTEST00001'),
      AudioProcessor.processYouTube('https://www.youtube.com/watch?v=zzTEST00001'),
    ]);
    eq(calls, 1); eq(a.id, b.id);
  } finally { AudioProcessor._processYouTube = original; }
});
testAsync('播放清單兩首可並行下載且最多為 2', async () => {
  let active = 0, peak = 0;
  const job = () => AudioProcessor._runQueuedForTest(async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 40)); active--; });
  await Promise.all([job(), job(), job()]);
  eq(peak, 2);
});
testAsync('YouTube metadata 檢查也會共用下載佇列，不會繞過 yt-dlp 併發上限', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let entered = 0;
  const blocker = () => AudioProcessor._runQueuedForTest(async () => { entered++; await gate; });
  const first = blocker(); const second = blocker();
  while (entered < 2) await new Promise((resolve) => setTimeout(resolve, 5));

  const original = AudioProcessor.getVideoInfo;
  let metadataCalls = 0;
  AudioProcessor.getVideoInfo = async () => {
    metadataCalls++;
    return { id: 'aaBBccDDeeF', title: 'Queued metadata', duration: 180, categories: ['Music'] };
  };
  try {
    const inspection = AudioProcessor.inspectYouTube('https://youtu.be/aaBBccDDeeF');
    await new Promise((resolve) => setTimeout(resolve, 20));
    eq(metadataCalls, 0);
    release();
    const result = await inspection;
    eq(metadataCalls, 1);
    eq(result.title, 'Queued metadata');
  } finally {
    AudioProcessor.getVideoInfo = original;
    release?.();
    await Promise.all([first, second]);
  }
});
testAsync('匯入取消：尚未開始的工作會從後端佇列移除', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let entered = 0;
  const blocker = () => AudioProcessor._runQueuedForTest(async () => { entered++; await gate; });
  const first = blocker(); const second = blocker();
  while (entered < 2) await new Promise((resolve) => setTimeout(resolve, 5));
  const controller = new AbortController();
  let ran = false;
  const queued = AudioProcessor._runQueuedForTest(async () => { ran = true; }, 'batch', controller.signal);
  controller.abort();
  let error;
  try { await queued; } catch (caught) { error = caught; }
  eq(error?.code, 'IMPORT_CANCELLED');
  ok(!ran, '取消後不得開始工作: ');
  release();
  await Promise.all([first, second]);
});
testAsync('匯入取消：進行中工作會收到 abort 並以取消錯誤結束', async () => {
  const requestId = `cancel-active-${Date.now()}`;
  const registration = AudioProcessor._registerCancellationForTest(requestId);
  try {
    let aborted = false;
    registration.signal.addEventListener('abort', () => { aborted = true; }, { once: true });
    ok(AudioProcessor.cancelImport(requestId).ok, '進行中工作應可找到: ');
    ok(aborted, '進行中工作應收到 abort: ');
  } finally {
    registration.cleanup();
    ok(!AudioProcessor.cancelImport(requestId).ok, '完成清理後不可殘留 request controller: ');
  }
});

test('靜態守衛：/api/deck 的 GET 未掛 requirePin 會被抓出，多行路由宣告也看得到', () => {
  const report = staticContracts.routeContractReport([{
    file: 'server/fixture.js',
    source: [
      "app.get('/api/deck/:action', handleDeckCommand);",           // 寫入型 GET 漏保護 → 必須被抓
      "app.get('/api/health', healthHandler);",                     // 唯讀 GET → 不納管
      "router.post('/api/multi-line',",                             // 多行宣告
      "  requirePin,",
      "  handler);",
    ].join('\n'),
  }]);
  ok(report.unprotected.some((item) => item.key === 'server/fixture.js:GET:/api/deck/:action'),
    '未保護的 deck GET 應被列入 unprotected: ');
  ok(!report.routes.some((item) => item.route === '/api/health'), '唯讀 GET 不應納管: ');
  const multiLine = report.routes.find((item) => item.route === '/api/multi-line');
  ok(!!(multiLine && multiLine.protected), '多行宣告的 requirePin 應被辨識: ');
});

test('共用 JSON store：corrupt 保全檔數量有上限，不會無限累積', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-json-store-prune-'));
  try {
    const file = path.join(dataDir, 'sample.json');
    const store = makeTestJsonStore(file);
    for (let i = 0; i < 7; i++) {
      fs.writeFileSync(file, `{broken-${i}`, 'utf8');
      store.load();
    }
    const corrupt = fs.readdirSync(dataDir).filter((name) => name.startsWith('sample.json.corrupt'));
    ok(corrupt.length <= 5, `corrupt 保全檔應 ≤5，實際 ${corrupt.length}: `);
    ok(corrupt.length >= 1, '仍應保留最新的 corrupt 保全檔: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('狀態保存：另一伺服器停止寫入後會自動接管並備份對方狀態（G-13）', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-takeover-'));
  try {
    const script = [
      "const fs=require('fs'); const path=require('path'); const store=require(process.argv[1]);",
      "const dataDir=process.argv[2]; const file=path.join(dataDir,'state.json');",
      "fs.writeFileSync(file, JSON.stringify({schemaVersion:2, savedAt:100, playlist:[]}), 'utf8');",
      "store.loadState();",
      "fs.writeFileSync(file, JSON.stringify({schemaVersion:2, savedAt:200, playlist:[{id:'other-server'}]}), 'utf8');",
      "const results=[];",
      "store.scheduleSave(()=>({savedAt:300, marker:'first-attempt'}), (r)=>results.push(r));",
      "store.saveNow();",
      "setTimeout(()=>{",
      "  store.scheduleSave(()=>({savedAt:400, marker:'after-quiet'}), (r)=>results.push(r));",
      "  store.saveNow();",
      "  const disk=JSON.parse(fs.readFileSync(file,'utf8'));",
      "  const conflict=fs.readdirSync(dataDir).filter((n)=>n.startsWith('state.json.conflict-'));",
      "  process.stdout.write('__STATE_RESULT__'+JSON.stringify({results, diskSavedAt:disk.savedAt, marker:disk.marker, conflict})+'\\n');",
      "  process.exit(0);",
      "},150);",
    ].join('\n');
    const child = spawnStateStore(process.execPath, ['-e', script, stateStoreModulePath, dataDir], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir, ELITESAND_TAKEOVER_QUIET_MS: '50' },
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    eq(child.status, 0, `state takeover child stderr=${child.stderr} stdout=${child.stdout}: `);
    const markerAt = child.stdout.lastIndexOf('__STATE_RESULT__');
    ok(markerAt >= 0, `state takeover child 缺少結果：${child.stdout}`);
    const result = JSON.parse(child.stdout.slice(markerAt + '__STATE_RESULT__'.length).trim().split(/\r?\n/, 1)[0]);
    eq(result.results[0].ok, false, '衝突當下的第一次保存應被拒絕: ');
    ok(/另一個伺服器/.test(result.results[0].error || ''), '拒絕原因應說明另一伺服器衝突: ');
    eq(result.results[1].ok, true, '靜默期後的保存應接管成功: ');
    eq(result.diskSavedAt, 400, '磁碟應為本程序接管後的狀態: ');
    eq(result.marker, 'after-quiet');
    eq(result.conflict.length, 1, '應留下一份對方狀態的 conflict 備份: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});
