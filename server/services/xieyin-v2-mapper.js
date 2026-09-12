'use strict';

/**
 * Xieyin v2 ── Japanese phoneme（非羅馬字）→ zh-TW 諧音。
 *
 * 對應 docs/JAPANESE-XIEYIN-V2-PLAN.md Phase 3。輸入是 Open JTalk / Haqumei
 * 風格的 phoneme 陣列（例如 ['g','a','cl','k','o','o']），不是羅馬字字串——
 * 這是刻意的：羅馬字化那一步就是舊版 xieyin.js 準確度的天花板所在（っ/ん/ー
 * 被壓平、は/へ/を 讀音跟字面假名不同）。
 *
 * 這支檔案目前是獨立、可單測的純函式模組，尚未接進 lyrics-engine.js 的正式
 * 產線——依計畫書 Phase 4 的規矩，A/B 迴歸沒過之前不動現有 production path。
 *
 * 音節字對照沿用 xieyin.js 的 XIEYIN_TABLE（同一套字，同一個人維護，使用者
 * 已經看習慣的字不重新發明），這裡只處理 XIEYIN_TABLE 做不到的「跨 phoneme
 * 語境」部分：促音、長音、撥音的語境相依、拗音的 mora 組裝。
 */

const { XIEYIN_TABLE } = require('./xieyin');

// ═══════════════════════════════════════════
// 語境標記字（可調整；只在這裡改，不用動組裝邏輯）
// ═══════════════════════════════════════════

const GEMINATE_MARK = '‧';   // 促音（っ）：下一個字前面的短頓
const LONG_VOWEL_MARK = '－'; // 長音（ー）：延長前一個字的音
const PAUSE_MARK = '，';     // pau：句中明顯停頓（逗號感即可，不需要真的照抄標點）

// 撥音（ん）語境相依：不同後接輔音，中文母語者聽起來的鼻音落點不同。
// 沿用 xieyin.js 既有的 '姆'（雙唇鼻音收尾，韓文表也這樣用）跟 '嗯'（軟顎鼻音）；
// 一般情況維持主表既有的 'n'：'恩'。
const MORAIC_NASAL_BILABIAL = new Set(['p', 'b', 'm', 'py', 'by', 'my']); // ん + p/b/m
const MORAIC_NASAL_VELAR = new Set(['k', 'g', 'ky', 'gy']);               // ん + k/g
function moraicNasalChar(nextConsonant) {
  if (MORAIC_NASAL_BILABIAL.has(nextConsonant)) return '姆';
  if (MORAIC_NASAL_VELAR.has(nextConsonant)) return '嗯';
  return XIEYIN_TABLE.n || '恩'; // 母音／y／字尾／其他：維持預設
}

// ═══════════════════════════════════════════
// haqumei/Open JTalk 子音代碼 → XIEYIN_TABLE 的羅馬字 key 前綴
//
// 大部分行是 identity（'k'+'a' → 'ka'），只有下面這些「字面子音代碼」跟
// 「習慣拼寫」不同，需要特別轉換（し/ち/つ/ふ/じ 這幾個自古就是羅馬字例外）。
// ═══════════════════════════════════════════

const CONSONANT_SPELLING = {
  sh: 'sh', ch: 'ch', ts: 'ts', j: 'j', f: 'f',
  ky: 'ky', gy: 'gy', ny: 'ny', hy: 'hy', my: 'my', ry: 'ry', by: 'by', py: 'py',
  ty: 't', dy: 'd', // てぃ/でぃ：拼成 t+i / d+i（見下方 ti/di 特例），沒有獨立拗音字
  kw: 'kw',
};

// 子音 + 母音 → 不能用「前綴＋母音」機械組出來的特例（羅馬字史遺留的不規則拼寫，
// 或外來語專用拼法，兩者都已經在 XIEYIN_TABLE 裡有對應字）。
const IRREGULAR_SYLLABLE = {
  't|i': 'ti',   // てぃ（外來語）
  'd|i': 'di',   // でぃ（外來語）
  't|u': 'tsu',  // つ 本身：t 開頭＋u，但正確拼法是 tsu
  'ts|i': 'tsi', // ツィ（外來語）
  'kw|a': 'kwa', // クァ（外來語）
};

function syllableKey(consonant, vowel) {
  if (!consonant) return vowel; // 純母音
  const spelled = CONSONANT_SPELLING[consonant] || consonant;
  const irregular = IRREGULAR_SYLLABLE[`${spelled}|${vowel}`];
  if (irregular) return irregular;
  return `${spelled}${vowel}`;
}

