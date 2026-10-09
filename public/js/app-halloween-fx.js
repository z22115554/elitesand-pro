/**
 * 萬聖節觀眾互動面板：聊天指令與搗蛋獎勵設定、糖果排行、抽獎、活動回顧卡。
 * 真實資料在 server 端（server/services/halloween-interactions.js），這裡只顯示 halloween:fx:update 的結果。
 * 回顧卡在面板本機用 canvas 畫成 1920×1080 PNG，不經過任何外部服務。
 */
(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  const locale = () => (window.I18n ? window.I18n.current() : 'zh-TW');
  const nf = { format: (n) => new Intl.NumberFormat(locale()).format(n) };
  const toast = (message, type) => window.AppShared?.showToast?.(message, type);
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  let state = null;
  let formDirty = false;

  function renderForm() {
    if (formDirty || !state) return;
    const s = state.settings;
    el('halloween-fx-chat-enabled').checked = !!s.chatEnabled;
    el('halloween-fx-treat-command').value = s.treatCommand;
    el('halloween-fx-trick-command').value = s.trickCommand;
    el('halloween-fx-cooldown').value = s.userCooldownSeconds;
    el('halloween-fx-prank-enabled').checked = !!s.prank.enabled;
    el('halloween-fx-prank-title').value = s.prank.title;
    el('halloween-fx-prank-cost').value = s.prank.cost;
    el('halloween-fx-prank-cooldown').value = s.prank.cooldownSeconds;
    el('halloween-fx-prank-status').textContent = s.prank.rewardId
      ? t(s.prank.enabled ? 'halloween.fx.prankLive' : 'halloween.fx.prankPaused')
      : t('halloween.fx.prankHint');
  }

  function renderBoard(board) {
    if (!board) return;
    el('halloween-fx-stats').textContent = t('halloween.board.stats', {
      participants: nf.format(board.participants), treats: nf.format(board.totalTreats),
      tricks: nf.format(board.totalTricks), pranks: nf.format(board.totalPranks),
    });
    const list = el('halloween-fx-board');
    if (!board.top.length) {
      const empty = document.createElement('li');
      empty.className = 'seasonal-board-empty';
      empty.textContent = t('halloween.board.empty');
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...board.top.map((v) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'seasonal-board-name';
      name.textContent = v.name;
      const count = document.createElement('span');
      count.className = 'val';
      count.textContent = t('halloween.board.count', { treats: nf.format(v.treats), tricks: nf.format(v.tricks) });
      li.append(name, count);
      return li;
    }));
  }

  function renderWinners() {
    const list = el('halloween-raffle-winners');
    if (!state.winners.length) { list.replaceChildren(); return; }
    list.replaceChildren(...state.winners.map((w) => {
      const li = document.createElement('li');
      li.className = 'bgm-track-item';
      const name = document.createElement('span');
      name.className = 'bgm-track-title';
      name.textContent = w.name;
      const meta = document.createElement('span');
      meta.className = 'sub';
      meta.textContent = `${t(`halloween.raffle.poolName.${w.pool}`)} · ${t('halloween.raffle.pool', { count: w.poolSize })} · ${new Date(w.at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}`;
      li.append(name, meta);
      return li;
    }));
  }

  // ─── 面板萬聖節配色（每台電腦自己記；預設開）───
  const SEASON_KEY = 'elitesand-season-theme';
  function seasonThemeEnabled() {
    try { return localStorage.getItem(SEASON_KEY) !== 'off'; } catch (_) { return true; }
  }
  function applySeason(active) {
    const on = active && seasonThemeEnabled();
    if (on) document.documentElement.dataset.season = 'halloween';
    else if (document.documentElement.dataset.season === 'halloween') delete document.documentElement.dataset.season;
    if (on && window.HalloweenArt) window.HalloweenArt.probe('panel-badge');
    const toggle = el('halloween-season-theme');
    if (toggle) toggle.checked = seasonThemeEnabled();
  }

  function apply(next) {
    if (!next) return;
    state = next;
    applySeason(next.active !== false);
    renderForm();
    renderBoard(state.board);
    renderWinners();
  }

  function send(event, data, onOk) {
    SocketClient.sendWithCallback(event, data, (result) => {
      if (!result) return;
      if (!result.ok) {
        toast(result.inactive ? t('halloween.toast.ended') : (result.error || t('halloween.toast.failed')), 'error');
        if (result.state) apply(result.state);
        return;
      }
      apply(result.state);
      onOk?.(result);
    });
  }

  // ─── 回顧卡 ───
  const PUMPKIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffab45"/><stop offset=".6" stop-color="#ec6f12"/><stop offset="1" stop-color="#a9440a"/></linearGradient><radialGradient id="f" cx="50%" cy="62%" r="60%"><stop offset="0" stop-color="#fffbe0"/><stop offset=".45" stop-color="#ffd85a"/><stop offset="1" stop-color="#ff8a1c"/></radialGradient></defs><path d="M93 40 C91 26 97 14 110 10 L114 17 C106 20 104 28 107 40 Z" fill="#5f6b2c"/><g fill="url(#s)" stroke="rgba(110,40,4,.55)" stroke-width="2"><ellipse cx="50" cy="114" rx="40" ry="62"/><ellipse cx="150" cy="114" rx="40" ry="62"/><ellipse cx="72" cy="112" rx="44" ry="68"/><ellipse cx="128" cy="112" rx="44" ry="68"/><ellipse cx="100" cy="112" rx="46" ry="72"/></g><path fill="url(#f)" d="M60 96 L86 96 L73 72 Z M114 96 L140 96 L127 72 Z M93 118 L107 118 L100 105 Z M50 126 Q100 176 150 126 L139 133 L131 124 L120 140 L110 129 L100 145 L90 129 L80 140 L69 124 L61 133 Z"/></svg>`;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function fitText(ctx, text, maxWidth) {
    let out = String(text);
    if (ctx.measureText(out).width <= maxWidth) return out;
    while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
    return `${out}…`;
  }

  async function drawRecap(event) {
    const canvas = el('halloween-recap-canvas');
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const font = '"Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif';

    // 美術素材插槽：recap-bg（1920×1080 背景）與 pumpkin-lit（點亮的南瓜燈）有就用，沒有就畫保底版。
    const art = window.HalloweenArt ? await window.HalloweenArt.load(['recap-bg', 'pumpkin-lit']) : {};
    if (art['recap-bg']) {
      ctx.drawImage(await loadImage(art['recap-bg']), 0, 0, W, H);
      // 壓暗右半邊，讓文字在任何背景上都讀得清楚。
      const shade = ctx.createLinearGradient(700, 0, W, 0);
      shade.addColorStop(0, 'rgba(14, 8, 24, 0)');
      shade.addColorStop(0.25, 'rgba(14, 8, 24, 0.72)');
      shade.addColorStop(1, 'rgba(14, 8, 24, 0.82)');
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, W, H);
    } else {
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#2b1747');
      bg.addColorStop(1, '#120a1f');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      const glow = ctx.createRadialGradient(420, 640, 40, 420, 640, 620);
      glow.addColorStop(0, 'rgba(255, 140, 30, 0.45)');
      glow.addColorStop(1, 'rgba(255, 140, 30, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
    }

    const pumpkin = await loadImage(art['pumpkin-lit'] || `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PUMPKIN_SVG)}`);
    ctx.drawImage(pumpkin, 140, 360, 560, 560);

    const goal = Math.max(Number(event.goal) || 1, 1);
    const total = Math.max(Number(event.total) || 0, 0);
    const percent = Math.round((total / goal) * 100);
    const supporters = new Set((event.donations || []).map((d) => d.name)).size;

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffd85a';
    ctx.font = `900 76px ${font}`;
    ctx.fillText(fitText(ctx, event.title || '', 1700), 120, 170);
    ctx.fillStyle = 'rgba(255, 246, 232, 0.75)';
    ctx.font = `500 30px ${font}`;
    ctx.fillText(t('halloween.recap.subtitle'), 124, 222);

    ctx.fillStyle = '#fff6e8';
    ctx.font = `900 92px ${font}`;
    ctx.fillText(`NT$${nf.format(total)}`, 780, 410);
    ctx.fillStyle = 'rgba(255, 246, 232, 0.7)';
    ctx.font = `600 34px ${font}`;
    ctx.fillText(t('halloween.recap.goalLine', { goal: nf.format(goal), percent }), 784, 466);

    // 進度條
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(784, 500, 980, 18);
    const bar = ctx.createLinearGradient(784, 0, 1764, 0);
    bar.addColorStop(0, '#ff8a1c');
    bar.addColorStop(1, '#ffd85a');
    ctx.fillStyle = bar;
    ctx.fillRect(784, 500, 980 * Math.min(total / goal, 1), 18);

    const stats = [
      [t('halloween.recap.supporters'), nf.format(supporters)],
      [t('halloween.recap.treats'), nf.format(state?.board?.totalTreats || 0)],
      [t('halloween.recap.tricks'), nf.format((state?.board?.totalTricks || 0) + (state?.board?.totalPranks || 0))],
    ];
    stats.forEach(([label, value], i) => {
      const x = 784 + i * 330;
      ctx.fillStyle = '#ffd85a';
      ctx.font = `900 60px ${font}`;
      ctx.fillText(value, x, 620);
      ctx.fillStyle = 'rgba(255, 246, 232, 0.75)';
      ctx.font = `500 28px ${font}`;
      ctx.fillText(label, x, 664);
    });

    const column = (title, rows, x) => {
      ctx.fillStyle = '#ffae4a';
      ctx.font = `700 32px ${font}`;
      ctx.fillText(title, x, 760);
      ctx.fillStyle = '#fff6e8';
      ctx.font = `700 34px ${font}`;
      if (!rows.length) {
        ctx.fillStyle = 'rgba(255, 246, 232, 0.5)';
        ctx.fillText('—', x, 816);
        return;
      }
      rows.slice(0, 5).forEach((row, i) => ctx.fillText(fitText(ctx, row, 300), x, 816 + i * 50));
    };
    const byName = new Map();
    for (const d of event.donations || []) byName.set(d.name, (byName.get(d.name) || 0) + d.amount);
    const topDonors = [...byName].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    column(t('halloween.recap.topSupporters'), topDonors, 784);
    column(t('halloween.credits.candyKing'), (state?.board?.top || []).map((v) => t('halloween.credits.candyCount', { name: v.name, count: v.treats })), 1114);
    column(t('halloween.recap.winners'), (state?.winners || []).map((w) => w.name), 1444);

    ctx.fillStyle = 'rgba(255, 246, 232, 0.45)';
    ctx.font = `500 24px ${font}`;
    ctx.fillText(t('halloween.recap.footer'), 124, H - 60);
  }

  function makeRecap() {
    SocketClient.sendWithCallback('halloween:get', null, (result) => {
      if (!result?.ok) { toast(t(result?.inactive ? 'halloween.toast.ended' : 'halloween.toast.failed'), 'error'); return; }
      drawRecap(result.state).then(() => {
        el('halloween-recap-canvas').parentElement.hidden = false;
        el('halloween-recap-download').hidden = false;
      }).catch(() => toast(t('halloween.toast.failed'), 'error'));
    });
  }

  function downloadRecap() {
    el('halloween-recap-canvas').toBlob((blob) => {
      if (!blob) { toast(t('halloween.toast.failed'), 'error'); return; }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'elitesand-halloween-recap.png';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }

  function wireUi() {
    const form = el('halloween-fx-form');
    form.addEventListener('input', () => { formDirty = true; });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      formDirty = false;
      send('halloween:fx:settings', {
        chatEnabled: el('halloween-fx-chat-enabled').checked,
        treatCommand: el('halloween-fx-treat-command').value,
        trickCommand: el('halloween-fx-trick-command').value,
        userCooldownSeconds: Number(el('halloween-fx-cooldown').value),
        prank: {
          enabled: el('halloween-fx-prank-enabled').checked,
          title: el('halloween-fx-prank-title').value,
          cost: Number(el('halloween-fx-prank-cost').value),
          cooldownSeconds: Number(el('halloween-fx-prank-cooldown').value),
        },
      }, () => toast(t('halloween.toast.saved'), 'success'));
    });

    el('halloween-fx-reset').addEventListener('click', () => {
      window.DangerConfirm.request({
        title: t('halloween.board.confirmTitle'),
        summary: t('halloween.board.confirmSummary'),
        impact: t('halloween.confirmClear.impact'),
        phrase: t('halloween.confirmClear.phrase'),
      }).then((ok) => { if (ok) send('halloween:fx:reset'); });
    });

    el('halloween-raffle-draw').addEventListener('click', () => {
      send('halloween:raffle:draw', {
        pool: el('halloween-raffle-pool').value,
        weighted: el('halloween-raffle-weighted').checked,
        excludeWinners: el('halloween-raffle-exclude').checked,
        announce: el('halloween-raffle-announce').checked,
      }, (result) => {
        el('halloween-raffle-result').textContent = t('halloween.raffle.winner', { name: result.winner.name });
      });
    });
    el('halloween-raffle-clear').addEventListener('click', () => {
      window.DangerConfirm.request({
        requirePhrase: false,
        tone: 'neutral',
        title: t('halloween.raffle.clearTitle'),
        impact: t('halloween.raffle.clearImpact'),
        confirmLabel: t('halloween.raffle.clear'),
      }).then((ok) => {
        if (!ok) return;
        send('halloween:raffle:clear', null, () => { el('halloween-raffle-result').textContent = ''; });
      });
    });

    el('halloween-season-theme').addEventListener('change', (event) => {
      try { localStorage.setItem(SEASON_KEY, event.target.checked ? 'on' : 'off'); } catch (_) { /* 不能存就只套用這一次 */ }
      applySeason(!!state && state.active !== false);
    });

    el('halloween-recap-make').addEventListener('click', makeRecap);
    el('halloween-recap-download').addEventListener('click', downloadRecap);
  }

  SocketClient.on('halloween:fx:update', apply);
  SocketClient.on('halloween:board', (board) => { if (state) { state.board = board; renderBoard(board); } });
  window.addEventListener('i18n:change', () => { if (state) apply(state); });
  SocketClient.on('connection-change', (connected) => {
    if (!connected) return;
    SocketClient.sendWithCallback('halloween:fx:get', null, (result) => {
      if (result?.ok) apply(result.state);
      else if (result?.inactive) applySeason(false);
    });
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireUi);
  else wireUi();
})();
