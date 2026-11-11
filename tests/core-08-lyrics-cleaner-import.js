'use strict';

// 核心回歸測試（lyrics-cleaner-import）。由 tests/run-tests.js 依序載入，不要單獨執行。
const {
  fs,
  readApiRoutesSource,
  path,
  failed,
  test,
  eq,
  ok,
} = require('./core-harness');

// ═══════════════════════════════════════════
console.log('\n📦 10. 歌詞清洗 (lyrics-cleaner.js)');
// ═══════════════════════════════════════════
const { cleanLyrics, normalizeText } = require('../server/services/lyrics-cleaner');
const { annotateSingerParts } = require('../server/services/singer-parts');
const AudioProcessor = require('../server/services/audio-processor');

test('合唱聲部：獨占標記行（男：/女：/合：）抽成 line.singer 並移除該行', () => {
  const raw = [
    { time: 1000, text: '男：', words: [{ text: '男', start: 0, duration: 100 }, { text: '：', start: 100, duration: 50 }] },
    { time: 2000, text: '我還在尋找一個依靠' },
    { time: 3000, text: '為我生氣為我鬧' },
    { time: 4000, text: '女：' },
    { time: 5000, text: '幸福開始有預兆' },
    { time: 6000, text: '合：' },
    { time: 7000, text: '小酒窩長睫毛' },
    { time: 8000, text: '是你最美的記號' },
  ];
  const out = annotateSingerParts(raw);
  eq(out.length, 5, '3 個獨占標記行被移除');
  eq(out[0].text, '我還在尋找一個依靠');
  eq(out[0].singer, 'a');
  eq(out[0].singerLabel, '男');
  eq(out[1].singer, 'a', '同一段後續行沿用聲部');
  eq(out[2].text, '幸福開始有預兆');
  eq(out[2].singer, 'b');
  eq(out[3].singer, 'both', '合 → both');
  eq(out[4].singer, 'both');
});

test('合唱聲部：同行前綴（女：天天都需要你愛）剝掉前綴、掛聲部、修正逐字 words', () => {
  const raw = [
    { time: 1000, text: '女：天天都需要你愛', words: [
      { text: '女', start: 0, duration: 80 }, { text: '：', start: 80, duration: 40 },
      { text: '天', start: 120, duration: 200 }, { text: '天', start: 320, duration: 200 },
      { text: '都需要你愛', start: 520, duration: 600 },
    ] },
    { time: 2000, text: '我的心思由你猜' },
    { time: 3000, text: '男：是我們感情豐富太慷慨' },
    { time: 4000, text: '還是有上天安排' },
    { time: 5000, text: '合：不得不愛' },
  ];
  const out = annotateSingerParts(raw);
  eq(out.length, 5, '同行前綴不刪行');
  eq(out[0].text, '天天都需要你愛');
  eq(out[0].singer, 'b');
  eq(out[0].words.length, 3, '前綴的「女」「：」兩個 word 單位被剝掉');
  eq(out[0].words[0].text, '天');
  eq(out[1].singer, 'b', '無標記行沿用前一個聲部');
  eq(out[2].text, '是我們感情豐富太慷慨');
  eq(out[2].singer, 'a');
  eq(out[4].singer, 'both');
});

test('合唱聲部：一般歌詞（無標記）原封不動、不新增欄位', () => {
  const raw = [
    { time: 1000, text: '海平面遠方開始陰霾' },
    { time: 2000, text: '悲傷要怎麼平靜純白' },
    { time: 3000, text: '你用唇語說你要離開' },
    { time: 4000, text: '不是浪而是淚海' },
    { time: 5000, text: '轉身離開' },
  ];
  const out = annotateSingerParts(raw);
  eq(out, raw, '回傳同一個陣列參考');
  ok(out.every((l) => !('singer' in l)), '沒有任何 singer 欄位');
});

test('合唱聲部：單一泛用前綴（敘事「他說：」）不觸發，避免誤剝正文', () => {
  const raw = [
    { time: 1000, text: '他說：這是最後一次' },
    { time: 2000, text: '風繼續吹' },
    { time: 3000, text: '他說：我不會回頭' },
    { time: 4000, text: '雨下整夜' },
    { time: 5000, text: '他說：別再找我' },
    { time: 6000, text: '天亮之前' },
  ];
  const out = annotateSingerParts(raw);
  eq(out, raw, '只有單一種非聲部前綴 → 不啟用');
  ok(out.every((l) => !('singer' in l)));
});

test('合唱聲部：英文段落標籤（Chorus:/Verse:）不被當演唱者', () => {
  const raw = [
    { time: 1000, text: 'Verse: I was scared of dentists and the dark' },
    { time: 2000, text: 'I was scared of pretty girls and starting conversations' },
    { time: 3000, text: 'Chorus: Naked as we came' },
    { time: 4000, text: 'One will spread our ashes round the yard' },
    { time: 5000, text: 'Bridge: She feels no need' },
  ];
  const out = annotateSingerParts(raw);
  eq(out, raw, 'Verse/Chorus/Bridge 命中段落標籤白名單 → 不視為標記');
});

test('合唱聲部：標記過少（< 3）不啟用', () => {
  const raw = [
    { time: 1000, text: '男：只有一句對唱' },
    { time: 2000, text: '其餘都是一般歌詞' },
    { time: 3000, text: '第三行' },
    { time: 4000, text: '第四行' },
    { time: 5000, text: '第五行' },
  ];
  const out = annotateSingerParts(raw);
  eq(out, raw);
});

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
  const api = readApiRoutesSource();
  const block = api.slice(api.indexOf("router.post('/youtube/playlist'"), api.indexOf("router.post('/lyrics/search'"));
  ok(block.includes('getPlaylistEntries'));
  ok(!block.includes('processYouTube('));
  const frontend = fs.readFileSync(path.join(__dirname, '../public/js/app-youtube-import.js'), 'utf8');
  ok(frontend.includes("'/api/youtube/inspect'"));
  ok(frontend.includes('requestId: job.requestId'));
  ok(frontend.includes('RISK_WARNING_DISABLED_KEY'));
  ok(frontend.includes('queueYouTubeImport(entry.url'));
});

test('YouTube 搜尋：查詢正規化、筆數上限與 yt-dlp metadata-only 參數固定', () => {
  eq(AudioProcessor._normalizeYouTubeSearchQueryForTest('  周杰倫   稻香  '), '周杰倫 稻香');
  const args = AudioProcessor._youtubeSearchArgsForTest('周杰倫 稻香', 999);
  ok(args.includes('--flat-playlist') && args.includes('--dump-single-json') && args.includes('--skip-download'));
  ok(args.includes('--no-config') && args.includes('--playlist-end'));
  ok(args.includes('ytsearch10:周杰倫 稻香'));
  let shortError = null;
  try { AudioProcessor._normalizeYouTubeSearchQueryForTest('a'); } catch (error) { shortError = error; }
  eq(shortError?.code, 'YOUTUBE_SEARCH_INVALID_QUERY');
});

