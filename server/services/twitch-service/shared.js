'use strict';

/**
 * Twitch Device Code Flow + EventSub WebSocket。
 *
 * 此整合以「本機安裝的聊天工具」為模型：授權的是直播主本人，EventSub 走 WebSocket，
 * 因此不需要公開 HTTPS webhook，也不需要 Client Secret。Twitch 對公開用戶端只允許
 * Device Code Flow；聊天室點歌只接受 YouTube URL，
 * 並轉交控制面板的既有單一下載佇列；面板回報真正成功後才送出 Twitch 成功訊息。
 */
const crypto = require('crypto');
const { parseYouTubeUrl, isSingleVideoInMix } = require('../../utils/youtube-url');
const AudioProcessor = require('../audio-processor');
const fetch = require('node-fetch');
const store = require('../twitch-store');
const requestStore = require('../twitch-request-store');
const requestSessionStore = require('../twitch-session-store');
const requestHistoryStore = require('../twitch-history-store');
const refundDiskStore = require('../twitch-refund-store');
const TwitchReplySettings = require('../../../public/js/twitch-reply-settings');
const TwitchRequestSettings = require('../../../public/js/twitch-request-settings');
const TwitchRewardSettings = require('../../../public/js/twitch-reward-settings');
const { fetchWithTimeout } = require('../../utils/helpers');
const { createLogger } = require('../../utils/logger');
const { reconnectDelay, websocketCtor } = require('../../utils/ws-reconnect');

const log = createLogger('Twitch');
const OAUTH_TOKEN = 'https://id.twitch.tv/oauth2/token';
const OAUTH_DEVICE = 'https://id.twitch.tv/oauth2/device';
const OAUTH_VALIDATE = 'https://id.twitch.tv/oauth2/validate';
const OAUTH_REVOKE = 'https://id.twitch.tv/oauth2/revoke';
const HELIX = 'https://api.twitch.tv/helix';
const EVENTSUB_WS = 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30';
const REQUIRED_SCOPES = Object.freeze(['user:read:chat', 'user:write:chat', 'channel:manage:redemptions']);

async function fetchOAuth(url, options = {}) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Twitch 授權請求逾時，請稍後重試'));
    }, 10000);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, json: async () => body };
    })()]);
  } finally { clearTimeout(timer); }
}

/**
 * 把 channel.chat.notification 轉成觀眾演出看得懂的事件；不是訂閱類的通知回 null。
 * - sub：新訂閱。resub：續訂並分享。
 * - community_sub_gift：一次送出多份（total）。這種每一位收禮者還會各來一則 sub_gift（帶 community_gift_id），
 *   那些要略過，不然送 10 份會演 11 次。
 * - sub_gift 沒有 community_gift_id：指定送給某一個人的單份贈訂。
 * - shared_chat_*：聯合聊天室裡別台的事件，不是這一台的，不演。
 */
function toSupportEvent(event, messageId) {
  if (!event || typeof event !== 'object') return null;
  const eventId = String(messageId || event.message_id || '');
  const anonymous = event.chatter_is_anonymous === true;
  const name = anonymous ? '' : String(event.chatter_user_name || event.chatter_user_login || '');
  switch (event.notice_type) {
    case 'sub': return { eventId, type: 'sub', name, count: 1 };
    case 'resub': return { eventId, type: 'resub', name, count: 1 };
    case 'community_sub_gift': return { eventId, type: 'gift', name, count: Math.max(1, Math.floor(Number(event.community_sub_gift && event.community_sub_gift.total) || 1)) };
    case 'sub_gift':
      if (event.sub_gift && event.sub_gift.community_gift_id) return null;
      return { eventId, type: 'gift', name, count: 1 };
    default: return null;
  }
}
const REDEMPTION_SCOPE = 'channel:manage:redemptions';
const REQUEST_TTL_MS = 30 * 60 * 1000;
// A TCP/WebSocket handshake can stay open forever without the EventSub welcome.
// Bound it so a stalled connection falls back to the existing exponential retry path.
const CONNECT_WATCHDOG_MS = 20000;
const KEEPALIVE_WATCHDOG_GRACE_MS = 5000;
const DEFAULT_EVENTSUB_KEEPALIVE_SECONDS = 30;
const MAX_EVENTSUB_KEEPALIVE_SECONDS = 120;
const ADMIN_ACTION_TIMEOUT_MS = 12000;
const HELIX_TIMEOUT_MS = 15000;
const CHAT_REPLY_USER_COOLDOWN_MS = 5000;
const CHAT_REPLY_GLOBAL_COOLDOWN_MS = 750;
const HISTORY_MAX_ENTRIES = 5000;
const HISTORY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function normalizeShortRequestId(value) {
  return String(value || '').trim().replace(/^#/u, '').toLocaleUpperCase();
}

function safeHistoryText(value, limit = 300) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, limit);
}

