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

test('#6 YouTube 標題噪音規則不可咬到歌名／歌手裡的英文單字片段', () => {
  const AudioProcessor = require('../server/services/audio-processor');
  const cases = [
    ['Arctic Monkeys - Do I Wanna Know? (Official Video)', 'Arctic Monkeys', 'Do I Wanna Know?'],
    ['Bonnie Tyler - Total Eclipse of the Heart (Official Video)', 'Bonnie Tyler', 'Total Eclipse of the Heart'],
    ['Taylor Swift - Mastermind (Official Lyric Video)', 'Taylor Swift', 'Mastermind'],
    ['Metallica - Master of Puppets', 'Metallica', 'Master of Puppets'],
    ['Sam Smith - Accept Me', 'Sam Smith', 'Accept Me'],
    ['Kesha - Whiskey Lullaby', 'Kesha', 'Whiskey Lullaby'],
    ['Alicia Keys - No One', 'Alicia Keys', 'No One'],
    // 原本就要清掉的噪音仍要清掉
    ['Queen - Bohemian Rhapsody (Remastered 2011)', 'Queen', 'Bohemian Rhapsody'],
    ['The Beatles - Let It Be (2009 Remaster)', 'The Beatles', 'Let It Be'],
    ['周杰倫 - 晴天 (男Key)', '周杰倫', '晴天'],
    ['告五人 - 愛人錯過 Key+2', '告五人', '愛人錯過'],
    ['張宇 - 雨一直下 (Key C)', '張宇', '雨一直下'],
    ['Coldplay - Yellow (Official Video) HD', 'Coldplay', 'Yellow'],
  ];
  for (const [raw, artist, title] of cases) {
    const parsed = AudioProcessor.parseVideoTitle(raw);
    assert.deepEqual({ artist: parsed.artist, title: parsed.title }, { artist, title }, raw);
  }
});

test('#7 英文歌名裡的 with／and 不可讓歌手、歌名對調或被拆成合作歌手', () => {
  const AudioProcessor = require('../server/services/audio-processor');
  const cases = [
    ['Sam Smith - Stay With Me (Official Music Video)', 'Sam Smith', 'Stay With Me'],
    ['Dua Lipa - Dancing With A Stranger', 'Dua Lipa', 'Dancing With A Stranger'],
    ['Calvin Harris - Dancing With Your Ghost', 'Calvin Harris', 'Dancing With Your Ghost'],
    ['Unknown Band - Me and You', 'Unknown Band', 'Me and You'],
    // 既有的中文合作寫法與「歌名 - 歌手」校正仍要成立
    ['周杰倫 說好不哭 with阿信【純伴奏版 動態歌詞】', '周杰倫 with 阿信', '說好不哭'],
    ['小幸運 - 田馥甄 KTV伴奏', '田馥甄', '小幸運'],
    ['Some Song - Alan Walker & Ava Max', 'Alan Walker & Ava Max', 'Some Song'],
  ];
  for (const [raw, artist, title] of cases) {
    const parsed = AudioProcessor.parseVideoTitle(raw);
    assert.deepEqual({ artist: parsed.artist, title: parsed.title }, { artist, title }, raw);
  }
});

test('#8 廠牌判斷要有詞邊界：Eminem、Demi Lovato 不是唱片公司', () => {
  const { isLabelArtist } = require('../server/services/video-title-rules');
  for (const name of ['Eminem', 'Demi Lovato', 'Remi Wolf', 'Emily Hackett', 'Semisonic', 'Sonya']) {
    assert.equal(isLabelArtist(name), false, name);
  }
  for (const name of ['EMI', 'Sony Music Japan', 'AdeleVEVO', 'ADELE VEVO', 'Republic Records', '滾石唱片', 'avex trax', 'Big Hit Entertainment']) {
    assert.equal(isLabelArtist(name), true, name);
  }
  const AudioProcessor = require('../server/services/audio-processor');
  assert.equal(AudioProcessor.resolveTrackIdentity({ title: 'Eminem - Lose Yourself [HD]', artist: 'Eminem', track: 'Lose Yourself' }).artist, 'Eminem');
  assert.equal(AudioProcessor.resolveTrackIdentity({ title: 'Demi Lovato - Heart Attack (Official Video)' }).artist, 'Demi Lovato');
});