test('YouTube 搜尋：只回白名單欄位、去重並拒絕非官方縮圖', () => {
  const results = AudioProcessor._sanitizeYouTubeSearchPayloadForTest({ entries: [
    {
      id: 'sHD_z90ZKV0', title: '  周杰倫   稻香  ', channel: ' 周杰倫 ', duration: 224.4,
      view_count: 71803791, thumbnail: 'https://evil.example/track.jpg',
      thumbnails: [{ url: 'https://i.ytimg.com/vi/sHD_z90ZKV0/hqdefault.jpg' }],
      description: '這個欄位不能送到 renderer', cookies: 'secret', live_status: null,
    },
    { id: 'sHD_z90ZKV0', title: '重複結果' },
    { id: '../../bad', title: '不合法 ID' },
    { id: 'LIVE0000001', title: '直播中', live_status: 'is_live' },
  ] }, 10);
  eq(results.length, 2);
  eq(results[0].url, 'https://www.youtube.com/watch?v=sHD_z90ZKV0');
  eq(results[0].title, '周杰倫 稻香');
  eq(results[0].thumbnail, 'https://i.ytimg.com/vi/sHD_z90ZKV0/hqdefault.jpg');
  ok(!Object.prototype.hasOwnProperty.call(results[0], 'description'));
  ok(!Object.prototype.hasOwnProperty.call(results[0], 'cookies'));
  eq(results[1].unavailable, true);

  // 合輯／串燒／超長 mix 不丟掉，但穩定排序沉到最後，不佔前排。
  const demoted = AudioProcessor._sanitizeYouTubeSearchPayloadForTest({ entries: [
    { id: 'compxxxxxxx', title: '周杰倫 金曲串燒【精選50首】Playlist', duration: 6000 },
    { id: 'songaaaaaaa', title: '周杰倫 - 稻香', duration: 223 },
    { id: 'longbbbbbbb', title: '周杰倫 演唱會 完整版', duration: 7200 },
    { id: 'songccccccc', title: '周杰倫 - 晴天', duration: 269 },
  ] }, 10);
  eq(demoted.map((r) => r.videoId).join(','), 'songaaaaaaa,songccccccc,compxxxxxxx,longbbbbbbb');
  eq(demoted[0].isCompilation, false);
  eq(demoted[2].isCompilation, true);
});

test('YouTube 搜尋 API 掛 PIN，且 server 端搜尋走既有 yt-dlp 共用佇列', () => {
  const api = readApiRoutesSource();
  ok(api.includes("router.post('/youtube/search', requirePin"));
  const audio = fs.readFileSync(path.join(__dirname, '../server/services/audio-processor.js'), 'utf8');
  const start = audio.indexOf('static async searchYouTube');
  const end = audio.indexOf('// ─── YouTube 播放清單', start);
  const block = audio.slice(start, end);
  ok(block.includes('runQueued('));
  ok(block.includes("'batch'"));
  ok(block.includes('execFileAsync'));
  ok(!block.includes('processYouTube('));
  ok(!block.includes('error?.message'), '搜尋服務不得把 yt-dlp 原始錯誤送回 renderer: ');
  ok(block.includes('music.youtube.com/search'), 'YT 搜尋必須優先 YouTube Music 來源排序: ');
  ok(block.includes('_youtubeSearchArgs'), '仍用一般 ytsearch 參數補齊卡片 metadata: ');
  ok(block.includes('_runYouTubeMusicSearchIds'), 'YT Music 偏好排序要有獨立取 id 的步驟: ');
});

test('YouTube 搜尋 UI：選取結果只能回到 queueYouTubeImport，受保護請求使用 PinAuth', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const frontend = fs.readFileSync(path.join(__dirname, '../public/js/app-youtube-import.js'), 'utf8');
  ['youtube-mode-search', 'youtube-search-query', 'youtube-search-submit', 'youtube-search-results', 'youtube-auto-separate', 'youtube-search-clear']
    .forEach((id) => ok(html.includes(`id="${id}"`), `缺少搜尋 UI #${id}: `));
  ok(frontend.includes('clearYouTubeSearchResults') && frontend.includes("youtubeSearchUi = { key: '', vars: {}, results: [], hasMore: false }"),
    '搜尋結果必須可清除（收掉整塊結果與狀態）: ');
  ok(html.includes('id="youtube-search-more"') && frontend.includes('function loadMoreYouTubeSearch') && frontend.includes("offset, requestId }"),
    '結果底部要有「找更多」往下翻頁（帶 offset 給既有搜尋 API）: ');
  ok(frontend.includes("PinAuth.fetchWithPin('/api/youtube/search'"));
  ok(frontend.includes('queueYouTubeImport(result.url'));
  ok(frontend.includes("data?.code === 'YOUTUBE_SEARCH_RUNTIME_MISSING'"));
  ok(!frontend.includes("fetch('/api/youtube/search'"));
  const searchStart = frontend.indexOf('async function searchYouTube()');
  const searchEnd = frontend.indexOf("dom.youtubeModeLink?.addEventListener", searchStart);
  ok(!frontend.slice(searchStart, searchEnd).includes("'/api/youtube'"), '搜尋本身不得直接觸發下載: ');
});

test('YouTube 搜尋 UI：自動分離只會在下載成功取得 track 後啟動，五語字串齊全', () => {
  const frontend = fs.readFileSync(path.join(__dirname, '../public/js/app-youtube-import.js'), 'utf8');
  const successStart = frontend.indexOf('if (res.ok && data.success && data.track)');
  const separationCall = frontend.indexOf('await separateImportedTrack(job, data.track)', successStart);
  ok(successStart >= 0 && separationCall > successStart, '自動分離必須位於下載成功分支內: ');
  ok(frontend.includes('options.autoSeparate === true'));
  ok(frontend.includes('window.AiSeparation.subscribe(onProgress, { replay: false })'));
  const i18n = require('../public/js/i18n');
  const keys = [
    'source.youtubeModeLink', 'source.youtubeModeSearch', 'youtubeSearch.label',
    'youtubeSearch.submit', 'youtubeSearch.autoSeparate', 'import.separation.completed',
    'import.separation.failedAfterImport',
  ];
  for (const locale of ['zh-TW', 'en', 'ja', 'ko', 'zh-CN']) {
    for (const key of keys) ok(i18n.catalogs?.[locale]?.[key], `${locale} 缺少 ${key}: `);
  }
});

test('AI 伴奏首次啟用：缺 FFmpeg 時擋在門口，並在同一個安裝流程裡補齊', () => {
  // 2026-08-30 實機：使用者按下「下載並啟用」，跑到第 3 步（主模型下載）才被
  // audio-separator 的 ffmpeg 檢查擋死。PATH 修法見上面兩個 withFfmpegOnPath 測試，
  // 這裡守的是「沒有 ffmpeg 時使用者看到什麼」。
  const bundle = fs.readFileSync(path.join(__dirname, '../server/services/ai-separation-bundle.js'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '../public/js/ai-separation-client.js'), 'utf8');
  ok(bundle.includes('value.ffmpeg && value.python'), 'FFmpeg 必須算進「元件是否齊全」，否則分離會放行到一半才炸: ');
  ok(bundle.includes('if (!ffmpegProvider.isAvailable())'), '安裝流程必須先擋 FFmpeg，不能讓使用者下載完 5GB 才吃 Python traceback: ');
  ok(!bundle.includes('ffmpeg: ffmpegProvider.isAvailable()'), 'components() 每 500ms 被輪詢一次，不可每次都 spawn ffmpeg -version: ');
  const startFn = client.indexOf('const start = async () => {');
  const ensureCall = client.indexOf('await ensureFfmpeg();', startFn);
  const bundlePost = client.indexOf("'/api/ai-separation/bundle/download'", startFn);
  ok(startFn >= 0 && ensureCall > startFn && bundlePost > ensureCall, '安裝按鈕必須先補 FFmpeg 再下載 bundle: ');
  ok(client.includes("new CustomEvent('elitesand:ffmpeg-invalidated')"), '補完 FFmpeg 要讓設定頁的就緒狀態立刻更新: ');
  const i18n = require('../public/js/i18n');
  for (const locale of ['zh-TW', 'en', 'ja', 'ko', 'zh-CN']) {
    for (const key of ['aiInstall.step.ffmpeg', 'aiInstall.ffmpegFailed']) {
      ok(i18n.catalogs?.[locale]?.[key], `${locale} 缺少 ${key}: `);
    }
  }
});

