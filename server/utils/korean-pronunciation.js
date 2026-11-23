'use strict';

/**
 * 韓文標準發音（표준 발음）轉換：把「寫法」的諺文轉成「唱出來的音」的諺文，
 * 再交給羅馬拼音（romanizer.koreanToRomaja）與諧音（xieyin.koreanToXieyin）逐字查表。
 *
 * 為什麼需要：兩邊原本都是一個字一個字查表，沒有處理字與字之間的音變，
 * 唱歌時最常見的幾種全部唸錯——
 *   좋아 → jota／左特阿（實際唸 조아 joa）
 *   감사합니다 → gamsahapnida（實際唸 감사함니다 gamsahamnida）
 *   한국어 → hangukeo（實際唸 한구거 hangugeo）
 *   같이 → gati（實際唸 가치 gachi）
 *
 * 只處理同一串連續諺文（同一個詞）裡相鄰兩個字之間的規則，遇到空白／標點就斷開：
 * 連音、ㅎ 脫落、送氣化、鼻音化、流音化、顎化。緊音化（학교 → 학꾜）刻意不做——
 * 修訂羅馬字本來就不標緊音，諧音表也不區分。
 */

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

// 初聲索引
const CHO = { G: 0, KK: 1, N: 2, D: 3, TT: 4, R: 5, M: 6, B: 7, PP: 8, S: 9, SS: 10, NG: 11, J: 12, JJ: 13, CH: 14, K: 15, T: 16, P: 17, H: 18 };
// 終聲索引（0 = 沒有收音）
const JONG = {
  NONE: 0, G: 1, KK: 2, GS: 3, N: 4, NJ: 5, NH: 6, D: 7, L: 8, LG: 9, LM: 10, LB: 11, LS: 12, LT: 13, LP: 14, LH: 15,
  M: 16, B: 17, BS: 18, S: 19, SS: 20, NG: 21, J: 22, CH: 23, K: 24, T: 25, P: 26, H: 27,
};
const VOWEL_I = 20; // ㅣ

// 收音 → 連音時「留在前一字的收音」與「移到下一字的初聲」
const LIAISON = {
  [JONG.G]: [JONG.NONE, CHO.G], [JONG.KK]: [JONG.NONE, CHO.KK], [JONG.GS]: [JONG.G, CHO.SS],
  [JONG.N]: [JONG.NONE, CHO.N], [JONG.NJ]: [JONG.N, CHO.J], [JONG.NH]: [JONG.NONE, CHO.N],
  [JONG.D]: [JONG.NONE, CHO.D], [JONG.L]: [JONG.NONE, CHO.R], [JONG.LG]: [JONG.L, CHO.G],
  [JONG.LM]: [JONG.L, CHO.M], [JONG.LB]: [JONG.L, CHO.B], [JONG.LS]: [JONG.L, CHO.SS],
  [JONG.LT]: [JONG.L, CHO.T], [JONG.LP]: [JONG.L, CHO.P], [JONG.LH]: [JONG.NONE, CHO.R],
  [JONG.M]: [JONG.NONE, CHO.M], [JONG.B]: [JONG.NONE, CHO.B], [JONG.BS]: [JONG.B, CHO.SS],
  [JONG.S]: [JONG.NONE, CHO.S], [JONG.SS]: [JONG.NONE, CHO.SS], [JONG.J]: [JONG.NONE, CHO.J],
  [JONG.CH]: [JONG.NONE, CHO.CH], [JONG.K]: [JONG.NONE, CHO.K], [JONG.T]: [JONG.NONE, CHO.T],
  [JONG.P]: [JONG.NONE, CHO.P], [JONG.H]: [JONG.NONE, CHO.NG],
};

// 收音的發音代表音群組（鼻音化、送氣化用）
const K_GROUP = new Set([JONG.G, JONG.KK, JONG.GS, JONG.LG, JONG.K]);
const T_GROUP = new Set([JONG.D, JONG.S, JONG.SS, JONG.J, JONG.CH, JONG.T]);
const P_GROUP = new Set([JONG.B, JONG.BS, JONG.P, JONG.LP]);
const H_FINALS = new Set([JONG.H, JONG.NH, JONG.LH]);

function decompose(ch) {
  const code = ch.codePointAt(0);
  if (code < HANGUL_BASE || code > HANGUL_LAST) return null;
  const offset = code - HANGUL_BASE;
  return { cho: Math.floor(offset / 588), jung: Math.floor((offset % 588) / 28), jong: offset % 28 };
}

function compose({ cho, jung, jong }) {
  return String.fromCodePoint(HANGUL_BASE + cho * 588 + jung * 28 + jong);
}

/** ㅎ 系收音（ㅎ／ㄶ／ㅀ）去掉 ㅎ 之後剩下的收音。 */
function withoutH(jong) {
  if (jong === JONG.NH) return JONG.N;
  if (jong === JONG.LH) return JONG.L;
  return JONG.NONE;
}

