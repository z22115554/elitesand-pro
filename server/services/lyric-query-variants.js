'use strict';
// 歌詞查詢候選。
// 官方影片的歌手／歌名常是「原文＋英文名」並列（「蔡依林 Jolin Tsai」「愛的天使 Angel of Love」
// 「アイドル Idol」「告白氣球Love Confession」「歌名 - English」「English／歌名」），
// 但歌詞資料庫多半只索引其中一種語言，整串丟去查容易落空或排到別的版本。
// 這裡只是多產生幾組查詢候選，不動畫面上顯示的歌手與歌名；原樣那一組永遠先試。
const OpenCC = require('opencc-js');

const convertToTraditional = OpenCC.Converter({ from: 'cn', to: 'tw' });
const KANA_CHAR = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
// 日文歌名不可簡轉繁：「孤独」「踊り子」會被改成資料庫裡不存在的寫法。
function simplifiedToTraditional(text) {
  return KANA_CHAR.test(text) ? text : convertToTraditional(text);
}

const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LATIN_ONLY = /^[A-Za-z][A-Za-z0-9 '’&.,!?-]*$/;
// 半形分隔符要兩側有空白才算（避免切開 "Re-born" 這類字內連字號）；全形的不需要。
const TITLE_SEPARATOR = /\s+[-–—/|~:]\s+|\s*[／｜〜：]\s*/;
// 合唱／合作的歌手分隔：& ＆ × + 、 ， , / ／ feat. ft.，以及兩側有空白的 x／X。
const ARTIST_SEPARATOR = /\s*(?:[&＆×+、，,/／]|\bfeat\.?|\bft\.?)\s*|\s+[xX]\s+/i;
// 每多一組候選，全部來源落空時就多一輪查詢，所以設上限。
const MAX_VARIANTS = 4;

function latinLetterCount(text) {
  return (text.match(/[A-Za-z]/g) || []).length;
}

function isLatinPart(text) {
  return LATIN_ONLY.test(text) && latinLetterCount(text) >= 2;
}

// 把「原文＋英文」並列的字串拆成兩半；不是這種形狀就回 null。
function splitBilingual(text) {
  const parts = text.split(TITLE_SEPARATOR).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const native = parts.find((part) => CJK_CHAR.test(part));
    const latin = parts.find((part) => isLatinPart(part));
    if (native && latin) return { native, latin };
  }
  const chars = Array.from(text);
  let first = -1;
  let last = -1;
  chars.forEach((ch, index) => {
    if (!CJK_CHAR.test(ch)) return;
    if (first < 0) first = index;
    last = index;
  });
  if (first < 0) return null;
  // 原文在前、英文在後（中間有沒有空白都算）
  const tail = chars.slice(last + 1).join('').trim();
  if (isLatinPart(tail)) return { native: chars.slice(0, last + 1).join('').trim(), latin: tail };
  // 英文在前、原文在後
  const head = chars.slice(0, first).join('').trim();
  if (isLatinPart(head)) return { native: chars.slice(first).join('').trim(), latin: head };
  return null;
}

function lyricTitleVariants(title) {
  const original = String(title || '').trim();
  const variants = [];
  const add = (candidate) => {
    const value = String(candidate || '').trim();
    if (value && !variants.includes(value) && variants.length < MAX_VARIANTS) variants.push(value);
  };
  add(original);
  add(simplifiedToTraditional(original));
  const split = splitBilingual(original);
  if (split) {
    add(split.native);
    add(simplifiedToTraditional(split.native));
    // 不單獨用並列的英文名查：同名的別首歌太多，實測撞過「歌名＋時長」都吻合的錯配。
  }
  return variants;
}

// 歌手欄：每位歌手各自去掉並列的英文名。回傳 { native: 全部歌手, primary: 第一位 }。
function nativeArtists(artist) {
  const original = String(artist || '').trim();
  const names = original.split(ARTIST_SEPARATOR).map((name) => name.trim()).filter(Boolean)
    .map((name) => { const split = splitBilingual(name); return split ? split.native : name; });
  if (names.length === 0) return { native: original, primary: original };
  return { native: names.join(' '), primary: names[0] };
}

