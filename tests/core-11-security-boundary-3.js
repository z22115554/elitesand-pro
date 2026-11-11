'use strict';

// 核心回歸測試（security-boundary-3）。由 tests/run-tests.js 依序載入，不要單獨執行。
const {
  fs,
  readApiRoutesSource,
  path,
  os,
  vm,
  failed,
  test,
  testAsync,
  eq,
  ok,
} = require('./core-harness');
const xieyin = require('../server/services/xieyin');
const socketHandler = require('../server/routes/socket-handler');
const { spawnSync: spawnStateStore } = require('child_process');
const { createJsonStore } = require('../server/services/json-store');
const AudioProcessor = require('../server/services/audio-processor');

test('首頁 Live Bar 逐字對時：對時點掛在每個字底下，只有帶時間戳的字有點，照實反映逐字顆粒度', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const playback = fs.readFileSync(path.join(__dirname, '../public/js/app-playback.js'), 'utf8');
  const panelCss = fs.readFileSync(path.join(__dirname, '../public/css/panel.css'), 'utf8');
  const shared = fs.readFileSync(path.join(__dirname, '../public/js/app-shared.js'), 'utf8');
  // 舊的「另一列點」寫法要整個換掉：點不再獨立成列，而是每字一格、點在字底下
  ok(!indexHtml.includes('id="lyric-word-dots"'), '不可再有獨立的 #lyric-word-dots 點列（字點分離看不出對應）：');
  ok(!panelCss.includes('.lb-word-dot'), '舊的 .lb-word-dot 樣式必須移除：');
  ok(!shared.includes('lyricWordDots'), 'app-shared 不應再保留 lyricWordDots DOM 參照：');
  ok(playback.includes('function renderNowLineWithMarks') && playback.includes('function buildCharAnchors'),
    '目前句必須以「一字一格＋字元對詞錨點」重繪：');
  ok(playback.includes("t.className = 'lb-ch-t'") && playback.includes("d.className = 'lb-ch-d'"),
    '每個字要有文字格 .lb-ch-t 與對時點格 .lb-ch-d：');
  ok(/anchors\[p\] === -1\) anchors\[p\] = wi/.test(playback),
    '只有 word 的起點字才設錨點（其餘字底下留空位對齊）：');
  ok(playback.includes("d.classList.add('is-anchor')") && playback.includes("closest?.('.lb-ch-d.is-anchor')"),
    '只有帶時間戳的字（.is-anchor）可點擊 seek：');
  ok(playback.includes("(tr && tr.lyricsType === 'krc' && Array.isArray(line.words))")
    && playback.includes('if (!words.length || !text)') && playback.includes("host.textContent = prefix + text"),
    '沒有逐字資料時退成純文字、不畫任何點：');
  ok(panelCss.includes('.lb-line-now.has-word-marks') && panelCss.includes('.lb-ch-d.is-active'),
    'CSS 要有一字一格容器與 播放中/已唱 點狀態：');
});

test('直播準備區波形：峰值計算正確、路由掛 requirePin、走共用 ffmpeg 佇列', () => {
  const root = path.join(__dirname, '..');
  const { createPeakAccumulator, cachePathFor } = require('../server/services/waveform-peaks');
  // 每 4 個樣本取一個峰值；刻意把一個 16-bit 樣本切在兩個 chunk 之間
  const acc = createPeakAccumulator(4);
  const samples = [100, -300, 50, 20, -1000, 10, 0, 5, 7];
  const buf = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => buf.writeInt16LE(v, i * 2));
  acc.push(buf.subarray(0, 5));
  acc.push(buf.subarray(5));
  eq(JSON.stringify(acc.finish()), JSON.stringify([77, 255, 2]), '峰值要取絕對值最大並以整首最大值正規化到 0–255：');
  ok(cachePathFor('C:/cache', 'D:/a/song.mp3') !== cachePathFor('C:/cache', 'D:/a/other.mp3'), '不同音檔要有不同快取檔：');
  const api = readApiRoutesSource();
  ok(/router\.get\('\/library\/:id\/waveform', requirePin,/.test(api), '波形路由會跑 ffmpeg，必須掛 requirePin（鐵則 15）：');
  ok(api.includes('AudioProcessor.runFfmpegQueued(job)'), '波形解碼要排進共用 ffmpeg 佇列（鐵則 12）：');
  const livePrep = fs.readFileSync(path.join(root, 'public/js/live-prep.js'), 'utf8');
  ok(livePrep.includes('PinAuth.fetchWithPin(`/api/library/'), '面板取波形要用 PinAuth.fetchWithPin（鐵則 16）：');
});

