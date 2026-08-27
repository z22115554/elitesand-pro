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
const crypto = require('crypto');

const FONT_EXTS = new Set(['.ttf', '.otf', '.ttc', '.otc']);
const MAX_FONT_ASSET_BYTES = 64 * 1024 * 1024;

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
 * 解析單一 sfnt 字型（base = 該字型在檔案內的起點）。
 * 只讀表目錄與 name 表，失敗回傳 null（壞檔/不支援格式一律靜默略過）。
 *
 * 回傳 { displayNames, aliasGroup, weight, style }：
 * - displayNames：要放進下拉選單、使用者看得到／選得到的名稱（在地化名稱 + 英文名稱，若不同）。
 * - aliasGroup：套用 CSS font-family 時「同一款字」實際可以拿去比對的所有候選名稱。
 *
 * 2026-08-24 修正：原本 nameID 16（印刷家族）同語言下會直接蓋掉 nameID 1（相容家族），
 * 只留一個名稱給前端當 CSS 值——但作業系統／瀏覽器實際拿去比對已安裝字型的名稱，不保證
 * 跟我們選的那一個一致（使用者實測：「辰宇落雁體 2.0」這款字被退回預設字體，很可能是
 * nameID 1 跟 16 其中一個對得上系統註冊的名稱、另一個對不上，我們卻只留了對不上的那個）。
 * 改成兩個名稱都保留成候選，套用時組成 CSS 候選清單，只要其中一個系統認得就會生效，
 * 不用賭我們選對哪一個。
 */
async function parseSfntNames(fd, base) {
  try {
    const head = await readAt(fd, base, 12);
    if (head.length < 12) return null;
    const numTables = head.readUInt16BE(4);
    if (numTables === 0 || numTables > 512) return null;
    const dir = await readAt(fd, base + 12, numTables * 16);
    let nameOff = -1, nameLen = 0, os2Off = -1, os2Len = 0, headOff = -1, headLen = 0;
    for (let i = 0; i < numTables; i++) {
      const o = i * 16;
      if (dir.toString('latin1', o, o + 4) === 'name') {
        nameOff = dir.readUInt32BE(o + 8);
        nameLen = dir.readUInt32BE(o + 12);
      } else if (dir.toString('latin1', o, o + 4) === 'OS/2') {
        os2Off = dir.readUInt32BE(o + 8);
        os2Len = dir.readUInt32BE(o + 12);
      } else if (dir.toString('latin1', o, o + 4) === 'head') {
        headOff = dir.readUInt32BE(o + 8);
        headLen = dir.readUInt32BE(o + 12);
      }
    }
    if (nameOff < 0 || nameLen === 0 || nameLen > 262144) return null;
    const nt = await readAt(fd, nameOff, nameLen); // name 表 offset 以檔案開頭為準（TTC 亦然）
    if (nt.length < 6) return null;
    const count = nt.readUInt16BE(2);
    const strBase = nt.readUInt16BE(4);
    // 每個 nameID(1=相容家族, 16=印刷家族) 依語言優先序分開收集，兩者都要保留。
    const byLangName1 = new Map(); // langPriority -> name (nameID 1)
    const byLangName16 = new Map(); // langPriority -> name (nameID 16)
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
      const target = nameID === 16 ? byLangName16 : byLangName1;
      if (!target.has(prio)) target.set(prio, name);
    }
    if (!byLangName1.size && !byLangName16.size) return null;
    const prios = [...new Set([...byLangName1.keys(), ...byLangName16.keys()])].sort((a, b) => a - b);
    const bestPrio = prios[0];
    const localized16 = byLangName16.get(bestPrio);
    const localized1 = byLangName1.get(bestPrio);
    // 顯示名稱維持原本偏好（印刷家族優先，較接近使用者對「這款字」的認知）。
    const primary = localized16 || localized1;
    const enName = byLangName16.get(3) || byLangName1.get(3);
    const aliasGroup = [...new Set([localized16, localized1, enName].filter(Boolean))];
    const displayNames = [primary];
    if (enName && enName !== primary) displayNames.push(enName);
    // OS/2.usWeightClass 是 OpenType 的標準字重欄位；讀不到時保守當作 normal。
    let weight = 400;
    if (os2Off >= 0 && os2Len >= 6) {
      const os2 = await readAt(fd, os2Off, 6);
      if (os2.length >= 6) {
        const parsed = os2.readUInt16BE(4);
        if (parsed >= 1 && parsed <= 1000) weight = parsed;
      }
    }
    // head.macStyle bit 1 代表 italic。沒有 head 時仍可安全當 normal 載入。
    let style = 'normal';
    if (headOff >= 0 && headLen >= 46) {
      const headTable = await readAt(fd, headOff + 44, 2);
      if (headTable.length === 2 && (headTable.readUInt16BE(0) & 0x0002)) style = 'italic';
    }
    return { displayNames: displayNames.filter(Boolean), aliasGroup, weight, style };
  } catch (_) {
    return null;
  }
}

