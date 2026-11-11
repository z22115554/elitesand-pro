'use strict';

// 核心回歸測試（updates）。由 tests/run-tests.js 依序載入，不要單獨執行。
const {
  fs,
  readApiRoutesSource,
  path,
  os,
  failed,
  test,
  testAsync,
  eq,
  ok,
} = require('./core-harness');

// ═══════════════════════════════════════════
console.log('\n📦 7. 更新檢查 (update-checker / version-compare)');
// ═══════════════════════════════════════════
const { isNewerVersion, compareVersions } = require('../server/utils/version-compare');
const { APP_VERSION, appUserAgent, githubJsonHeaders } = require('../server/utils/app-version');

test('版本號比對：基本案例', () => {
  ok(isNewerVersion('1.0.0', '0.1.0'));
  ok(isNewerVersion('1.0.1', '1.0.0'));
  ok(!isNewerVersion('1.0.0', '1.0.0'));
  ok(!isNewerVersion('0.9.0', '1.0.0'));
});

test('版本號比對：v 前綴與長度不一致', () => {
  ok(!isNewerVersion('v1.2.0', '1.2.0'));
  eq(compareVersions('1.2', '1.2.0'), 0);
  ok(isNewerVersion('1.2.1', '1.2'));
});

test('版本號比對：正式版高於同 core prerelease', () => {
  ok(isNewerVersion('0.7.4', '0.7.4-p0-test.2'));
  ok(!isNewerVersion('0.7.4-p0-test.2', '0.7.4'));
  ok(isNewerVersion('0.7.4-p0-test.2', '0.7.4-p0-test.1'));
  eq(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta'), -1);
  eq(compareVersions('1.0.0+build.2', '1.0.0+build.1'), 0);
});

test('版本號比對：不含分隔符的雙位數 prerelease 不可輸給個位數（test10 > test9）', () => {
  ok(isNewerVersion('1.0.0-test10', '1.0.0-test9'), 'test10 必須新於 test9');
  ok(!isNewerVersion('1.0.0-test9', '1.0.0-test10'));
  eq(compareVersions('1.0.0-test19', '1.0.0-test20'), -1);
  eq(compareVersions('1.0.0-test99', '1.0.0-test100'), -1);
});

const { selectLatestRelease } = require('../server/services/update-checker');
const appUpdater = require('../server/services/app-updater');
const { findVerifiedUpdateAssets } = appUpdater;
const releaseClient = require('../server/services/release-client');
const AdmZip = require('adm-zip');
const updaterRunner = require('../server/services/app-updater-runner');
const announcementService = require('../server/services/announcement-service');
const ytdlpCompatibility = require('../server/services/ytdlp-compatibility');
const systemCheck = require('../server/services/system-check');
const diagnosticBundle = require('../server/services/diagnostic-bundle');
const { createRuntimeEvidence } = require('../server/services/runtime-evidence');

testAsync('yt-dlp 相容性探針只讀 metadata，成功與失敗都提供可行狀態', async () => {
  ytdlpCompatibility._resetForTests();
  let received = null;
  const success = await ytdlpCompatibility.probe({
    execFileImpl: async (command, args, options) => {
      received = { command, args, options };
      return { stdout: `${ytdlpCompatibility.PROBE_VIDEO_ID}\n`, stderr: '' };
    },
    now: () => 1234,
  });
  eq(success.state, 'ok');
  eq(success.ok, true);
  eq(received.command, 'yt-dlp');
  ok(received.args.includes('--skip-download'));
  ok(received.args.includes('--no-playlist'));
  ok(received.args.includes('--print'));
  ok(!received.args.includes('-o'), '探針不可指定下載輸出路徑');
  eq(received.options.timeout, 15000);

  ytdlpCompatibility._resetForTests();
  const unavailable = await ytdlpCompatibility.probe({
    execFileImpl: async () => { const error = new Error('binary missing at C:/secret/path'); error.code = 'ENOENT'; throw error; },
    now: () => 5678,
  });
  eq(unavailable.state, 'failed');
  eq(unavailable.ok, false);
  ok(unavailable.message.includes('找不到 yt-dlp'));
  ok(!unavailable.message.includes('secret/path'), 'UI 狀態不可洩漏本機命令列錯誤內容');

  const root = path.join(__dirname, '..');
  const api = readApiRoutesSource();
  const index = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
  const frontend = fs.readFileSync(path.join(root, 'public/js/app-style-sync.js'), 'utf8');
  ok(api.includes("router.post('/ytdlp/compatibility', requirePin"));
  ok(index.includes('ytdlpCompatibility.scheduleProbe()'));
  ok(frontend.includes("PinAuth.fetchWithPin('/api/ytdlp/compatibility'"));
});

test('應用版本集中於 package.json，lockfile、健康檢查與產品 User-Agent 不可漂移', () => {
  const root = path.join(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  eq(APP_VERSION, packageJson.version);
  eq(packageLock.version, APP_VERSION, 'package-lock 根版本必須與 package.json 一致: ');
  eq(packageLock.packages[''].version, APP_VERSION, 'package-lock 專案版本必須與 package.json 一致: ');
  eq(appUserAgent('test'), `ElitesandPro/${APP_VERSION} (test)`);
  const githubHeaders = githubJsonHeaders('test');
  eq(githubHeaders.Accept, 'application/vnd.github+json');
  eq(githubHeaders['User-Agent'], appUserAgent('test'));
  const versionConsumers = [
    'server/routes/api/system.js',
    'server/services/app-updater.js',
    'server/services/announcement-service.js',
    'server/services/diagnostic-bundle.js',
    'server/services/lyrics-engine.js',
    'server/services/system-check.js',
    'server/services/update-checker.js',
    'server/services/ytdlp-verified-release.js',
  ];
  versionConsumers.forEach((relativePath) => {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    ok(source.includes('app-version'), `${relativePath} 必須透過 app-version 取得產品版本或 User-Agent: `);
    ok(!source.includes("require('../../package.json')"), `${relativePath} 不可各自讀取 package.json: `);
  });
});

test('直播穩定性觀測只保存連線時長與計數，重設不會碰現有連線', () => {
  let timestamp = 1000;
  const evidence = createRuntimeEvidence({ now: () => timestamp });
  ok(evidence.recordSocketConnected({ socketId: 'controller-1', clientType: 'controller' }));
  timestamp = 1100;
  ok(evidence.recordSocketConnected({ socketId: 'controller-2', clientType: 'controller' }));
  ok(evidence.recordSocketConnected({ socketId: 'display-1', clientType: 'display' }));
  timestamp = 1200;
  ok(evidence.recordSocketConnected({ socketId: 'setlist-1', clientType: 'setlist' }));
  timestamp = 2200;
  ok(evidence.recordSocketDisconnected({ socketId: 'display-1' }));
  timestamp = 2800;
  ok(evidence.recordSocketConnected({ socketId: 'display-2', clientType: 'display' }));
  evidence.recordTwitchStatus({ configured: true, authorized: true, connected: false, connectionState: 'connecting', subscriptionState: 'idle' });
  timestamp = 3000;
  evidence.recordTwitchStatus({ configured: true, authorized: true, connected: true, connectionState: 'connected', subscriptionState: 'ready', lastConnectedAt: timestamp });
  timestamp = 4200;
  evidence.recordTwitchStatus({ configured: true, authorized: true, connected: false, connectionState: 'reconnecting', subscriptionState: 'idle', lastDisconnectedAt: timestamp });
  const beforeReset = evidence.getSnapshot();
  eq(beforeReset.clients.controller.connections, 2);
  eq(beforeReset.clients.controller.reconnects, 0, '同時連線的控制端不可誤記為重連: ');
  eq(beforeReset.clients.display.connections, 2);
  eq(beforeReset.clients.display.reconnects, 1);
  eq(beforeReset.clients.display.disconnects, 1);
  eq(beforeReset.obs.bothSourcesConnectedMs, 2400);
  eq(beforeReset.obs.interruptions, 1);
  eq(beforeReset.twitch.connections, 1);
  eq(beforeReset.twitch.disconnects, 1);
  ok(!JSON.stringify(beforeReset).includes('display-1'), '公開證據不可含 socket id: ');

  timestamp = 5000;
  const reset = evidence.reset();
  eq(reset.observedMs, 0);
  eq(reset.clients.display.activeConnections, 1);
  eq(reset.clients.setlist.activeConnections, 1);
  eq(reset.clients.display.connections, 1, '重設後仍應保留已連線 OBS 的觀測起點: ');
  eq(reset.obs.interruptions, 0);
});

testAsync('診斷包只含已遮蔽的健康資訊、直播連線證據與日誌尾段，且不落地副本', async () => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-diagnostic-'));
  try {
    fs.writeFileSync(path.join(logDir, 'elitesand-pro-main.log'), [
      'Bearer twitch-access-token',
      'access_token": "refresh-secret", PIN: 1234',
      'password=not-for-support',
      'C:\\Users\\streamer\\private\\data.json',
      'Twitch \u5DF2\u6388\u6B0A\u983B\u9053\uFF1Astreamer-private',
      'ordinary diagnostic line',
    ].join('\n'));
    fs.writeFileSync(path.join(logDir, 'ignore.txt'), 'not a log');
    const bundle = diagnosticBundle.createDiagnosticBundle({
      logDir,
      generatedAt: new Date('2026-07-15T08:00:00.000Z'),
      appVersion: '0.7.7-test',
      systemCheck: { appVersion: '0.7.7-test', ytdlp: { available: true, version: '2026.07' }, accessToken: 'not-for-support' },
      runtimeEvidence: {
        observedMs: 4 * 60 * 60 * 1000,
        obs: { displaySeen: true, setlistSeen: true, bothSourcesSeen: true, bothSourcesConnectedMs: 3 * 60 * 60 * 1000, interruptions: 0 },
        twitch: { observed: true, configured: true, connected: true, connections: 1, reconnects: 0, disconnects: 0, connectedMs: 4 * 60 * 60 * 1000 },
      },
    });
    const zip = new AdmZip(bundle.buffer);
    const entries = zip.getEntries().map((entry) => entry.entryName);
    ok(entries.includes('README.txt'));
    ok(entries.includes('manifest.json'));
    ok(entries.includes('system-check.json'));
    ok(entries.includes('runtime-evidence.json'));
    ok(entries.includes('runtime-evidence-summary.txt'));
    ok(entries.includes('logs/elitesand-pro-main.log.txt'));
    const combined = entries.map((entry) => zip.readAsText(entry)).join('\n');
    ok(!combined.includes('twitch-access-token'));
    ok(!combined.includes('refresh-secret'));
    ok(!combined.includes('1234'));
    ok(!combined.includes('not-for-support'));
    ok(!combined.includes('C:\\Users\\streamer'));
    ok(!combined.includes('streamer-private'));
    ok(combined.includes('ordinary diagnostic line'));
    ok(!fs.existsSync(path.join(logDir, bundle.filename)), '診斷包不可在 logs 目錄留下副本');
    const manifest = JSON.parse(zip.readAsText('manifest.json'));
    eq(manifest.appVersion, '0.7.7-test');
    eq(manifest.includedLogs.length, 1);
    eq(manifest.includesRuntimeEvidence, true);
    eq(manifest.includesRuntimeEvidenceSummary, true);
    const reliabilitySummary = zip.readAsText('runtime-evidence-summary.txt');
    ok(reliabilitySummary.includes('四小時時長門檻：已達成'));
    ok(reliabilitySummary.includes('兩來源中斷次數：0'));
    ok(reliabilitySummary.includes('重連次數：0'));

    systemCheck._resetForTests();
    const check = await systemCheck.getSystemCheck({
      force: true,
      compatibility: { getStatus: () => ({ state: 'ok', message: 'metadata only' }) },
      execFileImpl: async (command) => ({ stdout: command === 'yt-dlp' ? '2026.07\n' : 'ffmpeg version 8\n', stderr: '' }),
      now: () => 1000,
    });
    eq(check.ytdlp.available, true);
    eq(check.ffmpeg.available, true);

    // FFmpeg 下載完成後會立刻 clearCache + force check；這裡保護「60 秒舊快取
    // 讓 UI 明明下載成功卻仍顯示找不到 FFmpeg」的回歸。
    systemCheck.clearCache();
    let ffmpegHealthy = false;
    let toolRuns = 0;
    const cacheOptions = {
      compatibility: { getStatus: () => ({ state: 'ok', message: 'metadata only' }) },
      execFileImpl: async (command) => {
        toolRuns++;
        if (command === 'yt-dlp') return { stdout: '2026.07\n', stderr: '' };
        if (!ffmpegHealthy) throw new Error('broken ffmpeg');
        return { stdout: 'ffmpeg version repaired\n', stderr: '' };
      },
      now: () => 2000,
    };
    const beforeRepair = await systemCheck.getSystemCheck(cacheOptions);
    eq(beforeRepair.ffmpeg.available, false, '修復前應該記錄 FFmpeg 不可用：');
    const runsAfterFirstCheck = toolRuns;
    ffmpegHealthy = true;
    const staleCheck = await systemCheck.getSystemCheck(cacheOptions);
    eq(staleCheck.ffmpeg.available, false, '未清快取時應仍是舊狀態，證明測試確實覆蓋 cache：');
    eq(toolRuns, runsAfterFirstCheck, '命中 60 秒快取時不應重新執行工具：');
    systemCheck.clearCache();
    const afterRepair = await systemCheck.getSystemCheck(cacheOptions);
    eq(afterRepair.ffmpeg.available, true, '下載流程清除快取後必須立即看到修復後 FFmpeg：');

    // 程式執行期間若使用者/防毒把 data/bin 的其中一個檔案刪掉，不能等 60 秒 cache 才更新。
    // cache 只要記得上次來源是 downloaded，就應在每次命中前用 existsSync 等級的便宜檢查淘汰舊狀態。
    const ffmpegProviderForCacheTest = require('../server/services/ffmpeg-provider');
    const originalResolveFfmpegPaths = ffmpegProviderForCacheTest.resolveFfmpegPaths;
    const originalHasDownloadedPair = ffmpegProviderForCacheTest.hasDownloadedPair;
    let downloadedPairExists = true;
    let runtimeChecks = 0;
    try {
      ffmpegProviderForCacheTest.resolveFfmpegPaths = () => downloadedPairExists
        ? { source: 'downloaded', ffmpeg: 'C:/fake/ffmpeg.exe', ffprobe: 'C:/fake/ffprobe.exe' }
        : null;
      ffmpegProviderForCacheTest.hasDownloadedPair = () => downloadedPairExists;
      systemCheck.clearCache();
      const deletionOptions = {
        compatibility: { getStatus: () => ({ state: 'ok', message: 'metadata only' }) },
        execFileImpl: async (command) => {
          runtimeChecks++;
          if (command === 'yt-dlp') return { stdout: '2026.07\n', stderr: '' };
          if (downloadedPairExists) return { stdout: 'ffmpeg version downloaded\n', stderr: '' };
          throw new Error('ffmpeg deleted while app is running');
        },
        now: () => 3000,
      };
      const beforeDelete = await systemCheck.getSystemCheck(deletionOptions);
      eq(beforeDelete.ffmpeg.available, true, '刪除前下載版 FFmpeg 應為可用：');
      const checksBeforeDelete = runtimeChecks;
      downloadedPairExists = false;
      const afterDelete = await systemCheck.getSystemCheck(deletionOptions);
      eq(afterDelete.ffmpeg.available, false, '下載版 pair 消失後下一次檢查應立即淘汰舊 cache：');
      ok(runtimeChecks > checksBeforeDelete, 'pair 消失時必須真的重跑工具檢查，而不是沿用 60 秒舊 cache：');
    } finally {
      ffmpegProviderForCacheTest.resolveFfmpegPaths = originalResolveFfmpegPaths;
      ffmpegProviderForCacheTest.hasDownloadedPair = originalHasDownloadedPair;
      systemCheck.clearCache();
    }

    const root = path.join(__dirname, '..');
    const api = readApiRoutesSource();
    const nav = fs.readFileSync(path.join(root, 'public/js/nav.js'), 'utf8');
    const page = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
    const frontend = fs.readFileSync(path.join(root, 'public/js/app-diagnostics.js'), 'utf8');
    ok(api.includes("router.get('/diagnostics/export', requirePin"));
    ok(api.includes("router.post('/diagnostics/reliability/reset', requirePin"));
    ok(api.includes("req.query?.force === '1'"), 'system-check API 必須支援手動強制跳過 cache：');
    ok(api.includes("res.set('Cache-Control', 'no-store')"), 'system-check 不可再被瀏覽器 HTTP cache 留住舊狀態：');
    ok(nav.includes("'/api/system-check?force=1'"), '重新檢查按鈕必須呼叫強制 system-check：');
    ok(nav.includes("{ cache: 'no-store' }"), '前端 system-check fetch 也應明確停用 HTTP cache：');
    ok(page.includes('diagnostic-export-btn'));
    ok(page.includes('reliability-reset-btn'));
    ok(frontend.includes("PinAuth.fetchWithPin('/api/diagnostics/export'"));
    ok(frontend.includes("PinAuth.fetchWithPin('/api/diagnostics/reliability/reset'"));
    const i18nFrontend = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'i18n.js'), 'utf8');
    ok(
      frontend.includes("t('diagnostics.thresholdMet')") &&
      frontend.includes("t('diagnostics.thresholdRemaining'") &&
      frontend.includes('R12_MINIMUM_OBSERVED_MS') &&
      i18nFrontend.includes("'diagnostics.thresholdMet': ['四小時時長門檻已達成'") &&
      i18nFrontend.includes("'diagnostics.thresholdRemaining': ['距四小時時長門檻還差 {duration}'"),
      '控制台必須以可翻譯字串清楚提示 R12 的時長門檻，而不是宣稱已完成直播驗收: '
    );
  } finally {
    fs.rmSync(logDir, { recursive: true, force: true });
  }
});

