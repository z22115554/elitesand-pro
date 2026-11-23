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

test('#4 歌詞搜尋字串清理不可把歌名裡的 ft／feat／with 當成客串標記砍掉', () => {
  const { cleanQuery } = require('../server/services/ttml-parser');
  assert.equal(cleanQuery('Left Behind'), 'Left Behind');
  assert.equal(cleanQuery('Lift Me Up'), 'Lift Me Up');
  assert.equal(cleanQuery('Daft Punk'), 'Daft Punk');
  assert.equal(cleanQuery('Defeat the Night'), 'Defeat the Night');
  assert.equal(cleanQuery('Stay With Me'), 'Stay With Me');
  assert.equal(cleanQuery('With or Without You'), 'With or Without You');
  // 真正的客串寫法仍要移除
  assert.equal(cleanQuery('Song (feat. Someone)'), 'Song');
  assert.equal(cleanQuery('Song feat. Someone'), 'Song');
  assert.equal(cleanQuery('Song ft. Someone'), 'Song');
  assert.equal(cleanQuery('Song FEATURING Someone'), 'Song');
  assert.equal(cleanQuery('Song (with Someone)'), 'Song');
  assert.equal(cleanQuery('Cry for Me (Official Video)'), 'Cry for Me');
});

test('#5 製作資訊過濾：英文關鍵字要有詞邊界，首尾正文不可被誤砍', () => {
  const { cleanLyrics, isCreditLine } = require('../server/services/lyrics-cleaner');
  for (const text of ['Stop: dont you go', 'Hope: is all I have', 'Oops: I did it again', 'Spring: the season', 'Desperado: why dont you']) {
    assert.equal(isCreditLine({ text }), false, text);
  }
  for (const text of ['Producer: X', 'Guitarist: Y', 'Drummer: Z', 'Mixing Engineer: C', 'Mastered by: D', 'OP: J', 'SP: K', 'ISRC: CN-123', 'A&R: L', '混音/母带：W', '錄音師 Recording Engineer：Z']) {
    assert.equal(isCreditLine({ text }), true, text);
  }
  const lines = ['Hope: is all I have', 'line two', 'line three'].map((text, index) => ({ time: 5000 + index * 3000, text }));
  assert.deepEqual(cleanLyrics(lines).map((line) => line.text), ['Hope: is all I have', 'line two', 'line three']);
});

test('#13 SRT／WebVTT 歌詞：格式不可在存檔時被洗掉，也不可被當成沒有時間軸的純文字', () => {
  const { sanitizeTrack, sanitizeManualLyrics } = require('../server/utils/track-schema');
  assert.equal(sanitizeTrack({ id: 'a', title: 'A', lyrics: 'WEBVTT', lyricsType: 'vtt' }).lyricsType, 'vtt');
  assert.equal(sanitizeManualLyrics({ lyrics: 'WEBVTT\n\n00:01.000 --> 00:02.000\nHi', lyricsType: 'vtt' }).lyricsType, 'vtt');
  const { LyricsEngine } = require('../server/services/lyrics-engine');
  const vtt = 'WEBVTT\n\n00:01.000 --> 00:03.000\nOne\n\n00:04.000 --> 00:06.000\nTwo';
  assert.deepEqual(LyricsEngine.parseByType(vtt, 'vtt').map((line) => [line.time, line.text]), [[1000, 'One'], [4000, 'Two']]);
  const srt = '1\n00:00:01,000 --> 00:00:03,000\nOne\n\n2\n00:00:04,000 --> 00:00:06,000\nTwo';
  assert.equal(LyricsEngine.parseByType(srt, 'srt').length, 2);
  assert.equal(LyricsEngine.parseByType('[00:01.00]x\n[00:02.00]y', 'lrc').length, 2);
  // 面板上的準備度：srt／vtt 是逐句同步，不是純文字
  // live-prep／app-playlist 綁 DOM，這裡只確認原始碼的判斷規則
  const fs = require('fs');
  const path = require('path');
  for (const file of ['live-prep.js', 'app-playlist.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', file), 'utf8');
    assert.ok(source.includes("['lrc', 'srt', 'vtt'].includes(track.lyricsType)"), file);
  }
});