/** 調整相鄰兩字 a（前）、b（後），直接改寫兩個物件。 */
function applyPair(a, b) {
  const jong = a.jong;
  if (jong === JONG.NONE) return;

  // 1) 後字是母音開頭（初聲 ㅇ）：連音、ㅎ 脫落、顎化
  if (b.cho === CHO.NG) {
    if (jong === JONG.NG) return;
    const move = LIAISON[jong];
    if (!move) return;
    let [keep, onset] = move;
    if (b.jung === VOWEL_I && onset === CHO.D) onset = CHO.J;   // 굳이 → 구지
    if (b.jung === VOWEL_I && onset === CHO.T) onset = CHO.CH;  // 같이 → 가치
    a.jong = keep;
    b.cho = onset;
    return;
  }

  // 2) ㅎ 系收音＋ㄱ／ㄷ／ㅈ／ㅅ／ㄴ：送氣化或同化（좋다 → 조타、좋네 → 존네、싫네 → 실레）
  if (H_FINALS.has(jong)) {
    const rest = withoutH(jong);
    if (b.cho === CHO.G) { a.jong = rest; b.cho = CHO.K; return; }
    if (b.cho === CHO.D) { a.jong = rest; b.cho = CHO.T; return; }
    if (b.cho === CHO.J) { a.jong = rest; b.cho = CHO.CH; return; }
    if (b.cho === CHO.S) { a.jong = rest; b.cho = CHO.SS; return; }
    if (b.cho === CHO.N) {
      if (jong === JONG.LH) { a.jong = JONG.L; b.cho = CHO.R; return; }
      a.jong = JONG.N;
      return;
    }
    return;
  }

  // 3) 塞音收音＋ㅎ：送氣化（축하 → 추카、입학 → 이팍、못해 → 모태）
  if (b.cho === CHO.H) {
    if (K_GROUP.has(jong)) { a.jong = jong === JONG.LG ? JONG.L : JONG.NONE; b.cho = CHO.K; return; }
    if (T_GROUP.has(jong)) { a.jong = JONG.NONE; b.cho = jong === JONG.J ? CHO.CH : CHO.T; return; }
    if (P_GROUP.has(jong) || jong === JONG.LB) { a.jong = jong === JONG.LB ? JONG.L : JONG.NONE; b.cho = CHO.P; return; }
    if (jong === JONG.NJ) { a.jong = JONG.N; b.cho = CHO.CH; return; }
    return;
  }

  // 4) 流音化：ㄴ＋ㄹ、ㄹ＋ㄴ → ㄹㄹ（신라 → 실라、설날 → 설랄）
  if (jong === JONG.N && b.cho === CHO.R) { a.jong = JONG.L; return; }
  if ((jong === JONG.L || jong === JONG.LH) && b.cho === CHO.N) { b.cho = CHO.R; return; }

  // 5) ㅁ／ㅇ＋ㄹ → ㄹ 唸 ㄴ（심리 → 심니、강릉 → 강능）
  if ((jong === JONG.M || jong === JONG.NG) && b.cho === CHO.R) { b.cho = CHO.N; return; }

  // 6) 塞音收音＋ㄹ：ㄹ 先唸 ㄴ，再鼻音化（국립 → 궁닙、협력 → 혐녁）
  if (b.cho === CHO.R && (K_GROUP.has(jong) || P_GROUP.has(jong) || T_GROUP.has(jong))) b.cho = CHO.N;

  // 7) 鼻音化：塞音收音＋ㄴ／ㅁ（합니다 → 함니다、국물 → 궁물、빛나 → 빈나）
  if (b.cho === CHO.N || b.cho === CHO.M) {
    if (K_GROUP.has(jong)) a.jong = JONG.NG;
    else if (T_GROUP.has(jong)) a.jong = JONG.N;
    else if (P_GROUP.has(jong)) a.jong = JONG.M;
  }
}

/**
 * 把一段文字裡的諺文換成標準發音。非諺文字元原樣保留，也會切斷音變（空白、標點、英文）。
 * 輸出字元數與輸入相同（一個諺文字仍是一個字），逐字對齊的呼叫端不會錯位。
 */
function koreanPronunciation(text) {
  const chars = Array.from(String(text || ''));
  const parts = chars.map(decompose);
  for (let i = 0; i + 1 < parts.length; i += 1) {
    if (parts[i] && parts[i + 1]) applyPair(parts[i], parts[i + 1]);
  }
  return parts.map((part, index) => (part ? compose(part) : chars[index])).join('');
}

/**
 * KRC 逐字模式：每個 word 各自轉換的話，字與字之間的音變永遠不會發生（韓文逐字歌詞常常一個字
 * 就是一個 word）。整句接起來轉一次，再依每個 word 的字數切回去。
 */
function pronouncedWordTexts(wordTexts) {
  const texts = wordTexts.map((value) => String(value || ''));
  const pronounced = Array.from(koreanPronunciation(texts.join('')));
  let cursor = 0;
  return texts.map((value) => {
    const length = Array.from(value).length;
    const slice = pronounced.slice(cursor, cursor + length).join('');
    cursor += length;
    return slice;
  });
}

module.exports = { koreanPronunciation, pronouncedWordTexts };
