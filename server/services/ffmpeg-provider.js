/**
 * FFmpeg 解析與按需下載（CLOSED_SOURCE_MIGRATION_PLAN.md 批次 D-1）
 *
 * Installer 不再預設內附 ffmpeg.exe/ffprobe.exe（GPLv3、對應原始碼義務太重，
 * 詳見 D-1 決策）。改成：使用者需要時按一次「下載」，由這支模組直接向上游抓檔、
 * 驗證雜湊，成功才能用；不下載也不會讓程式無法啟動，只有依賴 FFmpeg 的功能受影響。
 *
 * 下載來源：優先使用 ffmpeg.org 官方下載頁列出的 BtbN Windows build（LGPL），
 * gyan.dev release-essentials 作為備援。兩邊都先取得上游提供的 SHA-256，再串流
 * 下載到暫存 zip；不把 100MB+ 壓縮檔整包留在 RAM。雜湊不符一律拒絕使用。
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
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { spawnSync } = require('child_process');
const AdmZip = require('adm-zip');
const { dataDir } = require('../utils/app-paths');
const config = require('../utils/load-config');
const { createLogger } = require('../utils/logger');

const log = createLogger('FFmpegProvider');

const BIN_DIR = path.join(dataDir, 'bin');
const FFMPEG_EXE = path.join(BIN_DIR, 'ffmpeg.exe');
const FFPROBE_EXE = path.join(BIN_DIR, 'ffprobe.exe');

const DOWNLOAD_SOURCES = [
  {
    id: 'btbn',
    label: 'BtbN / GitHub',
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip',
    checksumUrl: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/checksums.sha256',
    checksumFile: 'ffmpeg-master-latest-win64-lgpl.zip',
  },
  {
    id: 'gyan',
    label: 'gyan.dev',
    url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    checksumUrl: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256',
    checksumFile: null,
  },
];
const DOWNLOAD_URL = DOWNLOAD_SOURCES[0].url;
const CHECKSUM_URL = DOWNLOAD_SOURCES[0].checksumUrl;
const MAX_ZIP_BYTES = 300 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const DOWNLOAD_TOTAL_TIMEOUT_MS = 10 * 60 * 1000;
const DOWNLOAD_IDLE_TIMEOUT_MS = 30 * 1000;

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

function commandRuns(command, args = ['-version'], { spawnSyncImpl = spawnSync, timeout = 5000 } = {}) {
  try {
    const result = spawnSyncImpl(command, args, {
      windowsHide: true,
      timeout,
      encoding: 'utf8',
    });
    return !!result && !result.error && result.status === 0;
  } catch (_) {
    return false;
  }
}

/**
 * FFmpeg 在本專案不是「檔案存在」就算可用：ffmpeg 與 ffprobe 都必須真的能執行。
 * 這個檢查主要用在下載/修復入口，避免半套安裝永久卡在 alreadyAvailable。
 */
function validateFfmpegPair(paths, options = {}) {
  if (!paths?.ffmpeg || !paths?.ffprobe) {
    return { ok: false, ffmpegOk: false, ffprobeOk: false };
  }
  const ffmpegOk = commandRuns(paths.ffmpeg, ['-version'], options);
  const ffprobeOk = commandRuns(paths.ffprobe, ['-version'], options);
  return { ok: ffmpegOk && ffprobeOk, ffmpegOk, ffprobeOk };
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
  if (fs.existsSync(FFMPEG_EXE) && fs.existsSync(FFPROBE_EXE)) {
    return {
      source: 'downloaded',
      ffmpeg: FFMPEG_EXE,
      ffprobe: FFPROBE_EXE,
    };
  }
  if (commandExistsOnPath('ffmpeg') && commandExistsOnPath('ffprobe')) {
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
  const resolved = resolveFfmpegPaths();
  return !!resolved && validateFfmpegPair(resolved).ok;
}

function hasDownloadedPair() {
  return fs.existsSync(FFMPEG_EXE) && fs.existsSync(FFPROBE_EXE);
}

function fetchToBuffer(url, { maxBytes, redirectsLeft = MAX_REDIRECTS } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'Elitesand-Pro-FFmpeg-Provider' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) { reject(new Error('重新導向次數過多')); return; }
        const redirectUrl = new URL(res.headers.location, url).toString();
        fetchToBuffer(redirectUrl, { maxBytes, redirectsLeft: redirectsLeft - 1 }).then(resolve, reject);
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

function parseExpectedHash(source, checksumBuf) {
  const text = checksumBuf.toString('utf8').trim();
  if (!source?.checksumFile) {
    const hash = text.toLowerCase().split(/\s+/)[0];
    return /^[a-f0-9]{64}$/.test(hash) ? hash : null;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line);
    if (!match) continue;
    if (match[2].trim() === source.checksumFile) return match[1].toLowerCase();
  }
  return null;
}

