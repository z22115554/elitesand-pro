/**
 * OBS 互動演出（/display 疊加）：點歌明信片、Twitch 揪團感謝，以及訂閱／贈訂／揪團的全畫面演出。
 *
 * - 只動自己的元素（#overlay-show-root），不碰歌詞與 OBS 透明底色（鐵則 11）。
 * - 文字一律 textContent，伺服器已清洗；這裡再不吃任何 HTML。
 * - 純轉播：overlay-show:play 開演、overlay-show:clear 收場；來源重載後不會殘留。
 * - 全畫面演出（kind: alert）畫在內嵌的 /alert-show/stage.html（透明、不吃滑鼠事件）：
 *   引擎有四百多 KB、一堆全域函式，放在 iframe 裡才不會跟歌詞頁的程式互相影響，
 *   也只有真的開了演出的人才會載入它。
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

  const POSTCARD_STYLES = ['paper', 'gold', 'polaroid', 'neon', 'sakura'];
  const POSTCARD_KICKER = { paper: 'POST', gold: 'REQUEST', neon: 'REQUEST', sakura: 'FOR YOU' };

  function buildPostcard(payload, durationMs) {
    const style = POSTCARD_STYLES.includes(payload.style) ? payload.style : 'paper';
    const card = node('div', 'os-card os-postcard os-pc-' + style);
    card.style.setProperty('--os-dur', Math.max(1000, durationMs) + 'ms');
    if (style === 'gold' || style === 'neon') {
      SPARKS.forEach(([left, top, scale], index) => {
        const spark = node('span', 'os-pc-deco-spark');
        spark.style.left = left + '%';
        spark.style.top = top + '%';
        spark.style.setProperty('--os-spark-scale', String(scale));
        spark.style.animationDelay = (index * 0.35) + 's';
        card.appendChild(spark);
      });
    } else if (style === 'sakura') {
      PETALS.forEach(([left, delay]) => {
        const petal = node('span', 'os-pc-deco-petal');
        petal.style.left = left + '%';
        petal.style.animationDelay = delay + 's';
        card.appendChild(petal);
      });
    } else if (style === 'polaroid') {
      card.appendChild(node('div', 'os-pc-tape'));
    }
    if (POSTCARD_KICKER[style]) card.appendChild(node('div', 'os-pc-stamp', POSTCARD_KICKER[style]));
    const song = node('div', 'os-pc-song');
    song.appendChild(node('div', 'os-pc-title', payload.title || ''));
    if (payload.artist) song.appendChild(node('div', 'os-pc-artist', payload.artist));
    card.appendChild(song);
    card.appendChild(node('p', 'os-pc-message', payload.message || ''));
    const from = payload.name
      ? t('overlayShow.postcardFrom', { name: payload.name })
      : t('overlayShow.postcardAnonymous');
    card.appendChild(node('div', 'os-pc-from', from));
    card.appendChild(node('div', 'os-pc-progress'));
    return card;
  }

  const RAID_STYLES = ['gold', 'neon', 'sakura', 'stage', 'classic'];
  const RAID_KICKER = { gold: 'SPECIAL THANKS', neon: 'RAID INCOMING', sakura: 'THANK YOU', stage: 'THANKS FOR THE RAID', classic: 'RAID' };
  // 裝飾粒子的數量與位置寫死（不用亂數），每次演出長一樣、截圖才好驗證。
  const SPARKS = [[88, 22, 1], [94, 52, 1.5], [82, 74, 0.8], [6, 18, 0.7]];
  const PETALS = [[8, 0, 1], [24, 1.4, 0.8], [42, 0.6, 1.1], [60, 2.1, 0.9], [78, 0.9, 1], [92, 1.8, 0.8]];
  const CONFETTI = [[6, 0], [16, 0.7], [27, 0.2], [38, 1.1], [49, 0.4], [60, 1.3], [71, 0.1], [82, 0.9], [92, 0.5]];

  function formatClock(totalSeconds) {
    const s = Math.max(0, Math.ceil(totalSeconds));
    return '00:' + String(s).padStart(2, '0');
  }

  function buildRaid(payload, durationMs) {
    const style = RAID_STYLES.includes(payload.style) ? payload.style : 'gold';
    const card = node('div', 'os-card os-raid os-rs-' + style);
    card.style.setProperty('--os-dur', Math.max(1000, durationMs) + 'ms');

    if (style === 'stage') {
      card.appendChild(node('div', 'os-rs-beam os-rs-beam-a'));
      card.appendChild(node('div', 'os-rs-beam os-rs-beam-b'));
      CONFETTI.forEach(([left, delay], index) => {
        const piece = node('span', 'os-rs-confetti os-rs-confetti-' + (index % 3));
        piece.style.left = left + '%';
        piece.style.animationDelay = delay + 's';
        card.appendChild(piece);
      });
    } else if (style === 'sakura') {
      PETALS.forEach(([left, delay, scale]) => {
        const petal = node('span', 'os-rs-petal');
        petal.style.left = left + '%';
        petal.style.animationDelay = delay + 's';
        petal.style.setProperty('--os-petal-scale', String(scale));
        card.appendChild(petal);
      });
    } else {
      SPARKS.forEach(([left, top, scale], index) => {
        const spark = node('span', 'os-rs-spark');
        spark.style.left = left + '%';
        spark.style.top = top + '%';
        spark.style.setProperty('--os-spark-scale', String(scale));
        spark.style.animationDelay = (index * 0.35) + 's';
        card.appendChild(spark);
      });
    }

    const top = node('div', 'os-raid-top');
    top.appendChild(node('span', 'os-raid-kicker', RAID_KICKER[style]));
    const timer = node('span', 'os-raid-timer', formatClock(durationMs / 1000));
    top.appendChild(timer);
    card.appendChild(top);

    const body = node('div', 'os-raid-body');
    const meter = node('div', 'os-raid-meter');
    for (let i = 0; i < 8; i += 1) {
      const bar = node('span', 'os-raid-meter-bar');
      bar.style.animationDelay = (i * 0.12) + 's';
      meter.appendChild(bar);
    }
    body.appendChild(meter);
    const text = node('div', 'os-raid-text');
    text.appendChild(node('div', 'os-raid-title', t('overlayShow.raidThanks', { name: payload.name || '' })));
    text.appendChild(node('div', 'os-raid-count', t('overlayShow.raidViewers', { count: payload.viewers || 0 })));
    body.appendChild(text);
    card.appendChild(body);
    card.appendChild(node('div', 'os-raid-progress'));
    card._timer = timer;
    return card;
  }

  function remove(entry) {
    if (!entry) return;
    clearTimeout(entry.exitTimer);
    clearTimeout(entry.killTimer);
    clearInterval(entry.tick);
    if (entry.el && entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
    if (current === entry) current = null;
  }

  function leave(entry) {
    if (!entry || entry.leaving) return;
    entry.leaving = true;
    clearTimeout(entry.exitTimer);
    clearInterval(entry.tick);
    entry.el.classList.remove('is-in');
    entry.el.classList.add('is-out');
    entry.killTimer = setTimeout(() => remove(entry), EXIT_MS);
  }

  // ─── 全畫面演出的舞台（iframe）───
  const STAGE_URL = '/alert-show/stage.html';
  const params = (() => { try { return new URL(window.location.href).searchParams; } catch (_) { return new URLSearchParams(); } })();
  // 面板裡的預覽框和 Spout 輸出不出聲：聲音只從 OBS 的瀏覽器來源出一份。
  const stageMuted = params.get('preview') === '1' || params.get('spout') === '1' || params.get('output') === 'spout';
  let stage = null;        // { frame, ready, pending }
  let stageShowId = '';

  function ensureStage() {
    if (stage && stage.frame.isConnected) return stage;
    const frame = document.createElement('iframe');
    frame.id = 'overlay-show-stage';
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    frame.setAttribute('allow', 'autoplay');
    frame.src = STAGE_URL;
    ensureRoot().appendChild(frame);
    stage = { frame, ready: false, pending: null };
    return stage;
  }

  function postToStage(message) {
    if (!stage || !stage.frame.contentWindow) return;
    stage.frame.contentWindow.postMessage({ target: 'alert-show-stage', ...message }, window.location.origin);
  }

  window.addEventListener('message', (event) => {
    if (!stage || event.origin !== window.location.origin || event.source !== stage.frame.contentWindow) return;
    const data = event.data;
    if (!data || data.source !== 'alert-show-stage') return;
    if (data.type === 'ready') {
      stage.ready = true;
      if (stage.pending) { postToStage(stage.pending); stage.pending = null; }
    } else if (data.type === 'ended' || data.type === 'error') {
      if (!data.id || data.id === stageShowId) stageShowId = '';
    }
  });

  function playAlert(message, payload) {
    if (current) remove(current); // 卡片跟全畫面演出不同時出現
    const host = ensureStage();
    stageShowId = String(message.id || '');
    const command = {
      type: 'play',
      id: stageShowId,
      tier: String(payload.tier || ''),
      variant: Number(payload.variant) || 0,
      n: Number(payload.n) || 0,
      name: String(payload.name || ''),
      lang: window.I18n && typeof window.I18n.current === 'function' ? window.I18n.current() : 'zh-TW',
      volume: Math.max(0, Math.min(100, Number(payload.volume))) / 100,
      muted: stageMuted,
    };
    if (host.ready) postToStage(command); else host.pending = command; // 還在載入：載好馬上演
  }

  function stopAlert(id) {
    if (!stage) return;
    if (id && stageShowId && id !== stageShowId) return;
    stage.pending = null;
    stageShowId = '';
    postToStage({ type: 'stop' });
  }

  /** 設定裡有開全畫面演出就先把舞台載好（字型、道具圖），第一次演出才不會慢半拍。 */
  function prepareStage(settings) {
    if (!settings || typeof settings !== 'object') return;
    const alerts = settings.alerts || {};
    const raid = settings.raid || {};
    if (alerts.subEnabled || alerts.giftEnabled || (raid.enabled && raid.mode === 'show')) ensureStage();
  }

  function play(message) {
    if (!message || typeof message !== 'object') return;
    const kind = message.kind;
    const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
    if (kind === 'alert') { playAlert(message, payload); return; }
    if (kind !== 'postcard' && kind !== 'raid') return;
    stopAlert('');
    // 伺服器保證一次一個；萬一舊的沒收到 clear（斷線重連），先立即收掉，不疊兩張。
    if (current) remove(current);
    const host = ensureRoot();
    host.dataset.anchor = ANCHORS.includes(message.anchor) ? message.anchor : 'top-right';
    const durationMs = Math.max(1500, Number(message.durationMs) || 8000);
    const el = kind === 'postcard' ? buildPostcard(payload, durationMs) : buildRaid(payload, durationMs);
    host.appendChild(el);
    const entry = { id: String(message.id || ''), el, exitTimer: null, killTimer: null, tick: null, leaving: false };
    current = entry;
    // 強制 reflow 後再加 is-in，入場動畫才會跑。
    void el.offsetWidth;
    el.classList.add('is-in');
    const duration = durationMs;
    if (el._timer) {
      const startedAt = Date.now();
      entry.tick = setInterval(() => {
        el._timer.textContent = formatClock((duration - (Date.now() - startedAt)) / 1000);
      }, 250);
    }
    entry.exitTimer = setTimeout(() => leave(entry), duration);
    // 保底：任何原因沒收到 clear，也一定會自己收掉。
    entry.killTimer = setTimeout(() => remove(entry), duration + 2500);
  }

  function clear(message) {
    if (message && message.kind === 'alert') { stopAlert(String(message.id || '')); return; }
    if (!current) return;
    if (message && message.id && String(message.id) !== current.id) return;
    leave(current);
  }

  SocketClient.on('overlay-show:play', play);
  SocketClient.on('overlay-show:clear', clear);
  // 換歌、停止時伺服器會送 clear；斷線時直接收掉，避免畫面卡一張卡。
  SocketClient.on('overlay-show:settings', prepareStage);
  SocketClient.on('connection-change', (connected) => { if (!connected) { if (current) remove(current); stopAlert(''); } });
})();
