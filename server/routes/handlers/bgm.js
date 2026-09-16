/**
 * BGM 待機音樂 socket 事件：仿「歌回救星」雙軌切換——啟用後，面板唱歌時自動暫停 BGM，
 * 暫停/唱完自動恢復。實際播放邏輯完全在面板瀏覽器端（public/js/app-bgm.js），這裡只管
 * 清單持久化與跨端狀態同步。
 *
 * 開關（enable/disable）刻意不限 clientType：跟 play:toggle 這類一般播放控制同一個
 * 待遇，桌面面板與手機遙控器都能操作（使用者明確要求）。清單管理（新增/刪除/排序）
 * 與音量/兩個恢復延遲調整（bgm:settings:set）才限桌面 controller——跟收藏歌單、
 * Twitch、公開點歌頁的既有慣例一致，實際播放引擎只在桌面瀏覽器，手機沒有這些 UI。
 */
const bgmPlaylist = require('../../services/bgm-playlist');
const bgmSettingsSchema = require('../../services/bgm-settings');
const libraryStore = require('../../services/library-store');
const { buildTrackFromEntry } = require('./library');
const { sanitizePlaylist } = require('../../utils/track-schema');

function buildPlayableList() {
  const exists = libraryStore.getAudioExistsLookup();
  const ready = [];
  const needsDownload = [];
  let missing = 0;
  for (const trackId of bgmPlaylist.list()) {
    const entry = libraryStore.getEntry(trackId);
    if (!entry) { missing++; continue; }
    if (entry.filename && exists(entry.filename)) ready.push(buildTrackFromEntry(entry));
    else if (entry.url) needsDownload.push({ id: entry.id, title: entry.title || '', url: entry.url });
    else missing++;
  }
  // trackIds 是完整原始清單（含音檔暫時不在的），給媒體庫頁「加入 BGM」勾選框判斷目前
  // 是否已在清單裡用——tracks/needsDownload 只是依「音檔在不在」分流過的子集，不能拿來
  // 判斷歸屬。
  return { ok: true, tracks: sanitizePlaylist(ready) || [], needsDownload, missing, trackIds: bgmPlaylist.list() };
}

function registerBgmHandlers(io, socket, ctx) {
  const { playState, persistState } = ctx;

  function broadcastSettings() {
    io.emit('bgm:settings:update', { ...playState.bgmSettings });
  }

  socket.on('bgm:enable', (_data, ack) => {
    if (!playState.bgmSettings.enabled) {
      playState.bgmSettings.enabled = true;
      broadcastSettings();
      persistState();
    }
    if (typeof ack === 'function') ack({ ok: true, settings: { ...playState.bgmSettings } });
  });

  socket.on('bgm:disable', (_data, ack) => {
    if (playState.bgmSettings.enabled) {
      playState.bgmSettings.enabled = false;
      playState.bgmSettings.playing = false;
      broadcastSettings();
      persistState();
    }
    if (typeof ack === 'function') ack({ ok: true, settings: { ...playState.bgmSettings } });
  });

  // 只有面板自己知道 BGM 實際有沒有在播（暫停/唱歌自動切換都在瀏覽器端發生）；
  // 這裡純粹轉播給其他端顯示，不驅動任何邏輯，也不因此觸發 persistState（高頻事件，
  // 且「正在播放」本來就不該持久化，見 app-state.js 的 restore 註解）。
  socket.on('bgm:status', (data) => {
    const playing = data?.playing === true;
    if (playState.bgmSettings.playing === playing) return;
    playState.bgmSettings.playing = playing;
    io.emit('bgm:settings:update', { ...playState.bgmSettings });
  });

  socket.on('bgm:list', (_data, ack) => {
    const reply = buildPlayableList();
    if (typeof ack === 'function') ack(reply); else socket.emit('bgm:playlist', reply);
  });

  // 清單管理（新增/刪除/排序）與音量/延遲調整都限桌面 controller：實際播放引擎只在
  // 桌面瀏覽器，手機遙控器不需要、也沒有這些滑桿與匯入 UI。
  if (socket.clientType !== 'controller') return;

  function broadcastPlaylist() {
    io.emit('bgm:playlist', buildPlayableList());
  }

  socket.on('bgm:settings:set', (data, ack) => {
    const clamped = bgmSettingsSchema.clampSettings(data, playState.bgmSettings);
    Object.assign(playState.bgmSettings, clamped);
    broadcastSettings();
    persistState();
    if (typeof ack === 'function') ack({ ok: true, settings: { ...playState.bgmSettings } });
  });

  socket.on('bgm:addTracks', (data, ack) => {
    // 只收媒體庫裡真的存在的 id，避免面板送來過期快取的 id 變成永遠載不出來的幽靈項目
    const trackIds = (Array.isArray(data?.trackIds) ? data.trackIds : [])
      .filter((id) => libraryStore.getEntry(id));
    const result = bgmPlaylist.addTracks(trackIds);
    if (result.added) broadcastPlaylist();
    if (typeof ack === 'function') ack(result);
  });

  socket.on('bgm:removeTracks', (data, ack) => {
    const result = bgmPlaylist.removeTracks(data?.trackIds);
    if (result.removed) broadcastPlaylist();
    if (typeof ack === 'function') ack(result);
  });

  socket.on('bgm:setOrder', (data, ack) => {
    const result = bgmPlaylist.setOrder(data?.trackIds);
    if (result.changed) broadcastPlaylist();
    if (typeof ack === 'function') ack(result);
  });
}

module.exports = registerBgmHandlers;