function fetchToFile(url, filePath, {
  maxBytes,
  redirectsLeft = MAX_REDIRECTS,
  deadline = Date.now() + DOWNLOAD_TOTAL_TIMEOUT_MS,
  idleTimeoutMs = DOWNLOAD_IDLE_TIMEOUT_MS,
  onProgress,
} = {}) {
  return new Promise((resolve, reject) => {
    let response = null;
    let settled = false;
    const remainingMs = Math.max(1, deadline - Date.now());
    const totalTimer = setTimeout(() => {
      const error = new Error('下載總時間超過 10 分鐘，已中止並嘗試其他來源');
      response?.destroy(error);
      request.destroy(error);
    }, remainingMs);

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      fn(value);
    };

    const request = https.get(url, { headers: { 'User-Agent': 'Elitesand-Pro-FFmpeg-Provider' } }, async (res) => {
      response = res;
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          finish(reject, new Error('重新導向次數過多'));
          return;
        }
        clearTimeout(totalTimer);
        const redirectUrl = new URL(res.headers.location, url).toString();
        fetchToFile(redirectUrl, filePath, {
          maxBytes,
          redirectsLeft: redirectsLeft - 1,
          deadline,
          idleTimeoutMs,
          onProgress,
        }).then(resolve, reject);
        settled = true;
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        finish(reject, new Error(`下載失敗，HTTP ${res.statusCode}: ${url}`));
        return;
      }

      const contentLength = Number.parseInt(res.headers['content-length'] || '', 10);
      const totalBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;
      if (maxBytes && totalBytes && totalBytes > maxBytes) {
        res.destroy();
        finish(reject, new Error('下載內容超過預期大小上限，已中止'));
        return;
      }

      let downloadedBytes = 0;
      const startedAt = Date.now();
      const hash = crypto.createHash('sha256');
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          downloadedBytes += chunk.length;
          if (maxBytes && downloadedBytes > maxBytes) {
            callback(new Error('下載內容超過預期大小上限，已中止'));
            return;
          }
          hash.update(chunk);
          const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
          onProgress?.({
            downloadedBytes,
            totalBytes,
            percent: totalBytes ? Math.min(100, (downloadedBytes / totalBytes) * 100) : null,
            speedBytesPerSec: downloadedBytes / elapsedSeconds,
          });
          callback(null, chunk);
        },
      });

      try {
        await pipeline(res, meter, fs.createWriteStream(filePath, { flags: 'w' }));
        finish(resolve, {
          downloadedBytes,
          totalBytes,
          sha256: hash.digest('hex'),
        });
      } catch (error) {
        finish(reject, error);
      }
    });

    request.on('error', (error) => finish(reject, error));
    request.setTimeout(idleTimeoutMs, () => request.destroy(new Error('下載連線 30 秒沒有收到資料，已中止')));
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
let downloadStatus = {
  active: false,
  stage: 'idle',
  source: null,
  downloadedBytes: 0,
  totalBytes: null,
  percent: null,
  speedBytesPerSec: null,
  startedAt: null,
  updatedAt: null,
  error: null,
};

function setDownloadStatus(patch) {
  downloadStatus = {
    ...downloadStatus,
    ...patch,
    updatedAt: Date.now(),
  };
}

function getDownloadStatus() {
  return { ...downloadStatus };
}

function safeRemove(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch (_) {}
}

function recoverStalePairBackups(backupFfmpeg, backupFfprobe) {
  const hasFfmpegBackup = fs.existsSync(backupFfmpeg);
  const hasFfprobeBackup = fs.existsSync(backupFfprobe);
  if (!hasFfmpegBackup && !hasFfprobeBackup) return;

  // .previous 代表上一次替換交易沒有正常 commit。必須把「整組」恢復到交易前狀態；
  // 若某一邊沒有 backup，代表交易前本來就沒有那個檔案，因此移除可能留下的新半套檔。
  safeRemove(FFMPEG_EXE);
  safeRemove(FFPROBE_EXE);
  if (hasFfmpegBackup) fs.renameSync(backupFfmpeg, FFMPEG_EXE);
  if (hasFfprobeBackup) fs.renameSync(backupFfprobe, FFPROBE_EXE);
}

/**
 * 把已驗證過的暫存 pair 換成正式檔案。舊檔先移到 .previous；呼叫端完成正式路徑
 * 的二次驗證後再 commit。若中途任何一步失敗，可 rollback 回原版本。
 */