/** 解析單一字型檔（含 .ttc 集合），回傳字型 face 陣列（一個子字型一筆）。 */
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
      const entries = [];
      for (let i = 0; i < numFonts; i++) {
        const entry = await parseSfntNames(fd, offs.readUInt32BE(i * 4));
        if (entry) entries.push({ ...entry, faceIndex: i });
      }
      return entries;
    }
    const entry = await parseSfntNames(fd, 0);
    return entry ? [{ ...entry, faceIndex: 0 }] : [];
  } catch (_) {
    return [];
  } finally {
    if (fd) await fd.close().catch(() => {});
  }
}

let cache = null; // public fields + assetsById: Map（只留在伺服器）
let scanning = null;

function opaqueId(parts) {
  return crypto.createHash('sha256').update(parts.join('\0')).digest('base64url').slice(0, 22);
}

function fontFormat(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.ttf') return 'truetype';
  if (ext === '.otf') return 'opentype';
  return 'collection';
}

/**
 * 掃描所有字體目錄，回傳排序去重後的家族名稱清單（記憶體快取，refresh=true 重掃）。
 * `aliases[displayName]` 是同一款字所有可用於 CSS font-family 比對的候選名稱（含自己），
 * 前端套用字型時要把整組候選都放進 font-family 堆疊，不能只用使用者選到的那一個名稱
 * ——見 parseSfntNames() 開頭註解，nameID 1/16 哪個能被系統認得因字型而異。
 */
async function listSystemFonts(refresh = false) {
  if (cache && !refresh) return cache;
  if (scanning) return scanning;
  scanning = (async () => {
    const files = [];
    for (const dir of fontDirs()) files.push(...await listFontFiles(dir));
    const aliasesByName = new Map(); // displayName -> Set(候選名稱)
    const facesByName = new Map(); // displayName -> Map(faceId, private face record)
    // 併發 16 檔一批，避免一次開太多檔案
    for (let i = 0; i < files.length; i += 16) {
      const batch = files.slice(i, i + 16);
      const results = await Promise.all(batch.map(parseFontFile));
      results.forEach((entries, batchIndex) => entries.forEach(({ displayNames, aliasGroup, faceIndex, weight, style }) => {
        const file = batch[batchIndex];
        const face = {
          id: opaqueId([path.resolve(file).toLowerCase(), String(faceIndex)]),
          file,
          faceIndex,
          format: fontFormat(file),
          weight,
          style,
        };
        displayNames.forEach((name) => {
          if (!name) return;
          let set = aliasesByName.get(name);
          if (!set) { set = new Set(); aliasesByName.set(name, set); }
          aliasGroup.forEach((alias) => set.add(alias));
          let faces = facesByName.get(name);
          if (!faces) { faces = new Map(); facesByName.set(name, faces); }
          faces.set(face.id, face);
        });
      }));
    }
    const fonts = [...aliasesByName.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    const aliases = {};
    for (const [name, set] of aliasesByName) aliases[name] = [...set];
    const assets = {};
    const assetsById = new Map();
    for (const [name, faceMap] of facesByName) {
      const faces = [...faceMap.values()].sort((a, b) => a.weight - b.weight || a.style.localeCompare(b.style));
      const id = opaqueId([name, ...faces.map((face) => face.id)]);
      const asset = { id, label: name, faces };
      assets[name] = { id, label: name };
      assetsById.set(id, asset);
    }
    cache = { fonts, aliases, assets, assetsById, scannedAt: Date.now(), fileCount: files.length };
    scanning = null;
    return cache;
  })();
  return scanning;
}

async function getFontAsset(assetId) {
  if (typeof assetId !== 'string' || !/^[A-Za-z0-9_-]{16,32}$/.test(assetId)) return null;
  const result = await listSystemFonts();
  return result.assetsById.get(assetId) || null;
}

function isWithinRoot(file, root) {
  const relative = path.relative(root, file);
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

/**
 * 只允許掃描器先前在受管字型目錄發現的檔案。realpath 再做一次邊界驗證，
 * 即使日後目錄出現 junction/symlink，也不能把任意檔案變成可下載資源。
 */
async function resolveFontAssetFace(assetId, faceId) {
  const asset = await getFontAsset(assetId);
  const face = asset && asset.faces.find((entry) => entry.id === faceId);
  if (!face) return null;
  try {
    const [realFile, roots] = await Promise.all([
      fsp.realpath(face.file),
      Promise.all(fontDirs().map((dir) => fsp.realpath(dir).catch(() => null))),
    ]);
    if (!roots.filter(Boolean).some((root) => isWithinRoot(realFile, root))) return null;
    const stat = await fsp.stat(realFile);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_FONT_ASSET_BYTES) return null;
    return { ...face, file: realFile, size: stat.size };
  } catch (_) {
    return null;
  }
}

module.exports = { listSystemFonts, getFontAsset, resolveFontAssetFace };