test('#28 上傳／貼上的雙語 LRC：翻譯行要併進同一句，不可變成同一秒兩行', () => {
  const apiRouter = require('../server/routes/api');
  const flatten = (stack) => stack.flatMap((layer) => (layer.route ? [layer] : (layer.handle && layer.handle.stack ? flatten(layer.handle.stack) : [])));
  const layer = flatten(apiRouter.stack).find((l) => l.route && l.route.path === '/lyrics/paste' && l.route.methods.post);
  assert.ok(layer, 'POST /lyrics/paste');
  const handler = layer.route.stack.at(-1).handle;
  const content = [
    '[00:05.00]沈むように溶けてゆくように',
    '[00:05.00]像是沉沒一般 像是溶化一般',
    '[00:10.00]Rock &amp; Roll',
  ].join('\n');
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  handler({ body: { content } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.parsedLyrics.length, 2);
  assert.equal(res.payload.parsedLyrics[0].text, '沈むように溶けてゆくように');
  assert.equal(res.payload.parsedLyrics[0].translation, '像是沉沒一般 像是溶化一般');
  assert.equal(res.payload.parsedLyrics[1].text, 'Rock & Roll');
  assert.equal(res.payload.lineCount, 2);
});

test('#29 合唱 LRC：「男：」獨占一行、下一行歌詞同一時間，不可被當成原文＋翻譯併掉', () => {
  const { LyricsEngine } = require('../server/services/lyrics-engine');
  const lrc = [
    '[00:05.00]男：', '[00:05.00]我們的愛', '[00:10.00]過了就不再回來',
    '[00:15.00]女：', '[00:15.00]直到現在', '[00:20.00]合：一起唱',
  ].join('\n');
  const lines = LyricsEngine.parseLrc(lrc).map((line) => [line.time, line.text, line.translation || '', line.singer || '']);
  assert.deepEqual(lines, [
    [5000, '我們的愛', '', 'a'], [10000, '過了就不再回來', '', 'a'], [15000, '直到現在', '', 'b'], [20000, '一起唱', '', 'both'],
  ]);
  // 一般雙語 LRC 照常併成翻譯
  const bilingual = LyricsEngine.parseLrc('[00:05.00]沈むように\n[00:05.00]像是沉沒一般\n[00:09.00]溶けてゆくように\n[00:09.00]像是溶化一般');
  assert.equal(bilingual.length, 2);
  assert.equal(bilingual[0].translation, '像是沉沒一般');
});

test('#31 增強 LRC 的逐字時間 <mm:ss.xx> 不可原樣出現在歌詞文字裡', () => {
  const { LyricsEngine } = require('../server/services/lyrics-engine');
  const lines = LyricsEngine.parseByType('[00:01.00]<00:01.00>Hel<00:01.50>lo <00:02.00>there\n[00:03.00] <00:03.00> World <00:04.00>\n[00:05.00]a\n[00:06.00]b', 'lrc');
  assert.deepEqual(lines.map((line) => line.text), ['Hello there', 'World', 'a', 'b']);
  const fs = require('fs');
  const path = require('path');
  const karaoke = fs.readFileSync(path.join(__dirname, '../public/js/karaoke.js'), 'utf8');
  assert.ok(karaoke.includes(".replace(/<\\d{1,3}:\\d{2}(?:[.:]\\d{1,3})?>/g, '')"), '顯示端備援解析也要拿掉');
  // [offset:+500] 兩個解析入口要一致
  const { parseOffset, parseLrc } = require('../server/services/lrc-parser');
  assert.equal(parseOffset('[offset:+500]\n[00:01.00]a'), 500);
  assert.equal(parseOffset('[offset: -300 ]'), parseLrc('[offset: -300 ]\n[00:01.00]a').offset);
});

test('#42 歌詞搜尋字串：整個名字包在括號裡（[Alexandros]、「夜に駆ける」）或名字自帶括號（f(x)、(G)I-DLE）不可被剝光', () => {
  const { cleanQuery } = require('../server/services/ttml-parser');
  assert.equal(cleanQuery('[Alexandros]'), 'Alexandros');
  assert.equal(cleanQuery('「夜に駆ける」'), '夜に駆ける');
  assert.equal(cleanQuery('『ドラえもん』'), 'ドラえもん');
  assert.equal(cleanQuery('f(x)'), 'f(x)');
  assert.equal(cleanQuery('(G)I-DLE'), '(G)I-DLE');
  assert.equal(cleanQuery('(K)NoW_NAME'), '(K)NoW_NAME');
  // 一般附註照剝
  assert.equal(cleanQuery('天空之城(Live)'), '天空之城');
  assert.equal(cleanQuery('Song(MV)'), 'Song');
  assert.equal(cleanQuery('Song [Live]'), 'Song');
  assert.equal(cleanQuery('【MV】晴る'), '晴る');
  assert.equal(cleanQuery('Song (A)'), 'Song');
});

test('#49 雙語 LRC：同一句重貼兩次不當翻譯；「原文／羅馬拼音／翻譯」三行同一時間不可擠掉原文', () => {
  const { LyricsEngine } = require('../server/services/lyrics-engine');
  const lines = LyricsEngine.parseLrc([
    '[00:01.00]君の名は', '[00:01.00]你的名字',
    '[00:12.00]I love you', '[00:12.00]I love you',
    '[00:15.00]ずっと', '[00:15.00]zutto', '[00:15.00]一直',
    '[00:18.00]夢', '[00:18.00]梦', '[00:18.00]梦',
  ].join('\n'));
  assert.deepEqual(lines.map((l) => [l.time, l.text, l.translation || '']), [
    [1000, '君の名は', '你的名字'],
    [12000, 'I love you', ''],
    [15000, 'ずっと', '一直'],
    [18000, '夢', '梦'],
  ]);
  // 其他第三行維持原本行為（保留成獨立一行，見 word-lyrics-fallback.test.js）
  const folded = LyricsEngine.foldTranslationLines([{ time: 0, text: 'a' }, { time: 0, text: 'b' }, { time: 0, text: 'c' }]);
  assert.deepEqual(folded.map((l) => l.text), ['a', 'c']);
});

test('#53 歌詞查詢候選：原文結尾帶問號的中英並列歌名（你，好不好？ How Have You Been?）也要拆出原文去查', () => {
  const { lyricTitleVariants, lyricQueryVariants } = require('../server/services/lyric-query-variants');
  assert.deepEqual(lyricTitleVariants('你,好不好? How Have You Been?'), ['你,好不好? How Have You Been?', '你,好不好?']);
  assert.deepEqual(lyricTitleVariants('Hello! 你好'), ['Hello! 你好', '你好']);
  assert.deepEqual(lyricTitleVariants('告白氣球 Love Confession'), ['告白氣球 Love Confession', '告白氣球']);
  assert.ok(lyricQueryVariants('Eric周興哲', '你,好不好? How Have You Been?').some((v) => v.artist === '周興哲' && v.title === '你,好不好?'));
});

test('#59 歌詞搜尋字串：巢狀括號（(여자)아이들((G)I-DLE)、Song (feat. A (B))）不可剝成半截', () => {
  const { cleanQuery } = require('../server/services/ttml-parser');
  assert.equal(cleanQuery('(여자)아이들((G)I-DLE)'), '아이들((G)I-DLE)');
  assert.equal(cleanQuery('Song (feat. A (B))'), 'Song');
  assert.equal(cleanQuery('f(x)'), 'f(x)');
  assert.equal(cleanQuery('IVE(아이브)'), 'IVE');
});

test('#67 網易雲 cloudsearch 結果（歌手欄位 ar）要算歌手分數；同名的 DJ 版／Live 版在時長差不多時不可勝過原版', () => {
  const { LyricsEngine } = require('../server/services/lyrics-engine');
  // cloudsearch 的格式：ar／dt。翻唱者時長剛好比較近，原版要靠歌手分數勝出
  const cover = { name: '晴天', ar: [{ name: '某翻唱' }], dt: 269000 };
  const original = { name: '晴天', ar: [{ name: '周杰伦' }], dt: 266000 };
  assert.equal(LyricsEngine.findBestMatch([cover, original], '周杰倫', '晴天', 269, false), original);
  // 同歌手的 DJ 版排在前面、時長也差不多：不可因為平手就選到 DJ 版
  const dj = { name: '晴天 (DJ版)', ar: [{ name: '周杰伦' }], dt: 268000 };
  const studio = { name: '晴天', ar: [{ name: '周杰伦' }], dt: 270000 };
  assert.equal(LyricsEngine.findBestMatch([dj, studio], '周杰倫', '晴天', 269, false), studio);
  // 影片本身就是 Live 版時不扣分
  const live = { name: '晴天 (Live)', artists: [{ name: '周杰伦' }], duration: 300000 };
  const studio2 = { name: '晴天', artists: [{ name: '周杰伦' }], duration: 300000 };
  assert.equal(LyricsEngine.findBestMatch([live, studio2], '周杰倫', '晴天 (Live)', 300, false), live);
});

test('#68 酷狗搜尋：同歌手的 DJ 版排在前面、時長也在容差內時，要選原版的 hash', async () => {
  const silent = new Proxy({}, { get: () => () => {} });
  const requested = [];
  const lrc = Buffer.from('[00:01.00]故事的小黃花\n[00:03.00]從出生那年就飄著\n[00:05.00]童年的盪鞦韆\n[00:07.00]隨記憶一直晃到現在').toString('base64');
  const fetch = async (url) => {
    requested.push(url);
    const json = (body) => ({ ok: true, json: async () => body });
    if (url.includes('mobileservice.kugou.com')) {
      return json({ data: { info: [
        { songname: '晴天 (DJ版)', singername: '周杰伦', duration: 268, hash: 'DJHASH' },
        { songname: '晴天', singername: '周杰伦', duration: 269, hash: 'STUDIOHASH' },
      ] } });
    }
    if (url.includes('krcs.kugou.com')) return json({ candidates: [{ id: '1', accesskey: 'k', duration: 269000 }] });
    if (url.includes('lyrics.kugou.com/download')) return json({ content: 'not-krc', lrccontent: lrc });
    return { ok: false, json: async () => ({}) };
  };
  const { LyricsEngine } = loadAuditModule('server/services/lyrics-engine.js', {
    '../utils/helpers': { ...require('../server/utils/helpers'), fetchWithTimeout: fetch },
    '../utils/logger': { createLogger: () => silent },
    './json-store': { createJsonStore: () => ({ load: () => [], save() {} }) },
  });
  const result = await LyricsEngine.searchKugou('周杰倫', '晴天', 269);
  assert.ok(result && result.source === 'kugou');
  const krcs = requested.find((url) => url.includes('krcs.kugou.com'));
  assert.ok(krcs.includes('hash=STUDIOHASH'), krcs);
});

test('#69 LRCLIB：只用歌名查回來的同名別首歌不可被直接拿來用；同一首的多筆結果依分數挑', async () => {
  const silent = new Proxy({}, { get: () => () => {} });
  const responses = (url) => {
    if (url.includes('q=Lemon') && !url.includes('artist')) {
      return [
        { trackName: 'Lemon', artistName: 'Someone Else', duration: 180, syncedLyrics: '[00:01.00]wrong song' },
        { trackName: 'Lemon', artistName: '米津玄師', duration: 256, syncedLyrics: '[00:01.00]夢ならばどれほどよかったでしょう' },
      ];
    }
    return [{ trackName: 'Lemon', artistName: 'Someone Else', duration: 180, syncedLyrics: '[00:01.00]wrong song' }];
  };
  const fetch = async (url) => ({ ok: true, json: async () => responses(url) });
  const { LyricsEngine } = loadAuditModule('server/services/lyrics-engine.js', {
    '../utils/helpers': { ...require('../server/utils/helpers'), fetchWithTimeout: fetch },
    '../utils/logger': { createLogger: () => silent },
    './json-store': { createJsonStore: () => ({ load: () => [], save() {} }) },
  });
  const result = await LyricsEngine.searchLrclib('米津玄師', 'Lemon', 256);
  assert.ok(result, '要找到米津玄師的 Lemon');
  assert.match(result.lyrics, /夢ならば/);
  // 只有別的歌手的同名歌：寧可回 null 讓後面的來源接手
  const onlyWrong = loadAuditModule('server/services/lyrics-engine.js', {
    '../utils/helpers': { ...require('../server/utils/helpers'), fetchWithTimeout: async () => ({ ok: true, json: async () => [{ trackName: 'Lemon', artistName: 'Someone Else', duration: 180, syncedLyrics: '[00:01.00]wrong song' }] }) },
    '../utils/logger': { createLogger: () => silent },
    './json-store': { createJsonStore: () => ({ load: () => [], save() {} }) },
  });
  assert.equal(await onlyWrong.LyricsEngine.searchLrclib('米津玄師', 'Lemon', 256), null);
});

test('#70 Apple Music（paxsenix）搜尋：搜不到時回來的不相干熱門歌不可被選中', () => {
  const { LyricsEngine } = require('../server/services/lyrics-engine');
  const searchData = (songs) => ({
    results: { songs: { data: songs.map((s) => ({ id: s.id })) } },
    resources: { songs: Object.fromEntries(songs.map((s) => [s.id, { attributes: { name: s.name, artistName: s.artist, durationInMillis: s.ms } }])) },
  });
  const unrelated = searchData([{ id: '1', name: 'Shape of You', artist: 'Ed Sheeran', ms: 233000 }, { id: '2', name: 'Blinding Lights', artist: 'The Weeknd', ms: 200000 }]);
  assert.equal(LyricsEngine.findAppleMusicMatch(unrelated, '某某', '冷門的歌', 240), null);
  const real = searchData([{ id: '1', name: 'Shape of You', artist: 'Ed Sheeran', ms: 233000 }, { id: '9', name: '晴天', artist: '周杰倫', ms: 269000 }]);
  assert.equal(LyricsEngine.findAppleMusicMatch(real, '周杰倫', '晴天', 269)?.id, '9');
});

test('#75 SRT 歌詞：字幕軟體的 {\\an8} 定位碼要拿掉、&amp; 要解碼', () => {
  const { LyricsEngine } = require('../server/services/lyrics-engine');
  const srt = '1\r\n00:00:01,000 --> 00:00:03,000\r\n<i>Hello</i> {\\an8}world\r\n\r\n2\r\n00:00:04,500 --> 00:00:06,000\r\n晴天\r\n&amp; more\r\n';
  assert.deepEqual(LyricsEngine.parseByType(srt, 'srt').map((l) => l.text), ['Hello world', '晴天 & more']);
});

test('#76 貼上純文字歌詞：Genius 式的段落標題（[Verse 1]、[Chorus: X]、[副歌]）不可變成一句歌詞', () => {
  const { autoParseLyrics } = require('../server/services/lrc-parser');
  const r = autoParseLyrics('[Verse 1]\nI love you\n[Chorus: Someone]\nla la la\n[副歌]\n晴天\n[Mike] hello\n');
  assert.equal(r.type, 'txt');
  assert.deepEqual(r.lines.map((l) => [l.time, l.text]), [[0, 'I love you'], [5000, 'la la la'], [10000, '晴天'], [15000, '[Mike] hello']]);
});

test('#77 LRC 的空時間行（間奏前標出上一句結束）要變成上一句的 duration，不可直接丟掉讓上一句掛滿整段間奏', () => {
  const { LyricsEngine } = require('../server/services/lyrics-engine');
  const l = LyricsEngine.parseLrc('[00:01.00]one\n[00:03.00]two\n[00:05.00]\n[00:35.00]three\n[00:37.00]four\n[00:40.00]');
  assert.deepEqual(l.map((x) => [x.text, x.duration || 0]), [['one', 0], ['two', 2000], ['three', 0], ['four', 3000]]);
  const bilingual = LyricsEngine.parseLrc('[00:01.00]こんにちは\n[00:01.00]你好\n[00:03.00]\n[00:10.00]x');
  assert.equal(bilingual[0].translation, '你好');
  assert.equal(bilingual[0].duration, 2000);
});

test('#78 逐句歌詞的偽逐字時間：有 duration 時攤在這一句的長度內，不是攤到下一句（間奏）', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../public/js/lyric-motion-kernel.js'), 'utf8');
  assert.match(src, /const lineEndMs = Number\(line\.duration\) > 0 \? line\.time \+ Number\(line\.duration\)/);
});