function beginPairInstall(tmpFfmpeg, tmpFfprobe) {
  const backupFfmpeg = `${FFMPEG_EXE}.previous`;
  const backupFfprobe = `${FFPROBE_EXE}.previous`;
  recoverStalePairBackups(backupFfmpeg, backupFfprobe);

  const hadFfmpeg = fs.existsSync(FFMPEG_EXE);
  const hadFfprobe = fs.existsSync(FFPROBE_EXE);
  let installedFfmpeg = false;
  let installedFfprobe = false;

  const rollback = () => {
    if (installedFfmpeg) safeRemove(FFMPEG_EXE);
    if (installedFfprobe) safeRemove(FFPROBE_EXE);
    if (hadFfmpeg && fs.existsSync(backupFfmpeg) && !fs.existsSync(FFMPEG_EXE)) {
      fs.renameSync(backupFfmpeg, FFMPEG_EXE);
    }
    if (hadFfprobe && fs.existsSync(backupFfprobe) && !fs.existsSync(FFPROBE_EXE)) {
      fs.renameSync(backupFfprobe, FFPROBE_EXE);
    }
  };

  try {
    if (hadFfmpeg) fs.renameSync(FFMPEG_EXE, backupFfmpeg);
    if (hadFfprobe) fs.renameSync(FFPROBE_EXE, backupFfprobe);
    fs.renameSync(tmpFfmpeg, FFMPEG_EXE);
    installedFfmpeg = true;
    fs.renameSync(tmpFfprobe, FFPROBE_EXE);
    installedFfprobe = true;
  } catch (err) {
    try { rollback(); } catch (rollbackErr) {
      log.error('FFmpeg 安裝失敗後回滾也失敗', rollbackErr);
    }
    throw err;
  }

  return {
    commit() {
      safeRemove(backupFfmpeg);
      safeRemove(backupFfprobe);
    },
    rollback,
  };
}

/**
 * 下載並驗證 FFmpeg（會拋出例外，呼叫端負責轉成使用者看得懂的錯誤訊息）。
 * 多次呼叫共用同一個進行中的下載，不會並發抓兩份。
 */
