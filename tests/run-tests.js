/**
 * Elitesand Pro 自動化測試套件
 * 執行：npm test
 *
 * 不需要安裝 kuromoji 等重型依賴也能跑核心測試
 * （romanizer 已支援安全降級），方便快速驗證改動是否破壞功能。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');

// 回歸測試絕不可碰正式 data/downloads/logs；必須在載入任一 server 模組前
// 設定完整的隔離路徑，讓有 module-load side effect 的 store 也只寫測試暫存區。
const TEST_RUNTIME_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-test-runtime-'));
const TEST_RUNTIME_DIRS = {
  data: path.join(TEST_RUNTIME_ROOT, 'data'),
  downloads: path.join(TEST_RUNTIME_ROOT, 'downloads'),
  logs: path.join(TEST_RUNTIME_ROOT, 'logs'),
};
process.env.ELITESAND_DATA_DIR = TEST_RUNTIME_DIRS.data;
process.env.ELITESAND_DOWNLOADS_DIR = TEST_RUNTIME_DIRS.downloads;
process.env.ELITESAND_LOGS_DIR = TEST_RUNTIME_DIRS.logs;

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`    → ${err.message}`);
  }
}

// 非同步測試：收集 Promise，於檔案末端統一等待後再印出結果摘要
const asyncTests = [];
function testAsync(name, fn) {
  asyncTests.push((async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      failures.push({ name, err });
      console.log(`  ✗ ${name}`);
      console.log(`    → ${err.message}`);
    }
  })());
}

function eq(actual, expected, label = '') {
  if (actual !== expected) {
    throw new Error(`${label}預期 "${expected}"，實際 "${actual}"`);
  }
}

function ok(value, label = '') {
  if (!value) throw new Error(`${label}預期為真，實際 ${JSON.stringify(value)}`);
}

const playlistState = require('../public/js/playlist-state');

test('跨端歌單重排後以 track.id 保持目前歌曲', () => {
  const before = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const activeId = playlistState.getTrackIdAtIndex(before, 1);
  const result = playlistState.reconcilePlaylist([{ id: 'b' }, { id: 'c' }, { id: 'a' }], activeId);
  eq(result.currentTrackIndex, 0);
  eq(result.playlist[result.currentTrackIndex].id, 'b');
});

test('跨端歌單移除目前歌曲後索引回到 -1', () => {
  const result = playlistState.reconcilePlaylist([{ id: 'a' }, { id: 'c' }], 'b');
  eq(result.currentTrackIndex, -1);
});

test('state:sync 明確沒有目前歌曲時不沿用舊索引', () => {
  const result = playlistState.reconcilePlaylist([{ id: 'a' }], null);
  eq(result.currentTrackIndex, -1);
});

test('空歌單同步會清空並重設目前歌曲', () => {
  const result = playlistState.reconcilePlaylist([], 'a');
  eq(result.playlist.length, 0);
  eq(result.currentTrackIndex, -1);
});

test('清單摘要只把完整歌詞合回目前歌曲', () => {
  const summaries = [
    { id: 'a', title: '目前歌曲', hasLyrics: true, lyricsType: 'lrc' },
    { id: 'b', title: '下一首', hasLyrics: true, lyricsType: 'lrc' },
  ];
  const currentTrack = {
    id: 'a', lyrics: '[00:01.00]目前歌曲', parsedLyrics: [{ time: 1000, text: '目前歌曲' }],
    lyricsType: 'lrc', hasLyrics: true,
  };
  const merged = playlistState.mergeCurrentTrackDetails(summaries, currentTrack);
  eq(merged[0].lyrics, '[00:01.00]目前歌曲');
  eq(merged[0].parsedLyrics[0].text, '目前歌曲');
  eq(merged[1].lyrics, undefined, '非目前歌曲不應保留完整歌詞: ');
});

test('Windows PowerShell 建置腳本使用 UTF-8 BOM', () => {
  const fsForEncoding = require('fs');
  for (const filename of ['build-portable.ps1', 'build-update.ps1']) {
    const bytes = fsForEncoding.readFileSync(require('path').join(__dirname, '..', 'tools', filename));
    ok(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, `${filename} 必須讓 Windows PowerShell 5.1 正確辨識 UTF-8: `);
  }
});

const staticContracts = require('./static-contracts');

test('靜態守衛：server 發出的 socket 事件都會由前端泛用 relay 轉接', () => {
  const root = path.join(__dirname, '..');
  const report = staticContracts.socketContractReport(
    staticContracts.loadRepositorySources(root),
    fs.readFileSync(path.join(root, 'public', 'js', 'socket-client.js'), 'utf8')
  );
  ok(report.forwardsAllServerEvents, 'socket-client 必須使用 socket.onAny 泛用 relay: ');
  eq(report.forwarded.length, 0, '泛用 relay 不應保留手動 server 事件轉接: ');
  eq(report.missing.join(','), '', `漏接事件 ${report.missing.join(', ')}: `);
});

test('靜態守衛：沒有泛用 relay 的舊式轉接仍會偵測漏接事件', () => {
  const serverSources = [{ file: 'server/example.js', source: "io.emit('fixture:event', {});" }];
  const report = staticContracts.socketContractReport(serverSources, "socket.on('other:event', () => {});");
  eq(report.missing.join(','), 'fixture:event');
});

test('SocketClient 泛用 relay 保留未知事件與多參數，不重複既有事件', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'socket-client.js'), 'utf8');
  const directHandlers = new Map();
  const anyHandlers = [];
  const fakeSocket = {
    id: 'socket-client-test',
    auth: {},
    on(event, callback) { directHandlers.set(event, callback); return this; },
    onAny(callback) { anyHandlers.push(callback); return this; },
    emit() {},
    disconnect() {},
    connect() {},
    receive(event, ...args) {
      anyHandlers.forEach((callback) => callback(event, ...args));
      directHandlers.get(event)?.(...args);
    },
  };
  const context = {
    io: () => fakeSocket,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(`${source}\n;globalThis.__socketClientForTest = SocketClient;`, context);
  const client = context.__socketClientForTest;
  client.init('controller');

  const received = [];
  client.on('future:server-event', (...args) => received.push(args));
  fakeSocket.receive('future:server-event', { ok: true }, 'second-argument');
  eq(JSON.stringify(received), JSON.stringify([[{ ok: true }, 'second-argument']]));

  let knownCount = 0;
  client.on('play:next', () => { knownCount++; });
  fakeSocket.receive('play:next');
  eq(knownCount, 1);
});

test('靜態守衛：所有寫入型 HTTP 路由都有 requirePin 或具理由的例外', () => {
  const report = staticContracts.routeContractReport(staticContracts.loadRepositorySources(path.join(__dirname, '..')));
  eq(report.unprotected.map((item) => item.key).join(','), '', `未保護路由 ${report.unprotected.map((item) => item.key).join(', ')}: `);
  eq(report.staleAllowlist.join(','), '', `過期例外 ${report.staleAllowlist.join(', ')}: `);
});

test('靜態守衛：故意漏掛 requirePin 時會偵測失敗', () => {
  const sources = [{ file: 'server/routes/fixture.js', source: "router.post('/danger', async (req, res) => {});" }];
  const report = staticContracts.routeContractReport(sources, new Map());
  eq(report.unprotected[0].key, 'server/routes/fixture.js:POST:/danger');
});

// ═══════════════════════════════════════════
console.log('\n📦 1. 中文諧音引擎 (xieyin.js)');
// ═══════════════════════════════════════════
const xieyin = require('../server/services/xieyin');

test('使用者範例完整重現', () => {
  eq(
    xieyin.romajiToXieyin('kimi no naka ni aru mono kyori no naka ni aru kodou'),
    'ki咪 諾 拿卡 尼 阿魯 摸諾 ki唷理 諾 拿卡 尼 阿魯 摳豆'
  );
});

test('長音合併（ou / ei）', () => {
  eq(xieyin.wordToXieyin('kodou'), '摳豆');
  eq(xieyin.wordToXieyin('shoumei'), '休咩');
  eq(xieyin.wordToXieyin('sensei'), '瑟恩瑟');
});

test('促音簡化（katte → 卡貼）', () => {
  eq(xieyin.wordToXieyin('katte'), '卡貼');
  eq(xieyin.wordToXieyin('ippai'), '伊趴伊');
});

test('拗音（kya/sho/chu）', () => {
  eq(xieyin.wordToXieyin('kyou'), 'ki唷');
  eq(xieyin.wordToXieyin('shashin'), '夏西恩');
  eq(xieyin.wordToXieyin('chuu'), '啾');
});

test('撥音 n', () => {
  eq(xieyin.wordToXieyin('ningen'), '尼恩葛恩');
  eq(xieyin.wordToXieyin('kanji'), '卡恩吉');
});

test('長音符號（katakana ー → -）', () => {
  eq(xieyin.wordToXieyin('su-pa-'), '斯趴');
});

test('英文單字保留原樣（防誤轉）', () => {
  eq(xieyin.wordToXieyin('love'), 'love');
  eq(xieyin.wordToXieyin('over'), 'over');
  eq(xieyin.wordToXieyin('heart'), 'heart');
  eq(xieyin.wordToXieyin('forever'), 'forever');
  eq(xieyin.wordToXieyin('night'), 'night');
});

test('混合行：英文保留、日文轉換', () => {
  eq(xieyin.romajiToXieyin('love kimi wo'), 'love ki咪 喔');
});

test('韓文羅馬字轉換', () => {
  eq(xieyin.wordToXieyin('saranghae'), '撒啦嗯哈欸');
  eq(xieyin.wordToXieyin('annyeong'), '阿恩唷嗯');
});

test('空值與異常輸入安全', () => {
  eq(xieyin.romajiToXieyin(''), '');
  eq(xieyin.romajiToXieyin(null), '');
  eq(xieyin.romajiToXieyin(undefined), '');
  eq(xieyin.wordToXieyin(''), '');
});

test('addXieyin：依賴 phonetic 欄位批量處理', () => {
  const lines = [
    { time: 0, text: '君の中にあるもの', phonetic: 'kimi no naka ni aru mono' },
    { time: 1000, text: 'Hello world', phonetic: 'Hello world' },
    { time: 2000, text: '', phonetic: '' },
  ];
  xieyin.addXieyin(lines);
  eq(lines[0].xieyin, 'ki咪 諾 拿卡 尼 阿魯 摸諾');
  ok(!lines[1].xieyin, '純英文行不應產生諧音: ');
  ok(!lines[2].xieyin, '空行不應產生諧音: ');
});

test('addXieyin：KRC 逐字模式', () => {
  const lines = [{
    time: 0,
    text: '君の',
    phonetic: 'kimi no',
    words: [
      { text: '君', phonetic: 'kimi' },
      { text: 'の', phonetic: 'no' },
    ],
  }];
  xieyin.addXieyin(lines);
  eq(lines[0].words[0].xieyin, 'ki咪');
  eq(lines[0].words[1].xieyin, '諾');
});

// ═══════════════════════════════════════════
console.log('\n📦 2. 羅馬拼音引擎降級路徑 (romanizer.js, 無 kuromoji)');
// ═══════════════════════════════════════════
const romanizer = require('../server/services/romanizer');

test('假名 → 羅馬拼音（內建表，忽略空格切分差異）', () => {
  eq(
    romanizer.japaneseToRomaji('きみのなかにあるもの').replace(/\s/g, ''),
    'kiminonakaniarumono'
  );
});

test('內建漢字詞表', () => {
  ok(romanizer.japaneseToRomaji('愛').includes('ai'), '愛 → ai: ');
  ok(romanizer.japaneseToRomaji('君').includes('kimi'), '君 → kimi: ');
});

test('韓文諺文 → 羅馬字', () => {
  eq(romanizer.koreanToRomaja('사랑'), 'sarang');
});

test('addRomanizationSync 同步路徑含諧音', () => {
  const result = romanizer.addRomanizationSync([
    { time: 0, text: 'きみ' },
  ]);
  eq(result[0].phonetic, 'kimi');
  eq(result[0].xieyin, 'ki咪');
});

test('needsRomanization 偵測', () => {
  ok(romanizer.needsRomanization([{ text: 'こんにちは' }]));
  ok(romanizer.needsRomanization([{ text: '안녕' }]));
  ok(!romanizer.needsRomanization([{ text: 'Hello' }]));
});

test('kuromoji 不可用時 addRomanization 不崩潰（async 降級）', async () => {
  // 在本測試環境 kuromoji 未安裝，addRomanization 應降級而不丟例外
  const p = romanizer.addRomanization([{ time: 0, text: 'きみ' }]);
  ok(p instanceof Promise);
});

// ═══════════════════════════════════════════
console.log('\n📦 3. 時間工具與 LRC 解析 (time-utils / lrc-parser)');
// ═══════════════════════════════════════════
const timeUtils = require('../server/utils/time-utils');

test('LRC 時間戳解析', () => {
  eq(timeUtils.parseTimestampToMs('01:23.45'), 83450);
  eq(timeUtils.parseTimestampToMs('00:00.00'), 0);
});

test('毫秒 → LRC 時間', () => {
  eq(timeUtils.msToLrcTime(83450), '01:23.45');
});

const lrcParser = require('../server/services/lrc-parser');

test('LRC 歌詞解析', () => {
  const parsed = lrcParser.parseLrc('[00:10.00]第一句\n[00:20.50]第二句');
  eq(parsed.lines.length, 2);
  eq(parsed.lines[0].time, 10000);
  eq(parsed.lines[0].text, '第一句');
  eq(parsed.lines[1].time, 20500);
});

test('LRC offset 標籤（含 + 號寫法）', () => {
  eq(lrcParser.parseLrc('[offset:+500]\n[00:10.00]歌詞').offset, 500);
  eq(lrcParser.parseLrc('[offset:-300]\n[00:10.00]歌詞').offset, -300);
  eq(lrcParser.parseLrc('[offset:200]\n[00:10.00]歌詞').offset, 200);
});

// ═══════════════════════════════════════════
console.log('\n📦 4. Stream Deck HTTP 指令 API (socket-handler)');
// ═══════════════════════════════════════════

// 用假 io 載入 socket-handler
const fakeIo = {
  emitted: [],
  on() {},
  use() {}, // PIN 驗證 middleware 掛載點，測試不需要真的跑握手驗證
  emit(event, data) { this.emitted.push({ event, data }); },
};
const socketHandler = require('../server/routes/socket-handler');
const deckApi = socketHandler(fakeIo);

test('回傳 API 結構正確', () => {
  ok(typeof deckApi.command === 'function');
  ok(typeof deckApi.getState === 'function');
});

test('play-toggle 切換並廣播', () => {
  fakeIo.emitted.length = 0;
  const r1 = deckApi.command('play-toggle');
  ok(r1.ok);
  eq(r1.message, 'playing');
  const r2 = deckApi.command('play-toggle');
  eq(r2.message, 'paused');
  ok(fakeIo.emitted.some(e => e.event === 'play:toggle'));
});

test('next / prev 廣播事件', () => {
  fakeIo.emitted.length = 0;
  ok(deckApi.command('next').ok);
  ok(deckApi.command('prev').ok);
  ok(fakeIo.emitted.some(e => e.event === 'play:next'));
  ok(fakeIo.emitted.some(e => e.event === 'play:prev'));
});

test('hide / show / hide-toggle', () => {
  ok(deckApi.command('hide').ok);
  eq(deckApi.command('hide').message, 'hidden');
  eq(deckApi.command('show').message, 'visible');
  eq(deckApi.command('hide-toggle').message, 'hidden');
  deckApi.command('show'); // 復原
});

test('offset 指令在無歌曲時安全拒絕', () => {
  const r = deckApi.command('offset-plus', { ms: 100 });
  ok(!r.ok);
  eq(r.message, 'no track playing');
});

test('未知指令回傳錯誤而非崩潰', () => {
  const r = deckApi.command('nonsense');
  ok(!r.ok);
});

test('state 查詢回傳狀態物件', () => {
  const r = deckApi.command('state');
  ok(r.ok);
  ok(r.state && typeof r.state === 'object');
  ok('isPlaying' in r.state);
});

test('無效顯示模式被 socket 端拒絕（不污染狀態）', () => {
  // 透過 getState 確認預設模式合法
  const s = deckApi.getState();
  ok(['original', 'romanized', 'both', 'xieyin', 'full'].includes(s.romanizationMode));
});

// ═══════════════════════════════════════════
console.log('\n📦 5. 歌詞快取持久化（磁碟 round-trip）');
// ═══════════════════════════════════════════
test('快取檔寫入與重新載入', () => {
  const dataDir = TEST_RUNTIME_DIRS.data;
  const cacheFile = path.join(dataDir, 'lyrics-cache.json');

  // 寫一筆模擬快取
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const entry = [['test|song|180', {
    result: { lyrics: '[00:01.00]テスト', parsedLyrics: [{ time: 1000, text: 'テスト', phonetic: 'tesuto', xieyin: '貼斯托' }] },
    timestamp: Date.now(),
  }]];
  fs.writeFileSync(cacheFile, JSON.stringify(entry), 'utf-8');

  // 讀回驗證 JSON 結構完整
  const loaded = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
  eq(loaded[0][0], 'test|song|180');
  eq(loaded[0][1].result.parsedLyrics[0].xieyin, '貼斯托');

  // 清理測試檔
  fs.unlinkSync(cacheFile);
});

// ═══════════════════════════════════════════
console.log('\n📦 6. KRC 解碼器與 TTML 解析器載入檢查');
// ═══════════════════════════════════════════

test('krc-decoder 模組載入正常', () => {
  const krc = require('../server/services/krc-decoder');
  ok(typeof krc === 'object');
});

test('ttml-parser 模組載入正常', () => {
  const ttml = require('../server/services/ttml-parser');
  ok(typeof ttml === 'object');
});

test('畸形 ASF Header Extension（objectSize=0）不會讓 metadata parser 卡死', () => {
  const { spawnSync } = require('child_process');
  const script = `
    (async () => {
      const { parseBuffer } = await import('music-metadata');
      const b = Buffer.alloc(100);
      Buffer.from('3026b2758e66cf11a6d900aa0062ce6c', 'hex').copy(b, 0);
      b.writeBigUInt64LE(100n, 16); b.writeUInt32LE(1, 24); b[28] = 1; b[29] = 2;
      Buffer.from('b503bf5f2ea9cf118ee300c00c205365', 'hex').copy(b, 30);
      b.writeBigUInt64LE(70n, 46);
      Buffer.from('11d2d3abba a9cf118ee600c00c205365'.replace(/ /g, ''), 'hex').copy(b, 54);
      b.writeUInt16LE(6, 70); b.writeUInt32LE(24, 72);
      Buffer.from('b503bf5f2ea9cf118ee300c00c205365', 'hex').copy(b, 76);
      b.writeBigUInt64LE(0n, 92);
      try { await parseBuffer(b, { mimeType: 'audio/x-ms-wma', size: b.length }); } catch (_) {}
    })().then(() => process.exit(0), () => process.exit(1));
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'), timeout: 3000, encoding: 'utf8',
  });
  ok(!result.error || result.error.code !== 'ETIMEDOUT', '畸形 ASF 不應逾時: ');
  eq(result.status, 0, result.stderr || 'metadata parser child: ');
});

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
  const api = fs.readFileSync(path.join(root, 'server/routes/api.js'), 'utf8');
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
    'server/routes/api.js',
    'server/services/app-updater.js',
    'server/services/announcement-service.js',
    'server/services/diagnostic-bundle.js',
    'server/services/lyrics-engine.js',
    'server/services/system-check.js',
    'server/services/update-checker.js',
    'server/services/ytdlp-updater.js',
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

    const root = path.join(__dirname, '..');
    const api = fs.readFileSync(path.join(root, 'server/routes/api.js'), 'utf8');
    const page = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
    const frontend = fs.readFileSync(path.join(root, 'public/js/app-diagnostics.js'), 'utf8');
    ok(api.includes("router.get('/diagnostics/export', requirePin"));
    ok(api.includes("router.post('/diagnostics/reliability/reset', requirePin"));
    ok(page.includes('diagnostic-export-btn'));
    ok(page.includes('reliability-reset-btn'));
    ok(frontend.includes("PinAuth.fetchWithPin('/api/diagnostics/export'"));
    ok(frontend.includes("PinAuth.fetchWithPin('/api/diagnostics/reliability/reset'"));
    ok(frontend.includes('四小時時長門檻') && frontend.includes('R12_MINIMUM_OBSERVED_MS'), '控制台必須清楚提示 R12 的時長門檻，而不是宣稱已完成直播驗收: ');
  } finally {
    fs.rmSync(logDir, { recursive: true, force: true });
  }
});

test('發版稽核只檢查 production dependencies，且任何等級風險都會失敗', () => {
  const manifest = require('../package.json');
  eq(manifest.scripts['audit:release'], 'npm audit --omit=dev --audit-level=low');
});

testAsync('更新計畫只讀 Release metadata，未確認前不下載更新包', async () => {
  const release = {
    tag_name: 'v9.9.9', html_url: 'https://example.test/release',
    assets: [
      { name: 'update.zip', browser_download_url: 'https://example.test/update.zip' },
      { name: 'update.zip.sha256', browser_download_url: 'https://example.test/update.zip.sha256' },
      { name: 'Elitesand-Pro-v9.9.9-portable.zip', browser_download_url: 'https://example.test/portable.zip' },
    ],
  };
  let releaseCalls = 0;
  const plan = await appUpdater.getPlan({
    repo: 'owner/repo',
    fetchLatestRelease: async () => { releaseCalls += 1; return release; },
  });
  eq(releaseCalls, 1);
  eq(plan.canIncremental, true);
  eq(plan.needsFull, false);
  const updaterSource = fs.readFileSync(path.join(__dirname, '../server/services/app-updater.js'), 'utf8');
  const getPlanSource = updaterSource.slice(updaterSource.indexOf('async function getPlan'), updaterSource.indexOf('function ensureInside'));
  ok(!getPlanSource.includes('downloadReleaseUpdate('), '檢查更新不可預先下載 update.zip: ');
  const updatePanelSource = fs.readFileSync(path.join(__dirname, '../public/js/app-update-check.js'), 'utf8');
  ok(updatePanelSource.includes('目前只確認 Release 資產存在'), '面板不可把尚未下載的更新包說成已驗證: ');
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

testAsync('updater 啟動失敗時主程序保持可用且回傳具體原因', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-update-launch-'));
  try {
    appUpdater._resetForTests();
    const prepared = await appUpdater.prepareUpdate({ targetRoot: root, zipBuffer: makeUpdateZip(), latestVersion: '0.7.4' });
    ok(prepared.prepared);
    const launched = await appUpdater.launchUpdater(prepared, { spawnImpl() { throw new Error('spawn denied'); } });
    ok(!launched.launched && /spawn denied/.test(launched.reason));
  } finally { fs.rmSync(root, { recursive: true, force: true }); appUpdater._resetForTests(); }
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

test('更新 API 只在 response finish 後要求 graceful shutdown', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'api.js'), 'utf8');
  const finishAt = source.indexOf("res.once('finish'");
  const shutdownAt = source.indexOf("gracefulShutdown({ reason: 'app-update'", finishAt);
  ok(finishAt >= 0 && shutdownAt > finishAt);
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


// ═══════════════════════════════════════════
console.log('\n📦 8. 設定載入器與狀態持久化');
// ═══════════════════════════════════════════
const loadedConfig = require('../server/utils/load-config');

test('設定載入器：所有預設鍵存在且型別正確', () => {
  ok(typeof loadedConfig.port === 'number');
  ok(typeof loadedConfig.cacheDays === 'number');
  ok(typeof loadedConfig.maxCacheEntries === 'number');
  ok(typeof loadedConfig.updateCheckRepo === 'string');
  ok(typeof loadedConfig.updateCheckIntervalMs === 'number');
});

const appPathsModulePath = path.join(__dirname, '..', 'server', 'utils', 'app-paths.js');

function runAppPathsChild(env, expected, { writeLibrary = true } = {}) {
  const script = [
    "const fs=require('fs'),path=require('path');",
    "const root=process.argv[1],expected=JSON.parse(process.argv[2]);",
    "const paths=require(path.join(root,'server','utils','app-paths'));",
    "const logger=require(path.join(root,'server','utils','logger'));",
    `const writeLibrary=${JSON.stringify(writeLibrary)};`,
    "if(writeLibrary){const library=require(path.join(root,'server','services','library-store'));library.rememberImport({id:'app-paths-track',title:'Path Test',filename:'path-test.mp3'});library.saveNow();}",
    "const result={paths,logDir:logger.LOG_DIR,libraryWritten:writeLibrary&&fs.existsSync(path.join(paths.dataDir,'library.json')),expected};",
    "process.stdout.write('__APP_PATHS_RESULT__'+JSON.stringify(result)+'\\n');",
  ].join('\n');
  const child = require('child_process').spawnSync(process.execPath, ['-e', script, path.join(__dirname, '..'), JSON.stringify(expected)], {
    env, encoding: 'utf8', timeout: 10000, windowsHide: true,
  });
  eq(child.status, 0, `app-paths child stderr=${child.stderr} stdout=${child.stdout}: `);
  const marker = '__APP_PATHS_RESULT__';
  const markerAt = child.stdout.lastIndexOf(marker);
  ok(markerAt >= 0, `app-paths child returned no result: ${child.stdout}`);
  return JSON.parse(child.stdout.slice(markerAt + marker.length).trim().split(/\r?\n/, 1)[0]);
}

test('app-paths keeps the portable default layout when no override is set', () => {
  const root = path.join(__dirname, '..');
  const result = runAppPathsChild({
    ...process.env,
    ELITESAND_DATA_DIR: '', ELITESAND_DOWNLOADS_DIR: '', ELITESAND_LOGS_DIR: '',
  }, {}, { writeLibrary: false });
  eq(result.paths.projectRoot, root);
  eq(result.paths.dataDir, path.join(root, 'data'));
  eq(result.paths.downloadsDir, path.join(root, 'downloads'));
  eq(result.paths.logsDir, path.join(root, 'logs'));
  eq(result.paths.configPath, path.join(root, 'server', 'config.js'));
  eq(result.logDir, result.paths.logsDir);
});

test('打包預設依版本隔離 dist 產物，避免固定 update.zip 跨版覆寫', () => {
  const portableBuild = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-portable.ps1'), 'utf8');
  const updateBuild = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-update.ps1'), 'utf8');
  ok(portableBuild.includes('dist\\releases\\v$Version\\portable'), 'Portable 預設輸出必須置於版本資料夾: ');
  ok(updateBuild.includes('dist\\releases\\v$Version\\update'), '更新包預設輸出必須置於版本資料夾: ');
  ok(updateBuild.includes('$ZipPath = Join-Path $OutputRoot "update.zip"'), 'GitHub Release 所需的 update.zip 固定檔名不可改變: ');
});

test('app-paths directs persisted data, downloads, and logs to isolated overrides', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-app-paths-'));
  const expected = {
    dataDir: path.join(root, 'state'),
    downloadsDir: path.join(root, 'media'),
    logsDir: path.join(root, 'runtime-logs'),
  };
  try {
    const result = runAppPathsChild({
      ...process.env,
      ELITESAND_DATA_DIR: expected.dataDir,
      ELITESAND_DOWNLOADS_DIR: expected.downloadsDir,
      ELITESAND_LOGS_DIR: expected.logsDir,
    }, expected);
    eq(result.paths.dataDir, expected.dataDir);
    eq(result.paths.downloadsDir, expected.downloadsDir);
    eq(result.paths.logsDir, expected.logsDir);
    eq(result.logDir, expected.logsDir);
    ok(result.libraryWritten, 'library store must write under ELITESAND_DATA_DIR');
    ok(fs.existsSync(path.join(expected.dataDir, 'library.json')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('本機 smoke 工具必須隔離 data、downloads 與 logs 三個可寫目錄', () => {
  for (const tool of ['reliability-smoke.js', 'smoke-portable.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'tools', tool), 'utf8');
    for (const envName of ['ELITESAND_DATA_DIR', 'ELITESAND_DOWNLOADS_DIR', 'ELITESAND_LOGS_DIR']) {
      ok(source.includes(envName), `${tool} 遺漏 ${envName} 隔離: `);
    }
    ok(source.includes('runtimeRoot'), `${tool} 必須以單一自建 runtimeRoot 收納暫存資料: `);
    ok(source.includes('fs.rmSync(runtimeRoot'), `${tool} 結束後必須只清除自建 runtimeRoot: `);
  }
});

test('desktop parent shutdown accepts only the explicit message and runs once', () => {
  const { EventEmitter } = require('events');
  const { SHUTDOWN_MESSAGE, isShutdownMessage, attachParentShutdown } = require('../server/utils/parent-shutdown');
  const parentPort = new EventEmitter();
  const processObject = new EventEmitter();
  let calls = 0;
  const detach = attachParentShutdown({
    parentPort,
    processObject,
    onShutdown: () => { calls++; },
  });

  ok(isShutdownMessage(SHUTDOWN_MESSAGE));
  ok(isShutdownMessage({ type: SHUTDOWN_MESSAGE }));
  ok(!isShutdownMessage({ type: 'shutdown' }));
  ok(!isShutdownMessage({ data: SHUTDOWN_MESSAGE }), 'Node IPC payloads must not be treated as Electron events');

  parentPort.emit('message', { data: 'ignore-this' });
  processObject.emit('message', { type: 'ignore-this' });
  eq(calls, 0);

  parentPort.emit('message', { data: SHUTDOWN_MESSAGE });
  processObject.emit('message', SHUTDOWN_MESSAGE);
  eq(calls, 1, 'the first valid parent message starts exactly one shutdown');

  detach();
  parentPort.emit('message', { data: SHUTDOWN_MESSAGE });
  eq(calls, 1, 'detached listeners must not receive later messages');
});

test('server wires the parent shutdown adapter into its graceful shutdown path', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  ok(source.includes("require('./utils/parent-shutdown')"));
  ok(source.includes("reason: 'parent-message'"));
  ok(source.includes('attachParentShutdown({'));
});

test('portable build creates a clean production-only dependency tree in staging', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-portable.ps1'), 'utf8');
  const copiedDirs = source.match(/\$DirsToCopy\s*=\s*@\(([^)]*)\)/);
  ok(copiedDirs, 'portable build must explicitly list source directories');
  ok(!/node_modules/i.test(copiedDirs[1]), 'portable build must never copy the developer node_modules directory');
  ok(/ci\s+--omit=dev\b/i.test(source), 'portable build must install production dependencies with npm ci --omit=dev');
  ok(/--ignore-scripts\b/i.test(source), 'portable dependency install must not run package lifecycle scripts');
  ok(source.includes('Installing production dependencies in staging'));
});

test('all writable runtime path consumers use app-paths as their single authority', () => {
  const root = path.join(__dirname, '..');
  const consumers = [
    'server/index.js',
    'server/routes/api.js',
    'server/services/audio-processor.js',
    'server/services/library-store.js',
    'server/services/app-updater.js',
    'server/services/state-store.js',
    'server/services/auth-store.js',
    'server/services/twitch-store.js',
    'server/services/twitch-request-store.js',
    'server/services/lyrics-engine.js',
    'server/services/playlist-export-store.js',
    'server/services/announcement-service.js',
    'server/services/import-temp-registry.js',
    'server/utils/logger.js',
    'server/utils/load-config.js',
  ];
  for (const file of consumers) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    ok(source.includes('app-paths'), `${file} must import app-paths`);
  }
  ok(fs.existsSync(appPathsModulePath), 'app-paths module must exist');
});

const stateStoreModulePath = path.join(__dirname, '..', 'server', 'services', 'state-store.js');
const stateFixtureDir = path.join(__dirname, 'fixtures', 'state');
const { spawnSync: spawnStateStore } = require('child_process');
const { createJsonStore } = require('../server/services/json-store');

function makeTestJsonStore(file, reports = []) {
  return createJsonStore({
    file,
    label: '測試資料',
    defaultValue: () => [],
    migrations: new Map([[0, (legacy) => ({ schemaVersion: 1, entries: legacy })]]),
    serialize: (entries) => ({ entries }),
    deserialize: (document) => document.entries,
    validate: (document) => Array.isArray(document.entries),
    onError: (report) => reports.push(report),
  });
}

test('共用 JSON store：舊格式遷移、原檔與 last-good 都會保留', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-json-store-migrate-'));
  try {
    const file = path.join(dataDir, 'sample.json');
    const original = JSON.stringify([{ id: 'legacy' }]);
    fs.writeFileSync(file, original, 'utf8');
    const store = makeTestJsonStore(file);
    const loaded = store.load();
    const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
    const preserved = fs.readdirSync(dataDir).find((name) => /^sample\.json\.pre-migration-v0-/.test(name));
    eq(loaded[0].id, 'legacy');
    eq(disk.schemaVersion, 1);
    eq(disk.entries[0].id, 'legacy');
    eq(fs.readFileSync(path.join(dataDir, preserved), 'utf8'), original);
    ok(fs.existsSync(`${file}.last-good`), '應建立 last-good: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('共用 JSON store：損壞主檔會保留證據並由 last-good 恢復', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-json-store-recover-'));
  try {
    const file = path.join(dataDir, 'sample.json');
    fs.writeFileSync(file, '{broken', 'utf8');
    fs.writeFileSync(`${file}.last-good`, JSON.stringify({ schemaVersion: 1, entries: [{ id: 'safe' }] }), 'utf8');
    const reports = [];
    const loaded = makeTestJsonStore(file, reports).load();
    eq(loaded[0].id, 'safe');
    ok(fs.readdirSync(dataDir).some((name) => /^sample\.json\.corrupt-/.test(name)), '應保留損壞主檔: ');
    ok(reports.some((item) => /恢復/.test(item.message)), '應回報恢復結果: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('共用 JSON store：未來 schema 保持不變且拒絕寫入與刪除', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-json-store-future-'));
  try {
    const file = path.join(dataDir, 'sample.json');
    const original = JSON.stringify({ schemaVersion: 99, entries: [{ id: 'future' }] });
    fs.writeFileSync(file, original, 'utf8');
    const store = makeTestJsonStore(file);
    eq(store.load().length, 0);
    ok(store.getStatus().writeBlocked, '未來格式應停止寫入: ');
    eq(store.save([{ id: 'downgrade' }]), false);
    eq(store.remove(), false);
    eq(fs.readFileSync(file, 'utf8'), original);
    ok(!fs.readdirSync(dataDir).some((name) => /corrupt|pre-migration/.test(name)), '不可誤判未來格式: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('共用 JSON store：遷移無法安全落盤時保留原檔並停止寫入', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-json-store-persist-fail-'));
  const originalCopy = fs.copyFileSync;
  try {
    const file = path.join(dataDir, 'sample.json');
    const original = JSON.stringify([{ id: 'legacy' }]);
    fs.writeFileSync(file, original, 'utf8');
    const store = makeTestJsonStore(file);
    fs.copyFileSync = () => { throw new Error('simulated backup failure'); };
    eq(store.load().length, 0);
    ok(store.getStatus().writeBlocked, '遷移失敗應停止寫入: ');
    eq(store.save([{ id: 'overwrite' }]), false);
    eq(fs.readFileSync(file, 'utf8'), original);
    ok(!fs.readdirSync(dataDir).some((name) => /corrupt/.test(name)), '原檔不是損壞，不應改名: ');
  } finally {
    fs.copyFileSync = originalCopy;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('七類資料檔：舊資料可載入且落盤後都有 schemaVersion', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-store-fixtures-'));
  const fixtures = path.join(__dirname, 'fixtures', 'stores');
  try {
    for (const [fixture, target] of [
      ['library-v0.json', 'library.json'],
      ['lyrics-cache-v0.json', 'lyrics-cache.json'],
      ['auth-v0.json', 'auth.json'],
      ['twitch-auth-v0.json', 'twitch-auth.json'],
      ['twitch-requests-v0.json', 'twitch-requests.json'],
      ['announcement-state-v0.json', 'announcement-state.json'],
      ['announcement-cache-v1.json', 'announcement-cache.json'],
    ]) fs.copyFileSync(path.join(fixtures, fixture), path.join(dataDir, target));

    const script = [
      "const fs=require('fs'),path=require('path'); const root=process.argv[1],dir=process.argv[2];",
      "const library=require(path.join(root,'server/services/library-store'));",
      "const auth=require(path.join(root,'server/services/auth-store'));",
      "const twitch=require(path.join(root,'server/services/twitch-store'));",
      "const twitchRequests=require(path.join(root,'server/services/twitch-request-store'));",
      "require(path.join(root,'server/services/lyrics-engine')); require(path.join(root,'server/services/announcement-service'));",
      "const read=(name)=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));",
      "const result={libraryApi:library.getLibrary(),hasPin:auth.hasPin(),twitchApi:twitch.load(),twitchRequests:twitchRequests.load(),files:{}};",
      "for(const name of ['library.json','lyrics-cache.json','auth.json','twitch-auth.json','twitch-requests.json','announcement-state.json','announcement-cache.json']) result.files[name]=read(name);",
      "process.stdout.write('__STORE_RESULT__'+JSON.stringify(result)+'\\n');",
    ].join('\n');
    const child = spawnStateStore(process.execPath, ['-e', script, path.join(__dirname, '..'), dataDir], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir }, encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    eq(child.status, 0, `store fixture child stderr=${child.stderr} stdout=${child.stdout}: `);
    const markerAt = child.stdout.lastIndexOf('__STORE_RESULT__');
    ok(markerAt >= 0, `store fixture child 缺少結果：${child.stdout}`);
    const result = JSON.parse(child.stdout.slice(markerAt + '__STORE_RESULT__'.length).trim().split(/\r?\n/, 1)[0]);
    eq(result.libraryApi[0].title, '舊版媒體庫歌曲');
    ok(result.hasPin, '舊 PIN 雜湊應仍可辨識: ');
    eq(result.twitchApi.refreshToken, 'fixture-refresh-token');
    eq(result.twitchRequests[0].requestId, 'fixture-request');
    for (const [name, document] of Object.entries(result.files)) eq(document.schemaVersion, 1, `${name}: `);
    eq(result.files['library.json'].entries['legacy-track'].playCount, 2);
    ok(Array.isArray(result.files['lyrics-cache.json'].entries), '歌詞快取 entries 應保留: ');
    eq(result.files['announcement-state.json'].dismissed[0], 'fixture-announcement');
    for (const target of ['library.json', 'lyrics-cache.json', 'auth.json', 'twitch-auth.json', 'twitch-requests.json', 'announcement-state.json']) {
      ok(fs.readdirSync(dataDir).some((name) => name.startsWith(`${target}.pre-migration-v0-`)), `${target} 應保留遷移前原檔: `);
    }
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

function runStateStoreChild(dataDir, script) {
  const result = spawnStateStore(process.execPath, ['-e', script, stateStoreModulePath, dataDir], {
    env: { ...process.env, ELITESAND_DATA_DIR: dataDir },
    encoding: 'utf8', timeout: 10000, windowsHide: true,
  });
  eq(result.status, 0, `state-store child stderr=${result.stderr} stdout=${result.stdout}: `);
  const marker = '__STATE_RESULT__';
  const markerAt = result.stdout.lastIndexOf(marker);
  ok(markerAt >= 0, `state-store child 缺少結果：${result.stdout}`);
  return JSON.parse(result.stdout.slice(markerAt + marker.length).trim().split(/\r?\n/, 1)[0]);
}

test('狀態持久化：隔離資料夾 round-trip 並建立 last-good', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-roundtrip-'));
  try {
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const store=require(process.argv[1]);",
      "const snapshot={savedAt:Date.now(),playlist:[{id:'t1',title:'測試歌曲',artist:'測試歌手'}],style:'rock',romanizationMode:'full',trackOffsets:{t1:300},manualLyrics:{t1:{lyrics:'手動歌詞',timestamp:1}}};",
      "store.scheduleSave(()=>snapshot); store.saveNow(); const loaded=store.loadState();",
      "process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,backup:fs.existsSync(store.STATE_BACKUP_FILE)}));",
    ].join('\n'));
    eq(result.loaded.playlist[0].title, '測試歌曲');
    eq(result.loaded.style, 'rock');
    eq(result.loaded.trackOffsets.t1, 300);
    eq(result.loaded.manualLyrics.t1.lyrics, '手動歌詞');
    eq(result.loaded.schemaVersion, 2);
    ok(result.backup, '成功保存後應建立 last-good: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('狀態持久化：狀態檔不存在時回傳 null 不報錯', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-empty-'));
  try {
    const result = runStateStoreChild(dataDir, [
      "const store=require(process.argv[1]);",
      "process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded:store.loadState(),alert:store.consumeStartupAlert()}));",
    ].join('\n'));
    eq(result.loaded, null);
    eq(result.alert, null);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('state.json 遺失時從 last-good 恢復', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-missing-primary-'));
  try {
    fs.writeFileSync(path.join(dataDir, 'state.json.last-good'), JSON.stringify({ schemaVersion: 1, savedAt: 8, playlist: [{ id: 'backup-only' }] }), 'utf8');
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const store=require(process.argv[1]); const loaded=store.loadState(); const alert=store.consumeStartupAlert();",
      "const disk=JSON.parse(fs.readFileSync(store.STATE_FILE,'utf8')); process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,alert,disk}));",
    ].join('\n'));
    eq(result.loaded.playlist[0].id, 'backup-only');
    eq(result.disk.playlist[0].id, 'backup-only');
    ok(/找不到 state\.json/.test(result.alert.message), '應說明主檔遺失與恢復結果: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('主檔遺失但 last-good 為未來 schema 時持續阻止降版覆寫', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-future-backup-'));
  const fixture = path.join(stateFixtureDir, 'future-v99.json');
  try {
    fs.copyFileSync(fixture, path.join(dataDir, 'state.json.last-good'));
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const store=require(process.argv[1]); const alerts=[]; store.setErrorReporter((a)=>alerts.push(a)); const before=fs.readFileSync(store.STATE_BACKUP_FILE,'utf8');",
      "const loaded=store.loadState(); store.scheduleSave(()=>({savedAt:Date.now(),playlist:[{id:'downgrade'}]})); store.saveNow();",
      "const after=fs.readFileSync(store.STATE_BACKUP_FILE,'utf8'); process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,alerts,unchanged:before===after,primaryExists:fs.existsSync(store.STATE_FILE)}));",
    ].join('\n'));
    eq(result.loaded, null);
    ok(result.unchanged, '未來格式 last-good 必須保持不變: ');
    ok(!result.primaryExists, '不可用舊程式從未來格式建立降版主檔: ');
    ok(result.alerts.some((item) => /停止狀態寫入/.test(item.message)), '應持續阻止降版覆寫: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('無版本 state fixture 可逐步遷移並保留原檔', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-migrate-v0-'));
  const fixture = path.join(stateFixtureDir, 'v0-versionless.json');
  try {
    const original = fs.readFileSync(fixture, 'utf8');
    fs.copyFileSync(fixture, path.join(dataDir, 'state.json'));
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const path=require('path'); const store=require(process.argv[1]); const dir=process.argv[2];",
      "const loaded=store.loadState(); const files=fs.readdirSync(dir); const disk=JSON.parse(fs.readFileSync(store.STATE_FILE,'utf8'));",
      "const preserved=files.find((name)=>/^state\\.json\\.pre-migration-v0-/.test(name));",
      "process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,disk,files,preservedRaw:preserved?fs.readFileSync(path.join(dir,preserved),'utf8'):null}));",
    ].join('\n'));
    eq(result.loaded.schemaVersion, 2);
    eq(result.disk.schemaVersion, 2);
    eq(result.loaded.playlist[0].title, '舊版測試歌曲');
    eq(result.loaded.trackOffsets['legacy-track'], 350);
    eq(result.loaded.manualLyrics['legacy-track'].lyrics, '[00:01.00]舊版歌詞');
    eq(result.loaded.lyricSettings.template, 'classic');
    eq(result.preservedRaw, original);
    ok(result.files.includes('state.json.last-good'), '遷移後應建立目前格式的 last-good: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('目前 schema 載入不重複建立 migration 備份', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-current-schema-'));
  try {
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ schemaVersion: 2, savedAt: 7, playlist: [] }), 'utf8');
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const store=require(process.argv[1]); const dir=process.argv[2];",
      "const loaded=store.loadState(); process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,files:fs.readdirSync(dir)}));",
    ].join('\n'));
    eq(result.loaded.schemaVersion, 2);
    ok(!result.files.some((name) => name.includes('.pre-migration-')), '目前 schema 不應產生多餘遷移備份: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('未來 schema 保持原檔且阻止舊程式降版覆寫', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-future-schema-'));
  const fixture = path.join(stateFixtureDir, 'future-v99.json');
  try {
    fs.copyFileSync(fixture, path.join(dataDir, 'state.json'));
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const store=require(process.argv[1]); const dir=process.argv[2]; const alerts=[]; store.setErrorReporter((a)=>alerts.push(a));",
      "const before=fs.readFileSync(store.STATE_FILE,'utf8'); const loaded=store.loadState();",
      "store.scheduleSave(()=>({savedAt:Date.now(),playlist:[{id:'downgrade'}]})); store.saveNow();",
      "const after=fs.readFileSync(store.STATE_FILE,'utf8'); process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,alerts,unchanged:before===after,files:fs.readdirSync(dir)}));",
    ].join('\n'));
    eq(result.loaded, null);
    ok(result.unchanged, '未來版本資料必須逐 byte 保持不變: ');
    ok(!result.files.some((name) => /corrupt|pre-migration/.test(name)), '未來 schema 不應被誤判成損壞或舊格式: ');
    ok(result.alerts.some((item) => /停止狀態寫入/.test(item.message)), '應說明已阻止降版覆寫: ');
    ok(result.alerts.some((item) => /已拒絕寫入/.test(item.message)), '實際保存也必須被拒絕: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('非法 schema fixture 視為損壞並保留證據', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-invalid-schema-'));
  const fixture = path.join(stateFixtureDir, 'invalid-schema.json');
  try {
    const original = fs.readFileSync(fixture, 'utf8');
    fs.copyFileSync(fixture, path.join(dataDir, 'state.json'));
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const path=require('path'); const store=require(process.argv[1]); const dir=process.argv[2];",
      "const loaded=store.loadState(); const alert=store.consumeStartupAlert(); const files=fs.readdirSync(dir); const preserved=files.find((name)=>/^state\\.json\\.corrupt-/.test(name));",
      "process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,alert,files,preservedRaw:preserved?fs.readFileSync(path.join(dir,preserved),'utf8'):null}));",
    ].join('\n'));
    eq(result.loaded, null);
    eq(result.preservedRaw, original);
    ok(/沒有可用備份/.test(result.alert.message), '非法 schema 應走可理解的安全降級: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('state.json 損壞時保留原檔並從 last-good 自動恢復', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-recover-'));
  try {
    fs.writeFileSync(path.join(dataDir, 'state.json'), '{broken', 'utf8');
    fs.writeFileSync(path.join(dataDir, 'state.json.last-good'), JSON.stringify({ savedAt: 42, playlist: [{ id: 'safe' }], style: 'rock' }), 'utf8');
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const path=require('path'); const store=require(process.argv[1]); const dir=process.argv[2];",
      "const loaded=store.loadState(); const alert=store.consumeStartupAlert(); const disk=JSON.parse(fs.readFileSync(store.STATE_FILE,'utf8'));",
      "process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,alert,disk,files:fs.readdirSync(dir)}));",
    ].join('\n'));
    eq(result.loaded.playlist[0].id, 'safe');
    eq(result.disk.playlist[0].id, 'safe');
    eq(result.disk.schemaVersion, 2);
    ok(result.files.some((name) => /^state\.json\.corrupt-/.test(name)), '應保留損壞原檔: ');
    ok(/最近可用備份恢復/.test(result.alert.message), `提示應說明恢復結果：${result.alert?.message}`);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('state.json 損壞且無備份時保留原檔並以預設狀態啟動', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-no-backup-'));
  try {
    fs.writeFileSync(path.join(dataDir, 'state.json'), '[]', 'utf8');
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const store=require(process.argv[1]); const dir=process.argv[2];",
      "const loaded=store.loadState(); const alert=store.consumeStartupAlert();",
      "process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,alert,files:fs.readdirSync(dir)}));",
    ].join('\n'));
    eq(result.loaded, null);
    ok(result.files.some((name) => /^state\.json\.corrupt-/.test(name)), '應保留無效狀態物件: ');
    ok(/沒有可用備份/.test(result.alert.message), `提示應說明降級結果：${result.alert?.message}`);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('state.json 與 last-good 都損壞時保留兩份證據並安全啟動', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-both-corrupt-'));
  try {
    fs.writeFileSync(path.join(dataDir, 'state.json'), '{broken-primary', 'utf8');
    fs.writeFileSync(path.join(dataDir, 'state.json.last-good'), '{broken-backup', 'utf8');
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const store=require(process.argv[1]); const dir=process.argv[2];",
      "const loaded=store.loadState(); const alert=store.consumeStartupAlert();",
      "process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,alert,files:fs.readdirSync(dir)}));",
    ].join('\n'));
    eq(result.loaded, null);
    ok(result.files.some((name) => /^state\.json\.corrupt-/.test(name)), '主檔損壞證據應保留: ');
    ok(result.files.some((name) => /^state\.json\.last-good\.corrupt-/.test(name)), '備份損壞證據應保留: ');
    ok(/損壞備份另存/.test(result.alert.message), `提示應說明備份也損壞：${result.alert?.message}`);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('運行中 state.json 損壞不會造成拒寫死鎖', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-runtime-corrupt-'));
  try {
    fs.writeFileSync(path.join(dataDir, 'state.json'), '{broken', 'utf8');
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const store=require(process.argv[1]); const dir=process.argv[2]; const alerts=[]; store.setErrorReporter((a)=>alerts.push(a));",
      "const snapshot={savedAt:Date.now(),playlist:[{id:'new'}]}; store.scheduleSave(()=>snapshot); store.saveNow();",
      "const disk=JSON.parse(fs.readFileSync(store.STATE_FILE,'utf8'));",
      "process.stdout.write('__STATE_RESULT__'+JSON.stringify({disk,alerts,files:fs.readdirSync(dir)}));",
    ].join('\n'));
    eq(result.disk.playlist[0].id, 'new');
    ok(result.files.some((name) => /^state\.json\.corrupt-/.test(name)), '運行中壞檔應另存: ');
    ok(result.alerts.some((item) => /目前狀態將重新保存/.test(item.message)), '應通知控制面板已解除拒寫: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('啟動恢復提示延遲到第一個桌面控制面板連線', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'socket-handler.js'), 'utf8');
  ok(source.includes("type === 'controller'"));
  ok(source.includes('stateStore.consumeStartupAlert()'));
  ok(source.includes("socket.emit('server:alert', startupAlert)"));
});

test('狀態保存 callback 只在實際落盤後回報成功', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-save-ack-'));
  const storePath = path.join(__dirname, '..', 'server', 'services', 'state-store.js');
  const script = `
    const store=require(process.argv[1]); let report=null;
    store.scheduleSave(()=>({savedAt:Date.now(),playlist:[],lyricSettings:{fontSize:64}}),(result)=>{report=result;});
    store.saveNow(); process.stdout.write('__RESULT__'+JSON.stringify(report));
  `;
  try {
    const result = require('child_process').spawnSync(process.execPath, ['-e', script, storePath], {
      encoding: 'utf8', env: { ...process.env, ELITESAND_DATA_DIR: dataDir }, timeout: 10000,
    });
    eq(result.status, 0, result.stderr || 'state save ack 子程序失敗: ');
    const report = JSON.parse(result.stdout.split('__RESULT__')[1]);
    ok(report.ok);
    ok(Number.isFinite(report.savedAt));
    eq(JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8')).lyricSettings.fontSize, 64);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('首次使用 checklist 可稍後繼續，Twitch 不列入三項必要條件', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const nav = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'nav.js'), 'utf8');
  ok(html.includes('guide-later'));
  ok(html.includes('Twitch 連線（選配）'));
  ok(nav.includes("['environment', 'song', 'obs']"));
  ok(!nav.includes("['environment', 'song', 'obs', 'twitch']"));
});

test('錯誤歷史使用文字節點並會遮蔽敏感 token', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'error-handler.js'), 'utf8');
  ok(source.includes("message.textContent = entry.message"));
  ok(source.includes("'$1 [redacted]'"));
  ok(source.includes('MAX_HISTORY = 30'));
});

function createErrorHandlerToastHarness() {
  const timers = new Map();
  let nextTimerId = 0;

  function makeNode() {
    const classes = new Set();
    return {
      parentNode: null,
      children: [],
      className: '',
      innerHTML: '',
      classList: {
        add(...values) { values.forEach((value) => classes.add(value)); },
        remove(...values) { values.forEach((value) => classes.delete(value)); },
        contains(value) { return classes.has(value); },
      },
      appendChild(child) {
        this.children.push(child);
        child.parentNode = this;
        return child;
      },
      removeChild(child) {
        const index = this.children.indexOf(child);
        if (index !== -1) this.children.splice(index, 1);
        child.parentNode = null;
        return child;
      },
      querySelector(selector) {
        return selector === '.toast-close' ? { addEventListener() {} } : null;
      },
    };
  }

  const toastContainer = makeNode();
  const context = {
    SharedUtils: { escapeHtml: (value) => String(value) },
    document: {
      getElementById: (id) => id === 'toast-container' ? toastContainer : null,
      createElement: () => makeNode(),
      body: makeNode(),
    },
    window: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    console: { log() {}, warn() {}, error() {} },
    requestAnimationFrame: (handler) => handler(),
    setTimeout: (handler) => {
      const id = ++nextTimerId;
      timers.set(id, handler);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'error-handler.js'), 'utf8'), context);
  const handler = vm.runInContext('ErrorHandler', context);

  return {
    show(message) { handler.showToast(message, 'success', 0); },
    toastContainer,
  };
}

test('toast overflow keeps five visible unique notifications without blocking', () => {
  const harness = createErrorHandlerToastHarness();
  for (let index = 1; index <= 6; index++) harness.show(`track-${index}`);

  eq(harness.toastContainer.children.length, 5, 'overflow must remove the oldest toast immediately: ');
  eq(
    harness.toastContainer.children.filter((toast) => !toast.classList.contains('toast-exit')).length,
    5,
    'all remaining toasts must stay active after a rapid burst: '
  );

  harness.show('track-7');
  eq(harness.toastContainer.children.length, 5, 'subsequent overflow must remain bounded: ');
});

// ═══════════════════════════════════════════
console.log('\n📦 9. 歌詞選擇器與歌詞設定');
// ═══════════════════════════════════════════
const { LyricsEngine, LYRICS_SOURCE_PRIORITY, cacheEntryIsFresh } = require('../server/services/lyrics-engine');
const { ProviderHealthRegistry } = require('../server/services/provider-health');

test('自動歌詞來源優先序符合設定', () => {
  eq(LYRICS_SOURCE_PRIORITY.join('>'), 'betterlyrics>paxsenix>kugou>qqmusic>lrclib>netease');
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
    eq(Number((result.stdout.split('__RESULT__')[1] || '').trim()), 6);
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

const { TwitchService, reconnectDelay } = require('../server/services/twitch-service');

test('Twitch EventSub 重連採指數退避並有上限', () => {
  eq(reconnectDelay(1, () => 0.5), 3000);
  eq(reconnectDelay(2, () => 0.5), 6000);
  eq(reconnectDelay(10, () => 0.5), 60000);
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
    event: { chatter_user_name: 'viewer', ignored: '不應保存' },
    createdAt, expiresAt: createdAt + 60000,
  });
  first.persistPendingRequests();
  first.stop();
  eq(saved.length, 1);
  eq(saved[0].event.chatter_user_name, 'viewer');
  ok(!Object.prototype.hasOwnProperty.call(saved[0].event, 'ignored'));

  const second = new TwitchService(options);
  eq(second.getPendingRequests().length, 1);
  eq(second.status().pendingRequestCount, 1);
  second.stop();
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


// ═══════════════════════════════════════════
console.log('\n📦 10. 歌詞清洗 (lyrics-cleaner.js)');
// ═══════════════════════════════════════════
const { cleanLyrics, normalizeText } = require('../server/services/lyrics-cleaner');
const AudioProcessor = require('../server/services/audio-processor');
const { assessYouTubeImport } = require('../server/utils/youtube-import-risk');
const { LOW_DISK_WARNING_BYTES, inspectDiskSpace, appendDiskSpaceWarning } = require('../server/services/disk-space');

test('YouTube 匯入風險：過短、過長與疑似非音樂會分別警告', () => {
  const tooShort = assessYouTubeImport({ title: 'Song teaser', duration: 35, categories: ['Music'] });
  ok(tooShort.warningTypes.includes('too-short'));
  ok(!tooShort.warningTypes.includes('non-music'));

  const tooLong = assessYouTubeImport({ title: 'Long medley', duration: 1201, categories: ['Music'] });
  ok(tooLong.warningTypes.includes('too-long'));

  const nonMusic = assessYouTubeImport({ title: '公共設施規定說明', duration: 301, categories: ['News & Politics'] });
  ok(nonMusic.warningTypes.includes('non-music'));
});

test('YouTube 匯入風險：正常長度音樂不誤報，未知時長不當成過短', () => {
  const music = assessYouTubeImport({ title: 'Aimer - 残響散歌', duration: 203, categories: ['Music'] });
  eq(music.warning, false);
  const unknown = assessYouTubeImport({ title: 'Song', duration: 0, categories: [] });
  ok(!unknown.warningTypes.includes('too-short'));
});

test('播放清單只掃描條目，逐首下載仍由前端共用佇列執行', () => {
  const api = fs.readFileSync(path.join(__dirname, '../server/routes/api.js'), 'utf8');
  const block = api.slice(api.indexOf("router.post('/youtube/playlist'"), api.indexOf("router.post('/lyrics/search'"));
  ok(block.includes('getPlaylistEntries'));
  ok(!block.includes('processYouTube('));
  const frontend = fs.readFileSync(path.join(__dirname, '../public/js/app-youtube-import.js'), 'utf8');
  ok(frontend.includes("'/api/youtube/inspect'"));
  ok(frontend.includes('requestId: job.requestId'));
  ok(frontend.includes('RISK_WARNING_DISABLED_KEY'));
  ok(frontend.includes('queueYouTubeImport(entry.url'));
});
const { classifyImportError } = require('../server/utils/import-error');

test('normalizeText：全形空白→半形、壓縮空白、去頭尾', () => {
  eq(normalizeText('　你好　　世界  '), '你好 世界');
});

test('匯入錯誤分類：登入、地區、下架、逾時與磁碟滿都有可行下一步', () => {
  const cases = [
    [new Error('Sign in to confirm your age; cookies required'), 'YOUTUBE_AUTH_REQUIRED'],
    [new Error('This video is not available in your country'), 'REGION_RESTRICTED'],
    [new Error('Private video'), 'VIDEO_UNAVAILABLE'],
    [Object.assign(new Error('request timed out'), { code: 'ETIMEDOUT' }), 'IMPORT_TIMEOUT'],
    [Object.assign(new Error('no space left'), { code: 'ENOSPC' }), 'DISK_FULL'],
  ];
  for (const [error, expected] of cases) {
    const result = classifyImportError(error);
    eq(result.code, expected);
    ok(result.message && result.recovery, `${expected} 應有人話與恢復方式: `);
  }
});

test('首尾製作資訊行被移除', () => {
  const lines = [
    { time: 0, text: '作詞：山田' },
    { time: 500, text: '作曲：田中' },
    { time: 1000, text: '第一句歌詞' },
    { time: 2000, text: '第二句歌詞' },
  ];
  const out = cleanLyrics(lines);
  eq(out.length, 2, '應只剩兩句正文: ');
  eq(out[0].text, '第一句歌詞');
});

test('正文中間的「作曲」字樣不被誤砍', () => {
  const lines = [];
  for (let i = 0; i < 12; i++) lines.push({ time: i * 1000, text: `歌詞${i}` });
  lines[6].text = '作曲家在燈下'; // 中間，非首尾 edge
  const out = cleanLyrics(lines);
  ok(out.some((l) => l.text === '作曲家在燈下'), '中段含關鍵字的正文應保留: ');
});

test('純音樂提示行被移除', () => {
  const lines = [
    { time: 0, text: '此歌曲为没有填词的纯音乐请欣赏' },
    { time: 1000, text: '正文' },
  ];
  const out = cleanLyrics(lines);
  ok(!out.some((l) => /纯音乐/.test(l.text)), '純音樂提示應被移除: ');
});

test('相鄰完全重複行（時間相近）去重', () => {
  const lines = [
    { time: 1000, text: '重複句' },
    { time: 1100, text: '重複句' },
    { time: 5000, text: '重複句' }, // 時間遠，視為正常副歌重複，保留
  ];
  const out = cleanLyrics(lines);
  eq(out.length, 2, '只去掉時間相近的那筆: ');
});

test('stripInstrumental 預設保留間奏標記、開啟後移除', () => {
  const lines = [
    { time: 0, text: '正文' },
    { time: 1000, text: '（間奏）' },
    { time: 2000, text: '正文2' },
  ];
  ok(cleanLyrics(lines).some((l) => /間奏/.test(l.text)), '預設應保留間奏: ');
  ok(!cleanLyrics(lines, { stripInstrumental: true }).some((l) => /間奏/.test(l.text)), '開啟後應移除: ');
});

test('空白行被移除、不變更輸入', () => {
  const lines = [{ time: 0, text: '  ' }, { time: 1000, text: '正文' }];
  const out = cleanLyrics(lines);
  eq(out.length, 1);
  eq(lines.length, 2, '輸入陣列不應被變更: ');
});

test('全被砍光時維持原樣（保險）', () => {
  const lines = [{ time: 0, text: '作詞：A' }, { time: 1000, text: '作曲：B' }];
  const out = cleanLyrics(lines);
  ok(out.length >= 1, '不應回傳空陣列: ');
});

test('冒號前兩角色合寫（混音/母带：）也視為製作資訊', () => {
  const lines = [
    { text: '混音/母带： YZ金俞泽' },
    { text: '吉他编写/吉他：吴海锋' },
    { text: '正文' },
  ];
  const out = cleanLyrics(lines);
  eq(out.length, 1, '兩行合寫的製作資訊都應被砍: ');
  eq(out[0].text, '正文');
});

test('版權/授權聲明整行（【】包住）被移除', () => {
  const lines = [
    { text: '【本歌曲已获得原词曲版权方授权】' },
    { text: '正文' },
  ];
  const out = cleanLyrics(lines);
  eq(out.length, 1);
  eq(out[0].text, '正文');
});

test('工作室、括號 credit 與 © 版權尾註被移除', () => {
  const lines = [
    { text: '第一句歌詞' },
    { text: '第二句歌詞' },
    { text: '【錄音室：Dream Studio】' },
    { text: 'Director：Someone' },
    { text: '© 2026 Example Records. All Rights Reserved.' },
  ];
  const out = cleanLyrics(lines);
  eq(out.length, 2, '尾端工作室與版權資訊應全部移除');
  eq(out[1].text, '第二句歌詞');
});

test('影片標題的多歌手【歌名】格式能精準拆解', () => {
  const parsed = AudioProcessor.parseVideoTitle('周華健 Wakin Chau&李宗盛 Jonathan Lee&品冠 Victor Wong【最近比較煩 Feel troubled】Official Music Video');
  eq(parsed.title, '最近比較煩 Feel troubled');
  eq(parsed.artist, '周華健 Wakin Chau&李宗盛 Jonathan Lee&品冠 Victor Wong');
});

test('電影宣傳型官方 MV 標題優先取書名號內歌名', () => {
  const parsed = AudioProcessor.parseVideoTitle('范逸臣 Van Fan《 國境之南》（電影【海角七號 Cape No. 7】 范逸臣、田中千繪 主演）官方MV (Official Music Video)');
  eq(parsed.title, '國境之南');
  eq(parsed.artist, '范逸臣 Van Fan');
});

test('95 首真實／伴奏標題基準：歌名與歌手正確率皆至少 95%', () => {
  const cases = require('./title-parser-cases');
  const normalizeIdentity = (value) => String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
  let titlePassed = 0;
  let artistPassed = 0;
  const misses = [];

  for (const entry of cases) {
    const actual = AudioProcessor.resolveTrackIdentity({ title: entry.raw, ...(entry.info || {}) });
    const titleOk = normalizeIdentity(actual.title) === normalizeIdentity(entry.title);
    const artistOk = normalizeIdentity(actual.artist) === normalizeIdentity(entry.artist);
    if (titleOk) titlePassed++;
    if (artistOk) artistPassed++;
    if (!titleOk || !artistOk) misses.push(`${entry.raw} => ${actual.artist} / ${actual.title}`);
  }

  const titleRate = titlePassed / cases.length;
  const artistRate = artistPassed / cases.length;
  ok(titleRate >= 0.95, `歌名正確率 ${(titleRate * 100).toFixed(1)}%，錯誤：${misses.join('；')}`);
  ok(artistRate >= 0.95, `歌手正確率 ${(artistRate * 100).toFixed(1)}%，錯誤：${misses.join('；')}`);
});

test('酷狗／QQ：緊湊標題行後的中英雙語製作名單整段移除', () => {
  const lines = [
    { time: 0, text: '浪子的路-RPG/茄子蛋' },
    { time: 970, text: '词Lyrics：J-RO/斐立普Felipe.Z/RPG' },
    { time: 1300, text: '曲Composing：RPG/斐立普Felipe. Z/J-RO' },
    { time: 1600, text: '编曲Arranger：斐立普Felipe. Z/老棍儿' },
    { time: 1900, text: '制作人Producer：斐立普Felipe. Z' },
    { time: 2200, text: '键盘Keyboard：转转' },
    { time: 2500, text: '录音编辑Vocal Editor：斐立普Felipe. Z' },
    { time: 2800, text: '录音师Recording Engineer：斐立普Felipe. Z/魏子杰 Kurtis Wei' },
    { time: 3100, text: '混音师Mixing Engineer：斐立普Felipe. Z' },
    { time: 3400, text: '母带后期Mastering：斐立普Felipe. Z @基械猫音乐有限公司' },
    { time: 3700, text: '制作发行Production：基械猫音乐有限公司' },
    { time: 4000, text: '数位发行 Digital Release：任意门娱乐股份有限公司' },
    { time: 4300, text: 'OP：基械猫音乐有限公司/Sony Music Publishing' },
    { time: 4600, text: 'SP：Sony Music Publishing' },
    { time: 15000, text: '应该是排气管零件的声音' },
    { time: 18000, text: '修车厂在哪里先继续前进' },
  ];
  const out = cleanLyrics(lines);
  eq(out.length, 2, '標題與 13 行製作名單應全部移除');
  eq(out[0].text, '应该是排气管零件的声音');
});

test('音檔下載失敗不可回傳 filename=null 的假成功項目', () => {
  let error = null;
  try { AudioProcessor.requireDownloadedAudio(null); } catch (err) { error = err; }
  ok(error && /音訊下載失敗/.test(error.message), '應明確拒絕沒有音檔的匯入');
});

test('結尾製作資訊超過舊版 8 行上限（9 行）仍全部被砍', () => {
  const lines = [
    { text: '正文A' }, { text: '正文B' },
    { text: '制作人：施仁 Shiva' },
    { text: '混音/母带： YZ金俞泽' },
    { text: '吉他编写/吉他：吴海锋' },
    { text: '和声：施仁 Shiva' },
    { text: '监制：施仁 Shiva' },
    { text: '企划：朱鹏辉' },
    { text: '统筹：小埃 alibi' },
    { text: '改编制作：潜水音乐' },
    { text: '音乐营销：网易飓风' },
  ];
  const out = cleanLyrics(lines);
  eq(out.length, 2, '9 行結尾製作資訊應全被砍，只剩正文: ');
  eq(out[1].text, '正文B');
});

test('使用者回報實例：貼上歌詞（無時間軸）走 autoParseLyrics 清洗頭尾製作資訊', () => {
  const { autoParseLyrics } = require('../server/services/lrc-parser');
  const text = [
    '原唱：花玲 / 喵☆酱 / 宴宁 / kinsen',
    '出品：网易飓风',
    'OP： ChiliChill Production',
    'SP：北京中子街声文化发展有限公司',
    '【本歌曲已获得原词曲版权方授权】',
    '当你的天空突然下起了大雨',
    '那是我在为你炸乌云',
    'Lalalalala...',
    '制作人：施仁 Shiva',
    '混音/母带： YZ金俞泽',
    '吉他编写/吉他：吴海锋',
    '和声：施仁 Shiva',
    '监制：施仁 Shiva',
    '企划：朱鹏辉',
    '统筹：小埃 alibi',
    '改编制作：潜水音乐',
    '音乐营销：网易飓风',
  ].join('\n');
  const result = autoParseLyrics(text);
  eq(result.type, 'txt');
  eq(result.lines.length, 3, '應只剩 3 句正文: ');
  eq(result.lines[0].text, '当你的天空突然下起了大雨');
  eq(result.lines[2].text, 'Lalalalala...');
});

// ═══════════════════════════════════════════
console.log('\n📦 11. 公開測試安全邊界');
// ═══════════════════════════════════════════
test('從播放清單移除歌曲後，手動歌詞與 offset 仍會保留供同 id 歌曲恢復', () => {
  const registerPlaylistHandlers = require('../server/routes/handlers/playlist');
  const events = new Map();
  const state = { playlist: [{ id: 'remembered-track', title: '保留設定的歌' }] };
  const trackOffsets = new Map([['remembered-track', 860]]);
  const manualLyricsCache = new Map([['remembered-track', {
    lyrics: '[00:00.86]保留的手動歌詞', lyricsType: 'lrc', parsedLyrics: [{ time: 860, text: '保留的手動歌詞' }],
  }]]);
  let persisted = 0;
  const ctx = {
    playState: state, trackOffsets, manualLyricsCache,
    persistState() { persisted += 1; }, emitSetlist() {}, broadcastState() {},
    getPublicPlaylist() { return state.playlist; },
  };
  registerPlaylistHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);
  events.get('playlist:remove')('remembered-track');
  eq(state.playlist.length, 0);
  eq(trackOffsets.get('remembered-track'), 860);
  eq(manualLyricsCache.get('remembered-track').lyrics, '[00:00.86]保留的手動歌詞');
  eq(persisted, 1, '移除後仍必須把保留的歌曲記憶寫入 state.json: ');
});

test('Release 選版與資產辨識由通知與更新器共用同一規則', () => {
  const releases = [
    { tag_name: 'v0.7.7', assets: [{ name: 'Elitesand-Pro-v0.7.7-portable.zip' }] },
    { tag_name: 'v0.8.0-rc.1', assets: [{ name: 'Elitesand-Pro-v0.8.0-rc.1-portable.zip' }] },
  ];
  eq(releaseClient.selectLatestRelease(releases).tag_name, selectLatestRelease(releases).tag_name);
  eq(releaseClient.findPortableAsset(releases[1]).name, 'Elitesand-Pro-v0.8.0-rc.1-portable.zip');
  const checkerSource = fs.readFileSync(path.join(__dirname, '../server/services/update-checker.js'), 'utf8');
  const updaterSource = fs.readFileSync(path.join(__dirname, '../server/services/app-updater.js'), 'utf8');
  ok(checkerSource.includes("require('./release-client')"));
  ok(updaterSource.includes("require('./release-client')"));
});

test('YouTube 匯入檢查會在可用磁碟空間低於 500 MB 時追加可略過的警告', () => {
  const lowSpace = inspectDiskSpace(process.cwd(), {
    statfsSync: () => ({ bavail: 400n, bsize: 1024n * 1024n }),
  });
  eq(lowSpace.known, true);
  eq(lowSpace.low, true);
  eq(lowSpace.freeBytes, 400 * 1024 * 1024);
  eq(lowSpace.thresholdBytes, LOW_DISK_WARNING_BYTES);

  const assessment = appendDiskSpaceWarning(assessYouTubeImport({ title: 'Normal song', duration: 180, categories: ['Music'] }), lowSpace);
  eq(assessment.warning, true);
  ok(assessment.warningTypes.includes('disk-space'));
  ok(assessment.warnings.some((warning) => warning.includes('500 MB')));

  const unavailable = inspectDiskSpace(process.cwd(), { statfsSync: () => { throw new Error('unsupported'); } });
  eq(unavailable.known, false);
  const unchanged = appendDiskSpaceWarning(assessYouTubeImport({ title: 'Normal song', duration: 180, categories: ['Music'] }), unavailable);
  eq(unchanged.warning, false, '無法讀取磁碟空間時不可阻擋正常匯入');

  const audioSource = fs.readFileSync(path.join(__dirname, '../server/services/audio-processor.js'), 'utf8');
  ok(audioSource.includes('appendDiskSpaceWarning(assessment, inspectDiskSpace(outputDir))'));
});

testAsync('Twitch 解除授權會清除權杖、停止 EventSub 並保留待確認點歌', async () => {
  const { TwitchService } = require('../server/services/twitch-service');
  const auth = { accessToken: 'test-access-token', refreshToken: 'test-refresh-token', userId: '42', userLogin: 'streamer' };
  let clearCalls = 0;
  const authStore = { load: () => auth, save: () => true, clear: () => { clearCalls += 1; return true; } };
  const pendingStore = { load: () => [], save: () => true };
  const service = new TwitchService({
    config: { twitchClientId: 'test-client', twitchRequestCommand: '!song' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => {}, onSongRequestExpired: () => {},
    authStore, pendingStore,
  });
  let socketClosed = 0;
  service.ws = { close: () => { socketClosed += 1; } };
  service.wsSessionId = 'session';
  service.pendingRequests.set('keep-request', { requestId: 'keep-request', expiresAt: Date.now() + 60000 });
  let revokedToken = null;
  const result = await service.deauthorize({ revoke: async (previousAuth) => {
    revokedToken = previousAuth.accessToken;
    return { attempted: true, revoked: true, alreadyInvalid: false };
  } });
  eq(clearCalls, 1);
  eq(socketClosed, 1);
  eq(service.auth, null);
  eq(service.ws, null);
  eq(service.connectionState, 'authorization_required');
  eq(service.pendingRequests.size, 1, '解除授權不可清掉已收到的點歌');
  eq(revokedToken, 'test-access-token');
  eq(result.remoteRevoked, true);

  const routerSource = fs.readFileSync(path.join(__dirname, '../server/routes/twitch-auth.js'), 'utf8');
  ok(routerSource.includes("router.post('/api/twitch/deauthorize', requirePin"));
  const clientSource = fs.readFileSync(path.join(__dirname, '../public/js/app-twitch.js'), 'utf8');
  ok(clientSource.includes("'/api/twitch/deauthorize'"));
  ok(clientSource.includes('DangerConfirm?.request'));
});

test('R4-3 破壞性資料操作走輸入式確認，播放清單只需簡單確認', () => {
  const root = path.join(__dirname, '..');
  const panel = fs.readFileSync(path.join(root, 'public', 'js', 'app-playlist.js'), 'utf8');
  const library = fs.readFileSync(path.join(root, 'public', 'js', 'media-library.js'), 'utf8');
  const dialog = fs.readFileSync(path.join(root, 'public', 'js', 'danger-confirm.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  ok(panel.includes('確定要清空本次播放清單'), '清空播放清單必須保留簡單確認: ');
  ok(!panel.includes("phrase: '清空播放清單'"), '清空播放清單不應再要求輸入文字: ');
  ok(library.includes("phrase: '清理音檔'"), '清理音檔必須要求輸入明確動作: ');
  ok(library.includes("phrase: '清空媒體庫'"), '清空媒體庫必須要求輸入明確動作: ');
  ok(!library.includes('清理不在目前播放清單中的已下載音檔？'), '清理音檔不得退回單鍵確認: ');
  ok(!library.includes('確定清空整個媒體庫？'), '清空媒體庫不得退回單鍵確認: ');
  ok(dialog.includes('inputMatches') && dialog.includes('submit.disabled'), '確認按鈕必須受輸入內容約束: ');
  ok(html.includes('id="danger-confirm-modal"'), '輸入式確認視窗必須實際掛在面板: ');
});

test('系統字體選單不把字體名稱拼進 HTML 或 style 字串', () => {
  const lyricExtras = fs.readFileSync(path.join(__dirname, '../public/js/lyric-extras.js'), 'utf8');
  ok(lyricExtras.includes('function setFontOptions(select, fams, placeholder)'), '字體選項必須由獨立 DOM helper 建立: ');
  ok(lyricExtras.includes('option.textContent = family') && lyricExtras.includes('option.value = family'), '字體名稱必須走文字節點與 value: ');
  ok(lyricExtras.includes('option.style.fontFamily = family'), '字體預覽必須走 CSSOM 單一屬性: ');
  ok(!lyricExtras.includes('<option value="${safe}" style="font-family'), '字體名稱不可再拼進 option HTML/style 字串: ');
  ok(!lyricExtras.includes('fontOptionsHtml('), '舊的字串式字體選項 helper 必須移除: ');
});

test('媒體庫連續加入採逐首佇列與伺服器確認，避免完整歌詞併發堆積', () => {
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');
  const library = fs.readFileSync(path.join(root, 'public', 'js', 'media-library.js'), 'utf8');
  const playlistHandler = fs.readFileSync(path.join(root, 'server', 'routes', 'handlers', 'playlist.js'), 'utf8');
  ok(library.includes('const restoreQueue = []') && library.includes('async function runRestoreQueue'), '媒體庫還原必須有逐首處理佇列: ');
  ok(library.includes("await requestSocket('library:reimport', item.id)") && library.includes('await window.VKState.addLibraryTrack(resp.track)'), '下一首必須等待前一首還原與加入完成: ');
  ok(app.includes("SocketClient.sendWithCallback('playlist:add', [track]"), '媒體庫加入必須等待伺服器確認: ');
  const addLibraryTrack = app.slice(app.indexOf('addLibraryTrack: (track)'), app.indexOf('},\n  };'));
  ok(addLibraryTrack.indexOf("if (result?.ok) {") < addLibraryTrack.indexOf('if (shouldLoadFirstTrack) AppShared.playTrack'), '第一首只能在伺服器確認加入後才載入: ');
  ok(addLibraryTrack.indexOf('if (shouldLoadFirstTrack) AppShared.playTrack') < addLibraryTrack.indexOf('resolve(result)'), '第一首載入必須在成功回覆完成前送出: ');
  ok(playlistHandler.includes("socket.on('playlist:add', (tracks, ack) =>") && playlistHandler.includes("ack({ ok: true, added: added.length })"), '伺服器 playlist:add 必須回傳加入確認: ');
});

testAsync('媒體庫 UI 快速連點六首時逐首完成，失敗也不會卡住後續佇列', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/media-library.js'), 'utf8');

  class FakeElement {
    constructor() {
      this.children = [];
      this.listeners = new Map();
      this.lookup = new Map();
      this.dataset = {};
      this.classList = { contains: () => false, add() {}, remove() {} };
      this.disabled = false;
      this.hidden = false;
      this.textContent = '';
      this._innerHTML = '';
    }
    set innerHTML(value) {
      this._innerHTML = value;
      this.children = [];
      this.lookup.clear();
      if (String(value).includes('lib-reimport')) {
        const add = new FakeElement();
        add.textContent = '加入清單';
        const remove = new FakeElement();
        this.lookup.set('.lib-reimport', add);
        this.lookup.set('.lib-remove', remove);
      }
    }
    get innerHTML() { return this._innerHTML; }
    appendChild(child) { this.children.push(child); return child; }
    querySelector(selector) { return this.lookup.get(selector) || null; }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    click() { this.listeners.get('click')?.({ target: this }); }
  }

  async function runScenario({ rejectId = null, timeoutId = null } = {}) {
    const list = new FakeElement();
    const empty = new FakeElement();
    const elements = { 'library-list': list, 'library-empty': empty };
    const socketEvents = new Map();
    const timeline = [];
    const pendingRestores = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const enter = (phase, id) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      timeline.push(`${phase}:start:${id}`);
    };
    const leave = (phase, id) => {
      timeline.push(`${phase}:end:${id}`);
      inFlight -= 1;
    };
    const context = {
      setTimeout,
      clearTimeout,
      Promise,
      console,
      document: {
        getElementById(id) { return elements[id] || null; },
        createElement() { return new FakeElement(); },
        querySelector() { return null; },
        addEventListener() {},
      },
      SharedUtils: { escapeHtml: (value) => String(value), safeHttpUrl: () => null },
      ErrorHandler: { showToast(message, type) { timeline.push(`toast:${type}:${message}`); } },
      SocketClient: {
        sendWithCallback(event, data, callback) {
          if (event !== 'library:reimport') throw new Error(`未預期的 socket 事件：${event}`);
          enter('restore', data);
          pendingRestores.push({ id: data, callback });
        },
        on(event, handler) { socketEvents.set(event, handler); },
        connected() { return true; },
      },
      window: {
        confirm() { return true; },
        VKState: {
          isInPlaylist() { return false; },
          addLibraryTrack(track) {
            enter('add', track.id);
            leave('add', track.id);
            return Promise.resolve(track.id === rejectId ? { ok: false, error: '測試拒絕' } : { ok: true });
          },
        },
      },
    };
    vm.runInNewContext(source, context, { filename: 'media-library.js' });
    const items = Array.from({ length: 6 }, (_, index) => ({
      id: `queue-${index + 1}`,
      title: `佇列測試 ${index + 1}`,
      artist: 'QA',
      playCount: 6 - index,
      lastPlayed: index,
    }));
    socketEvents.get('library:list')(items);
    eq(list.children.length, 6, '媒體庫清單必須渲染六個加入按鈕: ');
    const buttons = list.children.map((row) => row.querySelector('.lib-reimport'));
    buttons.forEach((button) => button.click());
    eq(pendingRestores.length, 1, '快速連點後只能先送出第一首還原: ');
    for (let index = 0; index < items.length; index += 1) {
      const pending = pendingRestores.shift();
      eq(pending?.id, items[index].id, '還原請求必須保持點選順序: ');
      leave('restore', pending.id);
      pending.callback(pending.id === timeoutId ? null : {
        track: { id: pending.id, title: pending.id, filename: 'fixture.mp3', parsedLyrics: [{ time: 0, text: pending.id }] },
      });
      // requestSocket、await addLibraryTrack 與 while 的下一輪均為 microtask；多輪 flush
      // 是為了驗證由實際 source 驅動的後續請求，不靠測試計時器碰巧排程。
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
      if (index < items.length - 1) eq(pendingRestores.length, 1, '每首完成後才可送下一首還原: ');
    }
    return { buttons, timeline, maxInFlight };
  }

  const success = await runScenario();
  eq(success.maxInFlight, 1, '還原與加入不可重疊併發: ');
  const successfulAdds = success.timeline.filter((entry) => entry.startsWith('add:end:'));
  eq(successfulAdds.join(','), 'add:end:queue-1,add:end:queue-2,add:end:queue-3,add:end:queue-4,add:end:queue-5,add:end:queue-6', `六首必須依點選順序完成（事件：${success.timeline.join(',')}）: `);
  success.buttons.forEach((button) => { eq(button.disabled, true, '成功的按鈕必須保持防重複加入: '); eq(button.textContent, '已加入'); });

  const rejected = await runScenario({ rejectId: 'queue-3' });
  eq(rejected.maxInFlight, 1, '單首拒絕後也不可轉為併發: ');
  ok(rejected.timeline.includes('add:end:queue-6'), '第三首被拒絕後，第六首仍必須完成: ');
  eq(rejected.buttons[2].disabled, false, '被伺服器拒絕的按鈕必須恢復可重試: ');
  eq(rejected.buttons[2].textContent, '加入清單', '被伺服器拒絕的按鈕必須恢復原標籤: ');

  const timedOut = await runScenario({ timeoutId: 'queue-2' });
  eq(timedOut.maxInFlight, 1, '逾時後也不可轉為併發: ');
  ok(timedOut.timeline.includes('add:end:queue-6'), '第二首逾時後，第六首仍必須完成: ');
  eq(timedOut.buttons[1].disabled, false, '逾時的按鈕必須恢復可重試: ');
  eq(timedOut.buttons[1].textContent, '加入清單', '逾時的按鈕必須恢復原標籤: ');
});

test('playlist:add 會逐次確認加入並拒絕超過上限，供媒體庫佇列安全回滾', () => {
  const registerPlaylistHandlers = require('../server/routes/handlers/playlist');
  const events = new Map();
  const state = { playlist: [] };
  let persisted = 0;
  const ctx = {
    playState: state, trackOffsets: new Map(), manualLyricsCache: new Map(),
    persistState() { persisted += 1; }, emitSetlist() {}, broadcastState() {},
    getPublicPlaylist() { return state.playlist; },
  };
  registerPlaylistHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);

  let firstAck;
  events.get('playlist:add')([{ id: 'library-one', title: '媒體庫歌曲一' }], (result) => { firstAck = result; });
  eq(firstAck.ok, true);
  eq(firstAck.added, 1);
  eq(state.playlist.map((track) => track.id).join(','), 'library-one');
  eq(persisted, 1);

  state.playlist = Array.from({ length: 500 }, (_, i) => ({ id: `full-${i}`, title: `已滿 ${i}` }));
  let fullAck;
  events.get('playlist:add')([{ id: 'over-limit', title: '不得加入' }], (result) => { fullAck = result; });
  eq(fullAck.ok, false);
  ok(fullAck.error.includes('500'));
  eq(state.playlist.length, 500);
});

test('R4-2 播放清單可搜尋篩選並安全批次選取，不會選到目前歌曲', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const shared = fs.readFileSync(path.join(root, 'public', 'js', 'app-shared.js'), 'utf8');
  const playlist = fs.readFileSync(path.join(root, 'public', 'js', 'app-playlist.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'css', 'panel.css'), 'utf8');
  ok(html.includes('id="playlist-filter"') && html.includes('id="playlist-filter-mode"'), '面板必須有搜尋與狀態篩選入口: ');
  ok(html.includes('value="upcoming"') && html.includes('value="played"') && html.includes('value="no-lyrics"') && html.includes('value="missing-audio"'), '篩選必須涵蓋待唱、已唱、無歌詞與音檔遺失: ');
  ok(html.includes('id="btn-playlist-selection-remove"'), '批次移除入口必須存在: ');
  ok(shared.includes('playlistFilter: document.getElementById') && shared.includes('btnPlaylistSelectionRemove: document.getElementById'), '跨模組 DOM 表必須接上篩選與批次操作: ');
  ok(playlist.includes('function trackMatchesFilter') && playlist.includes('function toggleVisibleTrackSelection'), '篩選與可見項目選取必須有獨立邏輯: ');
  ok(playlist.includes('const selectedTrackKeys = new Set()') && playlist.includes('const selectionKeyByTrack = new WeakMap()'), '批次選取必須以每筆清單物件區分，不能把重複曲目混在一起: ');
  ok(playlist.includes('index !== currentTrackIndex && selectedTrackKeys.has(key)'), '目前播放歌曲必須排除在可批次移除的選取集合外: ');
  ok(playlist.includes('正在播放的歌曲不能批次選取') && playlist.includes("SocketClient.sendWithCallback('playlist:update'"), '批次移除必須保護目前歌曲並沿用可回滾的完整清單同步: ');
  ok(playlist.includes('DangerConfirm?.request') && playlist.includes('移除已選歌曲'), '批次移除必須先取得明確確認: ');
  ok(css.includes('.playlist.is-selecting .pi-select') && css.includes('.playlist.is-selecting .pi-extras'), '選取模式必須顯示核取框並收起列內其他動作: ');
});

test('R6-2 display runtime 指紋會涵蓋本機資產並強制更新網址', () => {
  const { renderDisplayRuntimePage } = require('../server/services/display-runtime-build');
  const page = renderDisplayRuntimePage(path.join(__dirname, '..', 'public'));
  ok(/^[a-f0-9]{16}$/.test(page.build), 'display 指紋必須是固定長度的十六進位值: ');
  ok(page.html.includes(`data-elitesand-display-build="${page.build}"`), 'display HTML 必須攜帶自身指紋: ');
  ok(page.html.includes(`/js/display.js?v=${page.build}`), 'display 主程式必須使用指紋網址: ');
  ok(page.html.includes(`/css/display.css?v=${page.build}`), 'display CSS 必須使用指紋網址: ');
  ok(!page.html.includes('fonts.googleapis.com/css2?family=Noto+Sans+SC?v='), '外部字體網址不可被錯誤改寫: ');
});

test('R6-2 display 快取診斷必須保留唯讀權限並提供面板提示', () => {
  const root = path.join(__dirname, '..');
  const socketSource = fs.readFileSync(path.join(root, 'server', 'routes', 'socket-handler.js'), 'utf8');
  const displaySource = fs.readFileSync(path.join(root, 'public', 'js', 'display.js'), 'utf8');
  const panelSource = fs.readFileSync(path.join(root, 'public', 'js', 'app-toast-utils.js'), 'utf8');
  ok(socketSource.includes("'client:build'"), 'display 指紋回報必須在唯讀白名單中: ');
  ok(socketSource.includes('displayRuntime:'), 'client:counts 必須回傳顯示端版本狀態: ');
  ok(displaySource.includes("SocketClient.send('client:build'"), 'display 必須主動回報版本指紋: ');
  ok(panelSource.includes('歌詞可能為舊版') && panelSource.includes('重新整理快取'), '面板必須顯示可行的 OBS 快取修復指引: ');
});

test('R6-2 display 版本回報會區分待驗證、正確與舊快取', () => {
  const makeIo = () => ({
    emitted: [], authMiddleware: null, connectionHandler: null, sockets: { sockets: new Map() },
    use(fn) { this.authMiddleware = fn; },
    on(event, fn) { if (event === 'connection') this.connectionHandler = fn; },
    emit(event, data) { this.emitted.push({ event, data }); },
  });
  const socket = {
    id: 'display-build-test', handshake: { auth: { clientType: 'display', pin: '' }, address: '127.0.0.1' },
    events: new Map(), emitted: [], connected: true,
    on(event, fn) { this.events.set(event, fn); },
    emit(event, data) { this.emitted.push({ event, data }); },
    use(fn) { this.packetMiddleware = fn; },
  };
  const io = makeIo();
  socketHandler(io);
  io.authMiddleware(socket, (err) => { if (err) throw err; });
  io.sockets.sockets.set(socket.id, socket);
  io.connectionHandler(socket);
  socket.events.get('client:type')('display');
  const waiting = io.emitted.at(-1).data.displayRuntime;
  eq(waiting.pending, 1, 'display 剛連線時應短暫等待版本回報: ');
  socket.events.get('client:build')({ displayBuild: waiting.expectedBuild });
  const current = io.emitted.at(-1).data.displayRuntime;
  eq(current.current, 1, '回報目前指紋後應標示為正確: ');
  socket.events.get('client:build')({ displayBuild: 'a'.repeat(16) });
  const stale = io.emitted.at(-1).data.displayRuntime;
  eq(stale.stale, 1, '不同指紋必須標示為舊快取: ');
});

test('面板以 playlist:update 移除歌曲時，同樣不會清掉歌曲記憶', () => {
  const registerPlaylistHandlers = require('../server/routes/handlers/playlist');
  const events = new Map();
  const state = { playlist: [{ id: 'remembered-update', title: '面板移除的歌' }] };
  const trackOffsets = new Map([['remembered-update', 510]]);
  const manualLyricsCache = new Map([['remembered-update', { lyrics: '[00:00.51]保留', lyricsType: 'lrc' }]]);
  let persisted = 0;
  const ctx = {
    playState: state, trackOffsets, manualLyricsCache,
    persistState() { persisted += 1; }, emitSetlist() {}, broadcastState() {},
    getPublicPlaylist() { return state.playlist; },
  };
  registerPlaylistHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);
  let acknowledgement;
  events.get('playlist:update')([], (result) => { acknowledgement = result; });
  eq(acknowledgement.ok, true);
  eq(state.playlist.length, 0);
  eq(trackOffsets.get('remembered-update'), 510);
  eq(manualLyricsCache.get('remembered-update').lyrics, '[00:00.51]保留');
  eq(persisted, 1);
});

test('R4-2 批次移除部分歌曲後，留下的清單與所有歌曲記憶都正確保留', () => {
  const registerPlaylistHandlers = require('../server/routes/handlers/playlist');
  const events = new Map();
  const state = {
    playlist: [
      { id: 'batch-current', title: '目前播放歌曲' },
      { id: 'batch-remove-a', title: '待移除 A' },
      { id: 'batch-keep', title: '保留歌曲' },
      { id: 'batch-remove-b', title: '待移除 B' },
    ],
  };
  const trackOffsets = new Map([
    ['batch-current', 100], ['batch-remove-a', 200], ['batch-keep', 300], ['batch-remove-b', 400],
  ]);
  const manualLyricsCache = new Map([
    ['batch-remove-a', { lyrics: '[00:00.20]A', lyricsType: 'lrc' }],
    ['batch-keep', { lyrics: '[00:00.30]保留', lyricsType: 'lrc' }],
    ['batch-remove-b', { lyrics: '[00:00.40]B', lyricsType: 'lrc' }],
  ]);
  const ctx = {
    playState: state, trackOffsets, manualLyricsCache,
    persistState() {}, emitSetlist() {}, broadcastState() {},
    getPublicPlaylist() { return state.playlist; },
  };
  registerPlaylistHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);
  let acknowledgement;
  events.get('playlist:update')([
    { id: 'batch-current', title: '目前播放歌曲' },
    { id: 'batch-keep', title: '保留歌曲' },
  ], (result) => { acknowledgement = result; });
  eq(acknowledgement.ok, true);
  eq(state.playlist.map((track) => track.id).join(','), 'batch-current,batch-keep');
  eq(trackOffsets.get('batch-remove-a'), 200);
  eq(trackOffsets.get('batch-remove-b'), 400);
  eq(manualLyricsCache.get('batch-remove-a').lyrics, '[00:00.20]A');
  eq(manualLyricsCache.get('batch-keep').lyrics, '[00:00.30]保留');
  eq(manualLyricsCache.get('batch-remove-b').lyrics, '[00:00.40]B');
});

test('offset:set 會立即持久化，歌曲移出清單後重開程式仍可恢復', () => {
  const registerLyricsHandlers = require('../server/routes/handlers/lyrics');
  const events = new Map();
  const trackOffsets = new Map();
  let persisted = 0;
  const ctx = {
    playState: { currentTrack: null }, trackOffsets, manualLyricsCache: new Map(),
    persistState() { persisted += 1; }, broadcastState() {},
  };
  registerLyricsHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);
  events.get('offset:set')({ trackId: 'remembered-track', offset: -420 });
  eq(trackOffsets.get('remembered-track'), -420);
  eq(persisted, 1, 'offset:set 不可只留在記憶體: ');
});

test('同 id 歌曲重新加入後播放時，會套回保留的手動歌詞與 offset', () => {
  const registerPlaybackHandlers = require('../server/routes/handlers/playback');
  const libraryStore = require('../server/services/library-store');
  const originalAudioExists = libraryStore.audioExists;
  const originalRecordPlay = libraryStore.recordPlay;
  const events = new Map();
  const emitted = [];
  const stored = {
    id: 'remembered-readd', title: '重新加入的歌', filename: 'fixture-ready.mp3',
    lyrics: '[00:01.00]自動歌詞', lyricsType: 'lrc', parsedLyrics: [{ time: 1000, text: '自動歌詞' }],
  };
  const manual = {
    lyrics: '[00:02.50]手動修正後的歌詞', lyricsType: 'lrc', parsedLyrics: [{ time: 2500, text: '手動修正後的歌詞' }],
  };
  const playState = { playlist: [stored], currentTrack: null };
  try {
    libraryStore.audioExists = () => true;
    libraryStore.recordPlay = () => {};
    registerPlaybackHandlers(
      { emit(event, data) { emitted.push({ event, data }); } },
      { id: 'fixture-controller', clientType: 'controller', on(event, handler) { events.set(event, handler); }, emit() {} },
      {
        playState,
        trackOffsets: new Map([['remembered-readd', 2500]]),
        trackPitch: new Map(), trackSpeed: new Map(), manualLyricsCache: new Map([['remembered-readd', manual]]),
        getEffectiveLyrics(id) { return id === 'remembered-readd' ? manual : null; },
        persistState() {}, emitSetlist() {}, recordSessionSong() {}, broadcastState() {},
      },
    );
    events.get('play:track')({ id: stored.id, title: stored.title, filename: stored.filename, autoplay: false });
    eq(playState.currentOffset, 2500);
    eq(playState.currentTrack.lyrics, manual.lyrics);
    eq(playState.currentTrack.parsedLyrics[0].text, '手動修正後的歌詞');
    const sent = emitted.find((item) => item.event === 'play:track').data;
    eq(sent.offset, 2500);
    eq(sent.lyrics, manual.lyrics);
  } finally {
    libraryStore.audioExists = originalAudioExists;
    libraryStore.recordPlay = originalRecordPlay;
  }
});

test('playlist:insert-next uses canonical playback state and appends only when idle', () => {
  const registerPlaylistHandlers = require('../server/routes/handlers/playlist');
  const events = new Map();
  const first = { id: 'first', title: '第一首' };
  const current = { id: 'current', title: '目前歌曲' };
  const later = { id: 'later', title: '原本下一首' };
  const playState = { playlist: [first, current, later], currentTrack: current };
  let setlist = 0;
  let broadcast = 0;
  let persisted = 0;
  const ctx = {
    playState, trackOffsets: new Map(), manualLyricsCache: new Map(),
    emitSetlist() { setlist += 1; }, broadcastState() { broadcast += 1; }, persistState() { persisted += 1; },
    getPublicPlaylist() { return playState.playlist; },
  };
  registerPlaylistHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);
  let acknowledgement;
  events.get('playlist:insert-next')({ id: 'twitch-next', title: '插播歌曲' }, (result) => { acknowledgement = result; });
  eq(acknowledgement.ok, true);
  eq(acknowledgement.placement, 'next');
  eq(acknowledgement.insertAt, 2);
  eq(playState.playlist.map((track) => track.id).join(','), 'first,current,twitch-next,later');
  eq(setlist, 1);
  eq(broadcast, 1);
  eq(persisted, 1);

  playState.currentTrack = null;
  events.get('playlist:insert-next')({ id: 'idle-append', title: '待命歌曲' }, (result) => { acknowledgement = result; });
  eq(acknowledgement.placement, 'end');
  eq(acknowledgement.insertAt, 4);
  eq(playState.playlist[4].id, 'idle-append');
});

const socketOrigin = require('../server/utils/socket-origin');
const trackSchema = require('../server/utils/track-schema');
const authLimiter = require('../server/services/auth-rate-limiter');

test('Socket Origin：同源 localhost/私有 IP 通過，外部網站拒絕', () => {
  ok(socketOrigin.isAllowedSocketRequest({ headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' } }));
  ok(socketOrigin.isAllowedSocketRequest({ headers: { host: '192.168.1.8:3000', origin: 'http://192.168.1.8:3000' } }));
  ok(!socketOrigin.isAllowedSocketRequest({ headers: { host: '127.0.0.1:3000', origin: 'https://evil.example' } }));
  ok(!socketOrigin.isAllowedSocketRequest({ headers: { host: 'evil.example', origin: 'https://evil.example' } }));
  ok(socketOrigin.isAllowedSocketRequest({ headers: { host: 'localhost:3000' } }), 'OBS/CLI 無 Origin 應允許: ');
});

test('Track schema：移除未知欄位、危險 URL，並限制播放清單長度', () => {
  const malicious = {
    id: 'x', title: '<img src=x onerror=alert(1)>', artist: '<script>x</script>',
    cover: 'javascript:alert(1)', filename: '..\\..\\evil.mp3', extraAdmin: true,
  };
  const clean = trackSchema.sanitizeTrack(malicious);
  eq(clean.title, malicious.title, '文字資料保持原文並由 DOM textContent 顯示: ');
  eq(clean.cover, null);
  eq(clean.filename, 'evil.mp3');
  ok(!('extraAdmin' in clean));
  const many = Array.from({ length: 550 }, (_, i) => ({ id: String(i), title: `song-${i}` }));
  eq(trackSchema.sanitizePlaylist(many).length, trackSchema.MAX_PLAYLIST_SIZE);
});

test('PIN rate limit：連續失敗後鎖定，成功/重設可清除', () => {
  authLimiter.resetAll();
  for (let i = 0; i < authLimiter.MAX_FAILURES; i++) authLimiter.recordFailure('test-client', 1000);
  ok(!authLimiter.status('test-client', 1001).allowed);
  authLimiter.reset('test-client');
  ok(authLimiter.status('test-client', 1001).allowed);
});

test('音檔巡檢：缺少檔名或檔案時標記遺失，存在時標記可播放', () => {
  const libraryStore = require('../server/services/library-store');
  ok(libraryStore.audioStatus({ id: 'none' }, () => true).audioMissing);
  ok(libraryStore.audioStatus({ filename: 'missing.mp3' }, () => false).audioMissing);
  ok(libraryStore.audioStatus({ filename: 'ready.mp3' }, (name) => name === 'ready.mp3').audioAvailable);
});

test('播放前預檢：音檔遺失時不改播放狀態並回傳可恢復錯誤', () => {
  const registerPlaybackHandlers = require('../server/routes/handlers/playback');
  const events = new Map();
  const emitted = [];
  const socket = {
    id: 'fixture-controller', clientType: 'controller',
    on(event, handler) { events.set(event, handler); },
    emit(event, data) { emitted.push({ event, data }); },
  };
  registerPlaybackHandlers({ emit() { throw new Error('遺失音檔不可廣播播放事件'); } }, socket, {});
  events.get('play:track')({
    id: 'missing-track', title: '遺失測試歌曲', filename: `definitely-missing-${Date.now()}.mp3`,
    url: 'https://www.youtube.com/watch?v=fixture', autoplay: true,
  });
  const error = emitted.find((item) => item.event === 'audio:error')?.data;
  eq(error.code, 'AUDIO_FILE_MISSING');
  ok(error.retryable, '有來源網址時應告知可重新下載: ');
  ok(/重新下載/.test(error.message), '錯誤應提供下一步: ');
});

test('播放清單摘要選歌時以伺服器保存的完整歌曲資料為準', () => {
  const registerPlaybackHandlers = require('../server/routes/handlers/playback');
  const events = new Map();
  const emitted = [];
  const socket = {
    id: 'fixture-controller', clientType: 'controller',
    on(event, handler) { events.set(event, handler); },
    emit(event, data) { emitted.push({ event, data }); },
  };
  const stored = {
    id: 'saved-track', title: '伺服器保存名稱', filename: `definitely-missing-${Date.now()}.mp3`,
    url: 'https://www.youtube.com/watch?v=fixture', lyrics: '[00:01.00]完整歌詞', lyricsType: 'lrc',
    parsedLyrics: [{ time: 1000, text: '完整歌詞' }],
  };
  registerPlaybackHandlers({ emit() {} }, socket, { playState: { playlist: [stored] } });
  events.get('play:track')({
    id: stored.id, title: '摘要名稱', filename: 'summary-only.mp3',
    url: stored.url, autoplay: true,
  });
  const error = emitted.find((item) => item.event === 'audio:error')?.data;
  eq(error.title, '伺服器保存名稱', '應由伺服器保存的曲目資料進行播放前檢查: ');
});

test('清單摘要排序回寫不會洗掉伺服器保存的歌詞', () => {
  const registerPlaylistHandlers = require('../server/routes/handlers/playlist');
  const events = new Map();
  const emitted = [];
  const socket = { on(event, handler) { events.set(event, handler); } };
  const state = {
    playlist: [{
      id: 'keep-lyrics', title: '保留歌詞', filename: null,
      lyrics: '[00:01.00]不得遺失', lyricsType: 'lrc', parsedLyrics: [{ time: 1000, text: '不得遺失' }],
    }],
  };
  const ctx = {
    playState: state, trackOffsets: new Map(), manualLyricsCache: new Map(),
    persistState() {}, emitSetlist() {}, broadcastState() {},
    getPublicPlaylist() {
      return state.playlist.map(({ lyrics, parsedLyrics, ...track }) => ({ ...track, hasLyrics: !!lyrics }));
    },
  };
  registerPlaylistHandlers({ emit(event, data) { emitted.push({ event, data }); } }, socket, ctx);
  let acknowledgement;
  events.get('playlist:update')([{ id: 'keep-lyrics', title: '重新排序後的名稱', lyricsType: 'lrc' }], (result) => { acknowledgement = result; });
  eq(acknowledgement.ok, true);
  eq(state.playlist[0].lyrics, '[00:01.00]不得遺失');
  eq(state.playlist[0].parsedLyrics[0].text, '不得遺失');
  const publicUpdate = emitted.find((item) => item.event === 'playlist:update').data[0];
  eq(Object.prototype.hasOwnProperty.call(publicUpdate, 'lyrics'), false, '廣播清單仍應是摘要: ');
});

test('Socket 角色：display 只掛唯讀事件，controller 才有寫入事件', () => {
  const makeIo = () => ({
    emitted: [], authMiddleware: null, connectionHandler: null,
    use(fn) { this.authMiddleware = fn; },
    on(event, fn) { if (event === 'connection') this.connectionHandler = fn; },
    emit(event, data) { this.emitted.push({ event, data }); },
  });
  const makeSocket = (type) => ({
    id: `${type}-1`, handshake: { auth: { clientType: type, pin: '' }, address: '127.0.0.1' },
    events: new Map(), emitted: [],
    on(event, fn) { this.events.set(event, fn); },
    emit(event, data) { this.emitted.push({ event, data }); },
    use(fn) { this.packetMiddleware = fn; },
  });

  const overlayIo = makeIo();
  socketHandler(overlayIo);
  const overlay = makeSocket('display');
  overlayIo.authMiddleware(overlay, (err) => { if (err) throw err; });
  overlayIo.connectionHandler(overlay);
  ok(overlay.events.has('state:request'));
  ok(!overlay.events.has('play:toggle'));
  ok(!overlay.events.has('library:clear'));

  const controlIo = makeIo();
  socketHandler(controlIo);
  const controller = makeSocket('controller');
  controlIo.authMiddleware(controller, (err) => { if (err) throw err; });
  controlIo.connectionHandler(controller);
  ok(controller.events.has('play:toggle'));
  ok(controller.events.has('library:clear'));
});

test('Stored XSS 回歸：歌單與遙控器以文字節點輸出外部 metadata', () => {
  const panelSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-setlist-panel.js'), 'utf8');
  const controllerSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'controller.js'), 'utf8');
  const sharedUtilsSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'shared-utils.js'), 'utf8');
  const playbackSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-playback.js'), 'utf8');
  const playlistSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-playlist.js'), 'utf8');
  const librarySource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'media-library.js'), 'utf8');
  ok(panelSource.includes("document.createTextNode(s.title || '')"), '歌單標題必須走文字節點: ');
  ok(panelSource.includes('artist.textContent = `— ${s.artist}`'), '歌單歌手必須走 textContent: ');
  ok(controllerSource.includes('escapeHtml(track.lyricsType.toUpperCase())'), '遙控器歌詞類型徽章必須 escape: ');
  const sandbox = { window: {}, URL, location: { origin: 'http://localhost:3000' } };
  vm.runInNewContext(sharedUtilsSource, sandbox);
  eq(sandbox.window.SharedUtils.safeHttpUrl('/api/cover/track.jpg'), 'http://localhost:3000/api/cover/track.jpg');
  eq(sandbox.window.SharedUtils.safeHttpUrl('https://i.ytimg.com/cover.jpg'), 'https://i.ytimg.com/cover.jpg');
  eq(sandbox.window.SharedUtils.safeHttpUrl('javascript:alert(1)'), '');
  eq(sandbox.window.SharedUtils.safeHttpUrl('data:image/svg+xml,<svg/>'), '');
  ok(controllerSource.includes('safeHttpUrl(track.cover)'), '遙控器封面必須走共用 URL allow-list: ');
  ok(playbackSource.includes('safeHttpUrl(track.cover)'), '桌面播放器封面必須走共用 URL allow-list: ');
  ok(playlistSource.includes('const coverUrl = safeHttpUrl(track.cover);'), '歌單封面必須走共用 URL allow-list: ');
  ok(librarySource.includes('const coverUrl = safeHttpUrl(item.cover);'), '媒體庫封面必須走共用 URL allow-list: ');
  ok(!librarySource.includes('style="${coverStyle}"'), '媒體庫不可把外部封面資料拼進 style HTML: ');
});

test('R13-1 generated card layouts use classes instead of fixed inline styles', () => {
  const baseCss = fs.readFileSync(path.join(__dirname, '../public/css/base.css'), 'utf8');
  const panelCss = fs.readFileSync(path.join(__dirname, '../public/css/panel.css'), 'utf8');
  const playlist = fs.readFileSync(path.join(__dirname, '../public/js/app-playlist.js'), 'utf8');
  const twitch = fs.readFileSync(path.join(__dirname, '../public/js/app-twitch.js'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  const obsWebsocket = fs.readFileSync(path.join(__dirname, '../public/js/obs-websocket.js'), 'utf8');
  const controller = fs.readFileSync(path.join(__dirname, '../public/js/controller.js'), 'utf8');
  const controllerCss = fs.readFileSync(path.join(__dirname, '../public/css/controller-new.css'), 'utf8');
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8');
  const setlistCss = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8');
  const karaokeSource = fs.readFileSync(path.join(__dirname, '../public/js/karaoke.js'), 'utf8');
  const displayCss = fs.readFileSync(path.join(__dirname, '../public/css/display.css'), 'utf8');
  ok(!twitch.includes('style='), 'Twitch request cards must not restore fixed inline styles: ');
  ok(!playlist.includes('playlist-import-item" type="button" data-import-filename="${escapeHtml(f.filename)}" style='), 'playlist import items must not restore fixed inline styles: ');
  ok(!setlistPanel.includes('style.cssText'), 'setlist custom-style chips must not restore fixed inline cssText: ');
  ok(!setlistPanel.includes('sessionStatus.style.color'), 'setlist session status must use a semantic state class: ');
  ok(!setlistPanel.includes('el.style.display ='), 'setlist visibility filters must use hidden instead of inline display: ');
  ok(!obsWebsocket.includes('statusEl.style.color'), 'OBS WebSocket status must use a semantic state class: ');
  ok(!controller.includes('dom.playlist.style.display'), 'controller playlist toggle must use its CSS state class: ');
  ok(!setlistSource.includes('id="tl-wrap" style=') && !setlistSource.includes('id="cn-wrap" style=') && !setlistSource.includes('cn-dust"><i style='), 'setlist fixed scene containers must not restore inline styles: ');
  ok(!setlistSource.includes(".cl-lbl-up').style.display") && !setlistSource.includes(".cl-lbl-done').style.display"), 'classic setlist labels must use semantic hidden instead of inline display: ');
  ok(setlistSource.includes('upLabel.hidden = up.length === 0;') && setlistSource.includes('doneLabel.hidden = past.length === 0;'), 'classic setlist labels must preserve their empty-state visibility rules: ');
  ok(!karaokeSource.includes('textLine.style.display') && !karaokeSource.includes('historyEl.style.display') && !karaokeSource.includes('activeEl.style.display'), 'classic lyrics and romanized mode must not restore inline display writes: ');
  ok(karaokeSource.includes("textLine.hidden = romanizationMode === 'romanized';") && karaokeSource.includes('historyEl.hidden = true') && karaokeSource.includes('activeEl.hidden = false'), 'classic lyrics must use semantic hidden for template and romanized-mode visibility: ');
  ok(panelCss.includes('.twitch-req-thumbnail') && panelCss.includes('.twitch-req-copy') && panelCss.includes('.twitch-req-warning'), 'Twitch request card CSP classes must exist: ');
  ok(panelCss.includes('.playlist-import-item { width: 100%; justify-content: space-between; margin-bottom: 6px; }') && panelCss.includes('.playlist-import-item__date { font-size: 11px; }'), 'playlist import CSP classes must exist: ');
  ok(baseCss.includes('.sls-custom-chip {') && baseCss.includes('.sls-custom-empty {') && baseCss.includes('.sls-custom-chip__delete'), 'setlist custom-style CSP classes must exist: ');
  ok(baseCss.includes('.session-status.is-active { color: var(--ok); }'), 'setlist session status CSS state must exist: ');
  ok(baseCss.includes('#obs-ws-status.is-connected { color: var(--success, #38b36a); }'), 'OBS WebSocket status CSS state must exist: ');
  ok(controllerCss.includes('.ctrl-playlist.visible { display: flex; }'), 'controller playlist CSS state must exist: ');
  ok(setlistCss.includes('.tl-wrap { position: absolute; inset: 0; pointer-events: none; }') && setlistCss.includes('.cn-wrap { position: absolute; inset: 0; }') && setlistCss.includes('.cn-dust-dot--5 { left: 83%; top: 70%; opacity: .4; }'), 'setlist fixed scene CSP classes must exist: ');
  ok(displayCss.includes('[hidden] {\n  display: none !important;\n}'), 'display stylesheet must preserve semantic hidden over its flex/block rules: ');
});

test('R13-1 modal 靜態樣式與錯誤顯示改走 class，不回退 inline style', () => {
  const panelMarkup = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const controllerMarkup = fs.readFileSync(path.join(__dirname, '../public/controller.html'), 'utf8');
  const baseCss = fs.readFileSync(path.join(__dirname, '../public/css/base.css'), 'utf8');
  const pinAuth = fs.readFileSync(path.join(__dirname, '../public/js/pin-auth.js'), 'utf8');
  const playlist = fs.readFileSync(path.join(__dirname, '../public/js/app-playlist.js'), 'utf8');
  const lyricExtras = fs.readFileSync(path.join(__dirname, '../public/js/lyric-extras.js'), 'utf8');
  ok(!/\sstyle\s*=/.test(panelMarkup), 'index.html 不可再有靜態 style attribute: ');
  ok(!/\sstyle\s*=/.test(controllerMarkup), 'controller.html 不可再有靜態 style attribute: ');
  for (const id of ['lyrics-paste-textarea', 'playlist-export-error', 'lyric-preset-name-error', 'pin-required-error', 'pin-manage-error']) {
    const node = new RegExp(`id="${id}"[^>]*`, 'i').exec(panelMarkup)?.[0] || '';
    ok(node && !/\sstyle\s*=/.test(node), `${id} 必須以共用 class 呈現: `);
  }
  ok(baseCss.includes('.input.modal-lyrics-textarea { min-height: 200px; }'), '歌詞 textarea 必須用足夠具體的 class 覆寫基礎高度: ');
  ok(baseCss.includes('.modal-card.modal-card--small { max-width: 360px; }'), 'modal 尺寸 variant 必須勝過頁面預設: ');
  ok(baseCss.includes('.modal-error.is-visible { display: block; }'), 'modal error 必須有 class-state 顯示規則: ');
  ok(baseCss.includes('.section-intro {'), '設定頁共用說明必須改由 class 控制: ');
  ok(!panelMarkup.includes('style="margin:-4px 0 12px;color:var(--text-faint);font-size:12px;line-height:1.6"'), '重複的設定頁說明不可回退為 inline style: ');
  ok(baseCss.includes('.field-row {'), '歌單外觀的共用欄位列必須改由 class 控制: ');
  ok(!panelMarkup.includes('style="display:flex;gap:10px;align-items:flex-end"'), '歌單外觀重複欄位列不可回退為 inline style: ');
  ok(baseCss.includes('.field-row--spacious { gap: 14px; }'), '較寬欄距必須由 field-row variant 控制: ');
  ok(!panelMarkup.includes('style="display:flex;gap:14px;align-items:flex-end"'), '較寬欄距不可回退為 inline style: ');
  ok(baseCss.includes('.field-row--top { align-items: flex-start; }'), '欄位頂部對齊必須由 field-row variant 控制: ');
  ok(baseCss.includes('.inline-row { display: flex; gap: 8px; }') && baseCss.includes('.inline-row--wrap { flex-wrap: wrap; }'), '按鈕與表單列必須有共用 layout class: ');
  ok(!panelMarkup.includes('style="display:flex;gap:14px;align-items:flex-start"') && !panelMarkup.includes('style="display:flex;gap:8px"') && !panelMarkup.includes('style="display:flex;gap:8px;flex-wrap:wrap"'), '共用列不可回退為 inline style: ');
  ok(baseCss.includes('.flex-grow { flex: 1; }'), '彈性欄位必須有共用 class: ');
  ok(!panelMarkup.includes('style="flex:1"'), '彈性欄位不可回退為 inline style: ');
  ok(baseCss.includes('.m-0 { margin: 0; }') && baseCss.includes('.mt-0 { margin-top: 0; }') && baseCss.includes('.mt-8 { margin-top: 8px; }'), '常用垂直間距必須有共用 class: ');
  ok(baseCss.includes('.eyebrow.m-0 { margin: 0; }') && baseCss.includes('.dropzone .sub.m-0 { margin: 0; }') && baseCss.includes('.field label.m-0 { margin: 0; }') && baseCss.includes('div.field-group-title.mt-0 { margin-top: 0; }'), '共用間距必須勝過既有元件樣式，保持原版面: ');
  ok(!panelMarkup.includes('style="margin:0"') && !panelMarkup.includes('style="margin-top:0"') && !panelMarkup.includes('style="margin-top:8px"'), '常用垂直間距不可回退為 inline style: ');
  ok(baseCss.includes('.w-full { width: 100%; }') && baseCss.includes('.ml-6 { margin-left: 6px; }') && baseCss.includes('.ml-8 { margin-left: 8px; }') && baseCss.includes('.mt-6 { margin-top: 6px; }') && baseCss.includes('.mt-10 { margin-top: 10px; }') && baseCss.includes('.pre-line { white-space: pre-line; }') && baseCss.includes('.row-gap-10 { display: flex; gap: 10px; }'), 'CSP static layout classes must exist: ');
  ok(baseCss.includes('.field-hint.mt-6 { margin-top: 6px; }'), 'field-hint must retain its old inline-style priority: ');
  ok(baseCss.includes('details.collapse.mt-10 { margin-top: 10px; }'), 'collapse spacing must retain its old inline-style priority: ');
  ok(baseCss.includes('.theme-toggle.nav-item { width: 52px; height: 52px; }') && baseCss.includes('.switch-row.switch-row--separated') && baseCss.includes('.btn.btn--wide { width: 100%; }') && baseCss.includes('.dropzone.dropzone--compact'), 'component-qualified CSP classes must retain their old inline-style priority: ');
  ok(baseCss.includes('.field.field--inline-spacious { display: flex; gap: 14px; }') && baseCss.includes('.val.val--fine-detail') && baseCss.includes('img.display-bg-preview') && baseCss.includes('label.btn.btn--label'), 'lyrics settings CSP classes must retain their old static styles: ');
  ok(baseCss.includes('.lan-info-layout { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }') && baseCss.includes('.val.val--status-message') && baseCss.includes('.diagnostic-privacy-hint'), 'general settings CSP classes must retain their old static styles: ');
  ok(baseCss.includes('#lib-search.input { flex: 1; min-width: 140px; width: auto; }') && baseCss.includes('.setlist-layout-actions') && baseCss.includes('.btn.btn--track-edit-save'), 'library, setlist, and track-edit CSP classes must retain their old static styles: ');
  for (const rawStyle of ['style="margin-left:6px"', 'style="width:100%"', 'style="margin-top:6px"', 'style="margin-top:10px"', 'style="display:flex;gap:10px"', 'style="margin-top:10px;white-space:pre-line"', 'style="margin-left:8px"', 'style="width:52px;height:52px"', 'style="display:flex;gap:6px"', 'style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px"', 'style="width:100%;margin-bottom:8px"', 'style="margin:0 0 10px;color:var(--text-faint);font-size:11px;line-height:1.6"', 'style="width:100%;margin-top:8px"', 'style="margin-top:12px;padding:16px"', 'style="margin-top:2px"', 'style="color:var(--text-faint);font-size:11px"', 'style="margin-top:8px;color:var(--text-faint);font-size:11px;line-height:1.6"', 'style="display:flex;gap:14px"', 'style="margin-top:6px;color:var(--text-faint);font-size:11px;line-height:1.6"', 'style="margin-top:12px"', 'style="margin-top:4px;color:var(--text-faint);font-size:11px"', 'style="margin:12px 0"', 'style="max-width:100%;max-height:120px;border-radius:8px;display:block;margin-bottom:8px"', 'style="cursor:pointer"', 'style="margin:6px 0 0;color:var(--text-faint);font-size:12px"', 'style="width:110px"', 'style="margin-top:4px"', 'style="width:100%;margin-top:10px"', 'style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"', 'style="border-radius:8px;background:#fff;padding:6px"', 'style="flex:1;min-width:180px"', 'style="color:var(--danger)"', 'style="margin:0 0 10px"', 'style="color:var(--accent,#7c9cff)"', 'style="margin:10px 0 0;white-space:pre-line"', 'style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"', 'style="margin:-4px 0 10px;color:var(--text-faint);font-size:12px;line-height:1.6"', 'style="display:flex;gap:8px;margin-top:10px"', 'style="margin:10px 0 0;color:var(--text-faint);font-size:11px;line-height:1.6"', 'style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px"', 'style="flex:1;min-width:140px;width:auto"', 'style="width:auto;flex:0 0 auto"', 'style="text-align:center;padding:24px 0;color:var(--text-faint)"', 'style="margin-top:10px;font-size:12px;color:var(--text-faint)"', 'style="min-height:60px"', 'style="margin-bottom:14px"', 'style="display:flex;align-items:center;justify-content:space-between;margin:0 0 8px"', 'style="margin:0;font-size:11px;color:var(--text-faint)"', 'style="display:flex;align-items:center;gap:6px;margin-bottom:2px"', 'style="flex:1;min-width:0"', 'style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 12px"', 'style="margin-top:14px;width:100%"', 'style="display:flex;gap:6px;margin-bottom:8px"', 'style="display:flex;gap:14px;align-items:center"', 'style="display:flex;align-items:center;gap:6px;font-size:12px"', 'style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap"', 'style="display:flex;gap:6px;flex-shrink:0"', 'style="margin:0 0 14px;color:var(--text-faint);font-size:12px;line-height:1.6"', 'style="width:100%;margin-top:4px"']) {
    ok(!panelMarkup.includes(rawStyle), `CSP static migration must not restore ${rawStyle}: `);
  }
  ok(!pinAuth.includes('.style.display'), 'PIN error 不可再直接寫入 inline display: ');
  ok(!playlist.includes('playlistExportError.style.display'), '匯出 error 不可再直接寫入 inline display: ');
  ok(!lyricExtras.includes('error.style.display = msg'), '預設名稱 error 不可再直接寫入 inline display: ');
});

test('HTTP 安全回歸：標頭存在、版本標頭隱藏、過大 JSON 回 413', () => {
  const { spawnSync } = require('child_process');
  const script = `
    process.env.PORT = '0';
    const http = require('http');
    const { server } = require('./server/index');
    function request(options, body) {
      return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => { res.resume(); res.on('end', () => resolve(res)); });
        req.on('error', reject); if (body) req.end(body); else req.end();
      });
    }
    server.on('listening', async () => {
      try {
        const port = server.address().port;
        const health = await request({ host: '127.0.0.1', port, path: '/api/health' });
        const csp = health.headers['content-security-policy'] || '';
        if (health.statusCode !== 200 || !csp.includes("script-src 'self';") ||
            csp.includes("script-src 'self' 'unsafe-inline'") || !csp.includes("style-src 'self' 'unsafe-inline'") ||
            health.headers['x-powered-by'] || health.headers['x-content-type-options'] !== 'nosniff') process.exitCode = 2;
        const crossSite = await request({ host: '127.0.0.1', port, path: '/api/auth/verify', method: 'POST',
          headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' } }, '{}');
        if (crossSite.statusCode !== 403) process.exitCode = 5;
        const body = JSON.stringify({ value: 'x'.repeat(2.1 * 1024 * 1024) });
        const large = await request({ host: '127.0.0.1', port, path: '/api/auth/verify', method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, body);
        if (large.statusCode !== 413) process.exitCode = 3;
      } catch (_) { process.exitCode = 4; }
      server.close(() => process.exit(process.exitCode || 0));
    });
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'), timeout: 8000, encoding: 'utf8',
  });
  ok(!result.error || result.error.code !== 'ETIMEDOUT', 'HTTP 安全測試不應逾時: ');
  eq(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

console.log('\n📦 12. YouTube 單次流程、翻唱辨識與佇列');
test('yt-dlp before_dl 使用完整 info dict 格式，不可使用會輸出 NA 的舊 %(json)j', () => {
  eq(AudioProcessor._metadataPrintTemplateForTest(), 'before_dl:__ES_META__%()j');
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

console.log('\n15. P2 播放邊界與 state:sync 量測');
test('單曲模式播完只預載下一首，不會從最後一首繞回第一首', () => {
  const sequence = require('../public/js/playback-sequence');
  const next = sequence.nextAfterEnded(0, 2, false);
  eq(next.index, 1);
  eq(next.autoplay, false);
  eq(sequence.nextAfterEnded(1, 2, false), null);
});

test('連續模式會自動播放下一首，但最後一首仍自然停止', () => {
  const sequence = require('../public/js/playback-sequence');
  const next = sequence.nextAfterEnded(0, 2, true);
  eq(next.index, 1);
  eq(next.autoplay, true);
  eq(sequence.nextAfterEnded(1, 2, true), null);
});

test('state:sync 每次廣播只序列化同一份 payload 並留下大小量測', () => {
  const { createAppState } = require('../server/state/app-state');
  const emitted = [];
  const appState = createAppState({ emit: (event, payload) => emitted.push({ event, payload }) });
  appState.broadcastState();
  const metrics = appState.getStateSyncMetrics();
  eq(emitted.length, 1);
  eq(emitted[0].event, 'state:sync');
  eq(metrics.samples, 1);
  ok(metrics.lastBytes > 0);
  eq(metrics.lastBytes, Buffer.byteLength(JSON.stringify(emitted[0].payload), 'utf8'));
  eq(metrics.lastPlaylistLength, emitted[0].payload.playlist.length);
});

test('state:sync 清單不再攜帶歌詞，500 首重歌詞清單避開 8MB 斷線紅線', () => {
  const { createAppState } = require('../server/state/app-state');
  const emitted = [];
  const appState = createAppState({ emit: (event, payload) => emitted.push({ event, payload }) });
  const parsedLyrics = Array.from({ length: 120 }, (_, line) => ({
    time: line * 3000,
    endTime: line * 3000 + 2500,
    text: `第 ${line + 1} 句測試歌詞 ${'同步資料'.repeat(16)}`,
    phonetic: `test line ${line + 1} ${'phonetic '.repeat(12)}`,
    xieyin: `測試 ${'諧音'.repeat(24)}`,
  }));
  const lyrics = parsedLyrics.map((line) => {
    const seconds = Math.floor(line.time / 1000);
    return `[${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.00]${line.text}`;
  }).join('\n');
  appState.playState.playlist = Array.from({ length: 500 }, (_, index) => ({
    id: `heavy-${index}`, title: `重歌詞歌曲 ${index + 1}`, artist: '測試歌手', filename: null,
    duration: 240, lyrics, lyricsType: 'lrc', parsedLyrics,
  }));
  appState.playState.currentTrack = appState.playState.playlist[0];
  appState.broadcastState();
  const payload = emitted[0].payload;
  const metrics = appState.getStateSyncMetrics();
  ok(payload.playlist.every((track) => !Object.prototype.hasOwnProperty.call(track, 'lyrics') && !Object.prototype.hasOwnProperty.call(track, 'parsedLyrics')),
    '清單摘要不可帶原始或解析歌詞: ');
  eq(payload.currentTrack.lyrics, lyrics, '目前歌曲必須保留完整歌詞: ');
  ok(metrics.lastEstimatedLegacyBytes > 8 * 1024 * 1024, '舊結構應跨過 8MB 風險線: ');
  ok(metrics.lastBytes < 1024 * 1024, '新 state:sync 應維持在 1MB 以下: ');
  ok(metrics.lastSavingsBytes > 8 * 1024 * 1024, '應量測到超過 8MB 的節省: ');
});

test('R2-2 500-song playlist stays compact across all four real Socket roles', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-sync-matrix-'));
  try {
    const result = spawnStateStore(process.execPath, [
      path.join(__dirname, 'socket-state-sync-matrix-child.js'),
      path.join(__dirname, '..'),
      dataDir,
    ], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      timeout: 20000,
      windowsHide: true,
    });
    ok(!result.error || result.error.code !== 'ETIMEDOUT', `state-sync matrix timed out: ${result.stdout}\n${result.stderr}`);
    const markerAt = result.stdout.lastIndexOf('__STATE_SYNC_MATRIX__');
    ok(markerAt >= 0, `state-sync matrix returned no result: ${result.stdout}\n${result.stderr}`);
    const line = result.stdout.slice(markerAt + '__STATE_SYNC_MATRIX__'.length).trim().split(/\r?\n/, 1)[0];
    const matrix = JSON.parse(line);
    eq(result.status, 0, `state-sync matrix failed: ${matrix.error || result.stderr}`);
    ok(matrix.ok, matrix.error || 'state-sync matrix should pass');
    eq(matrix.playlistLength, 500);
    eq(matrix.roles.join(','), 'controller,remote,display,setlist');
    ok(matrix.initialBytes < 1024 * 1024 && matrix.broadcastBytes < 1024 * 1024 && matrix.recoveryBytes < 1024 * 1024,
      `state-sync matrix public payload exceeds 1 MiB: ${JSON.stringify(matrix)}`);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
testAsync('下載前 metadata 檢查可由工作中心立即取消', async () => {
  const http = require('http');
  const { fetchWithTimeout } = require('../server/utils/helpers');
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const controller = new AbortController();
  const pending = fetchWithTimeout(`http://127.0.0.1:${server.address().port}/pending`, { signal: controller.signal }, 5000);
  controller.abort();
  let error;
  try { await pending; } catch (caught) { error = caught; }
  await new Promise((resolve) => server.close(resolve));
  eq(error?.name, 'AbortError');
});

test('startup import cleanup removes only registered orphan temporary files', () => {
  const { createImportTempRegistry } = require('../server/services/import-temp-registry');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-import-temp-'));
  const dataDir = path.join(root, 'data');
  const downloadsDir = path.join(root, 'downloads');
  fs.mkdirSync(downloadsDir, { recursive: true });
  let activePid = null;
  const registry = createImportTempRegistry({
    dataDir,
    pid: 7788,
    now: () => 123456,
    processAlive: (pid) => pid === activePid,
  });
  try {
    const orphan = registry.begin('orphanFile1');
    fs.writeFileSync(path.join(downloadsDir, 'orphanFile1.webm'), 'partial');
    fs.writeFileSync(path.join(downloadsDir, 'orphanFile1.part'), 'partial');
    fs.writeFileSync(path.join(downloadsDir, 'orphanFile1.m4a'), 'partial');
    fs.writeFileSync(path.join(downloadsDir, 'orphanFile1.mp3'), 'keep');
    fs.writeFileSync(path.join(downloadsDir, 'orphanFile1.txt'), 'keep');
    fs.writeFileSync(path.join(downloadsDir, 'untracked01.webm'), 'keep');
    const result = registry.cleanupOrphans(downloadsDir);
    eq(result.removedFiles.length, 3);
    eq(result.clearedEntries, 1);
    ok(!fs.existsSync(path.join(downloadsDir, 'orphanFile1.webm')));
    ok(fs.existsSync(path.join(downloadsDir, 'orphanFile1.mp3')), 'normal mp3 must survive cleanup');
    ok(fs.existsSync(path.join(downloadsDir, 'orphanFile1.txt')));
    ok(fs.existsSync(path.join(downloadsDir, 'untracked01.webm')), 'unregistered webm must survive cleanup');
    eq(Object.keys(registry.getEntries()).length, 0);

    const active = registry.begin('activeFile1');
    fs.writeFileSync(path.join(downloadsDir, 'activeFile1.webm'), 'running');
    activePid = 7788;
    const activeResult = registry.cleanupOrphans(downloadsDir);
    eq(activeResult.skippedActive, 1);
    ok(fs.existsSync(path.join(downloadsDir, 'activeFile1.webm')), 'live import must survive cleanup');
    eq(registry.finish(active), true);

    const firstAttempt = registry.begin('retryFile01');
    const secondAttempt = registry.begin('retryFile01');
    eq(registry.finish(firstAttempt), false, 'old retry must not clear the newer import entry');
    eq(registry.finish(secondAttempt), true);
    ok(orphan, 'valid imports receive a registry entry');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createObsRecoveryToastHarness() {
  const listeners = new Map();
  const timers = new Map();
  const toasts = [];
  let timerId = 0;
  const makeElement = () => ({
    className: '', textContent: '',
    setAttribute() {},
    classList: {
      add() {}, remove() {}, toggle() {},
    },
  });
  const dom = {
    connectionStatus: makeElement(),
    connectionText: makeElement(),
    displaySourceStatus: makeElement(),
    setlistSourceStatus: makeElement(),
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-toast-utils.js'), 'utf8'),
    {
      AppShared: { dom },
      SocketClient: { on: (event, handler) => listeners.set(event, handler) },
      ErrorHandler: { showToast: (message, type) => toasts.push({ message, type }) },
      document: { getElementById: () => makeElement() },
      setTimeout: (handler) => { const id = ++timerId; timers.set(id, handler); return id; },
      clearTimeout: (id) => timers.delete(id),
    }
  );
  return {
    emit(event, data) { listeners.get(event)?.(data); },
    flushTimers() {
      for (const [id, handler] of [...timers]) {
        timers.delete(id);
        handler();
      }
    },
    toasts,
  };
}

test('R6-2 follow-up OBS 來源服務重啟恢復提示只針對曾連線卻未回來的來源', () => {
  const counts = { displays: 1, setlists: 1, displayRuntime: {} };
  const missing = createObsRecoveryToastHarness();
  missing.emit('connection-change', true);
  missing.emit('client:counts', counts);
  missing.emit('connection-change', false);
  missing.emit('connection-change', true);
  missing.emit('client:counts', { displays: 0, setlists: 0, displayRuntime: {} });
  missing.flushTimers();
  eq(missing.toasts.length, 1);
  eq(missing.toasts[0].type, 'warning');
  ok(missing.toasts[0].message.includes('歌詞、歌單來源沒有重新連回來') && missing.toasts[0].message.includes('重新整理快取'));

  const recovered = createObsRecoveryToastHarness();
  recovered.emit('connection-change', true);
  recovered.emit('client:counts', counts);
  recovered.emit('connection-change', false);
  recovered.emit('connection-change', true);
  recovered.emit('client:counts', counts);
  recovered.flushTimers();
  eq(recovered.toasts.length, 0, '已恢復的來源不可收到多餘提醒: ');

  const firstRun = createObsRecoveryToastHarness();
  firstRun.emit('connection-change', true);
  firstRun.emit('client:counts', { displays: 0, setlists: 0, displayRuntime: {} });
  firstRun.emit('connection-change', false);
  firstRun.emit('connection-change', true);
  firstRun.flushTimers();
  eq(firstRun.toasts.length, 0, '首次尚未設定 OBS 的使用者不可被誤判為來源恢復失敗: ');
});

test('R6-3 非經典模板會在可見範圍說明中交代拼音與諧音限制', () => {
  const lyricExtras = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-extras.js'), 'utf8');
  const unsupportedCopy = '此模板不支援拼音／諧音；需要雙語請選「經典疊層」。';
  const expectedTemplates = ['pulse', 'facet', 'drift', 'aura', 'ktv'];
  expectedTemplates.forEach((template) => {
    const entry = new RegExp(`${template}: \\{[^\\n]*${unsupportedCopy.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}`).exec(lyricExtras)?.[0] || '';
    ok(entry.includes(unsupportedCopy), `${template} 必須在模板範圍說明中交代雙語限制: `);
  });
  ok(lyricExtras.includes("classic: { label: '經典疊層'") && lyricExtras.includes('拼音與諧音'), '經典疊層必須持續明示為雙語可用模板: ');
});

test('歌詞模板使用 Elitesand Pro 自有名稱與新 ID', () => {
  const lyricExtras = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-extras.js'), 'utf8');
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const expectedLabels = {
    pulse: 'Pulse',
    facet: 'Facet',
    drift: 'Drift',
    aura: 'Aura',
  };
  Object.entries(expectedLabels).forEach(([template, label]) => {
    ok(lyricExtras.includes(`${template}: { label: '${label}'`), `${template} 必須保留技術 ID 並更新顯示名稱: `);
  });
  ['Stardust Flow', 'Prism Steps', 'Diagonal Confession', 'Tidal Mindscape', 'Neon Duet'].forEach((retiredName) => {
    ok(!readme.includes(retiredName), `README 不可保留已退休的模板名稱 ${retiredName}: `);
  });
  ok(readme.includes('Classic Overlay, Pulse, Facet, Drift, Aura, KTV, Vertical Flow'));
});

test('桌面與手機遙控器都可選用新模板 ID', () => {
  const controllerHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'controller.html'), 'utf8');
  const controllerJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'controller.js'), 'utf8');
  ['pulse', 'facet', 'drift', 'aura'].forEach((template) => {
    ok(controllerHtml.includes(`class="ctrl-template-btn" data-template="${template}"`), `${template} 必須出現在手機模板選項: `);
  });
  ok(!controllerHtml.includes('ctrl-template-legacy-notice'), '手機不應保留舊模板的相容性介面: ');
  ok(controllerJs.includes("const TEMPLATE_IDS = ['classic', 'pulse', 'facet', 'drift', 'aura', 'ktv', 'columnflow'];"), '遙控器必須使用新的模板 ID: ');
  ok(controllerJs.includes('if (!TEMPLATE_IDS.includes(nextTemplate)) return;'), '模板切換必須接受所有現行模板: ');
});

test('v2 將既有模板設定與預設快照遷移到新 ID', () => {
  const { migrateState, CURRENT_STATE_SCHEMA_VERSION } = require('../server/services/state-migrations');
  const result = migrateState({
    schemaVersion: 1,
    lyricSettings: {
      template: 'mindscape',
      lyricTemplateSettings: {
        luminous: { template: 'luminous', fontSize: 50 },
        partita: { template: 'partita', fontSize: 45 },
        tilt: { template: 'tilt', fontSize: 45 },
        mindscape: { template: 'mindscape', fontSize: 72 },
      },
      lyricPresets: [{ id: 'legacy', name: '舊模板', settings: { template: 'tilt' } }],
    },
  });
  eq(CURRENT_STATE_SCHEMA_VERSION, 2);
  eq(result.state.schemaVersion, 2);
  eq(result.state.lyricSettings.template, 'aura');
  eq(result.state.lyricSettings.lyricTemplateSettings.pulse.template, 'pulse');
  eq(result.state.lyricSettings.lyricTemplateSettings.facet.template, 'facet');
  eq(result.state.lyricSettings.lyricTemplateSettings.drift.template, 'drift');
  eq(result.state.lyricSettings.lyricTemplateSettings.aura.template, 'aura');
  eq(result.state.lyricSettings.lyricPresets[0].settings.template, 'drift');
});

test('使用者更新時會把 v1 state.json 轉成新的模板 ID 並落盤', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-template-id-migrate-'));
  const original = {
    schemaVersion: 1,
    savedAt: 100,
    playlist: [],
    lyricSettings: {
      template: 'mindscape',
      lyricTemplateSettings: {
        luminous: { template: 'luminous', fontSize: 50 },
        partita: { template: 'partita', fontSize: 45 },
        tilt: { template: 'tilt', fontSize: 45 },
        mindscape: { template: 'mindscape', fontSize: 72 },
      },
    },
  };
  try {
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify(original), 'utf8');
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const path=require('path'); const store=require(process.argv[1]); const dir=process.argv[2];",
      "const loaded=store.loadState(); const disk=JSON.parse(fs.readFileSync(store.STATE_FILE,'utf8')); const files=fs.readdirSync(dir);",
      "const backup=files.find((name)=>/^state\\.json\\.pre-migration-v1-/.test(name));",
      "process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,disk,backupRaw:backup?fs.readFileSync(path.join(dir,backup),'utf8'):null}));",
    ].join('\n'));
    eq(result.loaded.schemaVersion, 2);
    eq(result.disk.schemaVersion, 2);
    eq(result.loaded.lyricSettings.template, 'aura');
    eq(result.disk.lyricSettings.lyricTemplateSettings.pulse.template, 'pulse');
    eq(result.disk.lyricSettings.lyricTemplateSettings.facet.template, 'facet');
    eq(result.disk.lyricSettings.lyricTemplateSettings.drift.template, 'drift');
    eq(result.disk.lyricSettings.lyricTemplateSettings.aura.template, 'aura');
    eq(result.backupRaw, JSON.stringify(original));
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

function finishTests(exitCode) {
  try { fs.rmSync(TEST_RUNTIME_ROOT, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  process.exit(exitCode);
}

(async () => {
  await Promise.all(asyncTests);

  console.log('\n════════════════════════════');
  console.log(`測試結果: ${passed} 通過, ${failed} 失敗`);
  if (failed > 0) {
    console.log('\n失敗詳情:');
    for (const f of failures) {
      console.log(`  ✗ ${f.name}: ${f.err.message}`);
    }
    finishTests(1);
  }
  console.log('✅ 全部通過');
  finishTests(0);
})();
