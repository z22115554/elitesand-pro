/**
 * Elitesand Pro — 直播頁「準備區」（2026-09-26 改版 P2，docs/UIUX-REDESIGN.md §5）
 *
 * 即時點歌派的流程：觀眾點歌 → 下載 → 跑 AI 伴奏（這時跟觀眾聊天）→ 開唱前選歌詞、對時間。
 * 準備區讓主播對「清單裡任何一首」做這些事，不必先把正在唱的歌切掉。
 *
 * - 目標歌曲：預設就是目前載入的那首（清單單擊＝載入）。清單的歌詞狀態徽章可以臨時選別首來換歌詞，
 *   下一次換歌時自動回到目前這首。
 * - 歌詞搜尋／貼上／上傳、±偏移、歸零都作用在目標歌曲（各模組透過 AppShared.prepTargetIndex() 取目標）。
 * - 對齊第一句、倒數對齊、逐行時間軸需要實際播放，只在目標＝目前這首時可用。
 * - 純前端 UI：不新增 socket 事件或伺服器欄位；偏移與歌詞仍走既有 offset:* ／ lyrics:manual。
 */
(function () {
  'use strict';

  const root = document.getElementById('live-prep');
  if (!root || !window.AppShared) return;

  const state = AppShared.state;
  const T = (k, v) => (window.I18n ? window.I18n.t(k, v) : k);
  const $ = (id) => document.getElementById(id);
  const els = {
    title: $('live-prep-title'),
    sub: $('live-prep-sub'),
    ready: $('live-prep-ready'),
    load: $('live-prep-load'),
    audioState: $('live-prep-audio-state'),
    aiState: $('live-prep-ai-state'),
    aiMake: $('live-prep-ai-make'),
    audioNote: $('live-prep-audio-note'),
    lyricsNote: $('live-prep-lyrics-note'),
    syncNote: $('live-prep-sync-note'),
    syncHint: $('live-prep-sync-hint'),
    align: $('offset-align'),
    countdown: $('countdown-align-box'),
    timeline: $('btn-lyrics-timeline'),
    playlist: $('playlist'),
  };

  let pinnedId = null; // 使用者明確選的那首；null＝跟著目前播放

  function currentTrack() {
    return state.playlist[state.currentTrackIndex] || null;
  }

  function targetIndex() {
    if (pinnedId != null) {
      const idx = state.playlist.findIndex((t) => t && t.id === pinnedId);
      if (idx >= 0) return idx;
      pinnedId = null; // 選的那首被移除了 → 回到跟著目前播放
    }
    return state.currentTrackIndex;
  }

  function targetTrack() {
    const idx = targetIndex();
    return idx >= 0 ? state.playlist[idx] || null : null;
  }

  function lyricsLevel(track) {
    const has = !!(track.hasLyrics || track.lyrics);
    if (has && track.lyricsType === 'krc') return 'word';
    if (has && track.lyricsType === 'lrc') return 'line';
    return has ? 'plain' : 'none';
  }

  function setPill(el, text, tone) {
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
    el.dataset.tone = tone || '';
  }

  let lastCurrentIndex = state.currentTrackIndex;
  function render() {
    // 載入了別首歌 → 準備區回到目前這首（徽章臨時選的別首只維持到下一次換歌）
    if (state.currentTrackIndex !== lastCurrentIndex) {
      lastCurrentIndex = state.currentTrackIndex;
      pinnedId = null;
      if (typeof waveDrag !== 'undefined') waveDrag.sec = null;
    }
    const track = targetTrack();
    const idx = targetIndex();
    const isCurrent = idx >= 0 && idx === state.currentTrackIndex;
    root.classList.toggle('is-empty', !track);
    root.classList.toggle('is-other', !!track && !isCurrent);

    if (!track) {
      els.title.textContent = T('livePrep.noTrack');
      els.sub.textContent = '';
      els.ready.hidden = true;
      els.load.hidden = true;
      setPill(els.audioState, '');
      setPill(els.aiState, '');
      if (els.aiMake) els.aiMake.hidden = true;
      if (els.audioNote) els.audioNote.textContent = '';
      if (els.lyricsNote) els.lyricsNote.textContent = '';
      if (els.syncNote) els.syncNote.textContent = '';
      if (els.syncHint) els.syncHint.hidden = true;
      markRows();
      drawWave();
      return;
    }

    els.title.textContent = track.title || '';
    const status = isCurrent
      ? (AppShared.isPlaying && AppShared.isPlaying() ? T('livePrep.nowPlaying') : T('livePrep.standby'))
      : T('livePrep.upNext');
    els.sub.textContent = [track.artist, status].filter(Boolean).join(' · ');

    // 載入待命：目標不是目前這首時才需要。正在唱的時候提醒這會切歌。
    els.load.hidden = isCurrent;
    const playing = !!(AppShared.isPlaying && AppShared.isPlaying());
    els.load.textContent = T(playing ? 'livePrep.loadWhilePlaying' : 'livePrep.load');
    els.load.classList.toggle('btn-danger', playing);

    // 01 音檔與 AI 伴奏
    setPill(els.audioState, T(track.audioMissing ? 'livePrep.audioMissing' : 'livePrep.audioReady'), track.audioMissing ? 'warn' : 'ok');
    const ai = window.HomeAiSeparation ? window.HomeAiSeparation.statusOf(track) : { key: track.separationStatus === 'done' ? 'done' : 'none' };
    let aiText = '';
    let aiTone = '';
    if (ai.key === 'done') { aiText = T('livePrep.aiDone'); aiTone = 'ok'; }
    else if (ai.key === 'working') {
      const pct = ai.live && typeof ai.live.percent === 'number' ? `${ai.live.percent}%` : '';
      aiText = T('livePrep.aiWorking', { percent: pct }).trim(); aiTone = 'busy';
    } else if (ai.key === 'failed') { aiText = T('livePrep.aiFailed'); aiTone = 'warn'; }
    else { aiText = T('livePrep.aiNone'); aiTone = ''; }
    setPill(els.aiState, aiText, aiTone);
    if (els.aiMake) els.aiMake.hidden = !(ai.key === 'none' || ai.key === 'failed') || !!track.audioMissing;
    if (els.audioNote) els.audioNote.textContent = ai.key === 'working' ? T('livePrep.aiWorkingNote') : '';

    // 02 歌詞
    const level = lyricsLevel(track);
    if (els.lyricsNote) {
      els.lyricsNote.textContent = T({ word: 'livePrep.lyricsWord', line: 'livePrep.lyricsLine', plain: 'livePrep.lyricsPlain', none: 'livePrep.lyricsNone' }[level]);
      els.lyricsNote.dataset.tone = level === 'word' || level === 'line' ? 'ok' : 'warn';
    }

    // 03 對時：需要實際播放的工具只給目前這首
    [els.align, els.countdown, els.timeline].forEach((el) => { if (el) el.disabled = !isCurrent; });
    if (els.syncHint) els.syncHint.hidden = isCurrent;
    if (els.syncNote) {
      const off = (isCurrent ? state.currentOffsetMs : track.offset) || 0;
      const value = `${off >= 0 ? '+' : ''}${(off / 1000).toFixed(1)}s`;
      els.syncNote.textContent = T('livePrep.offsetValue', { value });
    }
    root.querySelector('[data-prep-step="sync"]')?.setAttribute('data-mode', isCurrent ? 'current' : 'other');

    // 標題列的準備度：音檔在、有時間軸歌詞＝可以開唱（伴奏是選配，不擋）
    const readyKey = track.audioMissing ? 'livePrep.needsAudio'
      : (level === 'word' || level === 'line') ? 'livePrep.ready' : 'livePrep.needsLyrics';
    els.ready.hidden = false;
    els.ready.textContent = T(readyKey);
    els.ready.dataset.tone = readyKey === 'livePrep.ready' ? 'ok' : 'warn';

    markRows();
    drawWave();
  }

  // ─── 波形（docs/UIUX-REDESIGN.md §5.1）───
  // 真實峰值來自 /api/library/:id/waveform（伺服器用 ffmpeg 算一次後快取）。
  // 每句歌詞的位置只畫在目前這首：只有它帶完整 parsedLyrics；其他歌的清單摘要不含歌詞內容。
  // 顯示端判斷式 adjustedTime = audioTime + offset → 某句在 audioTime = line.time − offset 出現。
  const waveEls = { canvas: $('live-prep-wave'), note: $('live-prep-wave-note'), wrap: $('live-prep-wave-wrap') };
  const waveCache = new Map(); // trackId -> { status: 'loading'|'ok'|'none', data }

  function requestWave(track) {
    if (!track || waveCache.has(track.id) || typeof PinAuth === 'undefined') return;
    waveCache.set(track.id, { status: 'loading' });
    PinAuth.fetchWithPin(`/api/library/${encodeURIComponent(track.id)}/waveform`)
      .then((r) => r.json().catch(() => ({})))
      .then((body) => {
        waveCache.set(track.id, body && body.ok && Array.isArray(body.peaks) ? { status: 'ok', data: body } : { status: 'none' });
      })
      .catch(() => waveCache.set(track.id, { status: 'none' }))
      .finally(() => { if (targetTrack() && targetTrack().id === track.id) drawWave(); });
  }

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function drawWave() {
    const { canvas, note, wrap } = waveEls;
    if (!canvas || !wrap) return;
    const track = targetTrack();
    wrap.hidden = !track;
    if (!track) return;
    const entry = waveCache.get(track.id);
    if (!entry) { requestWave(track); }
    const status = entry ? entry.status : 'loading';

    // 直播頁不在畫面上時 canvas 寬度是 0：此時畫會變成 1px 寬再被拉滿，整塊變成文字色。
    // 先不畫，等 ResizeObserver 在頁面重新出現時補畫。
    if (!canvas.clientWidth || !canvas.clientHeight) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (status !== 'ok') {
      if (note) note.textContent = T(status === 'loading' ? 'livePrep.waveLoading' : 'livePrep.waveNone');
      return;
    }
    const { peaks, duration } = entry.data;
    const isCurrent = targetIndex() === state.currentTrackIndex;
    const barColor = cssVar('--border-strong', '#3A3A34');
    const accent = cssVar('--accent', '#E9B949');
    const text = cssVar('--text', '#EDEBE4');
    const mid = h / 2;
    const perPx = peaks.length / w;
    ctx.fillStyle = barColor;
    for (let x = 0; x < w; x++) {
      const from = Math.floor(x * perPx);
      const to = Math.max(from + 1, Math.floor((x + 1) * perPx));
      let m = 0;
      for (let i = from; i < to && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
      const bar = Math.max(1, (m / 255) * (h - 4 * dpr));
      ctx.fillRect(x, mid - bar / 2, 1, bar);
    }
    const secToX = (sec) => (sec / duration) * w;
    const offsetMs = (isCurrent ? state.currentOffsetMs : track.offset) || 0;
    const lines = isCurrent && Array.isArray(track.parsedLyrics)
      ? track.parsedLyrics.filter((l) => l && typeof l.time === 'number' && l.text)
      : [];
    ctx.fillStyle = accent;
    lines.forEach((line, i) => {
      const x = secToX((line.time - offsetMs) / 1000);
      if (x < 0 || x > w) return;
      ctx.fillRect(Math.round(x), 0, Math.max(1, Math.round(dpr)), i === 0 ? h : h * 0.35);
    });
    if (lines.length) {
      const x0 = secToX((lines[0].time - offsetMs) / 1000);
      if (x0 >= 0 && x0 <= w) {
        ctx.font = `${Math.round(10 * dpr)}px ${cssVar('--font-mono', 'monospace')}`;
        ctx.fillText(T('livePrep.waveFirstLine'), Math.min(x0 + 4 * dpr, w - 60 * dpr), 11 * dpr);
      }
    }
    if (isCurrent) {
      // 拖曳中（或暫停時剛點過）用指標位置畫播放線，播放中則跟著實際播放時間
      const playing = !!(AppShared.isPlaying && AppShared.isPlaying());
      const sec = waveDrag.active || (!playing && waveDrag.sec != null)
        ? waveDrag.sec
        : (typeof state.lastPlayTimeMs === 'number' ? state.lastPlayTimeMs / 1000 : null);
      if (sec != null) {
        ctx.fillStyle = text;
        ctx.fillRect(Math.round(secToX(sec)), 0, Math.max(1, Math.round(2 * dpr)), h);
      }
    }
    if (note) {
      note.textContent = isCurrent
        ? (lines.length ? '' : T('livePrep.waveNoLines'))
        : T('livePrep.waveOtherNote');
    }
  }

  // 波形可以點／拖曳跳轉：跟播放進度條同一套（app-playback.js bindSeekTrack），播放中會接著播。
  // 只有選中的是目前這首時可用（其他歌 CSS 會關掉指標事件）。
  const waveDrag = { active: false, sec: null };
  if (waveEls.canvas && typeof AppShared.bindSeekTrack === 'function') {
    AppShared.bindSeekTrack(waveEls.canvas);
    const secFromEvent = (e) => {
      const entry = targetTrack() && waveCache.get(targetTrack().id);
      if (!entry || entry.status !== 'ok') return null;
      const rect = waveEls.canvas.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      return ratio * entry.data.duration;
    };
    waveEls.canvas.addEventListener('pointerdown', (e) => { waveDrag.active = true; waveDrag.sec = secFromEvent(e); drawWave(); });
    waveEls.canvas.addEventListener('pointermove', (e) => { if (!waveDrag.active) return; waveDrag.sec = secFromEvent(e); drawWave(); });
    const end = (e) => { if (!waveDrag.active) return; waveDrag.active = false; waveDrag.sec = secFromEvent(e); drawWave(); };
    waveEls.canvas.addEventListener('pointerup', end);
    waveEls.canvas.addEventListener('pointercancel', end);
  }

  // 播放中讓播放位置線跟著走（4 fps 就夠，不跟逐幀渲染搶資源）
  setInterval(() => {
    if (document.hidden) return;
    if (targetIndex() === state.currentTrackIndex && AppShared.isPlaying && AppShared.isPlaying()) {
      if (!waveDrag.active) waveDrag.sec = null;
      drawWave();
    }
  }, 250);
  window.addEventListener('resize', () => drawWave());

  function markRows() {
    if (!els.playlist) return;
    const target = targetTrack();
    els.playlist.querySelectorAll('.playlist-item').forEach((row) => {
      const tr = state.playlist[parseInt(row.dataset.index, 10)];
      row.classList.toggle('is-prep-target', !!target && tr === target);
    });
  }

  // 用短 timeout 合併連續事件（清單重畫、offset、AI 進度常一次來好幾個）；
  // 不用 rAF，背景分頁時 rAF 會停，切回來之前狀態就一直是舊的。
  let renderTimer = 0;
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = 0; render(); }, 30);
  }

  function select(trackId) {
    pinnedId = trackId;
    render();
    if (typeof AppShared.updateOffsetDisplay === 'function') AppShared.updateOffsetDisplay();
    document.dispatchEvent(new CustomEvent('live-prep:target'));
    // 換了目標，內嵌的歌詞候選屬於上一首 → 收起
    const picker = $('lyrics-picker-modal');
    if (picker && picker.hasAttribute('data-inline-picker')) picker.hidden = true;
  }

  // 各模組取目標的共用入口（app-playback／app-lyrics-timeline／lyric-extras）
  AppShared.prepTargetIndex = targetIndex;

  els.load?.addEventListener('click', () => {
    const idx = targetIndex();
    if (idx < 0 || idx === state.currentTrackIndex) return;
    AppShared.playTrack(idx, false);
  });
  els.aiMake?.addEventListener('click', () => {
    const track = targetTrack();
    if (track && window.HomeAiSeparation) window.HomeAiSeparation.make(track, els.aiMake);
  });

  // 切回直播頁、視窗縮放時 canvas 尺寸會變：重畫波形（換語言、狀態更新可能發生在別的頁面）
  if (waveEls.canvas && typeof ResizeObserver === 'function') {
    new ResizeObserver(() => drawWave()).observe(waveEls.canvas);
  }
  document.addEventListener('view:change', (event) => {
    if (event.detail && event.detail.view === 'karaoke') setTimeout(drawWave, 0);
  });
  document.addEventListener('playlist:rendered', scheduleRender);
  document.addEventListener('lyrics-picker:applied', scheduleRender);
  window.addEventListener('i18n:change', scheduleRender);
  if (window.SocketClient) {
    SocketClient.on('offset:update', scheduleRender);
    SocketClient.on('state:sync', scheduleRender);
  }
  if (window.AiSeparation) window.AiSeparation.subscribe(scheduleRender, { replay: false });
  // 播放／暫停會改變「播放中／已載入」與載入按鈕的提醒
  ['btn-play', 'mini-btn-play'].forEach((id) => $(id)?.addEventListener('click', () => setTimeout(scheduleRender, 50)));

  // 取代舊的首頁分頁切換（home-prep-tabs.js）：新手導覽與教學仍用 HomePrepTabs.show(name) 指定要看哪一區。
  // 側欄的收合區塊（音訊／AI 伴奏／本場直播）會展開；加入音樂與對時本來就常駐，只捲到位置。
  window.HomePrepTabs = {
    show(name) {
      const details = document.querySelector(`.live-side details[data-prep-panel="${name}"]`);
      if (details) { details.open = true; details.scrollIntoView({ block: 'nearest' }); return; }
      const target = name === 'add' ? $('music-source-card') : name === 'sync' ? root.querySelector('[data-prep-step="sync"]') : null;
      target?.scrollIntoView({ block: 'nearest' });
    },
  };

  window.LivePrep = {
    select,
    targetId: () => { const t = targetTrack(); return t ? t.id : null; },
    render: scheduleRender,
  };

  render();
})();