async function downloadFfmpeg({
  onProgress,
  fetchBufferImpl = fetchToBuffer,
  fetchFileImpl = fetchToFile,
  spawnSyncImpl = spawnSync,
  platform = process.platform,
  sources = DOWNLOAD_SOURCES,
} = {}) {
  if (platform !== 'win32') {
    throw new Error('目前只支援 Windows 的自動下載；其他平台請自行安裝 FFmpeg 並在 config.js 指定 ffmpegPath。');
  }
  if (downloadInFlight) return downloadInFlight;

  downloadInFlight = (async () => {
    const tmpZip = path.join(BIN_DIR, 'ffmpeg.download.zip');
    const tmpFfmpeg = path.join(BIN_DIR, 'ffmpeg.download.exe');
    const tmpFfprobe = path.join(BIN_DIR, 'ffprobe.download.exe');
    let stage = 'start';
    let transaction = null;
    let actualHash = null;
    let selectedSource = null;
    const progress = (nextStage, extra = {}) => {
      stage = nextStage;
      setDownloadStatus({ active: nextStage !== 'done', stage: nextStage, error: null, ...extra });
      log.info(`FFmpeg 下載階段：${nextStage}`);
      onProgress?.(getDownloadStatus());
    };

    try {
      fs.mkdirSync(BIN_DIR, { recursive: true });
      safeRemove(tmpZip);
      safeRemove(tmpFfmpeg);
      safeRemove(tmpFfprobe);

      setDownloadStatus({
        active: true,
        stage: 'start',
        source: null,
        downloadedBytes: 0,
        totalBytes: null,
        percent: null,
        speedBytesPerSec: null,
        startedAt: Date.now(),
        error: null,
      });

      let sourceError = null;
      for (let index = 0; index < sources.length; index++) {
        const source = sources[index];
        try {
          progress('checksum', {
            source: source.id,
            downloadedBytes: 0,
            totalBytes: null,
            percent: null,
            speedBytesPerSec: null,
          });
          const checksumBuf = await fetchBufferImpl(source.checksumUrl, { maxBytes: 64 * 1024 });
          const expectedHash = parseExpectedHash(source, checksumBuf);
          if (!expectedHash) {
            throw new Error(`取得的雜湊格式不正確（${source.label}）`);
          }

          progress('download', {
            source: source.id,
            downloadedBytes: 0,
            totalBytes: null,
            percent: 0,
            speedBytesPerSec: 0,
          });
          const result = await fetchFileImpl(source.url, tmpZip, {
            maxBytes: MAX_ZIP_BYTES,
            onProgress: (downloadProgress) => {
              setDownloadStatus({
                active: true,
                stage: 'download',
                source: source.id,
                ...downloadProgress,
                error: null,
              });
              onProgress?.(getDownloadStatus());
            },
          });

          progress('verify', {
            source: source.id,
            downloadedBytes: result.downloadedBytes,
            totalBytes: result.totalBytes,
            percent: 100,
            speedBytesPerSec: null,
          });
          actualHash = result.sha256;
          if (actualHash !== expectedHash) {
            throw new Error(`SHA-256 驗證失敗（預期 ${expectedHash.slice(0, 12)}…，實際 ${actualHash.slice(0, 12)}…）`);
          }
          selectedSource = source;
          sourceError = null;
          break;
        } catch (error) {
          sourceError = error;
          safeRemove(tmpZip);
          log.warn(`FFmpeg 來源 ${source.label} 失敗：${error.message}`);
          if (index + 1 < sources.length) {
            progress('source-fallback', {
              source: source.id,
              downloadedBytes: 0,
              totalBytes: null,
              percent: null,
              speedBytesPerSec: null,
            });
          }
        }
      }

      if (!selectedSource) {
        throw sourceError || new Error('所有 FFmpeg 下載來源都失敗');
      }

      progress('extract', { source: selectedSource.id });
      const zip = new AdmZip(tmpZip);
      const { ffmpegEntry, ffprobeEntry } = findFfmpegEntries(zip.getEntries());
      if (!ffmpegEntry || !ffprobeEntry) {
        throw new Error('下載的壓縮檔內找不到 ffmpeg.exe / ffprobe.exe，上游打包結構可能變了');
      }

      fs.writeFileSync(tmpFfmpeg, ffmpegEntry.getData());
      fs.writeFileSync(tmpFfprobe, ffprobeEntry.getData());

      progress('validate-temp');
      const tempValidation = validateFfmpegPair(
        { ffmpeg: tmpFfmpeg, ffprobe: tmpFfprobe },
        { spawnSyncImpl },
      );
      if (!tempValidation.ok) {
        throw new Error(`下載檔案無法執行（ffmpeg=${tempValidation.ffmpegOk ? 'ok' : 'fail'}, ffprobe=${tempValidation.ffprobeOk ? 'ok' : 'fail'}）`);
      }

      progress('install');
      transaction = beginPairInstall(tmpFfmpeg, tmpFfprobe);

      progress('validate-installed');
      const installedValidation = validateFfmpegPair(
        { ffmpeg: FFMPEG_EXE, ffprobe: FFPROBE_EXE },
        { spawnSyncImpl },
      );
      if (!installedValidation.ok) {
        transaction.rollback();
        transaction = null;
        throw new Error(`安裝後 FFmpeg 驗證失敗（ffmpeg=${installedValidation.ffmpegOk ? 'ok' : 'fail'}, ffprobe=${installedValidation.ffprobeOk ? 'ok' : 'fail'}），已還原原本檔案`);
      }

      transaction.commit();
      transaction = null;
      progress('done', {
        active: false,
        source: selectedSource.id,
        percent: 100,
        speedBytesPerSec: null,
      });
      log.info(`FFmpeg 下載完成並通過 SHA-256 / 執行驗證（${selectedSource.label}）：${FFMPEG_EXE}`);
      return {
        ok: true,
        ffmpeg: FFMPEG_EXE,
        ffprobe: FFPROBE_EXE,
        sha256: actualHash,
        source: selectedSource.id,
      };
    } catch (err) {
      err.ffmpegStage = err.ffmpegStage || stage;
      setDownloadStatus({ active: false, stage: 'error', error: err.message });
      log.error(`FFmpeg 下載/安裝失敗（stage=${err.ffmpegStage}）`, err);
      throw err;
    } finally {
      if (transaction) {
        try { transaction.rollback(); } catch (rollbackErr) {
          log.error('FFmpeg 未完成交易回滾失敗', rollbackErr);
        }
      }
      safeRemove(tmpZip);
      safeRemove(tmpFfmpeg);
      safeRemove(tmpFfprobe);
    }
  })();

  try {
    return await downloadInFlight;
  } finally {
    downloadInFlight = null;
  }
}

function resetForTests() {
  downloadInFlight = null;
  downloadStatus = {
    active: false,
    stage: 'idle',
    source: null,
    downloadedBytes: 0,
    totalBytes: null,
    percent: null,
    speedBytesPerSec: null,
    startedAt: null,
    updatedAt: null,
    error: null,
  };
}

module.exports = {
  resolveFfmpegPaths,
  getFfmpegPath,
  getFfprobePath,
  isAvailable,
  hasDownloadedPair,
  downloadFfmpeg,
  commandExistsOnPath,
  commandRuns,
  validateFfmpegPair,
  findFfmpegEntries,
  getDownloadStatus,
  parseExpectedHash,
  DOWNLOAD_SOURCES,
  DOWNLOAD_URL,
  CHECKSUM_URL,
  BIN_DIR,
  FFMPEG_EXE,
  FFPROBE_EXE,
  _beginPairInstall: beginPairInstall,
  _resetForTests: resetForTests,
};
