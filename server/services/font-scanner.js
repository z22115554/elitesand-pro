/**
 * 系統字體掃描器 — 解決「面板只列得出 ~179 個字體」的問題
 *
 * 背景：面板原本用瀏覽器的 Font Access API（window.queryLocalFonts）列字體，
 * 但它受權限與瀏覽器版本限制，且在部分 Windows 環境列不出「只安裝給目前使用者」
 * 的字體（放在 %LOCALAPPDATA%\Microsoft\Windows\Fonts 的那些），數量遠少於實際安裝量。
 *
 * 這裡改由伺服器直接掃描字體目錄、解析字型檔的 name table 取出家族名稱：
 *   - 系統字體：C:\Windows\Fonts
 *   - 使用者字體：%LOCALAPPDATA%\Microsoft\Windows\Fonts（商店/右鍵「為此使用者安裝」都放這）
 *   - macOS / Linux 目錄一併支援（開發/跨平台）
 *
 * 只讀每個檔案的表目錄 + name 表（幾 KB），不整檔載入，掃描一次後快取於記憶體。
 * 中文字體同時回傳中文與英文家族名（例如「微軟正黑體」與 "Microsoft JhengHei"），
 * 讓使用者搜哪個都找得到；CSS 兩種名稱皆可生效。
 */
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const FONT_EXTS = new Set(['.ttf', '.otf', '.ttc', '.otc']);

function fontDirs() {
  const dirs = [];
  if (process.platform === 'win32') {
    const winDir = process.env.WINDIR || 'C:\\Windows';
    dirs.push(path.join(winDir, 'Fonts'));
    if (process.env.LOCALAPPDATA) {
      dirs.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'));
    }
  } else if (process.platform === 'darwin') {
    dirs.push('/System/Library/Fonts', '/Library/Fonts', path.join(os.homedir(), 'Library', 'Fonts'));
  } else {
    dirs.push('/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.local', 'share', 'fonts'), path.join(os.homedir(), '.fonts'));
  }
  return dirs;
}

/** 遞迴列出目錄下所有字型檔（Linux 的 fonts 目錄常有子資料夾）。 */
async function listFontFiles(dir, depth = 0) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return []; }
  const out = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < 3) out.push(...await listFontFiles(p, depth + 1));
    } else if (FONT_EXTS.has(path.extname(e.name).toLowerCase())) {
      out.push(p);
    }
  }
  return out;
}

/** 從已開啟的檔案讀取指定範圍。 */
async function readAt(fd, offset, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fd.read(buf, 0, length, offset);
  return bytesRead === length ? buf : buf.subarray(0, bytesRead);
}

// name table 語言優先序（Windows platform 3）：繁中 > 簡中 > 英文
const LANG_PRIORITY = { 0x0404: 0, 0x0c04: 1, 0x0804: 2, 0x0409: 3 };

/**
 * 解析單一 sfnt 字型（base = 該字型在檔案內的起點），回傳家族名稱陣列（去重前）。
 * 只讀表目錄與 name 表，失敗回傳空陣列（壞檔/不支援格式一律靜默略過）。
 */
