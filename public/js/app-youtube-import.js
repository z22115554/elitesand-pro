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
  const fallbackCatalog = Object.freeze({ ...(window.I18n?.catalogs?.['zh-TW'] || {}) });
  const fallbackT = (key, vars = {}) => {
    const template = fallbackCatalog[key];
    return typeof template === 'string'
      ? template.replace(/\{([^}]+)\}/g, (token, name) => Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : token)
      : '';
  };
  const t = (key, vars) => window.I18n ? window.I18n.t(key, vars) : fallbackT(key, vars);
  const tr = (value) => window.I18n ? window.I18n.translate(value) : value;
  const currentLocale = () => window.I18n?.current?.() || 'zh-TW';
  const formatNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? new Intl.NumberFormat(currentLocale()).format(number) : '—';
  };
  const stageKeys = Object.freeze({
    '正在檢查影片': 'import.stage.inspecting',
    '正在檢查時長與內容類型': 'import.stage.inspectDetails',
    '等待中': 'import.stage.waiting',
    '準備匯入': 'import.stage.preparing',
    '等待使用者確認': 'import.stage.waitingForConfirmation',
    '需要確認影片資訊': 'import.stage.needsAssessment',
    '準備下載': 'import.stage.preparingDownload',
    '已通過匯入檢查': 'import.stage.checkPassed',
    '正在取得影片資訊': 'import.stage.gettingInfo',
    '正在下載': 'import.stage.downloading',
    '正在轉換音訊': 'import.stage.convertingAudio',
    '正在搜尋歌詞': 'import.stage.searchingLyrics',
    '已完成': 'import.stage.completed',
    '已取消': 'import.stage.cancelled',
    '已略過': 'import.stage.skipped',
    '失敗': 'import.stage.failed',
    '處理中': 'import.stage.processing',
  });
  // Keep Socket stages/errors and external metadata raw in job state. Only local
  // stages and UI framing are translated when rendering the current locale.
  const localizedStage = (value) => stageKeys[value] ? t(stageKeys[value]) : String(value || '');
  const progressStatus = (stage, percent, error) => t('import.progress.status', {
    stage: localizedStage(stage),
    percent: Number.isFinite(percent) ? t('import.progress.percent', { value: formatNumber(Math.round(percent)) }) : '',
    error: error ? t('import.progress.error', { message: error }) : '',
  });

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
      dom.dropZone.innerHTML = `<div class="hint">${t('import.uploading')}</div>`;

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
        const reason = data.error || t('import.fileRejected');
        const detail = data.details ? `（${data.details}）` : '';
        AppShared.showToast(t('import.uploadFailed', { message: reason + detail }), 'error');
      }
    } catch (err) {
      console.error('上傳失敗:', err);
      AppShared.showToast(t('import.uploadFailed', { message: err.message }), 'error');
    } finally {
      dom.dropZone.innerHTML = `
        <div class="hint">${t('source.dropFiles')}</div>
        <div class="sub">${t('source.supportedFormats')}</div>
        <button id="browse-btn" class="btn btn-sm" type="button">${t('source.chooseFiles')}</button>
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

  function playlistResultVars(imported, skipped, failed) {
    return {
      imported: formatNumber(imported),
      skipped: skipped ? t('import.playlist.skippedSuffix', { count: formatNumber(skipped) }) : '',
      failed: failed ? t('import.playlist.failedSuffix', { count: formatNumber(failed) }) : '',
    };
  }

  function queueResultVars(imported, failed) {
    return {
      count: formatNumber(imported),
      failed: failed ? t('import.queue.failedSuffix', { count: formatNumber(failed) }) : '',
    };
  }

  async function fetchYouTubePlaylist(url) {
    setYtProgressKey('import.playlist.loading', {}, false, true);
    dom.ytFetchBtn.disabled = true;
    dom.ytFetchBtn.textContent = t('import.playlist.processing');
    // 先掃出條目，再全部送進既有單工佇列；每首輪到時才做風險檢查與下載。
    dom.ytUrl.value = '';
    try {
      const data = await postPlaylist(url);
      if (!data.success) throw new Error(data.error || t('import.playlist.loadFailed'));
      if (data.needsConfirm) {
        const all = await window.PanelConfirm?.request({
          title: t('import.playlist.confirmTitle', { count: formatNumber(data.total) }),
          summary: t('import.playlist.confirmSummary'),
          impact: t('import.playlist.confirmImpact'),
          confirmLabel: t('import.playlist.confirmStart'),
        });
        if (!all) { setYtProgressKey('import.playlist.cancelled', {}, true); return; }
      }
      const entries = Array.isArray(data.entries) ? data.entries : [];
      const imports = entries.map((entry, index) => queueYouTubeImport(entry.url, {
        source: `播放清單 ${index + 1}/${entries.length}`,
        sourceKey: 'import.playlist.source',
        sourceVars: { index: index + 1, total: entries.length },
        label: entry.title || '',
        labelKey: entry.title ? '' : 'import.playlist.itemFallbackLabel',
        labelVars: { index: index + 1 },
      }));
      dom.ytFetchBtn.disabled = false;
      dom.ytFetchBtn.textContent = t('source.importAudio');
      setYtProgressKey('import.playlist.queued', { count: imports.length }, false, true);
      const results = await Promise.allSettled(imports);
      const imported = results.filter(result => result.status === 'fulfilled').length;
      const skipped = results.filter(result => result.status === 'rejected' && result.reason?.code === 'IMPORT_SKIPPED').length;
      const failed = results.length - imported - skipped;
      const resultVars = playlistResultVars(imported, skipped, failed);
      AppShared.showToast(t('import.playlist.complete', resultVars), skipped || failed ? 'warning' : 'success');
      setYtProgressPlaylistResult(imported, skipped, failed, true);
    } catch (err) {
      AppShared.showToast(t('import.playlist.failed', { message: err.message }), 'error');
      setYtProgress('');
    } finally {
      dom.ytFetchBtn.disabled = false;
      dom.ytFetchBtn.textContent = t('source.importAudio');
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
    AppShared.showToast(t('import.riskWarningsReenabled'), 'success');
  });

  function formatDuration(seconds) {
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  }

  let activeRiskAssessment = null;

  function renderRiskAssessment(assessment) {
    const title = document.getElementById('youtube-risk-title');
    const author = document.getElementById('youtube-risk-author');
    const duration = document.getElementById('youtube-risk-duration');
    const warnings = document.getElementById('youtube-risk-reasons');
    const thumbnail = document.getElementById('youtube-risk-thumbnail');
    if (!title || !author || !duration || !warnings || !thumbnail) return false;
    title.textContent = assessment.title || t('import.assessment.unknownTitle');
    author.textContent = assessment.author || t('import.assessment.unknownChannel');
    duration.textContent = assessment.duration > 0 ? formatDuration(assessment.duration) : t('import.assessment.unknownDuration');
    warnings.textContent = '';
    for (const reason of assessment.warnings || [t('import.assessment.unavailable')]) {
      const item = document.createElement('li'); item.textContent = reason; warnings.appendChild(item);
    }
    thumbnail.hidden = !assessment.thumbnail;
    if (assessment.thumbnail) thumbnail.src = assessment.thumbnail;
    return true;
  }

  function confirmRiskAssessment(assessment) {
    if (!assessment?.warning || riskWarningsDisabled()) return Promise.resolve(true);
    const modal = document.getElementById('youtube-risk-modal');
    if (!modal) return Promise.resolve(false);
    const remember = document.getElementById('youtube-risk-disable');
    const skip = document.getElementById('youtube-risk-skip');
    const proceed = document.getElementById('youtube-risk-proceed');
    if (!remember || !skip || !proceed || !renderRiskAssessment(assessment)) return Promise.resolve(false);
    activeRiskAssessment = assessment;
    remember.checked = false;
    modal.hidden = false;
    return new Promise((resolve) => {
      const finish = (allowed) => {
        if (remember.checked) setRiskWarningsDisabled(true);
        modal.hidden = true;
        activeRiskAssessment = null;
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
    updateJob(job, { stage: '正在檢查影片', messageKey: 'import.stage.inspectDetails' });
    const response = await PinAuth.fetchWithPin('/api/youtube/inspect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: job.url, requestId: job.requestId }),
    });
    const data = await response.json();
    if (response.ok && data.success && data.assessment) return data.assessment;
    if (data.code === 'IMPORT_CANCELLED') {
      const cancelled = new Error(data.error || t('import.stage.cancelled'));
      cancelled.code = 'IMPORT_CANCELLED';
      throw cancelled;
    }
    return {
      warning: true,
      warningTypes: ['metadata-unavailable'],
      warnings: [t('import.assessment.unavailableWithReason', { message: data.error || t('import.assessment.unknownReason') })],
      title: job.label,
      author: '', duration: 0, thumbnail: '',
    };
  }

  function jobLabelParts(url, source) {
    try {
      const id = new URL(url).searchParams.get('v') || url.split('/').filter(Boolean).pop();
      return { key: 'import.job.defaultLabel', vars: { source: source || t('import.job.defaultSource'), id: id || t('import.job.unresolvedLink') } };
    } catch (_) {
      return { key: 'import.job.defaultLabel', vars: { source: source || t('import.job.defaultSource'), id: t('import.job.unresolvedLink') } };
    }
  }

  function displayJobSource(job) {
    if (job.sourceKey) return t(job.sourceKey, formatImportVars(job.sourceVars));
    return job.source || t('import.job.defaultSource');
  }

  function displayJobLabel(job) {
    if (job.label) return job.label;
    if (job.labelKey) return t(job.labelKey, formatImportVars(job.labelVars));
    const fallback = jobLabelParts(job.url, displayJobSource(job));
    return t(fallback.key, fallback.vars);
  }

  function displayJobState(job, queueIndex) {
    if (job.status === 'queued') return t('import.job.queued', { position: formatNumber(queueIndex + 1) });
    if (job.progressStage) return progressStatus(job.progressStage, job.percent, job.progressError);
    if (job.completedPlacement) return t('import.job.completed', { placement: t(job.completedPlacement), title: job.completedTitle || '' });
    if (job.errorMessage) return t('import.error.importFailed', { message: job.errorMessage });
    if (job.messageKey) return t(job.messageKey, job.messageVars);
    if (job.message) return job.message;
    if (job.stage) return localizedStage(job.stage);
    return localizedStage(job.status);
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
      title.textContent = displayJobLabel(job);
      title.title = job.url;
      const stateEl = document.createElement('div');
      stateEl.className = 'work-item-state';
      stateEl.dataset.state = job.status;
      const queueIndex = pending.indexOf(job);
      stateEl.textContent = displayJobState(job, queueIndex);
      const actions = document.createElement('div');
      actions.className = 'work-item-actions';
      if (job.status === 'queued' || job.status === 'active' || job.status === 'cancelling') {
        const cancel = document.createElement('button');
        cancel.type = 'button'; cancel.className = 'btn btn-sm btn-ghost'; cancel.dataset.workAction = 'cancel';
        cancel.textContent = job.status === 'cancelling' ? t('import.job.cancelling') : t('import.job.cancel');
        cancel.disabled = job.status === 'cancelling';
        actions.appendChild(cancel);
      } else if (job.status === 'failed' || job.status === 'cancelled') {
        const retry = document.createElement('button');
        retry.type = 'button'; retry.className = 'btn btn-sm btn-ghost'; retry.dataset.workAction = 'retry'; retry.textContent = t('import.job.retry');
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
    const next = { ...partial };
    if ((Object.prototype.hasOwnProperty.call(next, 'stage') || Object.prototype.hasOwnProperty.call(next, 'messageKey'))
      && !Object.prototype.hasOwnProperty.call(next, 'progressStage')) next.progressStage = '';
    Object.assign(job, next, { updatedAt: Date.now() });
    renderWorkCenter();
  }

  function cancelQueuedJob(job) {
    const index = ytImportQueue.indexOf(job);
    if (index < 0) return false;
    ytImportQueue.splice(index, 1);
    const error = new Error('匯入已取消'); error.code = 'IMPORT_CANCELLED';
    updateJob(job, { status: 'cancelled', stage: '已取消', messageKey: 'import.job.cancelledBeforeStart' });
    job.reject(error);
    return true;
  }

  async function cancelImportJob(job) {
    if (job.status === 'queued') { cancelQueuedJob(job); return; }
    if (job !== activeImportJob || !job.requestId) return;
    job.cancelRequested = true;
    if (job.stage === '等待使用者確認') {
      updateJob(job, { status: 'cancelling', messageKey: 'import.job.skipping' });
      document.getElementById('youtube-risk-skip')?.click();
      return;
    }
    updateJob(job, { status: 'cancelling', messageKey: 'import.job.stopping' });
    try {
      const response = await PinAuth.fetchWithPin('/api/youtube/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: job.requestId }),
      });
      const result = await response.json();
      if (!response.ok) {
        updateJob(job, result.message
          ? { status: 'active', message: result.message, messageKey: '' }
          : { status: 'active', messageKey: 'import.job.cannotCancel' });
      }
    } catch (error) {
      updateJob(job, { status: 'active', messageKey: 'import.job.cancelFailed', messageVars: { message: error.message } });
    }
  }

  workCenterList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-work-action]');
    const row = button?.closest('[data-job-id]');
    const job = row && ytImportJobs.find((item) => item.id === row.dataset.jobId);
    if (!button || !job) return;
    if (button.dataset.workAction === 'cancel') cancelImportJob(job);
    if (button.dataset.workAction === 'retry') {
      queueYouTubeImport(job.url, {
        source: job.source,
        sourceKey: job.sourceKey,
        sourceVars: job.sourceVars,
        label: job.label,
        labelKey: job.labelKey,
        labelVars: job.labelVars,
      }).catch(() => {});
    }
  });
  workCenterClear?.addEventListener('click', () => {
    for (let i = ytImportJobs.length - 1; i >= 0; i--) {
      if (['completed', 'cancelled'].includes(ytImportJobs[i].status)) ytImportJobs.splice(i, 1);
    }
    renderWorkCenter();
  });

  SocketClient.on('youtube:progress', (data) => {
    if (!data || !activeRequestIds.has(data.requestId)) return;
    const stage = data.stage || '處理中';
    const error = stage === '失敗' ? data.error || '' : '';
    setYtProgressStage(stage, data.percent, error, stage === '已完成', stage !== '已完成' && stage !== '失敗');
    if (activeImportJob?.requestId === data.requestId) {
      updateJob(activeImportJob, { stage, progressStage: stage, progressError: error, percent: data.percent, messageKey: '' });
    }
  });

  function queueYouTubeImport(url, options = {}) {
    return new Promise((resolve, reject) => {
      const job = {
        id: `work-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url,
        source: options.source || 'YouTube',
        sourceKey: options.sourceKey || (!options.source ? 'import.job.defaultSource' : ''),
        sourceVars: options.sourceVars || {},
        label: options.label || '',
        labelKey: options.labelKey || '',
        labelVars: options.labelVars || {},
        replaceTrackId: options.replaceTrackId || null,
        placement: options.placement === 'next' ? 'next' : 'end',
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
    setYtProgressQueue(nth, total, false, true);
  }

  async function drainYtImportQueue() {
    ytImportActive = true;
    ytImportDoneCount = 0;
    let ok = 0, fail = 0;
    while (ytImportQueue.length) {
      const job = ytImportQueue.shift();
      const requestId = `yt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      activeImportJob = job;
      updateJob(job, { status: 'active', requestId, stage: '準備匯入', messageKey: 'import.stage.preparing', percent: 0, errorMessage: '', completedPlacement: '' });
      updateYtQueueProgress();
      try {
        const assessment = await inspectImport(job);
        if (job.cancelRequested) { const cancelled = new Error(t('import.stage.cancelled')); cancelled.code = 'IMPORT_CANCELLED'; throw cancelled; }
        if (assessment?.warning && !riskWarningsDisabled()) updateJob(job, { stage: '等待使用者確認', messageKey: 'import.stage.needsAssessment' });
        const allowed = await confirmRiskAssessment(assessment);
        if (!allowed) {
          const skipped = new Error(t('import.stage.skipped')); skipped.code = 'IMPORT_SKIPPED'; throw skipped;
        }
        updateJob(job, { status: 'active', stage: '準備下載', messageKey: 'import.stage.checkPassed' });
        activeRequestIds.add(requestId);
        const res = await PinAuth.fetchWithPin('/api/youtube', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: job.url, requestId }),
        });
        const data = await res.json();
        if (res.ok && data.success && data.track) {
          let placement = null;
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
                if (!result?.ok) AppShared.showToast(t('import.error.playlistUpdateFailed', { message: result?.error || t('import.error.serverUnconfirmed') }), 'error');
              });
            } else {
              state.playlist.push(data.track);
              SocketClient.send('playlist:add', [data.track]);
            }
          } else if (job.placement === 'next') {
            placement = await new Promise((resolve) => {
              SocketClient.sendWithCallback('playlist:insert-next', data.track, resolve);
            });
            if (!placement?.ok) {
              const error = new Error(placement?.error || '無法把歌曲插到下一首');
              error.code = placement?.code || 'PLAYLIST_INSERT_FAILED';
              throw error;
            }
          } else {
            state.playlist.push(data.track);
            SocketClient.send('playlist:add', [data.track]);
          }
          AppShared.renderPlaylist();
          if (state.currentTrackIndex === -1 && job.placement !== 'next') {
            AppShared.playTrack(state.playlist.length - 1, false); // 匯入後載入待命，不自動播放
          } else if (state.currentTrackIndex === -1 && placement?.placement === 'end') {
            // playlist:update is emitted before the server acknowledgement, so by
            // this point the authoritative appended track is already in state.
            AppShared.playTrack(placement.insertAt, false);
          }
          ok++;
          const placementKey = job.placement === 'next'
            ? (placement?.placement === 'next' ? 'import.placement.next' : 'import.placement.endBecauseIdle')
            : 'import.placement.added';
          updateJob(job, { status: 'completed', stage: '已完成', completedPlacement: placementKey, completedTitle: data.track.title, percent: 100, messageKey: '', errorMessage: '' });
          job.resolve(data.track);
        } else {
          const errorMsg = data.error || t('import.error.unknown');
          const recovery = data.recovery ? ` ${data.recovery}` : '';
          const error = new Error(`${errorMsg}${recovery}`);
          error.code = data.code || 'IMPORT_FAILED';
          error.retryable = data.retryable !== false;
          AppShared.showToast(t('import.error.importFailed', { message: error.message }), error.code === 'IMPORT_CANCELLED' ? 'info' : 'error');
          fail++;
          updateJob(job, {
            status: error.code === 'IMPORT_CANCELLED' ? 'cancelled' : 'failed',
            stage: error.code === 'IMPORT_CANCELLED' ? '已取消' : '失敗', messageKey: '', message: '', errorMessage: error.code === 'IMPORT_CANCELLED' ? '' : error.message, errorCode: error.code,
          });
          job.reject(error);
        }
      } catch (err) {
        const intentionallyStopped = err.code === 'IMPORT_CANCELLED' || err.code === 'IMPORT_SKIPPED';
        if (!intentionallyStopped) AppShared.showToast(t('import.error.importFailed', { message: err.message }), 'error');
        if (!intentionallyStopped) fail++;
        updateJob(job, {
          status: intentionallyStopped ? 'cancelled' : 'failed',
          stage: err.code === 'IMPORT_SKIPPED' ? '已略過' : err.code === 'IMPORT_CANCELLED' ? '已取消' : '失敗',
          messageKey: '', message: '', errorMessage: intentionallyStopped ? '' : err.message, errorCode: err.code || 'NETWORK_ERROR',
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
      setYtProgressQueueResult(ok, fail, true);
    } else {
      setYtProgress('');
    }
  }

  function fetchYouTube() {
    const url = dom.ytUrl.value.trim();
    if (!url) {
      AppShared.showToast(t('import.enterYouTubeLink'), 'warning');
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
  let ytProgressState = { type: 'text', text: '', busy: false };
  const formatImportVars = (vars = {}) => Object.fromEntries(Object.entries(vars).map(([key, value]) => [key,
    typeof value === 'number' && Number.isFinite(value) ? formatNumber(value) : value,
  ]));

  function progressText() {
    if (ytProgressState.type === 'key') return t(ytProgressState.key, formatImportVars(ytProgressState.vars));
    if (ytProgressState.type === 'stage') return progressStatus(ytProgressState.stage, ytProgressState.percent, ytProgressState.error);
    if (ytProgressState.type === 'playlistResult') {
      return t('import.playlist.completeProgress', playlistResultVars(ytProgressState.imported, ytProgressState.skipped, ytProgressState.failed));
    }
    if (ytProgressState.type === 'queueResult') {
      return t('import.queue.complete', queueResultVars(ytProgressState.imported, ytProgressState.failed));
    }
    if (ytProgressState.type === 'queue') {
      const detail = ytProgressState.total > 1
        ? t('import.progress.queuePosition', { current: formatNumber(ytProgressState.current), total: formatNumber(ytProgressState.total) })
        : t('import.progress.firstItem');
      return t('import.progress.downloadingAndProcessing', { detail });
    }
    return ytProgressState.text || '';
  }

  function renderYtProgress() {
    if (!dom.ytProgress) return;
    const message = progressText();
    dom.ytProgress.textContent = message;
    if (ytProgressState.busy && message) {
      const dots = document.createElement('span');
      dots.className = 'busy-dots';
      dom.ytProgress.appendChild(dots);
    }
  }

  function setYtProgressState(next, autoClear, busy) {
    if (_ytProgressClearTimer) { clearTimeout(_ytProgressClearTimer); _ytProgressClearTimer = null; }
    ytProgressState = { ...next, busy: !!busy };
    renderYtProgress();
    if (autoClear) {
      _ytProgressClearTimer = setTimeout(() => {
        ytProgressState = { type: 'text', text: '', busy: false };
        renderYtProgress();
        _ytProgressClearTimer = null;
      }, 4000);
    }
  }

  function setYtProgress(msg, autoClear, busy) {
    setYtProgressState({ type: 'text', text: msg || '' }, autoClear, busy);
  }

  function setYtProgressKey(key, vars, autoClear, busy) {
    setYtProgressState({ type: 'key', key, vars: vars || {} }, autoClear, busy);
  }

  function setYtProgressStage(stage, percent, error, autoClear, busy) {
    setYtProgressState({ type: 'stage', stage, percent, error }, autoClear, busy);
  }

  function setYtProgressPlaylistResult(imported, skipped, failed, autoClear) {
    setYtProgressState({ type: 'playlistResult', imported, skipped, failed }, autoClear);
  }

  function setYtProgressQueueResult(imported, failed, autoClear) {
    setYtProgressState({ type: 'queueResult', imported, failed }, autoClear);
  }

  function setYtProgressQueue(current, total, autoClear, busy) {
    setYtProgressState({ type: 'queue', current, total }, autoClear, busy);
  }

  // 供 window.VKState.importYouTubeUrl（app.js）與媒體庫（media-library.js）呼叫
  AppShared.queueYouTubeImport = queueYouTubeImport;
  window.addEventListener('i18n:change', () => {
    renderWorkCenter();
    renderYtProgress();
    if (activeRiskAssessment) renderRiskAssessment(activeRiskAssessment);
    if (dom.ytFetchBtn) dom.ytFetchBtn.textContent = dom.ytFetchBtn.disabled ? t('import.playlist.processing') : t('source.importAudio');
    const uploadingHint = dom.dropZone?.querySelector('.hint');
    if (uploadingHint && !dom.dropZone.querySelector('#file-input')) uploadingHint.textContent = t('import.uploading');
  });
})();
