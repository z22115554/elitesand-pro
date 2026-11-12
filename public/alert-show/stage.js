/**
 * 演出舞台的播放控制（訂閱／贈訂／揪團的全畫面與小卡演出）。
 *
 * 這一頁只負責「收到指令就演一次」：
 * - 外層頁面（OBS 的 /display 或面板的預覽框）用 postMessage 送 play／stop，只收同源、且只收直接外層。
 * - 演出本身是 engine.js 的 draw(t)；這裡管時間、音效、結束後清空畫布。
 * - 整頁透明，演完一定清空，不會在直播畫面上留下殘影（鐵則 11）。
 */
(function () {
  'use strict';

  var canvas = document.getElementById('c');
  var LANGS = ['zh-TW', 'en', 'ja', 'ko', 'zh-CN'];
  var raf = 0;
  var audio = null;
  var current = null; // { id, token }
  var token = 0;

  function post(type, extra) {
    if (window.parent === window) return;
    var message = { source: 'alert-show-stage', type: type };
    if (extra) Object.keys(extra).forEach(function (key) { message[key] = extra[key]; });
    try { window.parent.postMessage(message, location.origin); } catch (_) { /* 外層不見了就算了 */ }
  }

  function clearCanvas() {
    var ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function stop(reason) {
    token += 1;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (audio) { try { audio.pause(); } catch (_) { /* 已經停了 */ } audio = null; }
    clearCanvas();
    if (current) { post('ended', { id: current.id, reason: reason || 'stopped' }); current = null; }
  }

  function clampInt(value, min, max, fallback) {
    var n = Math.round(Number(value));
    if (!isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function waitFonts(name) {
    // 名字可能是任何語言：給字型分片一點時間，但不讓演出卡住。
    var jobs = [];
    try {
      jobs.push(document.fonts.load("900 46px 'Noto Sans TC'", name));
      jobs.push(document.fonts.load("900 46px 'Noto Sans JP'", name));
      jobs.push(document.fonts.load("900 46px 'Noto Sans KR'", name));
      jobs.push(document.fonts.load("900 46px 'Noto Sans SC'", name));
    } catch (_) { /* 沒有 Font Loading API 就直接演 */ }
    var all = Promise.all(jobs).catch(function () {});
    var timeout = new Promise(function (resolve) { setTimeout(resolve, 450); });
    return Promise.race([all, timeout]);
  }

  function play(message) {
    var tier = String(message.tier || '');
    var list = window.VARS && window.VARS[tier];
    if (!Array.isArray(list) || !list.length) { post('error', { id: message.id, error: 'unknown-tier' }); return; }
    var variant = clampInt(message.variant, 0, list.length - 1, 0);
    if (!list[variant]) variant = 0;
    var count = tier === 'sub' ? 0 : clampInt(message.n, 1, 9999999, 1);
    var lang = LANGS.indexOf(message.lang) >= 0 ? message.lang : 'zh-TW';
    var name = String(message.name == null ? '' : message.name).slice(0, 60);
    var volume = Math.max(0, Math.min(1, Number(message.volume)));
    if (!isFinite(volume)) volume = 0.7;

    stop('replaced');
    var mine = ++token;
    current = { id: String(message.id || '') };

    window.ready.then(function () { return waitFonts(name); }).then(function () {
      if (mine !== token) return;
      P.n = count;
      P.bg = "0";
      window.setTier(tier, variant);
      window.setLang(lang);
      window.setName(name);
      var duration = Number(window.DUR) || 4;

      if (volume > 0 && !message.muted) {
        audio = new Audio('sfx/' + tier + '_' + variant + '.ogg');
        audio.volume = volume;
        var started = audio.play();
        if (started && typeof started.catch === 'function') started.catch(function () { /* 瀏覽器擋自動播放時只少了聲音 */ });
      }

      var t0 = performance.now();
      var frames = 0;
      var slow = 0;
      var worst = 0;
      var lastNow = t0;
      post('started', { id: current.id, tier: tier, variant: variant, duration: duration });
      var loop = function (now) {
        if (mine !== token) return;
        var t = (now - t0) / 1000;
        var gap = now - lastNow;
        lastNow = now;
        if (frames > 0) { if (gap > 34) slow += 1; if (gap > worst) worst = gap; }
        frames += 1;
        if (t >= duration) {
          raf = 0;
          clearCanvas();
          var done = current;
          current = null;
          audio = null;
          window.__alertStagePerf = { tier: tier, variant: variant, frames: frames, slowFrames: slow, worstGapMs: Math.round(worst), fps: Math.round(frames / duration) };
          post('ended', { id: done ? done.id : '', reason: 'finished', perf: window.__alertStagePerf });
          return;
        }
        window.draw(t);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }).catch(function (err) {
      if (mine !== token) return;
      clearCanvas();
      post('error', { id: current ? current.id : '', error: String((err && err.message) || err) });
      current = null;
    });
  }

  function applyFace(face) {
    if (!face || typeof face !== 'object' || !window.FACE) return;
    var x = Number(face.x), y = Number(face.y), s = Number(face.s);
    if (isFinite(x)) window.FACE.x = Math.max(0, Math.min(1, x));
    if (isFinite(y)) window.FACE.y = Math.max(0, Math.min(1, y));
    if (isFinite(s)) window.FACE.s = Math.max(0.05, Math.min(0.35, s));
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    var message = event.data;
    if (!message || typeof message !== 'object' || message.target !== 'alert-show-stage') return;
    if (message.type === 'play') { applyFace(message.face); play(message); }
    else if (message.type === 'stop') stop('stopped');
    else if (message.type === 'face') applyFace(message.face);
  });

  // 給效能量測與自動化測試用（同源頁面才碰得到）。
  window.__alertStage = { play: play, stop: stop };

  // 引擎自己把畫面畫成「背景透明」之前，先確保畫布是空的。
  P.bg = "0";
  window.ready.then(function () {
    clearCanvas();
    post('ready', {});
    // 開發用：stage.html?autoplay=g50:1&n=50&name=xxx 直接演一次（沒有外層頁面時）。
    var query = new URLSearchParams(location.search);
    var auto = query.get('autoplay');
    if (auto && window.parent === window) {
      var parts = auto.split(':');
      play({ id: 'autoplay', tier: parts[0], variant: Number(parts[1]) || 0, n: Number(query.get('n')) || 1, name: query.get('name') || '', lang: query.get('lang') || 'zh-TW', muted: query.get('mute') === '1', volume: 0.7 });
    }
  }).catch(function (err) { post('error', { error: String((err && err.message) || err) }); });
})();
