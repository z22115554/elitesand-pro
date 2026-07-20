/**
 * 統一音量 — 既有歌庫的響度回填。
 *
 * 新歌在匯入/上傳時就量好響度；這裡負責「加入功能前就存在」的歌：
 * 啟動延遲一段時間後，逐首量測播放清單中「有音檔但還沒有 loudnessLufs」的歌，
 * 量完直接寫回 playState.playlist（單一事實來源，鐵則 17），同步進媒體庫，
 * 全部完成才廣播一次 state:sync——不在直播中反覆打擾 OBS。
 *
 * 量測一律走 AudioProcessor.measureLoudnessQueued（共用 ffmpeg 佇列，鐵則 12），
 * 任何單首失敗都跳過，絕不讓回填影響主流程。
 */
const { createLogger } = require('../utils/logger');

const DEFAULT_START_DELAY_MS = 10000;

function createLoudnessBackfill({
  playState,
  persistState,
  broadcastState,
  measure,
  audioExists,
  updateLibraryMeta = () => {},
  startDelayMs = DEFAULT_START_DELAY_MS,
  logger = createLogger('Loudness'),
} = {}) {
  if (!playState || typeof measure !== 'function' || typeof audioExists !== 'function') {
    throw new TypeError('createLoudnessBackfill requires playState, measure, and audioExists');
  }

  let running = false;

  function pendingTracks() {
    return (playState.playlist || []).filter((track) => track
      && typeof track.filename === 'string' && track.filename
      && typeof track.loudnessLufs !== 'number'
      && audioExists(track.filename));
  }

  async function runOnce() {
    if (running) return { measured: 0, skipped: 0 };
    running = true;
    let measured = 0;
    let skipped = 0;
    try {
      for (const track of pendingTracks()) {
        let lufs = null;
        try { lufs = await measure(track.filename); } catch (_) { lufs = null; }
        if (typeof lufs !== 'number' || !Number.isFinite(lufs)) { skipped++; continue; }
        track.loudnessLufs = lufs;
        // currentTrack 可能是同 id 的另一份快照（播放時複製），要一起補上
        if (playState.currentTrack && playState.currentTrack.id === track.id) {
          playState.currentTrack.loudnessLufs = lufs;
        }
        updateLibraryMeta(track.id, { loudnessLufs: lufs });
        measured++;
      }
      if (measured > 0) {
        logger.info(`響度回填完成: ${measured} 首（略過 ${skipped} 首）`);
        if (typeof persistState === 'function') persistState();
        if (typeof broadcastState === 'function') broadcastState();
      }
    } catch (err) {
      logger.warn(`響度回填中止（不影響主流程）: ${err.message}`);
    } finally {
      running = false;
    }
    return { measured, skipped };
  }

  function start() {
    const timer = setTimeout(() => { runOnce(); }, startDelayMs);
    timer.unref?.();
    return timer;
  }

  return { start, runOnce, pendingTracks };
}

module.exports = { createLoudnessBackfill, DEFAULT_START_DELAY_MS };
