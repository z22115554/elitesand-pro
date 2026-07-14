/**
 * 歌詞補救工具 —— 逐行時間軸編輯器 + 手動歌詞上傳/貼上。
 *
 * 對外暴露 AppShared.applyManualLyrics，供 window.VKState.applyManualLyrics（app.js，
 * lyric-extras.js 的歌詞選擇器透過它套用候選歌詞）與這裡自己的上傳/貼上流程共用。
 */
(function () {
  'use strict';

  const { escapeHtml } = SharedUtils;
  const { dom } = AppShared;
  const state = AppShared.state;

  // ═══════════════════════════════════════════
  // 逐行歌詞時間軸編輯器
  // 「對齊第一句」只能整首一起平移；這裡讓使用者針對目前播放中歌曲的每一行
  // 個別調整時間戳（拖拍/搶拍常見於歌曲中段），改完整批送回 applyManualLyrics。
  // ═══════════════════════════════════════════
  let ltWorkingLines = null; // 編輯中的暫存陣列（未按套用前不影響實際播放）

  function msToClock(ms) {
    ms = Math.max(0, Math.round(ms));
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }
  // 解析 "分:秒.百分秒" 或單純數字（秒）輸入，格式錯誤回傳 null（不套用、不砍使用者輸入）
  function clockToMs(str) {
    str = String(str || '').trim();
    let m = str.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
    if (m) {
      const cs = m[3] ? Number((m[3] + '00').slice(0, 3)) : 0;
      return Number(m[1]) * 60000 + Number(m[2]) * 1000 + cs;
    }
    m = str.match(/^(\d+(?:\.\d+)?)$/);
    if (m) return Math.round(Number(m[1]) * 1000);
    return null;
  }

  function renderLyricsTimelineRows() {
    dom.ltRows.innerHTML = ltWorkingLines.map((l, i) => `
      <div class="lt-row" data-idx="${i}">
        <input class="lt-time input" type="text" value="${msToClock(l.time)}" inputmode="decimal">
        <div class="lt-btns">
          <button class="btn btn-sm" data-lt-nudge="-100" data-idx="${i}" type="button" title="往前 0.1 秒">−0.1s</button>
          <button class="btn btn-sm" data-lt-nudge="100" data-idx="${i}" type="button" title="往後 0.1 秒">+0.1s</button>
          <button class="btn btn-sm btn-primary" data-lt-tap="${i}" type="button" title="用目前播放位置設定這一行">設為目前時間</button>
        </div>
        <div class="lt-text">${escapeHtml(l.text || '（空行）')}</div>
      </div>`).join('');
  }

  function openLyricsTimeline() {
    const tr = state.playlist[state.currentTrackIndex];
    if (!tr) { AppShared.showToast('請先選一首歌'); return; }
    if (!Array.isArray(tr.parsedLyrics) || tr.parsedLyrics.length === 0) {
      dom.ltEmpty.hidden = false;
      dom.ltRows.innerHTML = '';
      dom.ltApply.hidden = true;
    } else {
      dom.ltEmpty.hidden = true;
      dom.ltApply.hidden = false;
      // 深拷貝：取消時不影響目前正在播放的歌詞
      ltWorkingLines = tr.parsedLyrics.map((l) => ({ ...l }));
      renderLyricsTimelineRows();
    }
    dom.ltTrackTitle.textContent = `· ${tr.title}`;
    dom.ltModal.hidden = false;
  }
  function closeLyricsTimeline() { dom.ltModal.hidden = true; ltWorkingLines = null; }

  if (dom.btnLyricsTimeline) dom.btnLyricsTimeline.addEventListener('click', openLyricsTimeline);
  if (dom.ltCancel) dom.ltCancel.addEventListener('click', closeLyricsTimeline);
  if (dom.ltClose) dom.ltClose.addEventListener('click', closeLyricsTimeline);
  if (dom.ltModal) dom.ltModal.addEventListener('click', (e) => { if (e.target === dom.ltModal) closeLyricsTimeline(); });

  if (dom.ltRows) {
    // 事件委派：手動輸入時間、±0.1s 微調、「設為目前時間」（用目前播放位置，扣掉目前 offset 換算回原始時間軸）
    dom.ltRows.addEventListener('change', (e) => {
      const input = e.target.closest('.lt-time');
      if (!input || !ltWorkingLines) return;
      const idx = Number(input.closest('.lt-row').dataset.idx);
      const ms = clockToMs(input.value);
      if (ms == null) { input.value = msToClock(ltWorkingLines[idx].time); AppShared.showToast('時間格式錯誤，請用 分:秒.百分秒（例如 1:23.45）', 'error'); return; }
      ltWorkingLines[idx].time = ms;
    });
    dom.ltRows.addEventListener('click', (e) => {
      if (!ltWorkingLines) return;
      const nudgeBtn = e.target.closest('[data-lt-nudge]');
      if (nudgeBtn) {
        const idx = Number(nudgeBtn.dataset.idx);
        ltWorkingLines[idx].time = Math.max(0, ltWorkingLines[idx].time + Number(nudgeBtn.dataset.ltNudge));
        renderLyricsTimelineRows();
        return;
      }
      const tapBtn = e.target.closest('[data-lt-tap]');
      if (tapBtn) {
        const idx = Number(tapBtn.dataset.ltTap);
        // lastPlayTimeMs 是「播放器目前播放位置」，換算回歌詞原始時間軸要扣掉目前 offset
        // （顯示端判斷式是 adjustedTime = audioTime + offset，此處反推 audioTime + offset = 原始時間）
        ltWorkingLines[idx].time = Math.max(0, Math.round(state.lastPlayTimeMs + state.currentOffsetMs));
        renderLyricsTimelineRows();
      }
    });
  }

  if (dom.ltApply) {
    dom.ltApply.addEventListener('click', () => {
      const tr = state.playlist[state.currentTrackIndex];
      if (!tr || !ltWorkingLines) { closeLyricsTimeline(); return; }
      // 依時間排序：使用者可能把某行調到比前一行晚，顯示端逐行比對「下一句時間」判斷換行，
      // 順序錯亂會导致跳字/卡住，套用前排序保險。
      const sorted = [...ltWorkingLines].sort((a, b) => a.time - b.time);
      if (window.VKState && window.VKState.applyManualLyrics) {
        window.VKState.applyManualLyrics(tr.id, tr.lyrics, tr.lyricsType, sorted);
      }
      AppShared.showToast('已套用逐行時間軸');
      closeLyricsTimeline();
    });
  }

  // ═══════════════════════════════════════════
  // Phase 5: 手動歌詞補救
  // ═══════════════════════════════════════════

  // 歌詞檔案拖曳上傳
  if (dom.lyricsDropZone) {
    dom.lyricsDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dom.lyricsDropZone.classList.add('dragover');
    });

    dom.lyricsDropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dom.lyricsDropZone.classList.remove('dragover');
    });

    dom.lyricsDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dom.lyricsDropZone.classList.remove('dragover');

      const files = Array.from(e.dataTransfer.files).filter((f) =>
        /\.(lrc|srt|txt)$/i.test(f.name)
      );
      if (files.length > 0) {
        uploadLyricsFile(files[0]);
      } else {
        AppShared.showToast('請拖曳 .lrc 或 .srt 檔案', 'error');
      }
    });

    dom.lyricsDropZone.addEventListener('click', () => {
      if (dom.lyricsFileInput) dom.lyricsFileInput.click();
    });
  }

  if (dom.lyricsFileInput) {
    dom.lyricsFileInput.addEventListener('change', () => {
      const file = dom.lyricsFileInput.files[0];
      if (file) uploadLyricsFile(file);
      dom.lyricsFileInput.value = '';
    });
  }

  async function uploadLyricsFile(file) {
    const trackId = state.playlist[state.currentTrackIndex] ? state.playlist[state.currentTrackIndex].id : null;
    if (!trackId) {
      AppShared.showToast('請先選擇一首歌曲', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('lyrics', file);

    try {
      const res = await PinAuth.fetchWithPin('/api/lyrics/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (data.success) {
        applyManualLyrics(trackId, data.lyrics, data.lyricsType, data.parsedLyrics, data.offset);
        AppShared.showToast(`歌詞已載入 (${data.lineCount} 行)`, 'success');
      } else {
        AppShared.showToast(data.error || '歌詞解析失敗', 'error');
      }
    } catch (err) {
      AppShared.showToast('歌詞上傳失敗: ' + err.message, 'error');
    }
  }

  // 貼上歌詞按鈕
  if (dom.btnPasteLyrics) {
    dom.btnPasteLyrics.addEventListener('click', () => {
      const trackId = state.playlist[state.currentTrackIndex] ? state.playlist[state.currentTrackIndex].id : null;
      if (!trackId) {
        AppShared.showToast('請先選擇一首歌曲', 'error');
        return;
      }
      if (dom.lyricsPasteModal) {
        dom.lyricsPasteModal.classList.add('active');
        dom.lyricsPasteTextarea.value = '';
        dom.lyricsPasteTextarea.focus();
      }
    });
  }

  if (dom.lyricsPasteConfirm) {
    dom.lyricsPasteConfirm.addEventListener('click', async () => {
      const content = dom.lyricsPasteTextarea ? dom.lyricsPasteTextarea.value.trim() : '';
      if (!content) {
        AppShared.showToast('請輸入歌詞內容', 'error');
        return;
      }

      const trackId = state.playlist[state.currentTrackIndex] ? state.playlist[state.currentTrackIndex].id : null;
      if (!trackId) return;

      try {
        const res = await PinAuth.fetchWithPin('/api/lyrics/paste', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        const data = await res.json();

        if (data.success) {
          applyManualLyrics(trackId, data.lyrics, data.lyricsType, data.parsedLyrics, data.offset);
          AppShared.showToast(`歌詞已載入 (${data.lineCount} 行)`, 'success');
        } else {
          AppShared.showToast(data.error || '歌詞解析失敗', 'error');
        }
      } catch (err) {
        AppShared.showToast('歌詞解析失敗: ' + err.message, 'error');
      }

      dom.lyricsPasteModal.classList.remove('active');
    });
  }

  if (dom.lyricsPasteCancel) {
    dom.lyricsPasteCancel.addEventListener('click', () => {
      dom.lyricsPasteModal.classList.remove('active');
    });
  }

  function applyManualLyrics(trackId, lyrics, lyricsType, parsedLyrics, lrcOffset) {
    // 更新本地 playlist
    const track = state.playlist.find(t => t.id === trackId);
    if (track) {
      track.lyrics = lyrics;
      track.lyricsType = lyricsType;
      track.parsedLyrics = parsedLyrics;
      track.manualLyrics = true;
      if (lrcOffset) {
        track.lrcOffset = lrcOffset;
        if (state.playlist[state.currentTrackIndex] && state.playlist[state.currentTrackIndex].id === trackId) {
          state.currentOffsetMs = lrcOffset;
          AppShared.updateOffsetDisplay();
        }
      }
    }

    // 如果是當前歌曲，更新歌詞預覽
    if (state.playlist[state.currentTrackIndex] && state.playlist[state.currentTrackIndex].id === trackId) {
      AppShared.renderLyricsPreview(lyrics);
    }

    // 通知後端暫存
    SocketClient.send('lyrics:manual', {
      trackId,
      lyrics,
      lyricsType,
      parsedLyrics,
    });

    AppShared.renderPlaylist();
  }

  // 供 window.VKState.applyManualLyrics（app.js）與這個檔案自己的上傳/貼上流程呼叫
  AppShared.applyManualLyrics = applyManualLyrics;
})();