test('#79 網易雲／QQ 譯文合併：[00:01.00] 對 [00:01.000] 也要對得上；「//」佔位不可變成譯文；空行不帶譯文', () => {
  const { LyricsEngine } = require('../server/services/lyrics-engine');
  const merged = LyricsEngine.mergeBilingualLrc(
    '[00:01.00]こんにちは\n[00:03.00]さようなら\n[00:05.00]ありがとう\n[00:07.00]',
    '[00:01.000]你好\n[00:03.000]再見\n[00:05.000]//\n[00:07.000]空',
  );
  const lines = LyricsEngine.parseLrc(merged);
  assert.deepEqual(lines.map((l) => [l.text, l.translation || '']), [['こんにちは', '你好'], ['さようなら', '再見'], ['ありがとう', '']]);
});

test('#81 網易雲逐字歌詞（YRC）要接上同一個回應裡的中文翻譯（跟 QQ 逐字一樣）', async () => {
  const silent = new Proxy({}, { get: () => () => {} });
  const fetch = async () => ({ ok: true, json: async () => ({
    yrc: { lyric: '{"t":0,"c":[{"tx":"作词: x"}]}\n[1000,2000](1000,1000,0)こん(2000,1000,0)にちは\n[4000,1500](4000,1500,0)さよなら' },
    tlyric: { lyric: '[00:01.000]你好\n[00:04.000]再見' },
  }) });
  const { LyricsEngine } = loadAuditModule('server/services/lyrics-engine.js', {
    '../utils/helpers': { ...require('../server/utils/helpers'), fetchWithTimeout: fetch },
    '../utils/logger': { createLogger: () => silent },
    './json-store': { createJsonStore: () => ({ load: () => [], save() {} }) },
  });
  const krc = await LyricsEngine.fetchNeteaseYrc(123);
  const lines = LyricsEngine.parseKrc(krc);
  assert.deepEqual(lines.map((l) => [l.text, l.translation || '']), [['こんにちは', '你好'], ['さよなら', '再見']]);
});

