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
  if (/cookies?|sign in|login|required to view|confirm your age|authentication|認證|登入/.test(text)) {
    return { code: 'YOUTUBE_AUTH_REQUIRED', status: 422, message: 'YouTube 要求登入或 cookies，這支影片目前無法直接下載。', recovery: '更新 yt-dlp；若仍失敗，改用可公開播放的影片或本機音檔。', retryable: false, technical };
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
  return { code: 'IMPORT_FAILED', status: 500, message: 'YouTube 匯入失敗。', recovery: '可重試一次；若仍失敗，請檢查 yt-dlp 或改用本機音檔。', retryable: true, technical };
}

module.exports = { classifyImportError };
