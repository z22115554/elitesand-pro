/**
 * 設定載入器
 *
 * 載入順序（防呆設計，任何情況下伺服器都能啟動）：
 * 1. server/config.js       — 使用者自己的設定（不被 git 追蹤）
 * 2. server/config.example.js — 範本預設值
 * 3. 內建預設值              — 連範本都不存在時的最後防線
 *
 * 從 GitHub 下載專案的人不會有 config.js（在 .gitignore 中），
 * 這個載入器確保他們不需要任何設定就能直接啟動。
 */

const path = require('path');
const { configPath } = require('./app-paths');

const DEFAULTS = {
  // 伺服器埠號（也可用環境變數 PORT 覆蓋）
  port: 3000,
  // 歌詞快取保留天數
  cacheDays: 7,
  // 歌詞快取筆數上限
  maxCacheEntries: 500,
  // 使用者自行指定的 FFmpeg 路徑（選填，留空則自動偵測／可按需下載，見 ffmpeg-provider.js）
  ffmpegPath: '',
  // 官方公開 repo；可在 config.js 覆蓋成其他 fork，空字串可停用。
  updateCheckRepo: 'z22115554/elitesand-pro',
  // 更新檢查間隔（毫秒）
  updateCheckIntervalMs: 6 * 60 * 60 * 1000,
  // 純 JSON 遠端公告；後端會做大小、欄位、版本、期限與 HTTPS 驗證並快取到 data/。
  announcementUrl: 'https://raw.githubusercontent.com/z22115554/elitesand-pro/main/announcement.json',
  announcementCheckIntervalMs: 30 * 60 * 1000,
  // BetterLyrics(boidu) API key：boidu 對「未快取」的歌要求 X-API-Key，沒 key 只抓得到已快取(熱門)歌。
  // 留空＝不帶 key（仍可抓快取歌；大部分 Apple 歌詞由 paxsenix 免 key 覆蓋）。也可用環境變數 BETTERLYRICS_API_KEY。
  betterLyricsApiKey: '',
  // Elitesand Pro 的公開 Twitch Client ID。公開 Client ID 可隨 App 發布；使用者只需登入授權，
  // 不需要自行建立 Developer App、更不需要 Client Secret。
  twitchClientId: '0irb2nsejgtlbuslpjdt0sjbr5sbpl',
  twitchRedirectUri: 'http://localhost:3000/auth/twitch/callback',
  twitchRequestCommand: '!點歌',
  // 程式內問題回報的中繼端點（Cloudflare Worker）。空字串＝停用，面板會自動降級成
  // 「複製報告全文」，使用者仍能把內容貼到 Discord 或信件。憑證只存在 Worker，
  // 這個端點本身是公開的，可以隨 App 發布。
  feedbackEndpoint: '',
  feedbackEnabled: true,
  // 匿名活躍統計：只傳送版本、事件類型與每日／每週／每月輪替代碼；可在程式內關閉。
  usageEndpoint: 'https://elitesand-pro-usage.elitesand.workers.dev/api/v1/usage',
  anonymousUsageEnabled: true,
  // 歌詞偏移社群回饋：跟上面的匿名活躍統計是兩個獨立的東西，這裡會送出 YouTube 影片 ID
  // 與使用者調整過的時間偏移。端點預設指向官方 Worker，跟 usageEndpoint 同一套邏輯：
  // 就算使用者的 config.js 是舊版、沒帶這個鍵，仍要能用到這個功能。enabled 預設開啟
  // （opt-out，2026-08-16 起跟 anonymousUsageEnabled 同一個極性）——見 lyric-offset-sync.js
  // 的 defaultState()；同意 EULA 條款七之 8 即取得揭露後的同意。
  lyricOffsetEndpoint: 'https://elitesand-pro-lyric-offset.elitesand.workers.dev/api/v1/offset',
  lyricOffsetSyncEnabled: true,
};

function tryRequire(modulePath) {
  try {
    return require(modulePath);
  } catch (e) {
    return null;
  }
}

const userConfig = tryRequire(configPath)
  || tryRequire(path.join(path.dirname(configPath), 'config.example.js'))
  || {};

// 合併：使用者設定 > 預設值；只接受預設值中存在的鍵，避免 typo 靜默生效
const config = { ...DEFAULTS };
for (const key of Object.keys(DEFAULTS)) {
  if (userConfig[key] !== undefined && userConfig[key] !== null) {
    // 早期本機 config.js 留著空 Twitch ID 時，不能把內建公開 ID 覆蓋掉；
    // 非空字串仍允許進階使用者換成自己的 Twitch App。
    if (key !== 'twitchClientId' || String(userConfig[key]).trim()) config[key] = userConfig[key];
  }
}

module.exports = config;