test('#9 翻唱偵測：歌名含 Cover／Discovery 等字不可被當成翻唱', () => {
  const AudioProcessor = require('../server/services/audio-processor');
  const { LyricsEngine } = require('../server/services/lyrics-engine');
  for (const title of ['Bruce Springsteen - Cover Me (Official Video)', 'The Strokes - Under Cover of Darkness (Official Music Video)']) {
    assert.equal(AudioProcessor.detectCover({ title }), false, title);
  }
  for (const title of ['Lemon Cover', 'Lemon - Cover', 'Song Cover 【VTuber】', 'Lemon (Piano Cover)']) {
    assert.equal(AudioProcessor.detectCover({ title }), true, title);
  }
  assert.equal(LyricsEngine.detectCover('Daft Punk', 'Discovery'), false);
  assert.equal(LyricsEngine.detectCover('CHVRCHES', 'Recover'), false);
  assert.equal(LyricsEngine.detectCover('Bruce Springsteen', 'Cover Me'), false);
  assert.equal(LyricsEngine.detectCover('某VTuber', 'Lemon Cover'), true);
  // 原曲歌名就含 cover 時，候選歌名裡的 cover 不可扣分
  const exact = LyricsEngine.scoreMatch({ artist: 'Bruce Springsteen', title: 'Cover Me', duration: 200, songArtist: 'Bruce Springsteen', songTitle: 'Cover Me', songDuration: 201 });
  const other = LyricsEngine.scoreMatch({ artist: 'Bruce Springsteen', title: 'Cover Me', duration: 200, songArtist: 'Someone', songTitle: 'Another Song', songDuration: 201 });
  assert.ok(exact > other + 15, `${exact} vs ${other}`);
});

test('#26 YouTube 標題：Official髭男dism、THE FIRST TAKE、羅馬字副標、K-pop 引號歌名', () => {
  const AudioProcessor = require('../server/services/audio-processor');
  const parse = (title) => {
    const result = AudioProcessor.parseVideoTitle(title);
    return [result.artist, result.title];
  };
  assert.deepEqual(parse('Official髭男dism - Pretender［Official Video］'), ['Official髭男dism', 'Pretender']);
  assert.deepEqual(parse('LiSA - 紅蓮華 / THE FIRST TAKE'), ['LiSA', '紅蓮華']);
  assert.deepEqual(parse('YOASOBI - 夜に駆ける / THE FIRST TAKE'), ['YOASOBI', '夜に駆ける']);
  assert.deepEqual(parse('Eve - 廻廻奇譚 / Kaikai Kitan'), ['Eve', '廻廻奇譚']);
  assert.deepEqual(parse('BLACKPINK - ‘뚜두뚜두 (DDU-DU DDU-DU)’ M/V'), ['BLACKPINK', '뚜두뚜두 (DDU-DU DDU-DU)']);
  assert.deepEqual(parse("BTS (방탄소년단) 'Dynamite' Official MV"), ['BTS (방탄소년단)', 'Dynamite']);
  assert.deepEqual(parse('藤井 風 - "死ぬのがいいわ" (Official Video)'), ['藤井 風', '死ぬのがいいわ']);
  assert.deepEqual(parse('Mayday五月天 [ 派對動物 Party Animal ] Official Music Video'), ['Mayday五月天', '派對動物 Party Animal']);
  assert.deepEqual(parse('林宥嘉 Yoga Lin [說謊 Lies] Official Music Video'), ['林宥嘉 Yoga Lin', '說謊 Lies']);
  assert.deepEqual(parse('[MV] IU(아이유) _ Celebrity'), ['IU(아이유)', 'Celebrity']);
  assert.deepEqual(parse('Vaundy：踊り子 MUSIC VIDEO'), ['Vaundy', '踊り子']);
  // 不可誤傷
  assert.deepEqual(parse('Mission: Impossible Theme'), ['', 'Mission: Impossible Theme']);
  assert.deepEqual(parse('RADWIMPS - 前前前世 [original ver.] Your Name. MV'), ['RADWIMPS', '前前前世 Your Name.']);
  assert.deepEqual(parse('Taylor Swift - Shake It Off [Live]'), ['Taylor Swift', 'Shake It Off']);
  assert.deepEqual(parse('KING / Kanaria'), ['Kanaria', 'KING']);
  assert.deepEqual(parse("Oasis - Rock 'n' Roll Star"), ['Oasis', "Rock 'n' Roll Star"]);
  assert.deepEqual(parse("Guns N' Roses - Sweet Child O' Mine (Official Music Video)"), ["Guns N' Roses", "Sweet Child O' Mine"]);
  assert.deepEqual(parse('(Official) 周杰倫 - 晴天'), ['周杰倫', '晴天']);
});