test('#82 酷狗逐字歌詞（KRC）要讀 [language:] 裡的翻譯', () => {
  const zlib = require('zlib');
  const { krcDecode } = require('../server/services/krc-decoder');
  const { LyricsEngine } = require('../server/services/lyrics-engine');
  const lang = Buffer.from(JSON.stringify({ content: [{ language: 0, type: 1, lyricContent: [['你好'], ['//'], ['再見']] }], version: 1 })).toString('base64');
  const raw = `[ti:x]\n[language:${lang}]\n[1000,2000]<0,1000,0>こん<1000,1000,0>にちは\n[3500,500]<0,500,0>ah\n[4000,1500]<0,1500,0>さよなら\n`;
  const KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
  const compressed = zlib.deflateSync(Buffer.from(raw));
  const encrypted = Buffer.from(compressed.map((byte, i) => byte ^ KEY[i % KEY.length]));
  const krc = krcDecode(Buffer.concat([Buffer.from('krc1'), encrypted]));
  const lines = LyricsEngine.parseKrc(krc);
  assert.deepEqual(lines.map((l) => [l.text, l.translation || '']), [['こんにちは', '你好'], ['ah', ''], ['さよなら', '再見']]);
});

test('#83 TTML（BetterLyrics／Apple／網易 AMLL）的翻譯：行內 x-translation span 與 <head> 的 translations 都要接上', () => {
  const { parseTTML } = require('../server/services/ttml-parser');
  const { LyricsEngine } = require('../server/services/lyrics-engine');
  const inline = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div>'
    + '<p begin="00:01.000" end="00:03.000"><span begin="00:01.000" end="00:02.000">こん</span><span begin="00:02.000" end="00:03.000">にちは</span><span ttm:role="x-translation" xml:lang="zh-CN">你好</span></p>'
    + '<p begin="00:04.000" end="00:05.000"><span begin="00:04.000" end="00:05.000">さよなら</span></p></div></body></tt>';
  assert.deepEqual(LyricsEngine.parseKrc(parseTTML(inline)).map((l) => [l.text, l.translation || '']),
    [['こんにちは', '你好'], ['さよなら', '']]);
  const head = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><head><metadata><iTunesMetadata><translations>'
    + '<translation type="subtitle" xml:lang="en"><text for="L1">Hello</text></translation>'
    + '<translation type="subtitle" xml:lang="zh-Hant"><text for="L1">你好 &amp; 嗨</text><text for="L2">さよなら</text></translation>'
    + '</translations></iTunesMetadata></metadata></head><body><div>'
    + '<p begin="1.0" end="3.0" itunes:key="L1"><span begin="1.0" end="3.0">こんにちは</span></p>'
    + '<p begin="4.0" end="5.0" itunes:key="L2"><span begin="4.0" end="5.0">さよなら</span></p></div></body></tt>';
  // 優先繁中；譯文跟原文一樣的不收
  assert.deepEqual(LyricsEngine.parseKrc(parseTTML(head)).map((l) => [l.text, l.translation || '']),
    [['こんにちは', '你好 & 嗨'], ['さよなら', '']]);
});

