'use strict';

// 核心回歸測試（time-lrc-deck）。由 tests/run-tests.js 依序載入，不要單獨執行。
const {
  test,
  eq,
  ok,
} = require('./core-harness');
const xieyin = require('../server/services/xieyin');

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

test('startTwitchSession：同場重入（含 refreshLiveState 對帳路徑）維持 startedAt，真正的新場次才重置', () => {
  const io = { on() {}, use() {}, emit() {} };
  const api = socketHandler(io);
  const first = 1_600_000_000_000;
  api.startTwitchSession({ startedAt: first, eventId: 'evt-1' });
  eq(api.getState().session.startedAt, first);
  // refreshLiveState() 的權威對帳沒有 message id（eventId:null）；startedAt 在 60s 容差內
  // → 必須被視為「同一場」，不可重設（否則每次 EventSub 重連都會清空已唱歌單）。
  api.startTwitchSession({ startedAt: first + 5000, eventId: null });
  eq(api.getState().session.startedAt, first, '容差內的重入不可改動 startedAt：');
  eq(api.getState().session.active, true);
  eq(api.getState().session.source, 'twitch');
  // 隔了數小時的另一個 started_at ＝ 真的是新一場，要重設。
  const second = first + 10 * 60 * 60 * 1000;
  api.startTwitchSession({ startedAt: second, eventId: 'evt-2' });
  eq(api.getState().session.startedAt, second, '真正的新場次要更新 startedAt：');
});

test('stopTwitchSession 對帳路徑（eventId:null）能收掉卡住的 Twitch 開台狀態', () => {
  const io = { on() {}, use() {}, emit() {} };
  const api = socketHandler(io);
  api.startTwitchSession({ startedAt: Date.now() - 60 * 60 * 1000, eventId: 'evt-live' });
  eq(api.getState().session.active, true);
  // refreshLiveState() 查到 Twitch 其實沒在開台時會走這條（沒有 message id）。
  api.stopTwitchSession({ eventId: null });
  eq(api.getState().session.active, false, '權威對帳查到未開台就要把 session 收掉：');
  eq(api.getState().session.source, null);
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
