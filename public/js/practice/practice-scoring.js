/**
 * 練唱評分規則（獨立設計；參數用使用者自己的歌校正過）。純函式，瀏覽器與 Node 測試共用。
 *
 * 單位：音高一律是原調的 MIDI 半音（使用者的音高要先減掉當下的 Key 再比）；時間是原曲秒數。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PracticeScoring = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RULE = Object.freeze({
    fullCents: 75,      // 75 cents 內滿分
    zeroCents: 220,     // 220 cents 以外不得分，中間以平滑曲線遞減
    graceMax: 0.15,     // 每個音開頭的滑音寬容（不計分，唱對照樣填色）
    coverage: 0.60,     // 唱中音長的 60% 就算這個音滿分（氣音、換氣、尾音漸弱不扣）
    detectLag: 0.05,    // 偵測器反應時間，從每個音的必唱長度扣掉
    tiers: Object.freeze({ PERFECT: 0.80, GREAT: 0.60, GOOD: 0.35 }),
    window: 8,          // 畫面可見秒數
    playhead: 0.22,     // 播放頭在畫面寬度的位置
    silentRef: 8,       // 至少經過幾秒可評分時間才判斷「麥克風沒聲音」
    silentRatio: 0.05,  // 唱的時間不到可評分時間的 5% → 無法評分
    unsungLine: 0.1,    // 一句有聲不到一成：不跳評等（分數照算 0）
  });
  const TIERS = ['PERFECT', 'GREAT', 'GOOD', 'MISS'];

  /** 75 cents 內滿分，之後以 smoothstep 平滑降到 220 cents 為 0（不會一過門檻就斷崖）。 */
  function credit(cents) {
    if (cents <= RULE.fullCents) return 1;
    if (cents >= RULE.zeroCents) return 0;
    const x = (cents - RULE.fullCents) / (RULE.zeroCents - RULE.fullCents);
    return 1 - x * x * (3 - 2 * x);
  }

  /** 使用者與目標的音差（cents，取絕對值）；allowOctave 時折到最近的八度。 */
  function centsOff(user, target, allowOctave) {
    let d = user - target;
    if (allowOctave) d -= 12 * Math.round(d / 12);
    return Math.abs(d) * 100;
  }

  /** 顯示用：容許八度時，把使用者音高搬到離目標最近的八度。 */
  function foldToTarget(user, target, allowOctave) {
    if (!allowOctave || target == null) return user;
    return user - 12 * Math.round((user - target) / 12);
  }

  function resetNote(note) {
    note.grace = Math.min(RULE.graceMax, (note.end - note.start) * 0.25);
    note.hit = 0; note.seen = 0; note.voiced = 0; note.fills = [];
    note.skip = false; note.done = false; note.attempted = false;
    return note;
  }

  /** 偵測器反應時間不算成沒唱；短音尤其吃虧。 */
  function noteScore(note) {
    const len = Math.max(0.05, note.end - note.start - note.grace - RULE.detectLag);
    return Math.min(1, note.hit / (len * RULE.coverage));
  }

  function tierOf(score) {
    if (score >= RULE.tiers.PERFECT) return 'PERFECT';
    if (score >= RULE.tiers.GREAT) return 'GREAT';
    if (score >= RULE.tiers.GOOD) return 'GOOD';
    return 'MISS';
  }

  // 只有整個時間單位都是語氣詞才排除；「喔 妳要」這種混合字組不能猜切點。
  const INTERJECTION = /^[喔哦噢啊嗚耶\s，。！!～~]+$/u;

  /**
   * 把伺服器的音高資料整理成評分用：
   * - 兩句歌詞時間重疊（對唱、和聲）與獨立的語氣詞時段標為不計分
   * - 音符在排除區段的邊界切開，依開始時間排序，建立快速查找索引
   * - 每個音補上評分狀態欄位與編號 i
   */
  function prepareGuide(guide) {
    const ranges = (guide.exclusions || []).map((r) => ({ ...r }));
    const lines = guide.lines || [];
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const start = Math.max(lines[i].start, lines[j].start);
        const end = Math.min(lines[i].end, lines[j].end);
        if (end - start > 0.02) ranges.push({ start, end, reason: 'overlap' });
      }
      for (const word of lines[i].words || []) {
        if (INTERJECTION.test(word.text) && word.text.trim()) ranges.push({ start: word.start, end: word.end, reason: 'interjection' });
      }
    }
    const boundaries = [...new Set(ranges.flatMap((r) => [r.start, r.end]))].sort((a, b) => a - b);
    const exclusions = [];
    for (let i = 1; i < boundaries.length; i++) {
      const start = boundaries[i - 1], end = boundaries[i];
      const reasons = [...new Set(ranges.filter((r) => r.start < end && r.end > start).map((r) => r.reason || 'excluded'))];
      if (reasons.length) exclusions.push({ start, end, reasons });
    }
    const notes = (guide.notes || []).flatMap((note) => {
      const cuts = [note.start, ...boundaries.filter((t) => t > note.start && t < note.end), note.end];
      return cuts.slice(1).map((end, i) => {
        const start = cuts[i], mid = (start + end) / 2;
        const exclusion = exclusions.find((r) => mid >= r.start && mid < r.end);
        return { ...note, start, end, excluded: exclusion ? exclusion.reasons.join('+') : null };
      });
    }).sort((a, b) => a.start - b.start || a.end - b.end || a.line - b.line);
    let maxEnd = -Infinity;
    notes.forEach((note, i) => { maxEnd = Math.max(maxEnd, note.end); note.prefixEnd = maxEnd; note.i = i; resetNote(note); });
    const midis = notes.map((n) => n.midi);
    return { ...guide, notes, exclusions, lo: (midis.length ? Math.min(...midis) : 60) - 2, hi: (midis.length ? Math.max(...midis) : 72) + 2 };
  }

  /** time 時正在唱、而且要計分的那個音（排除區段的音不回傳）。 */
  function activeNote(notes, time) {
    let lo = 0, hi = notes.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (notes[mid].start <= time) lo = mid + 1; else hi = mid; }
    for (let i = lo - 1; i >= 0; i--) {
      const note = notes[i];
      if (note.prefixEnd <= time) break;
      if (!note.excluded && note.start <= time && note.end > time) return note;
    }
    return null;
  }

  /** 喇叭回路校準：取中位數，散布太大就不給建議（回傳 null）。 */
  function latencyEstimate(samples) {
    const good = samples.filter(Number.isFinite).filter((v) => v >= 0 && v <= 400).sort((a, b) => a - b);
    if (good.length < 5) return null;
    const median = (xs) => xs[Math.floor(xs.length / 2)];
    const center = median(good), kept = good.filter((v) => Math.abs(v - center) <= 30);
    if (kept.length < 5 || kept[kept.length - 1] - kept[0] > 40) return null;
    return Math.round(median(kept) / 10) * 10;
  }

  return { RULE, TIERS, credit, centsOff, foldToTarget, resetNote, noteScore, tierOf, prepareGuide, activeNote, latencyEstimate };
});