function safeHistoryUrl(value) {
  const parsed = parseYouTubeUrl(String(value || ''));
  return parsed?.videoId ? `https://youtu.be/${parsed.videoId}` : '';
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function toTimestamp(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function managedRewardBody(settings, includePaused) {
  const body = {
    title: settings.title,
    prompt: settings.prompt,
    cost: settings.cost,
    is_enabled: settings.enabled,
    is_user_input_required: true,
    is_max_per_stream_enabled: settings.maxPerStream > 0,
    is_max_per_user_per_stream_enabled: settings.maxPerUserPerStream > 0,
    is_global_cooldown_enabled: settings.globalCooldownSeconds > 0,
    should_redemptions_skip_request_queue: false,
  };
  if (settings.maxPerStream > 0) body.max_per_stream = settings.maxPerStream;
  if (settings.maxPerUserPerStream > 0) body.max_per_user_per_stream = settings.maxPerUserPerStream;
  if (settings.globalCooldownSeconds > 0) body.global_cooldown_seconds = settings.globalCooldownSeconds;
  if (includePaused) body.is_paused = settings.paused;
  return body;
}

function requesterKey(event) {
  return String(event?.chatter_user_id || event?.chatter_user_login || event?.chatter_user_name || '').trim().toLocaleLowerCase();
}

function normalizeRequestSessionState(value) {
  const empty = requestSessionStore.emptyState();
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : empty;
  const session = source.session && typeof source.session === 'object' && !Array.isArray(source.session) ? source.session : empty.session;
  const byUser = session.byUser && typeof session.byUser === 'object' && !Array.isArray(session.byUser) ? session.byUser : {};
  return {
    online: !!source.online,
    session: {
      startedAt: Number.isFinite(Number(session.startedAt)) && Number(session.startedAt) > 0 ? Number(session.startedAt) : null,
      acceptedCount: Math.max(0, Number(session.acceptedCount) || 0),
      byUser: Object.fromEntries(Object.entries(byUser).filter(([key, count]) => key && Number.isFinite(Number(count)) && Number(count) >= 0).map(([key, count]) => [key, Number(count)])),
      lastRequesterId: String(session.lastRequesterId || ''),
      lastRequesterName: String(session.lastRequesterName || ''),
    },
    recent: (Array.isArray(source.recent) ? source.recent : []).map((item) => ({
      videoId: String(item?.videoId || ''),
      requesterId: String(item?.requesterId || ''),
      requesterName: String(item?.requesterName || ''),
      acceptedAt: Number(item?.acceptedAt) || 0,
      sessionStartedAt: Number(item?.sessionStartedAt) || null,
    })).filter((item) => item.videoId && item.acceptedAt > 0).slice(-5000),
  };
}


module.exports = {
  crypto,
  parseYouTubeUrl,
  isSingleVideoInMix,
  AudioProcessor,
  fetch,
  store,
  requestStore,
  requestSessionStore,
  requestHistoryStore,
  refundDiskStore,
  TwitchReplySettings,
  TwitchRequestSettings,
  TwitchRewardSettings,
  fetchWithTimeout,
  createLogger,
  reconnectDelay,
  websocketCtor,
  log,
  OAUTH_TOKEN,
  OAUTH_DEVICE,
  OAUTH_VALIDATE,
  OAUTH_REVOKE,
  HELIX,
  EVENTSUB_WS,
  REQUIRED_SCOPES,
  fetchOAuth,
  toSupportEvent,
  REDEMPTION_SCOPE,
  REQUEST_TTL_MS,
  CONNECT_WATCHDOG_MS,
  KEEPALIVE_WATCHDOG_GRACE_MS,
  DEFAULT_EVENTSUB_KEEPALIVE_SECONDS,
  MAX_EVENTSUB_KEEPALIVE_SECONDS,
  ADMIN_ACTION_TIMEOUT_MS,
  HELIX_TIMEOUT_MS,
  CHAT_REPLY_USER_COOLDOWN_MS,
  CHAT_REPLY_GLOBAL_COOLDOWN_MS,
  HISTORY_MAX_ENTRIES,
  HISTORY_MAX_AGE_MS,
  normalizeShortRequestId,
  safeHistoryText,
  safeHistoryUrl,
  wait,
  toTimestamp,
  formatDuration,
  managedRewardBody,
  requesterKey,
  normalizeRequestSessionState
};