async function parseSfntNames(fd, base) {
  try {
    const head = await readAt(fd, base, 12);
    if (head.length < 12) return [];
    const numTables = head.readUInt16BE(4);
    if (numTables === 0 || numTables > 512) return [];
    const dir = await readAt(fd, base + 12, numTables * 16);
    let nameOff = -1, nameLen = 0;
    for (let i = 0; i < numTables; i++) {
      const o = i * 16;
      if (dir.toString('latin1', o, o + 4) === 'name') {
        nameOff = dir.readUInt32BE(o + 8);
        nameLen = dir.readUInt32BE(o + 12);
        break;
      }
    }
    if (nameOff < 0 || nameLen === 0 || nameLen > 262144) return [];
    const nt = await readAt(fd, nameOff, nameLen); // name 表 offset 以檔案開頭為準（TTC 亦然）
    if (nt.length < 6) return [];
    const count = nt.readUInt16BE(2);
    const strBase = nt.readUInt16BE(4);
    // 每個 nameID(1=家族, 16=印刷家族) 依語言優先序收集
    const byLang = new Map(); // langPriority -> name
    const extras = new Set();
    for (let i = 0; i < count; i++) {
      const r = 6 + i * 12;
      if (r + 12 > nt.length) break;
      const platformID = nt.readUInt16BE(r);
      const languageID = nt.readUInt16BE(r + 4);
      const nameID = nt.readUInt16BE(r + 6);
      const len = nt.readUInt16BE(r + 8);
      const off = nt.readUInt16BE(r + 10);
      if (nameID !== 1 && nameID !== 16) continue;
      const s = strBase + off;
      if (s + len > nt.length) continue;
      let name = '';
      if (platformID === 3 || platformID === 0) {
        // UTF-16BE（不用 swap16 就地反轉，避免動到共用 buffer / 奇數長度丟例外）
        for (let j = 0; j + 1 < len; j += 2) name += String.fromCharCode(nt.readUInt16BE(s + j));
      } else if (platformID === 1) {
        name = nt.subarray(s, s + len).toString('latin1');
      } else continue;
      name = name.replace(/\0/g, '').trim();
      if (!name) continue;
      const prio = (platformID === 3 && LANG_PRIORITY[languageID] != null) ? LANG_PRIORITY[languageID] : 9;
      // nameID 16（印刷家族）優先於 1：同語言下覆蓋
      const key = prio;
      if (nameID === 16 || !byLang.has(key)) byLang.set(key, name);
      extras.add(name);
    }
    if (!extras.size) return [];
    // 回傳：最優先的在地化名稱 + 英文名稱（若不同）——其餘變體不佔清單
    const sorted = [...byLang.keys()].sort((a, b) => a - b);
    const primary = byLang.get(sorted[0]);
    const en = byLang.get(3);
    const out = [primary];
    if (en && en !== primary) out.push(en);
    return out.filter(Boolean);
  } catch (_) {
    return [];
  }
}

/** 解析單一字型檔（含 .ttc 集合）。 */
async function parseFontFile(file) {
  let fd;
  try {
    fd = await fsp.open(file, 'r');
    const head = await readAt(fd, 0, 12);
    if (head.length < 12) return [];
    const tag = head.toString('latin1', 0, 4);
    if (tag === 'ttcf') {
      const numFonts = Math.min(head.readUInt32BE(8), 64);
      const offs = await readAt(fd, 12, numFonts * 4);
      const names = [];
      for (let i = 0; i < numFonts; i++) {
        names.push(...await parseSfntNames(fd, offs.readUInt32BE(i * 4)));
      }
      return names;
    }
    return await parseSfntNames(fd, 0);
  } catch (_) {
    return [];
  } finally {
    if (fd) await fd.close().catch(() => {});
  }
}

let cache = null; // { fonts: string[], scannedAt, fileCount }
let scanning = null;

/** 掃描所有字體目錄，回傳排序去重後的家族名稱清單（記憶體快取，refresh=true 重掃）。 */
async function listSystemFonts(refresh = false) {
  if (cache && !refresh) return cache;
  if (scanning) return scanning;
  scanning = (async () => {
    const files = [];
    for (const dir of fontDirs()) files.push(...await listFontFiles(dir));
    const seen = new Set();
    // 併發 16 檔一批，避免一次開太多檔案
    for (let i = 0; i < files.length; i += 16) {
      const batch = files.slice(i, i + 16);
      const results = await Promise.all(batch.map(parseFontFile));
      results.forEach((names) => names.forEach((n) => { if (n) seen.add(n); }));
    }
    const fonts = [...seen].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    cache = { fonts, scannedAt: Date.now(), fileCount: files.length };
    scanning = null;
    return cache;
  })();
  return scanning;
}

module.exports = { listSystemFonts };