/**
 * 產生要依序嘗試的查詢組合（最多 MAX_VARIANTS 組），每組是 { artist, title }。
 * 順序：原樣 → 簡轉繁 → 歌手與歌名都只留原文 → 只留第一位歌手。
 */
function lyricQueryVariants(artist, title) {
  const originalArtist = String(artist || '').trim();
  const originalTitle = String(title || '').trim();
  const variants = [];
  const add = (candidateArtist, candidateTitle) => {
    const next = { artist: String(candidateArtist || '').trim(), title: String(candidateTitle || '').trim() };
    if (!next.title || variants.length >= MAX_VARIANTS) return;
    if (variants.some((item) => item.artist === next.artist && item.title === next.title)) return;
    variants.push(next);
  };
  add(originalArtist, originalTitle);
  add(originalArtist, simplifiedToTraditional(originalTitle));
  const split = splitBilingual(originalTitle);
  const nativeTitle = split ? split.native : originalTitle;
  const artists = nativeArtists(originalArtist);
  add(artists.native, nativeTitle);
  add(artists.native, simplifiedToTraditional(nativeTitle));
  add(artists.primary, nativeTitle);
  return variants;
}

// 比對一律轉成簡體再比：繁轉簡是多對一，不會像簡轉繁那樣把姓氏「范」猜成「範」而對不上。
const convertToSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });

// 比對用的正規化：全半形統一、小寫、轉簡體、去掉括號內容與所有標點空白。
function compareKey(text) {
  const base = String(text || '').normalize('NFKC').toLowerCase()
    .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '');
  return convertToSimplified(base).replace(/[^\p{L}\p{N}]/gu, '');
}

// 兩個字串是否只差一個字（換一個字、多一個字或少一個字）。
function withinOneEdit(left, right) {
  const a = Array.from(left);
  const b = Array.from(right);
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  let ea = a.length - 1;
  let eb = b.length - 1;
  while (ea >= i && eb >= i && a[ea] === b[eb]) { ea -= 1; eb -= 1; }
  return Math.max(ea - i + 1, eb - i + 1) <= 1;
}

/**
 * 搜尋結果的歌名是不是我們要找的那首。
 * 歌詞站的搜尋是模糊比對，查不到時會回一首不相干的歌；不檢查就會把別首歌的歌詞套上去。
 * 規則：要找的歌名（整串，以及並列時的原文那一半）與結果歌名正規化後，
 * 互相包含、或 4 個字以上只差一個字（「你／妳」「且／也」這類異體與筆誤）就算同一首。
 * 並列的英文名不拿來比（"I Love You" 這種太容易撞到別人的歌）；歌名本身只有英文時照常比。
 * 結果沒有歌名欄位時無從判斷，一律放行。
 */
function titleMatches(expectedTitle, candidateTitle) {
  const candidate = compareKey(candidateTitle);
  if (!candidate) return true;
  const original = String(expectedTitle || '').trim();
  const split = splitBilingual(original);
  const expected = [original, split && split.native].map(compareKey).filter(Boolean);
  if (expected.length === 0) return true;
  // 結果歌名剛好就是並列的那個英文名：多半是別人的同名英文歌，不算。
  if (split && candidate === compareKey(split.latin)) return false;
  return expected.some((key) => {
    if (key === candidate) return true;
    const [short, long] = key.length <= candidate.length ? [key, candidate] : [candidate, key];
    if (short.length >= 2 && long.includes(short)) return true;
    return Array.from(short).length >= 4 && withinOneEdit(key, candidate);
  });
}

// 搜尋結果的歌手是不是我們要找的其中一位（用來在同名歌曲之間優先挑對的人，不拿來否決）。
function artistMatches(expectedArtist, candidateArtist) {
  const candidate = compareKey(candidateArtist);
  if (!candidate) return false;
  const names = String(expectedArtist || '').split(ARTIST_SEPARATOR).map((name) => name.trim()).filter(Boolean);
  return names.some((name) => {
    const split = splitBilingual(name);
    return [name, split && split.native, split && split.latin].map(compareKey)
      .some((key) => key.length >= 2 && (candidate.includes(key) || key.includes(candidate)));
  });
}

module.exports = { lyricTitleVariants, lyricQueryVariants, splitBilingual, titleMatches, artistMatches };