test('system-check 真的重新探測時會記依賴狀態遙測，命中快取不重複記', () => {
  // 用子行程隔離：主測試行程裡有其他測試（loudness backfill 等）也會在背景
  // 真的呼叫 systemCheck.getSystemCheck()，跟這裡 monkey-patch 的共用 singleton
  // 撞在一起會讓呼叫次數不可預期。子行程給一個乾淨、沒有其他背景活動的環境。
  const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-syscheck-telemetry-'));
  const systemCheckPath = path.join(__dirname, '..', 'server', 'services', 'system-check.js');
  const script = `
    const systemCheck = require(process.argv[1]);
    const usageTelemetry = require(require('path').join(require('path').dirname(process.argv[1]), 'usage-telemetry'));
    const deps = [];
    usageTelemetry.recordDependency = (name, ok) => { deps.push([name, ok]); return true; };
    (async () => {
      systemCheck._resetForTests();
      await systemCheck.getSystemCheck({
        force: true,
        compatibility: { getStatus: () => ({ state: 'ok', message: 'metadata only' }) },
        execFileImpl: async (command) => {
          if (command === 'yt-dlp') return { stdout: '2026.07\\n', stderr: '' };
          throw new Error('ffmpeg missing');
        },
        now: () => 5000,
      });
      const afterProbe = deps.slice();
      deps.length = 0;
      // 命中 60 秒快取時不該重新呼叫 recordDependency——沒有真的重新探測，
      // 記了也只是重複同一個布林值，白白多做事。
      await systemCheck.getSystemCheck({
        compatibility: { getStatus: () => ({ state: 'ok', message: 'metadata only' }) },
        execFileImpl: async () => { throw new Error('不該被呼叫：應該命中快取'); },
        now: () => 5000,
      });
      process.stdout.write('__RESULT__' + JSON.stringify({ afterProbe, afterCacheHit: deps }));
      process.exit(0);
    })();
  `;
  try {
    const result = require('child_process').spawnSync(process.execPath, ['-e', script, systemCheckPath], {
      encoding: 'utf8', env: { ...process.env, ELITESAND_DATA_DIR: tempData }, timeout: 10000,
    });
    ok(result.status === 0, result.stderr || 'system-check 遙測子程序失敗: ');
    const payload = JSON.parse((result.stdout.split('__RESULT__')[1] || '{}').trim());

    eq(payload.afterProbe.length, 2, '應該各記一次 ytdlp 與 ffmpeg 的狀態: ');
    ok(payload.afterProbe.some(([name, v]) => name === 'ytdlp' && v === true), 'yt-dlp 可用應記為 true: ');
    ok(payload.afterProbe.some(([name, v]) => name === 'ffmpeg' && v === false), 'ffmpeg 探測失敗應記為 false: ');
    eq(payload.afterCacheHit.length, 0, '快取命中不該重複記錄依賴狀態: ');
  } finally { fs.rmSync(tempData, { recursive: true, force: true }); }
});

