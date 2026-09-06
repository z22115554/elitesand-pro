/**
 * OBS 疊加層：跟著面板選的「OBS 顯示語言」即時換語言。
 *
 * 為什麼要這支：語言是頁面載入當下解析一次的（?lang= → localStorage → 瀏覽器語言）。
 * OBS 是獨立的瀏覽器 profile，讀不到面板的 localStorage，也不會知道面板換了語言，
 * 所以直播中途換語言時疊加層會卡在舊語言。伺服器的 obs-locale:update 補上這條線。
 *
 * 兩個刻意的取捨：
 * - 網址自己帶 ?lang= 就是釘死，忽略廣播。這是給「面板中文、疊加層英文」的進階用法，
 *   也讓舊版複製出去、已經貼在 OBS 裡的網址行為不變。
 * - setLocale 用 persist:false：疊加層不該把語言寫進自己那份 localStorage，
 *   否則使用者把選單切回「跟隨面板」後，這頁重整還會記得舊語言。
 *
 * 換語言後的重繪由各頁自己的 i18n:change 監聽負責（display.js、setlist.js 都已有）。
 */
(function () {
  'use strict';

  function pinnedByUrl() {
    try {
      return !!new URL(window.location.href).searchParams.get('lang');
    } catch (_) {
      return false;
    }
  }

  // SocketClient 是 socket-client.js 頂層的 const，不掛在 window 上（用 window.SocketClient
  // 取會拿到 undefined，這支就整個變成死碼）——只能用全域識別字 + typeof 判斷。
  if (typeof window === 'undefined' || typeof SocketClient === 'undefined' || !window.I18n) return;
  if (pinnedByUrl()) return;

  SocketClient.on('obs-locale:update', (payload) => {
    const locale = payload && payload.locale;
    if (!locale || locale === window.I18n.current()) return;
    window.I18n.setLocale(locale, { persist: false, updateQuery: false });
  });
})();