test('#86 Paxsenix 的 elrc（增強 LRC）要轉成逐字 KRC，不能當一般 LRC 把逐字時間丟掉', () => {
  const { LyricsEngine } = require('../server/services/lyrics-engine');
  assert.equal(typeof LyricsEngine.enhancedLrcToKrc, 'function');
  const krc = LyricsEngine.enhancedLrcToKrc('[ti:x]\n[00:01.00]<00:01.00>Hel<00:01.50>lo <00:02.00>world<00:03.00>\n[00:04.00]<00:04.00>こん<00:04.50>にちは\n[00:06.00]\n[00:07.00]v1: <00:07.00>Bye');
  const lines = LyricsEngine.parseKrc(krc);
  assert.deepEqual(lines.map((l) => [l.time, l.text, l.words.map((w) => `${w.text}@${w.start}+${w.duration}`)]), [
    [1000, 'Hello world', ['Hel@0+500', 'lo @500+500', 'world@1000+1000']],
    [4000, 'こんにちは', ['こん@0+500', 'にちは@500+1500']],
    [7000, 'Bye', ['Bye@0+500']],
  ]);
  // 沒有逐字時間的一般 LRC 不轉
  assert.equal(LyricsEngine.enhancedLrcToKrc('[00:01.00]plain\n[00:02.00]lines'), null);
});