test('#36 音檔檔名：emoji 剛好跨在第 80 個字不可被切成半個字元；Windows 保留名稱要避開', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const AudioProcessor = require('../server/services/audio-processor');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-audit-36-'));
  try {
    const rename = (title, artist = '') => {
      const source = path.join(dir, `tmp-${Math.random().toString(36).slice(2)}.m4a`);
      fs.writeFileSync(source, 'x');
      return AudioProcessor.renameToReadableFilename(source, dir, artist, title);
    };
    const longTitle = `${'あ'.repeat(79)}🌙夜`;
    const name = rename(longTitle);
    assert.doesNotThrow(() => encodeURIComponent(name), '檔名必須是合法字串（面板會 encodeURIComponent）');
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(name), '不可留下半個代理字元');
    assert.equal(rename('CON'), 'CON_.m4a');
    assert.equal(rename('CON', 'Someone'), 'Someone - CON.m4a');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#37 翻唱標題：covered 不可被切成 ed、【翻唱】【Cover】【歌ってみた】是標籤不是歌手、cover by 後面是翻唱者', () => {
  const AudioProcessor = require('../server/services/audio-processor');
  const parse = (title) => {
    const result = AudioProcessor.parseVideoTitle(title);
    return [result.artist, result.title];
  };
  assert.deepEqual(parse('【歌ってみた】ヒバナ / DECO*27 covered by 星街すいせい'), ['星街すいせい', 'ヒバナ']);
  assert.deepEqual(parse('ロキ / みきとP feat. 鏡音リン・レン【歌ってみた】'), ['みきとP feat. 鏡音リン・レン', 'ロキ']);
  assert.deepEqual(parse('【翻唱】周杰倫 - 晴天 | 某某 Cover'), ['周杰倫', '晴天']);
  assert.deepEqual(parse('【Cover】告白氣球 - 周杰倫｜某某'), ['周杰倫', '告白氣球']);
  assert.deepEqual(parse('晴天 Cover by 某某'), ['某某', '晴天']);
  assert.deepEqual(parse('晴天 - 周杰倫 (cover by 某某)'), ['某某', '晴天']);
  // 歌名本身有 Cover 的不可被砍
  assert.deepEqual(parse('Cover Me - Bruce Springsteen'), ['Cover Me', 'Bruce Springsteen']);
  assert.ok(parse('Under Cover of Darkness - The Strokes').includes('Under Cover of Darkness'));
  assert.deepEqual(parse('Stand By Me - Ben E. King'), ['Stand By Me', 'Ben E. King']);
});

test('#44 標題解析：A-Lin 連字號不是分隔、括號裡的影視宣傳不搶歌名、鋼琴版只剝註記不剝歌名', () => {
  const AP = require('../server/services/audio-processor');
  const parse = (t) => { const r = AP.parseVideoTitle(t); return [r.artist, r.title]; };
  assert.deepEqual(parse('A-Lin《天若有情》Official Music Video - 電視劇《夢華錄》片尾曲'), ['A-Lin', '天若有情']);
  assert.deepEqual(parse('田馥甄 Hebe Tien [ 小幸運 A Little Happiness ] Official MV (電影「我的少女時代」插曲)'), ['田馥甄 Hebe Tien', '小幸運 A Little Happiness']);
  assert.deepEqual(parse('五月天 [ 派對動物 ] (電影「我的少女時代」插曲)'), ['五月天', '派對動物']);
  assert.deepEqual(parse('孫燕姿 - 遇見 (電影《向左走向右走》主題曲)'), ['孫燕姿', '遇見']);
  assert.deepEqual(parse('G.E.M.鄧紫棋【光年之外 LIGHT YEARS AWAY】MV (電影《太空潛航者 Passengers》中文主題曲)'), ['G.E.M.鄧紫棋', '光年之外 LIGHT YEARS AWAY']);
  assert.equal(parse('【純音樂】晴天 鋼琴版')[1], '晴天');
  assert.equal(parse('晴天【鋼琴版】')[1], '晴天');
  assert.equal(parse('晴天 吉他伴奏版')[1], '晴天');
  assert.equal(parse('晴天 (鋼琴)')[1], '晴天');
  assert.equal(parse('鋼琴師')[1], '鋼琴師');
  assert.equal(parse('黑色鋼琴')[1], '黑色鋼琴');
});

