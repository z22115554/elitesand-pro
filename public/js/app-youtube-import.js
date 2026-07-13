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

  function postPlaylist(url) {
    return PinAuth.fetchWithPin('/api/youtube/playlist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }).then(r => r.json());
  }

  async function fetchYouTubePlaylist(url) {
    setYtProgress('讀取播放清單中', false, true);
    dom.ytFetchBtn.disabled = true;
    dom.ytFetchBtn.textContent = '處理中...';
    // 先掃出條目，再全部送進既有單工佇列；每首輪到時才做風險檢查與下載。
    dom.ytUrl.value = '';
    try {
      const data = await postPlaylist(url);
      if (!data.success) throw new Error(data.error || '播放清單讀取失敗');
      if (data.needsConfirm) {
        const all = window.confirm(`此播放清單共 ${data.total} 首。\n確定要全部匯入嗎？（會邊匯入邊出現、邊可播）\n按「取消」將不匯入。`);
        if (!all) { setYtProgress('已取消播放清單匯入', true); return; }
      }
      const entries = Array.isArray(data.entries) ? data.entries : [];
      const imports = entries.map((entry, index) => queueYouTubeImport(entry.url, {
        source: `播放清單 ${index + 1}/${entries.length}`,
        label: entry.title || `播放清單第 ${index + 1} 首`,
      }));
      dom.ytFetchBtn.disabled = false;
      dom.ytFetchBtn.textContent = '匯入音訊';
      setYtProgress(`已排入 ${imports.length} 首，將逐首檢查後匯入`, false, true);
      const results = await Promise.allSettled(imports);
      const imported = results.filter(result => result.status === 'fulfilled').length;
      const skipped = results.filter(result => result.status === 'rejected' && result.reason?.code === 'IMPORT_SKIPPED').length;
      const failed = results.length - imported - skipped;
      const suffix = `${skipped ? `，略過 ${skipped} 首` : ''}${failed ? `，失敗 ${failed} 首` : ''}`;
      AppShared.showToast(`播放清單匯入完成：${imported} 首${suffix}`, skipped || failed ? 'warning' : 'success');
      setYtProgress(`✓ 播放清單匯入完成：${imported} 首${suffix}`, true);
    } catch (err) {
      AppShared.showToast('播放清單匯入失敗: ' + err.message, 'error');
      setYtProgress('');
    } finally {
      dom.ytFetchBtn.disabled = false;
      dom.ytFetchBtn.textContent = '匯入音訊';
    }
  }

  // ═══════════════════════════════════════════
  // YouTube 匯入佇列
  // 一次只下載一首（yt-dlp+ffmpeg+metadata 解析同時跑多份會 OOM，實機回報）。
  // 貼連結驗證通過即清空輸入欄，使用者可連續快速加歌，佇列在背景逐首處理。
  // 媒體庫「加入清單」的重新下載也走同一佇列。
  // ═══════════════════════════════════════════
  const ytImportQueue = [];   // work job objects waiting to start
  const ytImportJobs = [];    // recent queue/active/completed/failed history
  let ytImportActive = false;
  let activeImportJob = null;
  let ytImportDoneCount = 0;  // 本批已完成數（佇列清空時歸零）
  const activeRequestIds = new Set();
  const workCenter = document.getElementById('work-center');
  const workCenterList = document.getElementById('work-center-list');
  const workCenterClear = document.getElementById('work-center-clear');
  const RISK_WARNING_DISABLED_KEY = 'elite-youtube-risk-warning-disabled-v1';
  const riskPreference = document.getElementById('youtube-risk-preference');
  const riskPreferenceReset = document.getElementById('youtube-risk-reset');

  function riskWarningsDisabled() {
    try { return localStorage.getItem(RISK_WARNING_DISABLED_KEY) === '1'; } catch (_) { return false; }
  }

  function setRiskWarningsDisabled(disabled) {
    try {
      if (disabled) localStorage.setItem(RISK_WARNING_DISABLED_KEY, '1');
      else localStorage.removeItem(RISK_WARNING_DISABLED_KEY);
    } catch (_) { /* 無痕模式可能拒絕 localStorage */ }
    if (riskPreference) riskPreference.hidden = !disabled;
  }

  setRiskWarningsDisabled(riskWarningsDisabled());
  riskPreferenceReset?.addEventListener('click', () => {
    setRiskWarningsDisabled(false);
    AppShared.showToast('已重新啟用 YouTube 匯入警告', 'success');
  });

  function formatDuration(seconds) {
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  }

  function confirmRiskAssessment(assessment) {
    if (!assessment?.warning || riskWarningsDisabled()) return Promise.resolve(true);
    const modal = document.getElementById('youtube-risk-modal');
    if (!modal) return Promise.resolve(window.confirm((assessment.warnings || []).join('\n')));
    const title = document.getElementById('youtube-risk-title');
    const author = document.getElementById('youtube-risk-author');
    const duration = document.getElementById('youtube-risk-duration');
    const warnings = document.getElementById('youtube-risk-reasons');
    const thumbnail = document.getElementById('youtube-risk-thumbnail');
    const remember = document.getElementById('youtube-risk-disable');
    const skip = document.getElementById('youtube-risk-skip');
    const proceed = document.getElementById('youtube-risk-proceed');
    title.textContent = assessment.title || '無法取得影片標題';
    author.textContent = assessment.author || '未知頻道';
    duration.textContent = assessment.duration > 0 ? formatDuration(assessment.duration) : '時長未知';
    warnings.textContent = '';
    for (const reason of assessment.warnings || ['無法確認影片是否適合匯入']) {
      const item = document.createElement('li'); item.textContent = reason; warnings.appendChild(item);
    }
    thumbnail.hidden = !assessment.thumbnail;
    if (assessment.thumbnail) thumbnail.src = assessment.thumbnail;
    remember.checked = false;
    modal.hidden = false;
    return new Promise((resolve) => {
      const finish = (allowed) => {
        if (remember.checked) setRiskWarningsDisabled(true);
        modal.hidden = true;
        skip.removeEventListener('click', onSkip);
        proceed.removeEventListener('click', onProceed);
        modal.removeEventListener('click', onBackdrop);
        resolve(allowed);
      };
      const onSkip = () => finish(false);
      const onProceed = () => finish(true);
      const onBackdrop = (event) => { if (event.target === modal) finish(false); };
      skip.addEventListener('click', onSkip);
      proceed.addEventListener('click', onProceed);
      modal.addEventListener('click', onBackdrop);
      proceed.focus();
    });
  }

  async function inspectImport(job) {
    if (job.assessment) return job.assessment;
    updateJob(job, { stage: '正在檢查影片', message: '正在檢查時長與內容類型' });
    const response = await PinAuth.fetchWithPin('/api/youtube/inspect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: job.url, requestId: job.requestId }),
    });
    const data = await response.json();
    if (response.ok && data.success && data.assessment) return data.assessment;
    if (data.code === 'IMPORT_CANCELLED') {
      const cancelled = new Error(data.error || '匯入已取消');
      cancelled.code = 'IMPORT_CANCELLED';
      throw cancelled;
    }
    return {
      warning: true,
      warningTypes: ['metadata-unavailable'],
      warnings: [`無法在下載前確認影片資訊：${data.error || '未知原因'}`],
      title: job.label,
      author: '', duration: 0, thumbnail: '',
    };
  }

  function jobLabel(url, source) {
    try {
      const id = new URL(url).searchParams.get('v') || url.split('/').filter(Boolean).pop();
      return `${source || 'YouTube'} · ${id || '待解析連結'}`;
    } catch (_) { return source || 'YouTube 匯入'; }
  }

  function renderWorkCenter() {
    if (!workCenter || !workCenterList) return;
    workCenter.hidden = ytImportJobs.length === 0;
    workCenterList.textContent = '';
    const pending = ytImportQueue.filter((job) => job.status === 'queued');
    for (const job of ytImportJobs.slice(0, 20)) {
      const row = document.createElement('div');
      row.className = 'work-item';
      row.dataset.jobId = job.id;
      const title = document.createElement('div');
      title.className = 'work-item-title';
      title.textContent = job.label;
      title.title = job.url;
      const stateEl = document.createElement('div');
      stateEl.className = 'work-item-state';
      stateEl.dataset.state = job.status;
      const queueIndex = pending.indexOf(job);
      stateEl.textContent = job.status === 'queued'
        ? `等待中 · 佇列第 ${queueIndex + 1} 位`
        : (job.message || job.stage || job.status);
      const actions = document.createElement('div');
      actions.className = 'work-item-actions';
      if (job.status === 'queued' || job.status === 'active' || job.status === 'cancelling') {
        const cancel = document.createElement('button');
        cancel.type = 'button'; cancel.className = 'btn btn-sm btn-ghost'; cancel.dataset.workAction = 'cancel';
        cancel.textContent = job.status === 'cancelling' ? '取消中…' : '取消';
        cancel.disabled = job.status === 'cancelling';
        actions.appendChild(cancel);
      } else if (job.status === 'failed' || job.status === 'cancelled') {
        const retry = document.createElement('button');
        retry.type = 'button'; retry.className = 'btn btn-sm btn-ghost'; retry.dataset.workAction = 'retry'; retry.textContent = '重試';
        actions.appendChild(retry);
      }
      row.append(title, stateEl, actions);
      if (job.status === 'active' && Number.isFinite(job.percent)) {
        const progress = document.createElement('div');
        progress.className = 'work-item-progress';
        const fill = document.createElement('span');
        fill.style.setProperty('--work-progress', `${Math.max(0, Math.min(100, job.percent))}%`);
        progress.appendChild(fill); row.appendChild(progress);
      }
      workCenterList.appendChild(row);
    }
  }

  function updateJob(job, partial) {
    Object.assign(job, partial, { updatedAt: Date.now() });
    renderWorkCenter();
  }

  function cancelQueuedJob(job) {
    const index = ytImportQueue.indexOf(job);
    if (index < 0) return false;
    ytImportQueue.splice(index, 1);
    const error = new Error('匯入已取消'); error.code = 'IMPORT_CANCELLED';
    updateJob(job, { status: 'cancelled', message: '已取消，未開始下載' });
    job.reject(error);
    return true;
  }

  async function cancelImportJob(job) {
    if (job.status === 'queued') { cancelQueuedJob(job); return; }
    if (job !== activeImportJob || !job.requestId) return;
    job.cancelRequested = true;
    if (job.stage === '等待使用者確認') {
      updateJob(job, { status: 'cancelling', message: '將略過這項匯入' });
      document.getElementById('youtube-risk-skip')?.click();
      return;
    }
    updateJob(job, { status: 'cancelling', message: '正在停止匯入…' });
    try {
      const response = await PinAuth.fetchWithPin('/api/youtube/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: job.requestId }),
      });
      const result = await response.json();
      if (!response.ok) updateJob(job, { status: 'active', message: result.message || '工作已完成，無法取消' });
    } catch (error) {
      updateJob(job, { status: 'active', message: `取消要求失敗：${error.message}` });
    }
  }

  workCenterList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-work-action]');
    const row = button?.closest('[data-job-id]');
    const job = row && ytImportJobs.find((item) => item.id === row.dataset.jobId);
    if (!button || !job) return;
    if (button.dataset.workAction === 'cancel') cancelImportJob(job);
    if (button.dataset.workAction === 'retry') queueYouTubeImport(job.url, { source: job.source }).catch(() => {});
  });
  workCenterClear?.addEventListener('click', () => {
    for (let i = ytImportJobs.length - 1; i >= 0; i--) {
      if (['completed', 'cancelled'].includes(ytImportJobs[i].status)) ytImportJobs.splice(i, 1);
    }
    renderWorkCenter();
  });

  SocketClient.on('youtube:progress', (data) => {
    if (!data || !activeRequestIds.has(data.requestId)) return;
    const pct = Number.isFinite(data.percent) ? ` ${Math.round(data.percent)}%` : '';
    const detail = data.stage === '失敗' && data.error ? `：${data.error}` : '';
    setYtProgress(`${data.stage || '處理中'}${pct}${detail}`, data.stage === '已完成', data.stage !== '已完成' && data.stage !== '失敗');
    if (activeImportJob?.requestId === data.requestId) {
      updateJob(activeImportJob, { stage: data.stage || '處理中', percent: data.percent, message: detail ? `${data.stage}${detail}` : data.stage });
    }
  });

  function queueYouTubeImport(url, options = {}) {
    return new Promise((resolve, reject) => {
      const job = {
        id: `work-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url, source: options.source || 'YouTube', label: options.label || jobLabel(url, options.source),
        replaceTrackId: options.replaceTrackId || null,
        assessment: options.assessment || null,
        status: 'queued', stage: '等待中', percent: 0, resolve, reject, createdAt: Date.now(),
      };
      ytImportQueue.push(job);
      ytImportJobs.unshift(job);
      renderWorkCenter();
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
      activeImportJob = job;
      updateJob(job, { status: 'active', requestId, stage: '準備匯入', message: '準備匯入', percent: 0 });
      updateYtQueueProgress();
      try {
        const assessment = await inspectImport(job);
        if (job.cancelRequested) { const cancelled = new Error('匯入已取消'); cancelled.code = 'IMPORT_CANCELLED'; throw cancelled; }
        if (assessment?.warning && !riskWarningsDisabled()) updateJob(job, { stage: '等待使用者確認', message: '需要確認影片資訊' });
        const allowed = await confirmRiskAssessment(assessment);
        if (!allowed) {
          const skipped = new Error('已略過有警告的影片'); skipped.code = 'IMPORT_SKIPPED'; throw skipped;
        }
        updateJob(job, { status: 'active', stage: '準備下載', message: '已通過匯入檢查' });
        activeRequestIds.add(requestId);
        const res = await PinAuth.fetchWithPin('/api/youtube', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: job.url, requestId }),
        });
        const data = await res.json();
        if (res.ok && data.success && data.track) {
          if (job.replaceTrackId) {
            const index = state.playlist.findIndex((track) => track.id === job.replaceTrackId);
            if (index >= 0) {
              const previous = state.playlist[index];
              data.track = {
                ...data.track,
                ...previous,
                filename: data.track.filename,
                duration: data.track.duration || previous.duration,
                cover: data.track.cover || previous.cover,
              };
              state.playlist.splice(index, 1, data.track);
              SocketClient.sendWithCallback('playlist:update', state.playlist, (result) => {
                if (!result?.ok) AppShared.showToast(`重新下載後更新清單失敗：${result?.error || '伺服器沒有確認'}`, 'error');
              });
            } else {
              state.playlist.push(data.track);
              SocketClient.send('playlist:add', [data.track]);
            }
          } else {
            state.playlist.push(data.track);
            SocketClient.send('playlist:add', [data.track]);
          }
          AppShared.renderPlaylist();
          if (state.currentTrackIndex === -1) {
            AppShared.playTrack(state.playlist.length - 1, false); // 匯入後載入待命，不自動播放
          }
          ok++;
          updateJob(job, { status: 'completed', stage: '已完成', message: `已加入播放清單：${data.track.title}`, percent: 100 });
          job.resolve(data.track);
        } else {
          const errorMsg = data.error || '未知錯誤';
          const recovery = data.recovery ? ` ${data.recovery}` : '';
          const error = new Error(`${errorMsg}${recovery}`);
          error.code = data.code || 'IMPORT_FAILED';
          error.retryable = data.retryable !== false;
          AppShared.showToast(error.message, error.code === 'IMPORT_CANCELLED' ? 'info' : 'error');
          fail++;
          updateJob(job, {
            status: error.code === 'IMPORT_CANCELLED' ? 'cancelled' : 'failed',
            stage: error.code === 'IMPORT_CANCELLED' ? '已取消' : '失敗', message: error.message, errorCode: error.code,
          });
          job.reject(error);
        }
      } catch (err) {
        const intentionallyStopped = err.code === 'IMPORT_CANCELLED' || err.code === 'IMPORT_SKIPPED';
        if (!intentionallyStopped) AppShared.showToast('YouTube 匯入失敗：' + err.message, 'error');
        if (!intentionallyStopped) fail++;
        updateJob(job, {
          status: intentionallyStopped ? 'cancelled' : 'failed',
          stage: err.code === 'IMPORT_SKIPPED' ? '已略過' : err.code === 'IMPORT_CANCELLED' ? '已取消' : '失敗',
          message: err.message, errorCode: err.code || 'NETWORK_ERROR',
        });
        job.reject(err);
      } finally {
        activeRequestIds.delete(requestId);
        if (activeImportJob === job) activeImportJob = null;
      }
      ytImportDoneCount++;
      renderWorkCenter();
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
