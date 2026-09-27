'use strict';

function classifyImportError(error) {
  const technical = String(error?.message || error || '').trim();
  const code = String(error?.code || '').toUpperCase();
  const text = `${code} ${technical}`.toLowerCase();
  if (code === 'IMPORT_CANCELLED' || /cancelled|canceled|已取消/.test(text)) {
    return { code: 'IMPORT_CANCELLED', status: 409, message: '匯入已取消，沒有加入播放清單。', recovery: '需要時可重新加入佇列。', retryable: true, technical };
  }
  if (code === 'ENOSPC' || /no space left|disk.*full|磁碟.*空間/.test(text)) {
    return { code: 'DISK_FULL', status: 507, message: '磁碟空間不足，無法完成下載。', recovery: '清出至少 500 MB 空間後再試一次。', retryable: true, technical };
  }
  if (code === 'YOUTUBE_MUSIC_PREMIUM' || /only available to music premium members|music premium members/.test(text)) {
    return { code: 'YOUTUBE_MUSIC_PREMIUM', status: 422, message: '這首 YouTube Music 音樂僅限 Music Premium 播放，無法下載匯入。', recovery: '請改貼可公開播放的 YouTube 影片連結，或匯入本機音檔。', retryable: false, technical };
  }
  if (code === 'YOUTUBE_RATE_LIMITED' || /(?:http\s*error|httperror)?\s*429\b|too many requests|rate.?limit|temporarily blocked|請求.*頻繁/.test(text)) {
    return { code: 'YOUTUBE_RATE_LIMITED', status: 429, message: 'YouTube 暫時限制了這台電腦的請求。', recovery: '程式已停止連續重試；請稍後再匯入，避免持續觸發限制。', retryable: true, technical };
  }
  if (code === 'YOUTUBE_AUTH_REQUIRED' || /cookies?|sign in|login|required to view|confirm your age|authentication|members[- ]?only|認證|登入|會員/.test(text)) {
    return {
      code: 'YOUTUBE_AUTH_REQUIRED',
      status: 422,
      message: '匿名 YouTube 修復流程已嘗試完成，但 YouTube 仍要求登入驗證。',
      recovery: '可選擇「使用瀏覽器登入狀態重試」作為最後手段；不使用帳號時請改用本機音檔或其他公開來源。',
      retryable: true,
      browserCookieFallback: true,
      technical,
    };
  }
  if (/not available in your country|not available in your region|geo.?restrict|country restriction|地區|區域限制/.test(text)) {
    return { code: 'REGION_RESTRICTED', status: 422, message: '這支影片在目前地區無法播放或下載。', recovery: '改用其他官方來源或匯入本機音檔。', retryable: false, technical };
  }
  if (/video unavailable|private video|has been removed|deleted video|this video is unavailable|影片.*下架|私人影片/.test(text)) {
    return { code: 'VIDEO_UNAVAILABLE', status: 404, message: '影片已下架、設為私人或目前不可用。', recovery: '換一個仍可公開播放的 YouTube 連結。', retryable: false, technical };
  }
  if (code === 'ETIMEDOUT' || /timed?\s*out|timeout|逾時|超時/.test(text)) {
    return { code: 'IMPORT_TIMEOUT', status: 504, message: 'YouTube 回應逾時，這次匯入沒有完成。', recovery: '確認網路後重試；若持續發生，先更新 yt-dlp。', retryable: true, technical };
  }
  if (/找不到 ffmpeg/.test(text)) {
    return { code: 'FFMPEG_MISSING', status: 422, message: '找不到 FFmpeg，YouTube 匯入的轉檔步驟需要它。', recovery: '請到「連線與系統」頁下載 FFmpeg，完成後再重試。', retryable: true, technical };
  }
  return { code: 'IMPORT_FAILED', status: 500, message: 'YouTube 匯入失敗。', recovery: '可重試一次；若仍失敗，請檢查 yt-dlp 或改用本機音檔。', retryable: true, technical };
}

/**
 * 把上面這套面向使用者的產品碼，轉成 telemetry-fields.js 的封閉遙測碼。
 * 回傳 null 代表「這次不算管線失敗，不計入遙測」——目前只有使用者主動
 * 取消是這種情況：那不是 yt-dlp／FFmpeg／網路的問題，算進失敗率只會讓
 * 「匯入到底穩不穩」這個數字失真。
 *
 * YOUTUBE_MUSIC_PREMIUM 與 IMPORT_FAILED（未分類）刻意不列在對照表——
 * 讓它們落到 usage-telemetry.js 的 mapError() 兜底成 'other'，而不是勉強
 * 塞進語意不合的既有分類。
 */
const TELEMETRY_CODE_BY_IMPORT_CODE = {
  IMPORT_CANCELLED: null,
  DISK_FULL: 'disk_full',
  YOUTUBE_AUTH_REQUIRED: 'ytdlp_auth_required',
  YOUTUBE_RATE_LIMITED: 'ytdlp_rate_limited',
  REGION_RESTRICTED: 'ytdlp_geo_blocked',
  VIDEO_UNAVAILABLE: 'ytdlp_private',
  IMPORT_TIMEOUT: 'ytdlp_timeout',
  FFMPEG_MISSING: 'ffmpeg_missing',
};

function toImportTelemetryCode(classifiedCode) {
  if (Object.prototype.hasOwnProperty.call(TELEMETRY_CODE_BY_IMPORT_CODE, classifiedCode)) {
    return TELEMETRY_CODE_BY_IMPORT_CODE[classifiedCode];
  }
  return classifiedCode; // 未知碼原樣交給 mapError()，會被歸類 'other'
}

module.exports = { classifyImportError, toImportTelemetryCode };