test('#45 標題解析：W/X/Y、AC/DC 的斜線不是分隔；歌詞頻道「已知歌手 - 歌名「歌詞」」不可顛倒', () => {
  const AP = require('../server/services/audio-processor');
  const parse = (t) => { const r = AP.parseVideoTitle(t); return [r.artist, r.title]; };
  assert.deepEqual(parse('Tani Yuuki - W/X/Y (Official Music Video)'), ['Tani Yuuki', 'W/X/Y']);
  assert.deepEqual(parse('AC/DC - Back In Black (Official Video)'), ['AC/DC', 'Back In Black']);
  assert.deepEqual(parse('W/X/Y / Tani Yuuki'), ['Tani Yuuki', 'W/X/Y']);
  // 一般斜線分隔照舊
  assert.deepEqual(parse('ロキ/みきとP'), ['みきとP', 'ロキ']);
  assert.deepEqual(parse('LiSA - 紅蓮華 / THE FIRST TAKE'), ['LiSA', '紅蓮華']);
  // 歌詞頻道兩種順序都要對
  assert.deepEqual(parse('周杰倫 - 晴天「故事的小黃花」動態歌詞'), ['周杰倫', '晴天']);
  assert.deepEqual(parse('晴天 - 周杰倫「故事的小黃花」動態歌詞'), ['周杰倫', '晴天']);
});

test('#52 翻唱影片標題：「歌名 / 原唱【翻唱者】」不可把翻唱者當歌名；中間的【歌ってみた】、｜後面的 cover by、【Vtuber】；結尾【】含 Video 的歌名不可被剝', () => {
  const AP = require('../server/services/audio-processor');
  const parse = (t) => { const r = AP.parseVideoTitle(t); return [r.artist, r.title]; };
  assert.deepEqual(parse('【Cover】Lemon / 米津玄師【某某】'), ['米津玄師', 'Lemon']);
  assert.deepEqual(parse('【歌ってみた】シャルル / バルーン【某某】'), ['バルーン', 'シャルル']);
  assert.equal(parse('祝福 / YOASOBI【歌ってみた】ver.某某')[1], '祝福');
  assert.deepEqual(parse('【MV】晴天｜周杰倫 cover by 某某'), ['周杰倫', '晴天']);
  assert.notEqual(parse('【Vtuber】晴天 周杰倫 cover')[0], 'Vtuber');
  assert.deepEqual(parse('The Buggles【Video Killed the Radio Star】'), ['The Buggles', 'Video Killed the Radio Star']);
  // 既有行為不變
  assert.deepEqual(parse('ロキ / みきとP【歌ってみた】'), ['みきとP', 'ロキ']);
  assert.deepEqual(parse('周杰倫 - 晴天【Official Music Video】'), ['周杰倫', '晴天']);
  assert.deepEqual(parse('AC/DC【Back In Black】'), ['AC/DC', 'Back In Black']);
  assert.deepEqual(parse('周杰倫【告白氣球】'), ['周杰倫', '告白氣球']);
});

test('#63 伴奏標題：「晴天 伴奏 周杰倫」不可黏成「晴天周杰倫」、「-2Key／降2Key」要剝、「歌名 歌手」認得已知歌手；lyrical school 不可剝成 al school', () => {
  const AP = require('../server/services/audio-processor');
  const parse = (t) => { const r = AP.parseVideoTitle(t); return [r.artist, r.title]; };
  assert.deepEqual(parse('晴天 伴奏 周杰倫'), ['周杰倫', '晴天']);
  assert.deepEqual(parse('小幸運 田馥甄'), ['田馥甄', '小幸運']);
  assert.deepEqual(parse('告白氣球 周杰倫 Jay Chou'), ['周杰倫 Jay Chou', '告白氣球']);
  assert.equal(parse('晴天 -2Key 伴奏')[1], '晴天');
  assert.equal(parse('晴天 降2Key 伴奏')[1], '晴天');
  assert.equal(parse('lyrical school - Run and Run')[0], 'lyrical school');
  // 既有行為
  assert.deepEqual(parse('周杰倫 晴天'), ['周杰倫', '晴天']);
  assert.deepEqual(parse('你好 世界'), ['', '你好 世界']);
  assert.deepEqual(parse('Alicia Keys - No One'), ['Alicia Keys', 'No One']);
  assert.deepEqual(parse('Ed Sheeran - Perfect (Lyrics)'), ['Ed Sheeran', 'Perfect']);
});

