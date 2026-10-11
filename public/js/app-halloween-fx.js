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
  // 保底大鍋（沒有 cauldron.webp 時）：鍋口位置與美術圖一致，液體從鍋口透出來。
  const CAULDRON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><path fill="#f28a1e" stroke="#ffd45c" stroke-width="6" d="M215 520 Q228 470 255 455 Q248 490 270 500 Q262 465 300 430 Q300 480 322 492 Q330 465 350 455 Q378 480 385 520 Z"/><path fill="#6b3fa0" d="M140 455 L120 520 L165 505 Z M460 455 L480 520 L435 505 Z"/><path fill="#20152b" fill-rule="evenodd" d="M300 95 C430 95 520 118 520 150 C560 200 570 290 540 380 C510 470 410 500 300 500 C190 500 90 470 60 380 C30 290 40 200 80 150 C80 118 170 95 300 95 Z M300 89.8 C194.4 89.8 108.7 108.4 108.7 131.4 C108.7 154.4 194.4 173 300 173 C405.6 173 491.3 154.4 491.3 131.4 C491.3 108.4 405.6 89.8 300 89.8 Z"/><ellipse cx="300" cy="131.4" rx="203" ry="50" fill="none" stroke="#6b3fa0" stroke-width="22"/></svg>`;
  // 鍋口橢圓（相對鍋子圖的比例）與液體顏色，跟 /halloween 疊加層一致。
  const HOLE = { cx: 0.5, cy: 0.219, rx: 0.3188, ry: 0.0693 };
  const LIQUID = { candy: '#F5A3C0', ghost: '#F7F1E6', bat: '#9B6BE0', pumpkin: '#F28A1E', witch: '#7FB03E', water: '#C3AEEB' };
  const INGREDIENTS = ['candy', 'ghost', 'bat', 'pumpkin', 'witch'];

  /** 鍋口裡的液體：熬過就是藥水的顏色，沒熬過就是目前比例分色。 */
  function drawLiquid(ctx, cauldron, x, y, size) {
    const cx = x + HOLE.cx * size;
    const cy = y + HOLE.cy * size;
    const rx = HOLE.rx * size + 4;
    const ry = HOLE.ry * size + 4;
    const brew = cauldron?.brew;
    const parts = brew
      ? (brew.tie || [brew.winner]).map((key) => [key, 1])
      : INGREDIENTS.filter((key) => cauldron?.shares?.[key] > 0).map((key) => [key, cauldron.shares[key]]);
    if (!parts.length) parts.push(['water', 1]);
    const total = parts.reduce((sum, [, v]) => sum + v, 0);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    let angle = -Math.PI / 2;
    for (const [key, value] of parts) {
      const sweep = (value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, rx * 1.1, angle, angle + sweep);
      ctx.closePath();
      ctx.fillStyle = LIQUID[key];
      ctx.fill();
      angle += sweep;
    }
    ctx.restore();
  }

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

    // 美術素材插槽：recap-bg（1920×1080 背景）、cauldron（大鍋）、potion-*（熬出的藥水）有就用，沒有就畫保底版。
    const cauldron = event.cauldron;
    const winners = cauldron?.brew ? (cauldron.brew.tie || [cauldron.brew.winner]) : [];
    const art = window.HalloweenArt
      ? await window.HalloweenArt.load(['recap-bg', 'cauldron', ...winners.map((key) => `potion-${key}`)])
      : {};
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

    drawLiquid(ctx, cauldron, 140, 400, 560);
    const pot = await loadImage(art.cauldron || `data:image/svg+xml;charset=utf-8,${encodeURIComponent(CAULDRON_SVG)}`);
    ctx.drawImage(pot, 140, 400, 560, 560);
    // 熬出的藥水：瓶子立在鍋子右上，名稱寫在右半邊標題下方。
    const potions = winners.filter((key) => art[`potion-${key}`]);
    for (const [i, key] of potions.entries()) {
      ctx.drawImage(await loadImage(art[`potion-${key}`]), 540 + i * 120, 300, 180, 240);
    }
    if (winners.length) {
      const names = winners.map((key) => cauldron.potions?.[key]?.name || t(`halloween.style.${key}`)).join(' × ');
      ctx.fillStyle = 'rgba(255, 246, 232, 0.7)';
      ctx.font = `600 28px ${font}`;
      ctx.fillText(t('halloween.recap.brewed'), 784, 268);
      ctx.fillStyle = '#ffd85a';
      ctx.font = `900 48px ${font}`;
      ctx.fillText(fitText(ctx, `${cauldron.brew.reachedGoal ? `${t('halloween.cauldron.bonus')} ` : ''}${names}`, 980), 784, 322);
    }

    const goal = Math.max(Number(event.goal) || 1, 1);
    const total = Math.max(Number(event.total) || 0, 0);
    const percent = Math.round((total / goal) * 100);
    const shares = event.unit === 'shares';
    const supporters = new Set((event.donations || []).map((d) => d.name)).size;

    ctx.textBaseline = 'alphabetic';
    // 標題放右半邊的暗區（左上是背景圖的月亮，壓上去讀不到）；仍描一圈深色邊，換背景也穩。
    const outlined = (text, x, y, fill, width) => {
      ctx.lineJoin = 'round';
      ctx.lineWidth = width;
      ctx.strokeStyle = 'rgba(20, 10, 32, 0.85)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = fill;
      ctx.fillText(text, x, y);
    };
    ctx.font = `900 76px ${font}`;
    outlined(fitText(ctx, event.title || '', 1060), 780, 150, '#ffd85a', 12);
    ctx.font = `500 30px ${font}`;
    outlined(t('halloween.recap.subtitle'), 784, 200, 'rgba(255, 246, 232, 0.85)', 8);

    ctx.fillStyle = '#fff6e8';
    ctx.font = `900 92px ${font}`;
    ctx.fillText(shares ? `${nf.format(total)} ${t('halloween.cauldron.unit')}` : `NT$${nf.format(total)}`, 780, 410);
    ctx.fillStyle = 'rgba(255, 246, 232, 0.7)';
    ctx.font = `600 34px ${font}`;
    ctx.fillText(t(shares ? 'halloween.recap.goalLineShares' : 'halloween.recap.goalLine', { goal: nf.format(goal), percent }), 784, 466);

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
      ctx.fillText(title, x, 756);
      ctx.fillStyle = '#fff6e8';
      ctx.font = `700 34px ${font}`;
      if (!rows.length) {
        ctx.fillStyle = 'rgba(255, 246, 232, 0.5)';
        ctx.fillText('—', x, 808);
        return;
      }
      // 最多 4 行，最後一行留在畫面底邊之上。
      rows.slice(0, 4).forEach((row, i) => ctx.fillText(fitText(ctx, row, 300), x, 808 + i * 46));
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
        spinSeconds: Number(el('halloween-raffle-spin').value),
        holdSeconds: Number(el('halloween-raffle-hold').value),
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
