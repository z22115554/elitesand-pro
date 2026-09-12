/**
 * 前端共用工具函式（formatTime / escapeHtml / getAudioErrorMessage）
 *
 * 這三個函式原本在 app.js/controller.js/setlist.js/display.js/error-handler.js/
 * media-library.js 各自重複一份，現在統一放這裡。四個頁面（index/controller/setlist/display）
 * 都要在自己專屬的 script 之前載入這個檔案。
 */
window.SharedUtils = (function () {
  const tr = (value) => window.I18n ? window.I18n.translate(value) : value;

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

  // External cover metadata is displayed in several independent surfaces.
  // Keep URL policy in one place: browser-relative cover paths are allowed,
  // but data:, file:, javascript:, and malformed values never reach an img
  // attribute or CSS background-image declaration.
  function safeHttpUrl(value) {
    if (!value) return '';
    try {
      const base = typeof location !== 'undefined' ? location.origin : 'http://localhost';
      const url = new URL(String(value), base);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  // 統一採用依 MediaError.code 判斷的版本（原 app.js 版）。display.js 原本的版本是用
  // error.message 關鍵字比對，但 MediaError.message 不是標準規範保證有內容的欄位，
  // 兩邊呼叫點傳進來的都是同一種 audioPlayer.error（原生 MediaError），code 判斷才可靠。
  function getAudioErrorMessage(error) {
    if (!error) return tr('音訊播放失敗');
    const code = error.code;
    if (code === 1) return tr('音訊載入被中斷');
    if (code === 2) return tr('網路錯誤，音訊下載失敗');
    if (code === 3) return tr('音訊解碼失敗，請更換來源');
    if (code === 4) return tr('音訊格式不支援或檔案不存在');
    return `${tr('音訊播放失敗:')} ${error.message || tr('未知錯誤')}`;
  }

  // 播放清單（app-playlist.js）與收藏歌單（media-library.js）各自實作過一份幾乎一模一樣的
  // HTML5 拖曳排序（把手按下才武裝、dragover 畫 drop-above/drop-below 提示、以滑鼠 Y 座標
  // 對半判斷插在目標上/下方）。兩邊只有「怎麼把最終順序套用回自己的資料」不同，機制本身
  // 統一收在這裡，之後修拖曳手感或瀏覽器相容性問題只需要改一個地方。
  //
  // 回傳值只負責算「拖了哪一列（fromIndex）」跟「要插進目前可見列表的第幾格
  // （toIndexRaw，尚未做移除後的位移調整）」——這兩個數字的語意跟兩邊原本各自算出來的
  // 完全相同，呼叫端可以直接沿用自己原本「how to apply」那段程式碼不用改。
  //
  // @param {Object} options
  // @param {HTMLElement} options.listEl - 外層容器，事件監聽掛在這裡（事件代理）
  // @param {string} options.rowSelector - 每一列的 CSS 選擇器
  // @param {string} options.handleSelector - 拖曳把手的 CSS 選擇器（只有從這裡按下才允許拖曳）
  // @param {() => boolean} options.canReorder - 目前是否允許拖曳排序（例如搜尋中/多選模式時要擋）
  // @param {(fromIndex: number, toIndexRaw: number) => void} options.onDrop - 放開滑鼠時呼叫，
  //   toIndexRaw 是「移除 fromIndex 那一列之前」的插入位置（跟舊版兩邊各自的語意一致）
  function attachRowDragReorder({ listEl, rowSelector, handleSelector, canReorder, onDrop, onDragStart }) {
    if (!listEl) return;
    let dragFromEl = null;
    let armed = false;
    function clearDropMarkers() {
      listEl.querySelectorAll('.drop-above, .drop-below').forEach((n) => n.classList.remove('drop-above', 'drop-below'));
    }
    listEl.addEventListener('pointerdown', (e) => { armed = canReorder() && !!e.target.closest(handleSelector); });
    listEl.addEventListener('dragstart', (e) => {
      const row = e.target.closest(rowSelector);
      if (!row || !armed || !canReorder()) { e.preventDefault(); return; }
      dragFromEl = row;
      row.classList.add('dragging');
      if (onDragStart) onDragStart(row);
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', ''); } catch (_) { /* 某些瀏覽器不允許 */ }
    });
    listEl.addEventListener('dragover', (e) => {
      if (!dragFromEl) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const row = e.target.closest(rowSelector);
      clearDropMarkers();
      if (!row || row === dragFromEl) return;
      const rect = row.getBoundingClientRect();
      row.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-above' : 'drop-below');
    });
    listEl.addEventListener('drop', (e) => {
      if (!dragFromEl) return;
      e.preventDefault();
      const rows = Array.from(listEl.querySelectorAll(rowSelector));
      const from = rows.indexOf(dragFromEl);
      if (from === -1) return;
      const targetRow = e.target.closest(rowSelector);
      let to;
      if (targetRow) {
        const rect = targetRow.getBoundingClientRect();
        to = rows.indexOf(targetRow) + (e.clientY < rect.top + rect.height / 2 ? 0 : 1);
      } else {
        to = rows.length; // 拖到清單空白處＝移到最後
      }
      onDrop(from, to);
    });
    listEl.addEventListener('dragend', () => {
      dragFromEl = null;
      armed = false;
      clearDropMarkers();
      listEl.querySelectorAll('.dragging').forEach((n) => n.classList.remove('dragging'));
    });
  }

  return { formatTime, escapeHtml, safeHttpUrl, getAudioErrorMessage, attachRowDragReorder };
})();
