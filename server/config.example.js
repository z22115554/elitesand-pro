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

  // ─── FFmpeg（選填）───
  // Installer 預設不再內附 FFmpeg（GPLv3 對應原始碼義務較重，改為需要時由控制面板
  // 的系統檢查一鍵下載，來源固定是 gyan.dev 官方 Windows 建置頁，下載後會驗證 SHA-256）。
  // 這裡留空就好：程式會依序找 (1) 這裡指定的路徑 (2) 之前下載過的副本 (3) 系統 PATH。
  // 只有你想固定用某個特定版本、或系統已經裝好 FFmpeg 想直接指過去時才需要填，
  // 填完整的 ffmpeg.exe 路徑（ffprobe.exe 必須在同一個資料夾）。
  ffmpegPath: '',

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

  // ─── 程式內問題回報 ───
  //
  // 使用者在面板填寫問題後，由這台伺服器把「送出前已完整顯示給使用者看過」的文字
  // 送到中繼，再由中繼建立私人 GitHub Issue。GitHub 憑證只存在中繼，不在這個程式裡。
  //
  // 留空字串（''）＝停用回報送出，面板會自動降級成「複製報告全文」，
  // 使用者仍可自行把內容貼給開發者，不會看到壞掉的按鈕。
  // 官方中繼（2026-07-31 部署並端到端驗證通過）：
  feedbackEndpoint: 'https://elitesand-pro-feedback.elitesand.workers.dev/api/v1/reports',
  // 緊急停用開關：設為 false 時完全不顯示送出按鈕，只保留複製與下載診斷包。
  feedbackEnabled: true,

  // ─── 匿名活躍統計 ───
  // 只送版本、啟動／核心功能使用事件，以及每日／每週／每月輪替的匿名 HMAC 代碼。
  // 不送固定安裝 ID、歌名、歌詞、歌單、帳號、硬體或裝置資訊；可在程式設定內關閉。
  usageEndpoint: 'https://elitesand-pro-usage.elitesand.workers.dev/api/v1/usage',
  anonymousUsageEnabled: true,

  // ─── 歌詞偏移社群回饋 ───
  // 跟上面的「匿名活躍統計」是兩個獨立功能，不要混為一談：這裡會送出 YouTube 影片 ID
  // 與你調整過的時間偏移毫秒數，讓下次匯入同一支影片的人能拿到社群已校正過的建議值。
  // 刻意預設關閉（opt-in，不是 opt-out），使用者要自己在面板打開才會送出／取得建議。
  lyricOffsetEndpoint: 'https://elitesand-pro-lyric-offset.elitesand.workers.dev/api/v1/offset',
  lyricOffsetSyncEnabled: false,
};
