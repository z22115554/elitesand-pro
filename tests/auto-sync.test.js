'use strict';

/**
 * 自動對時（server/services/auto-sync.js）。
 *
 * 真實準確度在 2026-10-27 用 130 首真歌驗過（Node 版與實驗 Python 版逐首結果一致）；
 * 這裡只用合成訊號守住會壞的地方：位移方向／單位、低信心不套用、歌詞太少不分析，
 * 以及 socket handler 的幾個契約。
 */

const fs = require('fs');
const path = require('path');
const autoSync = require('../server/services/auto-sync');

const SR = autoSync.SAMPLE_RATE;

// 固定亂數，讓測試可重現
function rng(seed) {
  return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
}

// 不規則長度的歌詞行（真歌的句長不會一樣，互相關才有唯一峰值）
function makeLines(count, random) {
  const lines = [];
  let t = 8000;
  for (let i = 0; i < count; i++) {
    const duration = 1200 + Math.round(random() * 2600);
    lines.push({ time: t, duration, text: `第${i}句歌詞內容` });
    t += duration + 300 + Math.round(random() * 1800);
  }
  return lines;
}

// 依歌詞「實際被唱」的位置（lyric 時間 + delayMs）產生人聲：唱的時候大聲、其他時間近乎靜音
function makeVocals(lines, delayMs, totalSec, random) {
  return makeVocalsBy(lines, () => delayMs, totalSec, random);
}

function makeVocalsBy(lines, delayOf, totalSec, random) {
  const samples = new Float32Array(SR * totalSec);
  for (let i = 0; i < samples.length; i++) samples[i] = (random() - 0.5) * 0.0005;
  lines.forEach((line, k) => {
    const delayMs = delayOf(k);
    const a = Math.floor((line.time + delayMs) / 1000 * SR);
    const b = Math.min(samples.length, Math.floor((line.time + line.duration + delayMs) / 1000 * SR));
    for (let i = Math.max(0, a); i < b; i++) samples[i] = Math.sin(i * 0.07) * 0.3 + (random() - 0.5) * 0.05;
  });
  return samples;
}

function register({ test, eq, ok }) {
  test('自動對時：人聲比歌詞晚 1.23 秒 → 偏移 -1230ms（顯示端 adjustedTime = audioTime + offset）', () => {
    const random = rng(7);
    const lines = makeLines(30, random);
    const result = autoSync.estimateOffset(makeVocals(lines, 1230, 150, random), lines);
    ok(result.accepted, `應該高信心: z=${result.peakZ} k=${result.peakRatio}`);
    ok(Math.abs(result.offsetMs - -1230) <= 30, `偏移應約 -1230ms，實際 ${result.offsetMs}`);
  });

  test('自動對時：人聲比歌詞早 → 正偏移', () => {
    const random = rng(11);
    const lines = makeLines(30, random);
    const result = autoSync.estimateOffset(makeVocals(lines, -2500, 150, random), lines);
    ok(result.accepted);
    ok(Math.abs(result.offsetMs - 2500) <= 30, `偏移應約 +2500ms，實際 ${result.offsetMs}`);
  });

  test('自動對時：人聲跟歌詞對不起來時不套用', () => {
    const random = rng(3);
    const lines = makeLines(30, random);
    // 人聲照另一套完全無關的時間軸唱
    const other = makeLines(30, rng(99)).map((l) => ({ ...l, time: l.time * 0.83 + 4000 }));
    const result = autoSync.estimateOffset(makeVocals(other, 0, 150, random), lines);
    eq(result.accepted, false);
    eq(result.reason, 'LOW_CONFIDENCE');
  });

  test('自動對時：前後半段需要的偏移不同（歌詞是別的版本）→ 不套用並回報 VERSION_MISMATCH', () => {
    const random = rng(7);
    const lines = makeLines(32, random);
    const result = autoSync.estimateOffset(makeVocalsBy(lines, (k) => (k < 16 ? 1000 : 3000), 160, random), lines);
    eq(result.accepted, false);
    eq(result.reason, 'VERSION_MISMATCH');
    ok(Math.abs(result.spreadMs - 2000) <= 50, `前後段差應約 2000ms，實際 ${result.spreadMs}`);
  });

  test('自動對時：歌詞行太少或全部同一時間戳就不分析', () => {
    const random = rng(5);
    const few = makeLines(5, random);
    eq(autoSync.estimateOffset(makeVocals(few, 0, 60, random), few).reason, 'NOT_ENOUGH_LYRICS');
    const flat = makeLines(20, random).map((l) => ({ ...l, time: 0 }));
    eq(autoSync.estimateOffset(makeVocals(flat, 0, 60, random), flat).reason, 'NOT_ENOUGH_LYRICS');
  });

  test('自動對時：逐字歌詞判斷（整句一個字的假逐字 KRC 不算）', () => {
    const word = [{ text: '甲乙', words: [{ text: '甲', start: 0, duration: 200 }, { text: '乙', start: 200, duration: 200 }] }];
    const fake = [{ text: '甲乙', words: [{ text: '甲乙', start: 0, duration: 400 }] }];
    eq(autoSync.isWordLevel([...word, ...word, ...fake]), true);
    eq(autoSync.isWordLevel([...fake, ...fake, ...word]), false);
    eq(autoSync.isWordLevel([]), false);
  });

  test('自動對時：換歌詞來源與還原走既有的歌詞套用流程', () => {
    const lyrics = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'handlers', 'lyrics.js'), 'utf8');
    ok(lyrics.includes('function findAlignedSource'), '應有搜尋其他來源的流程');
    ok(lyrics.includes('Number(y.wordLevel) - Number(x.wordLevel)'), '候選排序要逐字歌詞優先');
    const undo = lyrics.slice(lyrics.indexOf("socket.on('offset:auto-undo'"));
    ok(undo.includes('applyManualLyrics('), '還原歌詞要走 applyManualLyrics（清單回寫、廣播、歌曲庫一起處理）');
    ok(undo.includes('now !== undo.appliedOffsetMs'), '偏移之後被改過就不可還原');
  });

  test('自動對時：socket handler 契約（人聲檔只限 downloads 單純檔名、不送社群偏移、唯讀端擋得住）', () => {
    const lyrics = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'handlers', 'lyrics.js'), 'utf8');
    const start = lyrics.indexOf("socket.on('offset:auto'");
    ok(start > 0, '應有 offset:auto handler');
    const body = lyrics.slice(start, lyrics.indexOf('\n  });', start));
    ok(body.includes('path.basename(vocalsFile) === vocalsFile'), '人聲檔名必須擋路徑穿越');
    ok(!body.includes('scheduleLyricOffsetSync'), 'AI 算的偏移不是人工確認值，不可送社群回饋');
    ok(body.includes("'NEEDS_SEPARATION'"), '沒有人聲時要回 NEEDS_SEPARATION 讓面板走分離流程');
    const socketHandler = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'socket-handler.js'), 'utf8');
    const readOnly = socketHandler.slice(socketHandler.indexOf('const READ_ONLY_EVENTS'), socketHandler.indexOf(']);', socketHandler.indexOf('const READ_ONLY_EVENTS')));
    ok(!readOnly.includes('offset:auto'), '唯讀端不可觸發自動對時');
  });
}

module.exports = { register };