test('#72 標題開頭的數字只在像曲序時才剝：5566、19、10-FEET、4 Non Blondes、22、2002、7 rings 不可被砍', () => {
  const AP = require('../server/services/audio-processor');
  const parse = (t) => { const r = AP.parseVideoTitle(t); return [r.artist, r.title]; };
  assert.deepEqual(parse('5566 - 我難過'), ['5566', '我難過']);
  assert.deepEqual(parse('10-FEET - 第ゼロ感'), ['10-FEET', '第ゼロ感']);
  assert.deepEqual(parse('4 Non Blondes - What\'s Up'), ['4 Non Blondes', 'What\'s Up']);
  assert.deepEqual(parse('22 - Taylor Swift'), ['Taylor Swift', '22']);
  assert.deepEqual(parse('2002 - Anne-Marie'), ['Anne-Marie', '2002']);
  assert.deepEqual(parse('7 rings - Ariana Grande'), ['Ariana Grande', '7 rings']);
  // 曲序照剝
  assert.deepEqual(parse('01. 晴天 - 周杰倫'), ['周杰倫', '晴天']);
  assert.equal(parse('01 晴天')[1], '晴天');
  assert.equal(parse('#3 晴天')[1], '晴天');
});

test('#73 動態歌詞頻道「歌手 - 歌名【動態歌詞】」被猜成「歌名 - 歌手」時：查不到歌詞就對調再查，查到以對調後為準', async () => {
  const silent = new Proxy({}, { get: () => () => {} });
  const searches = [];
  const audio = loadAuditModule('server/services/audio-processor.js', {
    './lyrics-engine': {
      LyricsEngine: {
        resolveAppleMusicMetadata: async () => null,
        resolveOriginalArtist: async () => null,
        search: async (artist, title) => {
          searches.push([artist, title]);
          return artist === 'en' && title === '囂張' ? { lyrics: '[00:01.00]囂張', type: 'lrc', source: 'kugou' } : null;
        },
      },
      DURATION_TOLERANCE: 5,
    },
    '../utils/logger': { createLogger: () => silent }, './ffmpeg-provider': {}, './import-temp-registry': {}, './ytdlp-updater': {},
    './library-store': { findByIdentity: () => null, getEntry: () => null, rememberImport: () => {} },
  });
  audio.downloadWithMetadata = () => ({
    metadata: Promise.resolve({ id: 'video123456', title: 'en - 囂張【動態歌詞】', duration: 200 }),
    completed: Promise.resolve({ filePath: '/tmp/v.m4a', outputDir: '/tmp' }),
    completeTempImport: () => {},
  });
  audio.detectCover = () => false;
  audio.shouldResolveAppleMetadata = () => false;
  audio.measureLoudnessQueued = async () => -14;
  audio.renameToReadableFilename = () => 'x.m4a';
  audio.requireDownloadedAudio = () => {};
  const track = await audio._processYouTube('https://youtube.com/watch?v=video123456');
  assert.deepEqual(searches, [['囂張', 'en'], ['en', '囂張']]);
  assert.deepEqual([track.artist, track.title], ['en', '囂張']);
  assert.equal(track.lyrics, '[00:01.00]囂張');
});

test('#74 歌名、歌手不可留下空括號或音符裝飾（⌜高音質⌟ → ⌜ ⌟、晴天 ♪）', () => {
  const AP = require('../server/services/audio-processor');
  const parse = (t) => { const r = AP.parseVideoTitle(t); return [r.artist, r.title]; };
  assert.deepEqual(parse('【動態歌詞】周杰倫 - 晴天 ⌜高音質⌟'), ['周杰倫', '晴天']);
  assert.deepEqual(parse('周杰倫-晴天 ♪動態歌詞'), ['周杰倫', '晴天']);
  assert.deepEqual(parse('f(x) - Electric Shock'), ['f(x)', 'Electric Shock']);
});

