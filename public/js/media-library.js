/**
 * 媒體庫前端 — 唱過的歌歷史 + 播放次數 + 以 YouTube 網址重新匯入
 *
 * 資料來源：伺服器 data/library.json（socket: library:get / library:list）
 * 重新匯入：透過 window.VKState.importYouTubeUrl(url)（重用 app.js 的播放清單邏輯）
 * 清理音檔 / 清空：socket library:cleanupAudio / library:clear
 */
(function () {
  'use strict';

  const { escapeHtml, safeHttpUrl } = SharedUtils;
  const tr = (value) => window.I18n ? window.I18n.translate(value) : value;

  const listEl = document.getElementById('library-list');
  const emptyEl = document.getElementById('library-empty');
  if (!listEl) return;

  let cache = [];
  // 媒體庫還原會帶完整歌詞與 parsedLyrics。逐首等待伺服器 ack，避免快速點選
  // 多首歌曲時，把多份大型資料同時塞進 Socket、state:sync 與 DOM 更新流程。
  const restoreQueue = [];
  let restoreQueueRunning = false;

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
    if (diff < 60000) return tr('剛剛');
    if (diff < 3600000) return tr(`${Math.floor(diff / 60000)} 分鐘前`);
    if (diff < 86400000) return tr(`${Math.floor(diff / 3600000)} 小時前`);
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
        emptyEl.textContent = cache.length ? tr('找不到符合的歌曲') : tr('尚無記錄，播放任一首歌後會自動加入。');
      }
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    for (const item of view) {
      const row = document.createElement('div');
      row.className = 'lib-row';
      row.dataset.id = item.id;

      const coverUrl = safeHttpUrl(item.cover);

      row.innerHTML = `
        <div class="lib-cover">${coverUrl ? '' : '♪'}</div>
        <div class="lib-meta">
          <div class="lib-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
          <div class="lib-sub">${escapeHtml(item.artist || tr('未知歌手'))}${item.duration ? ' · ' + fmtDuration(item.duration) : ''}</div>
          <div class="lib-stats">▶ ${tr(`${item.playCount || 0} 次`)} · ${fmtDate(item.lastPlayed)}</div>
        </div>
        <div class="lib-actions">
          <button class="btn btn-sm lib-reimport" type="button">${tr('加入清單')}</button>
          ${separationButtonHtml(item)}
          <button class="btn btn-sm btn-ghost lib-remove" type="button" title="${tr('從媒體庫移除')}">✕</button>
        </div>`;

      // Do not interpolate external metadata into a style attribute. The URL
      // has already passed the shared HTTP(S) allow-list before CSSOM receives it.
      if (coverUrl) {
        const cover = row.querySelector('.lib-cover');
        if (cover) cover.style.backgroundImage = `url(${JSON.stringify(coverUrl)})`;
      }

      row.querySelector('.lib-reimport').addEventListener('click', () => reimport(item, row));
      row.querySelector('.lib-remove').addEventListener('click', () => removeItem(item.id));
      const separateBtn = row.querySelector('.lib-separate');
      if (separateBtn) separateBtn.addEventListener('click', () => startSeparation(item, row));
      const previewBtn = row.querySelector('.lib-separate-preview');
      if (previewBtn) previewBtn.addEventListener('click', () => togglePreview(item, row));
      listEl.appendChild(row);
    }
  }

  // ─── AI 人聲分離（實驗性功能，見 CLAUDE.md）───
  // 授權確認（Kim 作者）截至目前仍在等待中，這是使用者知情後決定先開放測試的功能，
  // 不是忽略了授權關卡；按鈕文案刻意保留「實驗性」字樣，不要拿掉。
  function separationButtonHtml(item) {
    const status = item.separationStatus || 'none';
    if (status === 'done') {
      return `<button class="btn btn-sm btn-ghost lib-separate" type="button" disabled>${tr('已分離人聲')}</button>
        <button class="btn btn-sm lib-separate-preview" type="button">${tr('試聽')}</button>`;
    }
    if (status === 'processing') {
      return `<button class="btn btn-sm lib-separate" type="button" disabled>${tr('分離中…')}</button>`;
    }
    const label = status === 'failed' ? tr('重試分離（實驗性）') : tr('分離人聲（實驗性）');
    return `<button class="btn btn-sm btn-ghost lib-separate" type="button">${label}</button>`;
  }

  // 純試聽用：兩個獨立的 <audio controls> 播放人聲/伴奏檔案，各自的音量滑桿是瀏覽器
  // 原生內建的，不需要額外寫 Web Audio 混音邏輯——這是刻意的最小風險做法，不碰
  // app-playback.js 既有的（脆弱、已經過大量實戰強化的）主播放引擎。之後如果要整合成
  // 正式的分離播放模式（含變調/變速），才需要動 app-playback.js，不是這一輪的範圍。
  function togglePreview(item, row) {
    const existing = row.nextElementSibling;
    if (existing && existing.classList.contains('lib-separate-preview-panel')) { existing.remove(); return; }
    const panel = document.createElement('div');
    panel.className = 'lib-separate-preview-panel';
    panel.style.cssText = 'display:flex;gap:16px;padding:8px 10px 12px;flex-wrap:wrap;';
    panel.innerHTML = `
      <div style="flex:1;min-width:200px;">
        <div class="lib-sub">${tr('人聲')}</div>
        <audio controls style="width:100%" src="/audio/${encodeURIComponent(item.vocalsFile || '')}"></audio>
      </div>
      <div style="flex:1;min-width:200px;">
        <div class="lib-sub">${tr('伴奏')}</div>
        <audio controls style="width:100%" src="/audio/${encodeURIComponent(item.instrumentalFile || '')}"></audio>
      </div>`;
    row.insertAdjacentElement('afterend', panel);
  }

  async function startSeparation(item, row) {
    const btn = row.querySelector('.lib-separate');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = tr('分離中…');
    try {
      const res = await PinAuth.fetchWithPin(`/api/library/${encodeURIComponent(item.id)}/separate`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        const reason = data.error === 'AI_RUNTIME_NOT_READY'
          ? tr('AI 分離元件尚未安裝，請先到「連線與系統」下載')
          : (data.error || tr('伺服器沒有確認'));
        toast(tr(`啟動分離失敗：${reason}`), 'error');
        btn.disabled = false;
        btn.textContent = tr('分離人聲（實驗性）');
        return;
      }
      const cached = cache.find((x) => x.id === item.id);
      if (cached) cached.separationStatus = 'processing';
    } catch (err) {
      toast(tr(`啟動分離失敗：${err.message}`), 'error');
      btn.disabled = false;
      btn.textContent = tr('分離人聲（實驗性）');
    }
  }

  // SocketClient 跟 PinAuth 一樣是頂層 const 宣告，不會掛在 window 上（見上面
  // fetchWithPin 那個 bug 的教訓）；直接用裸變數，不要再用 window.SocketClient 判斷，
  // 那個判斷式恆假，等於整段訂閱從沒真的執行過。
  SocketClient.on('separation:progress', (data) => {
    if (!data || !data.trackId) return;
    const row = listEl.querySelector(`.lib-row[data-id="${CSS.escape(String(data.trackId))}"]`);
    const btn = row && row.querySelector('.lib-separate');
    const cached = cache.find((x) => String(x.id) === String(data.trackId));
    if (data.stage === 'done') {
      // 不在這裡手動拼按鈕 HTML：伺服器完成後會廣播 library:list（見
      // ai-separation-jobs.js），那次 render() 會帶著正確的 vocalsFile/instrumentalFile
      // 重畫整列，這裡只負責立刻跳 toast，不用等 render 完成。
      toast(tr('人聲分離完成'), 'success');
    } else if (data.stage === 'error') {
      if (cached) cached.separationStatus = 'failed';
      if (btn) {
        btn.disabled = false;
        btn.textContent = tr('重試分離（實驗性）');
      }
      toast(tr(`人聲分離失敗：${data.errorMessage || data.error || ''}`), 'error');
    } else if (btn) {
      // worker.py 的 progress 是 0.0-1.0 的比例，不是 0-100（見 ai/worker.py）。
      const pct = typeof data.progress === 'number' ? Math.round(data.progress * 100) : null;
      btn.textContent = pct !== null ? tr(`分離中… ${pct}%`) : tr('分離中…');
    }
  });

  function requestSocket(event, data) {
    return new Promise((resolve) => {
      SocketClient.sendWithCallback(event, data, (response) => resolve(response || null));
    });
  }

  async function runRestoreQueue() {
    if (restoreQueueRunning) return;
    restoreQueueRunning = true;
    try {
      while (restoreQueue.length) {
      const job = restoreQueue.shift();
      const { item, btn, originalLabel } = job;
      if (btn) { btn.disabled = true; btn.textContent = tr('加入中…'); }
      const fail = (message) => {
        toast(message, 'error');
        if (btn) { btn.textContent = originalLabel; btn.disabled = false; }
      };

      const resp = await requestSocket('library:reimport', item.id);
      if (resp?.track) {
        const result = await window.VKState.addLibraryTrack(resp.track);
        if (result?.ok) {
          toast(tr(`已加入清單：${item.title}`), 'success');
          if (btn) btn.textContent = tr('已加入');
        } else {
          fail(tr(`加入播放清單失敗：${result?.error || tr('伺服器沒有確認')}`));
        }
      } else if (resp?.needsDownload && resp.url && window.VKState.importYouTubeUrl) {
        if (btn) btn.textContent = tr('排隊下載中…');
        try {
          await window.VKState.importYouTubeUrl(resp.url);
          toast(tr(`已加入清單：${item.title}`), 'success');
          if (btn) btn.textContent = tr('已加入');
        } catch (err) {
          fail(tr(`重新匯入失敗：${err.message}`));
        }
      } else {
        fail(tr('無法重新匯入：無本機音檔也無 YouTube 網址'));
      }
      }
    } finally {
      restoreQueueRunning = false;
    }
  }

  async function reimport(item, row) {
    if (!window.VKState) { toast(tr('匯入功能未就緒'), 'error'); return; }
    // 重複加入警告：已在播放清單中就先問，確認後仍會再加一首到清單末端
    if (window.VKState.isInPlaylist && window.VKState.isInPlaylist(item.id)) {
      const confirmed = await window.PanelConfirm?.request({
        title: `再次加入「${item.title}」？`,
        summary: '這首歌已在播放清單中。',
        impact: '確認後會在清單末端再加入一首，不會移除原本的歌曲。',
        confirmLabel: '再加入一首',
      });
      if (!confirmed) return;
    }
    const btn = row.querySelector('.lib-reimport');
    if (!btn || btn.disabled) return;
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = restoreQueueRunning ? tr('加入佇列中…') : tr('加入中…');
    restoreQueue.push({ item, btn, originalLabel });
    runRestoreQueue();
  }

  async function removeItem(id) {
    // 刪除前先確認（媒體庫紀錄含播放次數/歌詞記憶，誤刪要重新匯入）
    const item = cache.find((x) => x.id === id);
    const title = item ? (item.title || '這首歌') : '這首歌';
    const confirmed = await window.PanelConfirm?.request({
      title: `從媒體庫移除「${title}」？`,
      summary: '這首歌的媒體庫紀錄會被移除。',
      impact: '播放紀錄與媒體庫記憶會一併清除；目前播放清單與已下載音檔不受影響。',
      tone: 'danger',
      confirmLabel: '移除紀錄',
    });
    if (!confirmed) return;
    SocketClient.sendWithCallback('library:remove', id, (res) => {
      if (!res?.ok) return toast(tr(`刪除失敗：${res?.error || tr('伺服器沒有確認')}`), 'error');
      cache = cache.filter((x) => x.id !== id); render(cache); toast(tr('已從媒體庫移除'), 'success');
    });
  }

  function refresh() {
    if (!SocketClient.connected()) return;
    SocketClient.sendWithCallback('library:get', null, (list) => render(list || []));
  }

  const storageCard = document.getElementById('library-storage');
  const storagePath = document.getElementById('library-storage-path');
  const storageStatus = document.getElementById('library-storage-status');
  const storageChoose = document.getElementById('library-storage-choose');
  let storageInfo = null;
  let legacyPromptShown = false;

  function renderStorage(info) {
    storageInfo = info || null;
    if (!storageCard || !info?.ok) return;
    storageCard.hidden = false;
    if (storagePath) storagePath.textContent = info.mediaDir || '';
    if (storageStatus) {
      if (info.migrationSourceDir && (!info.mediaDirExists || !info.mediaEntryCount)) {
        storageStatus.textContent = tr(`目前位置沒有歌曲；搬遷時會自動從原始位置搬移（${info.migrationSourceEntryCount} 個項目）。`);
      } else if (!info.migrationSourceDir) {
        storageStatus.textContent = tr('目前記錄的位置找不到歌曲；請先確認歌曲沒有被移除。');
      } else {
        storageStatus.textContent = info.legacyMigrationRequired
          ? tr('找到舊版歌曲；搬遷後，新下載的歌曲會存到你選擇的磁碟。')
          : tr('新下載與匯入的音檔會存放在這裡。');
      }
    }
    if (storageChoose) storageChoose.disabled = !window.ElitesandShell?.chooseMediaLocation;
  }

  async function migrateStorage({ prompted = false } = {}) {
    if (!window.ElitesandShell?.chooseMediaLocation) {
      toast(tr('請在 Elitesand Pro 桌面版中設定媒體位置。'), 'error');
      return;
    }
    const parentDir = await window.ElitesandShell.chooseMediaLocation();
    if (!parentDir) return;
    if (!prompted) {
      const confirmed = await window.PanelConfirm?.request({
        title: tr('搬遷媒體庫？'),
        summary: tr('歌曲、歌詞與封面會先複製到新位置，再移除原本的副本。若目標資料夾已名為 Elitesand Pro Media，會直接使用它，不會再建立一層。'),
        impact: tr('搬遷時請先停止播放；完成後 Elitesand Pro 會重新啟動。'),
        confirmLabel: tr('搬遷並重新啟動'),
      });
      if (!confirmed) return;
    }
    if (storageChoose) storageChoose.disabled = true;
    const result = await requestSocket('library:storage:migrate', { parentDir });
    if (storageChoose) storageChoose.disabled = false;
    if (!result?.ok) {
      const message = result?.error === 'stop_playback_first'
        ? tr('請先停止播放中的歌曲，再搬遷媒體庫。')
        : (result?.message || tr('搬遷未完成，原本的歌曲沒有被刪除。'));
      toast(message, 'error');
      return;
    }
    toast(result.oldFilesRemoved ? tr('搬遷完成，正在重新啟動。') : tr('歌曲已複製完成；原位置仍有檔案，正在重新啟動。'), 'success');
    setTimeout(async () => {
      const restarting = await window.ElitesandShell.restartAfterMediaMigration?.();
      if (restarting !== true) toast(tr('搬遷完成，但無法自動重新啟動；請手動關閉並重新開啟 Elitesand Pro。'), 'error');
    }, 500);
  }

  async function promptLegacyMigration() {
    if (!storageInfo?.legacyMigrationRequired || legacyPromptShown) return;
    legacyPromptShown = true;
    const confirmed = await window.PanelConfirm?.request({
      title: tr('找到舊版歌曲'),
      summary: tr('舊歌曲目前仍存放在原本的應用程式資料夾。你可以現在搬到安裝磁碟或其他位置。'),
      impact: tr('不搬遷也能繼續使用；下次進入媒體庫仍可隨時設定。'),
      confirmLabel: tr('選擇位置並搬遷'),
    });
    if (confirmed) migrateStorage({ prompted: true });
  }

  function refreshStorage() {
    if (!SocketClient.connected()) return;
    SocketClient.sendWithCallback('library:storage:get', null, (info) => {
      renderStorage(info);
      promptLegacyMigration();
    });
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
  if (storageChoose) storageChoose.addEventListener('click', () => migrateStorage());

  if (btnCleanup) btnCleanup.addEventListener('click', async () => {
    const confirmed = await window.DangerConfirm?.request({
      title: '確認清理音檔',
      summary: '即將刪除不在目前播放清單中的已下載音檔。',
      impact: '媒體庫紀錄與目前播放清單會保留，但已刪除的音檔必須重新下載才能播放，且無法復原。',
      phrase: '清理音檔',
      confirmLabel: '清理音檔',
    });
    if (!confirmed) return;
    SocketClient.sendWithCallback('library:cleanupAudio', null, (res) => {
      if (res?.ok && typeof res.deleted === 'number') {
        toast(tr(`已清理 ${res.deleted} 個音檔，釋放 ${(res.freedBytes / 1048576).toFixed(1)}MB`), 'success');
      } else toast(tr('音檔清理失敗：伺服器沒有確認'), 'error');
    });
  });

  if (btnClear) btnClear.addEventListener('click', async () => {
    const confirmed = await window.DangerConfirm?.request({
      title: '確認清空媒體庫',
      summary: `即將清除媒體庫中的 ${cache.length} 筆歌曲紀錄。`,
      impact: '這會刪除播放紀錄、重新匯入資訊及媒體庫保存的歌詞／設定；不會刪除目前播放清單或已下載音檔，且無法復原。',
      phrase: '清空媒體庫',
      confirmLabel: '清空媒體庫',
    });
    if (!confirmed) return;
    SocketClient.sendWithCallback('library:clear', null, (res) => {
      if (res?.ok) { cache = []; render([]); toast(tr('媒體庫已清空'), 'success'); }
      else toast(tr('清空失敗：伺服器沒有確認'), 'error');
    });
  });

  // ─── 事件：切到媒體庫視圖時自動刷新；伺服器推播時更新 ───
  document.addEventListener('view:change', (e) => {
    if (e.detail && e.detail.view === 'library') {
      refresh();
      refreshStorage();
    }
  });
  SocketClient.on('library:list', (list) => render(list || []));
  // 語系切換時重繪：render() 只在收到伺服器資料才會跑，光切語言不會自動更新已經畫出來的列。
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('i18n:change', () => { if (cache.length) applyView(); });
  }
  SocketClient.on('connection-change', (ok) => { if (ok) { /* 連線後若正在媒體庫視圖則刷新 */
    const v = document.querySelector('.view[data-view="library"]');
    if (v && v.classList.contains('is-active')) {
      refresh();
      refreshStorage();
    }
  } });
})();
