'use strict';

// 2026-11-13 全面抓蟲稽核的回歸測試。每一個 test 對應 PR 說明裡的一個問題編號。
const test = require('node:test');
const assert = require('node:assert/strict');

function vm_get(context, name) { return require('vm').runInContext(name, context); }

function loadBrowserScript(file, extraGlobals = {}) {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const context = {
    SharedUtils: { escapeHtml: (value) => String(value) },
    window: { addEventListener() {} },
    document: { addEventListener() {}, getElementById: () => null, createElement: () => ({}) },
    localStorage: { getItem: () => null, setItem() {} },
    console: { log() {}, warn() {}, error() {} },
    URL,
    setTimeout,
    clearTimeout,
    ...extraGlobals,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', file), 'utf8'), context);
  return context;
}

function loadAuditModule(relative, overrides = {}) {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const { createRequire } = require('module');
  const filename = path.resolve(__dirname, '..', relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports,
    require: (id) => (Object.hasOwn(overrides, id) ? overrides[id] : realRequire(id)),
    __dirname: path.dirname(filename), __filename: filename,
    Buffer, URL, URLSearchParams, AbortController, console,
    setTimeout: (fn, ms) => setTimeout(fn, ms).unref(), clearTimeout,
    process: { env: process.env, platform: process.platform, cwd: () => process.cwd(), on() {} },
  }, { filename });
  return module.exports;
}

function auditImportFixture({ previous = null, lyricsResult } = {}) {
  const silent = new Proxy({}, { get: () => () => {} });
  const saved = [];
  const audio = loadAuditModule('server/services/audio-processor.js', {
    './lyrics-engine': {
      LyricsEngine: {
        resolveAppleMusicMetadata: async () => null,
        search: async () => lyricsResult,
        resolveOriginalArtist: async () => null,
      },
      DURATION_TOLERANCE: 5,
    },
    '../utils/logger': { createLogger: () => silent }, './ffmpeg-provider': {}, './import-temp-registry': {}, './ytdlp-updater': {},
    './library-store': {
      findByIdentity: () => null,
      getEntry: (id) => (previous && id === previous.id ? previous : null),
      rememberImport: (track) => saved.push(track),
    },
  });
  audio.downloadWithMetadata = () => ({
    metadata: Promise.resolve({ id: 'video123456', title: 'Artist - Song', duration: 120 }),
    completed: Promise.resolve({ filePath: '/tmp/video123456.m4a', outputDir: '/tmp' }),
    completeTempImport: () => {},
  });
  audio.resolveTrackIdentity = () => ({ artist: 'Artist', title: 'Song', confidence: 0.95 });
  audio.detectCover = () => false;
  audio.shouldResolveAppleMetadata = () => false;
  audio.measureLoudnessQueued = async () => -14;
  audio.renameToReadableFilename = () => 'Artist - Song.m4a';
  audio.requireDownloadedAudio = () => {};
  return { audio, saved };
}

test('#14 羅馬拼音：ぴゃ 不可拆成 pi+ya，外來語假名組合要轉成正確音節', () => {
  const { romanize } = require('../server/services/romanizer');
  const { romajiToXieyin } = require('../server/services/xieyin');
  assert.equal(romanize('ろっぴゃく'), 'roppyaku');
  assert.equal(romanize('ピャ'), 'pya');
  const cases = { ファ: 'fa', パーティー: 'pa-ti-', ヴァイオリン: 'vaiorin', シェア: 'shea', ディスコ: 'disuko', ウィンター: 'winta-', チェリー: 'cheri-' };
  for (const [kana, romaji] of Object.entries(cases)) assert.equal(romanize(kana), romaji, kana);
  // 諧音表本來就有這些音節，羅馬拼音對了才查得到
  assert.equal(romajiToXieyin('pa-ti-'), '趴提');
  assert.equal(romajiToXieyin('fa'), '法');
});

test('#15 日文拼音：助詞は／へ要唸 wa／e，純假名句子不可被亂切', async () => {
  const romanizer = require('../server/services/romanizer');
  const analysis = async (text) => (await romanizer.japaneseReadingAnalysis(text)).phonetic;
  assert.equal(await analysis('今日はいい天気ですね'), 'kyouwa ii tenkidesune');
  assert.equal(await analysis('君へ届け'), 'kimie todoke');
  assert.equal(await analysis('ありがとう'), 'arigatou');
  assert.equal(await analysis('ぼくはきみがすき'), 'bokuwa kimiga suki');
  assert.deepEqual((await romanizer.japaneseReadingAnalysis('ありがとう')).furigana, []);
  // 沒有分詞器時的降級路徑
  assert.equal(romanizer.japaneseToRomaji('ありがとう'), 'arigatou');
  assert.equal(romanizer.japaneseToRomaji('はなび'), 'hanabi');
  assert.equal(romanizer.japaneseToRomaji('君は'), 'kimi wa');
  assert.equal(romanizer.japaneseToRomaji('君へ'), 'kimi e');
});