test('AI 伴奏首次啟用：下載跑完但元件仍不齊時，安裝視窗不可卡死（可取消、可重試）', () => {
  // 2026-09-01 實機：使用者刪掉元件後重新下載，三個 provider 都裝完、進度條 100%、
  // 顯示「完整元件已就緒」，但 isAvailable() 因為這個 GUI 行程 PATH 上沒有 ffmpeg 而
  // 一直是 false → poll() 兩個分支都不進，每 500ms 空轉，取消鍵 disabled、視窗關不掉。
  const client = fs.readFileSync(path.join(__dirname, '../public/js/ai-separation-client.js'), 'utf8');
  const modalFn = client.slice(client.indexOf('function openInstallModal'), client.indexOf('async function ensureReady'));
  ok(/runOver\s*=\s*!status\.active/.test(modalFn) && modalFn.includes('runOver && !status.available'),
    'poll() 必須處理「跑完但 isAvailable() 仍 false」的終局，不能無限輪詢: ');
  ok(modalFn.includes("t('aiInstall.incomplete')"), '終局要給使用者看得懂的訊息（多半是缺 FFmpeg）: ');
  ok(/onCancel = \(\) => \{\s*if \(!started \|\| runSettled\) \{ close\(false\); return; \}/.test(modalFn)
    && /Escape.*!started \|\| runSettled/.test(modalFn),
    '伺服器這輪結算後（runSettled），取消／Esc 一定要能關掉視窗: ');
  // 2026-09-24（feedback #19）起取消鍵由 setCancelMode() 管：伺服器安裝中＝「取消安裝」，
  // 這輪結算後＝關視窗，只有 FFmpeg 前置下載那一小段是 busy。
  ok(modalFn.includes("setCancelMode(bundleRunning ? 'install' : (runSettled ? 'close' : 'busy'))"),
    '重試期間也要保留一個出口，不可再把取消鍵完全鎖死: ');
  ok(modalFn.includes('status.components.ffmpeg === true'),
    'ensureFfmpeg 只有「明確查到 ffmpeg 在」才略過；狀態讀失敗不可當成已安裝: ');
  // 元件都好了時：先關視窗，WebGPU 預熱丟背景——不可 await 在 close 前面（預熱會卡十幾秒）
  const donePath = modalFn.slice(modalFn.indexOf('status.available && !status.active'), modalFn.indexOf("status.stage === 'error'"));
  ok(donePath.includes('close(true)') && !/await\s+enableWebgpuFallback\(\)/.test(donePath),
    '元件就緒後必須先 close(true) 再背景預熱 WebGPU，不能 await 卡在關視窗前面: ');
  ok(/webgpuWarmInFlight/.test(client) && /let pollBusy = false/.test(modalFn),
    'WebGPU 預熱要單例、輪詢要有重入鎖，避免每 500ms 堆疊把 settings 端點打爆: ');
  const i18n = require('../public/js/i18n');
  for (const locale of ['zh-TW', 'en', 'ja', 'ko', 'zh-CN']) {
    ok(i18n.catalogs?.[locale]?.['aiInstall.incomplete'], `${locale} 缺少 aiInstall.incomplete: `);
  }
});

test('AI 伴奏首次啟用：只呈現一個完整下載入口並清楚揭露空間', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const api = readApiRoutesSource();
  const bundle = fs.readFileSync(path.join(__dirname, '../server/services/ai-separation-bundle.js'), 'utf8');
  ok(html.includes('id="ai-separation-install-modal"'));
  ok(html.includes('7.3 GB') && html.includes('至少 9 GB'));
  ok(!html.includes('id="webgpu-separation-toggle"'), 'WebGPU 不可再是使用者可切換的獨立功能: ');
  ok(api.includes("router.post('/ai-separation/bundle/download', requirePin"));
  ok(bundle.includes('downloadRuntime') && bundle.includes('downloadPrimaryModel') && bundle.includes('downloadModel'));
  ok(bundle.includes('cpu: aiRuntimeProvider.isAvailable() && aiRuntimeProvider.isModelAvailable()'));
});

test('AI 伴奏工作：Python GPU → WebGPU → CPU 共用單一工作與進度來源', () => {
  const jobs = fs.readFileSync(path.join(__dirname, '../server/services/ai-separation-jobs.js'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '../public/js/ai-separation-client.js'), 'utf8');
  const library = fs.readFileSync(path.join(__dirname, '../public/js/media-library.js'), 'utf8');
  const youtube = fs.readFileSync(path.join(__dirname, '../public/js/app-youtube-import.js'), 'utf8');
  const gpuStart = jobs.indexOf("startPython(job, { forceCpu: false })");
  const webgpuStart = jobs.indexOf('tryStartWebgpu(job)', gpuStart);
  const cpuStart = jobs.indexOf('startCpu(job)', webgpuStart);
  ok(gpuStart >= 0 && webgpuStart > gpuStart && cpuStart > webgpuStart, '初始引擎順序必須是 Python GPU → WebGPU → CPU: ');
  ok(jobs.includes("emitProgress(job, 'fallback-webgpu'"));
  ok(jobs.includes("emitProgress(job, 'fallback-cpu'"));
  ok(client.includes("SocketClient.on('separation:progress', ingest)"));
  ok(library.includes('window.AiSeparation?.subscribe((data) =>'));
  ok(youtube.includes('window.AiSeparation.subscribe(onProgress, { replay: false })'));
  ok(!library.includes("SocketClient.on('separation:progress'"));
});