function syllableChar(consonant, vowel) {
  const key = syllableKey(consonant, vowel);
  const char = XIEYIN_TABLE[key];
  if (char) return char;
  // 表裡沒有的音：保留羅馬字（跟 xieyin.js 現有慣例一致，好過生造一個誤導的字）。
  return key;
}

const VOWELS = new Set(['a', 'i', 'u', 'e', 'o']);

/**
 * 把扁平的 phoneme 陣列切成 mora 單位。
 *
 * Open JTalk 風格的 phoneme 集合：
 * - 母音：a i u e o
 * - 撥音：N（獨立一個 mora，不跟其他音節合併）
 * - 促音：cl（不是獨立 mora，是「下一個輔音要重讀」的標記，本身不發音）
 * - pau / sil：句中／首尾停頓
 * - 其餘一律視為「輔音（可能含拗音的 y 尾）」，後面接一個母音組成一個 mora；
 *   如果輔音後面沒有母音（不應該發生，但輸入不保證乾淨），該輔音單獨成一個
 *   「無法辨識」mora，直接印出原始 phoneme 字串，不讓整行掉資料。
 *
 * @param {string[]} phonemes
 * @returns {Array<{type:string,[key:string]:any}>}
 */
// Open JTalk／haqumei 用大寫 I／U 標記「清化母音」（無聲子音之間的 い／う，
// 例如「です」常唸成 des(u) 尾音幾乎不發聲）。對諧音而言清化與否不影響要標
// 哪個字，只是通常唱歌時會確實發出來——一律當成一般母音處理，不特別區分。
function normalizePhoneme(t) {
  if (t === 'U') return 'u';
  if (t === 'I') return 'i';
  return t;
}

function groupIntoMorae(phonemes) {
  const morae = [];
  let geminatePending = false;
  let i = 0;
  while (i < phonemes.length) {
    const t = normalizePhoneme(phonemes[i]);
    if (t === 'pau' || t === 'sil') { morae.push({ type: 'pause' }); i += 1; continue; }
    if (t === 'cl') { geminatePending = true; i += 1; continue; }
    if (t === 'N') {
      const next = phonemes[i + 1];
      morae.push({ type: 'moraic_nasal', next });
      i += 1;
      continue;
    }
    if (VOWELS.has(t)) {
      const prev = morae[morae.length - 1];
      if (prev && prev.type === 'cv' && prev.vowel === t) {
        morae.push({ type: 'long_extend' });
      } else {
        morae.push({ type: 'cv', consonant: null, vowel: t, geminate: geminatePending });
      }
      geminatePending = false;
      i += 1;
      continue;
    }
    // 輔音：期待下一個 token 是母音
    const next = normalizePhoneme(phonemes[i + 1]);
    if (next && VOWELS.has(next)) {
      morae.push({ type: 'cv', consonant: t, vowel: next, geminate: geminatePending });
      geminatePending = false;
      i += 2;
      continue;
    }
    // 沒接母音（不完整/未知輔音）：原樣保留，不吃掉、不讓整行壞掉
    morae.push({ type: 'unknown', raw: t });
    geminatePending = false;
    i += 1;
  }
  return morae;
}

/**
 * Phoneme 陣列 → zh-TW 諧音字串。
 *
 * @param {string[]} phonemes - 例如 haqumei 的 `g2p()` 輸出
 * @returns {string}
 */
function phonemesToXieyinV2(phonemes) {
  if (!Array.isArray(phonemes) || phonemes.length === 0) return '';
  const morae = groupIntoMorae(phonemes);
  const out = [];
  for (const mora of morae) {
    switch (mora.type) {
      case 'pause':
        if (out.length && out[out.length - 1] !== PAUSE_MARK) out.push(PAUSE_MARK);
        break;
      case 'moraic_nasal':
        out.push(moraicNasalChar(mora.next));
        break;
      case 'long_extend':
        out.push(LONG_VOWEL_MARK);
        break;
      case 'unknown':
        out.push(mora.raw);
        break;
      case 'cv':
      default: {
        if (mora.geminate) out.push(GEMINATE_MARK);
        out.push(syllableChar(mora.consonant, mora.vowel));
        break;
      }
    }
  }
  // 收斂：開頭/結尾多餘的停頓標記、連續重複的停頓標記
  return out.join('')
    .replace(new RegExp(`^${PAUSE_MARK}+|${PAUSE_MARK}+$`, 'g'), '')
    .replace(new RegExp(`(${PAUSE_MARK}){2,}`, 'g'), PAUSE_MARK);
}

module.exports = {
  phonemesToXieyinV2,
  groupIntoMorae,
  syllableKey,
  syllableChar,
  moraicNasalChar,
  GEMINATE_MARK,
  LONG_VOWEL_MARK,
  PAUSE_MARK,
};
