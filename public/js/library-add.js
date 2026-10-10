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
  async function search(query) {
    const seq = ++searchSeq;
    results.replaceChildren();
    say('youtubeSearch.searching');
    go.disabled = true;
    try {
      const response = await PinAuth.fetchWithPin('/api/youtube/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 10, requestId: `lib-search-${Date.now()}` }),
      });
      const data = await response.json().catch(() => ({}));
      if (seq !== searchSeq) return;
      if (!response.ok || !data.success) throw new Error(data.error || T('youtubeSearch.unavailable', { status: response.status }));
      const list = Array.isArray(data.results) ? data.results : [];
      say(list.length ? 'youtubeSearch.resultCount' : 'youtubeSearch.empty', { count: list.length });
      list.forEach((result) => results.appendChild(resultRow(result)));
    } catch (error) {
      if (seq === searchSeq) say('youtubeSearch.failed', { message: error.message }, 'error');
    } finally {
      if (seq === searchSeq) go.disabled = false;
    }
  }

  function resultRow(result) {
    const item = el('article', 'youtube-search-result');
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
      pick.disabled = true;
      i18n(pick, 'youtubeSearch.queued');
      importUrl(result.url, result.title).catch(() => { pick.disabled = false; i18n(pick, 'library.add.importVerb'); });
    });
    item.append(thumb, copy, pick);
    return item;
  }

  function submit() {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    if (looksLikeUrl(text)) {
      results.replaceChildren();
      input.value = '';
      verb();
      importUrl(text).catch(() => {});
      return;
    }
    if (text.length < 2) { say('youtubeSearch.failed', { message: T('validation.searchLength') }, 'error'); return; }
    search(text);
  }
  go.addEventListener('click', submit);
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
