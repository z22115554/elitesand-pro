/**
 * 播放清單 UI —— 渲染／拖曳排序／移除／曲目編輯／匯出匯入。
 *
 * 跨模組共用狀態透過 AppShared.state（getter/setter 代理到 app.js 內部變數）讀寫；
 * playTrack/stopPlayback/showToast/updateMiniPlayerInfo 是播放模組（目前仍在 app.js，
 * 之後批次搬到 app-playback.js）透過 AppShared 暴露的函式。
 *
 * 對外暴露 AppShared.renderPlaylist/setMarqueeText/measureMarquee/updateMarquee，
 * 供播放模組更新「正在播放」大標題與跑馬燈用。
 */
(function () {
  'use strict';

  const { formatTime, escapeHtml, safeHttpUrl } = SharedUtils;
  const { dom } = AppShared;
  const state = AppShared.state;

  // 搜尋／篩選與批次選取只存在目前控制台，絕不寫進 state.json 或廣播給 OBS。
  // 選取 key 綁在目前記憶體中的歌曲物件，伺服器同步換掉清單物件時會自動清空，
  // 不會把舊選取誤套到同 id 的另一筆重複歌曲。
  let playlistFilterQuery = '';
  let playlistFilterMode = 'all';
  let selectionMode = false;
  let selectionKeySerial = 0;
  const selectionKeyByTrack = new WeakMap();
  const selectedTrackKeys = new Set();

  function getSelectionKey(track) {
    if (!track || typeof track !== 'object') return '';
    let key = selectionKeyByTrack.get(track);
    if (!key) {
      selectionKeySerial += 1;
      key = `playlist-track-${selectionKeySerial}`;
      selectionKeyByTrack.set(track, key);
    }
    return key;
  }

  function normalizeFilterText(value) {
    return String(value || '').normalize('NFKC').toLocaleLowerCase('zh-TW');
  }

  function trackMatchesFilter(track, index, currentTrackIndex) {
    const query = normalizeFilterText(playlistFilterQuery).trim();
    if (query) {
      const haystack = normalizeFilterText([
        track.title,
        track.artist,
        track.performer,
        track.originalArtist,
      ].filter(Boolean).join(' '));
      if (!haystack.includes(query)) return false;
    }

    switch (playlistFilterMode) {
      case 'upcoming': return currentTrackIndex < 0 || index >= currentTrackIndex;
      case 'played': return currentTrackIndex >= 0 && index < currentTrackIndex;
      case 'no-lyrics': return !(track.hasLyrics || track.lyrics);
      case 'missing-audio': return !!track.audioMissing;
      default: return true;
    }
  }

  function isFilterActive() {
    return !!playlistFilterQuery.trim() || playlistFilterMode !== 'all';
  }

  function reconcileSelectedTracks() {
    const currentTrackIndex = state.currentTrackIndex;
    const validKeys = new Set(state.playlist.map((track, index) => (
      index === currentTrackIndex ? null : getSelectionKey(track)
    )).filter(Boolean));
    selectedTrackKeys.forEach((key) => {
      if (!validKeys.has(key)) selectedTrackKeys.delete(key);
    });
  }

  function selectedTracks() {
    const currentTrackIndex = state.currentTrackIndex;
    return state.playlist.map((track, index) => ({ track, index, key: getSelectionKey(track) }))
      .filter(({ index, key }) => index !== currentTrackIndex && selectedTrackKeys.has(key));
  }

  function visibleSelectableTracks() {
    const currentTrackIndex = state.currentTrackIndex;
    return state.playlist.map((track, index) => ({ track, index, key: getSelectionKey(track) }))
      .filter(({ track, index }) => index !== currentTrackIndex && trackMatchesFilter(track, index, currentTrackIndex));
  }

  function syncPlaylistTools(visibleCount) {
    const playlist = state.playlist;
    const selectedCount = selectedTracks().length;
    const activeFilter = isFilterActive();
    const visibleSelectable = visibleSelectableTracks();
    const selectableVisibleCount = visibleSelectable.length;
    const allVisibleSelected = selectableVisibleCount > 0
      && visibleSelectable.every(({ key }) => selectedTrackKeys.has(key));

    if (dom.playlist) {
      dom.playlist.classList.toggle('is-selecting', selectionMode);
      dom.playlist.classList.toggle('is-filtered', activeFilter);
    }
    if (dom.playlistFilterResult) {
      dom.playlistFilterResult.textContent = playlist.length
        ? (activeFilter ? `顯示 ${visibleCount} / ${playlist.length} 首` : `共 ${playlist.length} 首歌曲`)
        : '';
    }
    if (dom.playlistFilterEmpty) {
      dom.playlistFilterEmpty.hidden = playlist.length === 0 || visibleCount > 0;
    }
    if (dom.btnPlaylistFilterClear) dom.btnPlaylistFilterClear.disabled = !activeFilter;
    if (dom.btnPlaylistSelect) {
      dom.btnPlaylistSelect.textContent = selectionMode ? '完成選取' : '選取';
      dom.btnPlaylistSelect.setAttribute('aria-pressed', String(selectionMode));
      dom.btnPlaylistSelect.disabled = playlist.length === 0;
    }
    if (dom.playlistSelectionToolbar) dom.playlistSelectionToolbar.hidden = !selectionMode;
    if (dom.playlistSelectionCount) dom.playlistSelectionCount.textContent = `已選 ${selectedCount} 首`;
    if (dom.btnPlaylistSelectVisible) {
      dom.btnPlaylistSelectVisible.disabled = selectableVisibleCount === 0;
      dom.btnPlaylistSelectVisible.textContent = allVisibleSelected
        ? '取消顯示結果'
        : '全選顯示結果';
    }
    if (dom.btnPlaylistSelectionRemove) {
      dom.btnPlaylistSelectionRemove.disabled = selectedCount === 0;
      dom.btnPlaylistSelectionRemove.textContent = selectedCount ? `移除已選 (${selectedCount})` : '移除已選';
    }
  }

  function setSelectionMode(nextSelectionMode) {
    selectionMode = !!nextSelectionMode;
    if (!selectionMode) selectedTrackKeys.clear();
    renderPlaylist();
  }

  function toggleTrackSelection(selectionKey) {
    if (!selectionMode || !selectionKey) return;
    if (selectedTrackKeys.has(selectionKey)) selectedTrackKeys.delete(selectionKey);
    else selectedTrackKeys.add(selectionKey);
    renderPlaylist();
  }

  // ═══════════════════════════════════════════
  // 播放列表渲染
  // ═══════════════════════════════════════════

  // 點擊委派給外層容器一次綁定（取代過去每次 render 都重新對每一列 addEventListener），
  // 短時間內大量加歌（例如連續從媒體庫「加入清單」）不會讓監聽器數量隨歌曲數疊加。
  dom.playlist.addEventListener('click', (e) => {
    if (e.target.closest('.pi-select')) return;
    const item = e.target.closest('.playlist-item');
    // 選取模式的清單列只負責「選／不選」：不能在批次操作途中誤觸播放、刪除、
    // 編輯或改歌詞，避免直播中的目前歌曲與待處理選取集合互相干擾。
    if (selectionMode && item) {
      if (!item.classList.contains('active')) toggleTrackSelection(item.dataset.selectionKey);
      return;
    }
    const removeBtn = e.target.closest('.pi-remove');
    if (removeBtn) {
      e.stopPropagation();
      removeTrack(parseInt(removeBtn.dataset.remove, 10));
      return;
    }
    const editBtn = e.target.closest('.pi-edit');
    if (editBtn) {
      e.stopPropagation();
      openTrackEditModal(parseInt(editBtn.dataset.edit, 10));
      return;
    }
    const lyricsFixBtn = e.target.closest('[data-lyrics-fix]');
    if (lyricsFixBtn) {
      e.stopPropagation();
      const idx = parseInt(lyricsFixBtn.dataset.lyricsFix, 10);
      const track = state.playlist[idx];
      if (track && window.LyricPicker) window.LyricPicker.open(track);
      return;
    }
    if (e.target.closest('.pi-handle')) return; // 點到拖曳把手不算選歌
    if (item) {
      AppShared.playTrack(parseInt(item.dataset.index, 10), false); // 點清單只載入待命，不自動播放
    }
  });

  dom.playlist.addEventListener('change', (e) => {
    const checkbox = e.target.closest('.pi-select');
    if (!checkbox || checkbox.disabled) return;
    toggleTrackSelection(checkbox.dataset.selectionKey);
  });

  // ── 拖曳排序（HTML5 Drag & Drop）──
  // 只有從左側把手（.pi-handle）按下去才允許拖曳，避免與「點整列載入歌曲」互相干擾。
  let dragFromIndex = -1;
  let dragArmed = false;
  dom.playlist.addEventListener('pointerdown', (e) => { dragArmed = !selectionMode && !!e.target.closest('.pi-handle'); });
  dom.playlist.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.playlist-item');
    if (!item || selectionMode || !dragArmed) { e.preventDefault(); return; }
    dragFromIndex = parseInt(item.dataset.index, 10);
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(dragFromIndex)); } catch (_) {}
  });
  function clearDropMarkers() {
    dom.playlist.querySelectorAll('.drop-above, .drop-below').forEach((n) => n.classList.remove('drop-above', 'drop-below'));
  }
  dom.playlist.addEventListener('dragover', (e) => {
    if (dragFromIndex < 0) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const item = e.target.closest('.playlist-item');
    clearDropMarkers();
    if (!item || item.classList.contains('dragging')) return;
    const rect = item.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    item.classList.add(before ? 'drop-above' : 'drop-below');
  });
  dom.playlist.addEventListener('drop', (e) => {
    if (dragFromIndex < 0) return;
    e.preventDefault();
    const item = e.target.closest('.playlist-item');
    let to;
    if (item) {
      const rect = item.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      to = parseInt(item.dataset.index, 10) + (before ? 0 : 1);
    } else {
      to = state.playlist.length; // 拖到清單空白處＝移到最後
    }
    moveTrack(dragFromIndex, to);
  });
  dom.playlist.addEventListener('dragend', () => {
    dragFromIndex = -1;
    dragArmed = false;
    clearDropMarkers();
    dom.playlist.querySelectorAll('.dragging').forEach((n) => n.classList.remove('dragging'));
  });

  // 把第 from 首移到「插入點 to」（to 為移除前的插入索引），並同步正在播放的索引與其他端
  function moveTrack(from, to) {
    const playlist = state.playlist;
    if (from < 0 || from >= playlist.length) return;
    let insertAt = to > from ? to - 1 : to; // 先移除再插入，落點在 from 之後要往前補 1
    insertAt = Math.max(0, Math.min(playlist.length - 1, insertAt));
    if (insertAt === from) return;
    const previousPlaylist = playlist.slice();
    const previousIndex = state.currentTrackIndex;
    const [moved] = playlist.splice(from, 1);
    playlist.splice(insertAt, 0, moved);
    if (state.currentTrackIndex === from) state.currentTrackIndex = insertAt;
    else if (from < state.currentTrackIndex && insertAt >= state.currentTrackIndex) state.currentTrackIndex--;
    else if (from > state.currentTrackIndex && insertAt <= state.currentTrackIndex) state.currentTrackIndex++;
    renderPlaylist();
    SocketClient.sendWithCallback('playlist:update', playlist, (result) => {
      if (result?.ok) return;
      state.playlist = previousPlaylist;
      state.currentTrackIndex = previousIndex;
      renderPlaylist();
      AppShared.showToast(`排序未儲存：${result?.error || '伺服器沒有回應'}`, 'error');
    });
  }

  // 手動修改歌名/歌手：自動抓詞偶爾會抓錯（機率不高），提供手動修正入口。
  const trackEditModal = document.getElementById('track-edit-modal');
  const trackEditTitleInput = document.getElementById('track-edit-title');
  const trackEditArtistInput = document.getElementById('track-edit-artist');
  const trackEditArtistCandidates = document.getElementById('track-edit-artist-candidates');
  let trackEditIndex = -1;

  function openTrackEditModal(index) {
    const playlist = state.playlist;
    if (!trackEditModal || index < 0 || index >= playlist.length) return;
    trackEditIndex = index;
    trackEditTitleInput.value = playlist[index].title || '';
    trackEditArtistInput.value = playlist[index].artist || '';
    if (trackEditArtistCandidates) {
      trackEditArtistCandidates.replaceChildren(...(playlist[index].artistCandidates || []).map((artist) => {
        const option = document.createElement('option'); option.value = artist; return option;
      }));
    }
    trackEditModal.hidden = false;
    trackEditTitleInput.focus();
  }
  function closeTrackEditModal() { if (trackEditModal) trackEditModal.hidden = true; trackEditIndex = -1; }

  if (trackEditModal) {
    document.getElementById('track-edit-cancel').addEventListener('click', closeTrackEditModal);
    trackEditModal.addEventListener('click', (e) => { if (e.target === trackEditModal) closeTrackEditModal(); });
    document.getElementById('track-edit-save').addEventListener('click', () => {
      const playlist = state.playlist;
      if (trackEditIndex < 0 || trackEditIndex >= playlist.length) { closeTrackEditModal(); return; }
      const newTitle = trackEditTitleInput.value.trim();
      if (!newTitle) { AppShared.showToast('歌名不能空白', 'warning'); return; }
      const track = playlist[trackEditIndex];
      track.title = newTitle;
      track.artist = trackEditArtistInput.value.trim();
      track.needsArtistConfirmation = !track.artist;
      if (track.artist) track.artistConfidence = 1;
      renderPlaylist();
      if (trackEditIndex === state.currentTrackIndex) {
        setMarqueeText(dom.trackTitle, track.title);
        setMarqueeText(dom.trackArtist, track.artist || '');
        AppShared.updateMiniPlayerInfo(track.title, track.artist || '', track.cover);
      }
      // 用整份清單同步，讓 OBS/歌單等其他端也拿到修正後的歌名/歌手
      SocketClient.sendWithCallback('playlist:update', playlist, (result) => {
        if (result && result.ok) { AppShared.showToast('已更新歌名/歌手', 'success'); closeTrackEditModal(); }
        else AppShared.showToast(`更新失敗：${result?.error || '伺服器沒有確認'}`, 'error');
      });
    });
  }

  // 歌曲準備度：依 lyricsType 判斷有沒有「能對上時間軸」的歌詞。
  // 'krc'＝逐字同步、'lrc'＝逐句同步、'txt'＝純文字（無時間戳）、無 lyrics＝無歌詞。
  // 文字標籤（非顏色）呈現，避免不識別顏色意涵時看不懂三種狀態差異。
  function lyricsReadiness(track) {
    // 同步清單只保留 hasLyrics／lyricsType；目前歌曲才保留原始 lyrics，兩者都能正確顯示準備度。
    const hasLyrics = !!(track.hasLyrics || track.lyrics);
    if (hasLyrics && track.lyricsType === 'krc') {
      return { level: 'word', text: '逐字', label: '已有逐字同步歌詞，點擊可更換來源' };
    }
    if (hasLyrics && track.lyricsType === 'lrc') {
      return { level: 'line', text: '逐句', label: '已有逐句同步歌詞，點擊可更換來源' };
    }
    if (hasLyrics) {
      return { level: 'plain', text: '純文字', label: '只有純文字歌詞（沒有時間軸，跑動畫時只能整段顯示）。點擊挑選有時間軸的版本' };
    }
    return { level: 'none', text: '無歌詞', label: '尚無歌詞。點擊搜尋或選擇歌詞' };
  }

  // 歌詞狀態文字徽章 + 已選歌詞/offset 徽章：獨立成一段，好讓 renderPlaylist 的就地更新路徑
  // 能整段重繪這裡（避免像過去只更新標題/歌手文字、徽章卻停留在舊值的問題）。
  function playlistExtrasMarkup(track, i) {
    const readiness = lyricsReadiness(track);
    const manualBadge = track.manualLyrics ? '<span class="pi-badge">已選歌詞</span>' : '';
    const offsetMs = track.offset || 0;
    const offsetBadge = offsetMs !== 0
      ? `<span class="pi-badge">${offsetMs > 0 ? '+' : ''}${(offsetMs / 1000).toFixed(1)}s</span>`
      : '';
    const audioBadge = track.audioMissing
      ? '<span class="pi-badge pi-badge--danger" title="音檔遺失，播放前需要重新下載">音檔遺失</span>'
      : '';
    return `${audioBadge}<button class="pi-lyrics-status pi-lyrics-status--${readiness.level}" data-lyrics-fix="${i}" title="${escapeHtml(readiness.label)}" aria-label="${escapeHtml(readiness.label)}">${readiness.text}</button>${manualBadge}${offsetBadge}`;
  }

  function playlistItemMarkup(track, i, selectionKey, isActive, isSelected) {
    const coverUrl = safeHttpUrl(track.cover);
    const coverImg = coverUrl
      ? `<img class="pi-cover" src="${escapeHtml(coverUrl)}" alt="">`
      : '<div class="pi-cover"></div>';
    const trackTitle = track.title || '這首歌';
    const selectionLabel = isActive
      ? `目前播放中，不能批次移除：${trackTitle}`
      : `選取：${trackTitle}`;
    return `
        <input class="pi-select" type="checkbox" data-selection-key="${escapeHtml(selectionKey)}" aria-label="${escapeHtml(selectionLabel)}"${isActive ? ' disabled' : ''}${isSelected ? ' checked' : ''}>
        <span class="pi-handle" title="按住拖曳調整順序" aria-hidden="true"><svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/></svg></span>
        ${coverImg}
        <div class="pi-meta">
          <div class="pi-title marquee-text"><span>${escapeHtml(track.title)}</span></div>
          <div class="pi-artist marquee-text"><span>${escapeHtml(track.artist || (track.needsArtistConfirmation ? '原唱待確認' : '未知歌手'))}${track.performer ? ` · 翻唱：${escapeHtml(track.performer)}` : ''}</span></div>
        </div>
        <span class="pi-extras">${playlistExtrasMarkup(track, i)}</span>
        <button class="pi-edit" data-edit="${i}" title="修改歌名/歌手" aria-label="修改歌名/歌手">✎</button>
        <button class="pi-remove" data-remove="${i}" title="移除" aria-label="移除">×</button>`;
  }

  // 量測單一「歌名/歌手名跑馬燈」是否需要滾動（文字寬度是否超出容器），只在真的溢出時才動畫。
  function measureMarquee(el) {
    const span = el.querySelector('span');
    if (!span) return;
    el.classList.remove('is-overflowing');
    el.style.removeProperty('--marquee-dist');
    const overflow = span.scrollWidth - el.clientWidth;
    if (overflow > 4) {
      el.classList.add('is-overflowing');
      el.style.setProperty('--marquee-dist', `${-overflow}px`);
      el.style.setProperty('--marquee-duration', `${Math.max(4, overflow / 25)}s`);
    }
  }
  function updateMarquee(scopeEl) {
    (scopeEl || dom.playlist).querySelectorAll('.marquee-text').forEach(measureMarquee);
  }
  // 設定「現在播放」標題/歌手（頂部大字），文字過長時比照播放清單加跑馬燈滾動。
  function setMarqueeText(el, text) {
    if (!el) return;
    let span = el.querySelector(':scope > span');
    if (!span) {
      el.textContent = ''; // 清掉初始 HTML 裡的純文字節點（例如「尚未播放」），避免跟新建的 span 並存
      span = document.createElement('span');
      el.appendChild(span);
      el.classList.add('marquee-text');
    }
    span.textContent = text;
    requestAnimationFrame(() => measureMarquee(el));
  }

  function renderPlaylist() {
    const playlist = state.playlist;
    const currentTrackIndex = state.currentTrackIndex;
    reconcileSelectedTracks();
    // 剩餘時間：從「目前播放（含）」往後加總；尚未開始播放則加總全部
    const fromIdx = currentTrackIndex >= 0 ? currentTrackIndex : 0;
    let remainingSec = 0;
    for (let i = fromIdx; i < playlist.length; i++) remainingSec += (playlist[i].duration || 0);
    if (dom.playlistCount) {
      const remTxt = remainingSec > 0 ? ` · 剩 ${formatTime(remainingSec)}` : '';
      dom.playlistCount.textContent = `${playlist.length} 首${remTxt}`;
    }
    if (playlist.length === 0) {
      selectedTrackKeys.clear();
      selectionMode = false;
      dom.playlist.innerHTML = `
        <div class="playlist-empty">尚無歌曲，請上傳檔案或貼上 YouTube 連結</div>`;
      syncPlaylistTools(0);
      return;
    }
    if (dom.playlist.querySelector('.playlist-empty')) dom.playlist.innerHTML = '';

    // 逐位置比對：同一位置的曲目沒變（同 id）就地更新 active/played 狀態，不重建 DOM
    // （尤其是 <img class="pi-cover">，重建等於強迫瀏覽器重新解碼圖片）；只有真的新增/
    // 順序改變的位置才重建該列。短時間連續加很多首歌時，這讓每次 render 只需要處理「新
    // 增的那幾列」，不會把已經在清單裡的歌全部重新蓋一次，避免 O(歌曲數²) 的重複解圖成本。
    const existing = Array.from(dom.playlist.children);
    let visibleCount = 0;
    playlist.forEach((track, i) => {
      const isActive = i === currentTrackIndex;
      const isPlayed = currentTrackIndex >= 0 && i < currentTrackIndex;
      const selectionKey = getSelectionKey(track);
      const isSelected = selectedTrackKeys.has(selectionKey);
      const isVisible = trackMatchesFilter(track, i, currentTrackIndex);
      if (isVisible) visibleCount += 1;
      const key = track.id != null ? String(track.id) : `${track.title}|${track.artist}|${i}`;
      const node = existing[i];
      if (node && node.dataset.trackKey === key) {
        node.className = `playlist-item ${isActive ? 'active' : ''} ${isPlayed ? 'played' : ''} ${isSelected ? 'is-selected' : ''} ${track.audioMissing ? 'audio-missing' : ''}`;
        node.dataset.index = String(i);
        node.dataset.selectionKey = selectionKey;
        node.draggable = !selectionMode;
        node.hidden = !isVisible;
        const removeBtn = node.querySelector('.pi-remove');
        if (removeBtn) removeBtn.dataset.remove = String(i);
        const editBtn = node.querySelector('.pi-edit');
        if (editBtn) editBtn.dataset.edit = String(i);
        const selectInput = node.querySelector('.pi-select');
        if (selectInput) {
          selectInput.dataset.selectionKey = selectionKey;
          selectInput.checked = isSelected;
          selectInput.disabled = isActive;
          selectInput.setAttribute('aria-label', isActive
            ? `目前播放中，不能批次移除：${track.title || '這首歌'}`
            : `選取：${track.title || '這首歌'}`);
        }
        // 同 id 但文字可能變了（例如使用者手動修正歌名/歌手）：只更新文字節點，
        // 刻意不動 <img class="pi-cover">，避免每次 render 都重新解碼封面圖。
        const titleSpan = node.querySelector('.pi-title span');
        if (titleSpan && titleSpan.textContent !== track.title) { titleSpan.textContent = track.title; }
        const artistSpan = node.querySelector('.pi-artist span');
        const artistText = `${track.artist || (track.needsArtistConfirmation ? '原唱待確認' : '未知歌手')}${track.performer ? ` · 翻唱：${track.performer}` : ''}`;
        if (artistSpan && artistSpan.textContent !== artistText) { artistSpan.textContent = artistText; }
        // 歌詞狀態 dot / 已選歌詞 / offset 徽章：文字內容小、整段重繪比逐一比對划算，
        // 也順便修掉「offset/歌詞狀態變了但清單顯示沒跟著變」的問題。
        const extras = node.querySelector('.pi-extras');
        const extrasMarkup = playlistExtrasMarkup(track, i);
        if (extras && extras.innerHTML !== extrasMarkup) extras.innerHTML = extrasMarkup;
      } else {
        const fresh = document.createElement('div');
        fresh.className = `playlist-item ${isActive ? 'active' : ''} ${isPlayed ? 'played' : ''} ${isSelected ? 'is-selected' : ''} ${track.audioMissing ? 'audio-missing' : ''}`;
        fresh.dataset.index = String(i);
        fresh.dataset.trackKey = key;
        fresh.dataset.selectionKey = selectionKey;
        fresh.draggable = !selectionMode;
        fresh.hidden = !isVisible;
        fresh.innerHTML = playlistItemMarkup(track, i, selectionKey, isActive, isSelected);
        if (node) dom.playlist.replaceChild(fresh, node); else dom.playlist.appendChild(fresh);
      }
    });
    // 清掉多餘的尾端節點（歌曲被移除時清單變短）
    while (dom.playlist.children.length > playlist.length) {
      dom.playlist.removeChild(dom.playlist.lastChild);
    }
    syncPlaylistTools(visibleCount);
    requestAnimationFrame(() => updateMarquee(dom.playlist));
  }

  async function removeTrack(index) {
    const playlist = state.playlist;
    const track = playlist[index];
    if (!track) return;
    // 刪除前先確認（避免直播中誤觸把歌刪掉）
    const confirmed = await window.PanelConfirm?.request({
      title: `從播放清單移除「${track.title || '這首歌'}」？`,
      summary: '這首歌會從本次播放清單移除。',
      impact: '手動歌詞修正與歌詞同步微調會保留；日後重新加入同一首歌時會自動恢復。',
      tone: 'danger',
      confirmLabel: '移除歌曲',
    });
    if (!confirmed) return;
    const previousPlaylist = playlist.slice();
    const previousIndex = state.currentTrackIndex;
    playlist.splice(index, 1);

    if (index === state.currentTrackIndex) {
      if (playlist.length > 0) {
        const newIndex = Math.min(index, playlist.length - 1);
        AppShared.playTrack(newIndex);
      } else {
        AppShared.stopPlayback();
        state.currentTrackIndex = -1;
      }
    } else if (index < state.currentTrackIndex) {
      state.currentTrackIndex--;
    }

    renderPlaylist();
    // 用整份清單同步（而非 playlist:remove by id）：才能正確只移除「這一筆」，
    // 不會把重複加入的同一首歌（相同 id）全部一起刪掉。
    SocketClient.sendWithCallback('playlist:update', playlist, (result) => {
      if (result?.ok) return;
      state.playlist = previousPlaylist;
      state.currentTrackIndex = previousIndex;
      renderPlaylist();
      AppShared.showToast(`歌曲未刪除：${result?.error || '伺服器沒有回應'}`, 'error');
    });
  }

  // ── 清單搜尋、篩選與批次移除 ──
  // 這一組狀態只屬於當前桌面控制台；同步到其他端的仍是既有 playlist:update。
  // 批次操作刻意不允許選到目前播放曲，因此不用停止/跳歌，也不會讓 OBS 歌詞中斷。
  function clearPlaylistFilter() {
    playlistFilterQuery = '';
    playlistFilterMode = 'all';
    if (dom.playlistFilter) dom.playlistFilter.value = '';
    if (dom.playlistFilterMode) dom.playlistFilterMode.value = 'all';
    renderPlaylist();
    if (dom.playlistFilter) dom.playlistFilter.focus();
  }

  function toggleVisibleTrackSelection() {
    const visible = visibleSelectableTracks();
    if (visible.length === 0) return;
    const allVisibleSelected = visible.every(({ key }) => selectedTrackKeys.has(key));
    visible.forEach(({ key }) => {
      if (allVisibleSelected) selectedTrackKeys.delete(key);
      else selectedTrackKeys.add(key);
    });
    renderPlaylist();
  }

  async function removeSelectedTracks() {
    const selected = selectedTracks();
    if (selected.length === 0) return;
    const confirmed = await window.DangerConfirm?.request({
      title: `確認移除 ${selected.length} 首歌曲`,
      summary: `即將從播放清單移除 ${selected.length} 首已選歌曲。`,
      impact: '正在播放的歌曲不能批次選取，因此不會停止、跳歌或影響 OBS。這只會移出播放清單；音檔、媒體庫、手動歌詞與同步微調都會保留。',
      phrase: `移除 ${selected.length} 首歌曲`,
      confirmLabel: '移除已選歌曲',
    });
    if (!confirmed) return;

    const previousPlaylist = state.playlist.slice();
    const previousIndex = state.currentTrackIndex;
    const keysToRemove = new Set(selected.map(({ key }) => key));
    const removedBeforeCurrent = selected.filter(({ index }) => index < previousIndex).length;
    state.playlist = state.playlist.filter((track) => !keysToRemove.has(getSelectionKey(track)));
    if (previousIndex >= 0) state.currentTrackIndex = previousIndex - removedBeforeCurrent;
    selectedTrackKeys.clear();
    selectionMode = false;
    renderPlaylist();

    // playlist:update 能保留同 id 的手動歌詞與 offset，也能正確處理清單內的重複曲目。
    SocketClient.sendWithCallback('playlist:update', state.playlist, (result) => {
      if (result?.ok) {
        state.playlist = result.playlist || state.playlist;
        renderPlaylist();
        AppShared.showToast(`已從播放清單移除 ${selected.length} 首歌曲`, 'success');
        return;
      }
      state.playlist = previousPlaylist;
      state.currentTrackIndex = previousIndex;
      renderPlaylist();
      AppShared.showToast(`歌曲未刪除：${result?.error || '伺服器沒有回應'}`, 'error');
    });
  }

  if (dom.playlistFilter) {
    dom.playlistFilter.addEventListener('input', (e) => {
      playlistFilterQuery = e.target.value || '';
      renderPlaylist();
    });
  }
  if (dom.playlistFilterMode) {
    dom.playlistFilterMode.addEventListener('change', (e) => {
      playlistFilterMode = e.target.value || 'all';
      renderPlaylist();
    });
  }
  if (dom.btnPlaylistFilterClear) dom.btnPlaylistFilterClear.addEventListener('click', clearPlaylistFilter);
  if (dom.btnPlaylistSelect) dom.btnPlaylistSelect.addEventListener('click', () => setSelectionMode(!selectionMode));
  if (dom.btnPlaylistSelectVisible) dom.btnPlaylistSelectVisible.addEventListener('click', toggleVisibleTrackSelection);
  if (dom.btnPlaylistSelectionCancel) dom.btnPlaylistSelectionCancel.addEventListener('click', () => setSelectionMode(false));
  if (dom.btnPlaylistSelectionRemove) dom.btnPlaylistSelectionRemove.addEventListener('click', removeSelectedTracks);

  // 一鍵清除整個播放清單（含確認警告）
  async function clearAllTracks() {
    const playlist = state.playlist;
    if (playlist.length === 0) { AppShared.showToast('播放清單已經是空的'); return; }
    const confirmed = await window.PanelConfirm?.request({
      title: '清空本次播放清單？',
      summary: `即將清除這次播放清單的 ${playlist.length} 首歌。`,
      impact: '歌曲音檔、媒體庫紀錄、手動歌詞與同步微調都會保留；之後可從媒體庫重新加入。',
      tone: 'danger',
      confirmLabel: '清除全部',
    });
    if (!confirmed) return;
    SocketClient.sendWithCallback('playlist:update', [], (result) => {
      if (result?.ok) {
        AppShared.stopPlayback();
        state.playlist = [];
        state.currentTrackIndex = -1;
        renderPlaylist();
        AppShared.showToast('已清除播放清單', 'success');
      } else AppShared.showToast(`清除失敗：${result?.error || '伺服器沒有回應'}`, 'error');
    });
  }
  if (dom.btnPlaylistClear) dom.btnPlaylistClear.addEventListener('click', clearAllTracks);

  // ═══════════════════════════════════════════
  // 播放清單匯出匯入（App 內取名/選清單，不跳系統檔案總管，存在伺服器固定資料夾）
  // ═══════════════════════════════════════════

  if (dom.btnPlaylistExport && dom.playlistExportModal) {
    dom.btnPlaylistExport.addEventListener('click', () => {
      if (dom.playlistExportError) dom.playlistExportError.classList.remove('is-visible');
      if (dom.playlistExportName) {
        dom.playlistExportName.value = `播放清單-${new Date().toISOString().slice(0, 10)}`;
      }
      dom.playlistExportModal.hidden = false;
      if (dom.playlistExportName) { dom.playlistExportName.focus(); dom.playlistExportName.select(); }
    });
  }
  if (dom.playlistExportCancel && dom.playlistExportModal) {
    dom.playlistExportCancel.addEventListener('click', () => { dom.playlistExportModal.hidden = true; });
  }
  if (dom.playlistExportModal) {
    dom.playlistExportModal.addEventListener('click', (e) => {
      if (e.target === dom.playlistExportModal) dom.playlistExportModal.hidden = true;
    });
  }
  function confirmPlaylistExport() {
    const name = dom.playlistExportName ? dom.playlistExportName.value.trim() : '';
    SocketClient.sendWithCallback('playlist:export-save', name, (result) => {
      if (result && result.ok) {
        dom.playlistExportModal.hidden = true;
        AppShared.showToast(`播放清單已匯出：${result.filename}`, 'success');
      } else if (dom.playlistExportError) {
        dom.playlistExportError.textContent = (result && result.error) || '匯出失敗，請重試';
        dom.playlistExportError.classList.add('is-visible');
      }
    });
  }
  if (dom.playlistExportConfirm) {
    dom.playlistExportConfirm.addEventListener('click', confirmPlaylistExport);
  }
  if (dom.playlistExportName) {
    dom.playlistExportName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirmPlaylistExport();
    });
  }

  function applyImportedPlaylist(data, onSuccess) {
    if (data && Array.isArray(data.playlist)) {
      SocketClient.sendWithCallback('playlist:import', data, (result) => {
        if (!result?.ok) return AppShared.showToast(`匯入失敗：${result?.error || '伺服器沒有確認'}`, 'error');
        state.playlist = result.playlist || data.playlist;
        state.currentTrackIndex = data.currentTrackIndex >= 0 ? data.currentTrackIndex : -1;
        renderPlaylist(); AppShared.showToast(`已匯入 ${state.playlist.length} 首歌曲`, 'success');
        if (typeof onSuccess === 'function') onSuccess();
      });
      return;
    }
    AppShared.showToast('無效的播放清單格式', 'error');
  }

  function renderPlaylistImportList(files) {
    if (!dom.playlistImportList) return;
    if (!files || files.length === 0) {
      dom.playlistImportList.innerHTML = '';
      if (dom.playlistImportEmpty) dom.playlistImportEmpty.hidden = false;
      return;
    }
    if (dom.playlistImportEmpty) dom.playlistImportEmpty.hidden = true;
    dom.playlistImportList.innerHTML = files.map((f, i) => {
      const date = new Date(f.savedAt).toLocaleString('zh-TW', { hour12: false });
      return `<button class="btn btn-ghost playlist-import-item" type="button" data-import-filename="${escapeHtml(f.filename)}">
        <span>${escapeHtml(f.name)}</span><span class="pi-artist playlist-import-item__date">${escapeHtml(date)}</span>
      </button>`;
    }).join('');
    dom.playlistImportList.querySelectorAll('[data-import-filename]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const filename = btn.getAttribute('data-import-filename');
        SocketClient.sendWithCallback('playlist:export-load', filename, (data) => {
          applyImportedPlaylist(data, () => { dom.playlistImportModal.hidden = true; });
        });
      });
    });
  }

  if (dom.btnPlaylistImport && dom.playlistImportModal) {
    dom.btnPlaylistImport.addEventListener('click', () => {
      SocketClient.sendWithCallback('playlist:export-list', null, (files) => {
        renderPlaylistImportList(files);
        dom.playlistImportModal.hidden = false;
      });
    });
  }
  if (dom.playlistImportCancel && dom.playlistImportModal) {
    dom.playlistImportCancel.addEventListener('click', () => { dom.playlistImportModal.hidden = true; });
  }
  if (dom.playlistImportModal) {
    dom.playlistImportModal.addEventListener('click', (e) => {
      if (e.target === dom.playlistImportModal) dom.playlistImportModal.hidden = true;
    });
  }

  // 供其他模組（app.js 目前仍持有的播放邏輯、之後的 app-playback.js）呼叫
  AppShared.renderPlaylist = renderPlaylist;
  AppShared.setMarqueeText = setMarqueeText;
  AppShared.measureMarquee = measureMarquee;
  AppShared.updateMarquee = updateMarquee;
})();
