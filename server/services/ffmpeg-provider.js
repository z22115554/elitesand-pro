/**
 * FFmpeg 解析與按需下載（CLOSED_SOURCE_MIGRATION_PLAN.md 批次 D-1）
 *
 * Installer 不再預設內附 ffmpeg.exe/ffprobe.exe（GPLv3、對應原始碼義務太重，
 * 詳見 D-1 決策）。改成：使用者需要時按一次「下載」，由這支模組直接向上游抓檔、
 * 驗證雜湊，成功才能用；不下載也不會讓程式無法啟動，只有依賴 FFmpeg 的功能受影響。
 *
 * 下載來源：gyan.dev 的「release-essentials」穩定連結，這是 ffmpeg.org 官方下載頁
 * 為 Windows 導引的第三方建置專案，不是自建鏡像。zip 與 sha256 走同一個可信任
 * 來源（HTTPS www.gyan.dev），下載後立刻比對，雜湊不符一律拒絕使用該檔案。
 *
 * 找 ffmpeg 的優先序：
 * 1. 使用者在 server/config.js 指定的 ffmpegPath
 * 2. 先前透過這支模組下載、快取在 dataDir/bin/ 的副本
 * 3. 系統 PATH（含 tools/ 目錄——portable 啟動器會把它加進 PATH）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { spawnSync } = require('child_process');
const AdmZip = require('adm-zip');
const { dataDir } = require('../utils/app-paths');
const config = require('../utils/load-config');
const { createLogger } = require('../utils/logger');

const log = createLogger('FFmpegProvider');

const BIN_DIR = path.join(dataDir, 'bin');
const FFMPEG_EXE = path.join(BIN_DIR, 'ffmpeg.exe');
const FFPROBE_EXE = path.join(BIN_DIR, 'ffprobe.exe');

const DOWNLOAD_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
const CHECKSUM_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256';
const MAX_ZIP_BYTES = 300 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function isWindows() {
  return process.platform === 'win32';
}

function commandExistsOnPath(command) {
  try {
    const finder = isWindows() ? 'where' : 'which';
    const result = spawnSync(finder, [command], { windowsHide: true, timeout: 2000 });
    return result.status === 0;
  } catch (_) {
    return false;
  }
}

/** 依優先序解析目前實際可用的 ffmpeg/ffprobe 路徑；都找不到回傳 null。 */
function resolveFfmpegPaths() {
  if (config.ffmpegPath && fs.existsSync(config.ffmpegPath)) {
    const dir = path.dirname(config.ffmpegPath);
    const probeName = isWindows() ? 'ffprobe.exe' : 'ffprobe';
    const ffprobeCandidate = path.join(dir, probeName);
    return {
      source: 'config',
      ffmpeg: config.ffmpegPath,
      ffprobe: fs.existsSync(ffprobeCandidate) ? ffprobeCandidate : 'ffprobe',
    };
  }
  if (fs.existsSync(FFMPEG_EXE)) {
    return {
      source: 'downloaded',
      ffmpeg: FFMPEG_EXE,
      ffprobe: fs.existsSync(FFPROBE_EXE) ? FFPROBE_EXE : 'ffprobe',
    };
  }
  if (commandExistsOnPath('ffmpeg')) {
    return { source: 'system', ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };
  }
  return null;
}

/** 給 spawn() 用的 ffmpeg 路徑；找不到時回傳裸指令 'ffmpeg'，讓呼叫端維持既有的失敗處理。 */
function getFfmpegPath() {
  return resolveFfmpegPaths()?.ffmpeg || 'ffmpeg';
}

function getFfprobePath() {
  return resolveFfmpegPaths()?.ffprobe || 'ffprobe';
}

function isAvailable() {
  return resolveFfmpegPaths() !== null;
}

function fetchToBuffer(url, { maxBytes, redirectsLeft = MAX_REDIRECTS } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'Elitesand-Pro-FFmpeg-Provider' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) { reject(new Error('重新導向次數過多')); return; }
        fetchToBuffer(res.headers.location, { maxBytes, redirectsLeft: redirectsLeft - 1 }).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`下載失敗，HTTP ${res.statusCode}: ${url}`));
        return;
      }
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (maxBytes && total > maxBytes) {
          res.destroy();
          reject(new Error('下載內容超過預期大小上限，已中止'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(30000, () => request.destroy(new Error('下載逾時')));
  });
}