// 清理規則是診斷包與問題回報共用的唯一實作。這裡刻意同時測「該遮的有遮」與
// 「不該動的沒動」——過度清理會讓回報變成一堆 [redacted]，跟外洩一樣讓功能失效。
test('清理模組遮蔽憑證與個資，並保留除錯所需的一般內容', () => {
  const { redactDiagnosticText, redactValue } = require('../server/utils/redaction');

  const mustRedact = [
    ['Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abcdefghij.KLMNOPqrst', 'KLMNOPqrst'],
    ['access_token=abc123def&foo=1', 'abc123def'],
    ['{"refresh_token":"r-secret-value","user":"bob"}', 'r-secret-value'],
    ['Cookie: SID=xyz-session; HSID=abc', 'xyz-session'],
    ['contact me at streamer@example.com thanks', 'streamer@example.com'],
    ['https://api.example.com/x?token=SECRETVALUE&v=1', 'SECRETVALUE'],
    ['PIN: 123456', '123456'],
    ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K27u', 'dBjftJeZ4CVPmB92K27u'],
    ['Twitch 已授權頻道：streamer_private', 'streamer_private'],
    ['C:\\Users\\kaito\\Desktop\\a.mp3', 'kaito'],
    ['C:\\Users\\陳小明\\Desktop\\a.mp3', '陳小明'],
    ['D:/Users/kaito/downloads/a.mp3', 'kaito'],
    ['read C:\\MyPersonalFolder\\b.mp3 failed', 'MyPersonalFolder'],
  ];
  mustRedact.forEach(([input, secret]) => {
    ok(!redactDiagnosticText(input).includes(secret), `必須遮蔽 ${secret}: `);
  });

  const mustKeep = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&t=42', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&t=42', 'list=PL123'],
    ['access_token=abc123def&foo=1', 'foo=1'],
    ['ERROR: [youtube] dQw4w9WgXcQ: Video unavailable', 'Video unavailable'],
    ['正在下載《夜に駆ける》 - YOASOBI', '夜に駆ける'],
    ['匯入完成：已加入播放清單第 3 首', '已加入播放清單第 3 首'],
    ['read C:\\MyPersonalFolder\\b.mp3 failed', 'failed'],
    ['ffmpeg at C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe ok', 'Program Files'],
    ['loaded C:\\Windows\\System32\\dwrite.dll', 'System32'],
    ['C:\\Users\\kaito\\AppData\\Roaming\\Elitesand Pro\\logs\\app.log', 'AppData'],
  ];
  mustKeep.forEach(([input, keep]) => {
    ok(redactDiagnosticText(input).includes(keep), `不可過度清理，必須保留 ${keep}: `);
  });

  eq(redactDiagnosticText(''), '');
  eq(redactDiagnosticText(null), '');
  ok(redactDiagnosticText('x'.repeat(50000)).length === 50000, '一般長字串不應被截斷: ');

  const redactedObject = redactValue({
    ok: 'keep-me',
    accessToken: 'secret-1',
    nested: { cookie: 'secret-2', apiKey: 'secret-3', title: '夜に駆ける' },
  });
  eq(redactedObject.ok, 'keep-me');
  eq(redactedObject.accessToken, '[redacted]');
  eq(redactedObject.nested.cookie, '[redacted]');
  eq(redactedObject.nested.apiKey, '[redacted]');
  eq(redactedObject.nested.title, '夜に駆ける');

  // 診斷包不可以自己再寫一份規則：兩邊分岔會出現「診斷包乾淨但回報外洩」。
  const bundleSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'diagnostic-bundle.js'), 'utf8');
  ok(bundleSource.includes("require('../utils/redaction')"), '診斷包必須共用 utils/redaction: ');
  ok(!bundleSource.includes('function redactDiagnosticText'), '診斷包不可保留自己的 redactor 實作: ');
});

test('問題回報 schema 拒絕不完整或超長的內容', () => {
  const feedbackReport = require('../server/services/feedback-report');
  const base = {
    schemaVersion: 1, type: 'obs', title: '切歌時閃白底',
    description: '切到下一首時 OBS 歌詞來源會閃一格白底。',
    steps: '加入來源\n按下一首', actual: '閃白', includeDiagnostics: false,
  };
  ok(feedbackReport.validateReport(base).ok, '完整內容應通過: ');

  const codeFor = (patch) => {
    const result = feedbackReport.validateReport({ ...base, ...patch });
    return result.ok ? null : result.errors.map((error) => `${error.field}:${error.code}`).join(',');
  };
  eq(codeFor({ schemaVersion: 99 }), 'schemaVersion:UNSUPPORTED_SCHEMA');
  eq(codeFor({ type: 'nope' }), 'type:INVALID_TYPE');
  eq(codeFor({ title: '' }), 'title:TOO_SHORT');
  eq(codeFor({ title: 'x'.repeat(121) }), 'title:TOO_LONG');
  eq(codeFor({ description: '太短' }), 'description:TOO_SHORT');
  eq(codeFor({ steps: '' }), 'steps:TOO_SHORT');
  eq(codeFor({ steps: Array.from({ length: 21 }, (_, i) => `step ${i}`) }), 'steps:TOO_MANY');
  eq(codeFor({ actual: '' }), 'actual:TOO_SHORT');
  eq(codeFor({ contact: 'x'.repeat(201) }), 'contact:TOO_LONG');

  // 使用者可能直接把含 token 的錯誤訊息貼進說明欄，組報告時必須一併清理。
  const leaky = feedbackReport.buildReport({
    ...base,
    description: '匯入失敗，訊息是 Authorization: Bearer ghp_USER_PASTED_SECRET 在 C:\\Users\\kaito\\Music 底下',
  });
  ok(leaky.ok);
  ok(!leaky.plainText.includes('ghp_USER_PASTED_SECRET'), '使用者貼上的憑證必須被遮蔽: ');
  ok(!leaky.plainText.includes('kaito'), '使用者名稱必須被遮蔽: ');

  // 報告內文固定繁中，不跟著介面語言跑，否則維護者會收到看不懂的 issue。
  const japanese = feedbackReport.buildReport({ ...base, locale: 'ja' });
  ok(japanese.plainText.includes('## 問題說明'), '報告內文必須固定繁體中文: ');
  ok(japanese.plainText.includes('介面語言：ja'), '使用者語言必須另外記錄: ');
  ok(japanese.report.issueLabels.includes('source:in-app'));

  const spout = feedbackReport.buildReport({
    ...base,
    type: 'spout',
    includeDiagnostics: true,
    spoutDiagnostics: {
      schemaVersion: 1, active: true, durationMs: 5000,
      senderName: 'Personal Sender Name',
      samples: [{
        elapsedMs: 5000, state: 'running', width: 1920, height: 1080, configuredFps: 30,
        framesSent: 150, framesReceived: 149, framesDropped: 1,
        gpuSync: { lastMs: 10, averageMs: 9, maxMs: 12, timeouts: 0 },
        sourceCopySync: { lastMs: 6, averageMs: 5, maxMs: 8, timeouts: 0 },
        adapter: { vendorId: 4318, deviceId: 9476, luid: 'machine-unique-value' },
      }],
    },
  });
  ok(spout.ok && spout.plainText.includes('## Spout 透明輸出紀錄'), 'Spout report must attach its bounded diagnostics: ');
  ok(spout.report.issueLabels.includes('type:spout'), 'Spout report must carry a dedicated issue label: ');
  ok(!spout.plainText.includes('Personal Sender Name') && !spout.plainText.includes('machine-unique-value'), 'Spout diagnostics must exclude sender and LUID: ');

  // 回歸測試（GitHub issue #15）：使用者填的「聯絡方式」是唯一能回覆他們的管道，
  // 不可以被同一份 email 遮蔽規則自己吃掉——那樣使用者等於白留了聯絡方式。
  const withContact = feedbackReport.buildReport({ ...base, contact: 'muffin215 / email：streamer@example.com' });
  ok(withContact.ok);
  ok(withContact.plainText.includes('streamer@example.com'), '使用者主動留的聯絡 email 不可被遮蔽（issue #15）: ');
  // 同時確認說明欄裡「不小心貼進去」的 email 仍然要被遮蔽——不是整支關掉 email 規則。
  const leakyEmail = feedbackReport.buildReport({ ...base, description: '匯入失敗，已經寄信到 leaked@example.com 詢問過了' });
  ok(leakyEmail.ok);
  ok(!leakyEmail.plainText.includes('leaked@example.com'), '說明欄裡意外貼上的 email 仍必須遮蔽: ');
});