test('#80 YouTube 自動產生的「歌手 - Topic」頻道：標題只有歌名時，歌手取頻道名（Various Artists 除外）', () => {
  const AP = require('../server/services/audio-processor');
  const lemon = AP.resolveTrackIdentity({ title: 'Lemon', channel: '米津玄師 - Topic' });
  assert.deepEqual([lemon.artist, lemon.title], ['米津玄師', 'Lemon']);
  assert.ok(lemon.confidence >= 0.8);
  assert.equal(AP.resolveTrackIdentity({ title: 'Song', channel: 'Various Artists - Topic' }).artist, '');
  // Topic 頻道只放 Art Track：標題就是歌名本身（#100 起不再拿去拆「歌手 - 歌名」）
  assert.equal(AP.resolveTrackIdentity({ title: 'Blinding Lights - Radio Edit', channel: 'The Weeknd - Topic' }).artist, 'The Weeknd');
});

test('#84 開頭的【中字】【抖音】【Hi-Res】這類標籤不是歌手：後面是「歌手 - 歌名」時照連字號拆', () => {
  const AP = require('../server/services/audio-processor');
  const pick = (t) => { const r = AP.resolveTrackIdentity({ title: t, channel: 'x' }); return [r.artist, r.title]; };
  assert.deepEqual(pick('【中字】Ado - 唱'), ['Ado', '唱']);
  assert.deepEqual(pick('[中字] Ado - 新時代'), ['Ado', '新時代']);
  assert.deepEqual(pick('【雙語】Taylor Swift - Love Story'), ['Taylor Swift', 'Love Story']);
  assert.deepEqual(pick('米津玄師 - Lemon【中日字】'), ['米津玄師', 'Lemon']);
  assert.deepEqual(pick('【抖音】周杰倫 - 晴天'), ['周杰倫', '晴天']);
  assert.deepEqual(pick('【Hi-Res】周杰倫 - 晴天'), ['周杰倫', '晴天']);
  assert.deepEqual(pick('【4K 60fps】周杰倫 - 晴天'), ['周杰倫', '晴天']);
  // 沒有連字號、或【】裡就是已知歌手時維持「【歌手】歌名」
  assert.deepEqual(pick('【周杰倫】晴天'), ['周杰倫', '晴天']);
  assert.deepEqual(pick('【周杰倫】晴天 - Live版'), ['周杰倫', '晴天 - Live版']);
});

test('#85 K-pop「BTS (방탄소년단) Dynamite」：歌手後面的韓文別名括號歸歌手，不黏在歌名前面', () => {
  const AP = require('../server/services/audio-processor');
  const pick = (t) => { const r = AP.resolveTrackIdentity({ title: t, channel: 'x' }); return [r.artist, r.title]; };
  assert.deepEqual(pick('BTS (방탄소년단) Dynamite Official MV'), ['BTS (방탄소년단)', 'Dynamite']);
  assert.deepEqual(pick('NewJeans (뉴진스) Ditto Official MV (side A)'), ['NewJeans (뉴진스)', 'Ditto (side A)']);
  // 英文附註括號不是別名
  assert.deepEqual(pick('BTS (Remix) Dynamite'), ['BTS', '(Remix) Dynamite']);
});

test('#90 翻唱標題：「歌名 (Cover) - 翻唱者」「… // covered by」「Ado (cover)」「feat. 結尾」都拆乾淨', () => {
  const AP = require('../server/services/audio-processor');
  const pick = (t) => { const r = AP.resolveTrackIdentity({ title: t, channel: 'x' }); return [r.artist, r.title]; };
  assert.deepEqual(pick('夜に駆ける (Cover) - 某VTuber'), ['某VTuber', '夜に駆ける']);
  assert.deepEqual(pick('残響散歌 - Aimer // covered by 道明寺ここあ'), ['道明寺ここあ', '残響散歌']);
  assert.deepEqual(pick('うっせぇわ / Ado (cover) 【歌ってみた】'), ['Ado', 'うっせぇわ']);
  assert.deepEqual(pick('千本桜 feat. 初音ミク'), ['初音ミク', '千本桜']);
  const stream = pick('【歌枠】初見さん歓迎！歌う！【ホロライブ/星街すいせい】');
  assert.ok(!/[【】]/.test(stream.join('')), `不能留下半個括號：${stream}`);
  // 原本就對的不變
  assert.deepEqual(pick('【煦Hiyori】雨愛 / 楊丞琳【中文字幕】'), ['楊丞琳', '雨愛']);
  assert.deepEqual(pick('KING / Kanaria covered by 星街すいせい'), ['星街すいせい', 'KING']);
});

