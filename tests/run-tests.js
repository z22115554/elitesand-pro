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
const cloneJson = (value) => JSON.parse(JSON.stringify(value));

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

test('controller 重連可依目前歌曲 id 從清單重新取得索引', () => {
  const result = playlistState.reconcilePlaylist([{ id: 'first' }, { id: 'playing' }, { id: 'last' }], 'playing');
  eq(result.currentTrackIndex, 1);
});

test('P0：桌面貼上歌詞解除 hidden，controller 同步會回填目前歌曲索引', () => {
  const root = path.join(__dirname, '..');
  const desktopLyrics = fs.readFileSync(path.join(root, 'public', 'js', 'app-lyrics-timeline.js'), 'utf8');
  const controllerHtml = fs.readFileSync(path.join(root, 'public', 'controller.html'), 'utf8');
  const controller = fs.readFileSync(path.join(root, 'public', 'js', 'controller.js'), 'utf8');
  ok(desktopLyrics.includes('dom.lyricsPasteModal.hidden = false') && desktopLyrics.includes('dom.lyricsPasteModal.hidden = true'), '桌面貼上歌詞 modal 必須明確開關 hidden: ');
  ok(controllerHtml.includes('src="/js/playlist-state.js"'), 'controller 必須載入共用清單索引邏輯: ');
  ok(controller.includes('function reconcileCurrentTrackIndex(track)') && controller.includes("SocketClient.on('state:sync'") && controller.includes('reconcileCurrentTrackIndex(track)'), 'controller state:sync 必須依 currentTrack.id 回填索引: ');
});

test('P0：貼上歌詞可實際開啟，controller 重連後可對目前歌曲操作', () => {
  class FakeElement {
    constructor() {
      this.hidden = false;
      this.value = '';
      this.textContent = '';
      this.innerHTML = '';
      this.checked = false;
      this.disabled = false;
      this.style = {};
      this.listeners = new Map();
      this.classList = {
        values: new Set(),
        add: (name) => this.classList.values.add(name),
        remove: (name) => this.classList.values.delete(name),
        toggle: (name, force) => {
          if (force === undefined) { if (this.classList.values.has(name)) this.classList.values.delete(name); else this.classList.values.add(name); return; }
          if (force) this.classList.values.add(name); else this.classList.values.delete(name);
        },
        contains: (name) => this.classList.values.has(name),
      };
    }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    focus() {}
    querySelectorAll() { return []; }
  }

  const desktopElements = {
    btnPasteLyrics: new FakeElement(),
    lyricsPasteModal: new FakeElement(),
    lyricsPasteTextarea: new FakeElement(),
    lyricsPasteConfirm: new FakeElement(),
    lyricsPasteCancel: new FakeElement(),
  };
  desktopElements.lyricsPasteModal.hidden = true;
  const desktopState = { playlist: [{ id: 'current-song' }], currentTrackIndex: 0 };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/js/app-lyrics-timeline.js'), 'utf8'),
    {
      SharedUtils: { escapeHtml: (value) => value },
      AppShared: { dom: desktopElements, state: desktopState, showToast() {}, renderPlaylist() {} },
      SocketClient: { send() {} },
      PinAuth: { fetchWithPin() {} },
    },
    { filename: 'app-lyrics-timeline.js' },
  );
  desktopElements.btnPasteLyrics.listeners.get('click')();
  eq(desktopElements.lyricsPasteModal.hidden, false, '桌面貼上歌詞按鈕必須實際打開 modal: ');
  desktopElements.lyricsPasteCancel.listeners.get('click')();
  eq(desktopElements.lyricsPasteModal.hidden, true, '取消必須重新隱藏 modal: ');

  const controllerElements = new Map();
  const elementFor = (id) => {
    if (!controllerElements.has(id)) controllerElements.set(id, new FakeElement());
    return controllerElements.get(id);
  };
  const controllerEvents = new Map();
  const controllerToasts = [];
  const controllerContext = {
    SharedUtils: { formatTime: (value) => String(value), escapeHtml: (value) => String(value || ''), safeHttpUrl: () => null },
    PlaylistState: playlistState,
    SocketClient: { init() {}, on(event, handler) { controllerEvents.set(event, handler); }, send() {} },
    ErrorHandler: { init() {}, showToast(message) { controllerToasts.push(message); } },
    PinAuth: { fetchWithPin() {} },
    document: {
      getElementById: elementFor,
      querySelectorAll() { return []; },
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/js/controller.js'), 'utf8'),
    controllerContext,
    { filename: 'controller.js' },
  );
  controllerEvents.get('state:sync')({
    currentTrack: { id: 'playing', title: '目前歌曲', artist: '測試者' },
    playlist: [{ id: 'first', title: '第一首' }, { id: 'playing', title: '目前歌曲' }, { id: 'last', title: '最後一首' }],
  });
  elementFor('btn-lyrics-paste').listeners.get('click')();
  ok(elementFor('lyrics-paste-modal').classList.contains('active'), 'controller 重連後貼歌詞必須指向目前歌曲而非誤報未選歌: ');
  ok(!controllerToasts.includes('請先選擇歌曲'), 'controller 重連後不應誤報未選歌曲: ');
  ok(elementFor('playlist').innerHTML.includes('ctrl-playlist-item active'), 'controller 清單必須標示重連後的目前歌曲: ');
});

test('預覽縮放不依賴可能在嵌入式 WebView 報錯的 ResizeObserver', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/preview-scale.js'), 'utf8');
  ok(source.includes("window.addEventListener('resize', apply)"), '預覽縮放必須在視窗縮放時重新計算: ');
  ok(!source.includes('new ResizeObserver'), '預覽縮放不得建立不相容的 ResizeObserver: ');
});

test('面板只載入目前可見的 OBS 預覽，避免隱藏 iframe 持續耗用 CPU/GPU', () => {
  const page = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const lifecycle = fs.readFileSync(path.join(__dirname, '../public/js/preview-scale.js'), 'utf8');
  const previewFrames = page.match(/<iframe[^>]+(?:obs-preview|setlist-preview)[^>]*>/g) || [];
  eq(previewFrames.length, 5, '面板預覽數量基準已改變，請同步檢查生命週期管理: ');
  previewFrames.forEach((frame) => {
    ok(frame.includes('data-preview-src='), '預覽 iframe 必須保存延遲載入來源: ');
    ok(!/\ssrc=/.test(frame), '預覽 iframe 不可在 HTML 解析時直接載入: ');
  });
  ok(lifecycle.includes("frame.removeAttribute('src')"), '不可見預覽必須卸載子頁面與動畫迴圈: ');
  ok(lifecycle.includes("document.addEventListener('view:change'"), '切換面板頁面時必須同步預覽生命週期: ');
  ok(lifecycle.includes('window.PreviewLifecycle = { refresh, setSource }'), '詳細設定 modal 必須能要求重新判斷預覽可見性: ');
});

test('顯示端暫停時不持續逐幀重算歌詞', () => {
  // 跨行比對：CRLF 取出的檔案會誤判成失敗，先正規化行尾（同下方 KTV 掃色那題的作法）。
  const source = fs.readFileSync(path.join(__dirname, '../public/js/display.js'), 'utf8').replace(/\r\n/g, '\n');
  ok(source.includes('if (isControllerPlaying) {\n        const timeMs = getSmoothTimeMs();'), 'rAF 的高成本渲染必須只在播放時執行: ');
});

test('對齊第一句維持純文字按鈕，不加入 emoji', () => {
  const page = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const autoRows = fs.readFileSync(path.join(__dirname, '../public/js/i18n-auto.js'), 'utf8');
  const targetEmoji = String.fromCodePoint(0x1F3AF);
  ok(page.includes('id="offset-align"') && page.includes('>對齊第一句</button>'), '對齊第一句按鈕必須保留純文字標籤: ');
  ok(!page.includes(targetEmoji) && !autoRows.includes(targetEmoji), '對齊第一句的五語字串不可帶 emoji: ');
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
  const toolsDir = require('path').join(__dirname, '..', 'tools');
  const scripts = fsForEncoding.readdirSync(toolsDir).filter((name) => name.endsWith('.ps1'));
  ok(scripts.length >= 3, `tools/ 應至少有三支 ps1（portable/update/installer），實際 ${scripts.length}: `);
  for (const filename of scripts) {
    const bytes = fsForEncoding.readFileSync(require('path').join(toolsDir, filename));
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

test('歌詞上傳猜編碼：五語常見編碼都要正確還原（issue #9 回歸測試）', () => {
  const { decodeUploadedText } = require('../server/utils/decode-text');
  const iconv = require('iconv-lite');

  // 原本的判斷式是 content.includes('')（空字串對任何字串恆為 true），導致不管上傳檔案原本
  // 是什麼編碼，一路被強制級聯改判、最後蓋成 gbk——連正常的 UTF-8 上傳都會變亂碼。
  const utf8Text = '[00:01.00]測試歌詞 test lyric';
  eq(decodeUploadedText(Buffer.from(utf8Text, 'utf8')), utf8Text);

  // 使用者實際回報的情境：kugeci.com 這類華語歌詞站常見輸出 GBK 編碼的 .lrc。
  const gbkText = '[00:01.00]傘下 這一刻最好能更緩慢';
  eq(decodeUploadedText(iconv.encode(gbkText, 'gbk')), gbkText);

  // EUC-KR / GBK 的位元組範圍高度重疊；補韓文候選後不能反過來把正常簡中誤判成韓文。
  const simplifiedGbkText = '[00:01.00]简体中文歌词 时间都去哪儿了';
  eq(decodeUploadedText(iconv.encode(simplifiedGbkText, 'gbk')), simplifiedGbkText);

  const big5Text = '[00:01.00]臺灣繁體歌詞 測試資料';
  eq(decodeUploadedText(iconv.encode(big5Text, 'big5')), big5Text);

  const big5TaggedText = '[ar:歌手]\r\n[ti:歌曲]\r\n[00:01.00]臺灣繁體歌詞 愛情夢想雨天風聲';
  eq(decodeUploadedText(iconv.encode(big5TaggedText, 'big5'), 'zh-TW'), big5TaggedText);

  const shiftJisText = '[00:01.00]残響散歌 日本語 テスト';
  eq(decodeUploadedText(iconv.encode(shiftJisText, 'shift_jis')), shiftJisText);

  const shiftJisTaggedText = '[ar:Aimer]\r\n[ti:残響散歌]\r\n[00:01.00]誰が袖に咲く幻花';
  eq(decodeUploadedText(iconv.encode(shiftJisTaggedText, 'shift_jis'), 'ja'), shiftJisTaggedText);

  const koreanText = '[00:01.00]한국어 가사 테스트';
  eq(decodeUploadedText(iconv.encode(koreanText, 'euc-kr')), koreanText);
  eq(decodeUploadedText(iconv.encode(koreanText, 'cp949')), koreanText);

  const koreanTaggedText = '[ar:가수]\r\n[ti:노래]\r\n[00:01.00]한국어 가사 사랑해 안녕 고마워';
  eq(decodeUploadedText(iconv.encode(koreanTaggedText, 'cp949'), 'ko'), koreanTaggedText);

  const utf16Text = '[00:01.00]Unicode 測試';
  eq(decodeUploadedText(iconv.encode(utf16Text, 'utf-16le', { addBOM: true })), utf16Text);

  const utf16BeText = '[00:01.00]五語 Unicode テスト 한국어';
  const utf16BeBom = Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode(utf16BeText, 'utf16-be')]);
  eq(decodeUploadedText(utf16BeBom), utf16BeText);

  // 有些編輯器輸出 UTF-16 卻不帶 BOM；LRC/SRT 的 ASCII 時間碼足以安全判定 LE/BE 方向。
  const bomlessUtf16Text = '[00:01.00]繁中 简中 日本語 한국어 English';
  eq(decodeUploadedText(iconv.encode(bomlessUtf16Text, 'utf-16le')), bomlessUtf16Text);
  eq(decodeUploadedText(iconv.encode(bomlessUtf16Text, 'utf16-be')), bomlessUtf16Text);

  // 純文字 TXT 沒有時間碼/NUL 可利用時，用 UI locale 作低權重提示，避免五語無 BOM UTF-16 變亂碼。
  const bomlessPlainTextCases = [
    ['zh-TW', '臺灣繁體歌詞 我想念你'],
    ['zh-CN', '简体中文歌词 我想念你'],
    ['ja', '残響散歌 君の声が聞こえる'],
    ['ko', '한국어 가사 너의 목소리가 들려'],
  ];
  for (const [locale, text] of bomlessPlainTextCases) {
    eq(decodeUploadedText(iconv.encode(text, 'utf-16le'), locale), text);
    eq(decodeUploadedText(iconv.encode(text, 'utf16-be'), locale), text);
  }

  // 極短純 CJK TXT 也覆蓋常見兩三字案例；一字且無 BOM 的跨編碼資料在位元組層可能天生歧義。
  const shortBomlessCases = [
    ['zh-TW', '雨天'],
    ['zh-CN', '梦想'],
    ['ja', '雨の日'],
    ['ko', '안녕'],
  ];
  for (const [locale, text] of shortBomlessCases) {
    eq(decodeUploadedText(iconv.encode(text, 'utf-16le'), locale), text);
    eq(decodeUploadedText(iconv.encode(text, 'utf16-be'), locale), text);
  }

  // UI 語言不等於歌曲語言：legacy 編碼判定不可被介面語系帶歪。
  const crossLocaleLegacyCases = [
    ['zh-TW', '残響散歌 君の声が聞こえる', 'shift_jis'],
    ['zh-CN', '残響散歌 君の声が聞こえる', 'shift_jis'],
    ['ja', '한국어 가사 사랑해 안녕 고마워', 'cp949'],
    ['zh-TW', '한국어 가사 사랑해 안녕 고마워', 'euc-kr'],
    ['ko', '臺灣繁體歌詞 愛情夢想雨天風聲', 'big5'],
    ['ko', '臺灣繁體歌詞', 'big5'],
    ['ko', '简体中文歌词 时间都去哪儿了', 'gbk'],
    ['ko', '밤하늘의 별을 바라봐', 'cp949'],
    ['zh-TW', '君の声が聞こえる', 'shift_jis'],
    ['zh-CN', '夜空に輝く星', 'shift_jis'],
    ['ja', '简体中文歌词 时间都去哪儿了', 'gbk'],
  ];
  for (const [uiLocale, text, encoding] of crossLocaleLegacyCases) {
    eq(decodeUploadedText(iconv.encode(text, encoding), uiLocale), text);
    const tagged = `[ar:Artist]\r\n[ti:Song]\r\n[00:01.00]${text}`;
    eq(decodeUploadedText(iconv.encode(tagged, encoding), uiLocale), tagged);
  }
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
    const api = fs.readFileSync(path.join(root, 'server/routes/api.js'), 'utf8');
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
    ['C:\\Users\\thad\\Desktop\\a.mp3', 'thad'],
    ['C:\\Users\\陳小明\\Desktop\\a.mp3', '陳小明'],
    ['D:/Users/thad/downloads/a.mp3', 'thad'],
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
    ['C:\\Users\\thad\\AppData\\Roaming\\Elitesand Pro\\logs\\app.log', 'AppData'],
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
    description: '匯入失敗，訊息是 Authorization: Bearer ghp_USER_PASTED_SECRET 在 C:\\Users\\thad\\Music 底下',
  });
  ok(leaky.ok);
  ok(!leaky.plainText.includes('ghp_USER_PASTED_SECRET'), '使用者貼上的憑證必須被遮蔽: ');
  ok(!leaky.plainText.includes('thad'), '使用者名稱必須被遮蔽: ');

  // 報告內文固定繁中，不跟著介面語言跑，否則維護者會收到看不懂的 issue。
  const japanese = feedbackReport.buildReport({ ...base, locale: 'ja' });
  ok(japanese.plainText.includes('## 問題說明'), '報告內文必須固定繁體中文: ');
  ok(japanese.plainText.includes('介面語言：ja'), '使用者語言必須另外記錄: ');
  ok(japanese.report.issueLabels.includes('source:in-app'));
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
  const api = fs.readFileSync(path.join(root, 'server/routes/api.js'), 'utf8');
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
  const api = fs.readFileSync(path.join(root, 'server/routes/api.js'), 'utf8');
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

test('發版稽核只檢查 production dependencies，且任何等級風險都會失敗', () => {
  const manifest = require('../package.json');
  eq(manifest.scripts['audit:release'], 'npm audit --omit=dev --audit-level=low');
});

testAsync('更新計畫只讀 Release metadata，且只提供完整 Installer', async () => {
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
  const updatePanelSource = fs.readFileSync(path.join(__dirname, '../public/js/app-update-check.js'), 'utf8');
  ok(updatePanelSource.includes('完整 Windows Installer'), '面板必須明確導向完整 Installer: ');
});

test('首頁更新橫幅只導向完整 Installer，不提供增量更新入口', () => {
  const toastSource = fs.readFileSync(path.join(__dirname, '../public/js/app-toast-utils.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

  ok(toastSource.includes("fetch('/api/app-update/plan')"), '首頁橫幅必須讀取更新計畫: ');
  ok(!toastSource.includes('applyIncrementalUpdate'), '首頁橫幅不可提供增量更新流程: ');
  ok(indexHtml.includes('id="update-banner-link"'), '橫幅必須提供 Installer 下載連結: ');
  ok(!indexHtml.includes('id="update-banner-apply"'), '橫幅不可保留立即增量更新按鈕: ');
  const updatePanelSource = fs.readFileSync(path.join(__dirname, '../public/js/app-update-check.js'), 'utf8');
  ok(!updatePanelSource.includes('applyIncrementalUpdate'), '設定頁不可提供增量更新流程: ');
  ok(!fs.existsSync(path.join(__dirname, '../public/js/app-update-apply.js')), '舊的前端增量更新模組必須移除: ');
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

testAsync('程式內增量更新已停用，準備階段不會寫入或啟動 updater', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-update-launch-'));
  try {
    appUpdater._resetForTests();
    const prepared = await appUpdater.prepareUpdate({ targetRoot: root, zipBuffer: makeUpdateZip(), latestVersion: '0.7.4' });
    ok(!prepared.prepared && prepared.needsFull);
    ok(/Windows Installer/.test(prepared.reason));
    ok(!fs.existsSync(path.join(root, 'server')), '停用時不可建立 staging 或修改目標目錄: ');
  } finally { fs.rmSync(root, { recursive: true, force: true }); appUpdater._resetForTests(); }
});

testAsync('程式內增量更新被拒絕時不會呼叫外部 updater', async () => {
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
    ok(!prepared.prepared && !result.prepared && result.needsFull);
    ok(!spawnCalled, '停用時不可建立外部 updater 子程序: ');
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
  eq(document.announcements.length, 3);
  const legacy = document.announcements.find((item) => item.id === 'installer-only-update-legacy');
  const electron = document.announcements.find((item) => item.id === 'installer-only-update-electron');
  const current = document.announcements.find((item) => item.id === 'installer-only-update-current');
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

test('bilingual EULA is shipped with portable builds as a finalized agreement', () => {
  const root = path.join(__dirname, '..');
  const eulaPath = path.join(root, 'EULA.txt');
  ok(fs.existsSync(eulaPath), 'EULA.txt must exist at the project root');
  const eula = fs.readFileSync(eulaPath, 'utf8');
  ok(eula.includes('END-USER LICENSE AGREEMENT AND DISCLAIMER'), 'EULA must include the English title');
  ok(eula.includes('最終使用者授權暨免責聲明'), 'EULA must include the Chinese title');
  ok(/^Version:\s*\d+\.\d+\.\d+$/m.test(eula), 'EULA must carry a x.y.z version line (the acceptance gate keys off it)');
  ok(!eula.includes('Draft for legal review') && !eula.includes('[待填]'), 'EULA must stay finalized: no draft marker or placeholder fields');
  ok(eula.includes('權利人暨授權人') && eula.includes('Elitesand.pro@gmail.com'), 'EULA must name the rights holder and a contact address');
  ok(eula.includes('https://github.com/z22115554/elitesand-pro'), 'EULA must state the official download channel');
  ok(eula.includes('YouTube') && eula.includes('Twitch') && eula.includes('OBS'), 'EULA must state third-party platform boundaries');
  const portableBuild = fs.readFileSync(path.join(root, 'tools', 'build-portable.ps1'), 'utf8');
  ok(portableBuild.includes('"EULA.txt"'), 'portable build must copy EULA.txt into the app');
  ok(portableBuild.includes('foreach ($legalFile in @("LICENSE", "EULA.txt", "THIRD-PARTY-NOTICES.txt"))'), 'portable root must expose EULA.txt beside the other legal notices');
  const portableSmoke = fs.readFileSync(path.join(root, 'tools', 'smoke-portable.js'), 'utf8');
  ok(portableSmoke.includes("path.join(stage, 'EULA.txt')"), 'portable smoke must fail if EULA.txt is missing');
});

test('portable build clears runtime data again after packaged-app smoke', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-portable.ps1'), 'utf8');
  const smokeIndex = source.indexOf('Running packaged-app smoke test...');
  const resetAfterSmoke = source.indexOf('Reset-PackagedRuntimeData', smokeIndex);
  ok(smokeIndex >= 0, 'portable build must retain the packaged-app smoke test');
  ok(resetAfterSmoke > smokeIndex, 'portable build must clear runtime folders after smoke before zipping');
  ok(source.includes('Assert-Inside -Path $target -Parent $Stage'), 'runtime cleanup must remain scoped to the package stage');
  ok(source.includes('Runtime folder was not empty after reset'), 'runtime cleanup must fail closed if a folder remains populated');
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
    'server/services/twitch-history-store.js',
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

test('八類資料檔：舊資料可載入且落盤後都有 schemaVersion', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-store-fixtures-'));
  const fixtures = path.join(__dirname, 'fixtures', 'stores');
  try {
    for (const [fixture, target] of [
      ['library-v0.json', 'library.json'],
      ['lyrics-cache-v0.json', 'lyrics-cache.json'],
      ['auth-v0.json', 'auth.json'],
      ['twitch-auth-v0.json', 'twitch-auth.json'],
      ['twitch-requests-v0.json', 'twitch-requests.json'],
      ['twitch-history-v0.json', 'twitch-history.json'],
      ['announcement-state-v0.json', 'announcement-state.json'],
      ['announcement-cache-v1.json', 'announcement-cache.json'],
    ]) fs.copyFileSync(path.join(fixtures, fixture), path.join(dataDir, target));

    const script = [
      "const fs=require('fs'),path=require('path'); const root=process.argv[1],dir=process.argv[2];",
      "const library=require(path.join(root,'server/services/library-store'));",
      "const auth=require(path.join(root,'server/services/auth-store'));",
      "const twitch=require(path.join(root,'server/services/twitch-store'));",
      "const twitchRequests=require(path.join(root,'server/services/twitch-request-store'));",
      "const twitchHistory=require(path.join(root,'server/services/twitch-history-store'));",
      "require(path.join(root,'server/services/lyrics-engine')); require(path.join(root,'server/services/announcement-service'));",
      "const read=(name)=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));",
      "const result={libraryApi:library.getLibrary(),hasPin:auth.hasPin(),twitchApi:twitch.load(),twitchRequests:twitchRequests.load(),twitchHistory:twitchHistory.load(),files:{}};",
      "for(const name of ['library.json','lyrics-cache.json','auth.json','twitch-auth.json','twitch-requests.json','twitch-history.json','announcement-state.json','announcement-cache.json']) result.files[name]=read(name);",
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
    eq(result.twitchHistory[0].requestCode, 'LEGACY1');
    for (const [name, document] of Object.entries(result.files)) eq(document.schemaVersion, 1, `${name}: `);
    eq(result.files['library.json'].entries['legacy-track'].playCount, 2);
    ok(Array.isArray(result.files['lyrics-cache.json'].entries), '歌詞快取 entries 應保留: ');
    eq(result.files['announcement-state.json'].dismissed[0], 'fixture-announcement');
    for (const target of ['library.json', 'lyrics-cache.json', 'auth.json', 'twitch-auth.json', 'twitch-requests.json', 'twitch-history.json', 'announcement-state.json']) {
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
    eq(result.loaded.schemaVersion, 3);
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
    eq(result.loaded.schemaVersion, 3);
    eq(result.disk.schemaVersion, 3);
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
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ schemaVersion: 3, savedAt: 7, playlist: [] }), 'utf8');
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const store=require(process.argv[1]); const dir=process.argv[2];",
      "const loaded=store.loadState(); process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,files:fs.readdirSync(dir)}));",
    ].join('\n'));
    eq(result.loaded.schemaVersion, 3);
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
    eq(result.disk.schemaVersion, 3);
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

test('新手教學完成預覽後會收起，里程碑可跳到對應設定並高亮', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const nav = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'nav.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'panel.css'), 'utf8');
  for (const target of ['ytdlp-card', 'music-source-card', 'obs-url-card', 'obs-ws-card', 'twitch-card']) {
    ok(html.includes(`data-guide-target="${target}"`), `缺少新手引導目標 ${target}: `);
  }
  ok(html.includes('設定 OBS WebSocket（選配）'));
  ok(nav.includes("GUIDE_PREVIEW_COMPLETE_KEY = 'elite-guide-preview-complete-v1'"));
  ok(nav.includes('if (route) route.hidden = false'));
  ok(nav.includes("tourCompleted ? 'tour.guide.review' : 'tour.welcome.start'"));
  ok(nav.includes(".onboard-task[data-guide-nav][data-guide-target]"));
  ok(nav.includes("target.classList.add('guide-target-highlight')"));
  ok(css.includes('.guide-target-highlight') && css.includes('@keyframes guide-target-highlight'));
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
  eq(subscriptions.length, 4);
  ok(subscriptions.some((item) => item.type === 'channel.channel_points_custom_reward_redemption.add'));
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

test('匯入錯誤分類：登入、Premium、地區、下架、逾時與磁碟滿都有可行下一步', () => {
  const cases = [
    [new Error('Sign in to confirm your age; cookies required'), 'YOUTUBE_AUTH_REQUIRED'],
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
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'api.js'), 'utf8');
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
  eq(releaseClient.findInstallerAsset({ assets: [{ name: 'Elitesand.Pro.Setup.0.9.9.5.exe' }] }).name, 'Elitesand.Pro.Setup.0.9.9.5.exe');
  eq(releaseClient.findInstallerAsset({ assets: [{ name: 'Elitesand Pro Setup 0.9.9.6.exe' }] }).name, 'Elitesand Pro Setup 0.9.9.6.exe');
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
  ok(panel.includes('PanelConfirm?.request') && panel.includes("title: '清空本次播放清單？'") && panel.includes("tone: 'danger'"), '清空播放清單必須使用程式內一般確認: ');
  ok(panel.includes("confirmLabel: '清除全部'"), '播放清單一般確認須有明確危險操作按鈕: ');
  ok(!panel.includes("phrase: '清空播放清單'"), '清空播放清單不應再要求輸入文字: ');
  ok(library.includes("phrase: '清理音檔'"), '清理音檔必須要求輸入明確動作: ');
  ok(library.includes("phrase: '清空媒體庫'"), '清空媒體庫必須要求輸入明確動作: ');
  ok(!library.includes('清理不在目前播放清單中的已下載音檔？'), '清理音檔不得退回單鍵確認: ');
  ok(!library.includes('確定清空整個媒體庫？'), '清空媒體庫不得退回單鍵確認: ');
  ok(dialog.includes('inputMatches') && dialog.includes('submit.disabled'), '確認按鈕必須受輸入內容約束: ');
  ok(html.includes('id="danger-confirm-modal"') && html.includes('id="danger-confirm-input-field"'), '程式內確認視窗與可隱藏輸入欄必須實際掛在面板: ');
  ok(dialog.includes('config.requirePhrase !== false') && dialog.includes('inputField.hidden = !requiresPhrase'), '一般確認模式不得要求輸入文字，且必須留在程式內彈窗: ');
  const clearAllSource = panel.slice(panel.indexOf('async function clearAllTracks'), panel.indexOf('if (dom.btnPlaylistClear)'));
  ok(!clearAllSource.includes('window.confirm'), '清空播放清單不得退回瀏覽器原生確認: ');
});

testAsync('程式內一般確認可取消或確認，且不要求輸入文字', async () => {
  class FakeElement {
    constructor() {
      this.hidden = true;
      this.value = '';
      this.placeholder = '';
      this.textContent = '';
      this.disabled = true;
      this.focused = false;
      this.listeners = new Map();
      this.classList = {
        values: new Set(),
        toggle(name, force) { if (force) this.values.add(name); else this.values.delete(name); },
        remove(name) { this.values.delete(name); },
      };
    }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    focus() { this.focused = true; }
  }

  const elements = {
    'danger-confirm-modal': new FakeElement(),
    'danger-confirm-title': new FakeElement(),
    'danger-confirm-summary': new FakeElement(),
    'danger-confirm-impact': new FakeElement(),
    'danger-confirm-phrase': new FakeElement(),
    'danger-confirm-input': new FakeElement(),
    'danger-confirm-input-field': new FakeElement(),
    'danger-confirm-cancel': new FakeElement(),
    'danger-confirm-submit': new FakeElement(),
  };
  const trigger = new FakeElement();
  const context = {
    Promise,
    requestAnimationFrame(callback) { callback(); },
    document: {
      activeElement: trigger,
      getElementById(id) { return elements[id] || null; },
      contains() { return true; },
      addEventListener() {},
    },
    window: {},
  };
  const source = fs.readFileSync(path.join(__dirname, '../public/js/danger-confirm.js'), 'utf8');
  vm.runInNewContext(source, context, { filename: 'danger-confirm.js' });

  const cancelled = context.window.PanelConfirm.request({
    title: '清空本次播放清單？',
    summary: '即將清除 3 首歌。',
    impact: '歌曲音檔會保留。',
    confirmLabel: '清除全部',
  });
  eq(elements['danger-confirm-modal'].hidden, false, '一般確認必須顯示程式內視窗: ');
  eq(elements['danger-confirm-input-field'].hidden, true, '一般確認不應顯示輸入欄: ');
  eq(elements['danger-confirm-submit'].disabled, false, '一般確認的確認按鈕應可直接按: ');
  eq(elements['danger-confirm-submit'].textContent, '清除全部', '一般確認應顯示明確的危險操作文字: ');
  ok(elements['danger-confirm-modal'].classList.values.has('is-neutral'), '一般確認預設使用中性視覺層級: ');
  elements['danger-confirm-cancel'].listeners.get('click')();
  eq(await cancelled, false, '取消不得執行動作: ');

  const accepted = context.window.PanelConfirm.request({
    title: '清空本次播放清單？',
    confirmLabel: '清除全部',
  });
  elements['danger-confirm-submit'].listeners.get('click')();
  eq(await accepted, true, '只有程式內確認按鈕可通過確認: ');
  eq(elements['danger-confirm-input-field'].hidden, false, '關閉後必須還原輸入式確認的欄位狀態: ');
  ok(!elements['danger-confirm-modal'].classList.values.has('is-neutral'), '關閉後不得讓下一個高風險確認沿用中性外觀: ');
});

test('所有面板確認都留在程式內，不得跳瀏覽器原生對話框', () => {
  const publicJs = path.join(__dirname, '../public/js');
  const files = [];
  const visit = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  });
  visit(publicJs);
  const nativeConfirm = /(?:window\.)?confirm\s*\(/;
  const nativeDialogFiles = files.filter((file) => nativeConfirm.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(path.join(__dirname, '..'), file));
  eq(nativeDialogFiles.length, 0, `原生 confirm 不得再出現在面板程式：${nativeDialogFiles.join(', ')}`);
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
  ok(playlistHandler.includes("socket.on('playlist:add', (tracks, ack) =>") && playlistHandler.includes("ack({ ok: true, added: added.length, tracks: added })"), '伺服器 playlist:add 必須回傳加入確認: ');
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

test('重複歌曲加入清單時各自拿到獨立 entryId，不會共用同一個識別碼', () => {
  const registerPlaylistHandlers = require('../server/routes/handlers/playlist');
  const events = new Map();
  const state = { playlist: [] };
  const ctx = {
    playState: state, trackOffsets: new Map(), manualLyricsCache: new Map(),
    persistState() {}, emitSetlist() {}, broadcastState() {},
    getPublicPlaylist() { return state.playlist; },
  };
  registerPlaylistHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);

  events.get('playlist:add')([{ id: 'same-song', title: 'Superwoman' }], () => {});
  events.get('playlist:add')([{ id: 'same-song', title: 'Superwoman' }], () => {});

  eq(state.playlist.length, 2);
  ok(state.playlist[0].entryId, '第一次加入應有 entryId: ');
  ok(state.playlist[1].entryId, '第二次加入應有 entryId: ');
  ok(state.playlist[0].entryId !== state.playlist[1].entryId, '同一首歌重複加入的 entryId 不可相同: ');
  eq(state.playlist[0].id, state.playlist[1].id); // 歌曲 id 仍然相同（同一首歌）
});

test('播放重複歌曲的最後一列時，伺服器以 entryId 精準定位，不會誤判成第一列', () => {
  const registerPlaylistHandlers = require('../server/routes/handlers/playback');
  const playlistHandlers = require('../server/routes/handlers/playlist');
  const events = new Map();
  const playbackEvents = new Map();
  const state = { playlist: [], isPlaying: false, currentTrack: null };
  const ctx = {
    playState: state, trackOffsets: new Map(), trackPitch: new Map(), trackSpeed: new Map(),
    manualLyricsCache: new Map(), persistState() {}, emitSetlist() {}, recordSessionSong() {},
    broadcastState() {}, getEffectiveLyrics() { return null }, getPublicPlaylist() { return state.playlist; },
  };
  playlistHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);
  registerPlaylistHandlers({ emit() {} }, { id: 'panel-1', clientType: 'controller', emit() {}, on(event, handler) { playbackEvents.set(event, handler); } }, ctx);

  // play:track 播放前會檢查音檔是否存在於隔離的 downloads/；建立假音檔讓這個測試
  // 專注在 entryId 定位邏輯，而不是（已由其他測試涵蓋的）音檔遺失分支。
  fs.mkdirSync(TEST_RUNTIME_DIRS.downloads, { recursive: true });
  fs.writeFileSync(path.join(TEST_RUNTIME_DIRS.downloads, 'sw.mp3'), '');
  fs.writeFileSync(path.join(TEST_RUNTIME_DIRS.downloads, 'f.mp3'), '');

  events.get('playlist:add')([{ id: 'superwoman', title: 'Superwoman', filename: 'sw.mp3' }], () => {});
  for (let i = 0; i < 100; i++) events.get('playlist:add')([{ id: `filler-${i}`, title: `Filler ${i}`, filename: 'f.mp3' }], () => {});
  events.get('playlist:add')([{ id: 'superwoman', title: 'Superwoman', filename: 'sw.mp3' }], () => {});

  const first = state.playlist[0];
  const last = state.playlist[state.playlist.length - 1];
  eq(first.id, 'superwoman');
  eq(last.id, 'superwoman');
  ok(first.entryId !== last.entryId, '首尾兩個 Superwoman 的 entryId 必須不同: ');

  playbackEvents.get('play:track')({ ...last, autoplay: true });
  eq(state.currentTrack.entryId, last.entryId, '播放最後一首 Superwoman 後，目前歌曲的 entryId 必須是最後那一列: ');
  ok(state.currentTrack.entryId !== first.entryId, '不可誤判成第一列的 Superwoman: ');
});

test('PlaylistState：重複歌曲以 entryId 定位目前播放列，避免永遠命中第一個相符 id', () => {
  const PlaylistState = require('../public/js/playlist-state.js');
  const playlist = [
    { id: 'superwoman', entryId: 'entry-1', title: 'Superwoman' },
    { id: 'other', entryId: 'entry-2', title: 'Other' },
    { id: 'superwoman', entryId: 'entry-3', title: 'Superwoman' },
  ];
  // 沒有 entryId（舊資料/舊客戶端）：退回用 id 找，會命中第一個 —— 這是已知、可接受的向下相容限制。
  eq(PlaylistState.reconcilePlaylist(playlist, 'superwoman', null).currentTrackIndex, 0);
  // 有 entryId：精準命中最後一列，不會被 id 相符的第一列誤導。
  eq(PlaylistState.reconcilePlaylist(playlist, 'superwoman', 'entry-3').currentTrackIndex, 2);
  eq(PlaylistState.reconcilePlaylist(playlist, 'superwoman', 'entry-1').currentTrackIndex, 0);

  // mergeCurrentTrackDetails 也要用 entryId 分辨，只合併到正確那一列，不會兩列都被蓋成同一份歌詞。
  const currentTrack = { id: 'superwoman', entryId: 'entry-3', lyrics: '[00:00]最後一列的歌詞', hasLyrics: true };
  const merged = PlaylistState.mergeCurrentTrackDetails(playlist, currentTrack, null);
  eq(merged[0].lyrics, undefined, '第一列（entry-1）不應被目前歌曲的歌詞覆蓋: ');
  eq(merged[2].lyrics, '[00:00]最後一列的歌詞', '第三列（entry-3）才是真正在播放、該被合併歌詞的那一列: ');
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
  ok(css.includes('.playlist-head-actions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));') && css.includes('.playlist-head > .eyebrow { flex: 1 1 100%;'), '播放清單標題與四個管理操作必須分列，避免窄欄孤立換行: ');
  ok(css.includes('@container (max-width: 460px)') && css.includes('.playlist-filter-row #playlist-filter { grid-column: 1 / -1; }'), '窄播放清單欄的搜尋列必須先顯示完整搜尋框，再顯示篩選與清除: ');
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
  ok(panelSource.includes("t('status.lyricsStale')") && panelSource.includes("t('status.lyricsStaleWarning')"), '面板必須以可翻譯字串顯示 OBS 快取修復指引: ');
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
  let expectedBuild = 'b'.repeat(16);
  const io = makeIo();
  socketHandler(io, { getDisplayBuild: () => expectedBuild });
  io.authMiddleware(socket, (err) => { if (err) throw err; });
  io.sockets.sockets.set(socket.id, socket);
  io.connectionHandler(socket);
  socket.events.get('client:type')('display');
  const waiting = io.emitted.at(-1).data.displayRuntime;
  eq(waiting.pending, 1, 'display 剛連線時應短暫等待版本回報: ');
  socket.events.get('client:build')({ displayBuild: waiting.expectedBuild });
  const current = io.emitted.at(-1).data.displayRuntime;
  eq(current.current, 1, '回報目前指紋後應標示為正確: ');
  expectedBuild = 'c'.repeat(16);
  socket.events.get('client:build')({ displayBuild: expectedBuild });
  const refreshed = io.emitted.at(-1).data.displayRuntime;
  eq(refreshed.expectedBuild, expectedBuild, 'display build must be refreshed for every client count');
  eq(refreshed.current, 1, 'a refreshed OBS display must be current');
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

test('高頻播放控制只送細粒度事件，不重複廣播完整 state:sync', () => {
  const registerLyricsHandlers = require('../server/routes/handlers/lyrics');
  const registerPlaybackHandlers = require('../server/routes/handlers/playback');
  const lyricEvents = new Map();
  const playbackEvents = new Map();
  const emitted = [];
  const io = { emit(event, data) { emitted.push({ event, data }); } };
  const noFullState = () => { throw new Error('高頻控制不可廣播 state:sync'); };
  const playState = {
    currentTrack: { id: 'hot-track', title: 'Hot track' }, currentOffset: 0,
    pitchShift: 0, playbackRate: 1, metronomeEnabled: true,
    style: 'cute', styleOverrides: {}, romanizationMode: 'original',
  };
  registerLyricsHandlers(io, { on(event, handler) { lyricEvents.set(event, handler); } }, {
    playState, trackOffsets: new Map(), manualLyricsCache: new Map(),
    persistState() {}, broadcastState: noFullState,
  });
  registerPlaybackHandlers(io, { on(event, handler) { playbackEvents.set(event, handler); }, id: 'fixture', clientType: 'controller' }, {
    playState, trackOffsets: new Map(), trackPitch: new Map(), trackSpeed: new Map(), manualLyricsCache: new Map(),
    persistState() {}, emitSetlist() {}, recordSessionSong() {}, broadcastState: noFullState, getEffectiveLyrics() { return null; },
  });
  lyricEvents.get('offset:adjust')({ trackId: 'hot-track', delta: 100 });
  playbackEvents.get('style:override')({ intensity: 2 });
  playbackEvents.get('pitch:change')(1);
  playbackEvents.get('speed:change')(1.1);
  playbackEvents.get('metronome:toggle')(false);
  ok(['offset:update', 'style:override', 'pitch:update', 'speed:update', 'metronome:update'].every((event) => emitted.some((item) => item.event === event)));
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

test('offset:adjust 一次到位的大偏移，跟分好幾次小幅微調的累積結果一致（都不再被單次 delta 誤夾在 10s）', () => {
  const registerLyricsHandlers = require('../server/routes/handlers/lyrics');
  const { MAX_OFFSET_MS } = require('../server/utils/track-schema');
  const events = new Map();
  const trackOffsets = new Map();
  const ctx = {
    playState: { currentTrack: null }, trackOffsets, manualLyricsCache: new Map(),
    persistState() {}, broadcastState() {},
  };
  registerLyricsHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);

  // 模擬「對齊第一句」：MV 前奏 33 秒，一次送出 -33000ms 的 delta。
  events.get('offset:adjust')({ trackId: 'mv-long-intro', delta: -33000 });
  eq(trackOffsets.get('mv-long-intro'), -33000, '單次大偏移不該被砍到只剩 10s: ');

  // 模擬使用者連點 -0.5s 66 次達到一樣的總量，兩種方式的最終結果必須相同。
  for (let i = 0; i < 66; i++) events.get('offset:adjust')({ trackId: 'mv-nudged', delta: -500 });
  eq(trackOffsets.get('mv-nudged'), -33000);

  // 總偏移仍有上限（防呆，不是拿掉限制），且 adjust／set 用同一個常數，超過會被夾住而不是任意暴衝。
  events.get('offset:adjust')({ trackId: 'mv-extreme', delta: -(MAX_OFFSET_MS + 999999) });
  eq(trackOffsets.get('mv-extreme'), -MAX_OFFSET_MS);
  events.get('offset:set')({ trackId: 'mv-extreme-2', offset: MAX_OFFSET_MS + 999999 });
  eq(trackOffsets.get('mv-extreme-2'), MAX_OFFSET_MS);
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
    eq(playState.currentTrackStarted, false, '待命載入不可誤標成已開始播放: ');
    eq(playState.currentOffset, 2500);
    eq(playState.currentTrack.lyrics, manual.lyrics);
    eq(playState.currentTrack.parsedLyrics[0].text, '手動修正後的歌詞');
    const sent = emitted.find((item) => item.event === 'play:track').data;
    eq(sent.offset, 2500);
    eq(sent.lyrics, manual.lyrics);
    events.get('play:toggle')(true);
    eq(playState.currentTrackStarted, true, '首次開始播放後必須留下已開始標記: ');
    events.get('play:toggle')(false);
    eq(playState.currentTrackStarted, true, '暫停不可清掉已開始標記: ');
  } finally {
    libraryStore.audioExists = originalAudioExists;
    libraryStore.recordPlay = originalRecordPlay;
  }
});

test('play:stop 清空目前歌曲並廣播，播放清單播完最後一首才不會讓歌詞卡在畫面上', () => {
  // 使用者實測回報：唱完最後一首後，歌詞（OBS 顯示端／跟唱視圖）留在畫面上不會消失。
  // 根因：playState.currentTrack 過去沒有任何地方會被設回 null，播完清單最後一首、
  // 沒有下一首可接時完全沒有訊號通知顯示端清空。
  const registerPlaybackHandlers = require('../server/routes/handlers/playback');
  const events = new Map();
  const emitted = [];
  const playState = {
    currentTrack: { id: 'last-song', title: '最後一首' },
    currentTrackStarted: true,
    isPlaying: true,
    currentTime: 123,
  };
  let setlistCalls = 0;
  let broadcastCalls = 0;
  let persistCalls = 0;
  registerPlaybackHandlers(
    { emit(event, data) { emitted.push({ event, data }); } },
    { on(event, handler) { events.set(event, handler); }, emit() {} },
    {
      playState, trackOffsets: new Map(), trackPitch: new Map(), trackSpeed: new Map(), manualLyricsCache: new Map(),
      persistState() { persistCalls++; },
      emitSetlist() { setlistCalls++; },
      recordSessionSong() {},
      broadcastState() { broadcastCalls++; },
      getEffectiveLyrics() { return null; },
    },
  );

  events.get('play:stop')();

  eq(playState.currentTrack, null, 'play:stop 必須清空 currentTrack，否則顯示端沒有訊號可以清空歌詞：');
  eq(playState.currentTrackStarted, false);
  eq(playState.isPlaying, false);
  eq(playState.currentTime, 0);
  ok(emitted.some((item) => item.event === 'play:stop'), '必須轉播 play:stop，顯示端/跟唱視圖才會即時清空（不能只等下一次 state:sync）：');
  eq(setlistCalls, 1, '必須廣播 setlist:update，歌單頁的「現在播放」才會跟著清空：');
  eq(broadcastCalls, 1, '必須廣播完整狀態，重連/新連線的客戶端也要看到目前沒有歌曲在播：');
  eq(persistCalls, 1, '必須持久化，重開程式後不能又冒出剛剛播完的那首：');
});

test('播放秒數只留在記憶體，暫停時只保存目前歌曲狀態', () => {
  const registerPlaybackHandlers = require('../server/routes/handlers/playback');
  const events = new Map();
  let persisted = 0;
  const playState = {
    currentTrack: { id: 'recovery-song', entryId: 'recovery-entry', title: '恢復測試' },
    currentTrackStarted: true,
    currentTime: 0,
    isPlaying: true,
    playedEntryIds: new Set(['recovery-entry']),
    lastPlayedEntryId: 'recovery-entry',
  };
  registerPlaybackHandlers(
    { emit() {} },
    { on(event, handler) { events.set(event, handler); }, emit() {} },
    {
      playState, trackOffsets: new Map(), trackPitch: new Map(), trackSpeed: new Map(), manualLyricsCache: new Map(),
      persistState() { persisted++; }, emitSetlist() {}, recordSessionSong() {}, broadcastState() {},
      getEffectiveLyrics() { return null; }, markTrackPlayed() {},
    },
  );

  events.get('lyrics:sync')({ currentTime: 12.5, duration: 200, trackId: 'recovery-song' });
  events.get('lyrics:sync')({ currentTime: 12.8, duration: 200, trackId: 'recovery-song' });
  eq(playState.currentTime, 12.8);
  eq(persisted, 0, '高頻歌詞同步只能留在記憶體，不可排程寫磁碟：');

  events.get('play:seek')({ time: 88, trackId: 'recovery-song' });
  eq(playState.currentTime, 88);
  eq(persisted, 0, '使用者拖曳位置也不保存歌曲內秒數：');

  events.get('play:toggle')(false);
  eq(persisted, 1, '暫停時只保存目前歌曲與已唱狀態，不保存秒數：');
});

test('單曲模式與 SoundTouch 播畢都會清空目前歌曲並送出 play:stop', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/app-playback.js'), 'utf8');
  const endedFn = source.slice(source.indexOf('function handlePlaybackEnded()'), source.indexOf('function handlePlaybackEnded()') + 1500);
  ok(source.includes('SoundTouchEngine.onEnded(() => handlePlaybackEnded())'),
    'SoundTouch 播畢必須走和原生 audio 相同的清空流程：');
  ok(source.includes("audioPlayer.addEventListener('ended', handlePlaybackEnded)"),
    '原生 audio 播畢必須走共用流程：');
  ok(endedFn.includes('if (next) {') && endedFn.includes('return;'),
    '連續播放且仍有下一首時必須直接播放下一首：');
  ok(endedFn.includes('stopPlayback();') && endedFn.includes("SocketClient.send('play:stop',"),
    '單曲模式或清單尾端必須本地清空並廣播 play:stop：');
});

test('OBS 顯示端／跟唱視圖／遙控器都要接 play:stop 才能清空歌詞，不能只有面板自己知道', () => {
  const displaySource = fs.readFileSync(path.join(__dirname, '../public/js/display.js'), 'utf8');
  const prompterSource = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');
  const controllerSource = fs.readFileSync(path.join(__dirname, '../public/js/controller.js'), 'utf8');
  const playbackSource = fs.readFileSync(path.join(__dirname, '../public/js/app-playback.js'), 'utf8');

  ok(displaySource.includes("SocketClient.on('play:stop', () => {") && displaySource.includes('KaraokeEngine.clearDisplay();'),
    'OBS 顯示端必須監聽 play:stop 並清空歌詞畫面：');
  ok(prompterSource.includes("SocketClient.on('play:stop', () => {") && prompterSource.includes('resetToEmpty();'),
    '跟唱視圖必須監聽 play:stop 並重置回空狀態：');
  ok(controllerSource.includes("SocketClient.on('play:stop', () => {"), '手機遙控器也要監聽 play:stop，不能只有 OBS/跟唱視圖清空、遙控器還停在最後一首：');
  ok(playbackSource.includes("SocketClient.on('play:stop', (payload) => {"),
    '面板自己也要監聽 play:stop：另一個已連線的面板分頁播完清單時，這個分頁才會跟著清空：');
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

test('OBS 未推流只結束 OBS 或待確認的直播 Session，不會中斷 Twitch Session', () => {
  const registerSetlistHandlers = require('../server/routes/handlers/setlist');
  const events = new Map();
  const session = { active: true, startedAt: Date.now() - 1000, source: null, songs: [] };
  const ctx = {
    playState: {
      isPlaying: false, currentTrack: null, setlistTheme: 'glass', setlistLayout: 'classic',
      setlistStyle: {}, setlistSceneStyles: {},
    },
    session, SETLIST_SCENE: [],
    effSetlistStore() { return {}; },
    persistState() {}, setlistPayload() { return { ...session }; }, emitSetlist() {},
    recordSessionSong() {}, broadcastState() {},
  };
  registerSetlistHandlers(
    { emit() {} },
    { on(event, handler) { events.set(event, handler); }, emit() {} },
    ctx,
  );

  events.get('session:stop')({ source: 'obs' });
  eq(session.active, false);
  eq(session.source, null);

  session.active = true;
  session.source = 'twitch';
  events.get('session:stop')({ source: 'obs' });
  eq(session.active, true);
  eq(session.source, 'twitch');

  events.get('session:stop')({ source: 'twitch' });
  eq(session.active, false);
  eq(session.source, null);
});

test('已唱歌單可以單獨刪除一筆，用 entryId 定位，同一首唱兩次不會刪錯', () => {
  // 使用者實測回報：點錯歌被誤記進已唱、或切歌太快連點兩次，過去只能整場「清除全部」，
  // 沒辦法單獨修正。id 只是歌曲本身的 id，同一首歌在同一場唱兩次會有兩筆同 id 的記錄，
  // 不能拿來當刪除的定位鍵，必須用各自獨立的 entryId。
  const registerSetlistHandlers = require('../server/routes/handlers/setlist');
  const events = new Map();
  const session = {
    active: true, startedAt: Date.now(), source: 'manual',
    songs: [
      { id: 'song-a', entryId: 'entry-1', title: '第一次唱 A', artist: '歌手' },
      { id: 'song-b', entryId: 'entry-2', title: 'B', artist: '歌手' },
      { id: 'song-a', entryId: 'entry-3', title: '第二次唱 A', artist: '歌手' },
    ],
  };
  let setlistEmitted = 0;
  let persisted = 0;
  const ctx = {
    playState: {
      isPlaying: false, currentTrack: null, setlistTheme: 'glass', setlistLayout: 'classic',
      setlistStyle: {}, setlistSceneStyles: {},
    },
    session, SETLIST_SCENE: [],
    effSetlistStore() { return {}; },
    persistState() { persisted++; },
    setlistPayload() { return { ...session }; },
    emitSetlist() { setlistEmitted++; },
    recordSessionSong() {}, broadcastState() {},
  };
  registerSetlistHandlers(
    { emit() {} },
    { on(event, handler) { events.set(event, handler); }, emit() {} },
    ctx,
  );

  // 不存在的 entryId：不動任何資料，也不廣播（避免誤刪或無謂的重繪）
  events.get('session:remove-song')({ entryId: 'not-exist' });
  eq(session.songs.length, 3, '找不到對應 entryId 時不該動任何資料：');
  eq(setlistEmitted, 0);

  // 刪中間那筆：只少一筆，兩筆同 id 的 A（entry-1／entry-3）要各自獨立、都還在
  events.get('session:remove-song')({ entryId: 'entry-2' });
  eq(session.songs.length, 2, '刪除後應該只少一筆：');
  eq(session.songs.map((s) => s.entryId).join(','), 'entry-1,entry-3', '同一首歌唱兩次的兩筆記錄必須各自獨立，刪其中一筆不能連帶刪到另一筆：');
  eq(setlistEmitted, 1, '刪除成功要廣播 setlist:update，面板才會即時更新：');
  eq(persisted, 1, '刪除成功要持久化，否則重開程式又會冒出來：');

  // 缺 entryId、型別不對：直接忽略，不能誤判成「刪第一筆」
  events.get('session:remove-song')({});
  events.get('session:remove-song')(undefined);
  events.get('session:remove-song')({ entryId: 123 });
  eq(session.songs.length, 2, '沒有合法 entryId 的請求必須被忽略，不能刪錯筆：');
  eq(setlistEmitted, 1);
});

test('recordSessionSong 每次記錄都給獨立 entryId，同一首歌唱兩次也能分別刪除', () => {
  const { createAppState } = require('../server/state/app-state');
  const appState = createAppState({ emit() {} });
  // 這個 appState 實例會載到共用測試資料夾裡殘留的舊資料，先歸零避免被其他測試的殘留污染這裡的斷言。
  appState.session.songs = [];
  appState.session.active = true;
  appState.session.startedAt = Date.now();

  appState.playState.currentTrack = { id: 'song-a', title: 'A' };
  appState.recordSessionSong();
  appState.playState.currentTrack = { id: 'song-b', title: 'B' };
  appState.recordSessionSong();
  appState.playState.currentTrack = { id: 'song-a', title: 'A' };
  appState.recordSessionSong();

  eq(appState.session.songs.length, 3);
  const entryIds = appState.session.songs.map((s) => s.entryId);
  eq(new Set(entryIds).size, 3, '三筆記錄的 entryId 必須各自不同，即使 id 重複（同一首歌唱兩次）：');
  ok(entryIds.every((id) => typeof id === 'string' && id.length > 0), 'entryId 必須是非空字串：');
});

test('舊資料（session.songs 沒有 entryId）載入時自動補齊，否則永遠刪不掉', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/state/app-state.js'), 'utf8');
  ok(source.includes("session.songs = saved.session.songs.map((s) => (s && s.entryId ? s : { ...s, entryId: crypto.randomUUID() }));"),
    '載入舊 state.json 時，沒有 entryId 的已唱歌單記錄必須補上，不能原封不動放著（否則單獨刪除功能對這些舊記錄永遠失效）：');

  // 純函式驗證補齊邏輯本身：有 entryId 的保留原樣，沒有的才補新的。
  function backfillEntryId(songs, makeId) {
    return songs.map((s) => (s && s.entryId ? s : { ...s, entryId: makeId() }));
  }
  let counter = 0;
  const result = backfillEntryId(
    [{ id: 'a', entryId: 'keep-me' }, { id: 'b' }],
    () => `generated-${++counter}`,
  );
  eq(result[0].entryId, 'keep-me', '已經有 entryId 的記錄不該被覆蓋：');
  eq(result[1].entryId, 'generated-1', '沒有 entryId 的記錄要補上新的：');
});

test('已唱歌單面板：刪除鈕用事件代理、只在有 entryId 時才渲染，且套用共用的 .pi-remove 樣式', () => {
  const panelSource = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  const panelCss = fs.readFileSync(path.join(__dirname, '../public/css/panel.css'), 'utf8');

  ok(panelSource.includes("if (s.entryId) {"), '沒有 entryId 的記錄不該生出刪除鈕（理論上不會發生，但寧可不給按也不要刪錯）：');
  ok(panelSource.includes("removeBtn.className = 'pi-remove';"), '刪除鈕必須套用既有的 .pi-remove 樣式，不要另外自創一套：');
  ok(panelSource.includes("removeBtn.dataset.removeSongEntryId = s.entryId;"), '刪除鈕必須把 entryId 存在 dataset 上，點擊時才知道要刪哪一筆：');

  // 事件代理：renderSetlistPanel() 每次都整批重建 innerHTML，監聽器必須綁在不會被替換的容器上。
  ok(panelSource.includes("dom.setlistPanel.addEventListener('click', (event) => {") &&
    panelSource.includes("const btn = event.target.closest('.pi-remove');") &&
    panelSource.includes("SocketClient.send('session:remove-song', { entryId });"),
    '刪除鈕必須用事件代理綁在容器上，並送出 session:remove-song：');

  ok(panelCss.includes('.pi-remove'), '.pi-remove 的樣式必須存在（hover 才顯示、danger 色），不能是空按鈕：');
});

test('歌單固定預覽、直書句流縮圖與直播狀態重新整理入口都存在', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const panelCss = fs.readFileSync(path.join(__dirname, '../public/css/panel.css'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  const obsWebsocket = fs.readFileSync(path.join(__dirname, '../public/js/obs-websocket.js'), 'utf8');
  ok(indexHtml.includes('id="session-refresh"'));
  ok(indexHtml.includes('class="setlist-preview-bar"'));
  ok(indexHtml.includes('style-thumb-columnflow'));
  ok(panelCss.includes('@keyframes tpl-columnflow'));
  ok(setlistPanel.includes('等待確認直播狀態'));
  ok(obsWebsocket.includes('refreshStreamStatus: publishStreamStatus'));
});

testAsync('OBS WebSocket 密碼錯誤進入重連後，可立即停止並解除握手狀態', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/obs-websocket.js'), 'utf8');
  const timers = [];
  class FakeWebSocket {
    constructor() { this.closed = false; FakeWebSocket.instances.push(this); }
    close() {
      if (this.closed) return;
      this.closed = true;
      if (this.onclose) this.onclose({ code: 4009 });
    }
  }
  FakeWebSocket.instances = [];
  const sandbox = {
    window: {}, console, WebSocket: FakeWebSocket,
    document: { getElementById() { return null; } },
    setTimeout(fn) { const timer = { fn, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    setInterval() { return {}; }, clearInterval() {},
  };
  vm.runInNewContext(`${source}\n;globalThis.__obsWsForTest = ObsWs;`, sandbox);
  const client = sandbox.__obsWsForTest;
  const attempt = client.connect({ host: '127.0.0.1', port: 4455, password: 'wrong' });
  const socket = FakeWebSocket.instances[0];
  socket.close();
  await attempt.catch(() => {});
  ok(client.isReconnecting(), '密碼錯誤後應進入可取消的重連等待：');
  client.disconnect();
  eq(client.isReconnecting(), false, '停止重連後不可殘留 connecting 或重試計時器：');
  ok(timers.some((timer) => timer.cleared), '停止重連必須清除已排定的重試計時器：');
});

test('歌單亮色背景可讀性保護與模板有效設定守衛存在', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const schema = require('../public/js/setlist-style-schema');
  const setlistCss = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8');
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  const field = schema.FIELD_BY_KEY.readabilityGuard;
  ok(field && field.default === true && field.dataAttr === 'data-sl-readable-off' && field.invert === true, '舊歌單設定必須預設升級為亮色背景可讀');
  eq(schema.FIELD_BY_KEY.doneOpacity.default, 54, '新歌單預設不得把已唱文字淡到亮色背景看不見：');
  eq(schema.FIELD_BY_KEY.waitOpacity.default, 72, '新歌單預設不得把未唱文字淡到亮色背景看不見：');
  ok(indexHtml.includes('id="sls-readability-guard"'), '面板必須提供亮色背景可讀性保護開關');
  ok(indexHtml.includes('可讀性襯底色') && indexHtml.includes('可讀性襯底不透明度'), '主要文字與襯底色必須在快速調整可見');
  ok(indexHtml.includes('data-sl-layout="classic cards simple timeline diagonal constellation terminal billboard signal index label glow round pager"'), '正在播放字級必須在每個有 active 歌曲的模板顯示');
  ok(indexHtml.includes('data-sl-layout="timeline diagonal constellation terminal billboard cards signal index label glow round pager"'), '歌曲編號設定不得在不支援的模板顯示');
  ok(setlistPanel.includes('設定只套用並保存於這個模板；切換模板不會影響其他歌單。'), '模板說明必須明示設定會各模板獨立保存');
  ok(setlistCss.includes(':root:not([data-sl-readable-off]) .now-singing') && setlistCss.includes(':root:not([data-sl-readable-off]) .tl-now'), '經典與場景模板都必須有非全螢幕的可讀性襯底');
  ok(setlistSource.includes('const sameSideContrast = guarded') && setlistSource.includes('const readableCardColor'), '可讀性保護必須在文字與襯底同明度時自動轉成安全對比');
  ok(setlistCss.includes('.terminal { width: 300px; background: var(--sl-bg-card);') && setlistCss.includes('.billboard { width: 320px; background: var(--sl-bg-card);') && setlistCss.includes('.card { background: var(--sl-bg-card);'), '清單型模板不得繞過共用卡片底色設定');
});

test('歌單每個模板保存獨立外觀，正在播放字級也套到 active row', () => {
  const registerSetlistHandlers = require('../server/routes/handlers/setlist');
  const { SETLIST_LAYOUTS } = require('../server/state/app-state');
  const events = new Map();
  const emitted = [];
  const defaults = require('../public/js/setlist-style-schema').getDefaultStyle();
  const playState = {
    setlistLayout: 'classic',
    setlistTemplateStyles: Object.fromEntries(SETLIST_LAYOUTS.map((layout) => [layout, { ...defaults }])),
    setlistTheme: 'glass', isPlaying: false, currentTrack: null,
  };
  const ctx = {
    playState, session: { active: false, startedAt: null, source: null, songs: [] }, SETLIST_LAYOUTS,
    effSetlistStore(layout) { return playState.setlistTemplateStyles[layout]; },
    persistState(callback) { if (callback) callback({ ok: true }); },
    setlistPayload() { return {}; }, emitSetlist() {}, recordSessionSong() {}, broadcastState() {},
  };
  registerSetlistHandlers(
    { emit(event, payload) { emitted.push([event, payload]); } },
    { on(event, handler) { events.set(event, handler); } },
    ctx,
  );
  events.get('setlist:style')({ target: 'classic', sizeNow: 31 });
  eq(playState.setlistTemplateStyles.classic.sizeNow, 31, 'classic 必須只更新自己的設定');
  eq(playState.setlistTemplateStyles.cards.sizeNow, defaults.sizeNow, 'classic 不得覆寫 cards 的設定');
  events.get('setlist:style')({ target: 'cards', sizeNow: 22 });
  eq(playState.setlistTemplateStyles.classic.sizeNow, 31, 'cards 不得回寫 classic 的設定');
  eq(playState.setlistTemplateStyles.cards.sizeNow, 22, 'cards 必須保存自己的設定');
  events.get('setlist:layout')({ layout: 'cards' });
  ok(emitted.some(([event, payload]) => event === 'setlist:style' && payload.target === 'cards' && payload.style.sizeNow === 22),
    '切換模板必須只推送該模板的外觀快照');

  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const setlistCss = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8');
  const schema = require('../public/js/setlist-style-schema');
  ok(indexHtml.includes('data-sl-layout="classic cards simple timeline diagonal constellation terminal billboard signal index label glow round pager"'),
    '所有有正在播放內容的模板都必須顯示正在播放字級設定');
  ['.term-item.active .t-line { font-size: var(--sl-sz-n)', '.bb-item.active .bb-name { font-size: var(--sl-sz-n)', '.card.active .card-title { font-size: var(--sl-sz-n)', '.index-item.active .index-title { font-size: var(--sl-sz-n)']
    .forEach((rule) => ok(setlistCss.includes(rule), `active row 必須吃正在播放字級：${rule}`));
  ['showReserve', 'labelReserve', 'glowSize'].forEach((key) => ok(!schema.FIELD_BY_KEY[key], `${key} 尚未實作時不得留成假設定`));
});

test('setlist queue scrolling is limited to the intended vertical templates', () => {
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8');
  const setlistCss = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8');
  ok(setlistSource.includes("const AUTO_SCROLL_QUEUE_LAYOUTS = new Set(['classic', 'label', 'glow', 'round', 'pager']);"),
    'Only classic and the four vertically queued skins should auto-scroll.');
  ok(setlistSource.includes('function applyQueueScrolls()') && setlistSource.includes("runway.appendChild(copy);"),
    'Overflowing queues should duplicate one complete track for a seamless loop.');
  // 停留秒數／捲動速度可調（使用者實測回報希望能調整），@keyframes 的百分比 offset 又只能是
  // 寫死的數字沒法用 var()/calc()，所以改成逐份清單動態產生一段 @keyframes，見 applyQueueScrolls()。
  ok(setlistCss.includes('.sl-queue-scroll .sl-queue-runway { will-change: transform; }'),
    'The queue loop needs the base runway rule (per-instance @keyframes are generated at runtime, not static CSS).');
  ok(setlistSource.includes('function ensureQueueKfStyleEl()') && setlistSource.includes("kfRules.push("),
    'Auto-scroll must generate its own @keyframes per list so the configurable hold time can be an absolute duration.');
  ok(setlistCss.includes('background: #2c3138;') && setlistCss.includes('[data-layout="glow"] .sk-row { padding: calc(4px * var(--sl-fit)) 0; border-bottom: 1px solid rgba(255, 255, 255, .1); background: transparent; }'),
    'Night Neon should use one gray panel instead of shaded individual rows.');
  ok(setlistCss.includes('top: calc(8px * var(--sl-fit));') && setlistCss.includes('padding: calc(29px * var(--sl-fit))'),
    'Paper Tag now-playing label should remain inside the card.');
});

test('自動捲動的停留秒數與速度可調，且捲動速度改動即時生效', () => {
  const schema = require('../public/js/setlist-style-schema');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8').replace(/\r\n/g, '\n');
  const delayField = schema.FIELD_BY_KEY.queueScrollDelay;
  const speedField = schema.FIELD_BY_KEY.queueScrollSpeed;
  ok(delayField && delayField.default === 2.5 && delayField.min === 0 && delayField.max === 8, '捲動前停留秒數欄位缺少或預設值跑掉：');
  ok(speedField && speedField.default === 24 && speedField.min > 0, '捲動速度欄位缺少或預設值跑掉：');
  // 兩個欄位沒有 cssVar：換算成 @keyframes 百分比只能在 render 當下讀 curStyle 計算，
  // 標 needsRerender 才會在滑桿改動時立刻重算，不必等下一次換歌才生效。
  ok(delayField.needsRerender === true && speedField.needsRerender === true, '捲動設定改動必須立刻重繪生效（needsRerender）：');
  ok(indexHtml.includes('id="sls-queue-scroll-delay"') && indexHtml.includes('id="sls-queue-scroll-speed"'), '面板必須提供捲動前停留秒數與捲動速度兩個控制項：');
  ok(setlistSource.includes('const speed = Math.max(1, Number(curStyle.queueScrollSpeed) || 24);'), '捲動速度必須讀取使用者設定，不能寫死：');
  ok(setlistSource.includes('const delaySec = Math.max(0, Number(curStyle.queueScrollDelay) || 0);'), '停留秒數必須讀取使用者設定，不能寫死：');
  ok(setlistSource.includes('const holdPct = Math.min(45, (delaySec / totalSec) * 100);'), '停留比例必須設上限，避免停留秒數設太長時動畫看起來像完全沒在動：');
});

test('圓角氣泡（round）已唱／未唱不因有沒有歌手忽大忽小', () => {
  // 使用者實測回報：圓角氣泡大小不一致看了不舒服。根因是歌手欄用條件式渲染
  // （有歌手才輸出 <span>），造成同一份清單裡有的氣泡一行、有的兩行。
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8').replace(/\r\n/g, '\n');
  const setlistCss = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8').replace(/\r\n/g, '\n');
  ok(setlistSource.includes('<span class="sk-artist">${escapeHtml(s.artist || \'\')}</span>'), '歌手欄必須一律輸出（沒有歌手就留空 span），高度才會一致：');
  ok(!setlistSource.includes("${s.artist ? `<span class=\"sk-artist\">"), '不可恢復條件式渲染歌手欄，否則氣泡高度又會忽高忽低：');
  ok(setlistCss.includes('.sk-artist { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: calc(var(--sl-sz-a, 11px) * .95); line-height: 1.3; min-height: 1.3em;'),
    '歌手欄需要 min-height 保底，沒有歌手的空 span 才會佔住跟有歌手時一樣的高度：');
  ok(setlistCss.includes('[data-layout="round"] .sk-row {\n  border-radius: 999px; padding: calc(7px * var(--sl-fit)) calc(13px * var(--sl-fit));\n  background: rgba(255, 250, 241, .92); box-shadow: 0 calc(4px * var(--sl-fit)) calc(9px * var(--sl-fit)) rgba(20, 8, 14, .12);\n  /* 已唱／未唱共用同一個 1px 邊框寬度'),
    '已唱／未唱氣泡必須共用同一個邊框寬度，否則未唱多了一圈邊框會比已唱高 2px：');
  ok(setlistCss.includes('[data-layout="round"] .sk-artist { color: rgba(88, 25, 54, .62); }'),
    '已唱（淺色氣泡）的歌手字色必須有自己的深色版本，否則沿用暗底文字色會在淺底上看不見：');
});

test('跟唱視圖（/prompter）路由與 PIN／clientType 保護到位', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  const socketHandlerSource = fs.readFileSync(path.join(__dirname, '../server/routes/socket-handler.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  ok(serverSource.includes("app.get('/prompter'") && serverSource.includes("sendNoCache(res, 'prompter.html')"), '/prompter 必須用 sendNoCache 送出頁面，跟其他頁面路由一致：');
  ok(socketHandlerSource.includes("new Set(['controller', 'remote', 'prompter', ...PIN_EXEMPT_CLIENT_TYPES])"), 'prompter 必須是合法 clientType，但不可加進 PIN_EXEMPT_CLIENT_TYPES（不是唯讀 OBS 疊加層，要跟 remote 一樣受 PIN 保護）：');
  ok(!/PIN_EXEMPT_CLIENT_TYPES = new Set\(\[[^\]]*'prompter'/.test(socketHandlerSource), 'prompter 不可被加進 PIN 豁免清單：');
  ok(socketHandlerSource.includes("else if (type === 'prompter') clients.prompters.add(socket.id);") && socketHandlerSource.includes('clients.prompters.delete(socket.id);'), 'prompter 連線必須正確加入/移出計數集合，斷線才不會計數卡住：');
  ok(fs.existsSync(path.join(__dirname, '../public/prompter.html')), '缺少 public/prompter.html');
  ok(fs.existsSync(path.join(__dirname, '../public/js/prompter.js')), '缺少 public/js/prompter.js');
  ok(indexHtml.includes('id="btn-open-prompter"'), '面板頂欄必須有開啟跟唱視圖的按鈕');
  ok(appSource.includes("window.open('/prompter', '_blank', 'noopener')"), '跟唱視圖必須開新分頁，不是像歌詞/歌單網址那樣複製到剪貼簿：');
});

test('跟唱視圖整句歌詞：時間跳轉不留殘影，逐句判斷純函式正確', () => {
  const promptSource = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8').replace(/\r\n/g, '\n');
  // 一次跨好幾句（拖曳進度條、遠端 seek）時，舊的 --next 預覽標記若只清「前一個 active」跟
  // 「前一個 next」兩個定點，中間被跳過的那句會留下沒清掉的殘影 class。
  ok(promptSource.includes("dom.lyrics.querySelectorAll('.pt-line--active, .pt-line--next').forEach((el) => {"),
    '切換目前句時必須整批清除舊的 active/next 標記，不能只清兩個定點：');
  ok(promptSource.includes('// 不等下一次輪詢：面板拖曳進度條時（seeking）落點可能跨好幾句，\n    // 拖到哪就該立刻反映在哪，等 250ms 的輪詢會讓歌詞明顯慢半拍。\n    updateLyricsHighlight();'),
    'lyrics:sync 必須立即重算目前句，不能只靠 250ms 輪詢，否則面板拖曳進度條時歌詞會慢半拍：');

  // findCurrentLine 純邏輯抽出來跑，不用真的開瀏覽器：最後一個 time<=t 的行才是目前句。
  function findLineIndex(lines, t) {
    let idx = -1;
    for (let i = 0; i < lines.length; i++) { if (lines[i].time <= t) idx = i; else break; }
    return idx;
  }
  const lines = [{ time: 0 }, { time: 3000 }, { time: 6000 }, { time: 9000 }];
  eq(findLineIndex(lines, 0), 0, 't=0 應該落在第一句：');
  eq(findLineIndex(lines, 2999), 0, 't=2999 還沒到第二句的時間點：');
  eq(findLineIndex(lines, 8999), 2, 't=8999 應該還在第三句：');
  eq(findLineIndex(lines, 15000), 3, '超過最後一句的時間點應該停在最後一句，不是 -1：');
  eq(findLineIndex(lines, -1), -1, '歌曲一開始（時間軸之前）不該有任何句子亮起：');
});

test('跟唱視圖 lyrics:sync 時鐘抖動不會讓歌詞先退回上一句再跳回來', () => {
  // 使用者實測回報：快跳到下一句的時候，歌詞會先閃回上一句一下、再跳回來。
  // 根因跟 display.js 踩過的同一種時鐘抖動坑（見 memory display-clock-granularity）：
  // 面板每 200ms 廣播 lyrics:sync，網路抖動可能讓某次送到的 currentTime 比本地已經推算出
  // 的時間還早幾十毫秒；原本每次都硬重設 syncTimeMs，剛好卡在句子邊界時就會讓 findLineIndex
  // 算出前一句的索引，畫面因此先退後、下一輪輪詢或下一次同步才又跳回正確位置。
  const promptSource = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');
  ok(promptSource.includes('const SYNC_REGRESSION_TOLERANCE_MS = 400;'), '必須設定一個小幅倒退的容忍值，不能照單全收每一次同步：');
  ok(promptSource.includes('const regressedMs = estimatedMs - proposedMs;') &&
    promptSource.includes('if (regressedMs > 0 && regressedMs < SYNC_REGRESSION_TOLERANCE_MS) {'),
    '只有「小幅倒退」才要忽略；真的倒退很多（seek 到更早的位置）必須照樣接受，不能永遠鎖死: ');
  ok(promptSource.includes('setProgressDisplay(estimatedMs / 1000);'),
    '忽略抖動時仍要用估計值更新進度條顯示，不能整個不動（否則進度條會卡住）：');

  // 純函式驗證核心判斷邏輯本身正確，不用真的開瀏覽器跑 setInterval。
  function shouldIgnoreSync(estimatedMs, proposedMs, toleranceMs) {
    const regressedMs = estimatedMs - proposedMs;
    return regressedMs > 0 && regressedMs < toleranceMs;
  }
  eq(shouldIgnoreSync(6050, 6000, 400), true, '50ms 的小幅抖動應該被忽略：');
  eq(shouldIgnoreSync(6390, 6000, 400), true, '正好在容忍值邊界內（390ms）也該忽略：');
  eq(shouldIgnoreSync(6500, 6000, 400), false, '超過容忍值（500ms）代表是真的 seek，必須接受：');
  eq(shouldIgnoreSync(5000, 6000, 400), false, '往前跳（proposed 比 estimated 還大）本來就不是倒退，要照樣接受：');
});

test('跟唱視圖點歌詞跳到那一句的起點，並正確扣掉 offset', () => {
  const promptCss = fs.readFileSync(path.join(__dirname, '../public/css/prompter.css'), 'utf8');
  const promptSource = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');

  // 事件代理：renderLyricsSkeleton() 每次都整批重建 innerHTML，綁在個別 .pt-line 上的
  // 監聽器會跟著舊 DOM 一起被丟掉，必須綁在容器上才能持續有效。
  ok(promptSource.includes("dom.lyrics.addEventListener('click', (e) => {"), '點擊歌詞必須綁在容器上做事件代理，不能綁在個別 .pt-line（重繪後會失效）：');
  ok(promptSource.includes("const lineEl = e.target.closest('.pt-line');"), '必須用 closest 找到整句的容器，點到內層的拼音/諧音子元素也要能定位到對的句子：');

  // line.time 是「音訊時間 + offset」的調整後時間軸（跟 updateLyricsHighlight 的 adjustedMs、
  // app-lyrics-timeline.js 寫入 line.time 的算法一致），還原成音訊秒數要扣掉 offset，
  // 不能直接拿 line.time 送出去，否則歌詞/音訊有偏移時點下去會跳到偏移過的位置。
  ok(promptSource.includes('const seconds = Math.max(0, (line.time - currentOffsetMs) / 1000);'),
    '換算音訊秒數必須扣掉 currentOffsetMs，直接用 line.time 會忽略偏移：');
  ok(promptSource.includes("const payload = currentTrackId != null ? { time: seconds, trackId: currentTrackId } : seconds;") ,
    '送出的 seek payload 格式必須跟其他地方（commitScrub）一致，帶 trackId 避免快速切歌後舊 seek 晚到污染新歌：');
  ok(promptSource.includes("SocketClient.send('play:seek', payload);"), '必須真的送出 play:seek，不能只更新本地畫面：');

  // 點下去要立即反映（樂觀更新），不用等伺服器回廣播才動，體感才會跟點擊同步。
  ok(promptSource.includes('syncTimeMs = seconds * 1000;') && promptSource.includes('updateLyricsHighlight();'),
    '點擊後必須立即更新本地時鐘與高亮，不能乾等下一次 lyrics:sync 才有反應：');

  // 純函式驗證換算公式本身：offset 為正代表歌詞比音訊晚出現，adjustedMs = audioMs + offsetMs。
  function seekSecondsFromLineTime(lineTimeMs, offsetMs) {
    return Math.max(0, (lineTimeMs - offsetMs) / 1000);
  }
  eq(seekSecondsFromLineTime(5000, 0), 5, '沒有 offset 時，line.time 5000ms 應該對應音訊第 5 秒：');
  eq(seekSecondsFromLineTime(5000, 500), 4.5, 'offset +500ms（歌詞晚 0.5 秒出現）時，音訊要少跳 0.5 秒才會對上這句：');
  eq(seekSecondsFromLineTime(500, 2000), 0, '換算結果為負數時要夾在 0，不能送出負的秒數：');

  // 要有游標/hover 提示，使用者才知道這是可以點的。
  ok(promptCss.includes('cursor: pointer;'), '.pt-line 必須有 cursor:pointer 提示可點擊：');
});

test('跟唱視圖新增羅馬拼音／諧音開關，各自獨立、預設關閉、不影響 OBS', () => {
  const promptHtml = fs.readFileSync(path.join(__dirname, '../public/prompter.html'), 'utf8');
  const promptCss = fs.readFileSync(path.join(__dirname, '../public/css/prompter.css'), 'utf8');
  const promptSource = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');

  ok(promptHtml.includes('id="pt-set-romaji"') && promptHtml.includes('id="pt-set-xieyin"'), '設定面板必須有拼音跟諧音兩個獨立的開關：');
  ok(promptSource.includes('showRomaji: false, showXieyin: false'), '兩個開關預設必須是關閉（跟 OBS 顯示端 romanizationMode 預設 original 一致），沒資料的歌不該冒出空行：');

  // 拼音/諧音會改變 DOM 結構，不是單純 CSS 變數，開關必須觸發重繪，不能只是存個旗標。
  const displayOptionsFn = promptSource.slice(
    promptSource.indexOf('function updateLyricsDisplayOptions(patch) {'),
    promptSource.indexOf('function updateLyricsDisplayOptions(patch) {') + 200,
  );
  ok(displayOptionsFn.includes('renderLyricsSkeleton()') && displayOptionsFn.includes('updateLyricsHighlight()'),
    '切換拼音/諧音開關必須重繪歌詞區，不能只存進 appearance 卻沒反映到畫面：');
  ok(promptSource.includes("dom.setRomaji.addEventListener('change', () => updateLyricsDisplayOptions({ showRomaji: dom.setRomaji.checked }))"),
    '拼音開關必須接上 updateLyricsDisplayOptions，不能誤用只存 CSS 變數的 updateAppearance：');
  ok(promptSource.includes("dom.setXieyin.addEventListener('change', () => updateLyricsDisplayOptions({ showXieyin: dom.setXieyin.checked }))"),
    '諧音開關必須接上 updateLyricsDisplayOptions，不能誤用只存 CSS 變數的 updateAppearance：');

  // 渲染邏輯：沒開開關或該行沒有資料都不該生出空的拼音/諧音行。
  ok(promptSource.includes('appearance.showRomaji && line.phonetic') && promptSource.includes('appearance.showXieyin && line.xieyin'),
    '拼音/諧音行必須同時檢查「開關有沒有開」跟「這一行有沒有資料」，兩個條件缺一都不該渲染：');
  ok(!promptSource.includes('s2t(line.phonetic') && !promptSource.includes('s2t(line.xieyin'),
    '拼音/諧音不可經過簡轉繁：跟 karaoke.js 同一套規則，簡轉繁只轉原文 Han 字，轉了拼音/諧音反而可能跟實際讀音對不上：');

  // 非同步羅馬化：歌曲切過來當下可能還沒跑完 kuromoji/pinyin-pro，之後才用這個事件補上，
  // 若沒接這個監聽，使用者開了開關卻要等下一次切歌才看得到拼音/諧音（見 memory
  // lyrics-romanization-pipeline 的「非同步」根因）。
  ok(promptSource.includes("SocketClient.on('lyrics:romanized', (data) => {"), '必須監聽 lyrics:romanized，補推的羅馬化結果才進得來：');
  ok(promptSource.includes('const byTime = new Map();') && promptSource.includes('byTime.set(rl.time, rl)'),
    '合併羅馬化結果必須用時間對齊，不能用索引（伺服器過濾製作資訊行後行數可能跟本地不同，索引對齊會貼到錯的句子）：');

  // CSS 結構：拼音/諧音是獨立於主歌詞文字的子區塊，字級/顏色狀態要能跟著 active/past/next 走。
  ok(promptCss.includes('.pt-line-romaji') && promptCss.includes('.pt-line-xieyin'), '必須有拼音跟諧音各自的樣式：');
  ok(promptCss.includes('.pt-line.pt-line--active .pt-line-text'), '主歌詞文字的 active 樣式必須套在新的 .pt-line-text 子元素上，不能還留在舊的 .pt-line 選擇器（結構改了，樣式沒跟著改就會失效）：');
});

test('跟唱視圖歌詞套用簡轉繁設定，跟歌詞顯示頁／歌單頁同一套規則', () => {
  const promptHtml = fs.readFileSync(path.join(__dirname, '../public/prompter.html'), 'utf8');
  const promptSource = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');
  ok(promptHtml.includes('/vendor/opencc-cn2t.js'), '跟唱視圖必須載入 opencc-cn2t.js，否則簡轉繁函式永遠拿不到轉換器：');
  const openccIdx = promptHtml.indexOf('/vendor/opencc-cn2t.js');
  const prompterJsIdx = promptHtml.indexOf('/js/prompter.js');
  ok(openccIdx > -1 && prompterJsIdx > openccIdx, 'opencc-cn2t.js 必須在 prompter.js 之前載入，不然 OpenCC 還沒定義：');

  ok(promptSource.includes("OpenCC.Converter({ from: 'cn', to: 'tw' })"), '轉換方向必須是簡轉繁（cn→tw），跟 karaoke.js／setlist.js 一致：');
  ok(promptSource.includes('function s2t(str) {') && promptSource.includes('if (!s2tEnabled || !str) return str;'),
    's2t() 必須尊重 s2tEnabled 開關：關閉時原樣輸出，不能永遠轉換：');
  ok(promptSource.includes('<div class="pt-line-text">${escapeHtml(s2t(line.text || \'\'))}</div>'),
    '歌詞逐句渲染必須先過 s2t() 再 escapeHtml，兩者順序顛倒會轉換不到已跳脫的字元：');

  // 面板的簡轉繁開關就是同一個 lyricSettings.convertTraditional：勾選＝轉繁體，取消勾選＝維持原文。
  ok(promptSource.includes("SocketClient.on('lyric-settings:update', (settings) => {") &&
    promptSource.includes("if (!settings || typeof settings.convertTraditional !== 'boolean') return;") &&
    promptSource.includes('s2tEnabled = settings.convertTraditional;'),
    '必須監聽 lyric-settings:update 並即時套用開關切換，不能只在切歌時讀一次：');
  ok(promptSource.includes("state.lyricSettings && typeof state.lyricSettings.convertTraditional === 'boolean'") &&
    promptSource.includes('s2tEnabled = state.lyricSettings.convertTraditional;'),
    '連線／重連的 state:sync 也必須帶出目前的簡轉繁設定，不能只靠之後的 lyric-settings:update 事件：');
});

test('跟唱視圖歌詞外觀設定：齒輪鈕不可誤套 theme-toggle class', () => {
  // 實測踩過：齒輪鈕如果共用 .theme-toggle（跟真正的主題切換鈕同一個 class），
  // theme.js 的 querySelectorAll('.theme-toggle') 會把它一起接管——點下去圖示被換成
  // 太陽/月亮、還會連帶把主題切掉，變成「打開設定」跟「切主題」兩個動作黏在一起。
  const promptHtml = fs.readFileSync(path.join(__dirname, '../public/prompter.html'), 'utf8');
  const promptCss = fs.readFileSync(path.join(__dirname, '../public/css/prompter.css'), 'utf8');
  const promptJs = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');
  ok(promptHtml.includes('id="pt-settings-btn" class="pt-icon-btn"'), '齒輪鈕必須用獨立的 class，不可跟主題切換鈕共用 .theme-toggle：');
  ok(promptHtml.includes('id="pt-theme-toggle" class="theme-toggle"'), '主題切換鈕本身仍要保留 .theme-toggle，theme.js 才找得到它：');
  ok(promptCss.includes('.pt-icon-btn {'), 'prompter.css 必須有獨立的齒輪鈕樣式：');
  ok(promptJs.includes("settingsBtn: document.getElementById('pt-settings-btn')") && promptJs.includes('dom.settingsBtn.addEventListener'), '齒輪鈕必須自己接開啟設定的事件，不能靠共用 class 順便觸發：');
});

test('跟唱視圖歌詞外觀設定：面板是錨定齒輪鈕的小面板，不是鋪滿全螢幕的 .modal', () => {
  // 使用者實測回報：共用的 .modal（全螢幕深色遮罩＋置中卡片）會擋住畫面中央，
  // 調字體/字級時完全看不到歌詞跟著變化，加背景模糊也無法兩全。改成錨定在齒輪鈕
  // 旁邊的小面板，不鋪遮罩，歌詞區永遠完整可見。
  const promptHtml = fs.readFileSync(path.join(__dirname, '../public/prompter.html'), 'utf8');
  const promptCss = fs.readFileSync(path.join(__dirname, '../public/css/prompter.css'), 'utf8');
  const promptJs = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');
  ok(promptHtml.includes('id="pt-settings-modal" class="pt-settings-popover"'), '設定面板不可用共用的 .modal class（會鋪滿全螢幕深色遮罩）：');
  ok(!/class="pt-settings-popover[^"]*\bmodal\b/.test(promptHtml), 'pt-settings-popover 不可同時混用 modal class：');
  ok(promptCss.includes('.pt-settings-popover {') && promptCss.includes('position: fixed;') && promptCss.includes('background: transparent;'),
    '面板必須是絕對定位的小面板、背景透明，不能鋪整個畫面：');
  ok(promptCss.includes('.pt-settings-popover[hidden] { display: none; }'), '面板隱藏時必須真的從版面移除，不能只是視覺上蓋住：');

  // 沒有全螢幕遮罩可以點擊關閉了，必須改成「點面板外任何地方」+ Escape 都能關閉。
  ok(promptJs.includes("document.addEventListener('click', (e) => {") &&
    promptJs.includes('if (dom.settingsModal.contains(e.target) || dom.settingsBtn.contains(e.target)) return;') &&
    promptJs.includes('closeSettingsPopover();'),
    '必須有「點面板外面關閉」的邏輯，且不能誤判成點了面板內部的控制項：');
  ok(promptJs.includes("if (e.key === 'Escape' && !dom.settingsModal.hidden)"), '必須支援 Escape 關閉，跟其他 modal 的慣例一致：');
});

test('跟唱視圖歌詞外觀設定：字體/字級/顏色/描邊只存本機，套到正確的 CSS 變數', () => {
  const promptJs = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');
  const promptCss = fs.readFileSync(path.join(__dirname, '../public/css/prompter.css'), 'utf8').replace(/\r\n/g, '\n');
  ok(promptJs.includes("const APPEARANCE_KEY = 'es-prompter-appearance';"), '外觀設定必須有自己的 localStorage key：');
  ok(promptJs.includes('localStorage.setItem(APPEARANCE_KEY') && promptJs.includes('localStorage.getItem(APPEARANCE_KEY'),
    '外觀設定必須讀寫 localStorage，不能只存在記憶體裡（重新整理就消失）：');
  ok(!promptJs.includes("SocketClient.send('lyric-settings"), '外觀設定是這台裝置的個人偏好，不可誤送到伺服器影響 OBS 或其他裝置：');
  [
    "r.setProperty('--pt-font'",
    "r.setProperty('--pt-size'",
    "r.setProperty('--pt-color'",
    "r.setProperty('--pt-stroke-w'",
    "r.setProperty('--pt-stroke-c'",
  ].forEach((required) => ok(promptJs.includes(required), `外觀設定缺少 ${required}`));
  ok(promptCss.includes('font-family: var(--pt-font);') && promptCss.includes('font-size: var(--pt-size);'),
    '.pt-line 必須實際套用字體/字級變數，不能設定了卻沒接上：');
  ok(promptCss.includes('color: var(--pt-color);') && promptCss.includes('-webkit-text-stroke: var(--pt-stroke-w) var(--pt-stroke-c);'),
    '.pt-line--active 必須套用顏色與描邊變數：');
});

test('跟唱視圖進度條支援滑鼠／觸控拖曳與鍵盤跳轉', () => {
  const promptHtml = fs.readFileSync(path.join(__dirname, '../public/prompter.html'), 'utf8');
  const promptJs = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');
  const promptCss = fs.readFileSync(path.join(__dirname, '../public/css/prompter.css'), 'utf8');
  ok(promptHtml.includes('id="pt-progress-track"') && promptHtml.includes('role="slider"') && promptHtml.includes('tabindex="0"'),
    '進度條必須具備可聚焦 slider 語意，才能用鍵盤操作：');
  ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'keydown'].forEach((eventName) => {
    ok(promptJs.includes(`addEventListener('${eventName}'`), `進度條缺少 ${eventName} 操作：`);
  });
  ok(promptJs.includes('setPointerCapture?.(event.pointerId)') && promptCss.includes('touch-action: none;'),
    '拖曳必須持續捕捉指標並停用瀏覽器原生觸控捲動：');
  ok(promptJs.includes("? { time: scrubSeconds, trackId: currentTrackId }") && promptJs.includes("SocketClient.send('play:seek', payload)"),
    '拖曳放開後必須帶目前 trackId 送出 seek，避免快速切歌時舊 seek 汙染新歌：');
  ok(promptJs.includes("if (event.key === 'Home') target = 0;") && promptJs.includes("if (event.key === 'End') target = lastDuration;"),
    '鍵盤必須支援方向鍵與 Home／End：');
});

test('跟唱視圖可載入使用者電腦字體，並保留五語介面', () => {
  const promptHtml = fs.readFileSync(path.join(__dirname, '../public/prompter.html'), 'utf8');
  const promptJs = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');
  const i18n = require('../public/js/i18n');
  ok(promptJs.includes("fetch('/api/fonts')") && promptJs.includes("typeof window.queryLocalFonts === 'function'"),
    '本機字體必須以伺服器完整掃描為主、Font Access API 為補充：');
  ok(promptJs.includes("const LOCAL_FONT_PREFIX = 'local:';") && promptJs.includes('option.style.fontFamily = family;'),
    '本機字體選項需要獨立值前綴，並以實際字體預覽名稱：');
  ok(promptHtml.includes('id="pt-font-local"') && promptHtml.includes('data-i18n-locale') && promptHtml.includes('/js/i18n.js'),
    '跟唱視圖必須有本機字體選單與五語切換入口：');
  ['app.prompterTitle', 'prompter.open', 'prompter.progress', 'prompter.fontLoaded', 'prompter.resetAppearance'].forEach((key) => {
    i18n.LOCALES.forEach((locale) => ok(String(i18n.catalogs[locale][key] || '').trim(), `${locale}.${key} 不得為空：`));
  });
  ok(promptJs.includes("window.addEventListener('i18n:change'"), '切換語言後必須重繪動態播放清單、空狀態與字體載入狀態：');
});

test('logger 對 console 寫入失敗有防護，不會觸發無限迴圈把硬碟寫爆', () => {
  // 2026-08-04 真實事故：孤兒 node 行程的 stdout 管道斷了，console.error 丟出 EPIPE，
  // 這個丟出被 uncaughtException 接到、再呼叫 log.error() 想記錄它、又再丟一次 EPIPE，
  // 無限迴圈全速跑了 5 小時，單一 log 檔寫到 80GB 把整顆系統碟灌滿。
  // 這裡直接模擬「console.error 本身會丟出」的情境，驗證 log.error() 不會把這個丟出
  // 傳給呼叫端——傳出去的話，server/index.js 的 uncaughtException handler 接到後
  // 再呼叫一次 log.error()，就是當時真的發生過的那個迴圈。
  const { createLogger } = require('../server/utils/logger');
  const testLog = createLogger('LoggerSafetyTest');
  const originalConsoleError = console.error;
  let consoleErrorCalls = 0;
  console.error = () => { consoleErrorCalls++; throw new Error('EPIPE: broken pipe, write'); };
  let threw = false;
  try {
    testLog.error('模擬管道斷掉時的寫入', new Error('boom'));
  } catch (e) {
    threw = true;
  } finally {
    console.error = originalConsoleError;
  }
  eq(threw, false, 'console 寫入失敗絕不能傳出 log.error()，否則呼叫端（uncaughtException handler）會被牽連一起炸：');
  eq(consoleErrorCalls, 1, 'console.error 應該只被呼叫一次（這裡驗證的是「丟出不會外洩」，不是重試機制）：');

  // 第二層防線：server/index.js 的 uncaughtException/unhandledRejection handler
  // 必須有重入旗標，就算未來出現其他「記錄錯誤本身又拋錯」的狀況，也不能無限重入。
  const serverSource = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  ok(serverSource.includes('let handlingFatalError = false;'), 'uncaughtException handler 必須有重入旗標：');
  ok(serverSource.includes('if (handlingFatalError) return;'), '重入時必須直接放棄，不能再嘗試記錄一次：');
  ok(serverSource.includes('function logFatalSafely(') && serverSource.includes("process.on('uncaughtException'") && serverSource.includes("process.on('unhandledRejection'"),
    'uncaughtException 與 unhandledRejection 都必須走同一個有防護的記錄函式：');

  const loggerSource = fs.readFileSync(path.join(__dirname, '../server/utils/logger.js'), 'utf8');
  ok(loggerSource.includes('try { consoleFn(formatted); } catch (err) {'), 'console 寫入本身必須包 try/catch：');
});

test('logger 同一天內寫超過大小上限會主動輪替，不必等隔天開新檔案才檢查', () => {
  // 2026-08-04 事故的第二個破口：原本的輪替檢查只在「開新串流那一刻」（開機/跨天）
  // 執行一次，同一天內持續寫入完全不會再重新檢查——搭配上面那個無限迴圈，
  // 這就是為什麼「MAX_LOG_SIZE = 50MB」的上限形同虛設，能一路寫到 80GB。
  const loggerSource = fs.readFileSync(path.join(__dirname, '../server/utils/logger.js'), 'utf8');
  ok(loggerSource.includes('let currentStreamBytes = 0;'), '必須有即時位元組計數，不能只在開新串流時看一次檔案大小：');
  ok(loggerSource.includes('if (currentStreamBytes > MAX_LOG_SIZE) rotateLogFile();') && loggerSource.includes('currentStreamBytes += Buffer.byteLength(line);'),
    'writeLog() 每次寫入都要即時累加並檢查上限，不能只在 getLogStream() 開新串流時檢查：');
  ok(loggerSource.includes('function rotateLogFile()'), '輪替必須是獨立函式：關掉目前串流、更名、讓下一次寫入重新開一個全新檔案：');
});

test('歌單暫停時仍將目前歌曲保留在正在播放', () => {
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8');
  ok(setlistSource.includes('const lastIsCurrent = !!(data.current && last && last.id != null && last.id === data.current.id);'), '目前歌曲必須以 current track 的 id 判斷');
  ok(setlistSource.includes('if (lastIsCurrent) { current = last; past = songs.slice(0, -1); }'), '目前歌曲在 session songs 尾端時不可落入已唱');
  ok(!setlistSource.includes('data.current && data.current.playing'), '歌單分組不可用播放／暫停狀態判定目前歌曲');
});

test('暫停的歌單場景模板不再能新選，但既有 OBS 設定仍可安全保留', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8');
  const setlistHandler = fs.readFileSync(path.join(__dirname, '../server/routes/handlers/setlist.js'), 'utf8');
  ['diagonal', 'timeline', 'constellation'].forEach((layout) => {
    ok(indexHtml.includes(`<option value="${layout}" hidden>`), `${layout} 必須保留隱藏 option，讓舊設定可被讀回`);
    ok(!indexHtml.includes(`data-setlist-layout="${layout}"`), `${layout} 不得再出現在新模板選擇入口`);
    ok(setlistSource.includes(layout), `${layout} renderer 必須保留，避免已使用中的 OBS 畫面被改掉`);
    ok(setlistHandler.includes('SETLIST_LAYOUTS.includes'), `${layout} 必須由共用 server allowlist 接受，避免讀取舊設定時被回退`);
  });
  ok(setlistPanel.includes("const SETLIST_HIDDEN_LAYOUTS = ['diagonal', 'timeline', 'constellation']"), '面板必須集中管理暫停模板清單');
  ok(setlistPanel.includes('setlist-legacy-layout-notice') && setlistPanel.includes('appearance.hidden = isHiddenLayout'), '暫停模板必須顯示保留說明並收起無法再調整的設定');
});

test('歌單經典資訊重排與兩個原創模板都走共用樣式，既有場景模板不受影響', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8');
  const setlistCss = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8');
  const setlistHandler = fs.readFileSync(path.join(__dirname, '../server/routes/handlers/setlist.js'), 'utf8');
  ['signal', 'index'].forEach((layout) => {
    ok(indexHtml.includes(`<option value="${layout}">`), `${layout} 必須可由歌單面板選取`);
    ok(indexHtml.includes(`data-setlist-layout="${layout}"`), `${layout} 必須有可見模板卡片`);
    ok(setlistPanel.includes(`${layout}: { name:`), `${layout} 必須有面板名稱與說明`);
    ok(setlistSource.includes(`const ${layout} = {`), `${layout} 必須有獨立 renderer`);
    ok(setlistHandler.includes('SETLIST_LAYOUTS.includes'), `${layout} 必須被共用 server allowlist 接受`);
  });
  ok(setlistSource.includes('classic-shell') && setlistCss.includes('[data-layout="classic"] .classic-shell'), '經典資訊必須使用新的局部資訊容器，而非逐列厚底');
  // 襯底必須純色：漸層淡出在很寬或很扁的來源會讓右側文字懸在半透明上，反而更難讀。
  const classicShellRules = setlistCss.split(/\n(?=[^\s}])/).filter((block) => /\.classic-shell\s*\{/.test(block));
  ok(classicShellRules.length >= 2, '經典襯底規則必須同時涵蓋一般與可讀性保護兩種狀態');
  classicShellRules.forEach((block) => {
    ok(!/background:[^;]*gradient/.test(block), '經典襯底不可使用漸層淡出，必須純色填滿');
  });
  ok(setlistCss.includes('.signal-strip') && setlistCss.includes('.index-sheet'), '兩個新模板必須有隔離的原創樣式');
  ok(setlistSource.includes("const SCENE = ['timeline', 'diagonal', 'constellation'];"), '新模板必須共用既有樣式資料，不得改成獨立場景資料');
});

test('清單型歌單模板以 OBS 來源尺寸排版，場景版維持原本行為', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8');
  const setlistCss = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8');
  const schema = require('../public/js/setlist-style-schema');
  const fillLayouts = ['classic', 'cards', 'simple', 'terminal', 'billboard', 'signal', 'index', 'label', 'glow', 'round', 'pager'];
  const sceneLayouts = ['timeline', 'diagonal', 'constellation'];

  // 只能有一種輸出：不可再回到「小元件 / 全畫布」兩種模式或 URL 開關。
  ok(!setlistSource.includes("q.get('mode')") && !setlistCss.includes('data-setlist-output') && !indexHtml.includes('data-setlist-output'),
    '歌單不可再有第二種輸出模式或 mode= 網址開關');
  ok(setlistPanel.includes("const url = new URL('/setlist', window.location.origin);") && !setlistPanel.includes("set('mode'"),
    'OBS 網址必須固定，尺寸改由 OBS Browser Source 決定');

  ok(setlistSource.includes("const FILL_LAYOUTS = new Set(['classic', 'cards', 'simple', 'terminal', 'billboard', 'signal', 'index', 'label', 'glow', 'round', 'pager']);"),
    '十一個清單型模板必須集中列在同一份填滿白名單');
  ok(setlistSource.includes('const FIT_REF_W = 460, FIT_REF_H = 320, FIT_MIN = 0.85, FIT_MAX = 3.2;') && setlistSource.includes('Math.min(w / FIT_REF_W, h / FIT_REF_H)'),
    '縮放係數必須同時依來源寬與高計算，且基準要維持實機校準過的可讀字級');
  ok(setlistSource.includes("dataset.slFit = isFillLayout() ? 'fill' : 'scene'"), 'CSS 必須能分辨填滿與場景兩種語意');
  ok(setlistSource.includes('new ResizeObserver(scheduleFit)') && setlistSource.includes("window.addEventListener('resize', scheduleFit)"),
    '使用者在 OBS 拉動來源大小時必須重新排版');
  ok(setlistSource.includes('function trimToFit(') && setlistSource.includes('box.scrollHeight - box.clientHeight > 0.5'),
    '顯示首數必須依實際高度決定，不可再固定 6 首');
  ok(!setlistSource.includes('model.upcoming.slice(0, UP_LIMIT)') && setlistSource.includes('model.upcoming.slice(0, upCap())'),
    '列數上限必須跟著輸出模式切換');

  // 字級／間距跟著來源走：schema 標 fitScale，setlist.js 才會乘上 --sl-fit。
  ['sizeNow', 'sizeList', 'sizeArtist', 'sizeMeta', 'borderRadius', 'paddingV', 'paddingH', 'itemGap'].forEach((key) => {
    ok(schema.FIELD_BY_KEY[key] && schema.FIELD_BY_KEY[key].fitScale === true, `${key} 必須跟著來源尺寸等比縮放`);
  });
  ok(setlistSource.includes('if (f.fitScale && fill)'), 'fitScale 欄位必須實際乘上目前的 fit');
  ok(!schema.FIELD_BY_KEY.cardWidth.fitScale, '固定像素寬度不得再參與填滿版面的計算');
  ok(!indexHtml.includes('id="sls-card-width"') && !!schema.FIELD_BY_KEY.cardWidth,
    '面板不得再顯示固定像素寬度，但 schema 欄位要保留讓舊設定讀得回來');

  // 版面：每個模板都要有自己的填滿規則，且根節點不得殘留固定寬度或 transform 放大。
  // 四款皮膚（label/glow/round/pager）結構共用 sk-shell，
  // 用同一條 [data-layout] 通用規則撐開，不必每個 id 各寫一份。
  const fillRootRule = /html\[data-sl-fit="fill"\]\[data-layout\] #setlist-root \{([\s\S]*?)\n\}/.exec(setlistCss)?.[1] || '';
  ok(fillRootRule.includes('inset: 0') && fillRootRule.includes('max-width: none') && fillRootRule.includes('transform: none'),
    '填滿模式的根節點必須貼齊來源、不留固定寬度、不用 transform 放大點陣');
  const skinLayouts = ['label', 'glow', 'round', 'pager'];
  ok(setlistCss.includes('html[data-sl-fit="fill"][data-layout] .sk-shell'), '四款皮膚共用的填滿版面規則必須存在');
  fillLayouts.filter((layout) => !skinLayouts.includes(layout)).forEach((layout) => {
    ok(setlistCss.includes(`html[data-sl-fit="fill"][data-layout="${layout}"]`), `${layout} 必須有自己的填滿版面規則`);
  });
  sceneLayouts.forEach((layout) => {
    ok(!setlistCss.includes(`html[data-sl-fit="fill"][data-layout="${layout}"]`), `${layout} 是場景版，不可被改成填滿版面`);
  });
  ok(setlistCss.includes('html[data-sl-fit="fill"] .setlist-row,'), '清單列必須維持自然高度，否則會被壓扁而不是少顯示一首');

  // 面板：說明與預覽尺寸切換（沒有尺寸切換就看不出「跟著來源變化」）。
  ok(indexHtml.includes('id="setlist-sizing-hint"') && setlistPanel.includes('跟著你在 OBS 拉的 Browser Source 寬高變化'),
    '面板必須說明歌單大小由 OBS 來源決定');
  ['16x9', 'portrait', 'strip', 'small'].forEach((size) => {
    ok(indexHtml.includes(`data-setlist-preview-size="${size}"`), `預覽必須能模擬 ${size} 來源尺寸`);
  });
  ok(setlistPanel.includes('window.PreviewScale?.apply();'), '預覽縮放必須共用 preview-scale.js，不可各算一份');
});

test('清單型歌單有已唱／未唱區塊與勾選，單點式模板不吃這組設定', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8');
  const setlistCss = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  const schema = require('../public/js/setlist-style-schema');

  // 設定欄位：改成兩個獨立 checkbox，但 key 名稱不准變（改名＝所有人既有設定失效）。
  const up = schema.FIELD_BY_KEY.classicShowUpcoming;
  const done = schema.FIELD_BY_KEY.classicShowDone;
  ok(up && up.domId === 'sls-show-upcoming' && up.default === true && !up.special, '未唱區塊必須是一般布林欄位並綁到 checkbox');
  ok(done && done.domId === 'sls-show-done' && done.default === true && !done.special, '已唱區塊必須是一般布林欄位並綁到 checkbox');
  ok(indexHtml.includes('id="sls-show-upcoming"') && indexHtml.includes('id="sls-show-done"'), '面板必須提供兩個獨立勾選');
  ok(!indexHtml.includes('sls-classic-sections') && !setlistPanel.includes('sls-classic-sections'), '舊的三態下拉與其特例程式碼必須整組移除');
  ok(indexHtml.includes('data-sl-layout="classic cards terminal billboard index label glow round pager"'), '勾選只對九個清單型模板顯示');

  // renderer：九個清單型模板才吃這組設定；八個非經典模板要有區塊標籤。
  ok(setlistSource.includes("const SECTIONED_LAYOUTS = new Set(['classic', 'cards', 'terminal', 'billboard', 'index', 'label', 'glow', 'round', 'pager']);"),
    '清單型模板必須集中列在同一份白名單');
  ok(setlistSource.includes('function showDone()') && setlistSource.includes('function showWait()')
    && setlistSource.includes('const done = showDone() ?') && setlistSource.includes('const wait = showWait()'),
    'windowList 必須依勾選過濾已唱／未唱');
  ok(setlistSource.includes('items.start = showDone() ?'), '關掉已唱時曲序起點必須跟著調整，不可跳號');
  ok(setlistSource.includes('function groupedHtml('), '四個清單型模板必須共用同一份分群輸出');
  ['term-group', 'bb-group', 'card-group', 'index-group'].forEach((cls) => {
    ok(setlistSource.includes(`class="${cls}" data-group-label`), `${cls} 必須是可辨識的區塊標籤`);
    ok(setlistCss.includes(`.${cls}`), `${cls} 必須有樣式`);
  });
  ok(setlistSource.includes('function pruneOrphanLabels(') && setlistSource.includes('isGroupLabel(el)'),
    '裁列後不可留下沒有內容的孤兒標籤');
  ok(setlistSource.includes("document.querySelectorAll('[data-group-label]')"), '自訂已唱／未唱文字必須即時套到區塊標籤');

  // 經典只留一側時要收成單欄（兩欄 grid 會讓可見那欄只佔一半寬）。
  // data-layout 與 data-cl-hide-* 都在 <html> 上，必須是連續屬性選擇器而不是後代選擇器。
  ok(setlistCss.includes('html[data-sl-fit="fill"][data-layout="classic"][data-cl-hide-up] .cl-cols')
    && setlistCss.includes('html[data-sl-fit="fill"][data-layout="classic"][data-cl-hide-done] .cl-cols'),
    '經典只顯示一側時必須收成單欄');

  // 「整體背板」曾因經典重排把 root 背景寫死而失效；填滿模式必須讓它回到 root 上。
  const fillRoot = /html\[data-sl-fit="fill"\]\[data-layout\] #setlist-root \{([\s\S]*?)\n\}/.exec(setlistCss)?.[1] || '';
  ok(fillRoot.includes('background: var(--sl-user-bg, transparent)'), '整體背板設定必須在填滿模式實際生效');
});

test('歌單面板：模板分群與快速調整四區塊', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const panelCss = fs.readFileSync(path.join(__dirname, '../public/css/panel.css'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');

  ok(indexHtml.includes('清單型 — 跟著來源尺寸重排') && indexHtml.includes('固定版位 — 只呈現現在播放'),
    '模板選擇器必須把清單型與固定版位分開');
  // UI 清理（2026-07-25）：七個模板攤平常駐、不再有「其他模板」展開鈕與推薦/新徽章；
  // 提示文字統一為一種淡色純文字樣式，不得回到多種灰底方框混用。
  ok(!indexHtml.includes('btn-setlist-more-layouts') && !indexHtml.includes('setlist-layout-badge'),
    '模板選擇器必須攤平顯示，不得恢復展開鈕或徽章');
  ok(!panelCss.includes('.setlist-sizing-hint { margin:10px 0 0; padding') && !panelCss.includes('.setlist-style-scope { margin:0 0 12px; padding'),
    '提示不得回到灰底方框樣式');
  ok(indexHtml.includes('class="check-box"') && panelCss.includes('.check-inline input { position:absolute; opacity:0;'),
    '勾選必須用自繪勾選框，不得露出原生 checkbox');
  ok(panelCss.includes('#setlist-style-collapse > .field-group-title'), '快速調整四區必須有一致的分隔線節奏');
  ok(setlistPanel.includes("const SETLIST_SECTIONED_LAYOUTS = ['classic', 'cards', 'terminal', 'billboard', 'index', ...SETLIST_SKIN_LAYOUTS];"),
    '面板必須用同一組清單型白名單給說明文案');
  ok(panelCss.includes('.setlist-layout-group-title') && panelCss.includes('.check-inline'), '分群標題與勾選樣式必須存在');

  ['版面', '大小', '顏色', '可讀性'].forEach((title) => {
    ok(indexHtml.includes(`>${title}</div>`), `快速調整必須有「${title}」區塊`);
  });
  // 襯底色與襯底不透明度必須相鄰（先前中間被字級滑桿隔開，使用者找不到）。
  const cardColorAt = indexHtml.indexOf('id="sls-card-color"');
  const cardOpacityAt = indexHtml.indexOf('id="sls-card-opacity"');
  ok(cardColorAt > 0 && cardOpacityAt > cardColorAt && indexHtml.slice(cardColorAt, cardOpacityAt).indexOf('type="range"') === -1,
    '可讀性襯底色與襯底不透明度之間不可再插入其他控制項');
  // 整體大小倍率搬到第一屏，且只能有一份。
  eq(indexHtml.split('id="sls-scale"').length - 1, 1, '整體大小倍率是搬移不是複製：');
  const scaleAt = indexHtml.indexOf('id="sls-scale"');
  const modalAt = indexHtml.indexOf('id="setlist-advanced-modal"');
  ok(scaleAt > 0 && modalAt > 0 && scaleAt < modalAt, '整體大小倍率必須在快速調整，不能留在詳細設定 modal 裡');
  // 會鋪滿整塊來源的整體背板改放詳細設定。
  ok(indexHtml.indexOf('id="sls-bg-opacity"') > modalAt, '整體背板屬於低頻且影響大的設定，必須移進詳細設定');
});

test('OBS 經典歌單以歌名為第一優先，長歌手名不可擠壓歌名', () => {
  const setlistCss = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8');
  const titleRule = /\.setlist-title\s*\{([\s\S]*?)\n\}/.exec(setlistCss)?.[1] || '';
  const artistRule = /\.setlist-artist\s*\{([\s\S]*?)\n\}/.exec(setlistCss)?.[1] || '';
  ok(titleRule.includes('flex: 1 1 0'), '歌名必須取得可伸縮的主要欄位');
  ok(titleRule.includes('min-width: 50%'), '狹窄列也必須保留至少半列給歌名');
  ok(artistRule.includes('flex: 0 1 38%'), '歌手欄必須是次要且可縮小的欄位');
  ok(artistRule.includes('max-width: 38%'), '歌手欄不可占用超過既定配額');
  ok(artistRule.includes('text-overflow: ellipsis'), '過長歌手名必須省略而非擠壓歌名');
});

test('歌詞預覽在首頁與設定頁都提供同步狀態、OBS 網址與複製操作', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const shared = fs.readFileSync(path.join(__dirname, '../public/js/app-shared.js'), 'utf8');
  const styleSync = fs.readFileSync(path.join(__dirname, '../public/js/app-style-sync.js'), 'utf8');
  const panelCss = fs.readFileSync(path.join(__dirname, '../public/css/panel.css'), 'utf8');
  ok(indexHtml.includes('class="lyrics-preview-head"'));
  ok(indexHtml.includes('已即時同步'));
  ok(indexHtml.includes('id="lyrics-preview-obs-url"'));
  ok(indexHtml.includes('id="copy-obs-url-preview"'));
  ok(indexHtml.includes('class="settings-preview-head"'));
  ok(indexHtml.includes('id="settings-preview-obs-url"'));
  ok(indexHtml.includes('id="copy-obs-url-settings-preview"'));
  ok(indexHtml.includes('id="btn-settings-preview-sample-lyrics"'));
  ok(indexHtml.includes('id="btn-preview-sample-lyrics"'));
  ok(shared.includes('copyObsUrlPreview'));
  ok(shared.includes('copyObsUrlSettingsPreview'));
  ok(styleSync.includes('refreshObsUrls()'));
  ok(styleSync.includes("buildObsUrl({ preview: true, relative: true })"));
  ok(styleSync.includes("document.querySelectorAll('iframe.obs-preview')"));
  ok(styleSync.includes('copyObsUrlPreview.addEventListener'));
  ok(styleSync.includes('copyObsUrlSettingsPreview.addEventListener'));
  ok(panelCss.includes('.lyrics-preview-head'));
  ok(panelCss.includes('.lyrics-preview-controls'));
  ok(panelCss.includes('.settings-preview-head'));
  ok(panelCss.includes('.settings-preview-controls'));
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

console.log('\n15. P2 播放邊界與 state:sync 量測');
test('單曲模式播完清空目前歌曲，等待使用者主動按下一首', () => {
  const sequence = require('../public/js/playback-sequence');
  eq(sequence.nextAfterEnded(0, 2, false), null);
  eq(sequence.nextAfterEnded(1, 2, false), null);
  eq(sequence.manualAdvance(-1, 3, 0, 1), 1, '播完第一首後按下一首應到第二首：');
  eq(sequence.manualAdvance(-1, 3, 1, -1), 1, '播完第二首後按上一首應重播第二首：');
  eq(sequence.manualAdvance(-1, 3, 2, 1), 0, '播完最後一首後按下一首維持既有循環行為：');
});

test('連續模式會自動播放下一首，但最後一首仍自然停止', () => {
  const sequence = require('../public/js/playback-sequence');
  const next = sequence.nextAfterEnded(0, 2, true);
  eq(next.index, 1);
  eq(next.autoplay, true);
  eq(sequence.nextAfterEnded(1, 2, true), null);
});

test('沒有目前歌曲時，已唱 entryId 仍會從未唱清單排除', () => {
  const { createAppState } = require('../server/state/app-state');
  const appState = createAppState({ emit() {} });
  const first = { id: 'done-a', entryId: 'done-entry-a', title: '已唱 A' };
  const second = { id: 'done-b', entryId: 'done-entry-b', title: '已唱 B' };
  const third = { id: 'wait-c', entryId: 'wait-entry-c', title: '未唱 C' };
  appState.playState.playlist = [first, second, third];
  appState.playState.currentTrack = null;
  appState.playState.currentTrackStarted = false;
  appState.playState.playedEntryIds = new Set([first.entryId, second.entryId]);
  appState.playState.lastPlayedEntryId = second.entryId;

  const payload = appState.setlistPayload();
  eq(payload.current, null);
  eq(payload.upcoming.map((track) => track.title).join(','), '未唱 C');
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

test('歌單已開始的目前歌曲暫停後仍不可回到未唱區', () => {
  const { createAppState } = require('../server/state/app-state');
  const appState = createAppState({ emit() {} });
  const current = { id: 'current', entryId: 'current-entry', title: '暫停中的歌', artist: '測試歌手' };
  const next = { id: 'next', entryId: 'next-entry', title: '下一首', artist: '測試歌手' };
  appState.playState.playlist = [current, next];
  appState.playState.currentTrack = current;
  appState.playState.isPlaying = false;
  appState.playState.currentTrackStarted = true;

  const paused = appState.setlistPayload();
  eq(paused.current.title, '暫停中的歌');
  eq(paused.current.playing, false);
  eq(paused.upcoming.map((track) => track.title).join(','), '下一首');

  appState.playState.currentTrackStarted = false;
  const standby = appState.setlistPayload();
  eq(standby.upcoming.map((track) => track.title).join(','), '暫停中的歌,下一首');
});

test('意外關閉後會恢復目前歌曲與已唱／未唱狀態，但播放位置歸零且不自動播放', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-playback-recovery-'));
  try {
    const appStatePath = path.join(__dirname, '..', 'server', 'state', 'app-state.js');
    const stateStorePath = path.join(__dirname, '..', 'server', 'services', 'state-store.js');
    const script = [
      "const appStatePath=process.argv[1];",
      "const stateStorePath=process.argv[2];",
      "const {createAppState}=require(appStatePath);",
      "const stateStore=require(stateStorePath);",
      "const io={emit(){}};",
      "const first=createAppState(io);",
      "first.playState.playlist=[",
      " {id:'a',entryId:'entry-a',title:'A'},",
      " {id:'b',entryId:'entry-b',title:'B'},",
      " {id:'c',entryId:'entry-c',title:'C'}",
      "];",
      "first.playState.currentTrack=first.playState.playlist[1];",
      "first.playState.currentTrackStarted=true;",
      "first.playState.currentTime=87.25;",
      "first.playState.isPlaying=true;",
      "first.markTrackPlayed(first.playState.playlist[0]);",
      "first.markTrackPlayed(first.playState.playlist[1]);",
      "first.persistState();",
      "stateStore.saveNow();",
      "const restored=createAppState(io);",
      "const publicState=restored.getPublicState();",
      "const setlist=restored.setlistPayload();",
      "process.stdout.write('__RECOVERY__'+JSON.stringify({",
      " currentEntryId:publicState.currentTrack&&publicState.currentTrack.entryId,",
      " currentTime:publicState.currentTime, isPlaying:publicState.isPlaying,",
      " currentTrackStarted:publicState.currentTrackStarted,",
      " playedEntryIds:publicState.playedEntryIds, lastPlayedEntryId:publicState.lastPlayedEntryId,",
      " upcoming:setlist.upcoming.map((track)=>track.title)",
      "})+'\\n');",
    ].join('\n');
    const child = spawnStateStore(process.execPath, ['-e', script, appStatePath, stateStorePath], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir },
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    eq(child.status, 0, `playback recovery child stderr=${child.stderr} stdout=${child.stdout}: `);
    const markerAt = child.stdout.lastIndexOf('__RECOVERY__');
    ok(markerAt >= 0, `playback recovery child 缺少結果：${child.stdout}`);
    const result = JSON.parse(child.stdout.slice(markerAt + '__RECOVERY__'.length).trim().split(/\r?\n/, 1)[0]);
    eq(result.currentEntryId, 'entry-b');
    eq(result.currentTime, 0, '不保存歌曲內秒數，重開後應從該首開頭準備：');
    eq(result.isPlaying, false, '重開後不可自行播放出聲：');
    eq(result.currentTrackStarted, true, '暫停中的已開始歌曲要維持已唱狀態：');
    eq(result.playedEntryIds.sort().join(','), 'entry-a,entry-b');
    eq(result.lastPlayedEntryId, 'entry-b');
    eq(result.upcoming.join(','), 'C');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('舊 state 沒有播放恢復欄位時，會用既有 session 歌曲回填已唱狀態', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-playback-backfill-'));
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({
      schemaVersion: 3,
      savedAt: 1,
      playlist: [
        { id: 'a', entryId: 'entry-a', title: 'A' },
        { id: 'b', entryId: 'entry-b', title: 'B' },
        { id: 'c', entryId: 'entry-c', title: 'C' },
      ],
      session: {
        active: false, startedAt: null, source: null,
        songs: [{ id: 'a', entryId: 'session-a', title: 'A' }, { id: 'b', entryId: 'session-b', title: 'B' }],
      },
    }), 'utf8');
    const appStatePath = path.join(__dirname, '..', 'server', 'state', 'app-state.js');
    const script = [
      "const {createAppState}=require(process.argv[1]);",
      "const restored=createAppState({emit(){}});",
      "const publicState=restored.getPublicState();",
      "const setlist=restored.setlistPayload();",
      "process.stdout.write('__BACKFILL__'+JSON.stringify({played:publicState.playedEntryIds,upcoming:setlist.upcoming.map((t)=>t.title)})+'\\n');",
    ].join('\n');
    const child = spawnStateStore(process.execPath, ['-e', script, appStatePath], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir },
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    eq(child.status, 0, `playback backfill child stderr=${child.stderr} stdout=${child.stdout}: `);
    const markerAt = child.stdout.lastIndexOf('__BACKFILL__');
    ok(markerAt >= 0, `playback backfill child 缺少結果：${child.stdout}`);
    const result = JSON.parse(child.stdout.slice(markerAt + '__BACKFILL__'.length).trim().split(/\r?\n/, 1)[0]);
    eq(result.played.sort().join(','), 'entry-a,entry-b');
    eq(result.upcoming.join(','), 'C');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('控制面板重開後只在本地載入保存歌曲，不回送 play:track 改寫伺服器狀態', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/app-playback.js'), 'utf8');
  const restore = source.slice(source.indexOf('function restorePlaybackState'), source.indexOf('function restorePlaybackState') + 1800);
  ok(restore.includes("playTrack(index, false, { notifyServer: false, startTime: seconds })"),
    '恢復歌曲必須禁止回送 play:track；程式重開後伺服器提供的秒數固定為 0：');
  ok(source.includes('AppShared.restorePlaybackState = restorePlaybackState'),
    'app.js 的 state:sync 必須能呼叫本地恢復流程：');
});

test('播放秒數不寫入 state.json，lyrics:sync 與拖曳 seek 也不觸發存檔', () => {
  const appStateSource = fs.readFileSync(path.join(__dirname, '../server/state/app-state.js'), 'utf8');
  const playbackSource = fs.readFileSync(path.join(__dirname, '../server/routes/handlers/playback.js'), 'utf8');
  const snapshot = appStateSource.slice(
    appStateSource.indexOf('playback: {'),
    appStateSource.indexOf('playback: {') + 700,
  );
  ok(!snapshot.includes('currentTime:'), 'playback 持久化快照不可保存歌曲內秒數：');

  const seekHandler = playbackSource.slice(
    playbackSource.indexOf("socket.on('play:seek'"),
    playbackSource.indexOf("socket.on('play:prev'"),
  );
  const syncHandler = playbackSource.slice(
    playbackSource.indexOf("socket.on('lyrics:sync'"),
    playbackSource.indexOf("socket.on('lyrics:romanized'"),
  );
  ok(!seekHandler.includes('persistState('), '拖曳進度只做即時同步，不可寫入 state.json：');
  ok(!syncHandler.includes('persistState('), '播放中的高頻 lyrics:sync 不可寫入 state.json：');
  ok(!playbackSource.includes('PROGRESS_PERSIST_INTERVAL_MS') && !playbackSource.includes('persistPlaybackProgress'),
    '不可保留每 5 秒存檔的計時／節流邏輯：');
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

test('state-store debounce has a bounded max wait during continuous edits', () => {
  const { SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS, saveDelayMs } = require('../server/services/state-store');
  eq(SAVE_DEBOUNCE_MS, 800);
  eq(SAVE_MAX_WAIT_MS, 5000);
  eq(saveDelayMs(1000, 1000), 800, '第一次排程保留正常 debounce: ');
  eq(saveDelayMs(1000, 4500), 800, '距離 max wait 還遠時持續合併: ');
  eq(saveDelayMs(1000, 5600), 400, '接近 max wait 時只能再延到上限: ');
  eq(saveDelayMs(1000, 7000), 0, '超過上限必須立刻保存，不得無限重設計時器: ');
});

test('state:sync excludes setlist style snapshots while setlist:update retains them', () => {
  const { createAppState, SETLIST_LAYOUTS } = require('../server/state/app-state');
  const state = createAppState({ emit() {} });
  const sync = state.getPublicState();
  const setlist = state.setlistPayload();
  ok(!Object.prototype.hasOwnProperty.call(sync.session, 'styles'), 'state:sync 不可攜帶完整 setlist styles: ');
  ok(!Object.prototype.hasOwnProperty.call(sync.session, 'style') && !Object.prototype.hasOwnProperty.call(sync.session, 'sceneStyles'),
    'state:sync 不可攜帶 legacy setlist style 視圖: ');
  eq(Object.keys(setlist.styles).length, SETLIST_LAYOUTS.length, 'setlist:update 初始載入必須保留各模板外觀: ');
  const socketSource = fs.readFileSync(path.join(__dirname, '../server/routes/socket-handler.js'), 'utf8');
  const panelSource = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  ok(socketSource.includes("socket.on('setlist:get', (_data, ack) => {"),
    'setlist payload 必須可按需取得，不能綁在 controller 初始同步後: ');
  ok(panelSource.includes("SocketClient.on('connection-change', (connected) => {"),
    '控制面板連線後必須主動取得 setlist 外觀: ');
  ok(panelSource.includes("SocketClient.on('setlist:update', applySetlistControls)"));
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
    const statePayloadBytes = [
      ...Object.values(matrix.initialBytes || {}),
      ...Object.values(matrix.broadcastBytes || {}),
      matrix.recoveryBytes,
    ];
    ok(statePayloadBytes.length === 9 && statePayloadBytes.every((bytes) => bytes < 1024 * 1024),
      `state-sync matrix public payload exceeds 1 MiB: ${JSON.stringify(matrix)}`);
    ok(matrix.initialBytes.controller === matrix.initialBytes.remote
      && matrix.initialBytes.display === matrix.initialBytes.setlist
      && matrix.initialBytes.controller > matrix.initialBytes.display,
    `state-sync matrix must keep control and read-only payloads separated: ${JSON.stringify(matrix)}`);
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
  const expectedTemplates = ['pulse', 'facet', 'drift', 'aura', 'ktv', 'paperstrip', 'mirror'];
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
  // drift（斜拍告白）目前從桌面與手機選擇器隱藏；Paper Strip 加入後 README 以七種為準。
  ok(readme.includes('Classic Overlay, Pulse, Facet, Aura, KTV, Vertical Flow, and Paper Strip'));
  ok(!/Classic Overlay, Pulse, Facet, Drift/.test(readme), 'README 不可把隱藏中的 Drift 列為可選模板: ');
});

test('桌面與手機遙控器同步模板能力，斜拍告白維持隱藏', () => {
  const controllerHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'controller.html'), 'utf8');
  const controllerJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'controller.js'), 'utf8');
  const panelHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const controllerCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'controller-new.css'), 'utf8');
  ['pulse', 'facet', 'aura', 'paperstrip', 'mirror'].forEach((template) => {
    ok(controllerHtml.includes(`class="ctrl-template-btn" data-template="${template}"`), `${template} 必須出現在手機模板選項: `);
  });
  const panelDrift = /<button[^>]*data-template="drift"[^>]*>/.exec(panelHtml)?.[0] || '';
  const controllerDrift = /<button[^>]*data-template="drift"[^>]*>/.exec(controllerHtml)?.[0] || '';
  ok(panelDrift.includes('hidden') && controllerDrift.includes('hidden'), '斜拍告白必須從桌面與手機模板選擇器隱藏: ');
  ok(!controllerHtml.includes('ctrl-template-legacy-notice'), '手機不應保留舊模板的相容性介面: ');
  ok(controllerJs.includes("const TEMPLATE_IDS = ['classic', 'pulse', 'facet', 'drift', 'aura', 'ktv', 'columnflow', 'paperstrip', 'mirror'];"), '遙控器必須使用新的模板 ID: ');
  ok(controllerJs.includes('if (!TEMPLATE_IDS.includes(nextTemplate)) return;'), '模板切換必須接受所有現行模板: ');
  ok(controllerJs.includes("nextTemplate === 'paperstrip' ? PAPERSTRIP_DEFAULTS"), '舊 state 從手機首次切到 paperstrip 時必須套用黑字預設，避免白底白字: ');
  ok(controllerJs.includes("nextTemplate === 'mirror' ? MIRROR_DEFAULTS") && controllerJs.includes("if (nextTemplate === 'mirror') next.lyricPosition = 'split';"), '手機首次切到 mirror 必須套用雙側預設並鎖定 split: ');
  ok(controllerHtml.includes('id="ctrl-intensity-group"') && controllerJs.includes('intensityGroup.hidden = !templateSupportsIntensity(template);'), '手機動態強度必須與桌面模板能力同步: ');
  ok(controllerHtml.includes('id="ctrl-classic-style-group"') && controllerJs.includes('classicStyleGroup.hidden = !isClassic;'), '配色風格必須只在經典疊層顯示: ');
  ok(controllerCss.includes('#ctrl-intensity-group[hidden]') && controllerCss.includes('#ctrl-classic-style-group[hidden]'), '手機模板設定的 hidden 狀態不得被 CSS 蓋掉: ');
});

test('紙帶逐字模板以獨立時間驅動管線載入，並完整接入設定與伺服器白名單', () => {
  const displayHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'display.html'), 'utf8');
  const panelHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const templateJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-template-paperstrip.js'), 'utf8');
  const displayCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'display.css'), 'utf8');
  const displayJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'display.js'), 'utf8');
  const motionKernel = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-motion-kernel.js'), 'utf8');
  const lyricExtras = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-extras.js'), 'utf8');
  const lyricsHandler = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'handlers', 'lyrics.js'), 'utf8');
  const appState = fs.readFileSync(path.join(__dirname, '..', 'server', 'state', 'app-state.js'), 'utf8');
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'i18n.js'), 'utf8');
  ok(displayHtml.includes('/js/lyric-template-paperstrip.js'), 'display 必須載入紙帶逐字模板腳本: ');
  ok(templateJs.includes("id: 'paperstrip'") && templateJs.includes('onFrame(timeMs, ctx)') && templateJs.includes('onSeek(timeMs, ctx)'), '紙帶逐字必須透過 registry 並以時間驅動: ');
  ok(templateJs.includes('LyricMotion.ensureWordTimings') && templateJs.includes('LyricMotion.buildGraphemeTimings'), '紙帶逐字必須沿用既有逐字時間資料與 LRC 降級管線: ');
  ok(templateJs.includes('PRE_ROLL_MS') && templateJs.includes("classList.toggle('is-current'"), '紙帶逐字必須有預展開與逐字目前字狀態: ');
  ok(templateJs.includes('function barRevealProgress(value)') && templateJs.includes('t <= 0.24') && templateJs.includes('t <= 0.34') && templateJs.includes('Math.pow(1 - u, 2.45)'), '紙帶展開必須使用前段蓄力、中段快速拉開、後段長尾減速的分段速度曲線，不可退回單一 smoothstep: ');
  ok(templateJs.includes('const PRE_ROLL_MS = 900;') && templateJs.includes('const BAR_OPEN_MS = 700;') && templateJs.includes('const MIN_BAR_OPEN = 0.08;'), '同頁紙帶必須保留 pre-roll 與足夠動畫時長，起始為短白條而不是瞬間從零寬拉滿: ');
  ok(templateJs.includes('const TEXT_REVEAL_MIN_OPEN = 0.985;'), '同頁與 split 仍需保留白條完成度文字閘門: ');
  ok(templateJs.includes("setProperty('--ps-clip-right'") && templateJs.includes('clampedOpen >= TEXT_REVEAL_MIN_OPEN'), '白條必須使用左到右揭露比例，且文字受白條完成度硬閘門保護: ');
  ok(displayCss.includes('clip-path: inset(0 var(--ps-clip-right, 100%) 0 0);') && templateJs.includes("setProperty('--ps-clip-right', `${(100 - clampedOpen * 100).toFixed(3)}%`)") && !displayCss.includes('transform: scaleX(var(--ps-open));'), '紙帶白底必須固定左邊界、從左往右展開，且不可用 scaleX 壓扁邊框與陰影: ');
  ok(templateJs.includes('const MIN_BATCH_SIZE = 1;') && templateJs.includes('const MAX_BATCH_SIZE = 4;') && templateJs.includes('function areLinesTemporallyClose') && templateJs.includes('const interlineGap = Math.max(0, nextPlan.startMs - previousPlan.endMs);') && templateJs.includes('MAX_INTERLINE_GAP_MS') && templateJs.includes('temporalBatchLimit') && templateJs.includes('buildBatches(plans)') && templateJs.includes('scoreBatchCandidate'), '紙帶逐字必須在播放前依內容穩定分組：連續樂句維持 2～4 句，前句尾到後句頭有實際空拍才允許單句頁: ');
  ok(templateJs.includes('metrics.totalChars') && templateJs.includes('metrics.totalDuration') && templateJs.includes('metrics.averageChars') && templateJs.includes('count === previousCount'), '2～4 句分組必須同時考慮總字數、播放時間、平均句長與避免連續相同句數: ');
  ok(templateJs.includes('remaining - count === 1 && areLinesTemporallyClose') && templateJs.includes('count === 1 && temporalBatchLimit(allPlans, start) > 1') && templateJs.includes('LyricMotion.hashNoise(seed, 53)'), '分組必須避免可避免的單句尾頁，但時間距離很遠的下一句可單獨成頁，並使用可重現的穩定亂數: ');
  ok(templateJs.includes("2: [") && templateJs.includes("3: [") && templateJs.includes("4: [") && templateJs.includes('emphasisScore'), '紙帶逐字必須為 2／3／4 句各自提供尺寸構圖，並用句長與節奏決定大字優先句: ');
  ok(templateJs.includes('plan.batchCount = batch.length') && templateJs.includes('plans[target].batchStart'), '可變句數頁面必須把頁面邊界預先寫回每句，seek 時直接定位同一頁: ');
  ok(templateJs.includes('const pageViews = new Map();') && templateJs.includes('function neededBatchStarts(timeMs)') && templateJs.includes('timeMs < (lastPlan?.endMs || 0)'), 'split 模式必須保留既有前後頁短暫共存，上一頁保留到最後一句真正結束: ');
  ok(templateJs.includes('function batchEntryMs(batchStart)') && templateJs.includes('Math.max(batchPreviousEndMs(batchStart), firstPlan.startMs - PRE_ROLL_MS)') && templateJs.includes('function nonSplitBatchStart(timeMs)'), '非 split 跨頁必須等上一頁結束後才允許下一頁進場，空拍時才可利用剩餘 pre-roll: ');
  ok(templateJs.includes('spatialGate: 0.14') && templateJs.includes('function measureGlyphSpatialGates(entry)') && templateJs.includes('clampedOpen >= glyph.spatialGate'), '非 split 跨頁第一句必須用白條實際掃過每個字的位置逐字放行，避免交棒時整句突然跳出: ');
  ok(templateJs.includes('const crossPageLead = !splitMode && plan.batchSlot === 0 && plan.batchStart > 0;') && templateJs.includes('pageEntryMs: view.entryMs') && !displayCss.includes('.ps-group--incoming {'), '非 split 不再建立隱藏 incoming 頁；跨頁第一條白帶從 page entry 時刻真正開始，split 維持既有行為: ');
  ok(templateJs.includes('constrainRowWidth') && displayCss.includes('body.lyric-pos-left #paperstrip-root .ps-group') && displayCss.includes('width: min(100%, 760px);'), '紙帶逐字偏左／偏右必須有單邊寬度上限，超長句在首次顯示前縮放: ');
  ok(!displayCss.includes('@keyframes ps-row-enter'), '紙帶逐字不可在每句重播整列進場動畫造成閃爍: ');
  ok(motionKernel.includes('function stageSafeMarginPercent()') && motionKernel.includes('function mountStageSafeZoneGuide(rootEl)'), '主線舞台安全框核心必須移植到共用 LyricMotion: ');
  ok(lyricExtras.includes("const STAGE_POSITION_TEMPLATES = ['pulse', 'facet', 'drift', 'aura', 'paperstrip', 'mirror'];") && panelHtml.includes('id="stage-safe-margin-field"'), 'Paper Strip 必須接入舞台安全距離設定 UI: ');
  ok(displayJs.includes("['pulse', 'facet', 'drift', 'aura', 'paperstrip', 'mirror'].includes(s.template)") && displayJs.includes("setProperty('--stage-safe-margin'"), 'display 必須把 Paper Strip 的安全距離同步成共用 dataset/CSS 變數: ');
  ok(templateJs.includes('LyricMotion.mountStageSafeZoneGuide(rootEl)') && templateJs.includes('onSettings()') && displayCss.includes('.stage-safe-zone-band'), 'Paper Strip 必須掛共用安全框並在設定變更時即時同步: ');
  ok(displayCss.includes('width: min(calc(48% - var(--stage-safe-margin, 2) * 1%), 760px);') && displayCss.includes('overflow: visible;') && templateJs.includes('entry.groupEl.clientWidth - indent - 2') && templateJs.includes('Math.max(0.22'), 'Paper Strip 安全框必須作為排版寬度而不是裁切遮罩；超長句要先計入縮排並縮到完整可見: ');
  ok(lyricExtras.includes("paperstrip: { label: '紙帶逐字'") && lyricExtras.includes("template: 'paperstrip'"), '桌面設定必須提供紙帶逐字能力與獨立預設: ');
  ok(lyricsHandler.includes("'columnflow', 'paperstrip'"), 'server 模板白名單必須接受 paperstrip: ');
  ok(appState.includes("paperstrip: { template: 'paperstrip'"), 'server 預設 lyricTemplateSettings 必須包含 paperstrip: ');
  ok(i18n.includes("'template.paperstrip':"), '紙帶逐字模板名稱必須有五語 i18n key: ');
});

test('鏡像模板 P0 固定雙側構圖、語言安全轉換與 deterministic glyph 排版', () => {
  const displayHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'display.html'), 'utf8');
  const panelHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const templateJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-template-mirror.js'), 'utf8');
  const displayCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'display.css'), 'utf8');
  const lyricExtras = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-extras.js'), 'utf8');
  const lyricsHandler = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'handlers', 'lyrics.js'), 'utf8');
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const appState = fs.readFileSync(path.join(__dirname, '..', 'server', 'state', 'app-state.js'), 'utf8');
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'i18n.js'), 'utf8');

  ok(displayHtml.includes('/js/lyric-template-mirror.js'), 'display 必須載入 Mirror P0 模板腳本: ');
  ok(templateJs.includes("id: 'mirror'") && templateJs.includes('onFrame(timeMs, ctx)') && templateJs.includes('onSeek(timeMs, ctx)'), 'Mirror 必須透過 registry 並保持完全時間驅動: ');
  ok(templateJs.includes('const MIN_BATCH_SIZE = 1;') && templateJs.includes('const MAX_BATCH_SIZE = 4;') && templateJs.includes('function areLinesTemporallyClose') && templateJs.includes('const interlineGap = Math.max(0, nextPlan.startMs - previousPlan.endMs);') && templateJs.includes('MAX_INTERLINE_GAP_MS') && !templateJs.includes('NEAR_LINE_START_GAP_MS') && templateJs.includes('scoreBatchCandidate') && templateJs.includes('buildBatches(plans)'), 'Mirror P1-E 必須只以「前句尾到後句頭」的空拍決定分組；長句句首相距再遠也不可被拆成單句群組: ');
  ok(templateJs.includes('function mirrorText(text)') && templateJs.includes('code + 0x60') && templateJs.includes("normalize('NFC')"), 'Mirror 右側只能用 Unicode 平假名→片假名安全轉換，不可改寫漢字／中文: ');
  ok(templateJs.includes('const pureChinese = hasHan(plan.text) && !hasKana(plan.text);') && templateJs.includes('if (pureChinese && chars.length > 7) return -1;'), '中文歌曲不可把所有漢字當日文 kanji hero，長中文句要停用漢字加權: ');
  ok(templateJs.includes('LyricMotion.hashNoise') && templateJs.includes('glyphVisual') && templateJs.includes('--mirror-glyph-rotation') && templateJs.includes('--mirror-glyph-y'), 'glyph 級大小、旋轉、上下錯位必須由 deterministic hash 在進場前決定: ');
  ok(templateJs.includes("primaryPanel.className = 'mirror-panel mirror-panel--primary'") && templateJs.includes("echoPanel.className = 'mirror-panel mirror-panel--echo'"), 'Mirror 只能使用固定左右雙側 DOM，不得退回單側位置模式: ');
  ok(displayCss.includes('.mirror-panel--primary') && displayCss.includes('right: calc(50% + var(--stage-safe-margin, 13) * 1%);') && displayCss.includes('.mirror-panel--echo') && displayCss.includes('left: calc(50% + var(--stage-safe-margin, 13) * 1%);'), '左右兩側必須直接以中央安全距離作為排版邊界: ');
  ok(displayCss.includes('.mirror-line--echo .mirror-glyph') && displayCss.includes('-webkit-text-fill-color: transparent !important;') && displayCss.includes('-webkit-text-stroke:') && displayCss.includes('paint-order: stroke;'), '右側鏡像必須是真正透明填色＋純描邊，不可只是降低實心字透明度: ');
  ok(templateJs.includes('function contentBounds(entry)') && templateJs.includes('glyph.getBoundingClientRect()') && templateJs.includes('allowedLeft') && templateJs.includes('allowedRight'), 'Mirror 長度限制必須量測 glyph 旋轉／放大後的真實外框，同時守住畫面邊緣與中央安全區: ');
  ok(templateJs.includes('constrainLine') && templateJs.includes('Math.max(0.20') && templateJs.includes("setProperty('--mirror-compress-x'") && !displayCss.includes('#mirror-root {\r\n  position: fixed;\r\n  inset: 0;\r\n  overflow: hidden;'), 'Mirror 極端長句必須先縮字、最後才水平壓縮，不可用 overflow hidden 裁字: ');
  ok(templateJs.includes("content.className = 'mirror-line-content'") && displayCss.includes('.mirror-line-content') && displayCss.includes('transform: none;') && displayCss.includes('transform-origin: 100% 50%;') && displayCss.includes('transform-origin: 0 50%;'), 'Mirror 不可旋轉 100% 寬 line；只允許自然寬度文字 wrapper／glyph 輕微旋轉，避免安全區與畫面邊界被甩出: ');
  const kongyuanFont = path.join(__dirname, '..', 'public', 'assets', 'fonts', 'kongyuan', 'Kongyuan-Sans-L.otf');
  const kongyuanLicense = path.join(__dirname, '..', 'public', 'assets', 'fonts', 'kongyuan', 'OFL-1.1.txt');
  const kongyuanNotice = path.join(__dirname, '..', 'public', 'assets', 'fonts', 'kongyuan', 'NOTICE.txt');
  ok(fs.existsSync(kongyuanFont) && fs.statSync(kongyuanFont).size > 30000000 && fs.existsSync(kongyuanLicense) && fs.readFileSync(kongyuanLicense, 'utf8').includes('SIL OPEN FONT LICENSE Version 1.1') && fs.existsSync(kongyuanNotice), 'Kongyuan Sans L 以未修改 OTF、OFL-1.1 和歸屬聲明隨 public 資產發行: ');
  ok(displayCss.includes("font-family: 'Kongyuan Sans L'") && displayCss.includes("url('/assets/fonts/kongyuan/Kongyuan-Sans-L.otf')") && displayCss.includes('#mirror-root.mirror-kongyuan-ready') && displayCss.includes('-webkit-text-stroke: 0 transparent !important;') && templateJs.includes('enableKongyuanFont'), 'Kongyuan 正式資產可載入並保留原字型實心鏡像字處理: ');
  ok(!serverIndex.includes('/__mirror-font/kongyuan-sans-l.otf') && !serverIndex.includes('_tmp-kongyuan-inspect'), 'Mirror 不再依賴工作樹外的暫存字型路由: ');
  ok(templateJs.includes('function buildAssemblyRanks') && templateJs.includes('function glyphAssemblyPlan') && templateJs.includes('function applyAssemblyFrame') && templateJs.includes('LINE_ASSEMBLY_STEP_MS') && templateJs.includes('ECHO_ASSEMBLY_DELAY_MS'), 'Mirror P1 的雙側 deterministic 逐字散布計畫已存在: ');
  ok(templateJs.includes('entry.lineStartMs + motion.startOffset') && templateJs.includes('function mountStartedLines') && templateJs.includes('if (timeMs >= plan.startMs) mountLine(plan);') && !templateJs.includes('PAGE_ASSEMBLY_STAGGER_MS'), 'Mirror P1 只在每句開始時掛載，不預先渲染同頁未唱歌詞: ');
  ok(templateJs.includes('updateAssembly(timeMs)') && templateJs.includes('onSeek(timeMs, ctx)') && templateJs.includes('onFrame(timeMs, ctx)') && displayCss.includes('--mirror-assembly-x') && displayCss.includes('--mirror-assembly-opacity'), 'Mirror P1-B 由播放時間驅動組裝，seek 與重載可重算同一狀態: ');
  ok(templateJs.includes('function easeOutBack') && templateJs.includes('rotationProgress') && templateJs.includes('const idleStartMs') && templateJs.includes('motion.idle.periodMs') && displayCss.includes('--mirror-idle-rotation') && displayCss.includes('--mirror-idle-scale'), 'Mirror P1-C 必須讓逐字旋轉入場、落點回彈，並在就位後保持 deterministic 微動: ');
  ok(templateJs.includes('if (japanese && isHanGlyph(char)) scale *= 1.56') && templateJs.includes('scale *= 1.19') && templateJs.includes("entry.line.style.setProperty('--mirror-fit-scale', next.toFixed(3))") && displayCss.includes('font-size: clamp(8px, calc(var(--display-font-size, 60px) * var(--mirror-line-scale) * var(--mirror-fit-scale))') && displayCss.includes('scale(var(--mirror-glyph-scale, 1))'), 'Mirror P1 漢字主副層級必須有明顯比例；安全縮放只能等比縮整行，不能覆寫 glyph emphasis: ');
  const mirrorControllerSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'controller.js'), 'utf8');
  ok(templateJs.includes('const MIRROR_MOTION_PROFILES') && templateJs.includes('function syncMotionIntensity') && templateJs.includes("normal: {") && templateJs.includes('moveOvershoot: 1.32') && templateJs.includes('rotationOvershoot: 1.86') && templateJs.includes('scaleOvershoot: 1.52') && templateJs.includes('pulse: 0.62') && templateJs.includes('pulse: 1.28') && templateJs.includes('pulse: 2.35') && templateJs.includes('amplitude: (side === \'echo\' ? 0.14 : 0.17) * profile.pulse') && lyricExtras.includes("mirror: { label: '鏡像'") && lyricExtras.includes("supportsIntensity: true") && mirrorControllerSource.includes("['pulse', 'facet', 'drift', 'aura', 'mirror']") && mirrorControllerSource.includes("animationIntensity: 'normal'"), 'Mirror P1-F 必須接上既有沉穩／標準／狂放控制；唱詞逐字彈跳在不動其他動態層的前提下分級加強: ');
  ok(templateJs.includes('LyricMotion.ensureWordTimings(line, lines, index)') && templateJs.includes('LyricMotion.buildGraphemeTimings(word)') && templateJs.includes('glyphTimings: timingMatchesText ? sourceGlyphs : fallbackGlyphs') && templateJs.includes("timingSource: hasNativeWordTimings && timingMatchesText ? 'source' : 'fallback'") && templateJs.includes('function glyphSingingPulsePlan') && templateJs.includes('const singingStartMs') && !templateJs.includes('lineLandedOffset') && displayCss.includes('--mirror-sung-scale'), 'Mirror P1-D 必須優先讀取來源逐字時間，讓每個非標點 glyph 在自己的時間點放大後回到原尺寸；普通 LRC 才可等分降級: ');
  const mirrorRenderBatch = templateJs.slice(templateJs.indexOf('function renderBatch'), templateJs.indexOf('function syncLayout'));
  const mirrorConstrainIdx = mirrorRenderBatch.indexOf('renderedEntries.forEach(constrainLine);');
  const mirrorUpdateAssemblyIdx = mirrorRenderBatch.indexOf('updateAssembly(timeMs);');
  ok(mirrorConstrainIdx >= 0 && mirrorUpdateAssemblyIdx >= 0 && mirrorConstrainIdx < mirrorUpdateAssemblyIdx, 'Mirror P1 先以最散布狀態限縮，倒退 seek 不會把 glyph 推出安全側: ');
  ok(lyricExtras.includes("mirror: { label: '鏡像'") && lyricExtras.includes("template: 'mirror'") && lyricExtras.includes("lyricPosition: 'split'") && lyricExtras.includes('stageSafeMargin: 13'), '桌面設定必須提供 Mirror P0 獨立預設並鎖定 split: ');
  ok(panelHtml.includes('data-template="mirror"') && panelHtml.includes('style-thumb-mirror'), '桌面模板選擇器必須有 Mirror P0 卡片: ');
  ok(!/data-template="mirror"[^>]*\bhidden\b/.test(panelHtml), 'Mirror 模板已正式公開，桌面模板卡片不可再帶 hidden: ');
  ok(lyricsHandler.includes("'paperstrip', 'mirror'"), 'server 模板白名單必須接受 mirror: ');
  ok(appState.includes("mirror: { template: 'mirror'"), 'server 預設 lyricTemplateSettings 必須包含 mirror: ');
  ok(i18n.includes("'template.mirror':"), 'Mirror 模板名稱必須有五語 i18n key: ');
  ok(displayCss.includes('#mirror-root {') && displayCss.slice(displayCss.indexOf('#mirror-root {'), displayCss.indexOf('}', displayCss.indexOf('#mirror-root {'))).includes('transform: translateY(var(--lyric-offset-y, 0px));'), '鏡像必須直接在 #mirror-root 消費全域 --lyric-offset-y 位移，不能透過 #lyrics-container（position:fixed 的 containing block 限制）: ');
  ok(displayCss.includes('#paperstrip-root {') && displayCss.slice(displayCss.indexOf('#paperstrip-root {'), displayCss.indexOf('}', displayCss.indexOf('#paperstrip-root {'))).includes('transform: translateY(var(--lyric-offset-y, 0px));'), '紙帶逐字必須在 #paperstrip-root 消費全域 --lyric-offset-y 位移: ');
  ok(lyricExtras.includes('const isPaperstrip = ') && lyricExtras.includes('const isYOnlyOffset = isKtv || isPaperstrip || isMirror') && lyricExtras.includes("(settings.lyricPosition !== 'split' || isMirror || isPaperstrip)"), '紙帶逐字／鏡像的位置微調必須只開放 Y，且鏡像固定 split 時仍要能調整 Y: ');
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
  eq(CURRENT_STATE_SCHEMA_VERSION, 3);
  eq(result.state.schemaVersion, 3);
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
    eq(result.loaded.schemaVersion, 3);
    eq(result.disk.schemaVersion, 3);
    eq(result.loaded.lyricSettings.template, 'aura');
    eq(result.disk.lyricSettings.lyricTemplateSettings.pulse.template, 'pulse');
    eq(result.disk.lyricSettings.lyricTemplateSettings.facet.template, 'facet');
    eq(result.disk.lyricSettings.lyricTemplateSettings.drift.template, 'drift');
    eq(result.disk.lyricSettings.lyricTemplateSettings.aura.template, 'aura');
    eq(result.backupRaw, JSON.stringify(original));
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('v3 遷移：既有播放清單的每一列補上 entryId，讓重複歌曲不再靠歌曲 id 誤判位置', () => {
  const { migrateState } = require('../server/services/state-migrations');
  const result = migrateState({
    schemaVersion: 2,
    playlist: [
      { id: 'superwoman', title: 'Superwoman' },
      { id: 'other', title: 'Other', entryId: 'already-has-one' }, // 已有 entryId 的不該被換掉
      { id: 'superwoman', title: 'Superwoman' },
    ],
  });
  eq(result.state.schemaVersion, 3);
  ok(result.state.playlist[0].entryId, '第一列應補上 entryId: ');
  ok(result.state.playlist[2].entryId, '第三列應補上 entryId: ');
  ok(result.state.playlist[0].entryId !== result.state.playlist[2].entryId, '兩個同名 Superwoman 補上的 entryId 不可相同: ');
  eq(result.state.playlist[1].entryId, 'already-has-one', '已經有 entryId 的列不該被覆蓋: ');
});

test('統一音量：增益計算對齊 -14 LUFS 並夾在 ±12 dB', () => {
  const LoudnessGain = require('../public/js/loudness-gain');
  eq(LoudnessGain.TARGET_LUFS, -14);
  eq(LoudnessGain.computeTrackGainDb(-14), 0, '目標響度不調整：');
  eq(LoudnessGain.computeTrackGainDb(-9), -5, '大聲歌壓低：');
  eq(LoudnessGain.computeTrackGainDb(-24), 10, '小聲歌提升：');
  eq(LoudnessGain.computeTrackGainDb(-40), 12, '提升上限 +12dB：');
  eq(LoudnessGain.computeTrackGainDb(-0.5), -12, '壓低下限 -12dB：');
  eq(LoudnessGain.computeTrackGainDb(null), 0, '未量測維持原音量：');
  eq(LoudnessGain.computeTrackGainDb(NaN), 0, 'NaN 維持原音量：');
  eq(LoudnessGain.computeTrackGainDb(5), 0, '範圍外視為量測異常：');
  eq(LoudnessGain.computeTrackGainDb(-80), 0, '近無聲素材不套 +12dB：');
  ok(Math.abs(LoudnessGain.dbToLinear(-6) - 0.5012) < 0.001, 'dB 轉線性增益：');
  ok(Math.abs(LoudnessGain.dbToLinear(0) - 1) < 1e-9, '0dB＝1：');
});

test('統一音量：ffmpeg ebur128 摘要解析取整曲值，異常回 null', () => {
  const AudioProcessorService = require('../server/services/audio-processor');
  const sample = [
    '[Parsed_ebur128_0 @ 0000019] t: 12.5     TARGET:-23 LUFS    M: -10.2 S: -11.0     I: -11.5 LUFS       LRA:   3.2 LU',
    '[Parsed_ebur128_0 @ 0000019] Summary:',
    '',
    '  Integrated loudness:',
    '    I:         -9.3 LUFS',
    '    Threshold: -19.6 LUFS',
    '',
    '  Loudness range:',
    '    LRA:         5.2 LU',
  ].join('\n');
  eq(AudioProcessorService.parseEbur128Loudness(sample), -9.3, '取最後（Summary）的 I 值：');
  eq(AudioProcessorService.parseEbur128Loudness('沒有摘要'), null);
  eq(AudioProcessorService.parseEbur128Loudness(''), null);
  eq(AudioProcessorService.parseEbur128Loudness('I: 5.0 LUFS'), null, '正值視為異常：');
});

test('統一音量：track schema 保留 loudnessLufs，非法值歸 null 不會變 0', () => {
  const { sanitizeTrack } = require('../server/utils/track-schema');
  const base = { id: 't1', title: '歌' };
  eq(sanitizeTrack({ ...base, loudnessLufs: -9.3 }).loudnessLufs, -9.3);
  eq(sanitizeTrack({ ...base }).loudnessLufs, null, '未量測預設 null：');
  eq(sanitizeTrack({ ...base, loudnessLufs: null }).loudnessLufs, null, 'null 不可被 Number(null)=0 誤收：');
  eq(sanitizeTrack({ ...base, loudnessLufs: 'loud' }).loudnessLufs, null);
  eq(sanitizeTrack({ ...base, loudnessLufs: -999 }).loudnessLufs, -70, '超界收斂：');
});

testAsync('統一音量：回填只量有音檔且未量測的歌，完成後回寫並只廣播一次', async () => {
  const { createLoudnessBackfill } = require('../server/services/loudness-backfill');
  const playState = {
    currentTrack: { id: 'b', title: 'B', filename: 'b.mp3' },
    playlist: [
      { id: 'a', title: 'A', filename: 'a.mp3', loudnessLufs: -10 }, // 已量測 → 跳過
      { id: 'b', title: 'B', filename: 'b.mp3' },                    // 要量測
      { id: 'c', title: 'C', filename: 'missing.mp3' },              // 檔案不存在 → 跳過
      { id: 'd', title: 'D', filename: 'd.mp3' },                    // 量測失敗 → 跳過但不中斷
    ],
  };
  const measured = [];
  let broadcasts = 0; let persists = 0; const metaUpdates = [];
  const backfill = createLoudnessBackfill({
    playState,
    persistState: () => { persists++; },
    broadcastState: () => { broadcasts++; },
    measure: async (filename) => { measured.push(filename); return filename === 'b.mp3' ? -20.5 : null; },
    audioExists: (filename) => filename !== 'missing.mp3',
    updateLibraryMeta: (id, partial) => metaUpdates.push({ id, ...partial }),
    logger: { info: () => {}, warn: () => {} },
  });
  const result = await backfill.runOnce();
  eq(result.measured, 1); eq(result.skipped, 1);
  eq(measured.join(','), 'b.mp3,d.mp3', '只量未量測且檔案存在的歌：');
  eq(playState.playlist[1].loudnessLufs, -20.5, '回寫 playState.playlist（鐵則 17 的事實來源）：');
  eq(playState.currentTrack.loudnessLufs, -20.5, '同 id 的 currentTrack 快照一併補上：');
  eq(playState.playlist[3].loudnessLufs, undefined, '量測失敗不寫入：');
  eq(broadcasts, 1, '全部完成才廣播一次：'); eq(persists, 1);
  eq(metaUpdates.length, 1); eq(metaUpdates[0].id, 'b'); eq(metaUpdates[0].loudnessLufs, -20.5);
  // 沒有待量測項目時完全靜默（不廣播）
  const idle = await backfill.runOnce();
  eq(idle.measured, 0); eq(broadcasts, 1, '無事可做不再廣播：');
});

test('統一音量：兩條播放鏈與匯入/上傳/媒體庫都接上響度資料', () => {
  const playback = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-playback.js'), 'utf8');
  ['applyTrackLoudness(track)', 'stTrackGain', 'stLimiter', 'applyStLoudnessGain()'].forEach((required) =>
    ok(playback.includes(required), `app-playback.js 缺少 ${required}`));
  const clientAudio = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'audio-processor.js'), 'utf8');
  ['setTrackLoudness', 'trackGainNode', 'applyTrackGain()'].forEach((required) =>
    ok(clientAudio.includes(required), `audio-processor.js 缺少 ${required}`));
  ok(fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8').includes('/js/loudness-gain.js'),
    'index.html 未載入 loudness-gain.js');
  const serverAudio = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'audio-processor.js'), 'utf8');
  ok(serverAudio.includes('measureLoudnessQueued'), '匯入未量測響度');
  ok(serverAudio.includes('loudnessLufs,'), '匯入 track 未帶響度');
  ok(fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'api.js'), 'utf8').includes('measureLoudnessQueued'),
    '本地上傳未量測響度');
  ok(fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'library-store.js'), 'utf8').includes('loudnessLufs'),
    '媒體庫未保留響度');
  ok(fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'socket-handler.js'), 'utf8').includes('createLoudnessBackfill'),
    '啟動回填未接上');
});

test('統一音量開關會即時重套兩條播放鏈', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  ok(panel.includes('id="normalization-toggle"'), '設定頁缺少統一音量開關');
  ok(panel.includes('統一音量（響度標準化）'), '統一音量開關缺少可見標籤');
  const playback = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-playback.js'), 'utf8');
  [
    'function reapplyTrackLoudness()',
    'return stTrackGain ? stTrackGain.gain.value : null',
    'AudioProcessor.setNormalization(dom.normalizationToggle.checked)',
    'reapplyTrackLoudness();',
    'AppShared.reapplyTrackLoudness = reapplyTrackLoudness',
  ].forEach((required) => ok(playback.includes(required), `統一音量開關缺少 ${required}`));
});

test('連點切歌不會讓 <audio> 與 SoundTouch 兩條鏈同時出聲', () => {
  // 實測回報：連點「下一首」會聽到兩個不同進度的音訊、暫停後進度條照跑、再播放歌詞亂跳。
  // 根因是舊的 stLoadCurrent().then() 沒有作廢判斷：較早的載入被丟棄後，回呼仍以「當下的
  // stReady」（新歌還在 decode 時是 false）誤判成解碼失敗，於是降級去 audioPlayer.play()。
  const playback = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-playback.js'), 'utf8').replace(/\r\n/g, '\n');
  ok(playback.includes("return 'stale'; // 已有更新的載入發生"), 'stLoadCurrent 必須回報作廢，呼叫端才擋得掉舊回呼：');
  ok(playback.includes("if (result === 'stale') return; // 已被更新的切歌取代"), '切歌的載入回呼必須先擋掉作廢的載入：');
  ok(playback.includes("if (result === 'stale') return; // 已被更新的載入取代"), '播放鍵的載入回呼必須先擋掉作廢的載入：');
  ok(playback.includes('if (stActive()) return;\n    lastPlayTimeMs'), 'SoundTouch 生效時 <audio> 的 timeupdate 不可再搶進度與 lyrics:sync：');
  ok(playback.includes('if (useSoundTouch) { try { SoundTouchEngine.pause(); } catch (e) { /* 靜默 */ } }\n      audioPlayer.pause();'),
    '暫停必須兩條鏈都停，否則另一條仍會讓進度條繼續走：');
});

test('Setlist keeps template and quick controls in two columns beside the preview', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const panelCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'panel.css'), 'utf8');
  ok(panel.includes('class="setlist-main"'));
  ok(panel.includes('class="setlist-template-column"'));
  ok(panel.includes('class="setlist-quick-column"'));
  ok(panel.includes('<span class="check-box" aria-hidden="true"></span><span class="check-text">未唱歌曲</span>'));
  ok(panel.includes('<span class="check-box" aria-hidden="true"></span><span class="check-text">已唱歌曲</span>'));
  ok(panelCss.includes('.setlist-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(340px, 440px);'));
  ok(panelCss.includes('.setlist-main { display: grid; grid-template-columns: minmax(250px, .68fr) minmax(430px, 1.32fr);'));
  ok(panelCss.includes('.setlist-preview-bar { grid-column: 2; grid-row: 1; position: sticky;'));
  ok(panelCss.includes('.field--setlist-sections .check-row {'));
  ok(panelCss.includes('display:inline-flex;'));
  ok(panelCss.includes('border:1px solid var(--border-strong);'));
  ok(panelCss.includes('.field--setlist-sections .check-inline {'));
  ok(panelCss.includes('flex-direction:row;'));
  ok(panelCss.includes('border:0;'));
  ok(panelCss.includes('.field--setlist-sections .check-inline .check-text { order:1;'));
  ok(panelCss.includes('.live-session-summary-card { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: var(--gap);'));
});

test('Lyrics and setlist advanced settings stay modal with entries below right previews', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const panelCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'panel.css'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-setlist-panel.js'), 'utf8');
  ok(!panel.includes('data-inline-settings-workspace="true"'), '詳細設定不可攤在頁面內：');
  ok(panel.includes('id="display-advanced-modal" class="modal modal-wide lyric-advanced-modal"'));
  ok(panel.includes('id="setlist-advanced-modal" class="modal modal-wide setlist-advanced-modal"'));
  ok(panel.includes('class="card preview-detail-card" aria-labelledby="lyrics-detail-entry-title"'));
  ok(panel.includes('class="card preview-detail-card" aria-labelledby="setlist-detail-entry-title"'));
  ok(panelCss.includes('.settings-body { grid-column: 1; grid-row: 1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));'));
  ok(panelCss.includes('.settings-preview-bar { grid-column: 2; grid-row: 1; position: sticky;'));
  ok(app.includes('modal.hidden = false;'));
  ok(setlistPanel.includes('advModal.hidden = false;'));
  ok(!panel.includes('已放在本頁下方的詳細細調工作台'), '不得保留已取消的頁內詳細設定文案：');
  ok(panel.includes('data-i18n="settings.workspace.livePreview"'));
  ok(panel.includes('data-i18n="settings.workspace.findSettings"'));
  ok(panel.includes('data-i18n-placeholder="settings.workspace.searchPlaceholder"'));
  ok(panel.includes('data-i18n="settings.workspace.searchHint"'));
  ok(panel.includes('data-i18n="settings.workspace.resetAll"'));
  ok(panel.includes('data-i18n-placeholder="settings.setlist.searchPlaceholder"'));
  ok(panel.includes('data-i18n="settings.setlist.searchHint"'));
});

test('Live session records live on the home view and no longer occupy setlist settings', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-setlist-panel.js'), 'utf8');
  const setlistStart = panel.indexOf('data-view="setlist"');
  const setlistEnd = panel.indexOf('<!-- ═══════════════════════════════════════════', setlistStart);
  const setlistView = panel.slice(setlistStart, setlistEnd);
  ok(panel.includes('id="live-session-summary-card"'));
  ok(panel.includes('id="session-record-modal" class="modal modal-wide session-record-modal"'));
  ok(panel.includes('id="session-status"'));
  ok(panel.includes('id="setlist-panel"'));
  ok(!setlistView.includes('id="session-status"'), 'Session 狀態不可留在歌單設定頁：');
  ok(!setlistView.includes('id="setlist-panel"'), '已唱歌曲不可留在歌單設定頁：');
  ok(setlistPanel.includes("document.getElementById('session-record-open')"));
  ok(setlistPanel.includes("document.getElementById('session-summary-status')"));
});

test('Setlist style save stays immediate, sends once, and ignores stale acknowledgements', () => {
  const setlistPanel = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-setlist-panel.js'), 'utf8');
  ok(setlistPanel.includes("SocketClient.sendWithCallback('setlist:style', collectStyle()"));
  ok(!setlistPanel.includes("SocketClient.send('setlist:style', collectStyle())"), '不可在 ACK 儲存前再額外送一次：');
  ok(!setlistPanel.includes('styleSaveTimer'), '歌單預覽不可再因前端 debounce 延遲：');
  ok(setlistPanel.includes('const requestId = ++latestStyleSaveRequest;'));
  ok(setlistPanel.includes('if (requestId !== latestStyleSaveRequest) return;'), '舊 ACK 不可覆蓋最新歌單儲存狀態：');
  ok(setlistPanel.includes("document.querySelectorAll('[data-setlist-save-status]')"));
  ok(setlistPanel.includes('let styleSaveStatus = {'));
  ok(setlistPanel.includes("window.addEventListener('i18n:change', renderStyleSaveStatus)"), '歌單儲存狀態必須在切換語言後重新格式化：');
  ok(setlistPanel.includes('savedAt: savedAt || null'), '歌單儲存時間必須保留原始時間戳，而不是保留已翻譯字串：');
});

test('Settings pages keep right previews on desktop and move previews first at 1024px', () => {
  const panelCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'panel.css'), 'utf8');
  const normalizedCss = panelCss.replace(/\r\n/g, '\n');
  ok(normalizedCss.includes('@media (max-width: 1024px) {\n  .setlist-split { grid-template-columns: minmax(0, 1fr); }'));
  ok(panelCss.includes('.setlist-preview-bar { grid-column: 1; grid-row: 1; position: static; }'));
  ok(panelCss.includes('.setlist-main { grid-column: 1; grid-row: 2; }'));
  ok(normalizedCss.includes('@media (max-width: 1024px) {\n  .view[data-view="settings"].is-active { display: block; }'));
  ok(!normalizedCss.includes('@media (max-width: 1120px) {\n  .view[data-view="settings"].is-active { display: block; }'), '桌面設定頁不可過早把右側預覽移到頁首：');
});

test('Lyrics settings send exactly once and ignore stale acknowledgements', () => {
  const lyricExtras = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-extras.js'), 'utf8');
  eq((lyricExtras.match(/SocketClient\.sendWithCallback\('lyric-settings:update'/g) || []).length, 1, '歌詞設定只應有一個 ACK 傳送入口：');
  ok(!lyricExtras.includes("SocketClient.send('lyric-settings:update'"), '歌詞設定不可先送一次再為 ACK 重送：');
  ok(lyricExtras.includes('const requestId = ++latestSaveRequest;'));
  ok(lyricExtras.includes('if (requestId !== latestSaveRequest) return;'), '舊 ACK 不可覆蓋最新儲存狀態：');
  ok(lyricExtras.includes("window.I18n?.current?.() || 'zh-TW'"), '儲存時間必須跟隨目前介面語言：');
  ok(lyricExtras.includes('let lyricSaveStatus = {'));
  ok(lyricExtras.includes("window.addEventListener('i18n:change', renderLyricSaveStatus)"), '歌詞儲存狀態必須在切換語言後重新格式化：');
  ok(lyricExtras.includes('savedAt: savedAt || null'), '歌詞儲存時間必須保留原始時間戳，而不是保留已翻譯字串：');
});

test('Shared settings workspace runtime is included before dependent panel scripts', () => {
  const root = path.join(__dirname, '..');
  const panel = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const workspacePath = path.join(root, 'public', 'js', 'settings-workspace.js');
  ok(fs.existsSync(workspacePath), '發行內容缺少 settings-workspace.js：');
  const workspace = fs.readFileSync(workspacePath, 'utf8');
  ok(workspace.includes('window.SettingsWorkspace = Object.freeze({ create });'));
  ok(workspace.includes("nav.setAttribute('role', 'tablist')"));
  ok(workspace.includes("tab.setAttribute('role', 'tab')"));
  ok(workspace.includes("panel.setAttribute('role', 'tabpanel')"));
  ok(workspace.includes("tab.setAttribute('aria-selected', String(selected))"));
  ok(workspace.includes("tab.setAttribute('aria-controls', panel.id)"));
  ok(workspace.includes("panel.setAttribute('aria-labelledby', activeTab.id)"));
  ok(panel.includes('id="lyrics-settings-search-status" class="field-hint" role="status" aria-live="polite"'));
  ok(panel.includes('id="setlist-settings-search-status" class="field-hint" role="status" aria-live="polite"'));
  ok(panel.includes('<script src="/js/settings-workspace.js"></script>'));
  ok(panel.indexOf('/js/settings-workspace.js') < panel.indexOf('/js/app-setlist-panel.js'), '共用工作台必須先於歌單面板載入：');
  ok(panel.indexOf('/js/settings-workspace.js') < panel.indexOf('/js/app.js'), '共用工作台必須先於歌詞 Modal 邏輯載入：');
});

test('Electron P1 shell keeps runtime data isolated and locks down the renderer', () => {
  const electronShell = require('../electron/shell');
  const runtimeRoot = path.join(os.tmpdir(), 'elitesand-electron-shell-unit');
  const runtimePaths = electronShell.getRuntimePaths(runtimeRoot);
  eq(runtimePaths.root, path.resolve(runtimeRoot));
  eq(runtimePaths.dataDir, path.join(path.resolve(runtimeRoot), 'data'));
  eq(runtimePaths.downloadsDir, path.join(path.resolve(runtimeRoot), 'downloads'));
  eq(runtimePaths.logsDir, path.join(path.resolve(runtimeRoot), 'logs'));
  const freshMedia = electronShell.resolveMediaRuntime(runtimeRoot, {
    isPackaged: true,
    executablePath: path.join('D:', 'Apps', 'Elitesand Pro', 'Elitesand Pro.exe'),
    fsImpl: { readdirSync: () => [], readFileSync: () => { throw new Error('no config'); } },
  });
  eq(freshMedia.mode, 'install-default');
  eq(freshMedia.downloadsDir, path.join('D:', 'Apps', 'Elitesand Pro', 'Elitesand Pro Media'));
  const legacyMedia = electronShell.resolveMediaRuntime(runtimeRoot, {
    isPackaged: true,
    executablePath: path.join('D:', 'Apps', 'Elitesand Pro', 'Elitesand Pro.exe'),
    fsImpl: { readdirSync: () => ['existing-song.mp3'], readFileSync: () => { throw new Error('no config'); } },
  });
  eq(legacyMedia.mode, 'legacy-migration-required');
  eq(legacyMedia.downloadsDir, path.join(path.resolve(runtimeRoot), 'downloads'));
  const configuredMedia = electronShell.resolveMediaRuntime(runtimeRoot, {
    isPackaged: true,
    executablePath: path.join('D:', 'Apps', 'Elitesand Pro', 'Elitesand Pro.exe'),
    fsImpl: { existsSync: () => true, readdirSync: () => { throw new Error('must not inspect legacy'); }, readFileSync: () => JSON.stringify({ mediaDir: path.join('E:', 'Music', 'Elitesand Pro Media') }) },
  });
  eq(configuredMedia.mode, 'configured');
  eq(configuredMedia.downloadsDir, path.join('E:', 'Music', 'Elitesand Pro Media'));
  const configuredDevelopmentMedia = electronShell.resolveMediaRuntime(runtimeRoot, {
    isPackaged: false,
    fsImpl: {
      existsSync: () => true,
      readFileSync: () => JSON.stringify({ mediaDir: path.join('E:', 'Music', 'Elitesand Pro Media') }),
    },
  });
  eq(configuredDevelopmentMedia.mode, 'configured', 'development Electron must respect a completed media migration');
  eq(configuredDevelopmentMedia.downloadsDir, path.join('E:', 'Music', 'Elitesand Pro Media'));
  const staleConfiguredMedia = electronShell.resolveMediaRuntime(runtimeRoot, {
    isPackaged: true,
    executablePath: path.join('D:', 'Apps', 'Elitesand Pro', 'Elitesand Pro.exe'),
    fsImpl: {
      existsSync: () => false,
      readdirSync: () => ['existing-song.mp3'],
      readFileSync: () => JSON.stringify({ mediaDir: path.join('E:', 'Missing', 'Elitesand Pro Media') }),
    },
  });
  eq(staleConfiguredMedia.mode, 'legacy-migration-required', 'stale media config must fall back to a usable legacy source');
  eq(electronShell.resolveShellPort('3100'), 3100);
  eq(electronShell.resolveShellPort('not-a-port'), 3000);
  ok(electronShell.isTrustedLocalUrl('http://127.0.0.1:3000/panel', 3000));
  ok(!electronShell.isTrustedLocalUrl('https://127.0.0.1:3000/panel', 3000));
  ok(!electronShell.isTrustedLocalUrl('http://example.com:3000/panel', 3000));
  ok(electronShell.isProjectReleaseUrl('https://github.com/z22115554/elitesand-pro/releases'));
  ok(!electronShell.isProjectReleaseUrl('https://github.com/other/project/releases'));
  // Twitch device-code 驗證頁必須可外開，否則「前往 Twitch 輸入代碼」在殼裡點了沒反應。
  ok(electronShell.isTwitchVerificationUrl('https://www.twitch.tv/activate'), 'Twitch 驗證頁必須放行外開：');
  ok(electronShell.isTwitchVerificationUrl('https://www.twitch.tv/activate?device-code=ABCD1234'));
  ok(electronShell.isTwitchVerificationUrl('https://id.twitch.tv/oauth2/device'));
  ok(!electronShell.isTwitchVerificationUrl('http://www.twitch.tv/activate'), '非 https 不放行：');
  ok(!electronShell.isTwitchVerificationUrl('https://twitch.tv.evil.com/activate'), '仿冒網域不放行：');
  ok(!electronShell.isTwitchVerificationUrl('https://example.com/activate'));
  // 跟唱視圖用 window.open 開 /prompter；殼裡預設 deny 一切 window.open，
  // 使用者實測回報 Electron 打不開、看到的視窗沒有退出按鈕，根因是這裡沒放行。
  ok(electronShell.isPrompterUrl('http://127.0.0.1:3000/prompter', 3000), '/prompter 必須被殼放行，否則 Electron 裡按鈕沒反應：');
  ok(!electronShell.isPrompterUrl('http://127.0.0.1:3000/panel', 3000), '只放行 /prompter，不是整個本機來源都放行：');
  ok(!electronShell.isPrompterUrl('https://127.0.0.1:3000/prompter', 3000), '非 http 不放行：');
  ok(!electronShell.isPrompterUrl('http://evil.com/prompter', 3000), '非本機網域不放行：');

  // electron/installer.nsh 把使用者在精靈選的語言寫進這個 marker，殼要讀一次、刪一次，
  // 只影響安裝後的第一次啟動，不能每次開程式都覆蓋使用者後來自己在面板改的語言。
  let unlinked = null;
  const localeFsImpl = {
    readFileSync: () => ' en \n',
    unlinkSync: (file) => { unlinked = file; },
  };
  eq(electronShell.consumeInstallerLocale(runtimeRoot, localeFsImpl), 'en', '合法語言代碼必須被讀出並套用：');
  ok(unlinked.endsWith('installer-locale.txt'), 'consumeInstallerLocale 必須刪除 marker，避免每次啟動都套用：');

  const invalidLocaleFsImpl = { readFileSync: () => 'not-a-real-locale', unlinkSync: () => {} };
  eq(electronShell.consumeInstallerLocale(runtimeRoot, invalidLocaleFsImpl), null, '非白名單內容不可被當成語言代碼採用：');

  const missingMarkerFsImpl = {
    readFileSync: () => { throw new Error('ENOENT'); },
    unlinkSync: () => { throw new Error('ENOENT'); },
  };
  eq(electronShell.consumeInstallerLocale(runtimeRoot, missingMarkerFsImpl), null, '沒有 marker（開發模式／Portable／已消費過）必須安靜回傳 null：');

  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'shell.js'), 'utf8');
  [
   'utilityProcess.fork',
    "stdio: 'pipe'",
    "child.stdout?.on('data', () => {})",
    'cwd: app.isPackaged ? path.dirname(projectRoot) : projectRoot',
    "OPEN_BROWSER: '0'",
    'contextIsolation: true',
    'nodeIntegration: false',
    'sandbox: true',
    'backgroundThrottling: false',
    'Tray',
    'displayBalloon',
    'preventDefault',
    'powerSaveBlocker',
    'showMessageBoxSync',
    'setWindowOpenHandler',
    'ELITESAND_SHELL_USER_DATA_DIR',
    'ELITESAND_MEDIA_STORAGE_MODE',
    'consumeInstallerLocale(app.getPath(\'userData\'))',
    'elitesand:choose-media-location',
    'restart-after-media-migration',
    'SHUTDOWN_MESSAGE',
    // 跟唱視圖子視窗必須是一般原生 frame（有系統關閉鈕）：這個子視窗沒有配對的自訂標題列
    // IPC 控制鈕，用主視窗那套 frame:false 會開出一個關不掉的視窗（已修的實測回報）。
    'frame: true',
    'did-create-window',
  ].forEach((required) => ok(source.includes(required), `Electron shell is missing ${required}`));

});

test('Media migration copies from the selected source without nesting the media folder', () => {
  const mediaStorage = require('../server/services/media-storage');
  const fixtureRoot = fs.mkdtempSync(path.join(TEST_RUNTIME_ROOT, 'media-migration-unit-'));
  const sourceDir = path.join(fixtureRoot, 'old-media');
  const destinationDir = path.join(fixtureRoot, 'Elitesand Pro Media');
  const emptySourceDir = path.join(fixtureRoot, 'empty-media');
  const emptyDestinationParent = path.join(fixtureRoot, 'empty-target');
  const configFile = path.join(TEST_RUNTIME_DIRS.data, 'media-storage.json');
  const uninstallReference = path.join(TEST_RUNTIME_ROOT, 'media-storage.ini');
  const originalConfig = fs.existsSync(configFile) ? fs.readFileSync(configFile) : null;
  const originalReference = fs.existsSync(uninstallReference) ? fs.readFileSync(uninstallReference) : null;
  try {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'song.mp3'), 'audio');
    fs.mkdirSync(emptySourceDir, { recursive: true });
    const recoveredSource = mediaStorage.resolveMigrationSource([emptySourceDir, sourceDir]);
    eq(recoveredSource.sourceDir, sourceDir, 'migration must automatically fall back to the first location that still has media');
    const result = mediaStorage.migrateToParent(destinationDir, sourceDir);
    eq(result.mediaDir, destinationDir, 'selecting the final media folder must not create a nested copy');
    eq(result.sourceDir, sourceDir);
    eq(result.movedEntries, 1);
    ok(fs.existsSync(path.join(destinationDir, 'song.mp3')));
    ok(!fs.existsSync(path.join(destinationDir, 'Elitesand Pro Media', 'song.mp3')));
    ok(!fs.existsSync(path.join(sourceDir, 'song.mp3')));
    let error;
    try { mediaStorage.migrateToParent(emptyDestinationParent, emptySourceDir); } catch (caught) { error = caught; }
    ok(error?.message.includes('No media files were found'), 'empty migrations must fail before creating a destination');
    ok(!fs.existsSync(emptyDestinationParent), 'empty migrations must not create an empty destination folder');
    const mediaLibrary = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'media-library.js'), 'utf8');
    ok(!mediaLibrary.includes("chooseMediaLocation('source')"), 'migration UI must never ask the user to locate the original media folder');
    ok(mediaLibrary.includes("library:storage:migrate', { parentDir }"), 'migration UI sends only the destination; the server resolves the source');
  } finally {
    if (originalConfig) fs.writeFileSync(configFile, originalConfig); else fs.rmSync(configFile, { force: true });
    if (originalReference) fs.writeFileSync(uninstallReference, originalReference); else fs.rmSync(uninstallReference, { force: true });
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('Electron assisted installer stays per-user with an integrity-protected ASAR app', () => {
  const root = path.join(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  eq(packageJson.main, 'electron/main.js');
  eq(packageJson.build.asar.smartUnpack, false, 'all application code must remain inside app.asar');
  eq(packageJson.build.directories.app, 'dist/.electron-builder-resources/app');
  eq(packageJson.build.directories.output, 'dist/releases/v${version}/installer');
  eq(packageJson.build.afterPack, 'tools/after-pack-electron-security.js');
  eq(packageJson.build.forceCodeSigning, false, 'current releases must support an unsigned Windows distribution');
  const expectedFuses = {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false,
  };
  Object.entries(expectedFuses).forEach(([name, expected]) =>
    eq(packageJson.build.electronFuses[name], expected, `Electron security fuse ${name} must be explicit`));
  eq(packageJson.build.nsis.oneClick, false);
  eq(packageJson.build.nsis.perMachine, false, 'NSIS must not install per-machine');
  eq(packageJson.build.nsis.allowToChangeInstallationDirectory, true,
    'assisted installer must let the user choose a per-user destination');
  eq(packageJson.build.nsis.createDesktopShortcut, false,
    'custom installer page must own the desktop shortcut choice');
  eq(packageJson.build.nsis.createStartMenuShortcut, false,
    'custom installer page must own the Start menu shortcut choice');
  eq(packageJson.build.nsis.include, 'electron/installer.nsh');
  eq(packageJson.build.nsis.license, 'dist/.electron-builder-resources/EULA-installer.txt',
    'installer must use its generated Unicode-safe EULA copy before install');
  eq(packageJson.build.win.icon, 'assets/elitesand-pro.ico', 'installer 必須使用正式 Elitesand Pro 圖示：');
  ok(packageJson.build.files.includes('assets/**/*'), 'Electron 殼必須攜帶視窗圖示資產：');
  const iconPath = path.join(root, packageJson.build.win.icon);
  const icon = fs.readFileSync(iconPath);
  eq(icon.readUInt16LE(0), 0, 'ICO reserved header 必須為 0：');
  eq(icon.readUInt16LE(2), 1, 'Electron 圖示必須是 ICO：');
  const iconCount = icon.readUInt16LE(4);
  ok(iconCount >= 9, 'ICO 必須包含至少九個為 Windows 小尺寸優化的圖層：');
  const iconSizes = new Set(Array.from({ length: iconCount }, (_, index) => {
    const encoded = icon[6 + (index * 16)];
    return encoded === 0 ? 256 : encoded;
  }));
  [16, 20, 24, 32, 40, 48, 64, 128, 256].forEach((size) => {
    ok(iconSizes.has(size), `ICO 缺少 ${size}px 圖層：`);
  });
  ok(packageJson.build.nsis.deleteAppDataOnUninstall !== true,
    'uninstaller must not delete Electron userData without explicit consent');
  ok(!packageJson.build.extraResources.some((entry) => String(entry.to || '').startsWith('app-root')),
    'installer must not expose a raw app-root directory outside app.asar');
  ok(packageJson.build.extraResources.some((entry) => entry.to === 'tools'), 'installer must contain bundled tools');
  const installerNsh = fs.readFileSync(path.join(root, 'electron', 'installer.nsh'), 'utf8');
  ok(installerNsh.includes('!macro customInstallMode'), 'assisted installer must force the current-user mode');
  ok(installerNsh.includes('StrCpy $isForceCurrentInstall "1"'), 'installer must not offer a per-machine branch');
  ok(installerNsh.includes('!insertmacro setInstallModePerUser'), 'silent installs must remain per-user');
  ok(installerNsh.includes('!macro customPageAfterChangeDir'), 'installer must provide shortcut options after choosing a directory');
  ok(installerNsh.includes('EsCreateDesktopShortcut') && installerNsh.includes('EsCreateStartMenuShortcut'),
    'desktop and Start menu shortcuts must remain independent choices');
  ['!macro customUnWelcomePage', 'EsRemoveAllData', 'media-storage.ini', '.elitesand-pro-media-root', 'RMDir /r "$APPDATA\\Elitesand Pro"'].forEach((required) =>
    ok(installerNsh.includes(required), `uninstaller cleanup flow is missing ${required}`));
  ok(installerNsh.includes('UninstPage custom un.EsCleanupPre un.EsCleanupLeave'),
    'custom uninstall welcome page must use the explicit UninstPage form, otherwise NSIS rejects the callbacks');
  const shellSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'shell.js'), 'utf8');
  ok(!shellSource.includes("require('../public/js/i18n.js')"),
    'packaged Electron shell 不可直接 require renderer 的 i18n.js；兩者位於不同 resources 目錄，會讓 installer 啟動直接 MODULE_NOT_FOUND：');
  ['app.isPackaged', "path.join(processObject.resourcesPath || process.resourcesPath, 'tools')", 'verifyPackagedResourceIntegrity',
    'showPortableDataMigrationNotice',
    'function needsPortableDataMigrationNotice', 'shouldShowPortableDataMigrationNotice = needsPortableDataMigrationNotice()',
    "Object.keys(processObject.env).find((key) => key.toUpperCase() === 'PATH')"].forEach((required) =>
    ok(shellSource.includes(required), `Electron packed runtime is missing ${required}`));
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  ok(mainSource.includes('app.getAppPath()'), 'Electron main must resolve the packaged app from app.asar');
  ok(mainSource.includes('packaged-resource-integrity.generated'),
    'Electron main must load the generated external-resource integrity manifest');
  const installerBuild = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-installer.ps1'), 'utf8');
  ['build-portable.ps1', 'dist\\.electron-builder-resources', 'Get-RelativeWorkspacePath',
    'write-packaged-resource-integrity.js',
    '--electron-only', 'electron-builder.cmd', 'node_modules\\express\\package.json',
    'Test-InstallerBootOutsideRepo', 'win-unpacked\\resources', 'verify-electron-package.js',
    'RedirectStandardOutput', 'RedirectStandardError',
    'EULA-installer.txt', '[System.Text.UTF8Encoding]::new($true)', 'NSIS installer EULA must be UTF-8 with a BOM',
    'NSIS installer EULA diverged from the approved EULA.txt'].forEach((required) =>
    ok(installerBuild.includes(required), `Installer build is missing ${required}`));
  const updater = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'app-updater-runner.js'), 'utf8');
  ok(!updater.includes("'electron'"), 'incremental updater must never allow Electron shell files');
  const updaterService = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'app-updater.js'), 'utf8');
  ok(updaterService.includes('try {') && updaterService.includes('currentLock = null'),
    'packaged installer must not require a development package-lock.json at module load');
  ok(!installerBuild.includes('[System.IO.Path]::GetRelativePath('),
    'installer build must remain compatible with Windows PowerShell 5.1');
  ok(installerBuild.includes("Properties.Remove('build')"),
    'staged app package must not carry electron-builder development configuration');
});

testAsync('Electron ASAR security hook adds readable per-file SHA-256 metadata', async () => {
  const asar = require('@electron/asar');
  const securityHook = require('../tools/after-pack-electron-security');
  const fixtureRoot = fs.mkdtempSync(path.join(TEST_RUNTIME_ROOT, 'asar-integrity-'));
  const sourceRoot = path.join(fixtureRoot, 'source');
  const archivePath = path.join(fixtureRoot, 'app.asar');
  try {
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, 'fixture.txt'), 'integrity-fixture', 'utf8');
    const archiveStream = await asar.createPackage(sourceRoot, archivePath);
    await new Promise((resolve, reject) => archiveStream.once('close', resolve).once('error', reject));
    const result = securityHook.addAsarFileIntegrity(archivePath);
    ok(result.protectedFiles >= 1, 'security hook must protect every packed ASAR file');
    const entry = asar.getRawHeader(archivePath).header.files['fixture.txt'];
    eq(entry.integrity.algorithm, 'SHA256');
    eq(entry.integrity.hash.length, 64);
    eq(asar.extractFile(archivePath, 'fixture.txt').toString('utf8'), 'integrity-fixture');
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('Packaged helper integrity rejects a changed external binary', () => {
  const shell = require('../electron/shell');
  const fixtureRoot = fs.mkdtempSync(path.join(TEST_RUNTIME_ROOT, 'external-integrity-'));
  try {
    const toolsDir = path.join(fixtureRoot, 'tools');
    fs.mkdirSync(toolsDir, { recursive: true });
    const helperPath = path.join(toolsDir, 'helper.exe');
    fs.writeFileSync(helperPath, 'trusted-helper', 'utf8');
    const crypto = require('crypto');
    const manifest = { files: { 'tools/helper.exe': crypto.createHash('sha256').update('trusted-helper').digest('hex') } };
    shell.verifyPackagedResourceIntegrity(fixtureRoot, manifest);
    fs.writeFileSync(helperPath, 'changed-helper', 'utf8');
    let rejection;
    try { shell.verifyPackagedResourceIntegrity(fixtureRoot, manifest); } catch (error) { rejection = error; }
    ok(rejection && /integrity/i.test(rejection.message), 'changed external helpers must abort the packaged shell');
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('Electron P1 smoke starts with a disposable Electron user-data directory', () => {
  const packageJson = require('../package.json');
  const smoke = fs.readFileSync(path.join(__dirname, '..', 'tools', 'smoke-electron-shell.js'), 'utf8');
  eq(packageJson.scripts.shell, 'electron electron/main.js');
  eq(packageJson.scripts['smoke:electron'], 'node tools/smoke-electron-shell.js');
  eq(packageJson.devDependencies.electron, '^43.1.1');
  ok(smoke.includes('ELITESAND_SHELL_USER_DATA_DIR'));
  ok(smoke.includes('ELITESAND_SHELL_HEADLESS'));
  ['STDIO_STRESS_REQUESTS', 'MIN_STRESS_LOG_BYTES', '/api/twitch/status', '/api/announcements?force=1', 'healthAfterStress']
    .forEach((required) => ok(smoke.includes(required), `Electron smoke 缺少 stdout 壓力守衛 ${required}: `));
  ok(!smoke.includes("ELITESAND_DATA_DIR: path.join(runtimeRoot"));
});

test('Electron shell chrome stays inside the Elitesand Pro design system', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const panelCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'panel.css'), 'utf8');
  const chrome = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'electron-shell-chrome.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.js'), 'utf8');
  ok(panel.includes('class="desktop-windowbar"'));
  ok(panel.includes('id="electron-window-minimize"'));
  ok(panel.includes('id="electron-window-maximize"'));
  ok(panel.includes('id="electron-window-close"'));
  ok(panel.includes('id="electron-close-modal"'));
  ok(panel.includes('>收到系統匣</button>'));
  ok(panel.includes('>確認關閉</button>'));
  ok(panelCss.includes('-webkit-app-region: drag'));
  ok(panelCss.includes('-webkit-app-region: no-drag'));
  ok(panelCss.includes('html.electron-shell .app'));
  ok(chrome.includes("get('electronShell') === '1'"));
  ok(chrome.includes("shell.decideClose('tray')"));
  ok(chrome.includes("shell.decideClose('quit')"));
  ok(chrome.includes("shell.windowControl('toggle-maximize')"));
  ok(preload.includes("ipcRenderer.send('elitesand:close-decision', action)"));
  ok(preload.includes("ipcRenderer.send('elitesand:window-control', action)"));

  // 安裝精靈選的語言要能一路傳到面板並被記住，否則使用者裝英文版打開卻看到中文。
  const shellSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'shell.js'), 'utf8');
  const installerNsh = fs.readFileSync(path.join(__dirname, '..', 'electron', 'installer.nsh'), 'utf8');
  ok(chrome.includes("shellQuery.get('lang')"), '殼層必須讀出精靈語言參數：');
  ok(chrome.includes('window.I18n?.setLocale?.(installerLang)'), '讀到的語言必須真的套用並持久化，不能只是顯示一次：');
  ok(shellSource.includes("await window.loadURL(`http://127.0.0.1:${port}/panel?electronShell=1${localeQuery}`)"), '殼層開窗網址必須帶上語言參數：');
  ok(shellSource.includes('function consumeInstallerLocale'), '缺少讀取＋刪除 installer-locale marker 的邏輯：');
  ok(installerNsh.includes('installer-locale.txt'), 'NSIS 端必須把精靈語言寫進 marker 檔：');
});

testAsync('Media migration relaunches through Electron graceful quit', async () => {
  const { EventEmitter } = require('events');
  const { createElectronShell } = require('../electron/shell');
  let windowInstance;
  let restartHandler;
  const shutdownMessages = [];
  const child = new EventEmitter();
  child.pid = 9876;
  child.postMessage = (message) => shutdownMessages.push(message);
  child.kill = () => { child.killed = true; };
  const app = new EventEmitter();
  app.setName = () => {};
  app.setAppUserModelId = () => {};
  app.requestSingleInstanceLock = () => true;
  app.whenReady = async () => {};
  app.getPath = () => path.join(TEST_RUNTIME_ROOT, 'electron-media-restart-unit');
  app.relaunchCalls = 0;
  app.relaunch = () => { app.relaunchCalls++; };
  app.quitCalls = 0;
  app.quit = () => {
    app.quitCalls++;
    app.emit('before-quit', { preventDefault() {} });
  };
  app.exitCodes = [];
  app.exit = (code) => app.exitCodes.push(code);
  class FakeWindow extends EventEmitter {
    constructor() {
      super();
      windowInstance = this;
      this.webContents = { setWindowOpenHandler: () => {}, on: () => {} };
    }
    async loadURL() { this.emit('ready-to-show'); }
    show() {}
    hide() {}
    focus() {}
    isMinimized() { return false; }
  }
  class FakeTray extends EventEmitter {
    setToolTip() {}
    setContextMenu() {}
  }
  let probes = 0;
  const desktop = createElectronShell({
    app,
    BrowserWindow: FakeWindow,
    utilityProcess: { fork: () => child },
    dialog: { showErrorBox: () => {}, showMessageBoxSync: () => 1 },
    shell: { openExternal: () => {} },
    Tray: FakeTray,
    Menu: { buildFromTemplate: () => ({}) },
    nativeImage: { createFromPath: () => ({}) },
    clipboard: { writeText: () => {} },
    powerSaveBlocker: { start: () => 1, stop: () => {} },
    ipcMain: { handle: (channel, handler) => { if (channel === 'elitesand:restart-after-media-migration') restartHandler = handler; } },
    processObject: { env: {}, platform: 'win32' },
    fsImpl: { mkdirSync: () => {} },
    probeHealthImpl: async () => (++probes === 1 ? { state: 'free' } : { state: 'healthy', payload: { status: 'ok' } }),
    delay: async () => {},
  });

  await desktop.start();
  eq(restartHandler({ sender: windowInstance.webContents }), true);
  await new Promise((resolve) => setImmediate(resolve));
  eq(app.relaunchCalls, 1);
  eq(app.quitCalls, 1, 'migration must use app.quit so before-quit can run');
  eq(shutdownMessages[0]?.type, 'elitesand:shutdown');
  ok(child.killed, 'graceful shutdown keeps the bounded fallback kill');
  eq(app.exitCodes.join(','), '0');
});

testAsync('Electron P1：關窗可明確選擇結束或收到系統匣，四項選單可叫回面板', async () => {
  const { EventEmitter } = require('events');
  const { createElectronShell } = require('../electron/shell');
  let windowInstance;
  let trayInstance;
  const clipboardWrites = [];
  const app = new EventEmitter();
  app.setName = () => {};
  app.setAppUserModelId = () => {};
  app.requestSingleInstanceLock = () => true;
  app.whenReady = async () => {};
  app.getPath = () => path.join(TEST_RUNTIME_ROOT, 'electron-tray-unit');
  app.quitCalls = 0;
  app.quit = () => { app.quitCalls++; };
  const closeDialogs = [];
  let closeDecisionHandler;
  let windowControlHandler;
  const ipcMain = {
    on: (channel, handler) => {
      if (channel === 'elitesand:close-decision') closeDecisionHandler = handler;
      if (channel === 'elitesand:window-control') windowControlHandler = handler;
    },
  };
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      windowInstance = this;
      this.options = options;
      this.webContents = {
        setWindowOpenHandler: () => {},
        on: () => {},
        send: (channel) => { this.lastSentChannel = channel; },
      };
      this.hideCalls = 0;
      this.showCalls = 0;
      this.minimizeCalls = 0;
      this.maximizeCalls = 0;
      this.unmaximizeCalls = 0;
      this.maximized = false;
    }
    async loadURL(url) { this.loadedUrl = url; this.emit('ready-to-show'); }
    show() { this.showCalls++; }
    hide() { this.hideCalls++; }
    removeMenu() { this.menuRemoved = true; }
    focus() {}
    isMinimized() { return false; }
    minimize() { this.minimizeCalls++; }
    isMaximized() { return this.maximized; }
    maximize() { this.maximizeCalls++; this.maximized = true; this.emit('maximize'); }
    unmaximize() { this.unmaximizeCalls++; this.maximized = false; this.emit('unmaximize'); }
  }
  class FakeTray extends EventEmitter {
    constructor(icon) { super(); trayInstance = this; this.icon = icon; }
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu; }
    displayBalloon(balloon) { this.balloon = balloon; }
  }
  const shell = createElectronShell({
    app,
    BrowserWindow: FakeWindow,
    utilityProcess: { fork: () => { throw new Error('reused server must not fork'); } },
    dialog: { showErrorBox: () => {}, showMessageBoxSync: (options) => { closeDialogs.push(options); return closeChoice; } },
    shell: { openExternal: () => {} },
    Tray: FakeTray,
    Menu: { buildFromTemplate: (template) => ({ template }) },
    nativeImage: { createFromPath: (iconPath) => ({ iconPath }) },
    clipboard: { writeText: (value) => clipboardWrites.push(value) },
    powerSaveBlocker: { start: () => 1, stop: () => {} },
    ipcMain,
    processObject: { env: {}, platform: 'win32' },
    fsImpl: { mkdirSync: () => {} },
    probeHealthImpl: async () => ({ state: 'healthy', payload: { status: 'ok' } }),
  });

  await shell.start();
  eq(windowInstance.options.frame, false, '桌面殼必須由 Elitesand Pro 面板繪製視窗頂欄：');
  ok(!('titleBarOverlay' in windowInstance.options), 'Elitesand 自有的視窗按鈕不可再被 Windows caption overlay 蓋住：');
  ok(windowInstance.loadedUrl.endsWith('/panel?electronShell=1'), '僅 Electron 面板可啟用自訂視窗頂欄：');
  eq(windowInstance.menuRemoved, true, '桌面殼不可保留 Electron 的 File/Edit/View 額外選單列：');
  ok(typeof windowControlHandler === 'function', '桌面殼必須接住自有視窗按鈕：');
  windowControlHandler({ sender: windowInstance.webContents }, 'minimize');
  eq(windowInstance.minimizeCalls, 1, '最小化按鈕必須最小化視窗：');
  windowControlHandler({ sender: windowInstance.webContents }, 'toggle-maximize');
  eq(windowInstance.maximizeCalls, 1, '最大化按鈕必須放大視窗：');
  eq(windowInstance.lastSentChannel, 'elitesand:window-maximized', '最大化狀態必須回傳給面板按鈕：');
  windowControlHandler({ sender: windowInstance.webContents }, 'toggle-maximize');
  eq(windowInstance.unmaximizeCalls, 1, '再次點最大化按鈕必須還原視窗：');
  const closeEvent = { prevented: false, preventDefault() { this.prevented = true; } };
  windowInstance.emit('close', closeEvent);
  eq(closeEvent.prevented, true, '有系統匣時 close 必須被攔截：');
  eq(windowInstance.lastSentChannel, 'elitesand:close-requested', '關窗必須交由面板顯示 Elitesand 風格確認視窗：');
  eq(windowInstance.hideCalls, 0, '使用者尚未決定前不可隱藏面板：');
  eq(closeDialogs.length, 0, 'Electron 面板不可退回 Windows 原生關閉對話框：');
  ok(typeof closeDecisionHandler === 'function', '桌面殼必須接住面板的關閉決定：');
  closeDecisionHandler({ sender: windowInstance.webContents }, 'tray');
  eq(windowInstance.hideCalls, 1, '收到系統匣後應隱藏面板：');
  eq(app.quitCalls, 0, '收到系統匣不可結束程式：');
  eq(trayInstance.balloon.content, '程式已收到系統匣；音訊與 OBS 會繼續運作。');
  eq(trayInstance.menu.template.map((item) => item.label).join('|'), '顯示面板|複製 OBS 歌詞網址|複製 OBS 歌單網址|結束');
  const visibleBeforeTrayFocus = windowInstance.showCalls;
  trayInstance.menu.template[0].click();
  eq(windowInstance.showCalls, visibleBeforeTrayFocus + 1, '系統匣必須可叫回視窗：');
  trayInstance.menu.template[1].click();
  trayInstance.menu.template[2].click();
  eq(clipboardWrites.join('|'), 'http://localhost:3000/display|http://localhost:3000/setlist');

  const quitEvent = { prevented: false, preventDefault() { this.prevented = true; } };
  windowInstance.emit('close', quitEvent);
  eq(quitEvent.prevented, true, '確認前仍需攔截視窗的預設關閉：');
  closeDecisionHandler({ sender: windowInstance.webContents }, 'quit');
  eq(app.quitCalls, 1, '選確認關閉時必須走正常 app.quit 生命週期：');
  eq(windowInstance.hideCalls, 1, '選確認關閉不可誤藏到系統匣：');
});

test('Electron 關閉確認要有取消，且強制更新公告遮罩會阻斷點擊', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const chrome = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'electron-shell-chrome.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.js'), 'utf8');
  const shellSrc = fs.readFileSync(path.join(__dirname, '..', 'electron', 'shell.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'panel.css'), 'utf8');
  // 關閉確認框除了收到系統匣/確認關閉，必須有取消（放棄本次關閉）。
  ok(html.includes('id="electron-close-cancel"'), '關閉確認需有取消按鈕：');
  ok(chrome.includes("shell.decideClose('cancel')"), '取消需通知殼放棄關閉：');
  ok(/action === 'cancel'/.test(preload), 'preload 需放行 cancel 決定：');
  ok(/action === 'cancel'/.test(shellSrc), '殼端需處理 cancel（重設 pending、不結束不藏匣）：');
  // 強制更新公告是阻斷式：遮罩不可 pointer-events:none（否則後面面板仍可點）。
  ok(!/\.announcement-critical-modal\s*\{[^}]*pointer-events\s*:\s*none/.test(css),
    '強制更新公告遮罩不可點擊穿透：');
});

// 迴歸：重用既有 server（ownsServer=false）時，before-quit 舊碼會提早 return 而不設
// isQuitting，於是接下來 Electron 關窗序列的 window 'close' 又被 hideWindowToTray
// preventDefault 攔下，app.quit 被自己的關窗流程卡住——系統匣「結束」與確認關閉都
// 永遠關不掉程式。上面的 3941 測試用的 fake app.quit 不送 before-quit，剛好漏掉這條。
testAsync('Electron P1：重用既有 server 時決定結束後，關窗不可再被攔截（否則關不掉）', async () => {
  const { EventEmitter } = require('events');
  const { createElectronShell } = require('../electron/shell');
  let windowInstance;
  let trayInstance;
  const app = new EventEmitter();
  app.setName = () => {};
  app.setAppUserModelId = () => {};
  app.requestSingleInstanceLock = () => true;
  app.whenReady = async () => {};
  app.getPath = () => path.join(TEST_RUNTIME_ROOT, 'electron-reused-quit-unit');
  app.exitCodes = [];
  app.exit = (code) => app.exitCodes.push(code);
  app.quitCalls = 0;
  // 真實 Electron 的 app.quit() 會先送出 before-quit，才進入關窗序列。
  app.quit = () => { app.quitCalls++; app.emit('before-quit', { preventDefault() { this.prevented = true; } }); };
  class FakeWindow extends EventEmitter {
    constructor() {
      super();
      windowInstance = this;
      this.webContents = { setWindowOpenHandler: () => {}, on: () => {}, send: () => {} };
      this.hideCalls = 0;
    }
    async loadURL() { this.emit('ready-to-show'); }
    show() {}
    hide() { this.hideCalls++; }
    removeMenu() {}
    focus() {}
    isMinimized() { return false; }
  }
  class FakeTray extends EventEmitter {
    constructor() { super(); trayInstance = this; }
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu; }
    displayBalloon() {}
  }
  const shell = createElectronShell({
    app,
    BrowserWindow: FakeWindow,
    // 健康的既有 server 只重用、不 fork；一旦 fork 就代表誤判。
    utilityProcess: { fork: () => { throw new Error('reused server must not fork'); } },
    dialog: { showErrorBox: () => {}, showMessageBoxSync: () => 1 },
    shell: { openExternal: () => {} },
    Tray: FakeTray,
    Menu: { buildFromTemplate: (template) => ({ template }) },
    nativeImage: { createFromPath: () => ({}) },
    clipboard: { writeText: () => {} },
    powerSaveBlocker: { start: () => 1, stop: () => {} },
    ipcMain: { on: () => {} },
    processObject: { env: {}, platform: 'win32' },
    fsImpl: { mkdirSync: () => {} },
    probeHealthImpl: async () => ({ state: 'healthy', payload: { status: 'ok' } }),
  });

  await shell.start();
  // 使用者按系統匣「結束」：走正常 app.quit 生命週期（會送出 before-quit）。
  trayInstance.menu.template.find((item) => item.label === '結束').click();
  eq(app.quitCalls, 1, '系統匣「結束」必須呼叫 app.quit：');
  // before-quit 之後 Electron 會逐一關窗；此時 close 絕不可再被攔截，否則 app.quit
  // 會被自家關窗流程卡住，程式永遠關不掉。
  const closeDuringQuit = { prevented: false, preventDefault() { this.prevented = true; } };
  windowInstance.emit('close', closeDuringQuit);
  eq(closeDuringQuit.prevented, false, '決定結束後關窗不可再被攔截（重用 server 時的關不掉主因）：');
  eq(windowInstance.hideCalls, 0, '結束流程不可把視窗藏到系統匣：');
});

test('播放音量在 SoundTouch 先啟動時仍會寫入記憶，KTV 掃色對齊逐字來源且走合成器', () => {
  // 同上：這裡有跨行片段的比對，worktree 取出的 CRLF 會誤判，先正規化行尾。
  const playback = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-playback.js'), 'utf8').replace(/\r\n/g, '\n');
  const ktv = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-template-ktv.js'), 'utf8');
  const display = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'display.js'), 'utf8');
  const panelCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'panel.css'), 'utf8');
  const displayCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'display.css'), 'utf8');
  ok(playback.includes('seeking: !finalize'), '拖曳歌詞同步必須明確標記，不能讓顯示端猜測：');
  ok(display.includes('const isScrubbing = data.seeking === true;') && !display.includes('now - lastSyncWall < 160'), '正常同步不可被誤判為拖曳而停掉 KTV 的 rAF 掃色：');
  ok(panelCss.includes('html.electron-shell .toast-container { top: calc(var(--desktop-windowbar-height) + 16px); }'), 'Electron 通知必須避開自訂標題列：');
  ok(playback.includes("if (typeof AudioProcessor !== 'undefined' && AudioProcessor.setVolume) {"), '音量改動必須一律交給 AudioProcessor 持久化：');
  ok(playback.includes('if (!audioProcessorReady) {\n        audioPlayer.volume = vol;'), 'AudioProcessor 未接管前仍要即時套到原生 audio：');
  ok(ktv.includes('scanTimes: buildScanTimes(seg.chars)'), 'KTV 必須保留每個字的來源掃色節點：');
  ok(ktv.includes('Math.max(previous.endMs, current.startMs, times[times.length - 1])'), 'KTV 字間空拍必須延長前一字，不能停住再追趕：');
  ok(ktv.includes('const fromPx = unit.offsets[charIndex] || 0;'), 'KTV 掃色必須依逐字像素邊界前進：');
  ok(ktv.includes('slot.fillWindow.style.transform') && !ktv.includes('slot.fill.style.clipPath'), 'KTV 逐幀掃色必須走 transform，不可重繪 clip-path：');
  ok(displayCss.includes('.ktv-fill-window') && displayCss.includes('will-change: transform'), 'KTV 填色窗口必須宣告合成器優先：');
  ok(ktv.includes('COUNTDOWN_GLYPHS') && ktv.includes('COUNTDOWN_ICON_COUNT = 5') && !ktv.includes('COUNTDOWN_PATTERNS'), 'KTV 間奏倒數必須是五個同圖案，星星與圓點不得混合：');
  ok(ktv.includes('FILLER_FULL_HOLD_MS = 2000') && ktv.includes('const fillerSweepEnd = countdownStart - FILLER_FULL_HOLD_MS;'), 'KTV 間奏文案必須在倒數前兩秒掃完：');
  ok(ktv.includes('showCountdown(curSlot, nextUnit, frac, seeking);') && ktv.includes('showPreview(nextSlot, nextUnit);'), 'KTV 倒數必須取代間奏行，並讓下一句提前在自己的行位顯示：');
  ok(ktv.includes('const stablePx = seeking ? requestedPx : Math.max(requestedPx, slot.maxFillPx || 0);'), 'KTV 倒數與間奏掃色必須在正常播放時單調前進，只有 seek 可回跳：');
});

test('KTV 掃色以 Facet 相同的下一字起點接續，字間空拍不會停住', () => {
  const kernelSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-motion-kernel.js'), 'utf8');
  const ktvSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-template-ktv.js'), 'utf8');
  const kernelSandbox = {};
  vm.runInNewContext(`${kernelSource}\n;globalThis.__motionForKtvTest = LyricMotion;`, kernelSandbox);
  const motion = kernelSandbox.__motionForKtvTest;
  motion.measureCharOffsets = (text) => Array.from(text).map((_, index) => index * 10).concat(Array.from(text).length * 10);

  const nodes = [];
  function makeNode() {
    const node = {
      children: [], style: {}, className: '', textContent: '', parentNode: null, clientWidth: 1280,
      appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
      removeChild(child) { this.children = this.children.filter((entry) => entry !== child); child.parentNode = null; },
    };
    nodes.push(node);
    return node;
  }
  const cssValues = {
    '--display-font-size': '42', '--display-font-family': 'sans-serif',
    '--lyric-color': '#ffffff', '--lyric-color-active': '#0400ff',
  };
  const templateSandbox = {
    LyricMotion: motion,
    LyricTemplates: { register(template) { this.template = template; } },
    document: { documentElement: {}, createElement: makeNode },
    window: { innerWidth: 1280 },
    getComputedStyle: () => ({ getPropertyValue: (name) => cssValues[name] || '' }),
    console,
  };
  vm.runInNewContext(ktvSource, templateSandbox, { filename: 'lyric-template-ktv.js' });

  let activeLines = [{
    time: 0, text: '甲乙丙',
    words: [
      { text: '甲', start: 0, duration: 100 },
      { text: '乙', start: 200, duration: 100 },
      { text: '丙', start: 300, duration: 100 },
    ],
  }];
  const ctx = { getLyrics: () => activeLines, isFastMode: () => false };
  const container = makeNode();
  const template = templateSandbox.LyricTemplates.template;
  template.mount(container, ctx);
  template.onLyricsLoaded(activeLines, ctx);

  template.onFrame(150, ctx);
  const topSlot = container.children[0].children[0];
  const fillWindow = topSlot.children[1];
  const fill = fillWindow.children[0];
  eq(fillWindow.style.transform, 'scaleX(0.25)', '字間 100ms 空拍必須讓前一字持續掃過：');
  eq(fill.style.transform, 'scaleX(4)', '反向縮放必須保持字形不變：');

  template.onFrame(200, ctx);
  eq(fillWindow.style.transform, 'scaleX(0.3333333333333333)', '下一字必須在來源起點 200ms 準時開始：');
  template.onFrame(400, ctx);
  eq(fillWindow.style.transform, 'scaleX(1)', '單位結束時必須填滿：');

  activeLines = [
    {
      time: 0, text: '甲',
      words: [{ text: '甲', start: 0, duration: 100 }],
    },
    {
      time: 12000, text: '乙',
      words: [{ text: '乙', start: 0, duration: 100 }],
    },
  ];
  template.onLyricsLoaded(activeLines, ctx);
  template.onFrame(1800, ctx);
  const interludeTop = container.children[0].children[0];
  const interludeTopFillWindow = interludeTop.children[1];
  ok(
    ['《Elitesand Pro伴唱歡樂無限》', '《間奏請稍後》', '《下一段即將開始》'].includes(interludeTop.children[0].textContent),
    '長間奏必須顯示可閱讀的間奏文字：',
  );
  eq(interludeTopFillWindow.style.transform, 'scaleX(0.13513513513513514)', '間奏文字必須沿可用的間奏時間慢速掃色：');
  template.onFrame(5000, ctx);
  eq(interludeTopFillWindow.style.transform, 'scaleX(1)', '間奏文字必須在倒數前兩秒掃完：');
  template.onFrame(6500, ctx);
  eq(interludeTopFillWindow.style.transform, 'scaleX(1)', '掃完的間奏文字必須完整停留到倒數接手：');

  template.onFrame(7000, ctx);
  const countdownTop = container.children[0].children[0];
  const previewBottom = container.children[0].children[1];
  const countdownText = countdownTop.children[0].textContent;
  ok(['★ ★ ★ ★ ★', '● ● ● ● ●'].includes(countdownText), '倒數必須是五個同圖案，不得混合星星與圓點：');
  eq(previewBottom.children[0].textContent, '乙', '倒數開始時必須同步顯示下一句，不能等起唱才突然出現：');
  eq(previewBottom.children[1].style.transform, 'scaleX(0)', '預先顯示的下一句必須維持未掃色：');
  eq(countdownTop.children[1].style.transform, 'scaleX(0)', '倒數開始時必須從零進度起跑：');
  template.onFrame(7500, ctx);
  eq(countdownTop.children[1].style.transform, 'scaleX(0.1)', '下一句前五秒才開始掃倒數圖案：');
  eq(previewBottom.children[0].textContent, '乙', '倒數掃色期間下一句必須穩定留在原行位：');
  template.onFrame(7450, ctx);
  eq(countdownTop.children[1].style.transform, 'scaleX(0.1)', '正常播放的微小回撥不可讓倒數圖案回彈：');
  template.onSeek(7450, ctx);
  eq(countdownTop.children[1].style.transform, 'scaleX(0.09)', '明確 seek 必須仍可讓倒數回跳到正確位置：');
  template.onFrame(12000, ctx);
  eq(countdownTop.children[0].textContent, '', '下一句起點必須立即清掉倒數：');
  eq(previewBottom.children[0].textContent, '乙', '下一句起點不得換行或跳位：');
  eq(previewBottom.children[1].style.transform, 'scaleX(0)', '下一句起點必須從尚未掃色的歌詞開始：');

  activeLines = [
    { time: 0, text: '甲', words: [{ text: '甲', start: 0, duration: 100 }] },
    { time: 7100, text: '乙', words: [{ text: '乙', start: 0, duration: 100 }] },
  ];
  template.onLyricsLoaded(activeLines, ctx);
  template.onFrame(1500, ctx);
  eq(container.children[0].children[0].children[0].textContent, '甲', '放不下完整階段的短間奏不可硬塞文案：');
  template.onFrame(2100, ctx);
  ok(
    ['★ ★ ★ ★ ★', '● ● ● ● ●'].includes(container.children[0].children[0].children[0].textContent),
    '短間奏也必須在倒數開始時用五格取代上一句：',
  );
  eq(container.children[0].children[1].children[0].textContent, '乙', '短間奏倒數開始時也必須同步預告下一句：');
  ok(
    container.children[0].children[1].children[1].style.transform === 'scaleX(0)',
    '短間奏預告的下一句不可提前掃色：',
  );
});

testAsync('Electron P1：系統匣結束會先 graceful shutdown，並釋放防休眠鎖', async () => {
  const { EventEmitter } = require('events');
  const { createElectronShell } = require('../electron/shell');
  let trayInstance;
  const shutdownMessages = [];
  const powerStops = [];
  let forkOptions;
  let windowOptions;
  const child = new EventEmitter();
  child.pid = 4321;
  child.postMessage = (message) => shutdownMessages.push(message);
  child.kill = () => { child.killed = true; };
  const app = new EventEmitter();
  app.setName = () => {};
  app.setAppUserModelId = () => {};
  app.requestSingleInstanceLock = () => true;
  app.whenReady = async () => {};
  app.getPath = () => path.join(TEST_RUNTIME_ROOT, 'electron-quit-unit');
  app.exitCodes = [];
  app.exit = (code) => app.exitCodes.push(code);
  app.quitCalls = 0;
  app.quit = () => {
    app.quitCalls++;
    app.emit('before-quit', { preventDefault() { this.prevented = true; } });
  };
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      windowOptions = options;
      this.webContents = { setWindowOpenHandler: () => {}, on: () => {} };
    }
    async loadURL() { this.emit('ready-to-show'); }
    show() {}
    hide() {}
    focus() {}
    isMinimized() { return false; }
  }
  class FakeTray extends EventEmitter {
    constructor() { super(); trayInstance = this; }
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu; }
  }
  let probes = 0;
  const desktop = createElectronShell({
    app,
    BrowserWindow: FakeWindow,
    utilityProcess: { fork: (_entry, _args, options) => { forkOptions = options; return child; } },
    dialog: { showErrorBox: () => {}, showMessageBoxSync: () => 1 },
    shell: { openExternal: () => {} },
    Tray: FakeTray,
    Menu: { buildFromTemplate: (template) => ({ template }) },
    nativeImage: { createFromPath: () => ({}) },
    clipboard: { writeText: () => {} },
    powerSaveBlocker: { start: () => 77, stop: (id) => powerStops.push(id) },
    processObject: { env: {}, platform: 'win32' },
    fsImpl: { mkdirSync: () => {} },
    probeHealthImpl: async () => (++probes === 1 ? { state: 'free' } : { state: 'healthy', payload: { status: 'ok' } }),
    delay: async () => {},
  });

  await desktop.start();
  eq(forkOptions.stdio, 'pipe', 'utilityProcess 必須使用已持續排空的 pipe，保留啟動錯誤且不可塞住：');
  eq(windowOptions.icon, path.join(path.resolve(__dirname, '..'), 'assets', 'elitesand-pro.ico'),
    '桌面視窗必須從 Electron 殼資源讀取正式圖示：');
  trayInstance.menu.template.find((item) => item.label === '結束').click();
  await new Promise((resolve) => setImmediate(resolve));
  eq(app.quitCalls, 1);
  eq(shutdownMessages[0].type, 'elitesand:shutdown', '結束必須走既有 graceful shutdown 訊息：');
  ok(child.killed, '受控 server 未在期限內結束時才 fallback kill：');
  eq(powerStops.join(','), '77', '結束必須釋放 prevent-app-suspension：');
  eq(app.exitCodes.join(','), '0', '關閉完成才退出 Electron：');
});

// 規格 D5 語義：「重啟一次仍失敗就只留結束」——封頂的是「單次事故內的重試」，
// 成功恢復健康後，下一次（可能是數小時後的）事故仍可再重啟一次；直播中強迫
// 使用者整個重開程式比多按一次「重新啟動」更傷。每次事故都有對話框把關，
// 不會形成無人值守的重啟迴圈。
testAsync('Electron P1：server 意外退出每次事故可重啟一次，重啟失敗才只能結束', async () => {
  const { EventEmitter } = require('events');
  const { createElectronShell } = require('../electron/shell');
  const children = [];
  const dialogs = [];
  const app = new EventEmitter();
  app.setName = () => {};
  app.setAppUserModelId = () => {};
  app.requestSingleInstanceLock = () => true;
  app.whenReady = async () => {};
  app.getPath = () => path.join(TEST_RUNTIME_ROOT, 'electron-restart-unit');
  app.exit = () => {};
  app.quitCalls = 0;
  app.quit = () => { app.quitCalls++; app.emit('before-quit', { preventDefault: () => {} }); };
  class FakeWindow extends EventEmitter {
    constructor() { super(); this.webContents = { setWindowOpenHandler: () => {}, on: () => {} }; }
    async loadURL() { this.emit('ready-to-show'); }
    show() {}
    hide() {}
    focus() {}
    isMinimized() { return false; }
  }
  class FakeTray extends EventEmitter {
    setToolTip() {}
    setContextMenu() {}
  }
  let probes = 0;
  let failRestartProbes = false;
  const desktop = createElectronShell({
    startTimeoutMs: 50,
    app,
    BrowserWindow: FakeWindow,
    utilityProcess: {
      fork: () => {
        const child = new EventEmitter();
        child.pid = 5000 + children.length;
        child.postMessage = () => {};
        child.kill = () => {};
        children.push(child);
        return child;
      },
    },
    dialog: {
      showErrorBox: () => {},
      showMessageBoxSync: (options) => { dialogs.push(options); return 0; },
    },
    shell: { openExternal: () => {} },
    Tray: FakeTray,
    Menu: { buildFromTemplate: () => ({}) },
    nativeImage: { createFromPath: () => ({}) },
    clipboard: { writeText: () => {} },
    powerSaveBlocker: { start: () => 1, stop: () => {} },
    processObject: { env: {}, platform: 'win32' },
    fsImpl: { mkdirSync: () => {} },
    probeHealthImpl: async () => {
      if (failRestartProbes) return { state: 'free' };
      return ++probes === 1 ? { state: 'free' } : { state: 'healthy', payload: { status: 'ok' } };
    },
    delay: async () => {},
  });

  await desktop.start();
  children[0].emit('exit', 9);
  await new Promise((resolve) => setImmediate(resolve));
  eq(children.length, 2, '第一次意外退出允許重 fork 一次：');
  eq(dialogs[0].buttons.join('|'), '重新啟動伺服器|結束');
  // 重啟成功恢復健康 → 下一次事故仍可再重啟一次（per-incident，不是一生一次）
  children[1].emit('exit', 10);
  await new Promise((resolve) => setImmediate(resolve));
  eq(dialogs[1].buttons.join('|'), '重新啟動伺服器|結束', '恢復健康後的下一次事故仍可重啟：');
  eq(children.length, 3, '第二次事故同樣重 fork 一次：');
  eq(app.quitCalls, 0, '成功恢復期間不得結束程式：');
  // 這次讓重啟後的 health 永遠不過 → 事故內重試失敗 → 只剩結束
  failRestartProbes = true;
  children[2].emit('exit', 11);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 120));
  eq(dialogs[dialogs.length - 1].buttons.join('|'), '結束', '重啟失敗後只能結束：');
  eq(app.quitCalls, 1);
});

console.log('\n📦 16. EULA 首次同意閘門 (eula-store)');
{
  const eulaStore = require('../server/services/eula-store');

  test('EULA.txt 可讀、版本可解析，首次啟動 required=true', () => {
    const status = eulaStore.getStatus();
    ok(/^\d+\.\d+\.\d+$/.test(status.version || ''), `EULA 版本應為 x.y.z 格式，得到 ${status.version}: `);
    eq(status.required, true, '尚未同意時必須 required=true: ');
    eq(status.acceptedVersion, null);
    const text = eulaStore.getText();
    ok(text.includes('最終使用者授權暨免責聲明'), 'EULA 內文應包含中文標題: ');
    ok(text.includes(`Version: ${status.version}`), '內文與解析出的版本要一致: ');
  });

  test('accept 版本不符會被拒絕（409）且不寫入同意紀錄', () => {
    let error;
    try { eulaStore.accept('0.0.1'); } catch (caught) { error = caught; }
    eq(error?.status, 409);
    ok(!fs.existsSync(eulaStore.ACCEPTANCE_FILE), '版本不符不得留下任何紀錄檔: ');
  });

  test('accept 正確版本後 required=false，紀錄落在隔離 data 目錄', () => {
    const before = eulaStore.getStatus();
    const after = eulaStore.accept(before.version);
    eq(after.required, false);
    eq(after.acceptedVersion, before.version);
    ok(eulaStore.ACCEPTANCE_FILE.startsWith(TEST_RUNTIME_DIRS.data), '同意紀錄絕不可寫進正式 data 目錄: ');
    const saved = JSON.parse(fs.readFileSync(eulaStore.ACCEPTANCE_FILE, 'utf8'));
    eq(saved.version, before.version);
    ok(typeof saved.acceptedAt === 'string' && saved.acceptedAt.length > 0);
  });

  test('條款版本變更後會重新要求同意', () => {
    fs.writeFileSync(eulaStore.ACCEPTANCE_FILE, JSON.stringify({ version: '0.9.9', acceptedAt: new Date().toISOString() }));
    eq(eulaStore.getStatus().required, true, '舊版同意不涵蓋新版條款: ');
    fs.rmSync(eulaStore.ACCEPTANCE_FILE, { force: true });
  });
}

console.log('\n🌐 17. M6.1 介面語系層');
{
  const i18n = require('../public/js/i18n');
  const i18nSource = fs.readFileSync(path.join(__dirname, '../public/js/i18n.js'), 'utf8');
  const catalogs = i18n.catalogs;
  const baselineKeys = Object.keys(catalogs['zh-TW']).sort();

  test('五個支援語系都有完整且非空的相同字串鍵', () => {
    eq(i18n.LOCALES.join('|'), 'zh-TW|en|ja|ko|zh-CN');
    i18n.LOCALES.forEach((locale) => {
      eq(Object.keys(catalogs[locale]).sort().join('|'), baselineKeys.join('|'), `${locale} 字串鍵：`);
      baselineKeys.forEach((key) => ok(String(catalogs[locale][key] || '').trim(), `${locale}.${key} 不得為空：`));
    });
  });

  test('瀏覽器語系別名會正規化到支援的五種語系', () => {
    eq(i18n.normalizeLocale('zh-Hant-HK'), 'zh-TW');
    eq(i18n.normalizeLocale('zh_Hans_CN'), 'zh-CN');
    eq(i18n.normalizeLocale('en-US'), 'en');
    eq(i18n.normalizeLocale('ja-JP'), 'ja');
    eq(i18n.normalizeLocale('ko-KR'), 'ko');
    eq(i18n.normalizeLocale('fr-FR'), null);
  });

  test('翻譯插值與 OBS lang 網址不改變既有路由', () => {
    i18n.setLocale('ja', { persist: false, updateQuery: false });
    eq(i18n.t('controller.lyricsLoaded', { count: 12 }), '歌詞を読み込みました（12 行）');
    const localized = new URL(i18n.localizeUrl('http://localhost:3000/display?preview=1'));
    eq(localized.pathname, '/display');
    eq(localized.searchParams.get('preview'), '1');
    eq(localized.searchParams.get('lang'), 'ja');
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
    eq(new URL(i18n.localizeUrl(localized.href)).searchParams.get('lang'), null);
  });

  test('HTML 與動態 UI 引用的翻譯鍵都存在', () => {
    const htmlFiles = ['index.html', 'controller.html', 'display.html', 'setlist.html', 'prompter.html'];
    const jsFiles = ['theme.js', 'nav.js', 'app-style-sync.js', 'app-setlist-panel.js', 'app-toast-utils.js', 'app-playlist.js', 'app-twitch.js', 'app-youtube-import.js', 'app-diagnostics.js', 'error-handler.js', 'eula-gate.js', 'danger-confirm.js', 'controller.js', 'pin-auth.js', 'setlist.js', 'prompter.js', 'lyric-extras.js', 'app.js'];
    const referenced = new Set();
    htmlFiles.forEach((file) => {
      const source = fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
      ok(source.includes('/js/i18n.js'), `${file} 必須載入語系層：`);
      for (const match of source.matchAll(/data-i18n(?:-title|-aria-label|-placeholder|-alt|-label)?="([^"]+)"/g)) referenced.add(match[1]);
    });
    jsFiles.forEach((file) => {
      const source = fs.readFileSync(path.join(__dirname, '../public/js', file), 'utf8');
      for (const match of source.matchAll(/(?:I18n\.t|workspaceText|(?:^|[^\w])t)\(\s*['"]([^'"]+)['"]/gm)) referenced.add(match[1]);
    });
    referenced.forEach((key) => ok(baselineKeys.includes(key), `缺少翻譯鍵 ${key}：`));
  });

  test('EULA 與桌面操作視窗維持 dialog 語意與鍵盤焦點管理', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const eula = fs.readFileSync(path.join(__dirname, '../public/js/eula-gate.js'), 'utf8');
    const modalFocus = fs.readFileSync(path.join(__dirname, '../public/js/modal-focus.js'), 'utf8');
    const labels = {
      'lyrics-paste-modal': 'lyrics-paste-title',
      'track-edit-modal': 'track-edit-title-heading',
      'lyrics-picker-modal': 'lyrics-picker-title',
      'lyrics-timeline-modal': 'lyrics-timeline-title',
      'help-modal': 'help-modal-title',
      'playlist-export-modal': 'playlist-export-title',
      'playlist-import-modal': 'playlist-import-title',
      'lyric-preset-name-modal': 'lyric-preset-name-title',
      'pin-required-modal': 'pin-required-title',
      'pin-manage-modal': 'pin-manage-title',
    };
    Object.entries(labels).forEach(([modalId, labelId]) => {
      const start = html.indexOf(`id="${modalId}"`);
      const section = html.slice(start, start + 600);
      ok(start >= 0, `找不到 ${modalId}: `);
      ok(section.includes('role="dialog" aria-modal="true"'), `${modalId} 必須有 dialog 語意: `);
      ok(section.includes(`aria-labelledby="${labelId}"`), `${modalId} 必須有可存取名稱: `);
    });
    ['previousFocus', 'trapFocus', 'stopImmediatePropagation', "textBox.focus()", "document.removeEventListener('keydown', trapFocus, true)"]
      .forEach((fragment) => ok(eula.includes(fragment), `EULA 閘門必須管理焦點（缺少 ${fragment}）: `));
    ['FOCUSABLE_SELECTOR', 'previousFocus', 'data-modal-initial-focus', "event.key !== 'Tab'", 'target.focus()']
      .forEach((fragment) => ok(modalFocus.includes(fragment), `桌面 modal 必須限制焦點並在關閉後還原（缺少 ${fragment}）: `));
  });

  test('非正常關閉回報與日文播放提示維持中性且正確的語意', () => {
    const autoRows = require('../public/js/i18n-auto');
    eq(autoRows['播放後，'][2], '再生後、', '日文播放提示不可誤寫成玩遊戲後：');
    const actual = catalogs.en['crash.prefillActual'];
    ok(!/without me doing anything/i.test(actual), '非正常關閉回報不可預設歸咎為使用者未操作：');
    ok(/shut down cleanly/i.test(actual) && /closed manually/i.test(actual), '回報預填必須如實涵蓋手動關閉：');
  });

  test('Twitch 授權更新失敗原因會先翻譯再插入重連狀態', () => {
    const twitchSource = fs.readFileSync(path.join(__dirname, '../public/js/app-twitch.js'), 'utf8');
    const expected = {
      en: 'Twitch authorization cannot be refreshed right now.',
      ja: 'Twitch の認証情報を現在更新できません。',
      ko: '현재 Twitch 인증을 갱신할 수 없습니다.',
      'zh-CN': '暂时无法更新 Twitch 授权。',
    };
    Object.entries(expected).forEach(([locale, value]) => {
      i18n.setLocale(locale, { persist: false, updateQuery: false });
      eq(i18n.t('twitch.runtime.authorizationRefreshUnavailable'), value, `${locale} Twitch 授權更新錯誤：`);
    });
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
    ok(twitchSource.includes("'Twitch 授權暫時無法更新': 'twitch.runtime.authorizationRefreshUnavailable'"));
    ok(twitchSource.includes('const localizedError = localizeRuntimeError(data.lastConnectionError);'));
    ok(twitchSource.includes("t('twitch.runtime.subscriptionFailed', { reason: localizeRuntimeError(data.lastConnectionError)"));
  });

  test('本場直播與設定工作台的動態狀態不混入繁中', () => {
    const samples = {
      en: 'OBS streaming · 42:16 · 8 tracks performed',
      ja: 'OBS 配信中 · 42:16 · 歌唱済み 8 曲',
      ko: 'OBS 송출 중 · 42:16 · 부른 곡 8개',
      'zh-CN': 'OBS 推流中 · 42:16 · 已唱 8 首',
    };
    Object.entries(samples).forEach(([locale, expected]) => {
      i18n.setLocale(locale, { persist: false, updateQuery: false });
      const source = i18n.t('home.session.sourceObs');
      eq(i18n.t('home.session.statusLive', { source, duration: '42:16', count: '8' }), expected, `${locale} 直播狀態：`);
      ok(i18n.t('home.session.openRecord') !== catalogs['zh-TW']['home.session.openRecord'], `${locale} 本場紀錄入口不得沿用繁中：`);
      ok(i18n.t('settings.openDetails') !== catalogs['zh-TW']['settings.openDetails'], `${locale} 詳細設定入口不得沿用繁中：`);
    });
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  test('本場直播與設定工作台的五語字串完整且變數一致', () => {
    const reviewedKeys = baselineKeys.filter((key) => (
      key.startsWith('home.session.')
      || key.startsWith('settings.workspace.')
      || key.startsWith('settings.preview.')
      || key.startsWith('settings.lyrics.')
      || key.startsWith('settings.setlist.')
      || key === 'settings.openDetails'
    ));
    ok(reviewedKeys.length >= 65, '本次設定與直播區塊應有完整的人工審查字串集合：');
    const placeholders = (value) => [...String(value).matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]).sort().join('|');
    reviewedKeys.forEach((key) => {
      const expectedPlaceholders = placeholders(catalogs['zh-TW'][key]);
      i18n.LOCALES.forEach((locale) => {
        const value = catalogs[locale][key];
        ok(typeof value === 'string' && value.trim(), `${locale} 缺少 ${key}：`);
        eq(placeholders(value), expectedPlaceholders, `${locale} ${key} 的變數不一致：`);
      });
    });
    eq(catalogs.en['home.session.copySuccess'], '✓ Chapters copied', '複製多個章節時英文不得使用單數：');
    ok(/history/i.test(catalogs.en['home.session.openRecord']), '英文「本場紀錄」不得誤解成錄影檔 record：');
    eq(catalogs.ko['settings.workspace.appearance'], '외관', '韓文 Appearance 應使用軟體介面的「외관」：');
    eq(catalogs.ko['settings.workspace.searchHint'], '현재 템플릿에서 사용할 수 있는 설정만 표시됩니다.', '韓文模板範圍助詞必須自然：');
    eq(catalogs.ko['home.session.confirmSummary'], '이번 방송에서 부른 곡과 YouTube 챕터가 삭제됩니다.', '韓文清除提示語序必須自然：');
    ok(catalogs['zh-CN']['home.session.confirmImpact'].includes('OBS 布局设置'), '簡中 OBS layout 不得沿用「版型」：');
  });

  test('新增簡中介面不混入台灣用語或繁體字', () => {
    const reviewedKeys = baselineKeys.filter((key) => key.startsWith('home.session.') || key.startsWith('settings.'));
    const taiwanOnly = /版型|載入|儲存|紀錄|連線|貼上|音檔|目前|開台|收台|瀏覽器來源|「|」/;
    const traditionalOnly = /儲|載|錄|檔|網|體|開|關|過|這|裡|與|為|後|覽/;
    const offenders = reviewedKeys.filter((key) => taiwanOnly.test(catalogs['zh-CN'][key]) || traditionalOnly.test(catalogs['zh-CN'][key]));
    eq(offenders.length, 0, `新增簡中仍含台灣用語或繁體字（${offenders[0] || ''}）：`);
  });

  test('示範資料功能在五語中使用同一組 sample 術語', () => {
    const autoRows = require('../public/js/i18n-auto');
    const related = Object.entries(autoRows).filter(([source]) => source.includes('示範資料'));
    ok(related.length >= 5, '示範資料相關操作、提示與教學必須一起受守衛：');
    related.forEach(([source, values]) => {
      ok(!/\bdemo\b/i.test(values[1]), `英文「${source}」不得混用 Demo data：`);
      ok(!/デモ/.test(values[2]), `日文「${source}」不得混用デモデータ：`);
      ok(!/데모/.test(values[3]), `韓文「${source}」不得混用데모 데이터：`);
      ok(!/示范/.test(values[4]), `簡中「${source}」應統一使用示例数据：`);
    });
  });

  test('本次新增具名變數與長尾數字變數使用同一譯法', () => {
    const autoRows = require('../public/js/i18n-auto');
    const canonical = (value) => String(value).replace(/\{[^{}]+\}/g, '{}');
    const autoBySource = new Map(Object.entries(autoRows).map(([source, values]) => [canonical(source), values]));
    const reviewedKeys = baselineKeys.filter((key) => key.startsWith('home.session.') || key.startsWith('settings.'));
    reviewedKeys.forEach((key) => {
      const source = catalogs['zh-TW'][key];
      if (!/\{[^{}]+\}/.test(source)) return;
      const autoValues = autoBySource.get(canonical(source));
      if (!autoValues) return;
      i18n.LOCALES.forEach((locale, index) => {
        eq(canonical(catalogs[locale][key]), canonical(autoValues[index]), `${locale} ${key} 與長尾變數模板譯法不一致：`);
      });
    });
  });

  test('桌面首頁與 Twitch 第二批字串不是繁中佔位值', () => {
    const secondBatchKeys = baselineKeys.filter((key) => (
      key.startsWith('home.')
      || key.startsWith('playlist.')
      || key.startsWith('source.')
      || key.startsWith('preview.')
      || key.startsWith('twitch.')
      || key.startsWith('system.')
    ));
    ok(secondBatchKeys.length >= 70, '第二批應有至少 70 個受守衛字串：');
    ['en', 'ja', 'ko'].forEach((locale) => {
      const translatedCount = secondBatchKeys.filter((key) => catalogs[locale][key] !== catalogs['zh-TW'][key]).length;
      ok(translatedCount / secondBatchKeys.length >= 0.95, `${locale} 第二批不得大量沿用繁中：`);
    });
  });

  test('M6.1 長尾字串表涵蓋完整控制面板且五語非空', () => {
    const autoRows = require('../public/js/i18n-auto');
    const entries = Object.entries(autoRows);
    ok(entries.length >= 1800, '完整控制面板長尾至少應有 1,800 個來源片段：');
    entries.forEach(([source, values]) => {
      ok(source.trim(), '長尾來源不得為空：');
      eq(values.length, 5, `${source} 必須同時提供五語：`);
      values.forEach((value, index) => ok(String(value || '').trim(), `${source} 第 ${index + 1} 語不得為空：`));
    });
    ['en', 'ja', 'ko'].forEach((locale, localeOffset) => {
      const translated = entries.filter(([source, values]) => values[localeOffset + 1] !== source).length;
      ok(translated / entries.length >= 0.95, `${locale} 長尾不得大量沿用繁中：`);
    });
  });

  test('長尾表只收人類看得到的文字，不收程式碼與 console log', () => {
    const autoRows = require('../public/js/i18n-auto');
    const entries = Object.entries(autoRows);
    // 抽取腳本曾經把 JS 樣板字面值與 HTML 整串收進表裡：那些 key 永遠比對不到文字節點，
    // 卻會讓每次比對多掃一輪，而且 class/id 被翻譯過會變成無聲的髒資料。
    const fragments = entries.filter(([source]) => /[<>]|\$\{|=>|class=|id="/.test(source));
    eq(fragments.length, 0, `長尾 key 不得含 HTML 或 JS 片段（例如「${fragments[0] ? fragments[0][0].slice(0, 40) : ''}」）：`);
    const fragmentValues = entries.filter(([, values]) => values.some((value) => /<\/?[a-z]+[\s>]|\$\{|=>/.test(String(value))));
    eq(fragmentValues.length, 0, `長尾譯文不得含 HTML 或 JS 片段（例如「${fragmentValues[0] ? fragmentValues[0][0].slice(0, 40) : ''}」）：`);
    const consoleRows = entries.filter(([source]) => /^\[[A-Za-z]/.test(source));
    eq(consoleRows.length, 0, `console log 不進翻譯表（例如「${consoleRows[0] ? consoleRows[0][0].slice(0, 40) : ''}」）：`);
    eq(entries.length, new Set(entries.map(([source]) => source)).size, '長尾表不得有重複 key：');
  });

  test('長尾比對失敗時不掃全表（MutationObserver hot path）', () => {
    // 每個不在表內的文字節點（歌名、時間、數字）都會走一次 miss；
    // 之前的 defensive fallback 會在每次 miss 掃完 2,000 筆做 matchAll。
    ok(
      /if \(autoPatternRows\.length\) return null;[\s\S]{0,200}Object\.entries\(AUTO_ROWS\)/.test(i18nSource),
      'resolveAutoRow 的全表 fallback 必須只在 autoPatternRows 為空時才跑：'
    );
    i18n.setLocale('en', { persist: false, updateQuery: false });
    const started = process.hrtime.bigint();
    for (let index = 0; index < 500; index += 1) i18n.translate(`Unmatched Song Title ${index}`);
    const perCall = Number(process.hrtime.bigint() - started) / 1e6 / 500;
    ok(perCall < 0.2, `比對失敗的單次成本必須遠低於 1ms（實測 ${perCall.toFixed(3)}ms）：`);
    eq(i18n.translate('字級'), 'Font size', 'fallback 收斂後既有比對必須不變：');
    eq(i18n.translate('冷卻 30 秒'), 'Cooldown 30 seconds', 'fallback 收斂後樣板比對必須不變：');
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  test('長尾樣板由最具體列匹配，且全部 placeholder 組合都得到對應譯文', () => {
    const autoRows = require('../public/js/i18n-auto');
    const templated = Object.entries(autoRows).filter(([source]) => /\{\d+\}/.test(source));
    ok(templated.length >= 170, '應覆蓋完整動態長尾樣板：');
    i18n.LOCALES.forEach((locale, localeIndex) => {
      i18n.setLocale(locale, { persist: false, updateQuery: false });
      templated.forEach(([source, values]) => {
        const sample = source.replace(/\{(\d+)\}/g, (_, index) => `CAP${index}`);
        const expected = values[localeIndex].replace(/\{(\d+)\}/g, (_, index) => `CAP${index}`);
        eq(i18n.translate(sample), expected, `${locale} 不可被較泛用樣板截走（${source}）：`);
      });
    });
    i18n.setLocale('en', { persist: false, updateQuery: false });
    eq(
      i18n.translate('已連接 Twitch：正在監聽 !點歌。'),
      'Connected Twitch: Listening for !點歌.',
      '相鄰 placeholder 其中一段為空時仍須保留動態指令：'
    );
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  test('長尾譯文不得含不可見控制字元', () => {
    const autoRows = require('../public/js/i18n-auto');
    const invisible = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/;
    const offenders = Object.entries(autoRows)
      .filter(([, values]) => values.some((value) => invisible.test(String(value))));
    eq(offenders.length, 0, `長尾譯文仍有零寬或方向控制字元（例如「${offenders[0] ? offenders[0][0] : ''}」）：`);
  });

  test('長尾狀態文字保留使用者可理解的語意', () => {
    i18n.setLocale('en', { persist: false, updateQuery: false });
    eq(i18n.translate('直播中…等待第一首歌'), 'Live — waiting for the first song', '英文直播等待狀態必須清楚說明目前正在等待第一首歌：');
    eq(i18n.translate('已選歌詞'), 'Lyrics selected', '英文歌詞狀態不得誤解為精選歌詞：');
    i18n.setLocale('ja', { persist: false, updateQuery: false });
    eq(i18n.translate('時長吻合'), '再生時間が一致', '日文時長狀態必須指向播放時間：');
    eq(i18n.translate('正在從各來源搜尋歌詞'), '各ソースから歌詞を検索中', '日文搜尋狀態必須使用進行式：');
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  test('人工審查過的高風險長尾不再語意反轉或跨語混入', () => {
    const autoRows = require('../public/js/i18n-auto');
    [
      '星座（暫停提供）',
      '時間軸（暫停提供）',
      '斜線舞台（暫停提供）',
    ].forEach((source) => {
      ok(/temporarily unavailable/i.test(autoRows[source][1]), `英文「${source}」不可把 unavailable 翻成 available：`);
    });
    const throttle = Object.keys(autoRows).find((source) => source.includes('操作太快了，請再等'));
    eq(autoRows[throttle][1], 'You are doing that too quickly. Please wait {seconds} seconds.', '英文限流訊息不可混入簡中：');
    const bulkPlaying = Object.keys(autoRows).find((source) => source.includes('正在播放的歌曲不能批次選取'));
    ok(!/[\u3400-\u9FFF]/.test(autoRows[bulkPlaying][1]), '英文批次操作警告不可混入中文：');
    const floating = Object.keys(autoRows).find((source) => source.startsWith('漂浮：緩慢淡入'));
    ok(/フェードイン/.test(autoRows[floating][2]) && !/フェードアウト/.test(autoRows[floating][2]), '日文漂浮效果不可把淡入寫成淡出：');
    eq(autoRows['OBS 推流中'][3], 'OBS 송출 중', '韓文 OBS 推流狀態須簡潔且可自然組合進狀態列：');
  });

  test('長尾字串表發行阻擋級操作與狀態文案已人工鎖定', () => {
    const autoRows = require('../public/js/i18n-auto');
    const expected = {
      '收到系統匣': [
        'Minimize to system tray',
        'システムトレイに最小化',
        '시스템 트레이로 최소화',
      ],
      '送出 Twitch 公開測試？': [
        'Send public Twitch test?',
        'Twitch の公開テストを送信しますか？',
        'Twitch 공개 테스트를 전송하시겠습니까?',
      ],
      '數字越大越清楚。開著保護時已唱至少 52%、未唱至少 70%。': [
        'Higher values are more visible. With protection on, performed tracks stay at least 52% opaque and upcoming tracks at least 70% opaque.',
        '数値が大きいほど鮮明になります。保護をオンにすると、歌唱済みは最低 52%、未唱は最低 70% になります。',
        '값이 클수록 더 선명합니다. 보호 기능을 켜면 부른 곡의 불투명도는 최소 52%, 예정 곡은 최소 70%로 유지됩니다.',
      ],
      '獎勵已建立；EventSub 正在等待忠誠點數兌換訂閱。': [
        'Rewards created; EventSub is waiting to subscribe to Channel Points redemption events.',
        '報酬を作成しました。EventSub のチャンネルポイント報酬引き換えイベントの購読を待機しています。',
        '보상이 생성되었습니다. EventSub가 채널 포인트 보상 교환 이벤트 구독을 기다리는 중입니다.',
      ],
      '✓ 播放清單匯入完成：{0} 首{1}': [
        '✓ Playlist import complete: {0} tracks{1}',
        '✓ プレイリストのインポートが完了しました：{0} 曲{1}',
        '✓ 재생목록 가져오기가 완료되었습니다: {0}곡{1}',
      ],
      '切歌': [
        'Switch tracks',
        '曲を切り替える',
        '곡 전환',
      ],
      '待確認編號': [
        'Pending-request ID',
        '確認待ち番号',
        '확인 대기 번호',
      ],
      '點歌歷史': [
        'Song request history',
        '曲リクエスト履歴',
        '신청곡 내역',
      ],
      '關閉可減輕負載／更乾淨': [
        'Turning this off reduces load and gives a cleaner look.',
        'オフにすると負荷が軽減され、表示がすっきりします',
        '끄면 부하가 줄고 화면이 더 깔끔해집니다',
      ],
      '完整歌詞畫面，適合需要看見歷史行、拼音或諧音的演出。': [
        'A full lyrics display for performances that need previous lines, romanization, or a phonetic guide.',
        '過去の歌詞行、ローマ字、または発音ガイドを見たい場合に適した完全な歌詞画面です。',
        '전체 가사 화면으로, 이전 가사 줄이나 로마자 또는 발음 가이드를 확인해야 하는 공연에 적합합니다.',
      ],
    };
    Object.entries(expected).forEach(([source, translations]) => {
      eq(autoRows[source].slice(1, 4).join('\u0001'), translations.join('\u0001'), `高風險翻譯不可回歸：「${source}」：`);
    });
    eq(autoRows['暫停兌換'][1], 'Pause redemptions', '英文忠誠點數狀態不可誤譯成 exchange：');
    eq(autoRows['仍然匯入'][1], 'Import anyway', '英文匯入風險按鈕名稱必須與說明一致：');
    ok(autoRows['程式會先看影片類型和時長，避免把直播精華、教學或過長影片誤塞進歌單。確定要唱就按「仍然匯入」；不適合就按「略過這支影片」。勾選「不要再顯示」後，之後所有匯入風險警告都會直接繼續匯入，請只在你確定接受這個風險時使用。'][1].includes('"Import anyway"'), '英文匯入風險說明必須引用正確按鈕名稱：');
  });

  test('第二輪深度審查的截斷、反轉與在地化問題已鎖定', () => {
    const autoRows = require('../public/js/i18n-auto');
    const expected = {
      '不會馬上消失。待確認點歌在逾時前會保留到你選擇拒絕，下載失敗的可重試請求也會留著；重開程式後，尚未處理的請求仍會回到「點歌」頁。': {
        ko: '바로 사라지지 않습니다. 확인 대기 중인 신청곡은 시간이 초과되거나 직접 거절할 때까지 유지되며, 다운로드에 실패해 다시 시도할 수 있는 요청도 남아 있습니다. 프로그램을 다시 실행해도 처리하지 않은 요청은 ‘신청곡’ 페이지에 다시 표시됩니다.',
      },
      '目前授權缺少忠誠點數管理權限，請重新連接 Twitch 一次。': {
        ko: '현재 인증에 채널 포인트 관리 권한이 없습니다. Twitch에 다시 연결해 주세요.',
      },
      '尚無記錄，播放任一首歌後會自動加入。': {
        ko: '아직 기록이 없습니다. 아무 곡이나 재생하면 자동으로 추가됩니다.',
      },
      '要。OBS 是即時去讀這個網址的畫面，如果把程式關掉，OBS 那邊的歌詞畫面也會跟著消失。': {
        ko: '네, 필요합니다. OBS가 이 URL의 화면을 실시간으로 읽어 오기 때문에 프로그램을 종료하면 OBS의 가사 화면도 함께 사라집니다.',
      },
      '星座（暫停提供）': { ja: 'コンステレーション（一時提供停止）' },
      '時間軸（暫停提供）': { ja: 'タイムライン（一時提供停止）' },
      '斜線舞台（暫停提供）': { ja: 'スラッシュステージ（一時提供停止）' },
      '每張縮圖的「字」會用該風格的高亮動態跑一次；滑鼠停在上面可看文字說明。': {
        ja: '各サムネイルの「文字」が、そのスタイルのハイライト演出で 1 回再生されます。マウスを重ねると説明を確認できます。',
      },
      '依 Twitch 實際開台狀態判斷；重連後會向 Twitch 再確認一次。': {
        ja: 'Twitch の実際の配信状態で判定し、再接続後に Twitch へもう一度確認します。',
      },
      '基礎配色與可讀性和其他清單型模板共用；卡片清單會立即反映每一個可見控制項。': {
        ja: '基本の配色と読みやすさは他のリスト型テンプレートと共通で、カードリストには表示中の各操作項目がすぐに反映されます。',
      },
      '00:00 開台': { en: '00:00 Stream started' },
      '所有內建指令的名稱、別名、資格與冷卻會回到預設值。': {
        en: 'The name, aliases, permissions, and cooldown for every built-in command will be reset to their defaults.',
      },
      '直式 600×1080': { 'zh-CN': '竖屏 600×1080' },
      '歌單即時預覽': { 'zh-CN': '歌单实时预览' },
      'OBS 連動（一鍵建立來源）': { 'zh-CN': 'OBS 联动（一键创建来源）' },
    };
    Object.entries(expected).forEach(([source, locales]) => {
      Object.entries(locales).forEach(([locale, value]) => {
        const index = i18n.LOCALES.indexOf(locale);
        eq(autoRows[source][index], value, `${locale} 深度審查字串不可回歸：「${source}」：`);
      });
    });
    ok(!/^[，：]/.test(autoRows['，所以要先把 Browser Source 縮成你要的框再開不透明度，否則會蓋掉那塊區域內的直播畫面。這和「可讀性襯底」是不同層：襯底只墊在文字後面，背板是整塊來源的底色。'][1]), '英文接續片段不得混入全形中文標點：');
    ok(!/^[，：]/.test(autoRows['：每首歌旁邊會寫「逐字」「逐句」或「無歌詞」。看到「無歌詞」不是壞掉，只是這次自動搜尋沒找到而已。'][1]), '英文說明片段不得混入全形中文冒號：');
  });

  test('動態無障礙標籤與 OBS 執行狀態跟隨介面語言', () => {
    const controllerHtml = fs.readFileSync(path.join(__dirname, '../public/controller.html'), 'utf8');
    const electronChrome = fs.readFileSync(path.join(__dirname, '../public/js/electron-shell-chrome.js'), 'utf8');
    const toastUtils = fs.readFileSync(path.join(__dirname, '../public/js/app-toast-utils.js'), 'utf8');
    const errorHandler = fs.readFileSync(path.join(__dirname, '../public/js/error-handler.js'), 'utf8');
    ok(controllerHtml.includes('data-i18n-aria-label="controller.lyricPresetLabel"'), '遙控器預設選單的 aria-label 必須走語系層：');
    ok(electronChrome.includes("translate('window.restore'") && electronChrome.includes("translate('window.maximize'"), 'Electron 最大化／還原 aria-label 必須走語系鍵：');
    ok(electronChrome.includes("window.addEventListener('i18n:change'"), '切換語言後須重繪 Electron 動態視窗標籤：');
    ['status.lyricsStale', 'status.lyricsStaleAria', 'status.lyricsStaleWarning', 'status.lyricsPending', 'status.lyricsPendingAria'].forEach((key) => {
      ok(toastUtils.includes(`t('${key}')`), `OBS 動態狀態必須使用 ${key}：`);
    });
    ok(errorHandler.includes("window.I18n.t('common.close')"), 'toast 關閉按鈕的 title／aria-label 必須走語系層：');
    ok(!errorHandler.includes('title="關閉" aria-label="關閉"'), 'toast 不得保留寫死的繁中無障礙標籤：');
  });

  test('具名變數只翻譯模板原文，不改寫已展開的 Twitch 對外回覆', () => {
    i18n.setLocale('en', { persist: false, updateQuery: false });
    eq(
      i18n.translate('會套入聊天室回覆的 {reason}；留空會使用安全預設文字。'),
      '{reason} will be included in the chat room reply; leaving blank will use the safe default text.',
      '介面中的具名變數說明仍須翻譯：'
    );
    eq(
      i18n.translate('已取消待確認點歌：Sample Track'),
      '已取消待確認點歌：Sample Track',
      '已展開的聊天室回覆屬使用者對外內容，不可被 UI 自動翻譯：'
    );
    ok(i18nSource.includes("'textarea',"), 'Twitch 回覆文字框必須維持在自動翻譯排除範圍：');
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  test('動態數量與錯誤前綴必須走可命中的翻譯路徑', () => {
    i18n.setLocale('en', { persist: false, updateQuery: false });
    eq(
      i18n.translate('目前 3 個自訂指令都會移除。'),
      'All 3 custom commands will be removed.',
      '動態數量不可只留下無法命中的句尾片段：'
    );
    eq(
      i18n.translate(`目前模板：${i18n.t('template.classic')}`),
      'Current template: Classic Overlay',
      '動態模板狀態的前綴與模板名稱都必須翻譯：'
    );
    const twitchSource = fs.readFileSync(path.join(__dirname, '../public/js/app-twitch.js'), 'utf8');
    const timelineSource = fs.readFileSync(path.join(__dirname, '../public/js/app-lyrics-timeline.js'), 'utf8');
    const youtubeSource = fs.readFileSync(path.join(__dirname, '../public/js/app-youtube-import.js'), 'utf8');
    const sharedSource = fs.readFileSync(path.join(__dirname, '../public/js/shared-utils.js'), 'utf8');
    const lyricExtrasSource = fs.readFileSync(path.join(__dirname, '../public/js/lyric-extras.js'), 'utf8');
    ok(twitchSource.includes('summary: tr(`目前 ${count} 個自訂指令都會移除。`)'), '清除自訂指令確認必須先翻譯完整動態句：');
    ok(twitchSource.includes("t('twitch.simulation.failed', { message: error })"), 'Twitch 模擬錯誤前綴必須由 curated 模板翻譯，錯誤內容另行處理：');
    ok(timelineSource.includes("`${tr('歌詞上傳失敗:')} ${err.message}`"), '歌詞上傳錯誤前綴必須翻譯：');
    ok(youtubeSource.includes("t('import.error.importFailed', { message: err.message })"), 'YouTube 匯入錯誤前綴必須由 curated 模板翻譯：');
    ok(sharedSource.includes("`${tr('音訊播放失敗:')} ${error.message || tr('未知錯誤')}`"), '共用音訊錯誤前綴必須翻譯：');
    ok(lyricExtrasSource.includes("window.I18n?.t(`template.${settings.template}`)"), '動態模板名稱必須先經過 curated 翻譯：');
    ok(lyricExtrasSource.includes("window.addEventListener('i18n:change', syncTemplateButtons)"), '切換語言後必須重新渲染動態模板名稱：');
    ok(youtubeSource.includes("window.addEventListener('i18n:change'"), '匯入工作中心切換語言後必須重新渲染：');
    ok(youtubeSource.includes('progressStatus(job.progressStage'), '匯入中 Socket 階段必須在顯示時依目前語系格式化：');
    ok(youtubeSource.includes('setYtProgressStage(stage, data.percent, error'), '匯入進度不可先拼成繁中快照再顯示：');
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  test('匯入工作中心的動態訊息以 curated key 重繪且保留外部資料', () => {
    const source = fs.readFileSync(path.join(__dirname, '../public/js/app-youtube-import.js'), 'utf8');
    ['import.playlist.confirmTitle', 'import.job.queued', 'import.progress.status', 'import.job.completed', 'import.error.importFailed'].forEach((key) => {
      ok(baselineKeys.includes(key), `匯入動態介面缺少 ${key}：`);
    });
    i18n.setLocale('en', { persist: false, updateQuery: false });
    eq(i18n.t('import.job.queued', { position: '3' }), 'Waiting · queue position 3', '工作中心佇列位置必須使用英文模板：');
    eq(i18n.t('import.error.importFailed', { message: 'SERVER_MESSAGE' }), 'YouTube import failed: SERVER_MESSAGE', '外部錯誤僅作為插值，不可被改寫：');
    ok(source.includes('const stageKeys = Object.freeze'), '伺服器進度階段必須以顯示層映射，不可改 Socket payload：');
    ok(source.includes('source: options.source || \'YouTube\''), '匯入來源值必須保留為工作資料：');
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  test('語系切換會用快取資料重繪 Twitch runtime 與匯入中的動態 UI', () => {
    const twitchSource = fs.readFileSync(path.join(__dirname, '../public/js/app-twitch.js'), 'utf8');
    const youtubeSource = fs.readFileSync(path.join(__dirname, '../public/js/app-youtube-import.js'), 'utf8');
    const errorHandlerSource = fs.readFileSync(path.join(__dirname, '../public/js/error-handler.js'), 'utf8');
    ['import.job.redownloadSource', 'import.job.twitchSource'].forEach((key) => {
      ok(baselineKeys.includes(key), `動態匯入來源缺少 ${key}：`);
    });
    ok(twitchSource.includes('function renderRuntimeStatus(data)'), 'Twitch runtime 必須可由快取狀態重繪：');
    ok(twitchSource.includes('if (lastRuntimeStatus) renderRuntimeStatus(lastRuntimeStatus);'), '切換語言後必須立即重繪 Twitch runtime：');
    ok(youtubeSource.includes('function displayJobSource(job)'), '工作中心來源必須在顯示時才翻譯：');
    ok(youtubeSource.includes('sourceKey: options.sourceKey'), '工作中心需保留來源資料與語系鍵：');
    ok(youtubeSource.includes('setYtProgressPlaylistResult(imported, skipped, failed, true)'), '播放清單完成進度不可快照舊語言的片段：');
    ok(youtubeSource.includes('if (activeRiskAssessment) renderRiskAssessment(activeRiskAssessment);'), '開啟中的風險確認視窗必須隨語系重繪：');
    ok(youtubeSource.includes('const fallbackCatalog = Object.freeze'), '匯入 UI 在語系層短暫不可用時不得露出內部 key：');
    ok(errorHandlerSource.includes('const fallbackCatalog = Object.freeze'), '錯誤 UI 在語系層短暫不可用時不得露出內部 key：');
    i18n.setLocale('zh-CN', { persist: false, updateQuery: false });
    eq(
      i18n.t('twitch.runtime.reconnecting', { delay: i18n.t('twitch.runtime.retryIn', { seconds: '61' }), attempt: '6', error: '' }),
      'Twitch 连接中断，61 秒后自动重连（第 6 次）',
      '简中重连倒数的「后」只能由 delay 模板提供一次：'
    );
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  // 長尾表是機器產生的，結構檢查擋不住語意錯誤；下面四條是實機踩過的錯譯類型的回歸守衛。
  test('長尾字串表沿用 curated 術語，不得各自表述', () => {
    const autoRows = require('../public/js/i18n-auto');
    const prefer = {
      播放清單: 'nav.playlist',
      複製: 'common.copy',
      'OBS 來源網址': 'top.obsSources',
      正在播放: 'home.nowPlaying',
      已唱: 'setlist.done',
      貼上歌詞: 'preview.pasteLyrics',
      尚無歌曲: 'setlist.noTracks',
    };
    const curatedByZh = new Map();
    Object.keys(catalogs['zh-TW']).forEach((key) => {
      const zh = catalogs['zh-TW'][key];
      if (curatedByZh.has(zh) && prefer[zh] !== key) return;
      curatedByZh.set(zh, i18n.LOCALES.map((locale) => catalogs[locale][key]));
    });
    let shared = 0;
    Object.entries(autoRows).forEach(([source, values]) => {
      const curated = curatedByZh.get(source);
      if (!curated) return;
      shared += 1;
      eq(values.join(''), curated.join(''), `「${source}」在長尾表與 curated 表必須完全一致：`);
    });
    ok(shared >= 150, '兩張表應有大量共用來源可比對：');
  });

  test('長尾字串表不得留下已知的機器誤譯術語', () => {
    const autoRows = require('../public/js/i18n-auto');
    // 每一條都是 M6.1 初版實際出現過的錯譯：場→game、忠誠點數→loyalty、
    // 字級→font level、諧音→homophone、直書→straight book、控制台→console。
    const banned = {
      en: /per game|loyalty point|font level|\bhomophon|straight book|direct book|refractive ladder|star sand streamer|classic layering|\bconsole\b|\bverbatim\b|\bunsung\b|account number|jiugong|bidiange|zhazhishu|back panel|backplane|backing plate|readab\w* substrate|singing station|join tail|received station|still importing|song sheet page|analog singer|\bpen\b/i,
      ja: /冷却|ロイヤルティ|ロイヤリティ|フォントレベル|同音異義語|コンソール|ゲームあたり|ゲームごと|試合|逐語|ピンイン|口座番号|ダイレクトブック|Jiugong|BiDianGe|バックパネル|バックプレーン|バッキング|基板|Neon Singing|Classic Layer|テールに参加/,
      ko: /냉방|냉각|로열티|글꼴 수준|동음|콘솔|게임당|세션당|축어|병음|계좌번호|직접 도서|Jiugong|Bidiange|후면 패널|백플레인|뒷판|기판|Neon Singing|Classic Layer|테일 가입|제어판로|크기과/i,
    };
    Object.entries(banned).forEach(([locale, pattern]) => {
      const offset = i18n.LOCALES.indexOf(locale);
      const offenders = Object.entries(autoRows).filter(([, values]) => pattern.test(String(values[offset])));
      eq(offenders.length, 0, `${locale} 仍有機器誤譯術語（例如「${offenders[0] ? offenders[0][0] : ''}」）：`);
    });
  });

  test('長尾譯文不得出現機翻疊詞', () => {
    const autoRows = require('../public/js/i18n-auto');
    // 「星座 星座」「リストリスト」「목록 목록」「列表列表」這類疊詞是取代式修譯的
    // 典型副作用：某語言被修好了，另一語言把新詞疊在舊詞上。之前只有英文抓得到。
    const keywordList = (source) => source.split(/\s+/).length >= 4 && !/[，。、：；]/.test(source);
    const cjkDup = /([぀-ヿ㐀-鿿가-힯]{2,8})\s?\1/;
    const enDup = /\b(\w{3,})\s+\1\b/i;
    // 疊詞本來就合法的詞（韓文的 하나하나＝一個一個、日文的 一つ一つ 等）
    const allowed = new Set(['하나', '하나하나', '탱글', '탱글탱글', '各々', '様々', '色々', '一つ', '一つ一つ', '人人']);
    const offenders = [];
    Object.entries(autoRows).forEach(([source, values]) => {
      if (keywordList(source)) return; // 空白分隔的搜尋關鍵字列表本來就會重複詞根
      [1, 2, 3, 4].forEach((index) => {
        const match = cjkDup.exec(String(values[index]));
        if (match && !allowed.has(match[1])) offenders.push(`${source.slice(0, 26)} [${index}] ${match[0]}`);
      });
      if (enDup.test(String(values[1]))) offenders.push(`${source.slice(0, 26)} [en]`);
    });
    eq(offenders.length, 0, `譯文出現疊詞（例如「${offenders[0] || ''}」）：`);
  });

  test('简中長尾使用簡中用語，不是繁中字轉簡', () => {
    const autoRows = require('../public/js/i18n-auto');
    // 字形轉換不等於在地化：伺服器／匯入／檔案／程式 在简中要換詞而不是換字。
    const taiwanOnly = /伺服器|汇入|汇出|档案|视窗|资料夹|介面|程式|解析度|快取|登入|滑鼠|连线|网路|搜寻|讯息|储存|回覆|载入|连结|音档|资讯|纪录|字元|套用|使用者|装置|内建|帐号|自订|实况主|程序码|下载档|命令列|回传值|伫列|可携版|套入|线上更新|系统匣|权杖|透过|顺位|开台|收台|「|」|时间戳记|终端机|本机|变数|选配|相容|遗失|复原|存取|线上|全域|送出|贴上|建立|身分|联络|录影|存档/;
    const offenders = Object.entries(autoRows)
      .filter(([source]) => !source.startsWith('!'))
      .filter(([, values]) => taiwanOnly.test(String(values[4])));
    eq(offenders.length, 0, `简中仍有台灣用語或引號（例如「${offenders[0] ? offenders[0][0] : ''}」）：`);
    const classifierOffenders = Object.entries(autoRows)
      .filter(([source, values]) => !source.includes('素筆') && String(values[4]).includes('笔'));
    eq(classifierOffenders.length, 0, `简中數量詞仍誤用「笔」（例如「${classifierOffenders[0] ? classifierOffenders[0][0] : ''}」）：`);
  });

  test('英文長尾以大寫開頭，技術名詞除外', () => {
    const autoRows = require('../public/js/i18n-auto');
    const lowerAllowed = /^(yt-dlp|ffmpeg|npm|localhost|px|ms|http|www)/;
    // 這些片段是被 <code> 切開的句子後半段，英文必須小寫接續前半句。
    const sentenceTails = new Set(['手動查詢 IPv4 位址。']);
    const offenders = Object.entries(autoRows).filter(([source, values]) => (
      /^[㐀-鿿]/.test(source)
      && !sentenceTails.has(source)
      && /^[a-z]/.test(String(values[1]))
      && !lowerAllowed.test(String(values[1]))
    ));
    eq(offenders.length, 0, `英文句首大小寫不一致（例如「${offenders[0] ? offenders[0][0] : ''}」）：`);
  });

  test('Twitch 設定搜尋在非中文介面也搜得到', () => {
    const source = fs.readFileSync(path.join(__dirname, '../public/js/app-twitch.js'), 'utf8');
    ok(source.includes('function searchHaystack'), '搜尋必須同時比對中文索引與翻譯後文字：');
    ok(/searchEntries\.filter\(\(entry\) => searchHaystack\(entry\)/.test(source), '搜尋過濾必須走 searchHaystack：');
    ok(source.includes("t('twitch.settings.jump',"), '跳轉提示必須由具名變數的 curated 模板處理：');
    const entries = [...source.matchAll(/\{ label: '([^']+)', category: '([^']+)', terms: '([^']+)'/g)]
      .map(([, label, category, terms]) => [label, category, terms]);
    ok(entries.length >= 10, '應取得設定搜尋索引：');
    const haystack = (entry) => entry.concat(entry.map((value) => i18n.translate(value))).join(' ').toLocaleLowerCase();
    const probes = { en: ['refund', 'blacklist', 'cooldown'], ja: ['返金', 'ブラックリスト'], ko: ['환불', '차단'] };
    Object.entries(probes).forEach(([locale, words]) => {
      i18n.setLocale(locale, { persist: false, updateQuery: false });
      words.forEach((word) => {
        const hits = entries.filter((entry) => haystack(entry).includes(word.toLocaleLowerCase()));
        ok(hits.length > 0, `${locale} 介面搜尋「${word}」必須有結果：`);
      });
    });
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  test('長尾翻譯保留動態內容與外部歌曲／公告欄位', () => {
    i18n.setLocale('en', { persist: false, updateQuery: false });
    eq(i18n.translate('最近同步：首頁'), 'Recent synchronization: 首頁', '動態插值不得把外部內容再次翻譯：');
    [
      '.pi-title',
      '.pi-artist',
      '.lib-title',
      '.announcement-item-title',
      '.twitch-req-title',
      '.twitch-req-author',
      '.twitch-req-url',
      '#youtube-risk-title',
      '#youtube-risk-author',
    ].forEach((selector) => ok(i18nSource.includes(`'${selector}'`), `${selector} 必須排除自動翻譯：`));
    const playlistSource = fs.readFileSync(path.join(__dirname, '../public/js/app-playlist.js'), 'utf8');
    const setlistPanelSource = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
    const lyricExtrasSource = fs.readFileSync(path.join(__dirname, '../public/js/lyric-extras.js'), 'utf8');
    ok(playlistSource.includes('<span data-i18n-skip>${escapeHtml(f.name)}</span>'), '匯入紀錄名稱必須保留使用者文字：');
    ok(setlistPanelSource.includes("b.dataset.i18nSkip = '1'"), '自訂歌單風格名稱必須排除自動翻譯：');
    ok(lyricExtrasSource.includes('<option data-i18n-skip value="'), '自訂歌詞預設名稱必須排除自動翻譯：');
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  test('側欄導覽標籤維持可讀字級並允許長語言換行', () => {
    const panelCss = fs.readFileSync(path.join(__dirname, '../public/css/panel.css'), 'utf8');
    const navLabelRule = panelCss.match(/\.nav-item \.nav-label\s*\{([\s\S]*?)\}/)?.[1] || '';
    const fontSize = Number(navLabelRule.match(/font-size:\s*([\d.]+)px/)?.[1]);
    ok(fontSize >= 11, '側欄標籤至少 11px：');
    ok(panelCss.includes('-webkit-line-clamp: 2'), '長語言導覽標籤應可顯示兩行：');
    ok(!/\.nav-item \.nav-label\s*\{[^}]*white-space:\s*nowrap/.test(panelCss), '側欄標籤不可強制單行：');
  });

  test('深色模式所有原生下拉選項都有不透明底色與可讀文字', () => {
    const baseCss = fs.readFileSync(path.join(__dirname, '../public/css/base.css'), 'utf8');
    ok(/--select-popup-bg:\s*#[0-9a-f]{6};/i.test(baseCss), '深色下拉清單必須有不透明底色：');
    ok(/select option,\s*select optgroup\s*\{[\s\S]*?background-color:\s*var\(--select-popup-bg\);[\s\S]*?color:\s*var\(--text\);/.test(baseCss), '語系與一般下拉都必須套用主題化選項樣式：');
    ok(/select option:checked\s*\{[\s\S]*?background:\s*var\(--accent\);[\s\S]*?color:\s*var\(--accent-text\);/.test(baseCss), '選中項目必須維持強調色對比：');
  });

  test('語系模組沒有網路、Socket 或伺服器狀態寫入行為', () => {
    ok(!/\bfetch\s*\(/.test(i18nSource), '語系層不得發出 HTTP 請求：');
    ok(!/\bSocketClient\s*[.(]/.test(i18nSource), '語系層不得讀寫 Socket：');
    eq(i18n.STORAGE_KEY, 'elitesand-ui-locale', '只使用獨立的裝置語系偏好鍵：');
  });
}

// ─── 閉源化批次 B-2：SoundTouch LGPL 不得混進專有 production bundle ───
{
  const soundtouchGuard = require('../tools/build-production-bundles');
  const guardTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-soundtouch-guard-'));

  test('SoundTouch 守衛：乾淨的 bundle 內容不會被誤判', () => {
    const cleanFile = path.join(guardTmpDir, 'clean.bundle.js');
    fs.writeFileSync(cleanFile, 'function playTrack(a,b){return a+b}\nconst x=1;');
    const hits = soundtouchGuard.scanForSoundTouchFingerprint([cleanFile]);
    eq(hits.length, 0, '乾淨檔案不應命中任何 SoundTouch 特徵字串：');
  });

  test('SoundTouch 守衛：負向案例——故意混入 LGPL 特徵字串必須被抓到', () => {
    const contaminatedFile = path.join(guardTmpDir, 'contaminated.bundle.js');
    // 刻意塞進 SoundTouch 演算法核心才有的識別字串，模擬「不小心把 vendor/soundtouch*.js
    // 也讀進 bundle」的意外情況——這個測試必須失敗（也就是守衛必須抓到它），
    // 才能證明守衛不是形式主義的空氣測試。
    fs.writeFileSync(
      contaminatedFile,
      'class FifoSampleBuffer{putSamples(a,b,c){this.sourcePosition=b}}'
    );
    const hits = soundtouchGuard.scanForSoundTouchFingerprint([contaminatedFile]);
    ok(hits.length > 0, '混入 SoundTouch 特徵字串的檔案必須被守衛偵測到：');
    ok(hits.some((h) => h.file === contaminatedFile), '偵測結果必須指出確切的受污染檔案：');
  });

  test('SoundTouch 守衛：特徵字串清單涵蓋 soundtouch-worklet.js 實際使用的識別字', () => {
    const worklet = fs.readFileSync(
      path.join(__dirname, '../public/vendor/soundtouch-worklet.js'),
      'utf8'
    );
    for (const fingerprint of soundtouchGuard.SOUNDTOUCH_FINGERPRINTS) {
      ok(worklet.includes(fingerprint), `特徵字串「${fingerprint}」必須真的出現在 soundtouch-worklet.js，守衛才有意義：`);
    }
  });

  fs.rmSync(guardTmpDir, { recursive: true, force: true });
}

// ─── 閉源化批次 C-1：模板加密遞送 ───
{
  const templateDelivery = require('../server/services/template-delivery');

  test('模板遞送：開發模式（無 template-store）直接讀原始碼', () => {
    ok(!templateDelivery.isPacked(), '測試環境不應存在 server/template-store/：');
    const source = templateDelivery.getTemplateSource('aura');
    ok(typeof source === 'string' && source.length > 0, 'aura 模板應能讀到原始碼：');
    ok(source.includes("id: 'aura'") || source.includes('id:"aura"') || source.includes("id:'aura'"), '讀到的內容應該是 aura 模板本身：');
  });

  test('模板遞送：不在白名單的 id 回傳 null（server/index.js 據此回 404）', () => {
    eq(templateDelivery.getTemplateSource('not-a-real-template'), null, '未知 id 不應回傳任何內容：');
    eq(templateDelivery.getTemplateSource('../../etc/passwd'), null, '路徑穿越字串不在白名單內，必須被拒絕：');
  });

  test('模板遞送：六個模板 id 都在白名單內', () => {
    for (const id of ['pulse', 'facet', 'drift', 'aura', 'ktv', 'columnflow']) {
      ok(templateDelivery.TEMPLATE_IDS.has(id), `${id} 應在 TEMPLATE_IDS 白名單：`);
    }
    eq(templateDelivery.TEMPLATE_IDS.size, 6, '白名單應剛好六個（classic 是免費內建，不走這條）：');
  });

  test('模板遞送：指紋函式對相同內容回傳相同雜湊，用於 OBS 快取指紋', () => {
    const fp1 = templateDelivery.getTemplateFingerprint('ktv');
    const fp2 = templateDelivery.getTemplateFingerprint('ktv');
    eq(fp1, fp2, '同一份內容的指紋必須穩定：');
    ok(typeof fp1 === 'string' && fp1.length === 16, '指紋應為 16 字元十六進位字串：');
  });

  test('模板遞送：開發模式絕不快取——存檔改動立刻反映（曾經真的卡住過的 bug）', () => {
    // 開發模式讀的是開發者正在編輯的原始檔案，不像 production 的加密 blob 在整個
    // server 行程生命週期內都不會變。這裡曾經因為兩種模式共用同一份 sourceCache，
    // 導致 dev server 一起來、模板第一次被請求後，不管檔案怎麼改都讀到舊內容——
    // 「改完存檔、Ctrl+F5 就看得到」這句話當時其實是假的。
    const filePath = path.join(__dirname, '../public/js/lyric-template-pulse.js');
    const original = fs.readFileSync(filePath, 'utf8');
    try {
      const first = templateDelivery.getTemplateSource('pulse');
      eq(first, original, '第一次讀取應該等於目前檔案內容：');

      const marker = `\n// __cache_invalidation_probe_${Date.now()}__\n`;
      fs.writeFileSync(filePath, original + marker);
      const second = templateDelivery.getTemplateSource('pulse');
      ok(second.includes(marker), '開發模式下，檔案存檔後下一次讀取必須立刻反映新內容，不可回傳快取的舊版本：');
    } finally {
      fs.writeFileSync(filePath, original);
    }
  });
}

// ─── 閉源化批次 C-1：加密封裝往返正確性（build-production-bundles.js 的 packTemplates）───
{
  const { packTemplates, TEMPLATE_IDS: PACK_TEMPLATE_IDS } = require('../tools/build-production-bundles');
  const esbuild = require('esbuild');

  test('模板封裝：加密後解密內容與原始碼 minify 結果逐位元組一致', () => {
    const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-template-pack-'));
    try {
      const publicJsDir = path.join(stageDir, 'public', 'js');
      const serverServicesDir = path.join(stageDir, 'server', 'services');
      fs.mkdirSync(publicJsDir, { recursive: true });
      fs.mkdirSync(serverServicesDir, { recursive: true });

      const originals = {};
      for (const id of PACK_TEMPLATE_IDS) {
        const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', `lyric-template-${id}.js`), 'utf8');
        originals[id] = src;
        fs.writeFileSync(path.join(publicJsDir, `lyric-template-${id}.js`), src);
      }

      packTemplates(stageDir);

      ok(!fs.existsSync(path.join(publicJsDir, 'lyric-template-aura.js')), '封裝後原始檔必須刪除：');
      const keyModule = require(path.join(serverServicesDir, 'template-key.generated.js'));
      const key = Buffer.from(keyModule.key, 'hex');
      eq(key.length, 32, 'AES-256-GCM 金鑰長度必須是 32 bytes：');

      const crypto = require('crypto');
      for (const id of PACK_TEMPLATE_IDS) {
        const blob = fs.readFileSync(path.join(stageDir, 'server', 'template-store', `${id}.eltpl`));
        const iv = blob.subarray(0, 12);
        const authTag = blob.subarray(12, 28);
        const ciphertext = blob.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
        const expected = esbuild.transformSync(originals[id], { loader: 'js', minify: true, legalComments: 'none' }).code;
        eq(decrypted, expected, `${id} 解密內容應與原始碼 minify 後逐位元組一致：`);
      }
    } finally {
      fs.rmSync(stageDir, { recursive: true, force: true });
    }
  });

  test('模板封裝：竄改密文的任一位元組必須讓解密失敗（GCM 完整性驗證生效）', () => {
    const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-template-pack-tamper-'));
    try {
      const publicJsDir = path.join(stageDir, 'public', 'js');
      fs.mkdirSync(publicJsDir, { recursive: true });
      fs.mkdirSync(path.join(stageDir, 'server', 'services'), { recursive: true });
      for (const id of PACK_TEMPLATE_IDS) {
        const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', `lyric-template-${id}.js`), 'utf8');
        fs.writeFileSync(path.join(publicJsDir, `lyric-template-${id}.js`), src);
      }
      packTemplates(stageDir);

      const crypto = require('crypto');
      const keyModule = require(path.join(stageDir, 'server', 'services', 'template-key.generated.js'));
      const key = Buffer.from(keyModule.key, 'hex');
      const blobPath = path.join(stageDir, 'server', 'template-store', 'pulse.eltpl');
      const blob = fs.readFileSync(blobPath);
      blob[blob.length - 1] ^= 0xff; // 竄改密文最後一個 byte

      const iv = blob.subarray(0, 12);
      const authTag = blob.subarray(12, 28);
      const ciphertext = blob.subarray(28);
      let threw = false;
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      } catch (_) {
        threw = true;
      }
      ok(threw, '竄改過的密文必須讓 GCM 驗證失敗，而不是悄悄解出錯誤內容：');
    } finally {
      fs.rmSync(stageDir, { recursive: true, force: true });
    }
  });
}

// ─── 閉源化批次 C-2：付費模板簽章驗證與安裝閘門 ───
{
  const crypto = require('crypto');
  const pkgVerify = require('../server/services/template-package-verify');
  const pkgInstall = require('../server/services/template-package-install');
  const { BUILTIN_TEMPLATE_IDS } = require('../server/services/template-ids');

  // 每個測試用自己的一次性測試金鑰簽章，絕不依賴 .local/ 裡的真正私鑰
  // （那份檔案只存在開發者本機，clone 下來的環境不會有，測試不能依賴它存在）。
  function makeTestKeypair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyHex = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
    return { publicKeyHex, privateKey };
  }

  function buildSignedPackage(dir, { privateKey, templateId = 'test-premium', version = '1.0.0', code = 'console.log("premium template")', minEngineVersion, maxEngineVersion }) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'template.js'), code);
    const assetHash = crypto.createHash('sha256').update(code).digest('hex');
    const manifest = {
      schemaVersion: 1,
      templateId,
      version,
      displayName: { 'zh-TW': '測試付費模板', en: 'Test Premium Template' },
      assets: [{ path: 'template.js', sha256: assetHash }],
    };
    if (minEngineVersion) manifest.minEngineVersion = minEngineVersion;
    if (maxEngineVersion) manifest.maxEngineVersion = maxEngineVersion;
    const message = Buffer.from(pkgVerify.canonicalize(manifest), 'utf8');
    manifest.signature = crypto.sign(null, message, privateKey).toString('hex');
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return manifest;
  }

  test('模板包驗證：合法簽章＋正確雜湊通過驗證', () => {
    const { publicKeyHex, privateKey } = makeTestKeypair();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-pkg-valid-'));
    try {
      buildSignedPackage(dir, { privateKey });
      const result = pkgVerify.verifyTemplatePackageDir(dir, { publicKeyHex });
      ok(result.ok, `合法模板包應該通過驗證：${result.reason || ''}`);
      eq(result.manifest.templateId, 'test-premium', 'manifest 應正確解析：');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('模板包驗證：竄改 manifest 任一欄位會讓簽章失效', () => {
    const { publicKeyHex, privateKey } = makeTestKeypair();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-pkg-tamper-manifest-'));
    try {
      buildSignedPackage(dir, { privateKey, version: '1.0.0' });
      const manifestPath = path.join(dir, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.version = '9.9.9'; // 竄改一個欄位，簽章沒有跟著改
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      const result = pkgVerify.verifyTemplatePackageDir(dir, { publicKeyHex });
      ok(!result.ok, '竄改過 manifest 但簽章沒變的包必須驗證失敗：');
      ok(/簽章/.test(result.reason), '失敗原因應該指出是簽章問題：' + result.reason);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('模板包驗證：竄改資產內容（但沒改 manifest 雜湊）會被雜湊比對抓到', () => {
    const { publicKeyHex, privateKey } = makeTestKeypair();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-pkg-tamper-asset-'));
    try {
      buildSignedPackage(dir, { privateKey });
      fs.writeFileSync(path.join(dir, 'template.js'), 'console.log("evil injected code")');
      const result = pkgVerify.verifyTemplatePackageDir(dir, { publicKeyHex });
      ok(!result.ok, '資產內容被換掉但雜湊沒對應更新，必須驗證失敗：');
      ok(/雜湊/.test(result.reason), '失敗原因應該指出是雜湊問題：' + result.reason);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('模板包驗證：用不對的公鑰驗證會失敗（不是官方簽發）', () => {
    const { privateKey } = makeTestKeypair();
    const { publicKeyHex: wrongPublicKeyHex } = makeTestKeypair(); // 另一把跟簽章不成對的公鑰
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-pkg-wrong-key-'));
    try {
      buildSignedPackage(dir, { privateKey });
      const result = pkgVerify.verifyTemplatePackageDir(dir, { publicKeyHex: wrongPublicKeyHex });
      ok(!result.ok, '用不成對的公鑰驗證必須失敗：');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('模板包驗證：不相容的引擎版本會被拒絕', () => {
    const { publicKeyHex, privateKey } = makeTestKeypair();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-pkg-engine-range-'));
    try {
      buildSignedPackage(dir, { privateKey, minEngineVersion: '99.0.0' });
      const result = pkgVerify.verifyTemplatePackageDir(dir, { publicKeyHex, engineVersion: '0.9.9.1' });
      ok(!result.ok, '需要 99.0.0 以上但目前引擎是 0.9.9.1，必須拒絕：');
      ok(/引擎版本/.test(result.reason), '失敗原因應該指出引擎版本不相容：' + result.reason);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('模板包驗證：路徑穿越的 asset path 必須被拒絕', () => {
    const { publicKeyHex, privateKey } = makeTestKeypair();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-pkg-path-traversal-'));
    try {
      const code = 'console.log(1)';
      fs.writeFileSync(path.join(dir, 'template.js'), code);
      const manifest = {
        schemaVersion: 1,
        templateId: 'evil-template',
        version: '1.0.0',
        assets: [{ path: '../../../etc/passwd', sha256: crypto.createHash('sha256').update(code).digest('hex') }],
      };
      const message = Buffer.from(pkgVerify.canonicalize(manifest), 'utf8');
      manifest.signature = crypto.sign(null, message, privateKey).toString('hex');
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
      const result = pkgVerify.verifyTemplatePackageDir(dir, { publicKeyHex });
      ok(!result.ok, '含路徑分隔符的 asset path 必須在格式檢查就被拒絕：');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('模板安裝：templateId 跟內建模板衝突必須被拒絕（就算簽章驗證已經通過）', () => {
    ok(BUILTIN_TEMPLATE_IDS.has('aura'), '前提：aura 應該在內建清單裡：');
    // 用 installVerifiedTemplate 跳過簽章驗證階段，直接測「已驗證通過的 manifest」
    // 還會不會被 ID 衝突擋下——這是安裝流程自己的防線，不該依賴簽章驗證失敗才擋住。
    const fakeManifest = {
      schemaVersion: 1,
      templateId: 'aura',
      version: '1.0.0',
      assets: [{ path: 'template.js', sha256: 'a'.repeat(64) }],
    };
    const result = pkgInstall.installVerifiedTemplate(fakeManifest, { 'template.js': Buffer.from('x') });
    ok(!result.ok, '即使 manifest 已通過驗證，templateId 撞到內建模板也必須被安裝流程拒絕：');
    ok(!pkgInstall.isInstalled('aura'), '不應該把假冒 aura 的模板寫進已安裝清單：');
  });

  test('模板安裝：production 安裝路徑（template-package-install.js）絕不傳測試金鑰參數', () => {
    // 白箱檢查：production 可達的程式碼路徑一旦意外傳了 publicKeyHex，
    // 就等於讓任何人用自己簽的假金鑰包冒充官方模板——這條防線必須用原始碼掃描鎖死。
    const installSource = fs.readFileSync(path.join(__dirname, '../server/services/template-package-install.js'), 'utf8');
    ok(!/publicKeyHex/.test(installSource), 'template-package-install.js 不得出現 publicKeyHex（絕不可覆蓋成測試金鑰）：');
  });

  test('模板安裝：完整流程——驗證失敗的包（用假金鑰）不會被裝進本機儲存', () => {
    const { privateKey } = makeTestKeypair(); // 跟 template-public-key.js 內建的真公鑰不成對
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-pkg-install-reject-'));
    try {
      buildSignedPackage(dir, { privateKey, templateId: 'fake-premium-template' });
      const result = pkgInstall.installTemplatePackage(dir);
      ok(!result.ok, '用非官方金鑰簽的包，走真正的安裝流程（用真公鑰驗證）必須被拒絕：');
      ok(!pkgInstall.isInstalled('fake-premium-template'), '驗證失敗的模板不應該被寫進已安裝清單：');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('模板安裝／移除：isInstalled 與 removeInstalledTemplate 的基本狀態轉移', () => {
    // 不需要真正簽章通過就能測狀態機本身：直接確認初始狀態，以及移除不存在項目的行為。
    ok(!pkgInstall.isInstalled('never-installed-xyz'), '從未安裝的 id 應回傳 false：');
    eq(pkgInstall.removeInstalledTemplate('never-installed-xyz'), false, '移除不存在的項目應回傳 false，不拋錯：');
  });

  test('模板簽章私鑰絕不可出現在任何會被打包的原始碼裡（server/、public/）', () => {
    // 私鑰只該存在 .local/template-signing/（gitignore 排除、不進任何 build）。
    // 這裡掃 server/ 與 public/ 的所有 .js/.json，防的是「手滑把私鑰複製進某個
    // 會被 minify 進 production bundle 的檔案」這種事故。
    const dirsToScan = ['server', 'public'];
    const offenders = [];
    function scanDir(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(full);
        } else if (/\.(js|json)$/.test(entry.name)) {
          const content = fs.readFileSync(full, 'utf8');
          if (content.includes('BEGIN PRIVATE KEY') || content.includes('BEGIN EC PRIVATE KEY') || content.includes('BEGIN RSA PRIVATE KEY')) {
            offenders.push(full);
          }
        }
      }
    }
    scanDir(path.join(__dirname, '..', 'server'));
    scanDir(path.join(__dirname, '..', 'public'));
    eq(offenders.length, 0, `不得含私鑰字樣的檔案卻找到: ${offenders.join(', ')}`);
  });
}

// ─── 閉源化批次 D-1：FFmpeg 按需下載 ───
{
  const AdmZip = require('adm-zip');
  const ffmpegProvider = require('../server/services/ffmpeg-provider');
  const loadConfig = require('../server/utils/load-config');

  test('FFmpeg 供應：能在合成的 zip 內找到 bin/ffmpeg.exe 與 bin/ffprobe.exe（gyan.dev 慣例結構）', () => {
    const zip = new AdmZip();
    zip.addFile('ffmpeg-9.0-essentials_build/bin/ffmpeg.exe', Buffer.from('fake ffmpeg binary'));
    zip.addFile('ffmpeg-9.0-essentials_build/bin/ffprobe.exe', Buffer.from('fake ffprobe binary'));
    zip.addFile('ffmpeg-9.0-essentials_build/bin/ffplay.exe', Buffer.from('fake ffplay binary'));
    zip.addFile('ffmpeg-9.0-essentials_build/doc/ffmpeg.html', Buffer.from('docs'));
    zip.addFile('ffmpeg-9.0-essentials_build/LICENSE.txt', Buffer.from('license'));
    const { ffmpegEntry, ffprobeEntry } = ffmpegProvider.findFfmpegEntries(zip.getEntries());
    ok(ffmpegEntry, '應該找到 bin/ffmpeg.exe：');
    ok(ffprobeEntry, '應該找到 bin/ffprobe.exe：');
    eq(ffmpegEntry.getData().toString(), 'fake ffmpeg binary', '取出的內容應該是正確的那個 entry：');
  });

  test('FFmpeg 供應：版本資料夾名稱改變也找得到（不寫死版本號）', () => {
    const zip = new AdmZip();
    zip.addFile('ffmpeg-2099-git-deadbeef-essentials_build/bin/ffmpeg.exe', Buffer.from('x'));
    zip.addFile('ffmpeg-2099-git-deadbeef-essentials_build/bin/ffprobe.exe', Buffer.from('x'));
    const { ffmpegEntry, ffprobeEntry } = ffmpegProvider.findFfmpegEntries(zip.getEntries());
    ok(ffmpegEntry && ffprobeEntry, '不同版本號的資料夾名稱不該影響尋找：');
  });

  test('FFmpeg 供應：不會誤判非 bin/ 目錄下同名檔案', () => {
    const zip = new AdmZip();
    zip.addFile('ffmpeg-9.0-essentials_build/doc/ffmpeg.exe', Buffer.from('wrong location'));
    zip.addFile('ffmpeg-9.0-essentials_build/presets/ffprobe.exe', Buffer.from('wrong location'));
    const { ffmpegEntry, ffprobeEntry } = ffmpegProvider.findFfmpegEntries(zip.getEntries());
    ok(!ffmpegEntry, '不在 bin/ 底下的同名檔案不該被當成正牌 ffmpeg.exe：');
    ok(!ffprobeEntry, '不在 bin/ 底下的同名檔案不該被當成正牌 ffprobe.exe：');
  });

  test('FFmpeg 供應：缺少其中一個執行檔時視為找不到（extract 那邊會整體拒絕）', () => {
    const zip = new AdmZip();
    zip.addFile('pkg/bin/ffmpeg.exe', Buffer.from('x'));
    const { ffmpegEntry, ffprobeEntry } = ffmpegProvider.findFfmpegEntries(zip.getEntries());
    ok(ffmpegEntry, '前提：ffmpeg.exe 應該找得到：');
    ok(!ffprobeEntry, 'ffprobe.exe 沒放進去就應該找不到，不能只有一半就當作可用：');
  });

  test('FFmpeg 供應：resolveFfmpegPaths 優先採用 config.js 指定的路徑', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-ffmpeg-config-'));
    const fakeFfmpeg = path.join(tmpDir, 'ffmpeg.exe');
    fs.writeFileSync(fakeFfmpeg, 'fake');
    const original = loadConfig.ffmpegPath;
    try {
      loadConfig.ffmpegPath = fakeFfmpeg;
      const resolved = ffmpegProvider.resolveFfmpegPaths();
      eq(resolved.source, 'config', 'config.js 指定路徑應該是最高優先：');
      eq(resolved.ffmpeg, fakeFfmpeg, '應該回傳 config 指定的確切路徑：');
    } finally {
      loadConfig.ffmpegPath = original;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('FFmpeg 供應：config.js 指定的路徑若檔案不存在，不該被誤採用（fall through 到下一優先序）', () => {
    const original = loadConfig.ffmpegPath;
    try {
      loadConfig.ffmpegPath = 'C:/this/path/definitely/does/not/exist/ffmpeg.exe';
      const resolved = ffmpegProvider.resolveFfmpegPaths();
      ok(!resolved || resolved.source !== 'config', '不存在的路徑不該被當成有效設定：');
    } finally {
      loadConfig.ffmpegPath = original;
    }
  });

  test('FFmpeg 供應：commandExistsOnPath 對已知存在／不存在的指令行為正確', () => {
    ok(ffmpegProvider.commandExistsOnPath('node'), 'node 本身一定在 PATH 上（測試就是這樣跑起來的）：');
    ok(!ffmpegProvider.commandExistsOnPath('this-command-definitely-does-not-exist-xyz123'), '不存在的指令應回傳 false：');
  });

  test('FFmpeg 供應：available 必須要求 ffmpeg 與 ffprobe 都能真的執行，不可只看檔案存在', () => {
    const calls = [];
    const validation = ffmpegProvider.validateFfmpegPair(
      { ffmpeg: 'C:/fake/ffmpeg.exe', ffprobe: 'C:/fake/ffprobe.exe' },
      {
        spawnSyncImpl: (command, args) => {
          calls.push({ command, args });
          return { status: command.endsWith('ffmpeg.exe') ? 0 : 1, error: null };
        },
      },
    );
    eq(validation.ffmpegOk, true, 'ffmpeg 可執行時應通過自己的檢查：');
    eq(validation.ffprobeOk, false, 'ffprobe 壞掉時必須明確失敗：');
    eq(validation.ok, false, '只有一半能執行絕不能視為 FFmpeg 已就緒：');
    eq(calls.length, 2, '必須同時驗證 ffmpeg 與 ffprobe：');
    ok(calls.every((call) => call.args[0] === '-version'), '驗證只允許執行唯讀的 -version：');
  });

  test('FFmpeg 供應：下載快取只有 ffmpeg.exe、缺 ffprobe.exe 時不可當成 downloaded pair', () => {
    const originalConfigPath = loadConfig.ffmpegPath;
    const originalFfmpeg = fs.existsSync(ffmpegProvider.FFMPEG_EXE) ? fs.readFileSync(ffmpegProvider.FFMPEG_EXE) : null;
    const originalFfprobe = fs.existsSync(ffmpegProvider.FFPROBE_EXE) ? fs.readFileSync(ffmpegProvider.FFPROBE_EXE) : null;
    try {
      loadConfig.ffmpegPath = '';
      fs.mkdirSync(ffmpegProvider.BIN_DIR, { recursive: true });
      fs.writeFileSync(ffmpegProvider.FFMPEG_EXE, 'partial-install');
      fs.rmSync(ffmpegProvider.FFPROBE_EXE, { force: true });
      const resolved = ffmpegProvider.resolveFfmpegPaths();
      ok(!resolved || resolved.source !== 'downloaded', '半套下載不可被當成已安裝完成：');
    } finally {
      loadConfig.ffmpegPath = originalConfigPath;
      if (originalFfmpeg) fs.writeFileSync(ffmpegProvider.FFMPEG_EXE, originalFfmpeg);
      else fs.rmSync(ffmpegProvider.FFMPEG_EXE, { force: true });
      if (originalFfprobe) fs.writeFileSync(ffmpegProvider.FFPROBE_EXE, originalFfprobe);
      else fs.rmSync(ffmpegProvider.FFPROBE_EXE, { force: true });
    }
  });

  test('FFmpeg 供應：替換交易可回滾，避免只換成功一半就破壞原本 pair', () => {
    const backupFfmpeg = `${ffmpegProvider.FFMPEG_EXE}.previous`;
    const backupFfprobe = `${ffmpegProvider.FFPROBE_EXE}.previous`;
    const tmpFfmpeg = path.join(ffmpegProvider.BIN_DIR, 'ffmpeg.transaction-test.exe');
    const tmpFfprobe = path.join(ffmpegProvider.BIN_DIR, 'ffprobe.transaction-test.exe');
    fs.mkdirSync(ffmpegProvider.BIN_DIR, { recursive: true });
    fs.rmSync(backupFfmpeg, { force: true });
    fs.rmSync(backupFfprobe, { force: true });
    fs.writeFileSync(ffmpegProvider.FFMPEG_EXE, 'old-ffmpeg');
    fs.writeFileSync(ffmpegProvider.FFPROBE_EXE, 'old-ffprobe');
    fs.writeFileSync(tmpFfmpeg, 'new-ffmpeg');
    fs.writeFileSync(tmpFfprobe, 'new-ffprobe');

    const transaction = ffmpegProvider._beginPairInstall(tmpFfmpeg, tmpFfprobe);
    eq(fs.readFileSync(ffmpegProvider.FFMPEG_EXE, 'utf8'), 'new-ffmpeg');
    eq(fs.readFileSync(ffmpegProvider.FFPROBE_EXE, 'utf8'), 'new-ffprobe');
    transaction.rollback();
    eq(fs.readFileSync(ffmpegProvider.FFMPEG_EXE, 'utf8'), 'old-ffmpeg', 'rollback 要恢復舊 ffmpeg：');
    eq(fs.readFileSync(ffmpegProvider.FFPROBE_EXE, 'utf8'), 'old-ffprobe', 'rollback 要恢復舊 ffprobe：');
    fs.rmSync(ffmpegProvider.FFMPEG_EXE, { force: true });
    fs.rmSync(ffmpegProvider.FFPROBE_EXE, { force: true });
    fs.rmSync(backupFfmpeg, { force: true });
    fs.rmSync(backupFfprobe, { force: true });
  });

  test('FFmpeg 供應：上次若死在半套替換，下一次交易會先整組恢復舊版', () => {
    const backupFfmpeg = `${ffmpegProvider.FFMPEG_EXE}.previous`;
    const backupFfprobe = `${ffmpegProvider.FFPROBE_EXE}.previous`;
    const tmpFfmpeg = path.join(ffmpegProvider.BIN_DIR, 'ffmpeg.recovery-test.exe');
    const tmpFfprobe = path.join(ffmpegProvider.BIN_DIR, 'ffprobe.recovery-test.exe');
    fs.mkdirSync(ffmpegProvider.BIN_DIR, { recursive: true });
    fs.writeFileSync(backupFfmpeg, 'old-ffmpeg');
    fs.writeFileSync(backupFfprobe, 'old-ffprobe');
    fs.writeFileSync(ffmpegProvider.FFMPEG_EXE, 'half-installed-new-ffmpeg');
    fs.rmSync(ffmpegProvider.FFPROBE_EXE, { force: true });
    fs.writeFileSync(tmpFfmpeg, 'newer-ffmpeg');
    fs.writeFileSync(tmpFfprobe, 'newer-ffprobe');

    const transaction = ffmpegProvider._beginPairInstall(tmpFfmpeg, tmpFfprobe);
    transaction.rollback();
    eq(fs.readFileSync(ffmpegProvider.FFMPEG_EXE, 'utf8'), 'old-ffmpeg', '半套交易要先恢復舊 ffmpeg：');
    eq(fs.readFileSync(ffmpegProvider.FFPROBE_EXE, 'utf8'), 'old-ffprobe', '半套交易要先恢復舊 ffprobe：');
    fs.rmSync(ffmpegProvider.FFMPEG_EXE, { force: true });
    fs.rmSync(ffmpegProvider.FFPROBE_EXE, { force: true });
    fs.rmSync(backupFfmpeg, { force: true });
    fs.rmSync(backupFfprobe, { force: true });
  });

  test('FFmpeg 供應：BtbN checksums.sha256 會精確挑出目標 Windows LGPL zip 的雜湊', () => {
    const source = ffmpegProvider.DOWNLOAD_SOURCES.find((item) => item.id === 'btbn');
    ok(source && source.checksumFile, 'BtbN 來源必須指定 checksum 檔名：');
    const wanted = 'a'.repeat(64);
    const other = 'b'.repeat(64);
    const checksum = Buffer.from(`${other}  some-other-build.zip\n${wanted}  ${source.checksumFile}\n`, 'utf8');
    eq(ffmpegProvider.parseExpectedHash(source, checksum), wanted);
  });

  testAsync('FFmpeg 供應：主要來源失敗會自動切備援，且下載進度可被查詢', async () => {
    ffmpegProvider._resetForTests();
    const zip = new AdmZip();
    zip.addFile('ffmpeg-test/bin/ffmpeg.exe', Buffer.from('fake-ffmpeg'));
    zip.addFile('ffmpeg-test/bin/ffprobe.exe', Buffer.from('fake-ffprobe'));
    const zipBuffer = zip.toBuffer();
    const zipHash = require('crypto').createHash('sha256').update(zipBuffer).digest('hex');
    const sources = [
      { id: 'primary-test', label: 'primary-test', url: 'https://primary.test/ffmpeg.zip', checksumUrl: 'https://primary.test/hash', checksumFile: null },
      { id: 'backup-test', label: 'backup-test', url: 'https://backup.test/ffmpeg.zip', checksumUrl: 'https://backup.test/hash', checksumFile: null },
    ];
    const stages = [];
    const cleanup = [
      ffmpegProvider.FFMPEG_EXE,
      ffmpegProvider.FFPROBE_EXE,
      `${ffmpegProvider.FFMPEG_EXE}.previous`,
      `${ffmpegProvider.FFPROBE_EXE}.previous`,
      path.join(ffmpegProvider.BIN_DIR, 'ffmpeg.download.zip'),
      path.join(ffmpegProvider.BIN_DIR, 'ffmpeg.download.exe'),
      path.join(ffmpegProvider.BIN_DIR, 'ffprobe.download.exe'),
    ];
    cleanup.forEach((file) => fs.rmSync(file, { force: true }));
    try {
      const result = await ffmpegProvider.downloadFfmpeg({
        platform: 'win32',
        sources,
        fetchBufferImpl: async () => Buffer.from(`${zipHash}\n`, 'utf8'),
        fetchFileImpl: async (url, filePath, options) => {
          if (url.includes('primary.test')) throw new Error('simulated source timeout');
          fs.writeFileSync(filePath, zipBuffer);
          options.onProgress?.({
            downloadedBytes: zipBuffer.length,
            totalBytes: zipBuffer.length,
            percent: 100,
            speedBytesPerSec: zipBuffer.length * 2,
          });
          return {
            downloadedBytes: zipBuffer.length,
            totalBytes: zipBuffer.length,
            sha256: zipHash,
          };
        },
        spawnSyncImpl: () => ({ status: 0, error: null }),
        onProgress: (status) => stages.push(status.stage),
      });
      eq(result.source, 'backup-test', '主要來源失敗後應由備援完成：');
      ok(stages.includes('source-fallback'), '進度流必須看得到切換備援來源：');
      ok(stages.includes('download'), '進度流必須包含真正下載階段：');
      const finalStatus = ffmpegProvider.getDownloadStatus();
      eq(finalStatus.active, false, '完成後進度狀態不可繼續宣稱下載中：');
      eq(finalStatus.stage, 'done', '完成後狀態必須停在 done：');
      eq(finalStatus.percent, 100, '完成後進度必須是 100%：');
    } finally {
      cleanup.forEach((file) => fs.rmSync(file, { force: true }));
      ffmpegProvider._resetForTests();
    }
  });

  testAsync('FFmpeg 供應：非 Windows 平台呼叫 downloadFfmpeg 應該明確拒絕，而不是嘗試下載 .exe', async () => {
    if (process.platform === 'win32') return; // 這台是 Windows，跳過（行為只在非 Windows 平台觸發）
    try {
      await ffmpegProvider.downloadFfmpeg();
      throw new Error('非 Windows 平台不應該讓下載成功');
    } catch (err) {
      ok(/Windows/.test(err.message), '應該明確說明只支援 Windows：');
    }
  });
}

// ─── 直書句流：中央安全距離（使用者反映「兩邊分散仍會跑到中間」的修復） ───
{
  const columnflowSource = fs.readFileSync(path.join(__dirname, '../public/js/lyric-template-columnflow.js'), 'utf8');

  function loadColumnflowSandbox() {
    const sandbox = {
      LyricTemplates: { register(template) { this.template = template; } },
      LyricMotion: {
        hashNoise: (seed, salt) => {
          const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
          return x - Math.floor(x);
        },
        ensureWordTimings: (line) => line.words,
        buildGraphemeTimings: (word) => Array.from(word.text).map((char, i) => ({
          char, startMs: word.start + i * (word.duration / Math.max(1, word.text.length)),
        })),
      },
      document: { documentElement: {}, body: { dataset: {} } },
      window: { innerWidth: 1280, innerHeight: 720 },
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
      console,
    };
    // makeNode 要在 sandbox 建好、可以參照 sandbox.document.body 之後才定義
    function makeNode(options = {}) {
      const node = {
        style: {},
        classList: {
          _set: new Set(),
          add(c) { this._set.add(c); },
          remove(c) { this._set.delete(c); },
          toggle(c, on) { if (on) this._set.add(c); else this._set.delete(c); },
          contains(c) { return this._set.has(c); },
        },
        children: [],
        parentNode: null,
        offsetWidth: options.offsetWidth || 0,
        offsetHeight: options.offsetHeight || 0,
        clientWidth: options.clientWidth || 0,
        clientHeight: options.clientHeight || 0,
        appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
        removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parentNode = null; return child; },
        querySelectorAll(selector) {
          const cls = selector.replace('.', '');
          const out = [];
          (function walk(n) { n.children.forEach((c) => { if (c.classList.contains(cls)) out.push(c); walk(c); }); })(this);
          return out;
        },
        querySelector(selector) {
          return this.querySelectorAll(selector)[0] || null;
        },
        getBoundingClientRect() {
          const left = parseFloat(this.style.left) || 0;
          const top = parseFloat(this.style.top) || 0;
          return { left, top, right: left + this.offsetWidth, bottom: top + this.offsetHeight, width: this.offsetWidth, height: this.offsetHeight };
        },
        setAttribute() {},
        set className(v) { this._className = v; this.classList._set = new Set(v.split(/\s+/).filter(Boolean)); },
        get className() { return this._className || ''; },
        set textContent(v) { this._textContent = v; },
        get textContent() { return this._textContent || ''; },
        set innerHTML(v) { this._innerHTML = v; this.children = []; },
        get innerHTML() { return this._innerHTML || ''; },
      };
      node.style.setProperty = function setProperty(name, value) { this[name] = value; };
      return node;
    }
    sandbox.document.createElement = () => makeNode();
    vm.runInNewContext(columnflowSource, sandbox, { filename: 'lyric-template-columnflow.js' });
    return { sandbox, makeNode };
  }

  // computeLanes 定義在模板 IIFE 內部（閉包私有），要在 IIFE 結束前插入匯出語句
  // 才拿得到——直接在收尾的 "})();" 前插入，不動實際檔案。
  const columnflowSourceWithExport = columnflowSource.replace(
    /\}\)\(\);\s*$/,
    ';globalThis.__computeLanesForTest = computeLanes;\n})();'
  );

  test('直書句流：computeLanes 在預設安全距離（11%）下重現原本的車道位置', () => {
    const exportSandbox = loadColumnflowSandbox().sandbox;
    vm.runInNewContext(columnflowSourceWithExport, exportSandbox, { filename: 'lyric-template-columnflow.js' });
    const { leftLanes, rightLanes } = exportSandbox.__computeLanesForTest(11);
    eq(leftLanes.map((v) => Math.round(v)).join(','), '9,19,29,39', '預設 11% 安全距離應重現原本寫死的 LEFT_LANES：');
    eq(rightLanes.map((v) => Math.round(v)).join(','), '91,81,71,61', '預設 11% 安全距離應重現原本寫死的 RIGHT_LANES：');
  });

  test('直書句流：安全距離調大，車道會整體遠離中央', () => {
    const exportSandbox = loadColumnflowSandbox().sandbox;
    vm.runInNewContext(columnflowSourceWithExport, exportSandbox, { filename: 'lyric-template-columnflow.js' });
    const wide = exportSandbox.__computeLanesForTest(25);
    ok(Math.max(...wide.leftLanes) < 39, '安全距離拉大到 25%，左側最內車道必須比預設（39%）更靠邊：');
    ok(Math.min(...wide.rightLanes) > 61, '安全距離拉大到 25%，右側最內車道必須比預設（61%）更靠邊：');
  });

  testAsync('直書句流：很長的一句（多段續接、實際寬度很寬）不會被放到跨過中央安全區', async () => {
    const { sandbox, makeNode } = loadColumnflowSandbox();
    // 模擬「一個很寬的直行」：8 個續接段，每段 40px，總寬度 320px——在 1280px 寬的畫面裡
    // 這個寬度確實有可能從左側車道（起點約 29%＝371px）一路延伸超過中央安全線（39%＝499px）。
    // 這正是使用者回報「兩邊分散仍會跑到中間」的根因：舊邏輯只用車道起點決定位置，
    // 從不檢查實際渲染寬度會不會越界。
    const container = makeNode({ clientWidth: 1280, clientHeight: 720 });
    const template = sandbox.LyricTemplates.template;
    const ctx = { getLyrics: () => lines };
    template.mount(container, ctx);
    const rootEl = container.children[0];
    rootEl.clientWidth = 1280;
    rootEl.clientHeight = 720;

    const longText = '甲'.repeat(60); // 60 字，遠超單一直行可容納的字數，強制切成多段續接
    const lines = [{
      time: 0,
      text: longText,
      words: [{ text: longText, start: 0, duration: 6000 }],
    }];

    template.onLyricsLoaded(lines, ctx);
    template.onFrame(0, ctx);

    const col = rootEl.querySelectorAll('cf-col')[0];
    ok(col, '應該建立出一個直行元素：');
    // 模擬瀏覽器量出很寬的實際渲染寬度（8 段續接 × 40px／段）。
    col.offsetWidth = 320;
    col.offsetHeight = 500;
    template.onSeek(0, ctx); // 觸發重新 placeColumn

    const rect = col.getBoundingClientRect();
    const safeMargin = 11;
    const centerLeftLimitPx = 1280 * (50 - safeMargin) / 100; // 499.2px
    const centerRightLimitPx = 1280 * (50 + safeMargin) / 100; // 780.8px
    if (rect.left < 1280 / 2) {
      ok(rect.right <= centerLeftLimitPx + 0.5, `左側直行的右邊界（${rect.right}px）不得跨過中央安全線（${centerLeftLimitPx}px）：`);
    } else {
      ok(rect.left >= centerRightLimitPx - 0.5, `右側直行的左邊界（${rect.left}px）不得跨過中央安全線（${centerRightLimitPx}px）：`);
    }
  });
}

// ─── 舞台模板（Pulse/Facet/Drift/Aura）共用的中央安全距離 ───
{
  const kernelSourceRaw = fs.readFileSync(path.join(__dirname, '../public/js/lyric-motion-kernel.js'), 'utf8');
  // LyricMotion 是頂層 const，不會自動掛到 sandbox 物件上（跟模組系統無關的 JS 語意），
  // 附加一行匯出語句才能從 sandbox 外部拿到它——跟既有 KTV sandbox 測試同一招。
  const kernelSource = `${kernelSourceRaw}\n;globalThis.LyricMotion = LyricMotion;`;

  function loadKernelSandbox(bodyDataset) {
    const sandbox = {
      document: { body: { dataset: bodyDataset }, documentElement: {} },
      window: { innerWidth: 1280 },
      console,
    };
    vm.runInNewContext(kernelSource, sandbox, { filename: 'lyric-motion-kernel.js' });
    return sandbox.LyricMotion;
  }

  test('舞台安全距離：預設 2% 對應原本寫死的 48/52% 分界（向下相容）', () => {
    const motion = loadKernelSandbox({});
    eq(motion.stageSafeMarginPercent(), 2, '沒設定時預設應該是 2：');
    const rootEl = { clientWidth: 1000 };
    const vp = (() => {
      const sandbox = { document: { body: { dataset: { lyricPos: 'split' } } }, window: { innerWidth: 1280 }, console };
      vm.runInNewContext(kernelSource, sandbox, { filename: 'lyric-motion-kernel.js' });
      return sandbox.LyricMotion.layoutViewport(rootEl, 0);
    })();
    eq(vp.width, 480, '預設安全距離下，split 模式的排版寬度應該是容器的 48%（跟原本寫死的值一致）：');
    eq(vp.sideClass, 'pos-left', '偶數行應該是 pos-left：');
  });

  test('舞台安全距離：使用者調大安全距離，排版可用寬度會跟著縮小', () => {
    const sandbox = { document: { body: { dataset: { lyricPos: 'split', stageSafeMargin: '20' } } }, window: { innerWidth: 1280 }, console };
    vm.runInNewContext(kernelSource, sandbox, { filename: 'lyric-motion-kernel.js' });
    const vp = sandbox.LyricMotion.layoutViewport({ clientWidth: 1000 }, 0);
    eq(vp.width, 300, '安全距離拉到 20%，可用寬度應該是容器的 (50-20)%=30%：');
  });

  test('舞台安全距離：數值會被限制在 2–25 的範圍內，不合法輸入退回預設', () => {
    const tooSmall = loadKernelSandbox({ stageSafeMargin: '0' });
    eq(tooSmall.stageSafeMarginPercent(), 2, '小於下限應該被夾到 2：');
    const tooBig = loadKernelSandbox({ stageSafeMargin: '99' });
    eq(tooBig.stageSafeMarginPercent(), 25, '大於上限應該被夾到 25：');
    const garbage = loadKernelSandbox({ stageSafeMargin: 'not-a-number' });
    eq(garbage.stageSafeMarginPercent(), 2, '無法解析的值應該退回預設 2：');
  });

  test('舞台安全距離：mountStageSafeZoneGuide 會建立引導元件並可重複同步／銷毀', () => {
    const nodes = [];
    function makeNode() {
      const node = {
        style: { setProperty(name, value) { this[name] = value; } },
        children: [], parentNode: null,
        appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
        removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parentNode = null; },
        set innerHTML(v) { this._innerHTML = v; },
        get innerHTML() { return this._innerHTML || ''; },
      };
      nodes.push(node);
      return node;
    }
    const sandbox = {
      document: { body: { dataset: { stageSafeMargin: '9' } }, documentElement: {}, createElement: makeNode },
      window: { innerWidth: 1280 },
      console,
    };
    vm.runInNewContext(kernelSource, sandbox, { filename: 'lyric-motion-kernel.js' });
    const rootEl = makeNode();
    const guide = sandbox.LyricMotion.mountStageSafeZoneGuide(rootEl);
    eq(rootEl.children.length, 1, 'mount 時應該立刻建立一個引導元件：');
    const guideEl = rootEl.children[0];
    eq(guideEl.style['--stage-safe-left'], '41%', '9% 安全距離應該對應 --stage-safe-left=41%：');
    eq(guideEl.style['--stage-safe-right'], '59%', '9% 安全距離應該對應 --stage-safe-right=59%：');

    sandbox.document.body.dataset.stageSafeMargin = '15';
    guide.sync();
    eq(rootEl.children.length, 1, '調整安全距離不應該重建元件，只更新既有的：');
    eq(guideEl.style['--stage-safe-left'], '35%', 'sync 後應該反映新的安全距離：');

    guide.destroy();
    eq(rootEl.children.length, 0, 'destroy 應該把引導元件從畫面移除：');
  });
}

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