test('#16 韓文拼音／諧音要依實際唸法（連音、鼻音化、ㅎ 脫落、顎化），逐字模式也一樣', () => {
  const { koreanPronunciation } = require('../server/utils/korean-pronunciation');
  const cases = {
    좋아: '조아', 감사합니다: '감사함니다', 한국어: '한구거', 같이: '가치', 빛나: '빈나', 축하해: '추카해',
    좋다: '조타', 많아: '마나', 싫어: '시러', 없어: '업써', 신라: '실라', 국물: '궁물', 있는: '인는',
    사랑해: '사랑해', 안녕하세요: '안녕하세요', 맛있어: '마시써', '보고 싶어': '보고 시퍼', 'I love 너를': 'I love 너를',
  };
  for (const [written, spoken] of Object.entries(cases)) assert.equal(koreanPronunciation(written), spoken, written);
  const romanizer = require('../server/services/romanizer');
  const { koreanToXieyin } = require('../server/services/xieyin');
  assert.equal(romanizer.romanize('감사합니다'), 'gamsahamnida');
  assert.equal(romanizer.romanize('좋아'), 'joa');
  assert.equal(romanizer.romanize('몰라'), 'molla');
  assert.equal(romanizer.koreanToRomaja('사랑'), 'sarang');
  assert.equal(koreanToXieyin('좋아'), '左阿');
  const [line] = romanizer.addRomanizationSync([{ time: 0, text: '한국어', words: [{ text: '한' }, { text: '국' }, { text: '어' }] }]);
  assert.deepEqual(line.words.map((word) => word.phonetic), ['han', 'gu', 'geo']);
  assert.equal(line.phonetic, 'hangugeo');
});

test('#18 撥音ん接母音／や行要寫成 n\'，諧音才不會把 こんや 唸成「摳妮呀」', async () => {
  const romanizer = require('../server/services/romanizer');
  const { romajiToXieyin } = require('../server/services/xieyin');
  assert.equal(romanizer.romanize('こんや'), "kon'ya");
  assert.equal(romanizer.romanize('レンアイ'), "ren'ai");
  assert.equal(romanizer.romanize('ほんとう'), 'hontou');
  assert.equal(romanizer.romanize('みんな'), 'minna');
  assert.equal(romajiToXieyin("kon'ya"), '摳恩呀');
  assert.equal(romajiToXieyin("ren'ai"), '勒恩阿伊');
  const analysis = await romanizer.japaneseReadingAnalysis('今夜');
  assert.equal(analysis.phonetic, "kon'ya");
  const { LyricsEngine } = require('../server/services/lyrics-engine');
  const base = { title: 'X', songTitle: 'Y', duration: 0, songDuration: 0, isCover: false };
  const withRomaji = LyricsEngine.scoreMatch({ ...base, artist: 'けんいち', songArtist: 'kenichi' });
  const unrelated = LyricsEngine.scoreMatch({ ...base, artist: 'けんいち', songArtist: 'someone' });
  assert.ok(withRomaji > unrelated, 'n\' 不可讓歌手羅馬字比對失效');
});

test('#38 日文：二人／一人要唸 futari／hitori（不是 ni nin）；っち（cchi）要轉得出諧音', async () => {
  const romanizer = require('../server/services/romanizer');
  const { romajiToXieyin } = require('../server/services/xieyin');
  const read = async (text) => (await romanizer.japaneseReadingAnalysis(text)).phonetic;
  assert.equal(await read('二人の未来'), 'futarino mirai');
  assert.equal(await read('一人一人'), 'hitori hitori');
  assert.equal(await read('二十歳'), 'hatachi');
  assert.equal(await read('十二人'), 'juu ni nin', '前面還有數字時是一般讀法');
  const furigana = (await romanizer.japaneseReadingAnalysis('二人')).furigana;
  assert.deepEqual(furigana, [{ text: '二人', reading: 'ふたり' }]);
  assert.notEqual(romajiToXieyin('hitoribocchi'), 'hitoribocchi');
  assert.equal(romajiToXieyin('bocchi'), romajiToXieyin('bochi'));
});

