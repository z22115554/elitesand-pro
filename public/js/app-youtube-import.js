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
  const notifyFfmpegInvalidated = (code) => {
    if (code === 'FFMPEG_MISSING') window.dispatchEvent(new CustomEvent('elitesand:ffmpeg-invalidated'));
  };
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
    '正在使用瀏覽器登入狀態重試': 'import.stage.browserCookieRetry',
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

  // 上傳中的檔案（名稱＋大小＋修改時間）：上傳要幾秒，使用者以為沒反應會再拖一次 → 同一批不重送
  const uploadingKeys = new Set();
  const fileKey = (file) => `${file.name}|${file.size}|${file.lastModified}`;

  async function uploadFiles(files) {
    const fresh = files.filter((file) => !uploadingKeys.has(fileKey(file)));
    if (!fresh.length) {
      AppShared.showToast(t('import.alreadyUploading'), 'info');
      return;
    }
    files = fresh;
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
    const keys = files.map(fileKey);
    keys.forEach((key) => uploadingKeys.add(key));
    // 讓畫面立刻有回應（直播頁在清單尾端顯示「正在加入」列）
    document.dispatchEvent(new CustomEvent('upload:start', { detail: { names: files.map((file) => file.name) } }));

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
      keys.forEach((key) => uploadingKeys.delete(key));
      document.dispatchEvent(new CustomEvent('upload:end', { detail: { names: files.map((file) => file.name) } }));
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

  let youtubeSearchGeneration = 0;
  let activeSearchRequestId = '';
  let activeSearchAbortController = null;
  let loadingMoreYouTube = false;
  let lastYouTubeSearchQuery = '';
  let youtubeSearchUi = { key: '', vars: {}, results: [], hasMore: false };

  // Explicit source selection keeps slow Music results preferred without
  // inserting new cards above buttons the user is already pointing at.
  function createYouTubeSourcePicker(resultsNode, onChange) {
    const controls = document.createElement('div');
    controls.className = 'youtube-search-sources';
    controls.setAttribute('role', 'group');
    const empty = document.createElement('p');
    empty.className = 'youtube-search-status';
    let source = 'youtube-music', chosen = false;
    const buttons = ['youtube-music', 'youtube'].map(value => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'btn btn-sm btn-ghost';
      button.dataset.source = value;
      button.addEventListener('click', () => { source = value; chosen = true; onChange(); });
      controls.appendChild(button); return button;
    });
    controls.hidden = true; empty.hidden = true;
    resultsNode.before(controls, empty);
    return {
      reset() { source = 'youtube-music'; chosen = false; },
      get source() { return source; },
      matches(result) { return (result.source || 'youtube') === source; },
      update(results, pending, active) {
        const musicCount = results.filter(row => row.source === 'youtube-music').length;
        if (!chosen && !pending) source = musicCount ? 'youtube-music' : 'youtube';
        controls.hidden = !active;
        controls.setAttribute('aria-label', t('youtubeSearch.sources'));
        buttons.forEach((button, index) => {
          button.textContent = t(index === 0 ? 'youtubeSearch.musicSource' : 'youtubeSearch.otherSource', { count: formatNumber(index === 0 ? musicCount : results.length - musicCount) });
          button.setAttribute('aria-pressed', String(button.dataset.source === source));
        });
        empty.hidden = !active || source !== 'youtube-music' || musicCount > 0;
        empty.textContent = t(pending ? 'youtubeSearch.musicWaiting' : 'youtubeSearch.musicEmpty');
      },
    };
  }
  AppShared.createYouTubeSourcePicker = createYouTubeSourcePicker;
  const youtubeSourcePicker = dom.youtubeSearchResults
    ? createYouTubeSourcePicker(dom.youtubeSearchResults, renderYouTubeSearch) : null;

  function setYouTubeMode(mode) {
    const searchMode = mode === 'search';
    dom.youtubeModeLink?.classList.toggle('active', !searchMode);
    dom.youtubeModeSearch?.classList.toggle('active', searchMode);
    dom.youtubeModeLink?.setAttribute('aria-selected', String(!searchMode));
    dom.youtubeModeSearch?.setAttribute('aria-selected', String(searchMode));
    if (dom.youtubeLinkPanel) dom.youtubeLinkPanel.hidden = searchMode;
    if (dom.youtubeSearchPanel) dom.youtubeSearchPanel.hidden = !searchMode;
    if (searchMode) dom.youtubeSearchQuery?.focus();
  }

  function renderYouTubeSearch() {
    if (!dom.youtubeSearchStatus || !dom.youtubeSearchResults) return;
    dom.youtubeSearchStatus.textContent = youtubeSearchUi.key ? t(youtubeSearchUi.key, youtubeSearchUi.vars) : '';
    youtubeSourcePicker?.update(youtubeSearchUi.results, !!youtubeSearchUi.musicPending, !!youtubeSearchUi.key);
    // 有結果或有狀態訊息（含搜尋中）就給一個「清除結果」，讓使用者收掉這一大塊。
    if (dom.youtubeSearchClear) {
      dom.youtubeSearchClear.hidden = !(youtubeSearchUi.results.length || youtubeSearchUi.key);
    }
    if (dom.youtubeSearchMore) {
      dom.youtubeSearchMore.hidden = !(youtubeSearchUi.hasMore && youtubeSearchUi.results.length && youtubeSourcePicker?.source === 'youtube');
      dom.youtubeSearchMore.disabled = loadingMoreYouTube || !!activeSearchRequestId;
      dom.youtubeSearchMore.textContent = loadingMoreYouTube ? t('youtubeSearch.loadingMore') : t('youtubeSearch.loadMore');
    }
    const visibleIds = new Set(youtubeSearchUi.results.map(result => result.videoId));
    const existingRows = new Map([...dom.youtubeSearchResults.children].map(row => [row.dataset.videoId, row]));
    for (const [id, row] of existingRows) if (!visibleIds.has(id)) row.remove();
    for (const result of youtubeSearchUi.results) {
      const existing = existingRows.get(result.videoId);
      if (existing) { existing.hidden = !youtubeSourcePicker.matches(result); updateSearchResultRow(existing, result); continue; }
      const row = document.createElement('article');
      row.className = 'youtube-search-result';
      row.dataset.videoId = result.videoId;
      row.hidden = !youtubeSourcePicker.matches(result);

      const thumbnail = document.createElement('img');
      thumbnail.className = 'youtube-search-thumb';
      thumbnail.alt = '';
      thumbnail.loading = 'lazy';
      thumbnail.hidden = !result.thumbnail;
      if (result.thumbnail) thumbnail.src = result.thumbnail;
      thumbnail.addEventListener('error', () => { thumbnail.hidden = true; });

      const copy = document.createElement('div');
      copy.className = 'youtube-search-copy';
      const title = document.createElement('div');
      title.className = 'youtube-search-title';
      title.textContent = result.title;
      title.title = result.title;
      const meta = document.createElement('div');
      meta.className = 'youtube-search-meta';
      const metaParts = [result.channel || t('youtubeSearch.unknownChannel')];
      metaParts.push(result.duration > 0 ? formatDuration(result.duration) : t('youtubeSearch.unknownDuration'));
      if (Number.isFinite(result.viewCount)) metaParts.push(t('youtubeSearch.views', { count: formatNumber(result.viewCount) }));
      meta.textContent = result.metadataPending ? t(youtubeSearchUi.complete ? 'youtubeSearch.metadataIncomplete' : 'youtubeSearch.metadataPending') : metaParts.join(' · ');
      copy.append(title, meta);
      if (result.unavailable || result.isShort || result.isCompilation) {
        const badge = document.createElement('span');
        const isComp = !result.unavailable && !result.isShort && result.isCompilation;
        badge.className = isComp ? 'youtube-search-badge is-compilation' : 'youtube-search-badge';
        badge.textContent = result.liveStatus === 'is_live'
          ? t('youtubeSearch.live')
          : result.liveStatus === 'is_upcoming'
            ? t('youtubeSearch.upcoming')
            : result.isShort
              ? t('youtubeSearch.short')
              : t('youtubeSearch.compilation');
        copy.appendChild(badge);
      }

      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'btn btn-sm';
      choose.textContent = t('youtubeSearch.choose');
      choose.disabled = !!result.unavailable;
      choose.addEventListener('click', () => {
        choose.dataset.queued = '1';
        choose.disabled = true;
        choose.textContent = t('youtubeSearch.queued');
        const latest = youtubeSearchUi.results.find(row => row.videoId === result.videoId) || result;
        queueYouTubeImport(result.url, {
          sourceKey: 'source.youtubeModeSearch',
          label: latest.title,
          autoSeparate: !!dom.youtubeAutoSeparate?.checked,
          autoSync: !!window.ImportPrefs?.get().sync,
        }).catch(() => {
          delete choose.dataset.queued;
          choose.disabled = false;
          choose.textContent = t('youtubeSearch.choose');
        });
      });
      row.append(thumbnail, copy, choose);
      dom.youtubeSearchResults.appendChild(row);
    }
  }

  function updateSearchResultRow(row, result) {
    const title = row.querySelector('.youtube-search-title');
    title.textContent = result.title; title.title = result.title;
    const meta = [result.channel || t('youtubeSearch.unknownChannel'), result.duration > 0 ? formatDuration(result.duration) : t('youtubeSearch.unknownDuration')];
    if (Number.isFinite(result.viewCount)) meta.push(t('youtubeSearch.views', { count: formatNumber(result.viewCount) }));
    row.querySelector('.youtube-search-meta').textContent = result.metadataPending ? t(youtubeSearchUi.complete ? 'youtubeSearch.metadataIncomplete' : 'youtubeSearch.metadataPending') : meta.join(' · ');
    const image = row.querySelector('img');
    if (image.getAttribute('src') !== result.thumbnail) {
      if (result.thumbnail) image.src = result.thumbnail;
      else image.removeAttribute('src');
      image.hidden = !result.thumbnail;
    }
    let badge = row.querySelector('.youtube-search-badge');
    if (result.unavailable || result.isShort || result.isCompilation) {
      if (!badge) { badge = document.createElement('span'); row.querySelector('.youtube-search-copy').appendChild(badge); }
      badge.className = 'youtube-search-badge' + (!result.unavailable && !result.isShort && result.isCompilation ? ' is-compilation' : '');
      badge.textContent = t(result.liveStatus === 'is_live' ? 'youtubeSearch.live' : result.liveStatus === 'is_upcoming' ? 'youtubeSearch.upcoming' : result.isShort ? 'youtubeSearch.short' : 'youtubeSearch.compilation');
    } else badge?.remove();
    const choose = row.querySelector('button');
    choose.disabled = choose.dataset.queued === '1' || !!result.unavailable;
    choose.textContent = t(choose.dataset.queued === '1' ? 'youtubeSearch.queued' : 'youtubeSearch.choose');
  }

  function cancelActiveYouTubeSearch() {
    const requestId = activeSearchRequestId;
    activeSearchAbortController?.abort();
    activeSearchAbortController = null;
    if (!requestId) return;
    activeSearchRequestId = '';
    PinAuth.fetchWithPin('/api/youtube/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId }),
    }).catch(() => {});
  }

  function youtubeSearchErrorMessage(data, response) {
    if (data?.code === 'YOUTUBE_SEARCH_TIMEOUT') return t('youtubeSearch.timeout');
    if (data?.code === 'YOUTUBE_SEARCH_RUNTIME_MISSING') return t('youtubeSearch.runtimeMissing');
    if (data?.code === 'YOUTUBE_SEARCH_INVALID_QUERY') return t('validation.searchLength');
    if (data?.code === 'IMPORT_CANCELLED') return '';
    return t('youtubeSearch.unavailable', { status: response?.status || 0 });
  }

  async function requestYouTubeSearch(body, onResults, controller) {
    const response = await PinAuth.fetchWithPin('/api/youtube/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, stream: true }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]),
    });
    const accept = (data) => {
      if (!response.ok || !data.success) {
        const error = new Error(youtubeSearchErrorMessage(data, response));
        error.code = data.code || 'YOUTUBE_SEARCH_FAILED'; throw error;
      }
      onResults(data);
    };
    if (!response.headers.get('content-type')?.includes('application/x-ndjson') || !response.body) {
      accept({ ...(await response.json()), type: 'done' }); return;
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', completed = false;
    const line = (value) => {
      if (!value.trim()) return;
      const data = JSON.parse(value);
      accept(data);
      if (data.type === 'done') completed = true;
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        if (buffer.length > 512 * 1024) throw new Error(t('youtubeSearch.unavailable', { status: response.status }));
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
        if (done) { if (buffer.trim()) line(buffer); break; }
      }
      if (!completed) throw new Error(t('youtubeSearch.unavailable', { status: response.status }));
    } finally { reader.releaseLock(); }
  }
  AppShared.requestYouTubeSearch = requestYouTubeSearch;

  function applyYouTubeSearchUpdate(data, base = []) {
    const rows = new Map(base.map(result => [result.videoId, result]));
    for (const result of Array.isArray(data.results) ? data.results : []) {
      if (result?.videoId && (rows.has(result.videoId) || rows.size < 50)) rows.set(result.videoId, result);
    }
    const results = [...rows.values()];
    const key = data.type !== 'done' ? 'youtubeSearch.streamingResults'
      : data.partial ? 'youtubeSearch.partialResults' : results.length ? 'youtubeSearch.resultCount' : 'youtubeSearch.empty';
    youtubeSearchUi = {
      key, vars: { count: formatNumber(results.length) }, results,
      hasMore: !!data.hasMore && results.length < 50,
      nextOffset: Number.isInteger(data.nextOffset) ? data.nextOffset : results.length,
      musicPending: data.type !== 'done' && !!data.musicPending,
      complete: data.type === 'done',
    };
    renderYouTubeSearch();
  }

  function preserveYouTubeSearchFailure(error) {
    youtubeSearchUi = youtubeSearchUi.results.length
      ? { ...youtubeSearchUi, musicPending: false, complete: true, key: 'youtubeSearch.partialResults', vars: { count: formatNumber(youtubeSearchUi.results.length) } }
      : { key: 'youtubeSearch.failed', vars: { message: error.message }, results: [], hasMore: false };
    renderYouTubeSearch();
  }

  async function searchYouTube() {
    const query = String(dom.youtubeSearchQuery?.value || '').replace(/\s+/g, ' ').trim();
    if (query.length < 2 || query.length > 100) {
      youtubeSearchUi = { key: 'youtubeSearch.failed', vars: { message: t('validation.searchLength') }, results: [], hasMore: false };
      renderYouTubeSearch(); return;
    }
    cancelActiveYouTubeSearch();
    loadingMoreYouTube = false;
    const generation = ++youtubeSearchGeneration;
    const requestId = `yt-search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const controller = new AbortController();
    activeSearchAbortController = controller;
    activeSearchRequestId = requestId;
    lastYouTubeSearchQuery = query;
    youtubeSourcePicker?.reset();
    youtubeSearchUi = { key: 'youtubeSearch.searching', vars: {}, results: [], hasMore: false, nextOffset: 0, musicPending: true };
    renderYouTubeSearch();
    // A new query can replace a pending search; Clear cancels it as well.
    if (dom.youtubeSearchSubmit) dom.youtubeSearchSubmit.disabled = false;
    try {
      await requestYouTubeSearch({ query, limit: 10, requestId }, (data) => {
        if (generation === youtubeSearchGeneration) applyYouTubeSearchUpdate(data);
      }, controller);
    } catch (error) {
      if (generation !== youtubeSearchGeneration || controller.signal.aborted || error?.code === 'IMPORT_CANCELLED') return;
      preserveYouTubeSearchFailure(error);
    } finally {
      if (generation === youtubeSearchGeneration) {
        activeSearchRequestId = ''; activeSearchAbortController = null;
        if (dom.youtubeSearchSubmit) dom.youtubeSearchSubmit.disabled = false;
        renderYouTubeSearch();
      }
    }
  }

  // Paging advances the general-source cursor, independently of Music extras
  // and displayed de-duplicated row count. Partial pages can be continued too.
  async function loadMoreYouTubeSearch() {
    if (loadingMoreYouTube || activeSearchRequestId || !youtubeSearchUi.hasMore || !lastYouTubeSearchQuery || !youtubeSearchUi.results.length) return;
    loadingMoreYouTube = true;
    const generation = youtubeSearchGeneration;
    const base = youtubeSearchUi.results.slice();
    const offset = youtubeSearchUi.nextOffset ?? base.length;
    const requestId = `yt-search-more-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const controller = new AbortController();
    activeSearchAbortController = controller;
    activeSearchRequestId = requestId;
    renderYouTubeSearch();
    try {
      await requestYouTubeSearch({ query: lastYouTubeSearchQuery, limit: 10, more: true, offset, requestId }, (data) => {
        if (generation === youtubeSearchGeneration) applyYouTubeSearchUpdate(data, base);
      }, controller);
    } catch (error) {
      if (generation === youtubeSearchGeneration && !controller.signal.aborted) preserveYouTubeSearchFailure(error);
    } finally {
      if (generation === youtubeSearchGeneration) {
        loadingMoreYouTube = false; activeSearchRequestId = ''; activeSearchAbortController = null;
        renderYouTubeSearch();
      }
    }
  }

  // 「清除結果」：收掉整塊搜尋結果與狀態列，保留輸入框內容方便微調再搜。
  function clearYouTubeSearchResults() {
    youtubeSearchGeneration += 1; // 作廢仍在飛的回應
    cancelActiveYouTubeSearch();
    loadingMoreYouTube = false;
    youtubeSearchUi = { key: '', vars: {}, results: [], hasMore: false };
    renderYouTubeSearch();
    if (dom.youtubeSearchSubmit) dom.youtubeSearchSubmit.disabled = false;
    dom.youtubeSearchQuery?.focus();
  }

  dom.youtubeModeLink?.addEventListener('click', () => setYouTubeMode('link'));
  dom.youtubeModeSearch?.addEventListener('click', () => setYouTubeMode('search'));
  dom.youtubeSearchSubmit?.addEventListener('click', searchYouTube);
  dom.youtubeSearchClear?.addEventListener('click', clearYouTubeSearchResults);
  dom.youtubeSearchMore?.addEventListener('click', loadMoreYouTubeSearch);
  dom.youtubeSearchQuery?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') searchYouTube();
  });

  dom.ytFetchBtn.addEventListener('click', fetchYouTube);
  dom.youtubeAutoSeparate?.addEventListener('change', async () => {
    if (!dom.youtubeAutoSeparate.checked) return;
    try {
      if (!await window.AiSeparation.ensureReady()) dom.youtubeAutoSeparate.checked = false;
    } catch (error) {
      dom.youtubeAutoSeparate.checked = false;
      AppShared.showToast(t('import.separation.prepareFailed', { message: error.message }), 'error');
    }
  });
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
        autoSeparate: !!dom.youtubeAutoSeparate?.checked,
        autoSync: !!window.ImportPrefs?.get().sync,
        // 播放清單一次排幾十~幾百首，中間某首抓不到 metadata（下架/私人/地區限制）
        // 是常態，不是需要使用者判斷的例外——inspectImport() 靠這個旗標決定要不要
        // 為了純技術性失敗跳出確認視窗卡住後面所有還沒處理的歌。
        isBatch: true,
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
  // 面板只呈現最新 20 筆；保留有限的終態歷史供重試/查錯即可，不能讓千首匯入把錯誤、
  // assessment 與 Promise callback 無限留在 renderer 記憶體。
  const MAX_RETAINED_TERMINAL_IMPORT_JOBS = 120;
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

  function requestBrowserCookieRetry() {
    const modal = document.getElementById('youtube-cookie-modal');
    const select = document.getElementById('youtube-cookie-browser');
    const cancel = document.getElementById('youtube-cookie-cancel');
    const retry = document.getElementById('youtube-cookie-retry');
    if (!modal || !select || !cancel || !retry) return Promise.resolve('');

    return new Promise((resolve) => {
      modal.hidden = false;
      const finish = (browser = '') => {
        modal.hidden = true;
        cancel.removeEventListener('click', onCancel);
        retry.removeEventListener('click', onRetry);
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKeydown);
        resolve(browser);
      };
      const onCancel = () => finish('');
      const onRetry = () => finish(String(select.value || ''));
      const onBackdrop = (event) => { if (event.target === modal) finish(''); };
      const onKeydown = (event) => { if (event.key === 'Escape') finish(''); };
      cancel.addEventListener('click', onCancel);
      retry.addEventListener('click', onRetry);
      modal.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKeydown);
      retry.focus();
    });
  }

  function youtubeRequestBody(job, extra = {}) {
    const body = {
      url: job.url,
      requestId: job.requestId,
      isBatch: job.isBatch === true,
      ...extra,
    };
    // Cookie 來源只活在「目前這一個 job」；不寫 localStorage、不進 playlist/state。
    if (job.cookieBrowser) body.cookieBrowser = job.cookieBrowser;
    return body;
  }

  async function inspectWithAuthFallback(job) {
    try {
      return await inspectImport(job);
    } catch (error) {
      const canOfferCookies = !job.isBatch
        && !job.cookieBrowser
        && error?.code === 'YOUTUBE_AUTH_REQUIRED'
        && error?.browserCookieFallback === true;
      if (!canOfferCookies) throw error;

      const browser = await requestBrowserCookieRetry();
      if (!browser) throw error;
      job.cookieBrowser = browser;
      job.assessment = null;
      updateJob(job, {
        status: 'active',
        stage: '正在使用瀏覽器登入狀態重試',
        messageKey: 'import.stage.browserCookieRetry',
        messageVars: {},
      });
      return inspectImport(job);
    }
  }

  async function inspectImport(job) {
    if (job.assessment) return job.assessment;
    updateJob(job, { stage: '正在檢查影片', messageKey: 'import.stage.inspectDetails' });
    const response = await PinAuth.fetchWithPin('/api/youtube/inspect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(youtubeRequestBody(job)),
    });
    const data = await response.json();
    if (response.ok && data.success && data.assessment) return data.assessment;
    if (data.code === 'IMPORT_CANCELLED') {
      const cancelled = new Error(data.error || t('import.stage.cancelled'));
      cancelled.code = 'IMPORT_CANCELLED';
      throw cancelled;
    }
    if (data.code === 'YOUTUBE_AUTH_REQUIRED' && data.browserCookieFallback === true) {
      const auth = new Error([data.error, data.recovery].filter(Boolean).map(tr).join(' '));
      auth.code = 'YOUTUBE_AUTH_REQUIRED';
      auth.retryable = data.retryable !== false;
      auth.browserCookieFallback = true;
      throw auth;
    }
    // 「根本抓不到 metadata」（私人/下架/地區限制，yt-dlp 全部策略＋oEmbed 都失敗）是純技術性
    // 失敗，不是需要使用者判斷的內容風險。批次匯入（播放清單）沒有人一直盯著看，跳確認視窗
    // 會讓整條佇列卡在這支壞影片前面，後面幾十~幾百首都不會處理（實測回報：一支影片抓不到
    // 資料，300 首的匯入卡住 6 分鐘沒有任何進度）。批次時直接當這首失敗、跳到下一首；
    // 單首匯入（使用者就在螢幕前）才維持原本「問一下要不要仍然嘗試下載」的行為。
    if (job.isBatch) {
      const unreachable = new Error(t('import.assessment.unavailableWithReason', { message: data.error || t('import.assessment.unknownReason') }));
      unreachable.code = 'IMPORT_METADATA_UNAVAILABLE';
      unreachable.retryable = false;
      throw unreachable;
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
    if (job.postActionKey) return t(job.postActionKey, formatImportVars(job.postActionVars));
    if (job.completedPlacement) return t('import.job.completed', { placement: t(job.completedPlacement), title: job.completedTitle || '' });
    if (job.errorMessage) return t('import.error.importFailed', { message: job.errorMessage });
    if (job.messageKey) return t(job.messageKey, job.messageVars);
    if (job.message) return job.message;
    if (job.stage) return localizedStage(job.stage);
    return localizedStage(job.status);
  }

  function renderWorkCenter() {
    if (!workCenter || !workCenterList) return;
    // 已完成的歌已經在播放清單裡，不必再列；只剩已完成的工作時整塊收起
    workCenter.hidden = !ytImportJobs.some((job) => job.status !== 'completed');
    workCenterList.textContent = '';
    const pending = ytImportQueue.filter((job) => job.status === 'queued');
    for (const job of ytImportJobs.slice(0, 20)) {
      const row = document.createElement('div');
      row.className = 'work-item';
      row.dataset.jobId = job.id;
      row.dataset.status = job.status;
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
      } else if (job.status === 'separating' && job.separationTrackId != null) {
        // 分離是匯入後的可選後處理；歌已經進清單了，這個取消只停分離、不影響匯入結果。
        const cancelSep = document.createElement('button');
        cancelSep.type = 'button'; cancelSep.className = 'btn btn-sm btn-ghost';
        cancelSep.dataset.workAction = 'cancel-separation';
        cancelSep.textContent = t('import.job.cancel');
        actions.appendChild(cancelSep);
      } else if (job.status === 'failed' || job.status === 'cancelled') {
        const retry = document.createElement('button');
        retry.type = 'button'; retry.className = 'btn btn-sm btn-ghost'; retry.dataset.workAction = 'retry'; retry.textContent = t('import.job.retry');
        actions.appendChild(retry);
      }
      row.append(title, stateEl, actions);
      if ((job.status === 'active' || job.status === 'separating') && Number.isFinite(job.percent)) {
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
    if (['completed', 'cancelled', 'failed'].includes(job.status)) pruneTerminalImportJobs();
    renderWorkCenter();
  }

  function pruneTerminalImportJobs() {
    let retained = 0;
    // 新工作永遠插在開頭；由新到舊掃描可保留最近完成的終態工作，同時不碰 queued/active。
    for (let i = 0; i < ytImportJobs.length; i++) {
      if (!['completed', 'cancelled', 'failed'].includes(ytImportJobs[i].status)) continue;
      retained++;
      if (retained > MAX_RETAINED_TERMINAL_IMPORT_JOBS) {
        ytImportJobs.splice(i, 1);
        i--;
      }
    }
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
    if (job.audioSetupController) {
      job.audioSetupController.abort();
      return;
    }
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
    if (button.dataset.workAction === 'cancel-separation' && job.separationTrackId != null) {
      button.disabled = true;
      window.AiSeparation?.cancel(job.separationTrackId);
    }
    if (button.dataset.workAction === 'retry') {
      queueYouTubeImport(job.url, {
        source: job.source,
        sourceKey: job.sourceKey,
        sourceVars: job.sourceVars,
        label: job.label,
        labelKey: job.labelKey,
        labelVars: job.labelVars,
        autoSeparate: job.autoSeparate,
        autoSync: job.autoSync,
      }).catch(() => {});
    }
  });
  workCenterClear?.addEventListener('click', () => {
    for (let i = ytImportJobs.length - 1; i >= 0; i--) {
      if (['completed', 'cancelled', 'failed'].includes(ytImportJobs[i].status)) ytImportJobs.splice(i, 1);
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

  function separationStartError(data) {
    if (data?.error === 'AI_RUNTIME_NOT_READY') return tr('AI 分離元件尚未安裝，請先到「連線與系統」下載');
    if (data?.error === 'ALREADY_PROCESSING') return tr('這首歌已經在分離中');
    if (data?.error === 'WEBGPU_ENGINE_OFFLINE') return tr('WebGPU 分離引擎離線，請確認桌面版已啟動');
    if (data?.error === 'WEBGPU_ENGINE_BUSY') return tr('WebGPU 分離引擎正在跑另一首歌，請稍後再試');
    if (data?.error === 'WEBGPU_MODEL_NOT_READY') return tr('WebGPU 分離模型尚未下載，請先到「連線與系統」下載');
    return tr(data?.error || t('import.error.serverUnconfirmed'));
  }

  async function separateImportedTrack(job, track) {
    if (!await window.AiSeparation.ensureReady()) {
      throw new Error(t('import.separation.notEnabled'));
    }
    updateJob(job, {
      status: 'separating', stage: '', percent: 0, separationTrackId: track.id,
      postActionKey: 'import.separation.starting', postActionVars: {},
    });
    let finished = false;
    let timer = null;
    let resolveCompletion;
    let rejectCompletion;
    const completion = new Promise((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    const onProgress = (data) => {
      if (!data || String(data.trackId) !== String(track.id) || finished) return;
      if (data.stage === 'done') {
        finished = true;
        resolveCompletion();
        return;
      }
      if (data.stage === 'error') {
        finished = true;
        rejectCompletion(new Error(data.errorMessage || data.error || t('import.separation.unknownFailure')));
        return;
      }
      if (data.stage === 'cancelled') {
        // 使用者取消了分離——歌曲本身已經匯入成功，不當成匯入失敗。
        finished = true;
        const cancelledError = new Error(t('import.separation.cancelled'));
        cancelledError.code = 'SEPARATION_CANCELLED';
        rejectCompletion(cancelledError);
        return;
      }
      if (data.stage === 'queued') {
        updateJob(job, {
          status: 'separating', percent: 0,
          postActionKey: 'import.separation.queued',
          postActionVars: { position: data.queuePosition || 1 },
        });
        return;
      }
      const percent = Number.isFinite(data.percent) ? data.percent : 0;
      updateJob(job, {
        status: 'separating', percent,
        postActionKey: 'import.separation.state',
        postActionVars: {
          state: window.AiSeparation.label(data),
          percent: Number.isFinite(data.percent) ? `${formatNumber(Math.round(percent))}%` : '',
        },
      });
    };
    const unsubscribe = window.AiSeparation.subscribe(onProgress, { replay: false });
    timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      rejectCompletion(new Error(t('import.separation.timeout')));
    }, 2 * 60 * 60 * 1000);
    try {
      const response = await PinAuth.fetchWithPin(`/api/library/${encodeURIComponent(track.id)}/separate`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        finished = true;
        throw new Error(separationStartError(data));
      }
      await completion;
    } finally {
      finished = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
    }
  }

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
        autoSeparate: options.autoSeparate === true,
        // 匯入後自動對時要靠分離出的人聲，所以只跟著「製作伴奏」一起成立
        autoSync: options.autoSeparate === true && options.autoSync === true,
        isBatch: options.isBatch === true,
        skipPlaylistInsert: options.skipPlaylistInsert === true,
        cookieBrowser: '',
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
    let audioSetupDeclined = false;
    while (ytImportQueue.length) {
      const job = ytImportQueue.shift();
      const requestId = `yt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      activeImportJob = job;
      updateJob(job, { status: 'active', requestId, stage: '準備匯入', messageKey: 'import.stage.preparing', percent: 0, errorMessage: '', completedPlacement: '' });
      updateYtQueueProgress();
      try {
        const assessment = await inspectWithAuthFallback(job);
        if (job.cancelRequested) { const cancelled = new Error(t('import.stage.cancelled')); cancelled.code = 'IMPORT_CANCELLED'; throw cancelled; }
        if (assessment?.warning && !riskWarningsDisabled()) updateJob(job, { stage: '等待使用者確認', messageKey: 'import.stage.needsAssessment' });
        const allowed = await confirmRiskAssessment(assessment);
        if (!allowed) {
          const skipped = new Error(t('import.stage.skipped')); skipped.code = 'IMPORT_SKIPPED'; throw skipped;
        }
        if (window.AudioComponentSetup) {
          updateJob(job, { stage: '準備音訊處理元件', messageKey: 'audioSetup.title' });
          job.audioSetupController = new AbortController();
          let audioReady = false;
          try {
            audioReady = !audioSetupDeclined && await window.AudioComponentSetup.ensureReady({
              signal: job.audioSetupController.signal,
            });
          } finally {
            job.audioSetupController = null;
          }
          if (!audioReady || job.cancelRequested) {
            audioSetupDeclined = !job.cancelRequested;
            const skipped = new Error(t('audioSetup.importSkipped'));
            skipped.code = job.cancelRequested ? 'IMPORT_CANCELLED' : 'IMPORT_SKIPPED';
            throw skipped;
          }
        }
        updateJob(job, { status: 'active', stage: '準備下載', messageKey: 'import.stage.checkPassed' });
        activeRequestIds.add(requestId);
        let res = await PinAuth.fetchWithPin('/api/youtube', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(youtubeRequestBody(job)),
        });
        let data = await res.json();

        // 匿名鏈真的跑完仍是 LOGIN_REQUIRED 才出現這個最後手段；批次匯入絕不逐首
        // 跳帳號視窗。使用者選瀏覽器後只把名稱送給後端，Cookie 本身不經過前端。
        if (!res.ok
          && !job.isBatch
          && !job.cookieBrowser
          && data?.code === 'YOUTUBE_AUTH_REQUIRED'
          && data?.browserCookieFallback === true) {
          const browser = await requestBrowserCookieRetry();
          if (browser) {
            job.cookieBrowser = browser;
            updateJob(job, {
              status: 'active',
              stage: '正在使用瀏覽器登入狀態重試',
              messageKey: 'import.stage.browserCookieRetry',
              messageVars: {},
            });
            res = await PinAuth.fetchWithPin('/api/youtube', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(youtubeRequestBody(job)),
            });
            data = await res.json();
          }
        }
        // 落地前去重：伺服器發現「歌手+歌名」跟既有一首歌相符（不同 YouTube 上傳的同一首歌）。
        // 批次匯入時伺服器直接沿用既有版本，不會走到這裡；只有單首匯入才需要問使用者
        // 「取代」還是「略過」——批次沒有人一直盯著，跳確認視窗會卡住整條佇列（同一個教訓
        // 在 metadata-unavailable 那次已經踩過）。
        if (!job.isBatch && data && data.code === 'DUPLICATE_SONG') {
          const existing = data.existing || {};
          const label = existing.artist ? `${existing.artist} - ${existing.title}` : (existing.title || job.label || job.url);
          const replace = window.PanelConfirm
            ? await window.PanelConfirm.request({
              title: t('import.duplicate.title'),
              summary: t('import.duplicate.summary', { label }),
              impact: t('import.duplicate.impact'),
              confirmLabel: t('import.duplicate.replace'),
              tone: 'neutral',
            })
            : false;
          if (!replace) {
            const skipped = new Error(t('import.stage.skipped')); skipped.code = 'IMPORT_SKIPPED'; throw skipped;
          }
          res = await PinAuth.fetchWithPin('/api/youtube', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(youtubeRequestBody(job, { forceReplace: true })),
          });
          data = await res.json();
        }
        // BGM 匯入：只要下載進媒體庫、不進目前播放清單／不自動載入待命——BGM 是旁路
        // 待機清單，跟正在唱的歌完全分開（鐵則：不可污染 playState.playlist）。
        if (res.ok && data.success && data.track && job.skipPlaylistInsert) {
          updateJob(job, {
            status: 'completed', stage: '已完成', completedPlacement: 'import.placement.added',
            completedTitle: data.track.title, percent: 100, messageKey: '', errorMessage: '',
          });
          ok++;
          job.resolve(data.track);
        } else if (res.ok && data.success && data.track) {
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
          const placementKey = job.placement === 'next'
            ? (placement?.placement === 'next' ? 'import.placement.next' : 'import.placement.endBecauseIdle')
            : 'import.placement.added';
          if (job.autoSeparate) {
            try {
              await separateImportedTrack(job, data.track);
              if (job.autoSync && window.AutoSync) {
                updateJob(job, { postActionKey: 'import.autoSync.running', postActionVars: {} });
                await window.AutoSync.syncTrack(data.track.id);
              }
              updateJob(job, {
                status: 'completed', stage: '已完成', completedPlacement: placementKey,
                completedTitle: data.track.title, percent: 100, messageKey: '', errorMessage: '',
                postActionKey: 'import.separation.completed', postActionVars: { title: data.track.title },
              });
            } catch (separationError) {
              const cancelled = separationError.code === 'SEPARATION_CANCELLED';
              if (!cancelled) {
                AppShared.showToast(t('import.separation.failedAfterImport', { message: separationError.message }), 'warning');
              }
              updateJob(job, {
                status: 'completed', stage: '已完成', completedPlacement: placementKey,
                completedTitle: data.track.title, percent: 100, messageKey: '', errorMessage: '',
                postActionKey: cancelled ? 'import.separation.cancelled' : 'import.separation.failedAfterImport',
                postActionVars: cancelled ? {} : { message: separationError.message },
              });
            }
          } else {
            updateJob(job, {
              status: 'completed', stage: '已完成', completedPlacement: placementKey,
              completedTitle: data.track.title, percent: 100, messageKey: '', errorMessage: '',
            });
          }
          ok++;
          job.resolve(data.track);
        } else {
          const errorMsg = data.error ? tr(data.error) : t('import.error.unknown');
          const recovery = data.recovery ? ` ${tr(data.recovery)}` : '';
          const error = new Error(`${errorMsg}${recovery}`);
          error.code = data.code || 'IMPORT_FAILED';
          error.retryable = data.retryable !== false;
          notifyFfmpegInvalidated(error.code);
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
        notifyFfmpegInvalidated(err.code);
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
        job.cookieBrowser = '';
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
    queueYouTubeImport(url, { autoSeparate: !!dom.youtubeAutoSeparate?.checked, autoSync: !!window.ImportPrefs?.get().sync })
      .catch(() => { /* 失敗已在佇列內 toast，這裡吞掉避免 unhandled */ });
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
    renderYouTubeSearch();
    if (activeRiskAssessment) renderRiskAssessment(activeRiskAssessment);
    if (dom.ytFetchBtn) dom.ytFetchBtn.textContent = dom.ytFetchBtn.disabled ? t('import.playlist.processing') : t('source.importAudio');
    const uploadingHint = dom.dropZone?.querySelector('.hint');
    if (uploadingHint && !dom.dropZone.querySelector('#file-input')) uploadingHint.textContent = t('import.uploading');
  });
})();