test('#91 「歌名 - 歌手『歌詞摘錄』」：連字號已經分出歌名歌手時，後面的框不是歌名', () => {
  const AP = require('../server/services/audio-processor');
  const pick = (t) => { const r = AP.resolveTrackIdentity({ title: t, channel: 'x' }); return [r.artist, r.title]; };
  assert.deepEqual(pick('晴天 - 周杰倫 『從前從前 有個人愛你很久』'), ['周杰倫', '晴天']);
  assert.deepEqual(pick('Aimer - 残響散歌『鬼滅の刃』遊郭編'), ['Aimer', '残響散歌']);
  // 沒有連字號的「歌手『歌名』」照舊
  assert.deepEqual(pick('YOASOBI「アイドル」 Official Music Video'), ['YOASOBI', 'アイドル']);
  assert.deepEqual(pick('A-Lin《摯友》Official MV'), ['A-Lin', '摯友']);
});

test('#92 沒空白的「晴天-周杰倫」：連字號後面是已知歌手就拆（反方向本來就會拆）', () => {
  const AP = require('../server/services/audio-processor');
  const pick = (t) => { const r = AP.resolveTrackIdentity({ title: t, channel: 'x' }); return [r.artist, r.title]; };
  assert.deepEqual(pick('晴天-周杰倫'), ['周杰倫', '晴天']);
  assert.deepEqual(pick('摯友-A-Lin'), ['A-Lin', '摯友']);
  assert.deepEqual(pick('周杰倫-晴天'), ['周杰倫', '晴天']);
  assert.deepEqual(pick('Re-Birth'), ['', 'Re-Birth']);
});

test('#99 標題結尾的 hashtag、表情符號、一小時循環版標記不進歌手／歌名', () => {
  const AP = require('../server/services/audio-processor');
  const pick = (t) => { const r = AP.resolveTrackIdentity({ title: t, channel: 'x' }); return [r.artist, r.title]; };
  assert.deepEqual(pick('晴天 - 周杰倫 #shorts #jaychou'), ['周杰倫', '晴天']);
  assert.deepEqual(pick('周杰倫 - 晴天 🔥🔥'), ['周杰倫', '晴天']);
  assert.deepEqual(pick('晴天 - 周杰倫 (1小時版)'), ['周杰倫', '晴天']);
  assert.deepEqual(pick('晴天 - 周杰倫 Loop 1 hour'), ['周杰倫', '晴天']);
  // 不能誤剝
  assert.deepEqual(pick('周杰倫 - 一小時'), ['周杰倫', '一小時']);
  assert.deepEqual(pick('We Are #1 - Someone'), ['We Are #1', 'Someone']);
  assert.deepEqual(pick('#周杰倫 #晴天'), ['', '#周杰倫 #晴天']);
  assert.deepEqual(pick('24 Hours - Someone'), ['24 Hours', 'Someone']);
});

test('#100 「歌手 - Topic」頻道的標題一定只有歌名：不拿去拆「歌手 - 歌名」、也不對調', () => {
  const AP = require('../server/services/audio-processor');
  const pick = (title, channel) => { const r = AP.resolveTrackIdentity({ title, channel }); return [r.artist, r.title]; };
  assert.deepEqual(pick('Blinding Lights - Radio Edit', 'The Weeknd - Topic'), ['The Weeknd', 'Blinding Lights']);
  assert.deepEqual(pick('Stay (with Justin Bieber)', 'The Kid LAROI - Topic'), ['The Kid LAROI', 'Stay (with Justin Bieber)']);
  assert.deepEqual(pick('Bohemian Rhapsody - Remastered 2011', 'Queen - Topic'), ['Queen', 'Bohemian Rhapsody']);
  // 合輯 Topic 照舊看標題
  assert.deepEqual(pick('周杰倫 - 晴天', 'Various Artists - Topic'), ['周杰倫', '晴天']);
  // 一般影片的 Radio Edit 不會留下「Radio」
  assert.deepEqual(pick('The Weeknd - Blinding Lights (Radio Edit)', 'x'), ['The Weeknd', 'Blinding Lights']);
});