test('#39 繁體中文拼音：破音字要對（還是 hái、音樂 yuè、長大 zhǎng、睡覺 jiào），逐字歌詞也要有上下文', async () => {
  const romanizer = require('../server/services/romanizer');
  const lines = await romanizer.addRomanization([
    { time: 0, text: '還是覺得你最好', words: [] },
    { time: 1000, text: '長大以後', words: [] },
    { time: 2000, text: '睡覺前聽音樂', words: [] },
    { time: 3000, text: '快樂的音樂', words: [{ text: '快樂', start: 0, duration: 100 }, { text: '的', start: 100, duration: 100 }, { text: '音', start: 200, duration: 100 }, { text: '樂', start: 300, duration: 100 }] },
  ]);
  assert.equal(lines[0].phonetic, 'hái shì jué de nǐ zuì hǎo');
  assert.equal(lines[1].phonetic, 'zhǎng dà yǐ hòu');
  assert.equal(lines[2].phonetic, 'shuì jiào qián tīng yīn yuè');
  assert.deepEqual(lines[3].words.map((word) => word.phonetic), ['kuài lè', 'de', 'yīn', 'yuè']);
});

test('#46 日文拼音：て形的促音不可消失（待って matte、行って itte），こんにちは／では 的は唸 wa', async () => {
  const R = require('../server/services/romanizer');
  const texts = ['待って', '行ってきます', '雨が降っている', 'ホッとした', 'こんにちは世界', 'こんばんは', 'では、また', 'それでは', 'ありがとう', '今日はいい天気'];
  const out = await R.addRomanization(texts.map((text, i) => ({ time: i * 1000, text })));
  assert.deepEqual(out.map((l) => l.phonetic), [
    'matte', 'itte kimasu', 'amega futte iru', 'hotto shita', 'konnichiwa sekai', 'konbanwa', 'dewa mata', 'soredewa', 'arigatou', 'kyouwa ii tenki',
  ]);
  // 逐字歌詞的字塊切在促音後面：羅馬字補上下一拍的子音，諧音不多出子音
  const [krc] = await R.addRomanization([{ time: 0, text: '待って', words: [{ text: '待っ', start: 0, duration: 100 }, { text: 'て', start: 100, duration: 100 }] }]);
  assert.deepEqual(krc.words.map((w) => w.phonetic), ['mat', 'te']);
  assert.ok(!/[a-z]/i.test(krc.words[0].xieyin), `諧音不該殘留羅馬字：${krc.words[0].xieyin}`);
});

test('#96 中文拼音：「慢慢地／輕輕地／重重地」的地唸 de；「還給」huán、「有空」kòng', async () => {
  const romanizer = require('../server/services/romanizer');
  const lines = ['我慢慢地走', '輕輕地說', '重重地摔', '還給我', '你有空嗎', '地上', '大地', '睡不著', '你幹嘛'].map((text, i) => ({ time: i * 1000, text }));
  const out = await romanizer.addRomanization(lines);
  const got = out.map((l) => l.romanized || l.phonetic);
  assert.deepEqual(got, [
    'wǒ màn màn de zǒu', 'qīng qīng de shuō', 'zhòng zhòng de shuāi', 'huán gěi wǒ', 'nǐ yǒu kòng ma', 'dì shàng', 'dà dì',
    'shuì bù zháo', 'nǐ gàn má',
  ]);
});

test('移植 #51 時補的修正：小假名開頭的詞併回前一個詞、讀音會被合併的繁體字不轉簡體', async () => {
  const romanizer = require('../server/services/romanizer');
  const ja = await romanizer.addRomanization([{ time: 0, text: 'ひゅるひゅるりーらら' }, { time: 1, text: 'きみのこえ' }]);
  assert.match(ja[0].phonetic, /^hyuru/, 'ひゅ 不可拆成 hi + yu');
  const zh = await romanizer.addRomanization([{ time: 0, text: '該捨的捨不得' }, { time: 1, text: '剪了頭髮' }]);
  assert.match(zh[0].phonetic, /shě bù dé/, '捨 轉成簡體「舍」後會被讀成 shè');
  assert.match(zh[1].phonetic, /tóu fà/, '髮 轉成簡體「发」後會被讀成 fā');
});
