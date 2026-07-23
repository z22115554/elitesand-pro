// 複製這個檔案為 server/config.js 後再編輯（config.js 不會被 git 追蹤）
/**
 * Elitesand Pro 設定檔
 *
 * 這是唯一需要手動編輯的設定檔，不會被 git 追蹤（每台電腦可各自設定）。
 * 沒有這個檔案程式也能啟動（會使用 config.example.js 或內建預設值）。
 */

module.exports = {
  // ─── 伺服器 ───
  // 伺服器埠號。改了之後 OBS 來源與遙控器網址的 :3000 也要跟著改
  port: 3000,

  // ─── 歌詞快取 ───
  // 快取保留天數與筆數上限（寫入 data/lyrics-cache.json）
  cacheDays: 7,
  maxCacheEntries: 500,

  // ─── GitHub 更新檢查 ───
  //
  // 設定後，控制面板會在啟動時自動檢查 GitHub Releases 是否有新版本，
  // 有新版時會在面板上方顯示提示橫幅。
  //
  // 格式："GitHub帳號/儲存庫名稱"。預設追蹤 Elitesand Pro 官方公開 repo。
  // 留空字串（''）則完全停用更新檢查，不會發出任何網路請求。
  // 設定步驟詳見 README 的「GitHub 更新通知」章節。
  updateCheckRepo: 'z22115554/elitesand-pro',

  // 多久檢查一次（毫秒）。預設 6 小時，避免頻繁打 GitHub API
  updateCheckIntervalMs: 6 * 60 * 60 * 1000,

  // 官方公告來源（HTTPS JSON）。預設讀取官方 repo 的 announcement.json，
  // 約每 30 分鐘檢查一次重要公告（安全性、強制升級等）。
  // 留空字串（''）則完全停用公告檢查，不會發出任何網路請求。
  // 上面兩項自動連線的資料範圍與揭露見 EULA 第七條第 5 項。
  announcementUrl: 'https://raw.githubusercontent.com/z22115554/elitesand-pro/main/announcement.json',
  announcementCheckIntervalMs: 30 * 60 * 1000,

  // BetterLyrics(boidu) API key（選填）
  // boidu 的 lyrics-api 現在對「未快取」的歌會回 401 並要求 X-API-Key header；
  // 沒填 key 只抓得到「已被快取的熱門歌」（多為英文），冷門/日文/中文歌會搜不到。
  // 想完整啟用 BetterLyrics 才需要去 better-lyrics.boidu.dev 取得 key 填這裡。
  // 留空也沒關係：大部分 Apple Music 歌詞由 paxsenix 來源免 key 覆蓋。
  // 也可改用環境變數 BETTERLYRICS_API_KEY。
  betterLyricsApiKey: '',

  // ─── Twitch 聊天室點歌（公開用戶端 / Device Code Flow）───
  // Elitesand Pro 已內建公開 Client ID：一般使用者不用填、只要在面板按「連接 Twitch」登入授權。
  // 只有自行建立 Twitch App 的進階使用者才需以自己的 Client ID 覆蓋。
  twitchClientId: '',
  twitchRedirectUri: 'http://localhost:3000/auth/twitch/callback',
  // 聊天室格式：!點歌 https://youtu.be/...（目前只接受 YouTube 連結，才能安全走既有匯入佇列）
  twitchRequestCommand: '!點歌',
};
