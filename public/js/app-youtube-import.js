/**
 * 音樂來源匯入 —— 本機檔案上傳 + YouTube 網址/播放清單處理。
 *
 * 從 app.js 拆出來的第一個模組。跨模組共用的播放清單狀態透過
 * AppShared.state（getter/setter 代理到 app.js 內部變數）讀寫，
 * playTrack/renderPlaylist/showToast 透過 AppShared 暴露的函式呼叫。
 *
 * 對外暴露 AppShared.queueYouTubeImport，供 window.VKState.importYouTubeUrl（app.js）
 * 與媒體庫（media-library.js）重新匯入使用——併發下載會 OOM，一律走這個佇列。
 */
(function () {
  'use strict';

  const { dom } = AppShared;
  const state = AppShared.state;

  // ═══════════════════════════════════════════
  // 本地檔案上傳
  // ═══════════════════════════════════════════

  dom.browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dom.fileInput.click();
  });

  dom.dropZone.addEventListener('click', () => {
    dom.fileInput.click();
  });

  dom.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dom.dropZone.classList.add('dragover');
  });

  dom.dropZone.addEventListener('dragleave', () => {
    dom.dropZone.classList.remove('dragover');
  });

  dom.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dom.dropZone.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      /\.(mp3|flac|wav|m4a|ogg|aac|wma)$/i.test(f.name)
    );
    if (files.length > 0) uploadFiles(files);
  });

  dom.fileInput.addEventListener('change', () => {
    const files = Array.from(dom.fileInput.files);
    if (files.length > 0) uploadFiles(files);
    dom.fileInput.value = '';
  });

  async function uploadFiles(files) {
    // 驗證檔案
    if (typeof ErrorHandler !== 'undefined') {
      for (const file of files) {
        const validation = ErrorHandler.validateAudioFile(file);
        if (!validation.valid) {
          AppShared.showToast(validation.message, 'warning');
          return;
        }
      }
    }

    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));

    try {
      dom.dropZone.innerHTML = '<div class="hint">上傳處理中…</div>';

      const res = await PinAuth.fetchWithPin('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (data.success && data.tracks) {
        state.playlist.push(...data.tracks);
        AppShared.renderPlaylist();
        SocketClient.send('playlist:add', data.tracks);

        if (state.currentTrackIndex === -1 && state.playlist.length > 0) {
          AppShared.playTrack(0, false); // 匯入後載入待命，不自動播放
        }
        if (Array.isArray(data.warnings) && data.warnings.length) AppShared.showToast(data.warnings.join('；'), 'warning');
      } else {
        AppShared.showToast(`上傳失敗：${data.error || '伺服器未接受檔案'}${data.details ? `（${data.details}）` : ''}`, 'error');
      }
    } catch (err) {
      console.error('上傳失敗:', err);
      AppShared.showToast('上傳失敗: ' + err.message, 'error');
    } finally {
      dom.dropZone.innerHTML = `
        <div class="hint">拖放音訊檔案到這裡</div>
        <div class="sub">支援 MP3 / FLAC / WAV / M4A / OGG</div>
        <button id="browse-btn" class="btn btn-sm" type="button">選擇檔案</button>
        <input type="file" id="file-input" multiple accept=".mp3,.flac,.wav,.m4a,.ogg,.aac,.wma" hidden>`;
      dom.fileInput = document.getElementById('file-input');
      dom.browseBtn = document.getElementById('browse-btn');
      dom.fileInput.addEventListener('change', () => {
        const files = Array.from(dom.fileInput.files);
        if (files.length > 0) uploadFiles(files);
        dom.fileInput.value = '';
      });
      dom.browseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dom.fileInput.click();
      });
    }
  }

  // ═══════════════════════════════════════════
  // YouTube 處理
  // ═══════════════════════════════════════════

  dom.ytFetchBtn.addEventListener('click', fetchYouTube);
  dom.ytUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchYouTube();
  });

  function postPlaylist(url, offset, confirmAll) {
    return PinAuth.fetchWithPin('/api/youtube/playlist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, offset, confirmAll }),
    }).then(r => r.json());
  }

  async function fetchYouTubePlaylist(url) {
    setYtProgress('讀取播放清單中', false, true);
    dom.ytFetchBtn.disabled = true;
    dom.ytFetchBtn.textContent = '處理中...';
    // 讀到清單資訊後就會開始分批匯入，先清空欄位讓使用者能接著貼別的連結
    dom.ytUrl.value = '';
    try {
      let data = await postPlaylist(url, 0, false);
      if (!data.success) throw new Error(data.error || '播放清單讀取失敗');
      const LIMIT_FIRST = data.batchSize || 20; // 「只匯入前 N 首」的 N（= 確認門檻）
      let onlyFirst = false;
      if (data.needsConfirm) {
        const all = window.confirm(`此播放清單共 ${data.total} 首。\n確定要全部匯入嗎？（會邊匯入邊出現、邊可播）\n按「取消」將不匯入。`);
        if (!all) { setYtProgress('已取消播放清單匯入', true); return; }
        onlyFirst = false;
        data = await postPlaylist(url, 0, true); // 取得第一批
        if (!data.success) throw new Error(data.error || '播放清單匯入失敗');
      }
      let imported = 0;
      const failures = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const tracks = data.tracks || [];
        if (Array.isArray(data.failures)) failures.push(...data.failures);
        if (tracks.length) {
          state.playlist.push(...tracks);
          AppShared.renderPlaylist();
          SocketClient.send('playlist:add', tracks);
          // 第一首處理好就載入待命，使用者可立刻播放，不必等整個清單
          if (state.currentTrackIndex === -1 && state.playlist.length > 0) AppShared.playTrack(0, false);
          imported += tracks.length;
        }
        const processed = data.processedTo || 0;
        const totalShown = onlyFirst ? Math.min(LIMIT_FIRST, data.total || LIMIT_FIRST) : (data.total || '?');
        setYtProgress(`播放清單匯入中 ${Math.min(processed, totalShown)}/${totalShown} 首（可直接播放已匯入的歌）`, false, true);
        // 只匯入前 N：處理到門檻就停
        if (data.done || (onlyFirst && processed >= LIMIT_FIRST)) break;
        data = await postPlaylist(url, data.nextOffset, true);
        if (!data.success) break;
      }
      const failText = failures.length ? `，${failures.length} 首失敗：${failures.slice(0, 3).map(f => `${f.title}（${f.error}）`).join('；')}` : '';
      AppShared.showToast(`播放清單匯入完成：${imported} 首${failText}`, failures.length ? 'warning' : (imported > 0 ? 'success' : 'warning'));
      setYtProgress(`✓ 播放清單匯入完成：${imported} 首${failures.length ? `，失敗 ${failures.length} 首` : ''}`, true);
    } catch (err) {
      AppShared.showToast('播放清單匯入失敗: ' + err.message, 'error');
      setYtProgress('');
    } finally {
      dom.ytFetchBtn.disabled = false;
      dom.ytFetchBtn.textContent = '取得';
    }
  }

  // ═══════════════════════════════════════════
  // YouTube 匯入佇列
  // 一次只下載一首（yt-dlp+ffmpeg+metadata 解析同時跑多份會 OOM，實機回報）。
  // 貼連結驗證通過即清空輸入欄，使用者可連續快速加歌，佇列在背景逐首處理。
  // 媒體庫「加入清單」的重新下載也走同一佇列。
  // ═══════════════════════════════════════════
  const ytImportQueue = [];   // { url, resolve, reject }
  let ytImportActive = false;
  let ytImportDoneCount = 0;  // 本批已完成數（佇列清空時歸零）
  const activeRequestIds = new Set();

  SocketClient.on('youtube:progress', (data) => {
    if (!data || !activeRequestIds.has(data.requestId)) return;
    const pct = Number.isFinite(data.percent) ? ` ${Math.round(data.percent)}%` : '';
    const detail = data.stage === '失敗' && data.error ? `：${data.error}` : '';
    setYtProgress(`${data.stage || '處理中'}${pct}${detail}`, data.stage === '已完成', data.stage !== '已完成' && data.stage !== '失敗');
  });

  function queueYouTubeImport(url) {
    return new Promise((resolve, reject) => {
      ytImportQueue.push({ url, resolve, reject });
      if (ytImportActive) updateYtQueueProgress();
      if (!ytImportActive) drainYtImportQueue();
    });
  }

  function updateYtQueueProgress() {
    const total = ytImportDoneCount + ytImportQueue.length + (ytImportActive ? 1 : 0);
    const nth = ytImportDoneCount + 1;
    const suffix = total > 1 ? `（第 ${nth}/${total} 首）` : '（首次或長曲較久，請稍候）';
    setYtProgress(`下載並處理中${suffix}`, false, true);
  }

  async function drainYtImportQueue() {
    ytImportActive = true;
    ytImportDoneCount = 0;
    let ok = 0, fail = 0;
    while (ytImportQueue.length) {
      const job = ytImportQueue.shift();
      const requestId = `yt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      updateYtQueueProgress();
      try {
        activeRequestIds.add(requestId);
        const res = await PinAuth.fetchWithPin('/api/youtube', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: job.url, requestId }),
        });
        const data = await res.json();
        if (data.success && data.track) {
          state.playlist.push(data.track);
          AppShared.renderPlaylist();
          SocketClient.send('playlist:add', [data.track]);
          if (state.currentTrackIndex === -1) {
            AppShared.playTrack(state.playlist.length - 1, false); // 匯入後載入待命，不自動播放
          }
          ok++;
          job.resolve(data.track);
        } else {
          const errorMsg = data.error || '未知錯誤';
          const detailMsg = data.details ? `\n詳情: ${data.details}` : '';
          AppShared.showToast('處理失敗: ' + errorMsg + detailMsg, 'error');
          fail++;
          job.reject(new Error(errorMsg));
        }
      } catch (err) {
        AppShared.showToast('YouTube 處理失敗: ' + err.message, 'error');
        fail++;
        job.reject(err);
      } finally {
        activeRequestIds.delete(requestId);
      }
      ytImportDoneCount++;
    }
    ytImportActive = false;
    ytImportDoneCount = 0;
    if (ok > 0) {
      setYtProgress(`✓ 匯入完成：${ok} 首${fail ? `（${fail} 首失敗）` : ''}`, true);
    } else {
      setYtProgress('');
    }
  }

  function fetchYouTube() {
    const url = dom.ytUrl.value.trim();
    if (!url) {
      AppShared.showToast('請輸入 YouTube 連結', 'warning');
      return;
    }
    // 播放清單連結（含 list=）→ 走分批匯入（伺服器端已逐首處理）
    if (/[?&]list=[A-Za-z0-9_-]+/.test(url)) {
      return fetchYouTubePlaylist(url);
    }
    // 驗證 URL 格式
    if (typeof ErrorHandler !== 'undefined') {
      const validation = ErrorHandler.validateYouTubeUrl(url);
      if (!validation.valid) {
        AppShared.showToast(validation.message, 'warning');
        return;
      }
    }

    // 驗證通過＝知道要抓什麼了 → 立即清空欄位讓使用者能接著貼下一首；下載交給佇列。
    dom.ytUrl.value = '';
    queueYouTubeImport(url).catch(() => { /* 失敗已在佇列內 toast，這裡吞掉避免 unhandled */ });
  }

  // YT 進度文字。busy=true 時附加動態點點（CSS 動畫），讓使用者知道程式在跑而不是卡住。
  let _ytProgressClearTimer = null;
  function setYtProgress(msg, autoClear, busy) {
    if (!dom.ytProgress) return;
    if (_ytProgressClearTimer) { clearTimeout(_ytProgressClearTimer); _ytProgressClearTimer = null; }
    dom.ytProgress.textContent = msg || '';
    if (busy && msg) {
      const dots = document.createElement('span');
      dots.className = 'busy-dots';
      dom.ytProgress.appendChild(dots);
    }
    if (autoClear) {
      _ytProgressClearTimer = setTimeout(() => { dom.ytProgress.textContent = ''; _ytProgressClearTimer = null; }, 4000);
    }
  }

  // 供 window.VKState.importYouTubeUrl（app.js）與媒體庫（media-library.js）呼叫
  AppShared.queueYouTubeImport = queueYouTubeImport;
})();