test('首頁「AI 伴奏」分頁：只讀 state＋走既有分離路由，不新增 socket/broadcast', () => {
  const root = path.join(__dirname, '..');
  const indexHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const mod = fs.readFileSync(path.join(root, 'public/js/home-ai-separation-panel.js'), 'utf8');
  const prepTabs = fs.readFileSync(path.join(root, 'public/js/home-prep-tabs.js'), 'utf8');
  // 2026-09-26 改版：首頁分頁改成直播工作台，AI 伴奏變成右欄的收合區塊（仍是 data-prep-panel="ai"），
  // 新手導覽的 HomePrepTabs.show('ai') 改由 live-prep.js 展開該區塊。
  const livePrep = fs.readFileSync(path.join(root, 'public/js/live-prep.js'), 'utf8');
  ok(/<details class="live-side-section" data-prep-panel="ai">/.test(indexHtml),
    '直播頁右欄要有 AI 伴奏收合區塊：');
  ok(livePrep.includes('window.HomePrepTabs = {') && livePrep.includes('details.open = true'),
    'HomePrepTabs.show 要能展開直播頁右欄的收合區塊：');
  ok(indexHtml.includes('id="home-ai-track-list"') && indexHtml.includes('id="home-ai-make-all"'),
    'AI 伴奏分頁要有清單容器與「全部排進佇列」：');
  ok(!indexHtml.includes('id="home-ai-open-audio"') && !indexHtml.includes('id="separation-mode-toggle"')
    && !mod.includes('home-ai-open-audio') && !mod.includes('separation-mode-toggle'),
    '已分離歌曲改成自動雙軌後，不可再保留「分離播放模式」入口或開關：');
  ok(indexHtml.includes('id="separation-vocals-volume"') && indexHtml.includes('value="20"')
    && indexHtml.includes('id="separation-vocals-volume-val"') && indexHtml.includes('>20%</span>'),
    '播放區必須保留可調整的人聲音量，且新使用者靜態預設要顯示 20%：');
  ok(indexHtml.includes('/js/home-ai-separation-panel.js'), 'index.html 必須載入 AI 伴奏分頁腳本：');
  ok(mod.includes('AppShared.state') && mod.includes('window.AiSeparation.subscribe'),
    'AI 伴奏分頁只讀 state.playlist、訂閱既有 AiSeparation：');
  ok(mod.includes('/api/library/') && mod.includes('/separate`') && mod.includes("method: 'POST'"),
    '觸發分離走既有 /api/library/:id/separate：');
  ok(mod.includes('window.AiSeparation.ensureReady') && mod.includes('window.AiSeparation.cancel'),
    '安裝流程與取消都走既有 AiSeparation（含 PinAuth）：');
  ok(!/broadcastState\s*\(|SocketClient\.send\s*\(|new WebSocket\s*\(/.test(mod),
    'AI 伴奏分頁不得自己發 socket 或呼叫 broadcastState：');
  ok(prepTabs.includes("if (!root) return;"), '舊分頁腳本在沒有 .kara-prep 時必須安靜退出，不可覆蓋 live-prep.js 的 HomePrepTabs：');
});

test('新手教學：分頁化目標會先切分頁；雙路音訊／Spout／AI 伴奏有說明章節', () => {
  const root = path.join(__dirname, '..');
  const tour = fs.readFileSync(path.join(root, 'public/js/onboarding-tour.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  ok(/const TOUR_VERSION = 6;/.test(tour), '2026-10 面板改版後導覽版本要 bump（讓既有使用者重看新版）：');
  ok(tour.includes('const ADVANCED_TOUR_VERSION = 7;'),
    '進階導覽章節重整後版本要 bump，讓看過舊版的使用者能收到新說明：');
  ok(/id: 'live-dual-audio',[\s\S]{0,180}view: 'general',[\s\S]{0,180}target: '#dual-audio-refresh-devices'/.test(tour)
    && !/id: 'live-dual-audio',[\s\S]{0,220}prepTab: 'audio'/.test(tour),
    '進階導覽的雙路音訊步驟要直接指向設定裡真實的雙路音訊卡：');
  // 2026-10 改版：加歌框常駐在直播頁左欄，不再需要 prepTab: 'add'；對時與場次仍標 prepTab
  ok(tour.includes("prepTab: 'sync'") && tour.includes("prepTab: 'session'"),
    '被移進準備分頁的導覽步驟要標 prepTab：');
  ok(tour.includes('root.HomePrepTabs.show(step.prepTab)'),
    'renderStep 聚光前要先把該步驟的準備分頁切出來（不然目標在收合分頁裡是 hidden）：');
  ['help-ai-instrumental', 'help-dual-audio', 'help-spout'].forEach((id) => ok(indexHtml.includes(`id="${id}"`),
    `新手教學要有 #${id} 說明章節：`));
  ok(indexHtml.includes('id="dual-audio-stream-device"') && indexHtml.includes('id="dual-audio-headphone-device"')
    && indexHtml.includes('id="dual-audio-mode-toggle"'),
    '雙路音訊章節應保留內建雙裝置路由，而不是舊的外部播放器／OBS 僅監聽繞法：');
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

test('網卡列舉拋錯時仍可載入 Origin 防線，LAN 資訊安全降級為 null', () => {
  const script = [
    "const os=require('os');",
    "os.networkInterfaces=()=>{throw Object.assign(new Error('fixture failure'),{code:'ERR_SYSTEM_ERROR'});};",
    "const origin=require(process.argv[1]);",
    "const lan=require(process.argv[2]);",
    "process.stdout.write(JSON.stringify({loopback:origin.isTrustedHostname('127.0.0.1'),lan:lan.getLanIp()}));",
  ].join('');
  const result = require('child_process').spawnSync(process.execPath, [
    '-e', script,
    path.join(__dirname, '../server/utils/socket-origin.js'),
    path.join(__dirname, '../server/utils/lan-info.js'),
  ], { encoding: 'utf8' });
  eq(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  eq(payload.loopback, true);
  eq(payload.lan, null);
});

test('PIN 保存失敗時維持舊的記憶體憑證，不接受未落盤的新 PIN', () => {
  const script = [
    "const crypto=require('crypto');const Module=require('module');",
    "const salt='00112233445566778899aabbccddeeff';",
    "const old={salt,hash:crypto.scryptSync('old-pin',Buffer.from(salt,'hex'),32).toString('hex')};",
    "const original=Module._load;Module._load=function(req,parent,isMain){",
    "if(req==='./json-store'&&parent?.filename?.endsWith('auth-store.js'))return{createJsonStore:()=>({load:()=>old,save:()=>false,remove:()=>true})};",
    "return original.apply(this,arguments);};",
    "const auth=require(process.argv[1]);const result=auth.setPin('new-pin','old-pin');",
    "process.stdout.write(JSON.stringify({result,old:auth.verifyPin('old-pin'),newPin:auth.verifyPin('new-pin')}));",
  ].join('');
  const result = require('child_process').spawnSync(process.execPath, [
    '-e', script, path.join(__dirname, '../server/services/auth-store.js'),
  ], { encoding: 'utf8' });
  eq(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  eq(payload.result.ok, false);
  eq(payload.old, true);
  eq(payload.newPin, false);
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
  eq(trackSchema.MAX_PLAYLIST_SIZE, 2000, '大型歌單安全上限應為 2000: ');
  const many = Array.from({ length: trackSchema.MAX_PLAYLIST_SIZE + 50 }, (_, i) => ({ id: String(i), title: `song-${i}` }));
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

test('大型媒體庫摘要不傳歌詞／原始來源，但保留 AI 分離試聽狀態', () => {
  const libraryStore = require('../server/services/library-store');
  eq(libraryStore.MAX_ENTRIES, 10000, '媒體庫高安全上限應為 10000: ');
  const summary = libraryStore.toLibrarySummary({
    id: 'summary-track', title: '摘要歌曲', artist: '歌手', cover: 'https://example.test/cover.jpg',
    duration: 245, playCount: 7, lastPlayed: 123,
    filename: 'original.mp3', url: 'https://example.test/watch/1',
    lyrics: '不應傳送'.repeat(1000), parsedLyrics: [{ time: 0, text: '不應傳送' }],
    vocalsFile: 'track.vocals.wav', instrumentalFile: 'track.instrumental.wav', separationStatus: 'done',
    sections: [{ start: 0, end: 10, label: 'intro' }], sectionsStatus: 'done',
  });
  eq(summary.id, 'summary-track');
  eq(summary.vocalsFile, 'track.vocals.wav');
  eq(summary.instrumentalFile, 'track.instrumental.wav');
  eq(summary.separationStatus, 'done');
  eq(summary.sectionsStatus, 'done', '媒體庫摘要要能顯示段落分析狀態（給按鈕/徽章用）: ');
  eq(summary.hasLyrics, true, '歌曲庫要能篩出缺歌詞的歌：摘要帶 hasLyrics: ');
  eq(summary.lyricsType, 'lrc', '摘要帶歌詞類型（逐字／逐句）: ');
  ok(!('lyrics' in summary) && !('parsedLyrics' in summary), '摘要仍不可帶歌詞內容: ');
  eq(libraryStore.toLibrarySummary({ id: 'no-lyrics', title: 'x', lyrics: '  ' }).hasLyrics, false, '空白歌詞視為沒有歌詞: ');
  ok(!Object.prototype.hasOwnProperty.call(summary, 'sections'), '摘要不傳完整段落陣列，只傳狀態，避免 1 萬首媒體庫爆量: ');
  ok(!Object.prototype.hasOwnProperty.call(summary, 'lyrics'));
  ok(!Object.prototype.hasOwnProperty.call(summary, 'parsedLyrics'));
  ok(!Object.prototype.hasOwnProperty.call(summary, 'filename'));
  ok(!Object.prototype.hasOwnProperty.call(summary, 'url'));
});

test('sanitizeTrack：段落分析結果 label 統一轉底線小寫，時間非法的段落整筆丟棄', () => {
  const { sanitizeTrack } = require('../server/utils/track-schema');
  const track = sanitizeTrack({
    id: 't1', title: '測試曲',
    sections: [
      { start: 0, end: 10, label: 'Intro' },
      { start: 10, end: 25.5, label: 'pre-chorus' },
      { start: 25.5, end: 25.5, label: 'chorus' }, // end == start，非法
      { start: 40, end: 30, label: 'bridge' }, // end < start，非法
      { start: 60, end: 80 }, // 沒有 label，非法
    ],
    sectionsStatus: 'done',
  });
  eq(track.sections.length, 2, '只有兩筆合法段落應該留下: ');
  eq(track.sections[0].label, 'intro', 'label 應轉小寫: ');
  eq(track.sections[1].label, 'pre_chorus', '連字號應轉底線，才對得上段落搭配頁的鍵值: ');
  eq(track.sectionsStatus, 'done');

  const untouched = sanitizeTrack({ id: 't2', title: '未分析' });
  eq(untouched.sections, null, '沒有 sections 欄位時應該是 null，不是空陣列（區分「沒分析過」跟「分析出零段」）: ');
  eq(untouched.sectionsStatus, 'none');
});

test('library-store：play/import 重建 track 時保留既有段落分析結果，不會被沒帶欄位的 payload 洗掉', () => {
  const libraryStore = require('../server/services/library-store');
  const id = 'section-keep-' + Date.now();
  libraryStore.rememberImport({
    id, title: '段落測試曲', filename: `${id}.mp3`,
    sections: [{ start: 0, end: 5, label: 'intro' }], sectionsStatus: 'done',
  });
  // 面板送來的 play:track payload 通常不帶這兩個欄位，recordPlay() 不可把它們重置成未分析。
  libraryStore.recordPlay({ id, title: '段落測試曲', filename: `${id}.mp3` });
  const entry = libraryStore.getEntry(id);
  eq(entry.sectionsStatus, 'done', '播放一次不應該把已分析的段落重置成未分析: ');
  eq(entry.sections.length, 1);
});

// 2026-09-22 使用者實測回報：段落分析按鈕永遠顯示「尚未載入歌曲」、點了沒反應。
// 根因是 section-analysis-client.js 讀的是 window.AppShared.getCurrentTrack()，但目前
// 歌曲其實只掛在 window.VKState（app.js 對外暴露當前歌曲用的舊代號全域，見該檔第 69 行
// `window.VKState = { getCurrentTrack: ... }`）——AppShared 上根本沒有這個方法，永遠讀到
// undefined。這個測試釘住正確的全域來源，不讓同一種錯誤悄悄回來。
test('section-analysis-client.js 讀目前歌曲要用 window.VKState，不是 window.AppShared（後者沒有這個方法）', () => {
  const client = fs.readFileSync(path.join(__dirname, '../public/js/section-analysis-client.js'), 'utf8');
  ok(client.includes('window.VKState') && client.includes('window.VKState.getCurrentTrack'),
    '必須讀 window.VKState.getCurrentTrack()：');
  ok(!client.includes('window.AppShared.getCurrentTrack') && !client.includes('AppShared.getCurrentTrack'),
    'AppShared 上沒有 getCurrentTrack，不可再誤用這個來源：');
  const appJs = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  ok(appJs.includes('window.VKState') && appJs.includes('getCurrentTrack:'),
    '基本假設檢查：目前歌曲真的是掛在 window.VKState 上（如果這行未來被搬走，上面兩個斷言要跟著改）：');
});

// 2026-09-22：`fs.rm*` 的同步 API 在含中文字元的路徑上，只要真的執行到刪除動作就會讓
// 整個 Node process 無聲當掉（exit 127、無 stderr、無 stack、try/catch 攔不到）。
// 這個測試刻意「真的刪」一棵中文路徑下的目錄樹：萬一 safeRemove 被改回 fs.rm*，
// 測試行程會直接死在這裡，不會靜默通過。
test('safeRemove 能在中文路徑上遞迴刪除，且不使用會讓行程無聲當掉的 fs.rm* 同步 API', () => {
  const { safeRemove } = require('../server/utils/safe-remove');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), '中文測試目錄-'));
  const target = path.join(base, 'python.download');
  fs.mkdirSync(path.join(target, 'Lib', 'site-packages'), { recursive: true });
  fs.writeFileSync(path.join(target, 'python.exe'), 'x');
  fs.writeFileSync(path.join(target, 'Lib', 'site-packages', 'a.py'), 'y');

  eq(safeRemove(target), true, '中文路徑下的巢狀目錄要能整棵刪掉：');
  eq(fs.existsSync(target), false, '刪完之後目標不該還在：');
  eq(safeRemove(path.join(base, 'never-existed')), true, '目標本來就不存在要視為成功、不可丟例外：');
  safeRemove(base);
});

test('生產程式碼不可使用在中文路徑上會讓行程無聲當掉的 fs.rm* 同步 API', () => {
  const roots = ['../server', '../electron'];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      if (full.replace(/\\/g, '/').endsWith('server/utils/safe-remove.js')) continue; // 註解裡會提到這些 API
      const src = fs.readFileSync(full, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (/\brmSync\b/.test(line) || /\brmdirSync\s*\([^)]*recursive/.test(line)) {
          offenders.push(`${path.relative(path.join(__dirname, '..'), full)}:${i + 1}`);
        }
      });
    }
  };
  roots.forEach((r) => walk(path.join(__dirname, r)));
  eq(offenders.length, 0,
    `這些位置要改用 server/utils/safe-remove.js 的 safeRemove()（fs.rmSync／fs.rmdirSync(recursive) 在中文路徑上會殺掉整個伺服器）：${offenders.join(', ')} `);
});

test('歌曲庫摘要：歌詞還在分檔（未讀進記憶體）時仍判定為有歌詞', () => {
  // 2026-09-28 實機回報：直播頁明明是逐字歌詞，歌曲庫卻標「無歌詞」——摘要只看記憶體欄位，
  // 重開後沒被讀進來的歌全被當成沒歌詞。用兩個子程序模擬「存檔 → 重開」。
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-library-lyrics-summary-'));
  try {
    const libraryStorePath = path.join(__dirname, '..', 'server', 'services', 'library-store.js');
    const run = (script) => spawnStateStore(process.execPath, ['-e', script, libraryStorePath], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir }, encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    const write = run([
      "const library=require(process.argv[1]);",
      "library.rememberImport({id:'with-krc',title:'A',filename:'a.mp3',lyrics:'[00:01.00]x',lyricsType:'krc'});",
      "library.rememberImport({id:'no-lyrics',title:'B',filename:'b.mp3'});",
      "if(!library.saveNow()) throw new Error('save failed');",
    ].join('\n'));
    eq(write.status, 0, `write child stderr=${write.stderr}: `);
    const read = run([
      "const library=require(process.argv[1]);",
      "const s=Object.fromEntries(library.getLibrarySummary().map(e=>[e.id,{has:e.hasLyrics,type:e.lyricsType}]));",
      "process.stdout.write('__SUMMARY__'+JSON.stringify(s)+'\\n');",
    ].join('\n'));
    eq(read.status, 0, `read child stderr=${read.stderr}: `);
    const at = read.stdout.lastIndexOf('__SUMMARY__');
    const summary = JSON.parse(read.stdout.slice(at + '__SUMMARY__'.length).trim().split(/\r?\n/, 1)[0]);
    eq(summary['with-krc'].has, true, '重開後歌詞仍在分檔的歌要判定為有歌詞: ');
    eq(summary['with-krc'].type, 'krc', '歌詞類型要保留: ');
    eq(summary['no-lyrics'].has, false, '真的沒歌詞的仍是沒有: ');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('換歌詞（lyrics:manual）會立刻寫回歌曲庫並通知歌曲庫頁', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'handlers', 'lyrics.js'), 'utf8');
  const i = src.indexOf("socket.on('lyrics:manual'");
  const body = src.slice(i, src.indexOf("socket.on('xieyin:override'", i));
  ok(/libraryStore\.updateMeta\(trackId, \{ lyrics, lyricsType/.test(body), 'lyrics:manual 要把歌詞寫回歌曲庫：');
  ok(body.includes("io.emit('library:lyrics-updated'"), '寫回後要通知歌曲庫頁更新狀態：');
});

test('媒體庫超過 10000 首時優先保留播放清單與 currentTrack backing，淘汰未使用低順位項目', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-library-protected-eviction-'));
  try {
    const libraryPath = path.join(dataDir, 'library.json');
    const entries = {};
    for (let i = 0; i < 10000; i += 1) {
      entries[`normal-${i}`] = {
        id: `normal-${i}`, title: `Normal ${i}`, artist: '', playCount: i + 1, lastPlayed: i + 1,
      };
    }
    entries['active-playlist'] = { id: 'active-playlist', title: 'Active playlist', artist: '', playCount: 0, lastPlayed: 0 };
    entries['active-current'] = { id: 'active-current', title: 'Active current', artist: '', playCount: 0, lastPlayed: 0 };
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(libraryPath, JSON.stringify({ schemaVersion: 1, entries }), 'utf8');

    const appStatePath = path.join(__dirname, '..', 'server', 'state', 'app-state.js');
    const libraryStorePath = path.join(__dirname, '..', 'server', 'services', 'library-store.js');
    const script = [
      "const {createAppState}=require(process.argv[1]); const library=require(process.argv[2]);",
      "const app=createAppState({emit(){}});",
      "app.playState.playlist=[{id:'active-playlist',entryId:'dup-a'},{id:'active-playlist',entryId:'dup-b'}];",
      "app.playState.currentTrack={id:'active-current',entryId:'current-only'};",
      "if(!library.saveNow()) throw new Error('eviction save failed');",
      "const list=library.getLibrary();",
      "process.stdout.write('__PROTECTED_EVICTION__'+JSON.stringify({count:list.length,activePlaylist:!!library.getEntry('active-playlist'),activeCurrent:!!library.getEntry('active-current'),normal0:!!library.getEntry('normal-0'),normal1:!!library.getEntry('normal-1'),normal2:!!library.getEntry('normal-2')})+'\\n');",
    ].join('\n');
    const child = spawnStateStore(process.execPath, ['-e', script, appStatePath, libraryStorePath], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir }, encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    eq(child.status, 0, `protected eviction child stderr=${child.stderr} stdout=${child.stdout}: `);
    const markerAt = child.stdout.lastIndexOf('__PROTECTED_EVICTION__');
    ok(markerAt >= 0, `protected eviction child 缺少結果：${child.stdout}`);
    const result = JSON.parse(child.stdout.slice(markerAt + '__PROTECTED_EVICTION__'.length).trim().split(/\r?\n/, 1)[0]);
    eq(result.count, 10000);
    eq(result.activePlaylist, true, '播放清單引用即使 playCount 最低也不得被 cap 淘汰: ');
    eq(result.activeCurrent, true, 'currentTrack 即使不在播放清單也不得被 cap 淘汰: ');
    eq(result.normal0, false, '應改淘汰最低順位的未使用項目: ');
    eq(result.normal1, false, '超量兩筆時應淘汰兩個未使用低順位項目: ');
    eq(result.normal2, true);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

testAsync('AI 伴奏安裝取消：pip 子行程被中止，等行程真的結束才回報 CANCELLED（feedback #19）', async () => {
  // 先讓同步測試註冊完成，避免取消與 timeout 計時器一起被阻塞到逾時。
  await new Promise((resolve) => setImmediate(resolve));
  const { EventEmitter } = require('events');
  const aiRuntime = require('../server/services/ai-runtime-provider');
  const events = [];
  const fakeSpawn = () => {
    const proc = new EventEmitter();
    proc.kill = () => {
      events.push('kill');
      // 模擬 Windows 上行程稍後才真正結束：檔案鎖要等到 exit 才釋放。
      setTimeout(() => { events.push('exit'); proc.emit('exit', null); }, 30);
    };
    return proc;
  };
  const controller = new AbortController();
  const pending = aiRuntime.runPythonStep(['-m', 'pip', 'install', 'torch'], { spawnImpl: fakeSpawn, abortSignal: controller.signal, timeoutMs: 60000 });
  setTimeout(() => controller.abort(), 10);
  let error = null;
  try { await pending; } catch (e) { error = e; events.push('rejected'); }
  eq(error && error.code, 'CANCELLED', '取消要以 CANCELLED 收尾，不可被當成一般安裝失敗: ');
  eq(events.join(','), 'kill,exit,rejected', '必須先殺行程、等它結束，才回報取消（否則清暫存檔時檔案還被鎖住）: ');

  let spawned = false;
  const already = new AbortController();
  already.abort();
  let early = null;
  try { await aiRuntime.runPythonStep(['x'], { spawnImpl: () => { spawned = true; return new EventEmitter(); }, abortSignal: already.signal }); } catch (e) { early = e; }
  eq(early && early.code, 'CANCELLED');
  ok(!spawned, '已經取消時不可再啟動新的 python 行程: ');
});

testAsync('AI 伴奏安裝取消：runtime 下載途中取消會回報 cancelled，不是 error', async () => {
  const aiRuntime = require('../server/services/ai-runtime-provider');
  aiRuntime._resetForTests?.();
  const controller = new AbortController();
  const pending = aiRuntime.downloadRuntime({
    platform: 'win32',
    abortSignal: controller.signal,
    inspectDiskSpaceImpl: () => ({ known: false }),
    fetchFileImpl: (_url, _file, { abortSignal }) => new Promise((_resolve, reject) => {
      abortSignal.addEventListener('abort', () => reject(Object.assign(new Error('下載已取消'), { code: 'CANCELLED' })), { once: true });
    }),
  });
  setTimeout(() => controller.abort(), 10);
  let error = null;
  try { await pending; } catch (e) { error = e; }
  eq(error && error.code, 'CANCELLED');
  const status = aiRuntime.getDownloadStatus();
  eq(status.stage, 'cancelled', '使用者取消要記成 cancelled，前端才不會顯示成「元件下載失敗」: ');
  eq(status.active, false);
  eq(status.error, null);
});

testAsync('AI 伴奏安裝取消：bundle 取消後狀態為 cancelled，並提供 step 經過時間給前端', async () => {
  const bundle = require('../server/services/ai-separation-bundle');
  const aiRuntime = require('../server/services/ai-runtime-provider');
  const ffmpeg = require('../server/services/ffmpeg-provider');
  const original = {
    ffmpegAvailable: ffmpeg.isAvailable,
    runtimeAvailable: aiRuntime.isAvailable,
    downloadRuntime: aiRuntime.downloadRuntime,
  };
  bundle._resetForTests();
  try {
    ffmpeg.isAvailable = () => true;
    aiRuntime.isAvailable = () => false;
    let receivedSignal = null;
    aiRuntime.downloadRuntime = ({ abortSignal, onProgress }) => {
      receivedSignal = abortSignal;
      onProgress({ stage: 'install-packages', step: 'pip-install' });
      return new Promise((_resolve, reject) => {
        abortSignal.addEventListener('abort', () => reject(Object.assign(new Error('安裝已取消'), { code: 'CANCELLED' })), { once: true });
      });
    };
    eq(bundle.cancelBundle().ok, false, '沒有在安裝時取消要回 not-running: ');

    const pending = bundle.downloadBundle();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const running = bundle.getStatus();
    eq(running.step, 'pip-install');
    ok(Number.isFinite(running.stepStartedAt) && Number.isFinite(running.serverNow), '狀態要帶 stepStartedAt／serverNow 讓前端顯示經過時間: ');
    ok(running.serverNow >= running.stepStartedAt);
    ok(receivedSignal && !receivedSignal.aborted, '中止訊號要一路傳到 downloadRuntime: ');

    eq(bundle.cancelBundle().ok, true);
    let error = null;
    try { await pending; } catch (e) { error = e; }
    eq(error && error.code, 'CANCELLED');
    const after = bundle.getStatus();
    eq(after.stage, 'cancelled');
    eq(after.active, false);
    eq(after.error, null, '取消不是錯誤，不可帶錯誤訊息: ');
    eq(bundle.cancelBundle().ok, false, '這輪結束後再取消要回 not-running: ');
  } finally {
    ffmpeg.isAvailable = original.ffmpegAvailable;
    aiRuntime.isAvailable = original.runtimeAvailable;
    aiRuntime.downloadRuntime = original.downloadRuntime;
    bundle._resetForTests();
  }
});

test('AI 伴奏安裝取消：路由掛 requirePin、前端取消要按兩次且用 fetchWithPin', () => {
  const api = readApiRoutesSource();
  ok(api.includes("router.post('/ai-separation/bundle/cancel', requirePin,"), '取消路由必須手動掛 requirePin（鐵則 15）: ');
  const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ai-separation-client.js'), 'utf8');
  ok(client.includes("PinAuth.fetchWithPin('/api/ai-separation/bundle/cancel'"), '取消請求要用 fetchWithPin（鐵則 16）: ');
  ok(client.includes("if (cancelMode === 'install') setCancelMode('confirm');"), '取消要先進入確認狀態，避免誤觸打掉跑了十分鐘的安裝: ');
  ok(client.includes("status.stage === 'cancelled'"), '輪詢要認得 cancelled 狀態並收尾: ');
});

test('媒體庫歌詞分檔：舊版內嵌歌詞搬到獨立檔，只改 key／播放次數不重寫歌詞，移除歌曲會清掉歌詞檔', () => {
  // 2026-09-23：2000 首時 library.json 約 42MB，每播一首／每調一次 key 就整份重寫、卡住
  // server 約 0.5 秒。改成 library.json 只存中繼資料、歌詞每首一檔且內容有變才寫。
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-library-lyrics-split-'));
  const libraryStorePath = path.join(__dirname, '..', 'server', 'services', 'library-store.js');
  const runChild = (label, lines) => {
    const child = spawnStateStore(process.execPath, ['-e', lines.join('\n'), libraryStorePath], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir }, encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    eq(child.status, 0, `${label} child stderr=${child.stderr} stdout=${child.stdout}: `);
    const marker = `__${label}__`;
    const markerAt = child.stdout.lastIndexOf(marker);
    ok(markerAt >= 0, `${label} child 缺少結果：${child.stdout}`);
    return JSON.parse(child.stdout.slice(markerAt + marker.length).trim().split(/\r?\n/, 1)[0]);
  };
  const lyricsDir = path.join(dataDir, 'library-lyrics');
  const lyricFiles = () => (fs.existsSync(lyricsDir) ? fs.readdirSync(lyricsDir).filter((n) => n.endsWith('.json')) : []);
  try {
    fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({
      schemaVersion: 1,
      entries: {
        a: { id: 'a', title: 'A', filename: 'a.mp3', playCount: 1, lastPlayed: 1, lyrics: '[00:01.00]甲', lyricsType: 'lrc', parsedLyrics: [{ time: 1000, text: '甲' }] },
        b: { id: 'b', title: 'B', filename: 'b.mp3', playCount: 1, lastPlayed: 1, lyrics: '[00:02.00]乙', lyricsType: 'lrc', parsedLyrics: [{ time: 2000, text: '乙' }] },
        c: { id: 'c', title: 'C', filename: 'c.mp3', playCount: 1, lastPlayed: 1 },
      },
    }), 'utf8');

    // 第一次啟動：v1 → v2，內嵌歌詞搬出去。
    const migrated = runChild('MIGRATE', [
      "const store=require(process.argv[1]);",
      "const a=store.getEntry('a'); const ok=store.saveNow();",
      "process.stdout.write('__MIGRATE__'+JSON.stringify({ok,durable:store.isEntryDurable('a'),text:a.parsedLyrics[0].text})+'\\n');",
    ]);
    eq(migrated.ok, true, '遷移後的第一次存檔要成功: ');
    eq(migrated.text, '甲');
    eq(migrated.durable, true, '歌詞檔與精簡 library.json 都落盤後 entry 必須是 durable（state.json 才能省略歌詞）: ');
    const slim = JSON.parse(fs.readFileSync(path.join(dataDir, 'library.json'), 'utf8'));
    eq(slim.schemaVersion, 2);
    for (const entry of Object.values(slim.entries)) {
      ok(!('lyrics' in entry) && !('parsedLyrics' in entry), `library.json 不可再內嵌歌詞（${entry.id}）: `);
    }
    eq(slim.entries.a.lyricsType, 'lrc', 'lyricsType 等中繼資料要留在 library.json: ');
    eq(lyricFiles().length, 2, '有歌詞的兩首各一個檔，沒歌詞的那首不建檔: ');
    ok(fs.readdirSync(dataDir).some((n) => n.startsWith('library.json.pre-migration')), '內嵌歌詞的舊檔要保留成遷移前備份: ');

    // 在歌詞檔裡塞一個記號：之後若被重寫，記號就會消失。
    const stamp = () => {
      for (const name of lyricFiles()) {
        const file = path.join(lyricsDir, name);
        const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
        doc.untouchedMarker = true;
        fs.writeFileSync(file, JSON.stringify(doc), 'utf8');
      }
    };
    const fileFor = (id) => lyricFiles().map((n) => JSON.parse(fs.readFileSync(path.join(lyricsDir, n), 'utf8'))).find((d) => d.id === id);
    stamp();

    // 第二次啟動：只改 key、再播一次（payload 沒帶歌詞）→ 歌詞檔一個字都不能動。
    const meta = runChild('META', [
      "const store=require(process.argv[1]);",
      "store.updateMeta('a',{pitchShift:3});",
      "store.recordPlay({id:'b',title:'B',filename:'b.mp3'});",
      "const ok=store.saveNow();",
      "const a=store.getEntry('a'); const b=store.getEntry('b');",
      "process.stdout.write('__META__'+JSON.stringify({ok,pitch:a.pitchShift,aText:a.parsedLyrics&&a.parsedLyrics[0].text,bText:b.parsedLyrics&&b.parsedLyrics[0].text,bPlays:b.playCount})+'\\n');",
    ]);
    eq(meta.ok, true);
    eq(meta.pitch, 3);
    eq(meta.aText, '甲', '只改 key 之後重新讀取，歌詞仍要完整: ');
    eq(meta.bText, '乙', 'play:track payload 沒帶歌詞時要沿用既有歌詞，不可被清空: ');
    eq(meta.bPlays, 2);
    eq(fileFor('a').untouchedMarker, true, '只改 key 不可重寫歌詞檔: ');
    eq(fileFor('b').untouchedMarker, true, '歌詞沒變的重播不可重寫歌詞檔: ');

    // 第三次啟動：歌詞真的變了才寫；移除歌曲要連歌詞檔一起清掉。
    const change = runChild('CHANGE', [
      "const store=require(process.argv[1]);",
      "store.updateMeta('a',{parsedLyrics:[{time:1000,text:'甲改'}]});",
      "store.remove('b');",
      "const ok=store.saveNow();",
      "const a=store.getEntry('a');",
      "process.stdout.write('__CHANGE__'+JSON.stringify({ok,lyrics:a.lyrics,text:a.parsedLyrics[0].text,hasB:store.hasEntry('b')})+'\\n');",
    ]);
    eq(change.ok, true);
    eq(change.text, '甲改');
    eq(change.lyrics, '[00:01.00]甲', '只補 parsedLyrics 時，原本的 lyrics 字串不可遺失: ');
    eq(change.hasB, false);
    eq(fileFor('a').untouchedMarker, undefined, '歌詞內容變了必須重寫歌詞檔: ');
    eq(fileFor('a').parsedLyrics[0].text, '甲改');
    eq(fileFor('b'), undefined, '從媒體庫移除的歌，歌詞檔也要刪掉: ');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('媒體清理以歌曲資產群組處理：播放中三軌與分離中來源保留，孤兒 stem metadata 同步修復', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-asset-cleanup-'));
  const downloadsDir = path.join(dataDir, 'downloads');
  try {
    const libraryStorePath = path.join(__dirname, '..', 'server', 'services', 'library-store.js');
    const script = [
      "const fs=require('fs'); const path=require('path'); const store=require(process.argv[1]);",
      "const downloads=process.env.ELITESAND_DOWNLOADS_DIR; fs.mkdirSync(downloads,{recursive:true});",
      "const active={id:'active',title:'Active',filename:'active.mp3',vocalsFile:'active.vocals.wav',instrumentalFile:'active.instrumental.wav',separationStatus:'done'};",
      "const orphan={id:'orphan',title:'Orphan',filename:'orphan.mp3',vocalsFile:'orphan.vocals.wav',instrumentalFile:'orphan.instrumental.wav',separationStatus:'done',url:'https://example.test/orphan'};",
      "const processing={id:'processing',title:'Processing',filename:'processing.mp3',separationStatus:'processing'};",
      "for(const t of [active,orphan,processing]){ store.rememberImport(t); for(const f of [t.filename,t.vocalsFile,t.instrumentalFile].filter(Boolean)) fs.writeFileSync(path.join(downloads,f),'x'); }",
      "store.saveNow();",
      "const keep=store.getProcessingMediaFilenames(); store.collectMediaFilenames(active,keep);",
      "const result=store.cleanupAudio(keep); store.saveNow();",
      "const entry=store.getEntry('orphan');",
      "const exists=(name)=>fs.existsSync(path.join(downloads,name));",
      "process.stdout.write('__ASSET_CLEANUP__'+JSON.stringify({result,active:[exists('active.mp3'),exists('active.vocals.wav'),exists('active.instrumental.wav')],processing:exists('processing.mp3'),orphan:[exists('orphan.mp3'),exists('orphan.vocals.wav'),exists('orphan.instrumental.wav')],meta:{filename:entry.filename,vocalsFile:entry.vocalsFile,instrumentalFile:entry.instrumentalFile,separationStatus:entry.separationStatus}})+'\\n');",
    ].join('\n');
    const child = spawnStateStore(process.execPath, ['-e', script, libraryStorePath], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir, ELITESAND_DOWNLOADS_DIR: downloadsDir },
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    eq(child.status, 0, `asset cleanup child stderr=${child.stderr} stdout=${child.stdout}: `);
    const markerAt = child.stdout.lastIndexOf('__ASSET_CLEANUP__');
    ok(markerAt >= 0, `asset cleanup child 缺少結果：${child.stdout}`);
    const result = JSON.parse(child.stdout.slice(markerAt + '__ASSET_CLEANUP__'.length).trim().split(/\r?\n/, 1)[0]);
    ok(result.active.every(Boolean), '播放清單引用的原檔＋人聲＋伴奏都必須保留: ');
    eq(result.processing, true, '分離中的來源音檔不可被 cleanup 刪除: ');
    ok(result.orphan.every((value) => value === false), 'library-only 的實體音檔依既有 cleanup 語意可刪除: ');
    eq(result.meta.filename, 'orphan.mp3', '原檔名稱保留供 URL 重抓流程辨識: ');
    eq(result.meta.vocalsFile, null, '被刪掉的人聲 stem metadata 必須清掉: ');
    eq(result.meta.instrumentalFile, null, '被刪掉的伴奏 stem metadata 必須清掉: ');
    eq(result.meta.separationStatus, 'none', 'stem 不存在後不可繼續顯示已分離: ');
    ok(result.result.repairedEntries >= 1);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('播放清單同步以目錄快照避免每首歌重複同步檔案檢查', () => {
  const libraryStore = require('../server/services/library-store');
  libraryStore.resetAudioStatusCache();
  let reads = 0;
  const first = libraryStore.getAudioExistsLookup({
    now: () => 1000,
    readDirectory: () => { reads++; return ['ready.mp3', 'other.mp3']; },
  });
  const second = libraryStore.getAudioExistsLookup({
    now: () => 1500,
    readDirectory: () => { reads++; return []; },
  });
  const refreshed = libraryStore.getAudioExistsLookup({
    now: () => 2000,
    readDirectory: () => { reads++; return ['refreshed.mp3']; },
  });
  eq(reads, 2, '快取期內不得為每個 state payload 重讀目錄: ');
  ok(first('ready.mp3') && second('other.mp3'));
  ok(refreshed('refreshed.mp3') && !refreshed('ready.mp3'));
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

test('清單摘要排序回寫不會洗掉伺服器保存的歌詞／音訊／AI stems', () => {
  const registerPlaylistHandlers = require('../server/routes/handlers/playlist');
  const events = new Map();
  const emitted = [];
  const socket = { on(event, handler) { events.set(event, handler); } };
  const state = {
    playlist: [{
      id: 'keep-lyrics', entryId: 'keep-entry', title: '保留歌詞', artist: '原歌手', filename: 'keep.mp3',
      lyrics: '[00:01.00]不得遺失', lyricsType: 'lrc', parsedLyrics: [{ time: 1000, text: '不得遺失' }],
      vocalsFile: 'keep.vocals.wav', instrumentalFile: 'keep.instrumental.wav', separationStatus: 'done',
      loudnessLufs: -13.4, source: 'youtube', originalName: 'original.webm',
      artistConfidence: 0.87, needsArtistConfirmation: false,
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
  events.get('playlist:update')([{ id: 'keep-lyrics', entryId: 'keep-entry', title: '重新排序後的名稱', artist: '原歌手', lyricsType: 'lrc' }], (result) => { acknowledgement = result; });
  eq(acknowledgement.ok, true);
  eq(state.playlist[0].lyrics, '[00:01.00]不得遺失');
  eq(state.playlist[0].parsedLyrics[0].text, '不得遺失');
  eq(state.playlist[0].filename, 'keep.mp3');
  eq(state.playlist[0].vocalsFile, 'keep.vocals.wav');
  eq(state.playlist[0].instrumentalFile, 'keep.instrumental.wav');
  eq(state.playlist[0].separationStatus, 'done');
  eq(state.playlist[0].loudnessLufs, -13.4);
  eq(state.playlist[0].originalName, 'original.webm');
  eq(state.playlist[0].artistConfidence, 0.87, '單純排序不可把既有歌手可信度洗回 0: ');
  const publicUpdate = emitted.find((item) => item.event === 'playlist:update').data[0];
  eq(Object.prototype.hasOwnProperty.call(publicUpdate, 'lyrics'), false, '廣播清單仍應是摘要: ');
});

test('2000 首前端同步合併重繪、跑馬燈 RAF，封面採 lazy decode', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  const playlistSource = fs.readFileSync(path.join(__dirname, '../public/js/app-playlist.js'), 'utf8');
  ok(appSource.includes('let syncedPlaylistRenderFrame = 0')
    && appSource.includes('function scheduleSyncedPlaylistRender()')
    && appSource.includes('scheduleSyncedPlaylistRender();'),
  'Socket playlist:update + state:sync 應合併到單一待執行 RAF: ');
  ok(playlistSource.includes('let playlistMarqueeFrame = 0')
    && playlistSource.includes('function schedulePlaylistMarqueeUpdate()')
    && playlistSource.includes('schedulePlaylistMarqueeUpdate();'),
  '重複 render 不可堆疊多次全清單 marquee layout measurement: ');
  ok(playlistSource.includes('loading="lazy" decoding="async"'),
    '大量播放清單封面必須延遲載入並非同步解碼: ');
});

test('Socket 角色：display 只掛唯讀事件，controller 才有寫入事件', () => {
  const makeIo = () => ({
    emitted: [], authMiddleware: null, connectionHandler: null,
    use(fn) { this.authMiddleware = fn; },
    on(event, fn) { if (event === 'connection') this.connectionHandler = fn; },
    emit(event, data) { this.emitted.push({ event, data }); },
  });
  const makeSocket = (type, pin = '') => ({
    id: `${type}-1`, handshake: { auth: { clientType: type, pin }, address: '127.0.0.1' },
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
  overlay.events.get('state:request')();
  overlay.events.get('state:request')();
  eq(overlay.emitted.filter((item) => item.event === 'state:recovery').length, 1,
    '同一 socket 的大型 recovery state 必須有 cooldown：');

  const authStore = require('../server/services/auth-store');
  const testPin = 'role-test-pin';
  ok(authStore.setPin(testPin).ok, 'socket role test must seed its control PIN');
  try {
    const controlIo = makeIo();
    socketHandler(controlIo);
    const controller = makeSocket('controller', testPin);
    controlIo.authMiddleware(controller, (err) => { if (err) throw err; });
    controlIo.connectionHandler(controller);
    ok(controller.events.has('play:toggle'));
    ok(controller.events.has('library:clear'));
  } finally {
    authStore.clearPin(testPin);
  }
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
  // 這個守衛比對的是跨行片段：git worktree 依 core.autocrlf 取出的檔案是 CRLF，
  // 直接 includes() 會誤判成「守衛消失」。先正規化行尾，讓它只檢查真正的內容。
  const displayCss = fs.readFileSync(path.join(__dirname, '../public/css/display.css'), 'utf8').replace(/\r\n/g, '\n');
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
  ok(baseCss.includes('#lib-search.input { flex: 1; min-width: 140px; width: auto; }') && baseCss.includes('.btn.btn--track-edit-save'), 'library, setlist, and track-edit CSP classes must retain their old static styles: ');
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
        // 稽核修正：有副作用的 GET 也要擋。system-check?force=1 會繞過快取直接 spawn
        // yt-dlp/ffmpeg，任何網頁都能重複觸發。403 在 middleware 就短路，不會真的 spawn。
        for (const sideEffectGet of ['/api/system-check?force=1', '/api/fonts?refresh=1',
          '/api/diagnostics/export', '/api/twitch/authorize', '/api/ytdlp/check?force=1',
          '/api/announcements?force=1', '/api/update-check?force=1']) {
          const blocked = await request({ host: '127.0.0.1', port, path: sideEffectGet,
            headers: { 'sec-fetch-site': 'cross-site' } });
          if (blocked.statusCode !== 403) { process.exitCode = 6; break; }
        }
        // 反向：<img>/<audio>/health probe 會直接載入的唯讀 GET 絕不能被這條規則擋掉，
        // 擋掉等於封面圖、音訊與桌面殼啟動全壞。
        for (const readOnlyGet of ['/api/health', '/api/cover/does-not-exist.jpg', '/api/lan-info']) {
          const allowed = await request({ host: '127.0.0.1', port, path: readOnlyGet,
            headers: { 'sec-fetch-site': 'cross-site' } });
          if (allowed.statusCode === 403) { process.exitCode = 7; break; }
        }
        // 同源與無標頭（Stream Deck／curl／Electron probe）維持可用。
        const sameOrigin = await request({ host: '127.0.0.1', port, path: '/api/deck/state',
          headers: { 'sec-fetch-site': 'same-origin' } });
        if (sameOrigin.statusCode !== 200) process.exitCode = 8;
        const noHeader = await request({ host: '127.0.0.1', port, path: '/api/deck/state' });
        if (noHeader.statusCode !== 200) process.exitCode = 9;
        // 無 browser header 的 LAN/CLI client 仍可呼叫強制檢查，但不可無限連發昂貴工作。
        const forcedCheck = await request({ host: '127.0.0.1', port, path: '/api/system-check?force=1' });
        const repeatedCheck = await request({ host: '127.0.0.1', port, path: '/api/system-check?force=1' });
        if (forcedCheck.statusCode !== 200 || repeatedCheck.statusCode !== 429
          || !repeatedCheck.headers['retry-after']) process.exitCode = 14;
        const body = JSON.stringify({ value: 'x'.repeat(2.1 * 1024 * 1024) });
        const large = await request({ host: '127.0.0.1', port, path: '/api/auth/verify', method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, body);
        if (large.statusCode !== 413) process.exitCode = 3;
        // OBS 啟動頁（file:// 來源、Origin: null）要能讀 /api/health → 必須有 CORS 放行；
        // 其他 API 不可跟著開（隨便挑一個唯讀端點驗證沒有 * 標頭）。
        if (health.headers['access-control-allow-origin'] !== '*') process.exitCode = 10;
        const lanInfo = await request({ host: '127.0.0.1', port, path: '/api/lan-info' });
        if (lanInfo.headers['access-control-allow-origin']) process.exitCode = 11;
        // 伺服器 listen 後必須把啟動頁寫到 data/obs-sources，且 /api/obs-launcher 回的路徑要真的存在
        const launcherRes = await new Promise((resolve, reject) => {
          http.get({ host: '127.0.0.1', port, path: '/api/obs-launcher' }, (res) => {
            let raw = ''; res.on('data', (c) => { raw += c; }); res.on('end', () => resolve({ status: res.statusCode, body: raw }));
          }).on('error', reject);
        });
        const launcher = JSON.parse(launcherRes.body);
        const fs = require('fs');
        if (launcherRes.status !== 200 || !fs.existsSync(launcher.files.lyrics) || !fs.existsSync(launcher.files.setlist)) process.exitCode = 12;
        const lyricsHtml = fs.readFileSync(launcher.files.lyrics, 'utf8');
        if (!lyricsHtml.includes('"/display"') || !lyricsHtml.includes('[' + port + ',') || !lyricsHtml.includes('/api/health')) process.exitCode = 13;
      } catch (_) { process.exitCode = 4; }
      server.close(() => process.exit(process.exitCode || 0));
    });
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'), timeout: 20000, encoding: 'utf8',
  });
  ok(!result.error || result.error.code !== 'ETIMEDOUT', 'HTTP 安全測試不應逾時: ');
  eq(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('OBS 啟動頁（🔬）：透明、無可見內容、port 清單以目前 port 開頭、產檔原子且冪等', () => {
  const launcher = require('../server/services/obs-launcher');
  const html = launcher.buildLauncherHtml({ kind: 'lyrics', port: 3456 });
  ok(html.includes('background:transparent!important'), '疊加層底色必須透明（鐵則 11）: ');
  ok(!/<(div|p|h1|span|img)\b/i.test(html), '啟動頁不可有任何可見元素: ');
  ok(!/<(script|link)[^>]+src=/i.test(html), '啟動頁不可引用外部資源，file:// 下要自足: ');
  eq(launcher.candidatePortsFor(3456)[0], 3456, '產檔當下的 port 要排第一: ');
  ok(launcher.candidatePortsFor(3000).length === launcher.CANDIDATE_PORTS.length, '預設 port 不可重複列: ');
  ok(html.includes('window.location.replace(') && html.includes('window.location.search'), '要保留 OBS 端的查詢字串: ');
  ok(html.includes("body.status === 'ok'"), '只認 Elitesand 的 health 回應: ');
  eq(launcher.buildLauncherHtml({ kind: 'setlist', port: 1 }).includes('"/setlist"'), true);
  let threw = false;
  try { launcher.buildLauncherHtml({ kind: 'panel', port: 1 }); } catch (_) { threw = true; }
  ok(threw, '不認識的 kind 必須拒絕: ');

  const writes = [];
  const store = new Map();
  const fsImpl = {
    mkdirSync() {},
    readFileSync(file) { if (!store.has(file)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return store.get(file); },
    writeFileSync(file, content) { writes.push(file); store.set(file, content); },
    renameSync(from, to) { store.set(to, store.get(from)); store.delete(from); },
  };
  const first = launcher.writeLaunchers({ port: 3456, fsImpl });
  eq(Object.keys(first.files).length, 2);
  ok(writes.every((file) => file.endsWith('.tmp')), '必須先寫 .tmp 再 rename（原子）: ');
  const before = writes.length;
  launcher.writeLaunchers({ port: 3456, fsImpl });
  eq(writes.length, before, '內容相同不可重寫: ');
  launcher.writeLaunchers({ port: 3457, fsImpl });
  ok(writes.length > before, 'port 變了要更新檔案: ');
});

test('OBS 啟動頁拖放（🔬）：面板可拖方塊、桌面殼只認固定 kind 且檢查 sender、瀏覽器退回拖 URL', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-obs-launcher.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.js'), 'utf8');
  const shell = fs.readFileSync(path.join(__dirname, '..', 'electron', 'shell.js'), 'utf8');
  ok(html.includes('data-launcher="lyrics"') && html.includes('data-launcher="setlist"') && html.includes('draggable="true"'), '面板要有兩個可拖方塊: ');
  ok(html.includes('/js/app-obs-launcher.js'), '面板要載入 app-obs-launcher.js: ');
  ok(ui.includes("event.dataTransfer.setData('text/uri-list'"), '瀏覽器環境要退回拖 URL: ');
  ok(ui.includes('event.preventDefault();') && ui.includes('shell.startObsLauncherDrag(kind)'), '桌面版要取消 HTML5 drag 改走 startDrag: ');
  ok(preload.includes("if (kind === 'lyrics' || kind === 'setlist') ipcRenderer.send('elitesand:obs-launcher-drag', kind);"), 'preload 只放行兩個固定 kind: ');
  const handler = shell.slice(shell.indexOf("ipcMain.on('elitesand:obs-launcher-drag'"));
  ok(handler.includes('if (event?.sender !== window.webContents) return;'), '主程序必須檢查 IPC 來源: ');
  ok(handler.includes("kind === 'setlist' ? 'Elitesand-Pro-Setlist.html' : kind === 'lyrics' ? 'Elitesand-Pro-Lyrics.html' : null"), '路徑由主程序決定，renderer 不可指定: ');
  ok(handler.includes('event.sender.startDrag({ file: target'), '要用 startDrag 拖實體檔: ');
});
