/**
 * 精準對時（選裝元件）的判斷邏輯，不碰檔案也不碰 worker，方便測試。
 *
 * 數字都來自 2026-11-12 的實驗（測試用資料夾/人聲互相關對時實驗-20261027/zipformer-20261112）：
 * - 整首：模型給的偏移減 253ms 就是中心，再用句首互相關在 ±0.7 秒內微調；
 *   z≥6 且第二峰比≥2 才算可信（中文 72 首：正確 44/44 過、錯歌詞 0/12 放行；留出 26 首過 23）。
 * - 逐句：強制對齊找到的句首平均早 50ms；每句信心（字的尖峰平均對數機率）≥−2.43、而且跟整首
 *   偏移差超過 0.3 秒的句子才改（51 份別來源歌詞 608 句：準的 505→571、錯 >0.5 秒的 60→13，
 *   只改 104 句；連小誤差都改是 576／12 但要改 519 句，不值得動那麼多使用者的歌詞）。
 *   「先扣掉各句共同的偏差再改」反而變差（538／39）：共同的差距多半是整首偏移真的偏了。
 * 只支援中文（模型只認中文字）。
 */
'use strict';

const OpenCC = require('opencc-js');

const MODEL_MIN_Z = 6;
const MODEL_MIN_RATIO = 2;
const MODEL_BIAS_MS = 253;
const REFINE_WINDOW_MS = 700;
const LINE_BIAS_MS = -50;
const LINE_MIN_CONF = -2.43;
// 只改跟整首偏移差超過這麼多的句子；都只是小誤差就只套偏移，不動使用者的歌詞
const LINE_REWRITE_MIN_MS = 300;

const toSimplified = OpenCC.Converter({ from: 't', to: 'cn' });

const HAN = /[㐀-䶿一-鿿]/g;
const KANA = /[぀-ヿ]/g;
const HANGUL = /[가-힣]/g;

/** 中文歌詞：漢字夠多，而且幾乎沒有假名、沒有韓文（日文歌也有很多漢字）。 */
function isChineseLyrics(lines) {
  const text = (lines || []).map((l) => (l && l.text) || '').join('');
  const han = (text.match(HAN) || []).length;
  const kana = (text.match(KANA) || []).length;
  const hangul = (text.match(HANGUL) || []).length;
  return han >= 40 && kana <= han * 0.02 && hangul <= han * 0.02;
}

/** 送給 worker 的精簡版：只留時間與文字，文字轉成簡體（模型的字表是簡體）。索引跟原陣列一致。 */
function toWorkerLines(lines) {
  return (lines || []).map((l) => {
    if (!l || typeof l !== 'object') return { time: 0, duration: 0, text: '', words: [] };
    return {
      time: Number(l.time) || 0,
      duration: Number(l.duration) || 0,
      text: toSimplified(String(l.text || '')),
      words: Array.isArray(l.words)
        ? l.words.filter((w) => w && typeof w === 'object').map((w) => ({
          text: toSimplified(String(w.text || '')), start: Number(w.start) || 0, duration: Number(w.duration) || 0,
        }))
        : [],
    };
  });
}

function modelPasses(result) {
  return !!result && Number.isFinite(result.peakZ) && result.peakZ >= MODEL_MIN_Z && result.peakRatio >= MODEL_MIN_RATIO;
}

/** 模型給的整首偏移換成句首互相關要搜尋的中心。 */
function modelCenterMs(result) {
  return result.offsetMs - MODEL_BIAS_MS;
}

/**
 * 依逐句對齊結果改寫歌詞時間。偏移維持 offsetMs，有把握、而且差超過 LINE_REWRITE_MIN_MS 的句子
 * 把 time 改成「這句真正開始唱的時間＋偏移」，其他句不動。逐字時間是相對句首的，跟著整句移動。
 * 改完若前後順序顛倒，就把那句還原，直到順序正確。
 * 回傳 { lines, moved, maxShiftMs }；沒有任何一句要改時 lines 為 null。
 */
function retimeLines(lines, offsetMs, alignment, { onsetNear = null } = {}) {
  if (!Array.isArray(lines) || !alignment) return { lines: null, moved: 0, maxShiftMs: 0 };
  const target = lines.map((l) => (l && Number.isFinite(l.time) ? l.time : null));
  const proposed = target.slice();
  for (const [key, onset] of Object.entries(alignment.onsets || {})) {
    const i = Number(key);
    const conf = alignment.conf ? alignment.conf[key] : undefined;
    if (!Number.isInteger(i) || target[i] == null || !Number.isFinite(onset) || !(conf >= LINE_MIN_CONF)) continue;
    const next = Math.max(0, Math.round(onset - LINE_BIAS_MS + offsetMs));
    if (Math.abs(next - target[i]) > LINE_REWRITE_MIN_MS) proposed[i] = next;
  }
  const textIdx = lines.map((l, i) => (l && String(l.text || '').trim() && target[i] != null ? i : -1)).filter((i) => i >= 0);
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    for (let k = 1; k < textIdx.length; k++) {
      const a = textIdx[k - 1], b = textIdx[k];
      if (proposed[b] > proposed[a]) continue;
      // 順序顛倒：把有被移動的那句還原（兩句都動過就還原後面那句）
      const revert = proposed[b] !== target[b] ? b : a;
      if (proposed[revert] === target[revert]) continue;
      proposed[revert] = target[revert];
      changed = true;
    }
    if (!changed) break;
  }
  let moved = 0;
  let maxShiftMs = 0;
  for (let i = 0; i < lines.length; i++) {
    if (target[i] == null || proposed[i] === target[i]) continue;
    moved += 1;
    maxShiftMs = Math.max(maxShiftMs, Math.abs(proposed[i] - target[i]));
  }
  if (moved === 0) return { lines: null, moved, maxShiftMs };
  // 整首多數決：改動的句子裡，「原本的時間比較接近人聲起唱點」的比較多，代表模型在這首歌整體偏了，
  // 整首不校正（只看找得到起唱點的句子；一句一句否決反而會誤殺，實驗集錯句 13→20）。
  if (typeof onsetNear === 'function') {
    let keepOld = 0;
    let takeNew = 0;
    for (let i = 0; i < lines.length; i++) {
      if (target[i] == null || proposed[i] === target[i]) continue;
      const oldAudio = target[i] - offsetMs;
      const newAudio = proposed[i] - offsetMs;
      const on = onsetNear((oldAudio + newAudio) / 2);
      if (on == null) continue;
      if (Math.abs(on - newAudio) < Math.abs(on - oldAudio)) takeNew += 1;
      else keepOld += 1;
    }
    if (keepOld > takeNew) return { lines: null, moved: 0, maxShiftMs: 0, vetoed: true };
  }
  const out = lines.map((l, i) => {
    if (!l || target[i] == null || proposed[i] === target[i]) return l;
    const shift = proposed[i] - target[i];
    const next = { ...l, time: proposed[i] };
    if (Number.isFinite(l.endTime) && l.endTime > 0) next.endTime = l.endTime + shift;
    return next;
  });
  return { lines: out, moved, maxShiftMs };
}

module.exports = {
  isChineseLyrics,
  toWorkerLines,
  modelPasses,
  modelCenterMs,
  retimeLines,
  MODEL_MIN_Z,
  MODEL_MIN_RATIO,
  MODEL_BIAS_MS,
  REFINE_WINDOW_MS,
  LINE_BIAS_MS,
  LINE_MIN_CONF,
  LINE_REWRITE_MIN_MS,
};
