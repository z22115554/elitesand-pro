'use strict';
/**
 * 歌詞重洗（一次性背景遷移）
 *
 * 歌曲庫存的是「匯入當下」解析好的 parsedLyrics（含拼音、諧音、逐字），之後清洗規則變好，
 * 舊歌也不會自己變乾淨——要使用者一首首重抓。這裡在啟動後背景跑一次：用原始歌詞照現行
 * 規則重新解析，只有結果不同的歌才寫回。
 *
 * 不可弄丟的東西：
 *  - 只接受「純粹刪掉幾行」：留下的每一行都沿用原本的物件（拼音、諧音、振假名、逐字原封不動）。
 *  - 有手動諧音（xieyinManual）的歌、使用者自己貼上／上傳的歌詞（source 'manual'），整首不碰。
 *  - 新結果比原本多行、砍掉超過七成、或任何一行對不上，視為異常不套用。
 *
 * 兩份都要洗：歌曲庫的 parsedLyrics，以及 state 裡「歌詞選擇器／換來源」選定的那份（manualLyricsCache）。
 * 後者播放時優先、還會寫回歌曲庫——只洗歌曲庫的話，第一次播放就被舊的蓋回去（还痛吗 實測）。
 *
 * 做完寫標記檔；清洗規則再有大改時把 RECLEAN_VERSION 換掉就會再跑一次。
 */
const fs = require('fs');
const path = require('path');

// 11-23：加洗 manualLyricsCache；版本換掉讓 11-21 已跑過的人再跑一次
const RECLEAN_VERSION = 'credits-2026-11-23';
const SUPPORTED_TYPES = new Set(['krc', 'lrc']);

const lineKey = (line) => `${line && line.time}|${line && line.text}`;

function hasManualXieyin(lines) {
  return lines.some((line) => line && (line.xieyinManual || (Array.isArray(line.words) && line.words.some((w) => w && w.xieyinManual))));
}

/**
 * 算出重洗後的歌詞；不需要（或不該）改就回 null。純函式，不碰檔案。
 * @returns {Array | null}
 */
function planReclean(stored, raw, type, parse) {
  if (!Array.isArray(stored) || stored.length === 0) return null;
  if (typeof raw !== 'string' || !raw.trim() || !SUPPORTED_TYPES.has(type)) return null;
  if (hasManualXieyin(stored)) return null;
  let parsed;
  try { parsed = parse(raw, type); } catch (_) { return null; }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  if (parsed.length === stored.length && parsed.every((line, i) => lineKey(line) === lineKey(stored[i]))) return null;
  if (parsed.length > stored.length || parsed.length < Math.max(3, Math.ceil(stored.length * 0.3))) return null;

  // 只接受「純粹刪掉幾行」：新結果每一行都要依序對得上原本的某一行（時間＋文字一字不差）。
  // 重解析存檔裡的原始歌詞不一定跟匯入當下一樣準（實測 73 首的 TTML 聲部代號 a／both
  // 會黏在句首），所以只要有任何一行對不上就整首不碰，寧可留給使用者重抓。
  const lines = [];
  let s = 0;
  for (const line of parsed) {
    while (s < stored.length && lineKey(stored[s]) !== lineKey(line)) s++;
    if (s >= stored.length) return null;
    const kept = stored[s++];
    // 聲部以新解析為準：舊結果可能把殘留名單的「Piano：」當成演唱者掛在正文上
    if (kept.singer === line.singer && kept.singerLabel === line.singerLabel) { lines.push(kept); continue; }
    const merged = { ...kept };
    delete merged.singer; delete merged.singerLabel;
    if (line.singer !== undefined) merged.singer = line.singer;
    if (line.singerLabel !== undefined) merged.singerLabel = line.singerLabel;
    lines.push(merged);
  }
  return lines;
}

const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

/**
 * 掃整個歌曲庫。每 10 首讓出一次事件迴圈，不卡住啟動中的直播。
 * @returns {Promise<string[]>} 實際改寫的歌曲 id
 */
async function recleanLibrary({ libraryStore, parse, onUpdated, log, markerFile, manual = null }) {
  if (markerFile) {
    try {
      if (JSON.parse(fs.readFileSync(markerFile, 'utf8')).version === RECLEAN_VERSION) return [];
    } catch (_) { /* 沒有標記＝還沒做過 */ }
  }
  const ids = libraryStore.getLibrary().map((entry) => entry && entry.id).filter(Boolean);
  const changed = [];
  for (let n = 0; n < ids.length; n++) {
    if (n % 10 === 9) await yieldToEventLoop();
    const id = ids[n];
    try {
      const entry = libraryStore.getEntry(id);
      if (!entry || entry.manualLyrics) continue;
      const lines = planReclean(entry.parsedLyrics, entry.lyrics, entry.lyricsType, parse);
      if (!lines) continue;
      libraryStore.updateMeta(id, { parsedLyrics: lines });
      changed.push(id);
      log?.info?.(`歌詞重洗：${entry.title || id}（${entry.parsedLyrics.length} → ${lines.length} 行）`);
      try { onUpdated?.(id, lines); } catch (e) { log?.warn?.(`重洗同步播放清單失敗：${e.message}`); }
    } catch (e) {
      log?.warn?.(`歌詞重洗跳過 ${id}：${e.message}`);
    }
  }
  // 歌詞選擇器／換來源選定的那份。使用者自己貼上／上傳的（source 'manual'）不碰。
  const manualEntries = manual && typeof manual.list === 'function' ? manual.list() : [];
  for (let n = 0; n < manualEntries.length; n++) {
    if (n % 10 === 9) await yieldToEventLoop();
    const entry = manualEntries[n];
    try {
      if (!entry || !entry.id || entry.source === 'manual') continue;
      const lines = planReclean(entry.parsedLyrics, entry.lyrics, entry.lyricsType, parse);
      if (!lines || !manual.replace(entry.id, lines)) continue;
      if (!changed.includes(entry.id)) changed.push(entry.id);
      log?.info?.(`歌詞重洗（選定的歌詞）：${entry.id}（${entry.parsedLyrics.length} → ${lines.length} 行）`);
      try { onUpdated?.(entry.id, lines); } catch (e) { log?.warn?.(`重洗同步播放清單失敗：${e.message}`); }
    } catch (e) {
      log?.warn?.(`歌詞重洗跳過選定歌詞 ${entry && entry.id}：${e.message}`);
    }
  }
  if (markerFile) {
    try {
      fs.mkdirSync(path.dirname(markerFile), { recursive: true });
      fs.writeFileSync(markerFile, JSON.stringify({ version: RECLEAN_VERSION, changed: changed.length, at: new Date().toISOString() }));
    } catch (e) { log?.warn?.(`歌詞重洗標記寫入失敗：${e.message}`); }
  }
  return changed;
}

module.exports = { planReclean, recleanLibrary, RECLEAN_VERSION };
