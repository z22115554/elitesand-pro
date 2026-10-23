/**
 * Elitesand Pro — 歌曲庫「加歌」入口（2026-09-29 使用者回報：歌曲庫沒有地方可以加歌）
 *
 * 跟直播頁同一個操作習慣：一個輸入框，貼 YouTube 連結＝匯入、打歌名＝搜尋；資料夾鈕＝本機檔案。
 * 差別：這裡只把歌收進歌曲庫，不排進目前的播放清單（事前整理用）。
 *   - YouTube：走 AppShared.queueYouTubeImport(..., { skipPlaylistInsert: true })——同一條下載佇列
 *     （鐵則 12：不可另開 yt-dlp／ffmpeg 併發），下載進度照樣顯示在直播頁清單尾端
 *   - 本機檔案：/api/upload 本來就只寫進歌曲庫，播放清單是直播頁自己加的；這裡不加
 */
(function () {
  'use strict';

  const T = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const byId = (id) => document.getElementById(id);
  const looksLikeUrl = (text) => /^(https?:\/\/|www\.|youtu\.?be|(m\.|music\.)?youtube\.com)/i.test(text.trim());

  function el(tag, cls, attrs = {}) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }
  function i18n(node, key, attr) {
    if (attr) { node.setAttribute(`data-i18n-${attr}`, key); node.setAttribute(attr, T(key)); }
    else { node.dataset.i18n = key; node.textContent = T(key); }
    return node;
  }

  const panel = document.querySelector('.view[data-view="library"] .lib-panel');
  const head = panel && panel.querySelector('.lib-head');
  if (!panel || !head || !window.AppShared) return;

  const box = el('div', 'lib-add');
  const row = el('div', 'lib-add-row');
  const input = el('input', 'input lib-add-input', { type: 'text', autocomplete: 'off' });
  i18n(input, 'library.add.placeholder', 'placeholder');
  i18n(input, 'library.add.placeholder', 'aria-label');
  const go = el('button', 'btn btn-primary lib-add-go', { type: 'button' });
  const folder = el('button', 'btn lib-add-file', { type: 'button' });
  i18n(folder, 'library.add.file');
  const file = el('input', '', { type: 'file', multiple: '', accept: '.mp3,.flac,.wav,.m4a,.ogg,.aac,.wma', hidden: '' });
  const status = el('p', 'lib-add-status', { role: 'status', 'aria-live': 'polite' });
  status.hidden = true;
  const results = el('div', 'lib-add-results youtube-search-results');
  row.append(input, go, folder, file);
  box.append(row, status, results);
  head.insertAdjacentElement('afterend', box);

  let searchRows = [], musicPending = false, searchActive = false, searchFinished = false;
  const sourcePicker = AppShared.createYouTubeSourcePicker(results, renderSearch);
  function renderSearch() {
    sourcePicker.update(searchRows, musicPending, searchActive);
    const existing = new Map([...results.children].map(row => [row.dataset.videoId, row]));
    for (const result of searchRows) {
      let item = existing.get(result.videoId);
      if (!item) { item = resultRow(result); results.appendChild(item); }
      item.hidden = !sourcePicker.matches(result);
      item.querySelector('.youtube-search-title').textContent = result.title;
      item.querySelector('.youtube-search-title').title = result.title;
      item.querySelector('.youtube-search-meta').textContent = result.metadataPending ? T(searchFinished ? 'youtubeSearch.metadataIncomplete' : 'youtubeSearch.metadataPending') : result.channel || '';
      const image = item.querySelector('img');
      if (result.thumbnail && image.getAttribute('src') !== result.thumbnail) image.src = result.thumbnail;
      image.style.visibility = result.thumbnail ? '' : 'hidden';
      const pick = item.querySelector('button');
      pick.disabled = pick.dataset.queued === '1' || !!result.unavailable;
    }
  }

  const verb = () => i18n(go, input.value.trim() && !looksLikeUrl(input.value) ? 'youtubeSearch.submit' : 'library.add.importVerb');
  input.addEventListener('input', verb);
  window.addEventListener('i18n:change', verb);
  verb();

  function say(key, vars, tone) {
    status.hidden = !key;
    status.textContent = key ? T(key, vars) : '';
    status.dataset.tone = tone || '';
  }

  const refreshLibrary = () => { try { byId('lib-refresh')?.click(); } catch (_) { /* 靜默 */ } };

  function importUrl(url, label) {
    say('library.add.queued', { title: label || url });
    return AppShared.queueYouTubeImport(url, {
      label: label || '',
      sourceKey: 'library.add.source',
      skipPlaylistInsert: true,
    }).then((track) => {
      say('library.add.done', { title: track?.title || label || '' }, 'ok');
      refreshLibrary();
    }).catch((error) => {
      if (error?.code === 'IMPORT_CANCELLED' || error?.code === 'IMPORT_SKIPPED') { say(''); return; }
      say('library.add.failed', { message: error?.message || '' }, 'error');
      throw error;
    });
  }

  let searchSeq = 0;
  let searchController;
  async function search(query) {
    const seq = ++searchSeq;
    searchController?.abort();
    const controller = new AbortController();
    searchController = controller;
    searchRows = []; musicPending = true; searchActive = true; searchFinished = false;
    sourcePicker.reset();
    results.replaceChildren();
    renderSearch();
    say('youtubeSearch.searching');
    try {
      await AppShared.requestYouTubeSearch({ query, limit: 10, requestId: `lib-search-${Date.now()}-${seq}` }, data => {
        if (seq !== searchSeq) return;
        searchRows = Array.isArray(data.results) ? data.results : [];
        musicPending = data.type !== 'done' && !!data.musicPending;
        searchFinished = data.type === 'done';
        say(data.type !== 'done' ? 'youtubeSearch.streamingResults' : data.partial ? 'youtubeSearch.partialResults' : searchRows.length ? 'youtubeSearch.resultCount' : 'youtubeSearch.empty', { count: searchRows.length });
        renderSearch();
      }, controller);
    } catch (error) {
      if (seq === searchSeq && !controller.signal.aborted) {
        musicPending = false; searchFinished = true;
        say(searchRows.length ? 'youtubeSearch.partialResults' : 'youtubeSearch.failed', { count: searchRows.length, message: error.message }, 'error');
        renderSearch();
      }
    } finally {
      if (seq === searchSeq) searchController = null;
    }
  }

  function resultRow(result) {
    const item = el('article', 'youtube-search-result');
    item.dataset.videoId = result.videoId;
    const thumb = el('img', 'youtube-search-thumb', { alt: '', loading: 'lazy' });
    if (result.thumbnail) thumb.src = result.thumbnail; else thumb.style.visibility = 'hidden';
    const copy = el('div', 'youtube-search-copy');
    const title = el('div', 'youtube-search-title');
    title.textContent = result.title || '';
    title.title = result.title || '';
    const meta = el('div', 'youtube-search-meta');
    meta.textContent = result.channel || '';
    copy.append(title, meta);
    const pick = el('button', 'btn btn-sm', { type: 'button' });
    i18n(pick, 'library.add.importVerb');
    pick.disabled = !!result.unavailable;
    pick.addEventListener('click', () => {
      pick.dataset.queued = '1';
      pick.disabled = true;
      i18n(pick, 'youtubeSearch.queued');
      const latest = searchRows.find(row => row.videoId === result.videoId) || result;
      importUrl(result.url, latest.title).catch(() => { delete pick.dataset.queued; pick.disabled = false; i18n(pick, 'library.add.importVerb'); });
    });
    item.append(thumb, copy, pick);
    return item;
  }

  function submit() {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    if (looksLikeUrl(text)) {
      searchSeq++; searchController?.abort();
      searchRows = []; musicPending = false; searchActive = false;
      results.replaceChildren();
      renderSearch();
      input.value = '';
      verb();
      importUrl(text).catch(() => {});
      return;
    }
    if (text.length < 2) { say('youtubeSearch.failed', { message: T('validation.searchLength') }, 'error'); return; }
    search(text);
  }
  go.addEventListener('click', submit);
  window.addEventListener('i18n:change', renderSearch);
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') submit(); });

  // 本機檔案：上傳中同一批不重送（上傳要幾秒，使用者容易以為沒反應再按一次）
  let uploading = false;
  async function upload(files) {
    if (!files.length) return;
    if (uploading) { say('import.alreadyUploading', {}, 'info'); return; }
    uploading = true;
    folder.disabled = true;
    say('liveSlim.uploading', { count: files.length, name: files[0].name });
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    try {
      const res = await PinAuth.fetchWithPin('/api/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'upload failed');
      say('library.add.uploaded', { count: (data.tracks || []).length }, 'ok');
      refreshLibrary();
    } catch (error) {
      say('import.uploadFailed', { message: error.message }, 'error');
    } finally {
      uploading = false;
      folder.disabled = false;
    }
  }
  folder.addEventListener('click', () => file.click());
  file.addEventListener('change', () => { upload(Array.from(file.files)); file.value = ''; });

  // 整張歌曲庫卡片都能拖檔進來
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  panel.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); panel.classList.add('lib-drop'); } });
  panel.addEventListener('dragleave', (e) => { if (!panel.contains(e.relatedTarget)) panel.classList.remove('lib-drop'); });
  panel.addEventListener('drop', (e) => {
    panel.classList.remove('lib-drop');
    if (!hasFiles(e)) return;
    e.preventDefault();
    upload(Array.from(e.dataTransfer.files).filter((f) => /\.(mp3|flac|wav|m4a|ogg|aac|wma)$/i.test(f.name)));
  });
})();
