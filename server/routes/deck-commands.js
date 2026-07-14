/**
 * Stream Deck / 全域快捷鍵 HTTP 指令介面
 *
 * 由 server/index.js 掛載為 /api/deck/:action。
 * 與 socket 事件 handler 共用同一份 app-state ctx，狀態完全一致。
 */

const { createLogger } = require('../utils/logger');

const log = createLogger('Deck');

/**
 * 建立外部控制指令執行器（Stream Deck、快捷鍵軟體、自動化腳本）
 * @param {import('socket.io').Server} io
 * @param {ReturnType<import('../state/app-state').createAppState>} ctx
 * @returns {(action: string, params?: object) => {ok: boolean, message: string, state?: object}}
 */
function createDeckCommands(io, ctx) {
  const { playState, trackOffsets, persistState, broadcastState, getPublicState } = ctx;

  return function executeCommand(action, params = {}) {
    switch (action) {
      case 'play-toggle': {
        playState.isPlaying = !playState.isPlaying;
        playState.lastStateUpdateTimestamp = Date.now();
        io.emit('play:toggle', playState.isPlaying);
        broadcastState();
        log.info(`播放切換: ${playState.isPlaying ? '播放' : '暫停'}`);
        return { ok: true, message: playState.isPlaying ? 'playing' : 'paused' };
      }

      case 'next': {
        io.emit('play:next');
        log.info('下一首');
        return { ok: true, message: 'next' };
      }

      case 'prev': {
        io.emit('play:prev');
        log.info('上一首');
        return { ok: true, message: 'prev' };
      }

      case 'hide':
      case 'show':
      case 'hide-toggle': {
        if (action === 'hide-toggle') {
          playState.emergencyHide = !playState.emergencyHide;
        } else {
          playState.emergencyHide = (action === 'hide');
        }
        io.emit(playState.emergencyHide ? 'emergency:hide' : 'emergency:show');
        broadcastState();
        log.info(`緊急隱藏: ${playState.emergencyHide ? '隱藏' : '顯示'}`);
        return { ok: true, message: playState.emergencyHide ? 'hidden' : 'visible' };
      }

      case 'offset-plus':
      case 'offset-minus': {
        if (!playState.currentTrack) {
          return { ok: false, message: 'no track playing' };
        }
        const trackId = playState.currentTrack.id;
        let delta = Number(params.ms);
        if (!isFinite(delta) || delta <= 0) delta = 100;
        delta = Math.min(10000, delta);
        if (action === 'offset-minus') delta = -delta;

        const currentOffset = trackOffsets.get(trackId) || 0;
        const newOffset = Math.max(-10000, Math.min(10000, currentOffset + delta));
        trackOffsets.set(trackId, newOffset);
        playState.currentOffset = newOffset;
        io.emit('offset:update', { trackId, offset: newOffset });
        broadcastState();
        persistState();
        log.info(`Offset: ${currentOffset}ms → ${newOffset}ms`);
        return { ok: true, message: `offset=${newOffset}ms` };
      }

      case 'offset-reset': {
        if (!playState.currentTrack) {
          return { ok: false, message: 'no track playing' };
        }
        const trackId = playState.currentTrack.id;
        trackOffsets.delete(trackId);
        playState.currentOffset = 0;
        io.emit('offset:update', { trackId, offset: 0 });
        broadcastState();
        persistState();
        log.info('Offset 重置');
        return { ok: true, message: 'offset=0ms' };
      }

      case 'metronome-toggle': {
        playState.metronomeEnabled = !playState.metronomeEnabled;
        io.emit('metronome:update', playState.metronomeEnabled);
        broadcastState();
        persistState();
        log.info(`前奏倒數: ${playState.metronomeEnabled ? '啟用' : '停用'}`);
        return { ok: true, message: playState.metronomeEnabled ? 'metronome on' : 'metronome off' };
      }

      case 'style': {
        const style = typeof params.name === 'string' ? params.name.slice(0, 50) : '';
        if (!style) return { ok: false, message: 'missing style name' };
        playState.style = style;
        io.emit('style:change', style);
        broadcastState();
        persistState();
        log.info(`切換風格: ${style}`);
        return { ok: true, message: `style=${style}` };
      }

      case 'state': {
        return { ok: true, message: 'state', state: getPublicState() };
      }

      default:
        return { ok: false, message: `unknown action: ${action}` };
    }
  };
}

module.exports = { createDeckCommands };
