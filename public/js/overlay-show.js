/**
 * OBS 互動演出（/display 疊加）：點歌明信片、Twitch 揪團感謝。
 *
 * - 只動自己的元素（#overlay-show-root），不碰歌詞與 OBS 透明底色（鐵則 11）。
 * - 文字一律 textContent，伺服器已清洗；這裡再不吃任何 HTML。
 * - 純轉播：overlay-show:play 開演、overlay-show:clear 收場；來源重載後不會殘留。
 */
(function () {
  'use strict';

  if (typeof document === 'undefined' || typeof SocketClient === 'undefined') return;

  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  const EXIT_MS = 520;

  let root = null;
  let current = null; // { id, el, exitTimer, killTimer }

  function ensureRoot() {
    if (root && root.isConnected) return root;
    root = document.createElement('div');
    root.id = 'overlay-show-root';
    root.setAttribute('aria-live', 'off');
    document.body.appendChild(root);
    return root;
  }

  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function buildPostcard(payload) {
    const card = node('div', 'os-card os-postcard');
    card.appendChild(node('div', 'os-pc-stamp', 'POST'));
    const song = node('div', 'os-pc-song');
    song.appendChild(node('div', 'os-pc-title', payload.title || ''));
    if (payload.artist) song.appendChild(node('div', 'os-pc-artist', payload.artist));
    card.appendChild(song);
    card.appendChild(node('p', 'os-pc-message', payload.message || ''));
    const from = payload.name
      ? t('overlayShow.postcardFrom', { name: payload.name })
      : t('overlayShow.postcardAnonymous');
    card.appendChild(node('div', 'os-pc-from', from));
    return card;
  }

  function buildRaid(payload) {
    const card = node('div', 'os-card os-raid');
    card.appendChild(node('div', 'os-raid-kicker', 'RAID'));
    card.appendChild(node('div', 'os-raid-title', t('overlayShow.raidThanks', { name: payload.name || '' })));
    card.appendChild(node('div', 'os-raid-count', t('overlayShow.raidViewers', { count: payload.viewers || 0 })));
    return card;
  }

  function remove(entry) {
    if (!entry) return;
    clearTimeout(entry.exitTimer);
    clearTimeout(entry.killTimer);
    if (entry.el && entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
    if (current === entry) current = null;
  }

  function leave(entry) {
    if (!entry || entry.leaving) return;
    entry.leaving = true;
    clearTimeout(entry.exitTimer);
    entry.el.classList.remove('is-in');
    entry.el.classList.add('is-out');
    entry.killTimer = setTimeout(() => remove(entry), EXIT_MS);
  }

  function play(message) {
    if (!message || typeof message !== 'object') return;
    const kind = message.kind;
    const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
    if (kind !== 'postcard' && kind !== 'raid') return;
    // 伺服器保證一次一個；萬一舊的沒收到 clear（斷線重連），先立即收掉，不疊兩張。
    if (current) remove(current);
    const host = ensureRoot();
    host.dataset.anchor = ANCHORS.includes(message.anchor) ? message.anchor : 'top-right';
    const el = kind === 'postcard' ? buildPostcard(payload) : buildRaid(payload);
    host.appendChild(el);
    const entry = { id: String(message.id || ''), el, exitTimer: null, killTimer: null, leaving: false };
    current = entry;
    // 強制 reflow 後再加 is-in，入場動畫才會跑。
    void el.offsetWidth;
    el.classList.add('is-in');
    const duration = Math.max(1500, Number(message.durationMs) || 8000);
    entry.exitTimer = setTimeout(() => leave(entry), duration);
    // 保底：任何原因沒收到 clear，也一定會自己收掉。
    entry.killTimer = setTimeout(() => remove(entry), duration + 2500);
  }

  function clear(message) {
    if (!current) return;
    if (message && message.id && String(message.id) !== current.id) return;
    leave(current);
  }

  SocketClient.on('overlay-show:play', play);
  SocketClient.on('overlay-show:clear', clear);
  // 換歌、停止時伺服器會送 clear；斷線時直接收掉，避免畫面卡一張卡。
  SocketClient.on('connection-change', (connected) => { if (!connected && current) remove(current); });
})();
