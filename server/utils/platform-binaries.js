'use strict';

/**
 * 打包版外部執行檔的檔名，集中在這裡，避免 `yt-dlp.exe` 之類的字串散落各處。
 *
 * 打包版只有 Windows 與 macOS 兩種；其他平台（開發用的 Linux CI 等）沿用 Windows
 * 的命名，讓既有以 Windows 檔名寫成的測試與資料夾結構維持不變。
 *
 * - yt-dlp 官方 release 的 macOS 資產叫 `yt-dlp_macos`（Universal：Apple Silicon＋Intel，
 *   macOS 10.15+）；Windows 是 `yt-dlp.exe`。打包進 app／複製到 userData 後，macOS
 *   一律存成 `yt-dlp`。
 * - 隨附給 yt-dlp EJS（以及 Windows updater）用的獨立 Node：Windows 是
 *   `updater-node.exe`，macOS 是 `node`（Electron 關掉了 runAsNode fuse，不能拿主程式冒充 Node）。
 */
function ytdlpReleaseAssetName(platform = process.platform) {
  return platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp.exe';
}

function packagedYtdlpName(platform = process.platform) {
  return platform === 'darwin' ? 'yt-dlp' : 'yt-dlp.exe';
}

function bundledNodeName(platform = process.platform) {
  return platform === 'darwin' ? 'node' : 'updater-node.exe';
}

module.exports = { ytdlpReleaseAssetName, packagedYtdlpName, bundledNodeName };
