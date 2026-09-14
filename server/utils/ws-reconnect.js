'use strict';

/**
 * 共用的「對外 WebSocket 客戶端」退避重連公式與建構子退路。
 *
 * code review 2026-09-15：twitch-service.js 跟 song-request-relay-service.js
 * 各自維護一份完全相同的 reconnectDelay()／websocketCtor()（連註解都寫著
 * 「跟另一份同一套」），代表寫的人自己也知道這是重複——之後調退避曲線或
 * Node 版本相容性只會改到其中一份，另一份悄悄跟著漂掉。兩邊都是本機主動發起、
 * 對外連線的客戶端角色（Twitch EventSub、公開點歌頁中繼），語意完全一致，
 * 抽成一份共用。
 */
const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 60000;

function reconnectDelay(attempt, random = Math.random) {
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * (2 ** Math.max(0, attempt - 1)));
  return Math.round(base * (0.8 + random() * 0.4));
}

function websocketCtor() {
  // Node 22+ 原生支援 WebSocket；較舊版本用 Socket.io 已安裝的 ws 相依套件退路。
  // 不對外開放，也不會把 ws 暴露給瀏覽器。
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  // eslint-disable-next-line global-require
  return require('ws');
}

module.exports = { RECONNECT_BASE_MS, RECONNECT_MAX_MS, reconnectDelay, websocketCtor };