test('問題回報缺少外部工具或日誌時仍能產出報告', () => {
  const feedbackReport = require('../server/services/feedback-report');
  const emptyDir = path.join(os.tmpdir(), `elitesand-feedback-${Date.now()}`);
  fs.mkdirSync(emptyDir, { recursive: true });
  try {
    // 沒有 systemCheck、沒有連線觀測、日誌目錄是空的——這些都不該讓回報送不出去。
    const built = feedbackReport.buildReport({
      schemaVersion: 1, type: 'other', title: '沒有工具也要能回報',
      description: '在缺少 yt-dlp 與 FFmpeg 的機器上也要能送出回報。',
      steps: '什麼都不做', actual: '不確定',
    }, { logDir: emptyDir });
    ok(built.ok);
    ok(built.plainText.includes('工具健康狀態：取不到') || built.plainText.includes('yt-dlp：找不到'));
    ok(built.plainText.includes('沒有可用的日誌'), '缺日誌要如實說明，不是假裝有資料: ');
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});

test('安裝識別碼是隨機 UUID，且不使用任何硬體指紋', () => {
  const installIdModule = require('../server/services/install-id');
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'install-id.js'), 'utf8');
  ok(source.includes('crypto.randomUUID'), '必須是隨機 UUID: ');
  ['networkInterfaces', 'cpus', 'hostname', 'machineId', 'serial'].forEach((forbidden) => {
    ok(!source.includes(forbidden), `不可使用 ${forbidden} 之類的機器指紋: `);
  });

  const dir = path.join(os.tmpdir(), `elitesand-installid-${Date.now()}`);
  const file = path.join(dir, 'install-id.json');
  try {
    installIdModule._resetForTests();
    const first = installIdModule.getInstallId({ file });
    installIdModule._resetForTests();
    const second = installIdModule.getInstallId({ file });
    eq(second, first, '同一台機器必須讀回同一個識別碼: ');
    ok(/^[0-9a-f-]{36}$/i.test(first));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('非正常結束偵測：只有走完乾淨關閉才算 clean，其餘一律 fail-safe 成「不是當機」', () => {
  const sessionMarker = require('../server/services/session-marker');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-marker-'));
  const file = path.join(dir, '.session-marker');
  try {
    // 全新安裝：沒有標記檔不等於當機。
    sessionMarker._resetForTests();
    let state = sessionMarker.markStarted({ file, now: () => 1000 });
    eq(state.wasClean, true, '首次啟動不可誤報當機: ');
    ok(state.firstRun, '首次啟動要標記 firstRun: ');

    // 走完 gracefulShutdown → 下次啟動是 clean。
    sessionMarker.markClean('SIGINT', { file, now: () => 2000 });
    eq(JSON.parse(fs.readFileSync(file, 'utf8')).clean, true);
    sessionMarker._resetForTests();
    eq(sessionMarker.markStarted({ file, now: () => 3000 }).wasClean, true, '乾淨關閉後不可報當機: ');

    // 沒走到 markClean 就再啟動 → 判定為非正常結束。
    sessionMarker._resetForTests();
    state = sessionMarker.markStarted({ file, now: () => 4000 });
    eq(state.wasClean, false, '未乾淨關閉必須被偵測到: ');
    eq(state.previousStartedAt, 3000, '要帶出上次啟動時間當事件鍵: ');

    // 壞掉/空的標記檔絕不能誤報成當機——誤報會讓使用者以為程式有問題。
    ['{壞掉的 json', ''].forEach((broken) => {
      fs.writeFileSync(file, broken, 'utf8');
      sessionMarker._resetForTests();
      eq(sessionMarker.markStarted({ file, now: () => 5000 }).wasClean, true, `標記檔為 ${JSON.stringify(broken)} 時不可誤報: `);
    });

    // 寫不進去（唯讀/權限）時只停用偵測，不可讓伺服器起不來。
    sessionMarker._resetForTests();
    const unavailable = sessionMarker.markStarted({ file: path.join(dir, 'no-such-dir', 'x', '.session-marker'), fs: {
      readFileSync() { throw new Error('nope'); },
      mkdirSync() { throw new Error('read-only'); },
      writeFileSync() { throw new Error('read-only'); },
    } });
    eq(unavailable.wasClean, true, '無法寫入標記時不可誤報當機: ');
  } finally {
    sessionMarker._resetForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('非正常結束偵測在 node --watch 下自動停用', () => {
  const sessionMarker = require('../server/services/session-marker');
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'session-marker.js'), 'utf8');
  // 2026-08-01 實測：Windows 的 node --watch 重啟是硬砍（SIGTERM 以 TerminateProcess
  // 實作、攔不到），gracefulShutdown 完全不會跑。不排除的話開發者每存一次檔就被當成當機。
  ok(/execArgv/.test(source) && /--watch/.test(source), 'watch 模式必須自動停用偵測: ');
  ok(source.includes('ELITESAND_DISABLE_CRASH_DETECT'), '必須保留可明確停用的環境變數: ');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-marker-watch-'));
  const file = path.join(dir, '.session-marker');
  const original = process.env.ELITESAND_DISABLE_CRASH_DETECT;
  try {
    // 先製造一次「未乾淨關閉」，再確認停用時不會據此報當機。
    sessionMarker._resetForTests();
    sessionMarker.markStarted({ file, now: () => 1000 });
    process.env.ELITESAND_DISABLE_CRASH_DETECT = '1';
    sessionMarker._resetForTests();
    const state = sessionMarker.markStarted({ file, now: () => 2000 });
    eq(state.wasClean, true, '停用時一律視為正常: ');
    eq(state.disabled, true);
    eq(sessionMarker.markClean('x', { file }), false, '停用時不可寫標記檔: ');
  } finally {
    if (original === undefined) delete process.env.ELITESAND_DISABLE_CRASH_DETECT;
    else process.env.ELITESAND_DISABLE_CRASH_DETECT = original;
    sessionMarker._resetForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('當機提示接在既有回報流程上，且絕不自動送出', () => {
  const root = path.join(__dirname, '..');
  const indexSource = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
  const api = readApiRoutesSource();
  const frontend = fs.readFileSync(path.join(root, 'public/js/app-feedback.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

  // markClean 必須是 gracefulShutdown 的第一件事：後面有 8 秒硬退保底，
  // 放後面的話「關閉流程自己卡住」會被下次啟動誤判成當機。
  const shutdownBody = indexSource.slice(indexSource.indexOf('async function gracefulShutdown'));
  const cleanAt = shutdownBody.indexOf('markClean');
  const stateFlushAt = shutdownBody.indexOf("state-store').saveNow");
  ok(cleanAt > -1, 'gracefulShutdown 必須標記乾淨關閉: ');
  ok(cleanAt < stateFlushAt, 'markClean 必須早於 flush，否則硬退保底會來不及寫: ');
  ok(indexSource.includes('markStarted'), '啟動時必須寫下標記: ');

  // 狀態端點只回布林與時間戳，不含診斷內容。
  ok(api.includes('lastSessionCrashed'), '狀態端點要回報上次是否非正常結束: ');
  ok(page.includes('id="crash-banner"'), '面板需要當機提示 banner: ');

  // 核心承諾：沒有任何「不經預覽直接送出」的路徑。
  ok(!/crash[^\n]*submitReport\(/.test(frontend), '當機提示不可直接呼叫送出: ');
  ok(frontend.includes('CRASH_HANDLED_KEY'), '同一次事件只能提示一次: ');
});

test('問題回報端點受 PIN 保護，且中繼未設定時安全停用', () => {
  const root = path.join(__dirname, '..');
  const api = readApiRoutesSource();
  const frontend = fs.readFileSync(path.join(root, 'public/js/app-feedback.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'server/services/feedback-client.js'), 'utf8');

  // 鐵則 15：會外送資料的新路由要逐一手動掛 requirePin。
  ok(api.includes("router.post('/feedback/preview', requirePin"), '預覽端點必須掛 requirePin: ');
  ok(api.includes("router.post('/feedback/submit', requirePin"), '送出端點必須掛 requirePin: ');
  // 鐵則 16：面板受保護的 fetch 一律用 PinAuth.fetchWithPin。
  ok(frontend.includes("PinAuth.fetchWithPin('/api/feedback/preview'"), '預覽必須帶 PIN: ');
  ok(frontend.includes("PinAuth.fetchWithPin('/api/feedback/submit'"), '送出必須帶 PIN: ');
  ok(page.includes('feedback-preview-btn') && page.includes('feedback-submit-btn'));
  ok(page.includes('/js/app-feedback.js'), '面板必須載入回報模組: ');

  // 送出必須由伺服器重新組報告，不能直接採用前端傳來的成品，
  // 否則「預覽到的就是送出的」這個承諾在架構上不成立。
  const submitHandler = api.slice(api.indexOf("router.post('/feedback/submit'"));
  ok(submitHandler.includes('feedbackReport.buildReport'), '送出必須在伺服器端重組報告: ');

  // 憑證不在客戶端：整個 App 端不可出現任何 GitHub token 或建立 issue 的呼叫。
  ok(!client.includes('api.github.com'), 'App 端不可直接呼叫 GitHub: ');
  ok(!/gh[pousr]_[A-Za-z0-9]{20,}/.test(client + api + frontend), 'App 端不可內嵌 GitHub token: ');

  // 明文外送防線：只有 https 或本機中繼才啟用。
  ok(client.includes("endpoint.startsWith('https://')"), '對外必須要求 HTTPS: ');

  const configExample = fs.readFileSync(path.join(root, 'server/config.example.js'), 'utf8');
  // Worker 已於 2026-07-31 部署並端到端驗證通過（見 STATUS.md），範本填的是官方中繼的
  // 真實網址，讓一般使用者不必自己申請 Cloudflare 帳號就能用。這裡只驗證它是合法的
  // https 端點、指向正確的 Worker，不是隨口填的字串或誤留的本機測試網址。
  // 動態文字必須「存語意、切語言時重繪」。2026-08-01 實測踩過：驗證錯誤與送出狀態
  // 直接塞翻譯後的字串進 textContent，切成日文後畫面會卡在繁中（memory
  // i18n-auto-catalog-traps）。專案裡每個有動態文字的模組都監聽 i18n:change。
  ok(frontend.includes("addEventListener('i18n:change'"), '回報模組必須在切換語言時重繪動態文字: ');
  ['renderFormError', 'renderStatus', 'renderPreviewSize'].forEach((renderer) => {
    ok(frontend.includes(`${renderer}()`), `切換語言時必須重繪 ${renderer}: `);
  });
  // setStatus/showFormError 只能收 key 或錯誤結構，收不到「已經翻譯完的字串」，
  // 否則就回到卡住語言的老路。
  ok(!/setStatus\(\s*`/.test(frontend) && !/setStatus\(\s*t\(/.test(frontend), 'setStatus 不可接收已翻譯字串: ');
  ok(!/showFormError\(\s*t\(/.test(frontend), 'showFormError 不可接收已翻譯字串: ');

  const feedbackEndpointLine = configExample.match(/feedbackEndpoint:\s*'[^']*'/);
  ok(feedbackEndpointLine, 'feedbackEndpoint 必須存在: ');
  ok(/^feedbackEndpoint:\s*'https:\/\/elitesand-pro-feedback\.[^']+\/api\/v1\/reports'$/.test(feedbackEndpointLine[0]), '範本必須指向已部署的官方中繼: ');
  ok(!feedbackEndpointLine[0].includes('127.0.0.1') && !feedbackEndpointLine[0].includes('localhost'), '回報端點不可殘留本機測試位址: ');
  ok(configExample.includes('feedbackEnabled'), '範本必須提供緊急停用開關: ');
});

test('發版稽核只檢查 production dependencies，且預設任何等級風險都會失敗', () => {
  const manifest = require('../package.json');
  // 2026-09-10：從 `npm audit --omit=dev --audit-level=low` 換成自寫的閘門。
  // 原因是出現了「advisory 對我們的用法不成立、但上游沒有修好的版本」的情況
  // （adm-zip GHSA-vwc7-r8mq-g2x9）：調鬆 --audit-level 會連帶放行所有同等級的
  // 真漏洞，讓閘門永遠紅則會被習慣性忽略，兩種都等於廢掉它。改成白名單例外，
  // 預設仍是零容忍。本測試守的就是「不可以被偷偷放寬」。
  eq(manifest.scripts['audit:release'], 'node tools/audit-release.js');

  const gate = fs.readFileSync(path.join(__dirname, '../tools/audit-release.js'), 'utf8');
  const auditCommand = (gate.match(/const AUDIT_COMMAND = '([^']+)'/) || [])[1] || '';
  ok(/\bnpm audit\b/.test(auditCommand), '閘門必須真的跑 npm audit: ');
  ok(auditCommand.includes('--omit=dev'), '仍必須只檢查 production dependencies: ');
  // electron 放在 devDependencies，但它是出貨的 runtime：--omit=dev 會漏掉它，必須另外納入
  ok(/SHIPPED_DEV_PACKAGES = new Set\(\[[^\]]*'electron'/.test(gate), '出貨的 electron runtime 也必須受閘門檢查: ');
  ok(gate.includes('.filter(([name]) => SHIPPED_DEV_PACKAGES.has(name))'), '完整 audit 只可併入會出貨的 dev 套件: ');
  // 註解裡解釋為什麼不用 --audit-level 是可以的；真正不能出現在實際命令裡
  ok(!/--audit-level/.test(auditCommand), '實際命令不可以用 --audit-level 放寬整個等級: ');
  // fail-closed：不在白名單上的一律擋下
  ok(/if \(ACKNOWLEDGED\[id\]\) waived\.push\(entry\); else blocking\.push\(entry\)/.test(gate),
    '未列入 ACKNOWLEDGED 的 advisory 必須進 blocking: ');
  ok(/if \(blocking\.length\)[\s\S]{0,400}process\.exit\(1\)/.test(gate), 'blocking 非空時必須以非 0 結束: ');

  // 每一筆豁免都要有理由與複查日，且過期就讓閘門失敗——避免例外變成永久免死金牌
  const acknowledged = gate.slice(gate.indexOf('const ACKNOWLEDGED'), gate.indexOf('function main'));
  const ids = acknowledged.match(/'GHSA-[a-z0-9-]+':/g) || [];
  eq(ids.length, (acknowledged.match(/reviewOn:/g) || []).length, '每筆豁免都要有 reviewOn: ');
  eq(ids.length, (acknowledged.match(/why:/g) || []).length, '每筆豁免都要有 why: ');
  ok(/today > ack\.reviewOn[\s\S]{0,200}process\.exit\(1\)/.test(gate), '複查日過期必須讓閘門失敗: ');
});

test('adm-zip 豁免的前提還成立：全 repo 沒有 extractAllTo，safeExtractAll 有測試守著', () => {
  // tools/audit-release.js 放行 GHSA-vwc7-r8mq-g2x9 的理由是「已經不用 extractAllTo」。
  // 一旦有人把它加回來，那個豁免就失去正當性，這裡先擋下。
  const dirs = ['server', 'electron', 'tools'];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const text = fs.readFileSync(full, 'utf8');
      // 註解裡提到不算，實際呼叫才算
      if (/\.extractAllTo\s*\(/.test(text)) offenders.push(full);
    }
  };
  dirs.forEach((d) => walk(path.join(__dirname, '..', d)));
  eq(offenders.length, 0, `不可再呼叫 extractAllTo（改用 safeExtractAll）：${offenders.join(', ')}: `);

  const manifest = require('../package.json');
  ok(manifest.scripts.test.includes('tests/safe-zip-extract.test.js'),
    'safeExtractAll 的攻擊面測試必須掛進 npm test: ');
});

testAsync('legacy release metadata adapter remains read-only and is not wired to the cold-start gate', async () => {
  const release = {
    tag_name: 'v9.9.9', html_url: 'https://example.test/release',
    assets: [
      { name: 'update.zip', browser_download_url: 'https://example.test/update.zip' },
      { name: 'update.zip.sha256', browser_download_url: 'https://example.test/update.zip.sha256' },
      { name: 'Elitesand.Pro.Setup.9.9.9.exe', browser_download_url: 'https://example.test/installer.exe' },
    ],
  };
  let releaseCalls = 0;
  const plan = await appUpdater.getPlan({
    repo: 'owner/repo',
    fetchLatestRelease: async () => { releaseCalls += 1; return release; },
  });
  eq(releaseCalls, 1);
  eq(plan.canIncremental, false);
  eq(plan.needsFull, true);
  eq(plan.downloadUrl, 'https://example.test/installer.exe');
  ok(/Windows Installer/.test(plan.reason));
  const updaterSource = fs.readFileSync(path.join(__dirname, '../server/services/app-updater.js'), 'utf8');
  const getPlanSource = updaterSource.slice(updaterSource.indexOf('async function getPlan'), updaterSource.indexOf('function ensureInside'));
  ok(!getPlanSource.includes('downloadReleaseUpdate('), '檢查更新不可預先下載 update.zip: ');
  const shellSource = fs.readFileSync(path.join(__dirname, '../electron/shell.js'), 'utf8');
  const coordinatorSource = fs.readFileSync(path.join(__dirname, '../server/services/startup-update-coordinator.js'), 'utf8');
  ok(!shellSource.includes('app-updater') && !coordinatorSource.includes('app-updater'), 'P4 gate 不可接到 legacy updater: ');
});

test('首頁必須手動檢查更新，只有確認有新版本後才能重新啟動', () => {
  const toastSource = fs.readFileSync(path.join(__dirname, '../public/js/app-toast-utils.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const restartSource = fs.readFileSync(path.join(__dirname, '../public/js/app-restart-update-check.js'), 'utf8');

  ok(!toastSource.includes('/api/app-update/') && !toastSource.includes('fetch('), '首頁不可查詢更新計畫: ');
  ok(!indexHtml.includes('update-banner') && indexHtml.includes('id="app-update-check-btn"'), '首頁必須保留手動檢查更新按鈕: ');
  ok(indexHtml.includes('id="app-version-current"') && indexHtml.includes('id="app-update-status"'), '首頁必須顯示目前版本與檢查結果: ');
  ok(indexHtml.includes('id="app-update-restart-btn"') && indexHtml.includes('id="app-update-download-btn"'),
    '首頁必須保留重新啟動入口，以及沒有簽章驗證的 GitHub fallback 專用的前往下載頁入口: ');
  ok(restartSource.includes("fetch('/api/health'") && restartSource.includes("fetch('/api/update-check?force=1'"), '更新檢查必須由使用者手動觸發: ');
  ok(!restartSource.includes('/api/app-update/') && restartSource.includes('openGithubReleasePage'), '前端不可自行下載或套用更新: ');
  // GitHub fallback 沒有 Cloudflare 簽章驗證：「重新啟動並更新」按了不會真的更新到新版
  // （沒有已驗證的 plan 可套用），只能開瀏覽器讓使用者自己去下載頁——這裡鎖死這條契約，
  // 避免以後又不小心把 restartButton 接回這個沒有驗證過的流程。
  ok(!restartSource.includes('restartForUpdateCheck') && /restartButton\.hidden\s*=\s*true/.test(restartSource),
    'GitHub fallback（未簽章）永遠不可觸發重新啟動並套用，只能開下載頁: ');
  ok(!fs.existsSync(path.join(__dirname, '../public/js/app-update-check.js')), '舊的前端更新模組必須移除: ');

  // 冷啟動 gate 已檢查過的結果要能帶進執行中的面板：面板讀 main process 記住的
  // pending plan（不是再打一次網路檢查），有更新時側欄亮點、卡片直接顯示「現在更新」。
  const i18n = require('../public/js/i18n');
  const preloadSource = fs.readFileSync(path.join(__dirname, '../electron/preload.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(__dirname, '../electron/shell.js'), 'utf8');
  ok(preloadSource.includes("ipcRenderer.invoke('elitesand:pending-update')"), 'preload 必須橋接 pending-update 查詢: ');
  ok(shellSource.includes("ipcMain.handle('elitesand:pending-update'") && shellSource.includes('rememberPendingUpdate'),
    'shell 必須在冷啟動 prompt 時記住 plan，並用唯讀 IPC 回傳: ');
  ok(indexHtml.includes('id="system-nav-badge"'), '側欄「連線與系統」必須有可更新指示點: ');
  ok(restartSource.includes('loadPendingUpdate') && restartSource.includes("'pendingAvailable'"),
    '面板載入時要反映冷啟動已知的可更新狀態，不需再手動檢查一次: ');
  ['appUpdate.updateNow', 'appUpdate.pendingFound', 'appUpdate.navBadgeTitle'].forEach((key) => {
    i18n.LOCALES.forEach((locale) => ok(String(i18n.catalogs[locale][key] || '').trim(), `${locale}.${key} 不得為空: `));
  });
});

test('更新檢查會納入 prerelease、排除 draft，並挑最高版本', () => {
  const result = selectLatestRelease([
    { tag_name: 'v0.7.1', prerelease: true, draft: false },
    { tag_name: 'v0.7.0', prerelease: false, draft: false },
    { tag_name: 'v9.0.0', prerelease: false, draft: true },
  ]);
  eq(result.tag_name, 'v0.7.1');
});

test('更新檢查在相同 core version 優先選正式版', () => {
  const result = selectLatestRelease([
    { tag_name: 'v0.7.4-p0-test.2', prerelease: true, draft: false },
    { tag_name: 'v0.7.4', prerelease: false, draft: false },
  ]);
  eq(result.tag_name, 'v0.7.4');
});

test('增量更新必須同時有 update.zip 與 SHA-256 驗證檔', () => {
  const good = findVerifiedUpdateAssets({ assets: [
    { name: 'update.zip', browser_download_url: 'zip' },
    { name: 'update.zip.sha256', browser_download_url: 'hash' },
  ] });
  ok(good?.zip && good?.checksum);
  eq(findVerifiedUpdateAssets({ assets: [{ name: 'update.zip' }] }), null);
  eq(findVerifiedUpdateAssets({ assets: [{ name: 'update.zip.sha256' }] }), null);
  eq(findVerifiedUpdateAssets({ assets: [{ name: 'Elitesand-Pro-portable.zip' }, { name: 'Elitesand-Pro-portable.zip.sha256' }] }), null);
  eq(findVerifiedUpdateAssets({ assets: [{ name: 'source.zip' }, { name: 'source.zip.sha256' }] }), null);
  eq(findVerifiedUpdateAssets({ assets: [{ name: 'Elitesand-Pro-update.zip' }, { name: 'Elitesand-Pro-update.zip.sha256' }] }), null);
});

function makeUpdateZip({ packagePatch = {}, lockPatch = {}, extraFiles = {}, version = '0.7.4' } = {}) {
  const nextPackage = { ...JSON.parse(JSON.stringify(require('../package.json'))), ...packagePatch, version };
  const nextLock = JSON.parse(JSON.stringify(require('../package-lock.json')));
  nextLock.version = version;
  if (nextLock.packages?.['']) nextLock.packages[''].version = version;
  Object.assign(nextLock, lockPatch);
  const payload = {
    'server/example.js': 'module.exports = 2;\n',
    'public/example.js': 'window.example = 2;\n',
    'package.json': JSON.stringify(nextPackage),
    'package-lock.json': JSON.stringify(nextLock),
    ...extraFiles,
  };
  const manifest = { schemaVersion: 1, version, files: Object.keys(payload).sort() };
  const zip = new AdmZip();
  for (const [name, value] of Object.entries(payload)) zip.addFile(name, Buffer.from(value));
  zip.addFile('update-manifest.json', Buffer.from(JSON.stringify(manifest)));
  return zip.toBuffer();
}

test('安全更新包：固定白名單、manifest 與不變 dependencies 可通過', () => {
  const inspected = appUpdater.inspectUpdateZip(makeUpdateZip(), { expectedVersion: '0.7.4' });
  ok(inspected.ok);
  eq(inspected.version, '0.7.4');
});

test('SHA-256 檔必須恰為 64 個十六進位字元', () => {
  ok(appUpdater.parseStrictHash('a'.repeat(64)));
  eq(appUpdater.parseStrictHash(`a`.repeat(64) + '  update.zip'), null);
  eq(appUpdater.parseStrictHash('xyz'), null);
});

test('Zip Slip、絕對路徑、磁碟代號與反斜線一律拒絕', () => {
  for (const unsafe of ['../evil.js', '/evil.js', 'C:/evil.js', 'server\\evil.js', 'server/../evil.js']) {
    ok(!appUpdater.isSafeRelativePath(unsafe), `${unsafe} 不可通過: `);
  }
});

test('更新白名單拒絕 data、downloads、logs、node_modules 與任意根檔', () => {
  for (const unsafe of ['data/state.json', 'downloads/song.mp3', 'logs/x.log', 'node_modules/x/a.js', 'README.md', '.git/config']) {
    ok(!appUpdater.isAllowedEntry(unsafe), `${unsafe} 不可通過: `);
  }
  ok(appUpdater.isAllowedEntry('server/index.js'));
  ok(appUpdater.isAllowedEntry('public/js/app.js'));
});

test('dependencies 或 lockfile 結構改變時 needsFull=true', () => {
  const changedDeps = makeUpdateZip({ packagePatch: { dependencies: { ...require('../package.json').dependencies, unsafeNewDep: '^1.0.0' } } });
  const inspected = appUpdater.inspectUpdateZip(changedDeps, { expectedVersion: '0.7.4' });
  ok(!inspected.ok && inspected.needsFull);

  const changedLock = JSON.parse(JSON.stringify(require('../package-lock.json')));
  changedLock.packages['node_modules/express'].version = '99.0.0';
  const nextPackage = { ...require('../package.json'), version: '0.7.4' };
  const zip = new AdmZip();
  const payload = {
    'server/example.js': 'x', 'public/example.js': 'x',
    'package.json': JSON.stringify(nextPackage), 'package-lock.json': JSON.stringify(changedLock),
  };
  for (const [name, value] of Object.entries(payload)) zip.addFile(name, Buffer.from(value));
  zip.addFile('update-manifest.json', Buffer.from(JSON.stringify({ schemaVersion: 1, version: '0.7.4', files: Object.keys(payload).sort() })));
  const inspectedLock = appUpdater.inspectUpdateZip(zip.toBuffer(), { expectedVersion: '0.7.4' });
  ok(!inspectedLock.ok && inspectedLock.needsFull);
});

testAsync('SHA 不符與 staging 寫入失敗都不修改正式目錄、也不要求關閉主程序', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-update-prepare-'));
  fs.mkdirSync(path.join(root, 'server'), { recursive: true });
  fs.writeFileSync(path.join(root, 'server', 'keep.js'), 'old');
  try {
    appUpdater._resetForTests();
    const badHash = await appUpdater.prepareUpdate({ targetRoot: root, zipBuffer: makeUpdateZip(), latestVersion: '0.7.4', expectedHash: '0'.repeat(64) });
    ok(!badHash.prepared);
    eq(fs.readFileSync(path.join(root, 'server', 'keep.js'), 'utf8'), 'old');

    appUpdater._resetForTests();
    const blockedWorkRoot = path.join(root, 'not-a-directory');
    fs.writeFileSync(blockedWorkRoot, 'file');
    const stagingFailure = await appUpdater.prepareUpdate({ targetRoot: root, workRoot: blockedWorkRoot, zipBuffer: makeUpdateZip(), latestVersion: '0.7.4' });
    ok(!stagingFailure.prepared);
    eq(fs.readFileSync(path.join(root, 'server', 'keep.js'), 'utf8'), 'old');
  } finally { fs.rmSync(root, { recursive: true, force: true }); appUpdater._resetForTests(); }
});

testAsync('非冷啟動簽章政策的增量更新會被拒絕，準備階段不會寫入或啟動 updater', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-update-launch-'));
  try {
    appUpdater._resetForTests();
    const prepared = await appUpdater.prepareUpdate({ targetRoot: root, zipBuffer: makeUpdateZip(), latestVersion: '0.7.4' });
    ok(!prepared.prepared && !prepared.needsFull);
    ok(/冷啟動簽章政策/.test(prepared.reason));
    ok(!fs.existsSync(path.join(root, 'server')), '拒絕時不可建立 staging 或修改目標目錄: ');
  } finally { fs.rmSync(root, { recursive: true, force: true }); appUpdater._resetForTests(); }
});

testAsync('非冷啟動簽章政策的增量更新被拒絕時不會呼叫外部 updater', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-update-node-mode-'));
  try {
    appUpdater._resetForTests();
    const prepared = await appUpdater.prepareUpdate({ targetRoot: root, zipBuffer: makeUpdateZip(), latestVersion: '0.7.4' });
    let spawnCalled = false;
    const result = await appUpdater.prepareAndLaunchUpdate({
      targetRoot: root,
      zipBuffer: makeUpdateZip(),
      latestVersion: '0.7.4',
      spawnImpl() { spawnCalled = true; },
    });
    ok(!prepared.prepared && !result.prepared && !result.needsFull);
    ok(!spawnCalled, '拒絕時不可建立外部 updater 子程序: ');
  } finally { fs.rmSync(root, { recursive: true, force: true }); appUpdater._resetForTests(); }
});

test('重啟計畫依宿主分流，且 runner 不會把 Node 模式傳染給重啟的 app', () => {
  const updaterSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'app-updater.js'), 'utf8');
  const runnerSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'app-updater-runner.js'), 'utf8');

  // 安裝版要重啟整個桌面 app，不是單獨的 server 行程。
  ok(updaterSource.includes('process.versions.electron'), '必須辨識 Electron 宿主: ');
  ok(updaterSource.includes("type: 'electron-app'"), '安裝版需要專屬的重啟方式: ');
  ok(runnerSource.includes("restart?.type === 'electron-app'"), 'runner 必須支援 electron-app 重啟: ');

  // 最容易漏的一步：runner 自己是被 ELECTRON_RUN_AS_NODE=1 啟動的，
  // 若原封不動繼承給重啟的 app，使用者會看到「更新完卻沒有視窗」。
  const restartSection = runnerSource.slice(runnerSource.indexOf('function spawnRestart'));
  const deletions = (restartSection.match(/delete env\.ELECTRON_RUN_AS_NODE/g) || []).length;
  ok(deletions >= 2, `重啟前必須清掉 ELECTRON_RUN_AS_NODE（目前 ${deletions} 處，需涵蓋 electron-app 與 node）: `);
});

test('增量更新白名單允許 EULA.txt，條款變更才搬得過去', () => {
  const updaterSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'app-updater.js'), 'utf8');
  const runnerSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'app-updater-runner.js'), 'utf8');
  const buildScript = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-update.ps1'), 'utf8');

  ok(appUpdater.isAllowedEntry('EULA.txt'), 'EULA.txt 必須是允許的更新項目: ');
  ok(updaterSource.includes("'EULA.txt'") && runnerSource.includes("'EULA.txt'"), '兩份白名單都要涵蓋 EULA.txt: ');
  // 但打包時不能無條件塞進去：舊 updater 遇到白名單外的項目會整包拒絕，
  // 對 0.9.8 以前的基準包含 EULA.txt 會讓那些使用者連更新都跑不了。
  ok(buildScript.includes('$BaselineAcceptsEula'), '建置腳本必須先確認基準版 updater 認得 EULA.txt: ');
  ok(/BaselineAcceptsEula\s*\)\s*\{[\s\S]{0,200}Copy-Item[\s\S]{0,80}EULA\.txt/.test(buildScript), 'EULA.txt 必須只在基準相容時才打包: ');

  // 放寬白名單不等於放行任意根檔；使用者資料與設定仍必須被擋。
  ['README.md', 'LICENSE', 'data/state.json', 'logs/x.log', 'server/config.js', 'node_modules/x/a.js']
    .forEach((entry) => ok(!appUpdater.isAllowedEntry(entry), `${entry} 仍不可通過: `));
});

function makeRunnerSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-runner-'));
  const workRoot = path.join(root, 'work');
  const targetRoot = path.join(root, 'app');
  const stagingRoot = path.join(workRoot, 'staging');
  const backupRoot = path.join(workRoot, 'backup');
  for (const dir of ['server', 'public', 'data', 'downloads', 'logs']) fs.mkdirSync(path.join(targetRoot, dir), { recursive: true });
  fs.mkdirSync(path.join(stagingRoot, 'server'), { recursive: true });
  fs.mkdirSync(path.join(stagingRoot, 'public'), { recursive: true });
  fs.writeFileSync(path.join(targetRoot, 'server', 'example.js'), 'old');
  fs.writeFileSync(path.join(targetRoot, 'data', 'state.json'), 'USER-DATA');
  fs.writeFileSync(path.join(targetRoot, 'downloads', 'song.mp3'), 'AUDIO');
  fs.writeFileSync(path.join(targetRoot, 'logs', 'existing.log'), 'LOG');
  fs.writeFileSync(path.join(stagingRoot, 'server', 'example.js'), 'new');
  fs.writeFileSync(path.join(stagingRoot, 'public', 'new.js'), 'new-public');
  const plan = {
    schemaVersion: 1, parentPid: 999999, targetRoot, stagingRoot, backupRoot, workRoot,
    readyFile: path.join(workRoot, 'ready'), logFile: path.join(targetRoot, 'logs', 'update.log'),
    rollbackErrorLog: path.join(targetRoot, 'logs', 'rollback-error.log'),
    files: ['server/example.js', 'public/new.js'], waitTimeoutMs: 100,
  };
  return { root, targetRoot, plan };
}

testAsync('外部 updater 成功覆蓋後清理 staging/backup，使用者資料完全保留', async () => {
  const sandbox = makeRunnerSandbox();
  try {
    const result = await updaterRunner.applyStagedUpdate(sandbox.plan, { skipRestart: true });
    ok(result.ok);
    eq(fs.readFileSync(path.join(sandbox.targetRoot, 'server', 'example.js'), 'utf8'), 'new');
    eq(fs.readFileSync(path.join(sandbox.targetRoot, 'data', 'state.json'), 'utf8'), 'USER-DATA');
    eq(fs.readFileSync(path.join(sandbox.targetRoot, 'downloads', 'song.mp3'), 'utf8'), 'AUDIO');
    eq(fs.readFileSync(path.join(sandbox.targetRoot, 'logs', 'existing.log'), 'utf8'), 'LOG');
    ok(!fs.existsSync(sandbox.plan.stagingRoot) && !fs.existsSync(sandbox.plan.backupRoot));
  } finally { fs.rmSync(sandbox.root, { recursive: true, force: true }); }
});

testAsync('外部 updater 覆蓋中途失敗會完整回滾既有檔並移除新增檔', async () => {
  const sandbox = makeRunnerSandbox();
  try {
    const result = await updaterRunner.applyStagedUpdate(sandbox.plan, { skipRestart: true, failAfter: 1 });
    ok(!result.ok);
    eq(fs.readFileSync(path.join(sandbox.targetRoot, 'server', 'example.js'), 'utf8'), 'old');
    ok(!fs.existsSync(path.join(sandbox.targetRoot, 'public', 'new.js')));
  } finally { fs.rmSync(sandbox.root, { recursive: true, force: true }); }
});

test('更新器不使用會讓 Windows standalone Node 原生終止的 fs.rmSync', () => {
  for (const filename of ['app-updater.js', 'app-updater-runner.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', filename), 'utf8');
    ok(!source.includes('fs.rmSync'), `${filename} 不可重新引入 fs.rmSync: `);
  }
});

test('安全遞迴清理拒絕更新 workRoot 外的路徑', () => {
  const sandbox = makeRunnerSandbox();
  try {
    let message = '';
    try {
      updaterRunner.removeTreeInside(sandbox.root, sandbox.plan.workRoot);
    } catch (err) {
      message = err.message;
    }
    ok(/拒絕清理/.test(message), `應拒絕 workRoot 外路徑，實際：${message}`);
    ok(fs.existsSync(sandbox.root));
  } finally { fs.rmSync(sandbox.root, { recursive: true, force: true }); }
});

test('外部 updater 在獨立 Node 子程序可完成覆蓋與清理', () => {
  const sandbox = makeRunnerSandbox();
  const planPath = path.join(sandbox.root, 'update-plan.json');
  try {
    fs.writeFileSync(planPath, JSON.stringify(sandbox.plan), 'utf8');
    const runnerPath = path.join(__dirname, '..', 'server', 'services', 'app-updater-runner.js');
    const script = [
      "const fs = require('fs');",
      "const runner = require(process.argv[1]);",
      "const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));",
      "runner.applyStagedUpdate(plan, { skipRestart: true }).then((result) => {",
      "  process.stdout.write(JSON.stringify(result));",
      "  process.exitCode = result.ok ? 0 : 1;",
      "}).catch((err) => { console.error(err); process.exitCode = 1; });",
    ].join('\n');
    const { spawnSync } = require('child_process');
    const result = spawnSync(process.execPath, ['-e', script, runnerPath, planPath], {
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    eq(result.status, 0, `standalone updater stderr=${result.stderr} stdout=${result.stdout}: `);
    eq(fs.readFileSync(path.join(sandbox.targetRoot, 'server', 'example.js'), 'utf8'), 'new');
    eq(fs.readFileSync(path.join(sandbox.targetRoot, 'data', 'state.json'), 'utf8'), 'USER-DATA');
    ok(!fs.existsSync(sandbox.plan.stagingRoot) && !fs.existsSync(sandbox.plan.backupRoot));
  } finally { fs.rmSync(sandbox.root, { recursive: true, force: true }); }
});

test('更新 HTTP API 已移除，只有 private parentPort coordinator 可在冷啟動使用', () => {
  const source = readApiRoutesSource();
  const coordinator = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'startup-update-coordinator.js'), 'utf8');
  ok(!source.includes("'/app-update/plan'") && !source.includes("'/app-update/status'") && !source.includes("'/app-update/apply'"));
  ok(coordinator.includes('process.parentPort') && !coordinator.includes('router.') && !coordinator.includes('socket'));
});

function sampleAnnouncement(patch = {}) {
  return {
    id: 'notice-1', level: 'warning', title: '測試公告', message: '純文字內容',
    minVersion: '0.7.3', maxVersion: '0.8.0', publishedAt: '2026-07-13T00:00:00+08:00',
    expiresAt: '2026-08-31T23:59:59+08:00', dismissible: true, showOnce: false,
    url: 'https://github.com/z22115554/elitesand-pro/releases', buttonText: '前往查看', enabled: true,
    ...patch,
  };
}

test('公告版本範圍、過期與 disabled 篩選正確', () => {
  const notice = announcementService.sanitizeAnnouncement(sampleAnnouncement());
  ok(announcementService.versionMatches(notice, '0.7.3'));
  ok(!announcementService.versionMatches(notice, '0.9.0'));
  ok(announcementService.isCurrentlyActive(notice, Date.parse('2026-07-14T00:00:00+08:00'), '0.7.3'));
  ok(!announcementService.isCurrentlyActive(notice, Date.parse('2026-09-01T00:00:00+08:00'), '0.7.3'));
  ok(!announcementService.isCurrentlyActive({ ...notice, enabled: false }, Date.parse('2026-07-14T00:00:00+08:00'), '0.7.3'));
});

test('公告拒絕非 HTTPS URL、過長欄位與錯誤 JSON schema', () => {
  eq(announcementService.sanitizeAnnouncement(sampleAnnouncement({ url: 'javascript:alert(1)' })), null);
  eq(announcementService.sanitizeAnnouncement(sampleAnnouncement({ message: 'x'.repeat(2001) })), null);
  let threw = false;
  try { announcementService.validateDocument({ schemaVersion: 9, announcements: [] }); } catch (_) { threw = true; }
  ok(threw);
});

test('公告 XSS 字串保持純文字資料；前端只用 textContent', () => {
  const xss = announcementService.sanitizeAnnouncement(sampleAnnouncement({ title: '<img src=x onerror=alert(1)>', message: '<script>alert(1)</script>' }));
  eq(xss.title, '<img src=x onerror=alert(1)>');
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-announcements.js'), 'utf8');
  ok(source.includes('title.textContent = item.title'));
  ok(!source.includes('innerHTML'));
});

test('showOnce、dismissed 與 critical 安全 action 只影響呈現/更新開關', () => {
  const critical = announcementService.sanitizeAnnouncement(sampleAnnouncement({
    id: 'critical-1', level: 'critical', dismissible: false, showOnce: true,
    actions: { disableIncrementalUpdate: true, showFullDownloadOnly: true, run: 'evil' },
  }));
  announcementService._resetForTests({
    cache: { schemaVersion: 1, fetchedAt: '2026-07-13T00:00:00Z', announcements: [critical] },
    state: { dismissed: [], shownOnce: ['critical-1'], read: ['critical-1'] },
  });
  const snapshot = announcementService.getSnapshot({ now: Date.parse('2026-07-14T00:00:00+08:00'), currentVersion: '0.7.3' });
  eq(snapshot.announcements[0].shouldPresent, false);
  eq(snapshot.announcements[0].dismissible, false);
  ok(snapshot.actions.disableIncrementalUpdate && snapshot.actions.showFullDownloadOnly);
  ok(!('run' in snapshot.announcements[0].actions));
});

test('notice 等級一律可關閉、且不會拿到 critical 專屬的 action', () => {
  // notice 存在的理由就是「一定關得掉的強制彈窗」——就算發布者手滑傳 dismissible:false，
  // 也要被忽略；也不可以像 critical 一樣夾帶 disableIncrementalUpdate 之類的動作。
  const locked = announcementService.sanitizeAnnouncement(sampleAnnouncement({
    id: 'notice-locked', level: 'notice', dismissible: false,
    actions: { disableIncrementalUpdate: true },
  }));
  eq(locked.dismissible, true, 'notice 忽略 dismissible:false：');

  announcementService._resetForTests({
    cache: { schemaVersion: 1, fetchedAt: '2026-07-13T00:00:00Z', announcements: [locked] },
    state: { dismissed: [], shownOnce: [], read: [] },
  });
  const snapshot = announcementService.getSnapshot({ now: Date.parse('2026-07-14T00:00:00+08:00'), currentVersion: '0.7.3' });
  eq(snapshot.announcements[0].shouldPresent, true);
  eq(Object.keys(snapshot.actions).length, 0, 'notice 不可觸發 critical 專屬的 action：');
});

test('前端把 notice 併進 critical 的強制彈窗（中性配色），critical 同時存在時優先顯示 critical', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-announcements.js'), 'utf8');
  // 2026-09-12 重構：critical/notice 的選取與優先序改成走 MODAL_LEVELS 表（陣列順序＝優先序），
  // 不再是寫死的 `critical || notice` 兩層判斷，之後加新等級只需要多一筆表項。
  ok(source.includes("{ level: 'critical', className: null }") && source.includes("{ level: 'notice', className: 'is-notice' }"),
    'MODAL_LEVELS 要含 critical（無額外樣式）跟 notice（is-notice）兩筆，且 critical 排在前面（優先顯示）：');
  ok(source.includes('for (const entry of MODAL_LEVELS)') && source.includes("candidates.find((item) => item.level === entry.level)"),
    'present() 要依 MODAL_LEVELS 表挑出對應等級的候選公告：');
  ok(source.includes("entry.className === modalClassName"), '要依表項的 className 切換對應的中性配色 class（如 is-notice）：');
});

testAsync('來源樹 Electron shell 不讀取或套用遠端強制公告', async () => {
  const critical = announcementService.sanitizeAnnouncement(sampleAnnouncement({
    id: 'development-shell-notice', level: 'critical', dismissible: false,
    actions: { disableIncrementalUpdate: true, showFullDownloadOnly: true },
  }));
  announcementService._resetForTests({
    cache: { schemaVersion: 1, fetchedAt: '2026-08-12T00:00:00Z', announcements: [critical] },
    state: { dismissed: [], shownOnce: [], read: [] },
  });
  ok(!announcementService.remoteAnnouncementsEnabled({ ELITESAND_SHELL_DEVELOPMENT: '1' }));
  ok(announcementService.remoteAnnouncementsEnabled({ ELITESAND_SHELL_DEVELOPMENT: '0' }));
  const snapshot = announcementService.getSnapshot({
    currentVersion: '0.9.9.6',
    remoteEnabled: false,
  });
  eq(snapshot.enabled, false);
  eq(snapshot.announcements.length, 0);
  eq(Object.keys(snapshot.actions).length, 0);
  const result = await announcementService.refresh({ force: true, remoteEnabled: false });
  eq(result.disabled, true);
  announcementService._resetForTests({
    cache: { schemaVersion: 1, fetchedAt: null, announcements: [] },
    state: { dismissed: [], shownOnce: [], read: [] },
  });
});

test('正式公告會強制 0.9.9.5 與更舊版本改用完整 Installer', () => {
  const document = announcementService.validateDocument(JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'announcement.json'), 'utf8'),
  ));
  // New release notices may be appended; verify the required legacy notices
  // and their version boundaries below instead of freezing the total count.
  ok(document.announcements.length >= 4);
  const legacy = document.announcements.find((item) => item.id === 'installer-only-update-legacy');
  const electron = document.announcements.find((item) => item.id === 'installer-only-update-electron');
  const current = document.announcements.find((item) => item.id === 'installer-only-update-current');
  const release105 = document.announcements.find((item) => item.id === 'release-v1.0.5');
  ok(legacy && electron && current);
  for (const notice of [legacy, electron, current]) {
    eq(notice.level, 'critical');
    eq(notice.dismissible, false);
    eq(notice.showOnce, false);
    ok(notice.actions.disableIncrementalUpdate && notice.actions.showFullDownloadOnly);
    eq(notice.url, 'https://github.com/z22115554/elitesand-pro/releases/latest');
    ok(/Windows Installer/.test(notice.message));
    ok(!/portable/i.test(notice.message));
  }
  ok(release105);
  eq(release105.level, 'notice');
  eq(release105.showOnce, true);
  eq(release105.minVersion, '1.0.0');
  eq(release105.maxVersion, '1.0.4');
  ok(announcementService.versionMatches(release105, '1.0.4'));
  ok(!announcementService.versionMatches(release105, '1.0.5'));
  ok(announcementService.versionMatches(legacy, '0.8.0'));
  ok(!announcementService.versionMatches(legacy, '0.8.1-pre.1'));
  ok(announcementService.versionMatches(electron, '0.8.1-pre.1'));
  ok(announcementService.versionMatches(electron, '0.9.1'));
  ok(!announcementService.versionMatches(electron, '0.8.0'));
  ok(announcementService.versionMatches(current, '0.9.2'));
  ok(announcementService.versionMatches(current, '0.9.9.5'));
  ok(!announcementService.versionMatches(current, '0.9.9.6'));
  ok(!announcementService.versionMatches(current, '1.0.0'));
});

testAsync('公告請求逾時安全失敗，不影響程序', async () => {
  const http = require('http');
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    let error = null;
    try { await announcementService.fetchJsonDocument(`http://127.0.0.1:${server.address().port}/`, 30); } catch (err) { error = err; }
    ok(error && /逾時/.test(error.message));
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