// gyan.dev essentials 建置的慣例結構是 `ffmpeg-<version>-essentials_build/bin/ffmpeg.exe`
// （資料夾名稱含版本號，因此不能寫死；只認 .../bin/ffmpeg.exe 這個尾端）。
// 抽成獨立函式方便用合成的 zip entries 測試，不必真的下載 100MB 才能驗證這段邏輯。
function findFfmpegEntries(entries) {
  return {
    ffmpegEntry: entries.find((e) => /(^|\/)bin\/ffmpeg\.exe$/i.test(e.entryName)),
    ffprobeEntry: entries.find((e) => /(^|\/)bin\/ffprobe\.exe$/i.test(e.entryName)),
  };
}

let downloadInFlight = null;

/**
 * 下載並驗證 FFmpeg（會拋出例外，呼叫端負責轉成使用者看得懂的錯誤訊息）。
 * 多次呼叫共用同一個進行中的下載，不會並發抓兩份。
 */
async function downloadFfmpeg({ onProgress } = {}) {
  if (!isWindows()) {
    throw new Error('目前只支援 Windows 的自動下載；其他平台請自行安裝 FFmpeg 並在 config.js 指定 ffmpegPath。');
  }
  if (downloadInFlight) return downloadInFlight;

  downloadInFlight = (async () => {
    onProgress?.({ stage: 'checksum' });
    const checksumBuf = await fetchToBuffer(CHECKSUM_URL, { maxBytes: 4096 });
    const expectedHash = checksumBuf.toString('utf8').trim().toLowerCase().split(/\s+/)[0];
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
      throw new Error('取得的雜湊格式不正確，拒絕繼續下載（可能是上游頁面格式變了，需要更新這支程式）');
    }

    onProgress?.({ stage: 'download' });
    const zipBuf = await fetchToBuffer(DOWNLOAD_URL, { maxBytes: MAX_ZIP_BYTES });

    onProgress?.({ stage: 'verify' });
    const actualHash = crypto.createHash('sha256').update(zipBuf).digest('hex');
    if (actualHash !== expectedHash) {
      throw new Error(`SHA-256 驗證失敗（預期 ${expectedHash.slice(0, 12)}…，實際 ${actualHash.slice(0, 12)}…），已拒絕使用此下載`);
    }

    onProgress?.({ stage: 'extract' });
    const zip = new AdmZip(zipBuf);
    const { ffmpegEntry, ffprobeEntry } = findFfmpegEntries(zip.getEntries());
    if (!ffmpegEntry || !ffprobeEntry) {
      throw new Error('下載的壓縮檔內找不到 ffmpeg.exe / ffprobe.exe，上游打包結構可能變了');
    }

    fs.mkdirSync(BIN_DIR, { recursive: true });
    const tmpFfmpeg = `${FFMPEG_EXE}.download`;
    const tmpFfprobe = `${FFPROBE_EXE}.download`;
    fs.writeFileSync(tmpFfmpeg, ffmpegEntry.getData());
    fs.writeFileSync(tmpFfprobe, ffprobeEntry.getData());
    fs.renameSync(tmpFfmpeg, FFMPEG_EXE);
    fs.renameSync(tmpFfprobe, FFPROBE_EXE);

    onProgress?.({ stage: 'done' });
    log.info(`FFmpeg 下載完成並通過 SHA-256 驗證：${FFMPEG_EXE}`);
    return { ok: true, ffmpeg: FFMPEG_EXE, ffprobe: FFPROBE_EXE, sha256: actualHash };
  })();

  try {
    return await downloadInFlight;
  } finally {
    downloadInFlight = null;
  }
}

function resetForTests() {
  downloadInFlight = null;
}

module.exports = {
  resolveFfmpegPaths,
  getFfmpegPath,
  getFfprobePath,
  isAvailable,
  downloadFfmpeg,
  commandExistsOnPath,
  findFfmpegEntries,
  DOWNLOAD_URL,
  CHECKSUM_URL,
  BIN_DIR,
  FFMPEG_EXE,
  FFPROBE_EXE,
  _resetForTests: resetForTests,
};