test('AI 分離遙測：三條引擎的終態統一由協調器記一次，帶 fallback 軌跡', () => {
  const jobs = fs.readFileSync(path.join(__dirname, '../server/services/ai-separation-jobs.js'), 'utf8');
  const webgpu = fs.readFileSync(path.join(__dirname, '../server/services/webgpu-separation-jobs.js'), 'utf8');
  // 遙測入口只有協調器一處：webgpu-separation-jobs.js 不得再自己送遙測（以前只有它在送，
  // Python CUDA/CPU 兩條路完全沒記，於是 fellBackToCpu 永遠 false、CPU 成功蓋掉 WebGPU 失敗）。
  ok(!webgpu.includes("require('./usage-telemetry')"), 'WebGPU 這層不得再直接送遙測: ');
  ok(jobs.includes("require('./usage-telemetry')") && jobs.includes('function recordJobTelemetry'));
  ok(jobs.includes('attemptedBackends') && jobs.includes('fellBackToCpu'), '要記「試過哪些引擎 + 有沒有退回 CPU」: ');
  ok(jobs.includes("job.attempts.includes(backend)") && jobs.includes("job.attempts.includes('webgpu')"), '每個引擎記進 attempts（重試不重複記）: ');
  // 三個終態都要記：Python 成功、WebGPU 成功、統一失敗漏斗 finalizeError
  eq((jobs.match(/recordJobTelemetry\(/g) || []).length, 4, 'helper 定義 + Python成功 + WebGPU成功 + finalizeError 共 4 處: ');
  ok(jobs.includes("finalBackend: attempt.mode === 'cpu' ? 'cpu' : 'cuda'"), 'Python 成功要分辨 CUDA/CPU: ');
  ok(jobs.includes("finalBackend: 'webgpu'"), 'WebGPU 成功要記 webgpu: ');
  ok(jobs.includes('recordJobTelemetry(job, { ok: false, code, finalBackend })'), 'finalizeError 是統一失敗漏斗: ');
  // 使用者主動取消不計入失敗率
  ok(jobs.includes("if (error.code !== 'CANCELLED')"), '取消不記遙測，否則灌水分母: ');
  // 接收端支援多後端布林（一次分離試過多個引擎），但 attempt 仍只加一次
  const tele = fs.readFileSync(path.join(__dirname, '../server/services/usage-telemetry.js'), 'utf8');
  ok(tele.includes('data.attemptedBackends') && tele.includes('for (const b of backends)'));
  // 精確重試「次數」（CUDA×n / WebGPU×n）只進本機 log；匿名遙測只送「有沒有重試過」布林
  ok(jobs.includes('嘗試次數: CUDA×') && jobs.includes('WebGPU×'), '精確次數要寫進 log 供診斷包/問題回報: ');
  ok(jobs.includes('retried,') && jobs.includes('job.cudaAttempts) || 0) > 1'), 'retried 布林由 cuda/webgpu 嘗試次數推導: ');
  ok(tele.includes("record('ai.retried', 1, true)"), 'ai.retried 布林要進日彙總: ');
});

test('AI 分離「是否重試過」欄位揭露與遙測 gate 一致', () => {
  const eula = fs.readFileSync(path.join(__dirname, '../EULA.txt'), 'utf8');
  const tele = fs.readFileSync(path.join(__dirname, '../server/services/usage-telemetry.js'), 'utf8');
  const flds = fs.readFileSync(path.join(__dirname, '../server/services/telemetry-fields.js'), 'utf8');
  // DAILY_DISCLOSED_EULA_VERSION 的語義是「這批欄位是在哪一版 EULA 被揭露的」，
  // 不是「目前 EULA 版本」——沒有新增欄位就不該跟著 EULA 版本走（見 usage-telemetry.js
  // 的註解：改欄位登錄表時才同步）。真正要守的不變量是：目前 EULA 版本 >= 揭露版本，
  // 否則 gate 會把所有人擋掉。
  const eulaVersion = (eula.match(/^Version:\s*([0-9]+(?:\.[0-9]+)*)\s*$/m) || [])[1];
  ok(eulaVersion, 'EULA 必須有 x.y.z 版本行: ');
  const cmp = (a, b) => {
    const l = a.split('.'); const r = b.split('.');
    for (let i = 0; i < Math.max(l.length, r.length); i += 1) {
      const d = (Number.parseInt(l[i], 10) || 0) - (Number.parseInt(r[i], 10) || 0);
      if (d) return d;
    }
    return 0;
  };
  ok(cmp(eulaVersion, '1.8.0') >= 0, `EULA 版本(${eulaVersion})不可低於日彙總揭露版本 1.8.0: `);
  ok(eula.includes('retry on the same compute backend') && eula.includes('同一個運算後端上重試'), 'EULA 中英文都要揭露「同後端重試」: ');
  ok(/never\s+a retry count/.test(eula) && eula.includes('不含重試次數'), 'EULA 要明講不送重試「次數」: ');
  ok(tele.includes("DAILY_DISCLOSED_EULA_VERSION = '1.8.0'"), '日彙總 gate 要同步到 1.8.0: ');
  ok(flds.includes("keys.push('ai.retried')"), 'ai.retried 要在欄位登錄表: ');
  ok(/ai\.fallback_to_cpu' \|\| key === 'ai\.retried'/.test(flds), 'ai.retried 要被當成當日布林（不累加次數）: ');
});

test('AI 分離取消：進行中／排隊中都能停，狀態回 none 不算失敗', () => {
  const jobs = fs.readFileSync(path.join(__dirname, '../server/services/ai-separation-jobs.js'), 'utf8');
  const webgpu = fs.readFileSync(path.join(__dirname, '../server/services/webgpu-separation-jobs.js'), 'utf8');
  const api = readApiRoutesSource();
  const client = fs.readFileSync(path.join(__dirname, '../public/js/ai-separation-client.js'), 'utf8');
  const library = fs.readFileSync(path.join(__dirname, '../public/js/media-library.js'), 'utf8');
  const youtube = fs.readFileSync(path.join(__dirname, '../public/js/app-youtube-import.js'), 'utf8');
  const i18n = require('../public/js/i18n');

  // 協調器：對外一個 cancelJobForTrack；進行中依 mode 砍 Python / 中止 WebGPU；排隊中 splice
  ok(jobs.includes('function cancelJobForTrack') && jobs.includes('cancelJobForTrack,'), 'cancelJobForTrack 要匯出: ');
  ok(jobs.includes('supervisor.cancel(job.currentAttemptId)') && jobs.includes('webgpuJobs.cancelJob(job.publicJobId)'));
  ok(jobs.includes('queue.splice(idx, 1)'), '排隊中的要能從佇列移除: ');
  ok(jobs.includes("separationStatus: 'none'") && jobs.includes("emitProgress(job, 'cancelled'"), '取消回到可再點的 none、不是 failed: ');
  // 取消要能擋掉待重試的計時器與 probing 階段
  ok(jobs.includes('clearTimeout(job.retryTimer)') && jobs.includes('job.retryTimer = setTimeout'));
  ok(jobs.includes('job.cancelled || !activeJob'), '重試計時器與 dispatch 都要看 job.cancelled: ');
  ok(jobs.includes('|| job.cancelled) return job.publicJobId'), 'probing 階段被取消要中止，不 spawn worker: ');
  // 取消不記遙測
  const cancelFn = jobs.slice(jobs.indexOf('function finalizeCancelled'), jobs.indexOf('function cancelJobForTrack'));
  ok(!cancelFn.includes('recordJobTelemetry'), '取消不進遙測（不灌失敗率）: ');

  // WebGPU 層：cancelJob 只讓引擎收手，不 emit events（收尾由協調器做）
  ok(webgpu.includes('function cancelJob') && webgpu.includes('cancelJob,'));
  const wgCancel = webgpu.slice(webgpu.indexOf('function cancelJob'), webgpu.indexOf('function cancelJob') + 500);
  ok(wgCancel.includes("emit('webgpu:job:cancel'") && !wgCancel.includes("events.emit"), 'cancelJob 不得 events.emit（會誤觸 fallback）: ');

  // 路由：掛 requirePin（會動到正在跑的 GPU/CPU 工作）
  ok(api.includes("router.post('/library/:id/separate/cancel', requirePin"), '取消路由要掛 requirePin: ');
  ok(api.includes('aiSeparationJobs.cancelJobForTrack(req.params.id)'));

  // 前端：AiSeparation.cancel + ingest 處理 cancelled + 兩個 UI 都有取消入口
  ok(client.includes('async function cancel(trackId)') && client.includes('/separate/cancel') && client.includes('cancel,'), 'AiSeparation 要匯出 cancel(): ');
  ok(client.includes("payload.stage === 'cancelled'") && client.includes('states.delete(trackId)'), 'ingest 收到 cancelled 要清狀態讓按鈕翻回: ');
  ok(library.includes('lib-separate-cancel') && library.includes('function cancelSeparation') && library.includes('window.AiSeparation.cancel(item.id)'));
  ok(library.includes("data.stage === 'cancelled'") && library.includes("cached.separationStatus = 'none'"), '媒體庫收到 cancelled 廣播要重畫: ');
  ok(youtube.includes("data.stage === 'cancelled'") && youtube.includes("code = 'SEPARATION_CANCELLED'"), '匯入流程：取消分離不當成匯入失敗: ');
  ok(youtube.includes("workAction === 'cancel-separation'") && youtube.includes('window.AiSeparation?.cancel(job.separationTrackId)'));

  // i18n：新字串五語齊全
  for (const locale of ['zh-TW', 'en', 'ja', 'ko', 'zh-CN']) {
    for (const key of ['aiJob.cancelled', 'aiJob.cancelAction', 'import.separation.cancelled']) {
      ok(i18n.catalogs?.[locale]?.[key], `${locale} 缺少 ${key}: `);
    }
  }
});

test('AI 分離 hang watchdog：WebGPU 收不到進度心跳逾時 → 切 CPU', () => {
  const webgpu = fs.readFileSync(path.join(__dirname, '../server/services/webgpu-separation-jobs.js'), 'utf8');
  ok(webgpu.includes('PROGRESS_TIMEOUT_MS') && webgpu.includes('function checkWatchdog'));
  ok(webgpu.includes('armWatchdog()') && webgpu.includes('disarmWatchdog()'));
  ok(webgpu.includes('lastProgressAt = Date.now()'), 'handleProgress 要餵心跳: ');
  // 逾時走 events 'error' code 'timeout'——協調器的 webgpuJobs.events.on(error) 已接 startCpu
  ok(webgpu.includes("events.emit('error', { trackId: job.trackId, jobId: job.publicJobId || job.jobId, code: 'timeout' })"));
  ok(webgpu.includes("engineSocket?.emit('webgpu:job:cancel'"), '最佳努力叫引擎在下個 chunk 前收手: ');
  ok(webgpu.includes('watchdogTimer.unref'), '計時器不得擋住 process 結束: ');
});

test('AI 分離：卡死／崩潰的隱藏引擎視窗會被重開', () => {
  const jobs = fs.readFileSync(path.join(__dirname, '../server/services/webgpu-separation-jobs.js'), 'utf8');
  const api = readApiRoutesSource();
  const win = fs.readFileSync(path.join(__dirname, '../electron/webgpu-engine-window.js'), 'utf8');
  const shell = fs.readFileSync(path.join(__dirname, '../electron/shell.js'), 'utf8');

  // server 端：watchdog 逾時 + job 進行中斷線都記一個重開時間戳，新引擎連上就清掉
  ok(jobs.includes("requestEngineRestart('watchdog-timeout')") && jobs.includes("requestEngineRestart('disconnect-mid-job')"));
  ok(jobs.includes('restartRequestedAt = 0') && jobs.includes('function getRestartRequestedAt'), '新引擎連上要撤銷重開請求: ');
  ok(api.includes('engineRestartRequestedAt: webgpuSeparationJobs.getRestartRequestedAt()'), 'runtime-status 要把訊號帶給 Electron: ');

  // 隱藏視窗：render-process-gone / unresponsive 自我修復，且有頻率上限、有 restart()
  ok(win.includes("'render-process-gone'") && win.includes("'unresponsive'") && win.includes('scheduleSelfHeal'));
  ok(win.includes('SELF_HEAL_MAX_IN_WINDOW') && win.includes('selfHealBudgetLeft'), '崩太頻繁要停手，不空轉: ');
  ok(/restart\b/.test(win) && win.includes('start, stop, restart'), '要對外暴露 restart(): ');
  ok(win.includes('disposed') , '有意 stop() 之後不得再自我修復: ');

  // Electron 主程序：輪詢 runtime-status，讀到新的重開時間戳或連續離線就 restart()
  ok(shell.includes('fetchWebgpuEngineHealth') && shell.includes('engineRestartRequestedAt'));
  ok(shell.includes('webgpuLastHandledRestartAt') && shell.includes('webgpuEngineWindow.restart()'));
  ok(shell.includes('WEBGPU_OFFLINE_STRIKES_BEFORE_RESTART'), '連續離線幾次才動手，給正常啟動留餘裕: ');
  ok(shell.includes('startWebgpuEngineHealthLoop()') && shell.includes('stopWebgpuEngineHealthLoop()'));
  ok(shell.slice(shell.indexOf('stopWebgpuEngineWindow')).includes('stopWebgpuEngineHealthLoop()'), '關視窗要一併停輪詢: ');
});

test('AI 分離：CUDA / WebGPU 失敗都先在同一引擎重算幾次，CPU 是最後手段', () => {
  const jobs = fs.readFileSync(path.join(__dirname, '../server/services/ai-separation-jobs.js'), 'utf8');

  // CUDA：失敗先重試 CUDA（不是馬上換 WebGPU），到上限才往下一關
  ok(jobs.includes('CUDA_MAX_ATTEMPTS') && jobs.includes('job.cudaAttempts'), 'CUDA 要有重試次數上限與計數: ');
  const pyHandler = jobs.slice(jobs.indexOf("supervisor.emitter.on('error'"), jobs.indexOf("webgpuJobs.events.on('result'"));
  ok(pyHandler.includes('startPython(job, { forceCpu: false })') && pyHandler.includes('CUDA_RETRY_DELAY_MS'), 'CUDA 重試分支要重跑 CUDA: ');
  // tryStartWebgpu 現在是 async（要反應式等隱藏視窗冷啟，見該函式開頭註解），
  // 呼叫端因此包了一層 IIFE 才能 await；比對時不管中間那層 wrapper 怎麼寫。
  ok(pyHandler.includes('await tryStartWebgpu(job)') && pyHandler.includes('startCpu(job)'), 'CUDA 重試用完才換 WebGPU，撐不住才 CPU: ');
  ok(jobs.includes("CUDA_NO_RETRY_CODES = new Set(['RUNTIME_MISSING', 'MODEL_MISSING', 'PROVIDER_UNAVAILABLE', 'GPU_OOM'])"));
  ok(pyHandler.includes("error.code === 'CANCELLED' || error.code === 'INPUT_UNREADABLE'"), '取消 / 壞輸入不重試也不 fallback: ');

  // WebGPU：失敗先重試 WebGPU（不是馬上退 CPU），到上限才 CPU
  ok(jobs.includes('WEBGPU_MAX_ATTEMPTS') && jobs.includes('job.webgpuAttempts'), 'WebGPU 要有重試次數上限與計數: ');
  const wgHandler = jobs.slice(jobs.indexOf("webgpuJobs.events.on('error'"), jobs.indexOf("reconcileOrphanedProcessing()"));
  ok(wgHandler.includes('await tryStartWebgpu(job)') && wgHandler.includes('startCpu(job)'), 'WebGPU 重試要再試 WebGPU，撐不住才 CPU: ');
  ok(wgHandler.includes('retryable'), '要依錯誤類型決定能不能重試: ');
  ok(jobs.includes("WEBGPU_NO_RETRY_CODES = new Set(['unsupported_gpu', 'timeout'])"));
  // 重試前都要等一下再重派
  // CUDA／WebGPU 各一個延遲重試，另一個是 waitForWebgpuEngine() 內部輪詢用的
  // delay()（等隱藏視窗反應式冷啟，見 tryStartWebgpu 開頭註解），不是第三個重試分支。
  eq((jobs.match(/setTimeout\(/g) || []).length, 3, 'CUDA／WebGPU 各一個延遲重試，加上引擎冷啟輪詢用的 delay(): ');
});

test('WebGPU 引擎：adapter 偵測 / ORT 推論 / device.lost 對到同一顆 GPUDevice', () => {
  const w = fs.readFileSync(path.join(__dirname, '../public/js/webgpu-separation-worker.mjs'), 'utf8');
  // 只有一處真的建裝置（acquireGpu 內），不再有三處各自 requestAdapter/requestDevice
  eq((w.match(/navigator\.gpu\.requestAdapter\(/g) || []).length, 1, 'requestAdapter 只能呼叫一次（acquireGpu）: ');
  eq((w.match(/\.requestDevice\(/g) || []).length, 1, 'requestDevice 只能呼叫一次: ');
  ok(w.includes('ort.env.webgpu.device = gpu.device'), 'ORT 必須用預先建立好的那顆 device: ');
  ok(w.includes('device.lost.then(handleDeviceLost)') && !w.includes('attachDeviceLostWatcher'));
  ok(w.includes("info && info.reason === 'destroyed'"), '正常 teardown 不當故障回報: ');
  // shader-f16 硬性前提要擋
  ok(w.includes('shader-f16') && w.includes("code: 'unsupported_gpu'") && w.includes('gpu.info.shaderF16'));
  // 輸出 NaN/Inf 健檢：每個 chunk 跨步掃 + 最終成品全掃
  ok(w.includes('function assertFinite') && w.includes('Number.isFinite'));
  ok(w.includes("assertFinite(masksPacked, '模型輸出遮罩', 101)"));
  ok(w.includes("assertFinite(vocals, '人聲輸出')") && w.includes("assertFinite(instrumental, '伴奏輸出')"));
  ok(w.includes("assertFinite(out?.data || [], 'canary 輸出'"), 'canary 也要驗有限性: ');
  // watchdog 逾時後引擎能在下個 chunk 前收手
  ok(w.includes("SocketClient.on('webgpu:job:cancel'") && w.includes('cancelRequested'));
});

const { classifyImportError, toImportTelemetryCode } = require('../server/utils/import-error');

test('normalizeText：全形空白→半形、壓縮空白、去頭尾', () => {
  eq(normalizeText('　你好　　世界  '), '你好 世界');
});

test('匯入錯誤分類：登入、Premium、地區、下架、逾時與磁碟滿都有可行下一步', () => {
  const cases = [
    [new Error('Sign in to confirm your age; cookies required'), 'YOUTUBE_AUTH_REQUIRED'],
    [Object.assign(new Error('HTTP Error 429: Too Many Requests'), { code: 'YOUTUBE_RATE_LIMITED' }), 'YOUTUBE_RATE_LIMITED'],
    [Object.assign(new Error('This video is only available to Music Premium members'), { code: 'YOUTUBE_MUSIC_PREMIUM' }), 'YOUTUBE_MUSIC_PREMIUM'],
    [new Error('This video is not available in your country'), 'REGION_RESTRICTED'],
    [new Error('Private video'), 'VIDEO_UNAVAILABLE'],
    [Object.assign(new Error('request timed out'), { code: 'ETIMEDOUT' }), 'IMPORT_TIMEOUT'],
    [Object.assign(new Error('no space left'), { code: 'ENOSPC' }), 'DISK_FULL'],
    [new Error('找不到 FFmpeg，YouTube 轉 MP3 需要它。請到控制面板的系統檢查點「下載 FFmpeg」，或在 config.js 指定 ffmpegPath。'), 'FFMPEG_MISSING'],
  ];
  for (const [error, expected] of cases) {
    const result = classifyImportError(error);
    eq(result.code, expected);
    ok(result.message && result.recovery, `${expected} 應有人話與恢復方式: `);
  }
});

test('匯入錯誤 → 遙測碼對照：取消不計入，其餘各碼對得上 telemetry-fields 的封閉分類', () => {
  const fields = require('../server/services/telemetry-fields');
  const mapped = {
    IMPORT_CANCELLED: null,
    DISK_FULL: 'disk_full',
    YOUTUBE_AUTH_REQUIRED: 'ytdlp_auth_required',
    YOUTUBE_RATE_LIMITED: 'ytdlp_rate_limited',
    REGION_RESTRICTED: 'ytdlp_geo_blocked',
    VIDEO_UNAVAILABLE: 'ytdlp_private',
    IMPORT_TIMEOUT: 'ytdlp_timeout',
    FFMPEG_MISSING: 'ffmpeg_missing',
  };
  for (const [productCode, telemetryCode] of Object.entries(mapped)) {
    eq(toImportTelemetryCode(productCode), telemetryCode, `${productCode} → ${telemetryCode}: `);
    if (telemetryCode !== null) {
      ok(fields.ERROR_CODES.import.includes(telemetryCode), `${telemetryCode} 必須存在於 telemetry-fields 的封閉清單: `);
    }
  }
  // 沒有明確對照的碼（Music Premium、未分類的 IMPORT_FAILED）原樣通過，
  // 交給 usage-telemetry 的 mapError() 兜底成 'other'，而不是勉強塞進錯的分類
  eq(toImportTelemetryCode('YOUTUBE_MUSIC_PREMIUM'), 'YOUTUBE_MUSIC_PREMIUM');
  eq(fields.mapError('import', toImportTelemetryCode('YOUTUBE_MUSIC_PREMIUM')), 'other');
  eq(toImportTelemetryCode('IMPORT_FAILED'), 'IMPORT_FAILED');
  eq(fields.mapError('import', toImportTelemetryCode('IMPORT_FAILED')), 'other');
});

test('YouTube 匯入路由：成功與失敗都記遙測，取消不記、未知格式歸 other', () => {
  const api = readApiRoutesSource();
  const block = api.slice(api.indexOf("router.post('/youtube',"), api.indexOf("router.post('/youtube/cancel',"));
  ok(block.includes("usageTelemetry.recordOutcome('import', true)"), '成功路徑要記 import.ok: ');
  ok(block.includes("usageTelemetry.recordOutcome('import', false, 'other')"), 'sanitizeTrack 失敗要記一次失敗（歸 other）: ');
  ok(block.includes('toImportTelemetryCode(classified.code)'), '失敗要先轉成遙測碼: ');
  ok(block.includes('if (telemetryCode !== null) usageTelemetry.recordOutcome'), '取消（telemetryCode 為 null）不可記錄，否則會灌水失敗率的分母: ');
});

test('Music Premium 限制會在 metadata 策略中明確中止，不降級成一般匯入失敗', () => {
  const audioProcessor = fs.readFileSync(path.join(__dirname, '../server/services/audio-processor.js'), 'utf8');
  ok(audioProcessor.includes("function isYouTubeMusicPremiumError(error)"));
  ok(audioProcessor.includes("if (isYouTubeMusicPremiumError(err)) throw createYouTubeMusicPremiumError();"));
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

test('本地音檔上傳：檔名先還原 UTF-8 再自動拆歌手/歌名，不吃 latin1 亂碼', () => {
  const src = readApiRoutesSource();
  // busboy 以 latin1 解碼 file.originalname，中日文檔名會亂碼；歌名 fallback 曾直接吃未解碼的
  // originalname（落盤檔名有還原、歌名卻沒有）。守住：不可再用未解碼的 originalname 當歌名。
  ok(!/title:\s*metadata\.common\.title\s*\|\|\s*path\.basename\(file\.originalname/.test(src),
    '歌名 fallback 不可再用未解碼的 file.originalname（中日文會亂碼）：');
  ok(/Buffer\.from\(file\.originalname,\s*'latin1'\)\.toString\('utf8'\)/.test(src),
    '本地上傳需先把 originalname 還原成 UTF-8：');
  ok(/parseVideoTitle\(/.test(src),
    '本地上傳需比照 YouTube 從檔名自動拆歌手/歌名：');
  // 還原後的檔名交給既有 parser：無內嵌標籤時「周杰倫 - 稻香」應拆成歌手/歌名（端到端已實測 200）。
  const parsed = AudioProcessor.parseVideoTitle('周杰倫 - 稻香');
  eq(parsed.artist, '周杰倫');
  eq(parsed.title, '稻香');
});

test('真實／伴奏標題基準：歌名與歌手正確率皆至少 95%', () => {
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

test('標題清理：噪音括號整組吃掉、假斜線正規化，且不動歌名本身的括號', () => {
  // 2026-08-30 清庫的第 2 類指紋（memory `import-parse-failure-fingerprints`）：
  // NOISE_PATTERNS 是逐個詞比對，一個括號裡塞兩個以上宣傳詞時只咬掉其中一個，
  // 剩半組括號就變尾綴垃圾（'氧氣 版)'、'囚鳥 )'）；上傳者又會拿 ⧸ ∕ ⁄ 假冒 '/'
  // 繞過 YouTube 檔名限制，NFKC 併不掉，'M⧸V' 就原封不動留在歌名裡。
  const id = (raw) => AudioProcessor.resolveTrackIdentity({ title: raw });

  eq(id('Jeremy Zucker - I miss you more (中文字幕版)').title, 'I miss you more', '括號被逐詞規則咬掉關鍵字後，落單的「版)」要一起清掉: ');
  eq(id('彭佳慧 - 囚鳥 (官方完整版MV)(Live版)').title, '囚鳥', '連續兩組噪音括號都要清掉: ');
  eq(id('張雨生 - 大海 (國)').title, '大海', '整組只有語言標記的括號要清掉: ');
  eq(id('Aimer - 花の唄 M⧸V').artist, 'Aimer', "假斜線的 'M⧸V' 沒清掉會被當成分隔字元、把歌手切斷: ");
  eq(id('Aimer - 花の唄 M⧸V').title, '花の唄', '假斜線正規化後的 M/V 要視為噪音: ');
  eq(id('Rev. from DVL - Ref：rain (Eng⧸Rom⧸Han Lyrics)').title, 'Ref:rain', '括號整組是語言標記＋Lyrics，要整組清掉而不是留下半個左括號: ');

  // 歌名本身帶的括號絕不能被清掉——這是刻意不把 Ver／Version 放進噪音詞的原因。
  eq(id('《K歌之王 AIR (Day Version)》陳奕迅 Eason Chan with The Heritage Orchestra【Official MV】').title,
    'K歌之王 AIR (Day Version)', '歌名自己的括號要保留: ');
  // 括號是兩段之間唯一的分隔時，刪掉會把上傳者署名黏進歌手名。
  eq(id('彩虹- 周杰倫（KTV、無人聲、伴奏）LukeForSong').artist, '周杰倫', '噪音括號當分隔用時，後面的頻道署名不可黏進歌手: ');
});

test('合唱曲的結構化歌手欄位不重複列出同一組人', () => {
  // 實測回報：YouTube Music 來源的合唱曲，面板顯示「陳慧琳 & 馮德倫 & 陳慧琳, 馮德倫」。
  // yt-dlp 同時給 artists:['A','B'] 與 artist:'A, B'，舊版逐字串比對去重，兩者字面不同
  // 都被留下。改成「拆成單一藝人名只為了判斷重複」：整個值的每個名字都收過就丟掉。
  const artistOf = (info) => AudioProcessor.getMetadataArtist(info);

  eq(artistOf({ artists: ['陳慧琳', '馮德倫'], artist: '陳慧琳, 馮德倫', albumArtist: '陳慧琳' }),
    '陳慧琳 & 馮德倫', '同一組人的另一種寫法不可再列一次: ');
  eq(artistOf({ artists: ['周華健', '李宗盛', '品冠'], artist: '周華健、李宗盛、品冠' }),
    '周華健 & 李宗盛 & 品冠', '頓號寫法也算同一組人: ');
  eq(artistOf({ artists: ['DAOKO', '米津玄師'], artist: 'DAOKO feat. 米津玄師' }),
    'DAOKO & 米津玄師', 'feat./ft. 寫法也算同一組人: ');

  // 拆開只為了比對，不可拿拆出來的名字重新拼——這兩個名字本身就含分隔符號。
  eq(artistOf({ artist: 'Tyler, The Creator' }), 'Tyler, The Creator', '名字裡的逗號不可被當成分隔: ');
  eq(artistOf({ artist: 'Simon & Garfunkel' }), 'Simon & Garfunkel', '名字裡的 & 不可被當成分隔: ');
  // 真的是兩組不同的人時仍要都留著。
  eq(artistOf({ artists: ['安溥'], artist: '張懸' }), '安溥 & 張懸', '不同名字不可被吞掉: ');
  eq(artistOf({}), '', '沒有結構化欄位時回空字串: ');
});

test('唱片公司／搬運頻道不會被當成原唱', () => {
  // 2026-08-30 清庫的第 1 類指紋（memory `import-parse-failure-fingerprints`）：
  // 「ForwardMusic 添翼」「滾石唱片 ROCK RECORDS」被寫成歌手。錯的歌手名不只顯示錯，
  // 還會一路污染歌詞搜尋的 query，所以寧可留空讓面板顯示「原唱待確認」。
  const id = (info) => AudioProcessor.resolveTrackIdentity(typeof info === 'string' ? { title: info } : info);

  // 三段式「廠牌 - 歌手 - 歌名」：不先剝掉廠牌，切割器會把廠牌當歌手、後兩段整串當歌名。
  eq(id('ForwardMusic 添翼 - 魏如萱 - 你啊你啊').artist, '魏如萱', '廠牌開頭要剝掉，真正的歌手才切得出來: ');
  eq(id('ForwardMusic 添翼 - 魏如萱 - 你啊你啊').title, '你啊你啊', '剝掉廠牌後歌名不可還黏著歌手: ');
  eq(id('滾石唱片 ROCK RECORDS - 五月天 - 志明與春嬌').artist, '五月天', '中英並列的廠牌名也要剝: ');

  // 兩段式「廠牌 - 歌名」沒有真正的歌手可用，留空比塞廠牌好。
  eq(id('Sony Music - 告白氣球').artist, '', '找不到真正的歌手時要留空（面板顯示「原唱待確認」）: ');
  eq(id('Sony Music - 告白氣球').title, '告白氣球', '留空歌手不代表歌名也要壞掉: ');
  // yt-dlp 的結構化欄位一樣可能填廠牌。
  eq(id({ title: '魏如萱 - 你啊你啊', artist: 'ForwardMusic', track: '你啊你啊' }).artist, '',
    '結構化欄位填的是廠牌時一樣不可採用: ');
  // 頻道名出現在標題裡本來就會被當歌手兜底，廠牌頻道要排除。
  eq(id({ title: '告白氣球', channel: 'Sony Music Taiwan' }).artist, '', '廠牌頻道不可當兜底歌手: ');

  // 反向保護：名字裡剛好有 Record／Music 的真藝人不可被誤殺。
  eq(id('Broken Record - Some Artist').artist, 'Broken Record', '單數 Record 不算廠牌: ');
  eq(id('Music Travel Love - Perfect').artist, 'Music Travel Love', '名字裡有 Music 不算廠牌: ');
});

test('三段以上的連字號標題靠「唯一的已知歌手」定方向', () => {
  // 2026-08-30 清庫的第 1 類指紋（memory `import-parse-failure-fingerprints`）：
  // '如願 - 楊丞琳 - 而我將…' 只切第一個連字號，等於在猜第一段是歌手還是歌名，
  // 猜錯就把「歌手 - 附註」整串當歌名。三段以上時改用唯一的高信度訊號定方向。
  const parse = (raw) => AudioProcessor.parseVideoTitle(raw);

  const a = parse('如願 - 楊丞琳 - 而我將 愛你所愛的人間');
  eq(a.artist, '楊丞琳', '中間那段才是歌手: ');
  eq(a.title, '如願', '第一段是歌名，歌詞引言要丟掉: ');

  const b = parse('周杰倫 - 告白氣球 - 電影主題曲');
  eq(b.artist, '周杰倫', '歌手在第一段時方向不可反過來: ');
  eq(b.title, '告白氣球', '第三段的附註不可黏進歌名: ');

  // 沒有任何一段是已知歌手就不猜，維持原本的兩段式規則（寧可不動，也不要亂調方向）。
  eq(parse('A - B - C').reason, 'artist-title-dash', '認不出歌手時不可套用這條規則: ');
});

test('播放清單匯入：單一影片抓不到 metadata 不會卡住整條批次佇列', () => {
  // 實測回報：300 首播放清單匯入到一半，其中一支影片 yt-dlp 全部策略＋oEmbed 都失敗，
  // /api/youtube/inspect 回 500；inspectImport() 原本一律把「抓不到 metadata」包成
  // warning:true 的假風險評估，交給 confirmRiskAssessment() 跳出確認彈窗等使用者點——
  // 播放清單匯入時沒有人一直盯著，整條佇列（後面還有幾百首）就安靜停住，6 分鐘沒有任何
  // 進度。單首匯入（使用者就在螢幕前操作）仍要維持「問一下要不要仍然嘗試」。
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-youtube-import.js'), 'utf8')
    .replace(/\r\n/g, '\n');

  ok(source.includes('isBatch: true,'), '播放清單排進佇列的每個 job 都要標記為批次匯入：');
  ok(source.includes('isBatch: options.isBatch === true,'), 'queueYouTubeImport 必須把旗標存到 job 上：');

  const inspectFn = source.slice(source.indexOf('async function inspectImport'), source.indexOf('function jobLabelParts'));
  ok(inspectFn.includes('if (job.isBatch) {'), 'inspectImport 要能分辨這是不是批次匯入：');
  ok(/if \(job\.isBatch\) \{[\s\S]{0,300}unreachable\.code = 'IMPORT_METADATA_UNAVAILABLE';[\s\S]{0,100}throw unreachable;/.test(inspectFn),
    '批次匯入時純技術性失敗要直接丟出去跳過這首，不能走進確認彈窗：');
  // 單首匯入的分支必須還在 job.isBatch 判斷之後，維持原本行為不變。
  const batchBranchEnd = inspectFn.indexOf('throw unreachable;') + 'throw unreachable;'.length;
  const afterBatchBranch = inspectFn.slice(batchBranchEnd);
  ok(afterBatchBranch.includes("warningTypes: ['metadata-unavailable']"), '單首匯入仍要走原本的確認彈窗流程：');
});

test('無分隔符對唱標題：連接符（&＋_-）也算邊界，老歌 KTV 上傳才切得出兩位歌手', () => {
  // 2026-09-08 這批 256 首播放清單匯入的真實回歸：歌手是空的 19 筆裡，13 筆的根因是
  // matchBoundaryPrefix() 只認空白當邊界，「歌手A&歌手B_歌名」「歌手A 歌手B 歌名」這種
  // 老歌 KTV/MTV 上傳常見、完全沒有標準分隔符的標題，只要有一段落在空白以外的符號上
  // 就整句落回 whole-title、歌手變空的。另一半根因是這批 80-90 年代對唱歌手完全不在
  // KNOWN_ARTISTS_RAW 裡（清單本來就偏 J-pop/新生代/K-pop）。
  const id = (raw) => AudioProcessor.resolveTrackIdentity({ title: raw });

  eq(id('江美琪&張智成-愛情').artist, '江美琪 & 張智成', '歌手中間的裸 & 也要算邊界: ');
  eq(id('江美琪&張智成-愛情').title, '愛情', '切完歌手後歌名不可再黏著連接符: ');
  eq(id('[KTV]黃立行+劉若英-分開旅行(original name-black black heart)').artist, '黃立行 & 劉若英',
    '裸 + 也要算邊界: ');
  eq(id('姜育恆 李翊君 愛我你怕了嗎 KTV').artist, '姜育恆 & 李翊君', '純空白分隔的雙人合唱也要切得出來: ');
  eq(id('羅美玲_不能說走就走 [美華].mpg').artist, '羅美玲', '單一歌手後面接底線也要算邊界: ');
  eq(id('林凡  鄭仲基 想念你的愛').artist, '林凡 & 鄭仲基', '兩個空白也算邊界（不要求剛好一個）: ');

  // 反向保護：邊界放寬後，純 CJK 連著寫、沒有任何空白或連接符時仍然不能誤吃。
  eq(id('周杰倫粉絲團翻唱大賽精華').artist, '', '純 CJK 連著寫不可被當成有邊界: ');
  eq(id('周杰倫忘記時間').artist, '', '沒有任何連接符時仍要維持既有的保守行為: ');
});

test('落地前去重：找出「歌手+歌名」相符但 videoId 不同的既有記錄', () => {
  // 2026-09-08 實測：「北極雪」被兩個不同 YouTube 上傳各匯入一次，videoId 不同，
  // rememberImport() 原本用 id 當 key，完全不會發現。findByIdentity() 是第二層 key。
  const libraryStore = require('../server/services/library-store');
  try {
    libraryStore.rememberImport({ id: 'dedup-old-id', title: '北極雪', artist: '馮德倫 & 陳慧琳', filename: 'a.mp3' });

    const hit = libraryStore.findByIdentity('馮德倫 & 陳慧琳', '北極雪', 'dedup-new-id');
    ok(hit, '歌手/歌名完全相符時必須找到既有記錄: ');
    eq(hit.id, 'dedup-old-id');

    // 全形/半形、有無空白只是寫法不同，NFKC 正規化後仍要算同一首。
    const hitNormalized = libraryStore.findByIdentity('馮德倫  &  陳慧琳', '北極雪', 'dedup-new-id');
    ok(hitNormalized, '多餘空白不可讓比對失效: ');

    // 排除自己：同一個 id 不算撞到「別的」記錄。
    eq(libraryStore.findByIdentity('馮德倫 & 陳慧琳', '北極雪', 'dedup-old-id'), null,
      '排除自己這筆，不可以自己撞自己: ');

    // 歌手或歌名不同就不算重複。
    eq(libraryStore.findByIdentity('周杰倫', '北極雪', 'dedup-new-id'), null, '歌手不同不算重複: ');
    eq(libraryStore.findByIdentity('馮德倫 & 陳慧琳', '晴天', 'dedup-new-id'), null, '歌名不同不算重複: ');
  } finally {
    libraryStore.remove('dedup-old-id');
  }
});

test('落地前去重：批次匯入沿用既有版本，單首匯入交回去問使用者取代或略過', () => {
  // 批次匯入（播放清單）沒有人一直盯著，跳確認視窗會卡住整條佇列——跟 metadata-unavailable
  // 那次同一個教訓，寫進 STATUS 的 memory `import-parse-failure-fingerprints`。
  const processor = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'audio-processor.js'), 'utf8').replace(/\r\n/g, '\n');
  ok(processor.includes('libraryStore.findByIdentity(track.artist, track.title, track.id)'),
    '落地前必須用歌手+歌名查重，不能只信 videoId: ');
  ok(/if \(duplicate && !options\.forceReplace\) \{[\s\S]{0,200}if \(options\.isBatch\) \{[\s\S]{0,300}mergedFromDuplicate: true/.test(processor),
    '批次匯入命中重複時要直接沿用既有版本，不建確認流程: ');
  ok(/if \(duplicate && !options\.forceReplace\) \{[\s\S]{0,600}return \{\s*duplicate: true,/.test(processor),
    '單首匯入命中重複時要回傳需要確認的訊號，交給呼叫端問使用者: ');
  ok(processor.includes("libraryStore.remove(duplicate.id)"), '使用者選了取代才可以動到既有記錄: ');
  ok(processor.includes("throw new Error('無法安全保存舊歌曲資料，因此已取消取代；請稍後重試')"),
    '取代前若無法安全保存既有播放清單 fallback，必須取消而不是冒險刪資料: ');

  const route = readApiRoutesSource().replace(/\r\n/g, '\n');
  ok(route.includes("isBatch: req.body.isBatch === true,"), 'API 必須把批次旗標從請求體傳給 processYouTube: ');
  ok(route.includes("forceReplace: req.body.forceReplace === true,"), 'API 必須接受取代旗標: ');
  ok(/if \(result && result\.duplicate\) \{[\s\S]{0,200}code: 'DUPLICATE_SONG'/.test(route),
    '重複訊號要在 sanitizeTrack 之前攔下來，直接回 200 交給前端問使用者，不能被判成失敗: ');

  const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-youtube-import.js'), 'utf8').replace(/\r\n/g, '\n');
  ok(/function youtubeRequestBody\(job, extra = \{\}\)[\s\S]{0,300}isBatch: job\.isBatch === true/.test(client),
    '統一匯入 request body 必須帶上這個 job 是不是批次: ');
  ok(client.includes('body: JSON.stringify(youtubeRequestBody(job))'),
    '一般匯入與 inspect 必須走統一 request body: ');
  ok(/if \(!job\.isBatch && data && data\.code === 'DUPLICATE_SONG'\) \{/.test(client),
    '只有單首匯入才彈確認視窗，批次不能等使用者: ');
  ok(client.includes("body: JSON.stringify(youtubeRequestBody(job, { forceReplace: true }))"),
    '使用者選取代後要帶著 forceReplace 重新送一次: ');
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