test('#86b elrc 轉不成逐字（每句只有一個時間標記）退回一般 LRC 時，時間標記和多人版的 v1:／v2: 都不能顯示出來', () => {
  const { LyricsEngine } = require('../server/services/lyrics-engine');
  const elrc = '[00:01.00]v1: <00:01.00>Hello\n[00:03.00]v2:<00:03.00>World\n[00:05.00]V12: <00:05.00>Again\n[00:08.00]<00:08.00>Plain v1: stays';
  assert.equal(LyricsEngine.enhancedLrcToKrc(elrc), null, '這份沒有逐字時間，應該走退回 LRC 的路');
  const cleaned = LyricsEngine.stripElrcVoiceTags(elrc);
  assert.deepEqual(LyricsEngine.parseLrc(cleaned).map((l) => [l.time, l.text]), [
    [1000, 'Hello'], [3000, 'World'], [5000, 'Again'], [8000, 'Plain v1: stays'],
  ], '行首的聲部標記要拿掉，句子中間的字不能動');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server', 'services', 'lyrics-engine.js'), 'utf8');
  assert.match(src, /return \{ lyrics: this\.stripElrcVoiceTags\(elrc\), type: 'lrc', source: 'paxsenix'/, 'paxsenix 退回 LRC 時要先清掉聲部標記');
});

test('#87 歌詞裡的對白「我說：」「你說：」不是合唱聲部，不能被剝掉', () => {
  const { annotateSingerParts } = require('../server/services/singer-parts');
  const lines = ['我說：別走', '你說：再見', '他說：沒關係', '我們都哭了', '最後一句', '還有一句'].map((text, i) => ({ time: i * 1000, text }));
  const out = annotateSingerParts(lines);
  assert.deepEqual(out.map((l) => l.text), lines.map((l) => l.text));
  assert.ok(out.every((l) => !l.singer));
  const duet = ['男：一', '女：二', '合：三', '男：四', '女：五'].map((text, i) => ({ time: i, text }));
  assert.deepEqual(annotateSingerParts(duet).map((l) => [l.text, l.singer]), [['一', 'a'], ['二', 'b'], ['三', 'both'], ['四', 'a'], ['五', 'b']]);
});

test('#94 某來源只有純文字歌詞時要繼續找有時間軸的；最後才用純文字，而且要解析出行', async () => {
  const silent = new Proxy({}, { get: () => () => {} });
  const load = () => loadAuditModule('server/services/lyrics-engine.js', {
    '../utils/logger': { createLogger: () => silent },
    './json-store': { createJsonStore: () => ({ load: () => [], save() {}, remove() {} }) },
  }).LyricsEngine;
  const miss = async () => null;
  const stub = (E, overrides) => {
    for (const name of ['searchBetterLyrics', 'searchPaxsenix', 'searchKugou', 'searchQQMusic', 'searchLrclib', 'searchNetease']) E[name] = miss;
    Object.assign(E, overrides);
  };
  let E = load();
  stub(E, {
    searchLrclib: async () => ({ lyrics: '純文字一\n純文字二', type: 'txt', source: 'lrclib' }),
    searchNetease: async (a, t, d, opts) => (opts && opts.wordOnly ? null : { lyrics: '[00:01.00]有時間一\n[00:03.00]有時間二', type: 'lrc', source: 'netease' }),
  });
  const synced = await E.search('歌手甲', '純文字測試歌A', 200, false);
  assert.equal(synced.source, 'netease');
  assert.equal(synced.parsedLyrics.length, 2);

  E = load();
  stub(E, { searchLrclib: async () => ({ lyrics: '純文字一\n純文字二', type: 'txt', source: 'lrclib' }) });
  const plain = await E.search('歌手乙', '純文字測試歌B', 200, false);
  assert.equal(plain.type, 'txt');
  assert.equal(plain.parsedLyrics.length, 2, '純文字要解析成行，不是 0 行');
});

test('#97 歌詞查詢變體：混寫名字「Official髭男dism」、「Love你」不能被拆成原文＋英文', () => {
  const { lyricQueryVariants } = require('../server/services/lyric-query-variants');
  const titles = (a, t) => lyricQueryVariants(a, t).map((v) => [v.artist, v.title]);
  assert.deepEqual(titles('Official髭男dism', 'Pretender'), [['Official髭男dism', 'Pretender']]);
  assert.deepEqual(titles('', 'Love你'), [['', 'Love你']]);
  assert.deepEqual(titles('', 'Baby不要再哭泣'), [['', 'Baby不要再哭泣']]);
  // 真的並列照舊拆
  assert.deepEqual(titles('周杰倫 Jay Chou', '晴天 Sunny Day'), [['周杰倫 Jay Chou', '晴天 Sunny Day'], ['周杰倫', '晴天']]);
  assert.deepEqual(titles('陳奕迅Eason', '十年'), [['陳奕迅Eason', '十年'], ['陳奕迅', '十年']]);
});

test('#101 逐字歌詞的譯文時間跟行起點差幾百毫秒（網易雲 tlyric）也要接上；製作資訊不算譯文', () => {
  const { LyricsEngine } = require('../server/services/lyrics-engine');
  const krc = '[00:01.23]<2000>こん<0,1000>にちは<1000,1000>\n[00:04.56]<1000>さよなら<0,1000>\n[00:06.00]<1000>また<0,1000>';
  const lines = LyricsEngine.parseKrc(LyricsEngine.appendTranslationLines(krc, '[00:01.00]作詞：x\n[00:01.40]你好\n[00:04.30]再見\n[00:09.00]多餘'));
  assert.deepEqual(lines.map((l) => [l.text, l.translation || '']), [['こんにちは', '你好'], ['さよなら', '再見'], ['また', '']]);
});
