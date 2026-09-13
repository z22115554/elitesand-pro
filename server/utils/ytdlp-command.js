'use strict';

const path = require('path');

/**
 * Electron Installer 會把真正可更新的 yt-dlp 工作副本放在 userData，並用
 * ELITESAND_YTDLP_PATH 把絕對路徑交給 server。Node/Portable/開發模式沒有這個
 * override 時維持原本 PATH 上的 `yt-dlp` 行為。
 *
 * 只接受絕對路徑：避免外部環境不小心塞入相對路徑，讓 cwd 影響實際執行檔。
 */
function getYtdlpCommand(env = process.env) {
  const configured = String(env?.ELITESAND_YTDLP_PATH || '').trim();
  return configured && path.isAbsolute(configured) ? path.normalize(configured) : 'yt-dlp';
}

module.exports = { getYtdlpCommand };
