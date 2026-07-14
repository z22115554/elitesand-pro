/**
 * 媒體庫前端 — 唱過的歌歷史 + 播放次數 + 以 YouTube 網址重新匯入
 *
 * 資料來源：伺服器 data/library.json（socket: library:get / library:list）
 * 重新匯入：透過 window.VKState.importYouTubeUrl(url)（重用 app.js 的播放清單邏輯）
 * 清理音檔 / 清空：socket library:cleanupAudio / library:clear
 */
(function () {
  'use strict';

  const { escapeHtml } = SharedUtils;

  const listEl = document.getElementById('library-list');
  const emptyEl = document.getElementById('library-empty');
  if (!listEl) return;

  let cache = [];

  function toast(msg, type) {
    if (typeof ErrorHandler !== 'undefined' && ErrorHandler.showToast) {
      ErrorHandler.showToast(msg, type || 'info');
    } else {
      const t = document.getElementById('app-toast');
      if (t) { t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2400); }
    }
  }

  function fmtDuration(sec) {
    if (!sec || sec < 0) return '';
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts), now = Date.now();
    const diff = now - ts;
    if (diff < 60000) return '剛剛';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分鐘前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小時前`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  let searchQuery = '';
  let sortBy = 'plays';

  // 收到伺服器清單→存快取後套用目前的搜尋/排序再渲染
  function render(list) {
    cache = Array.isArray(list) ? list : [];
    applyView();
  }

  function sortView(arr) {
    const byPlays = (a, b) => (b.playCount || 0) - (a.playCount || 0) || (b.lastPlayed || 0) - (a.lastPlayed || 0);
    if (sortBy === 'recent') return arr.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
    if (sortBy === 'title') return arr.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hant'));
    if (sortBy === 'artist') return arr.sort((a, b) => String(a.artist || '').localeCompare(String(b.artist || ''), 'zh-Hant'));
    return arr.sort(byPlays);
  }

  // 套用搜尋過濾 + 排序 → 渲染
  function applyView() {
    const q = searchQuery.trim().toLowerCase();
    let view = q
      ? cache.filter((it) => (it.title || '').toLowerCase().includes(q) || (it.artist || '').toLowerCase().includes(q))
      : cache.slice();
    view = sortView(view);

    listEl.innerHTML = '';
    if (!view.length) {
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = cache.length ? '找不到符合的歌曲' : '尚無記錄，播放任一首歌後會自動加入。';
      }
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    for (const item of view) {
      const row = document.createElement('div');
      row.className = 'lib-row';
      row.dataset.id = item.id;

      const coverStyle = item.cover ? `background-image:url('${item.cover.replace(/'/g, '')}')` : '';

      row.innerHTML = `
        <div class="lib-cover" style="${coverStyle}">${item.cover ? '' : '♪'}</div>
        <div class="lib-meta">
          <div class="lib-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
          <div class="lib-sub">${escapeHtml(item.artist || '未知歌手')}${item.duration ? ' · ' + fmtDuration(item.duration) : ''}</div>
          <div class="lib-stats">▶ ${item.playCount || 0} 次 · ${fmtDate(item.lastPlayed)}</div>
        </div>
        <div class="lib-actions">
          <button class="btn btn-sm lib-reimport" type="button">加入清單</button>
          <button class="btn btn-sm btn-ghost lib-remove" type="button" title="從媒體庫移除">✕</button>
        </div>`;

      row.querySelector('.lib-reimport').addEventListener('click', () => reimport(item, row));
      row.querySelector('.lib-remove').addEventListener('click', () => removeItem(item.id));
      listEl.appendChild(row);
    }
  }

  function reimport(item, row) {
    if (!window.VKState) { toast('匯入功能未就緒', 'error'); return; }
    // 重複加入警告：已在播放清單中就先問，確認後仍會再加一首到清單末端
    if (window.VKState.isInPlaylist && window.VKState.isInPlaylist(item.id)) {
      if (!window.confirm(`「${item.title}」已在播放清單中。\n要再加入一首到清單末端嗎？`)) return;
    }
    const btn = row.querySelector('.lib-reimport');
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = '匯入中…';
    const fail = (msg) => { toast(msg, 'error'); btn.textContent = orig; btn.disabled = false; };

    // 先問伺服器：本機音檔還在嗎？在＝即時還原（含歌詞/變調，零下載）；不在＝走 YouTube 重抓。
    SocketClient.sendWithCallback('library:reimport', item.id, async (resp) => {
      if (resp && resp.track) {
        if (window.VKState.addLibraryTrack) window.VKState.addLibraryTrack(resp.track);
        toast(`已加入清單：${item.title}`, 'success');
        btn.textContent = '已加入';
      } else if (resp && resp.needsDownload && resp.url && window.VKState.importYouTubeUrl) {
        btn.textContent = '排隊下載中…'; // 走匯入佇列，多首連點會依序處理不併發
        try {
          await window.VKState.importYouTubeUrl(resp.url);
          toast(`已加入清單：${item.title}`, 'success');
          btn.textContent = '已加入';
        } catch (err) {
          fail('重新匯入失敗：' + err.message);
        }
      } else {
        fail('無法重新匯入：無本機音檔也無 YouTube 網址');
      }
    });
  }

  function removeItem(id) {
    // 刪除前先確認（媒體庫紀錄含播放次數/歌詞記憶，誤刪要重新匯入）
    const item = cache.find((x) => x.id === id);
    const title = item ? (item.title || '這首歌') : '這首歌';
    if (!window.confirm(`確定從媒體庫移除「${title}」？（播放紀錄與記憶會一併清除）`)) return;
    SocketClient.sendWithCallback('library:remove', id, (res) => {
      if (!res?.ok) return toast(`刪除失敗：${res?.error || '伺服器沒有確認'}`, 'error');
      cache = cache.filter((x) => x.id !== id); render(cache); toast('已從媒體庫移除', 'success');
    });
  }

  function refresh() {
    if (!SocketClient.connected()) return;
    SocketClient.sendWithCallback('library:get', null, (list) => render(list || []));
  }

  // ─── 工具列 ───
  const btnRefresh = document.getElementById('lib-refresh');
  const btnCleanup = document.getElementById('lib-cleanup');
  const btnClear = document.getElementById('lib-clear');
  const searchInput = document.getElementById('lib-search');
  const sortSelect = document.getElementById('lib-sort');

  if (searchInput) searchInput.addEventListener('input', () => { searchQuery = searchInput.value; applyView(); });
  if (sortSelect) sortSelect.addEventListener('change', () => { sortBy = sortSelect.value; applyView(); });

  if (btnRefresh) btnRefresh.addEventListener('click', refresh);

  if (btnCleanup) btnCleanup.addEventListener('click', () => {
    if (!window.confirm('清理不在目前播放清單中的已下載音檔？\n媒體庫記錄會保留，需要時可用 YouTube 網址重新匯入。')) return;
    SocketClient.sendWithCallback('library:cleanupAudio', null, (res) => {
      if (res?.ok && typeof res.deleted === 'number') {
        toast(`已清理 ${res.deleted} 個音檔，釋放 ${(res.freedBytes / 1048576).toFixed(1)}MB`, 'success');
      } else toast('音檔清理失敗：伺服器沒有確認', 'error');
    });
  });

  if (btnClear) btnClear.addEventListener('click', () => {
    if (!window.confirm('確定清空整個媒體庫？此動作無法復原（不會刪除播放清單與音檔）。')) return;
    SocketClient.sendWithCallback('library:clear', null, (res) => {
      if (res?.ok) { cache = []; render([]); toast('媒體庫已清空', 'success'); }
      else toast('清空失敗：伺服器沒有確認', 'error');
    });
  });

  // ─── 事件：切到媒體庫視圖時自動刷新；伺服器推播時更新 ───
  document.addEventListener('view:change', (e) => {
    if (e.detail && e.detail.view === 'library') refresh();
  });
  SocketClient.on('library:list', (list) => render(list || []));
  SocketClient.on('connection-change', (ok) => { if (ok) { /* 連線後若正在媒體庫視圖則刷新 */
    const v = document.querySelector('.view[data-view="library"]');
    if (v && v.classList.contains('is-active')) refresh();
  } });
})();
