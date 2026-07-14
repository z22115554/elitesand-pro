/**
 * 前端共用工具函式（formatTime / escapeHtml / getAudioErrorMessage）
 *
 * 這三個函式原本在 app.js/controller.js/setlist.js/display.js/error-handler.js/
 * media-library.js 各自重複一份，現在統一放這裡。四個頁面（index/controller/setlist/display）
 * 都要在自己專屬的 script 之前載入這個檔案。
 */
window.SharedUtils = (function () {
  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  // 統一採用跳脫 &<>"' 五個字元＋null/undefined 防呆的版本（原 lyric-extras.js 版）。
  // 原本 app.js/controller.js/error-handler.js 用的是 div.textContent→innerHTML 版本，
  // 實測不會跳脫雙引號（"）——這在拿去組 HTML 屬性（如 title="..."）時是真的會被
  // 雙引號提早結束屬性、注入額外屬性的風險，不是理論問題。統一改用這個更完整的版本。
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 統一採用依 MediaError.code 判斷的版本（原 app.js 版）。display.js 原本的版本是用
  // error.message 關鍵字比對，但 MediaError.message 不是標準規範保證有內容的欄位，
  // 兩邊呼叫點傳進來的都是同一種 audioPlayer.error（原生 MediaError），code 判斷才可靠。
  function getAudioErrorMessage(error) {
    if (!error) return '音訊播放失敗';
    const code = error.code;
    if (code === 1) return '音訊載入被中斷';
    if (code === 2) return '網路錯誤，音訊下載失敗';
    if (code === 3) return '音訊解碼失敗，請更換來源';
    if (code === 4) return '音訊格式不支援或檔案不存在';
    return '音訊播放失敗: ' + (error.message || '未知錯誤');
  }

  return { formatTime, escapeHtml, getAudioErrorMessage };
})();
