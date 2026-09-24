/**
 * 中秋活動疊加層（/moon）：月相進度條＋燈籠名牌。資料全部來自 server 的 moon:update。
 * 網址參數：?part=moon|lanterns（只顯示其中一塊）、?max=燈籠數上限（預設 12）。
 */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const part = params.get('part');
  if (part === 'moon' || part === 'lanterns') document.body.dataset.part = part;
  const maxLanterns = Math.min(Math.max(parseInt(params.get('max'), 10) || 12, 1), 40);

  const el = (id) => document.getElementById(id);
  const panel = el('moon-panel');
  const litPath = el('moon-lit-path');
  const lanternString = el('lantern-string');
  const nf = new Intl.NumberFormat('zh-TW');

  const R = 90;
  const C = 100;

  function phasePath(p) {
    if (p <= 0.001) return 'M0 0';
    if (p >= 0.999) return `M${C} ${C - R} A${R} ${R} 0 1 1 ${C} ${C + R} A${R} ${R} 0 1 1 ${C} ${C - R} Z`;
    const rx = R * Math.abs(1 - 2 * p);
    const sweep = p > 0.5 ? 1 : 0;
    return `M${C} ${C - R} A${R} ${R} 0 0 1 ${C} ${C + R} A${rx.toFixed(2)} ${R} 0 0 ${sweep} ${C} ${C - R} Z`;
  }

  let shownProgress = 0;
  let shownTotal = 0;
  let animFrame = 0;
  let settleTimer = 0;

  function setShown(progress, total) {
    shownProgress = progress;
    shownTotal = total;
    litPath.setAttribute('d', phasePath(progress));
    el('moon-total').textContent = nf.format(Math.round(total));
  }

  function animateTo(progress, total) {
    cancelAnimationFrame(animFrame);
    clearTimeout(settleTimer);
    // rAF 在來源被節流（背景分頁、OBS 隱藏來源）時會暫停；到時間一定落在最終值。
    settleTimer = setTimeout(() => { cancelAnimationFrame(animFrame); setShown(progress, total); }, 1600);
    const fromP = shownProgress;
    const fromT = shownTotal;
    const start = performance.now();
    const duration = 1400;
    const step = (now) => {
      const k = Math.min((now - start) / duration, 1);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(fromP + (progress - fromP) * e, fromT + (total - fromT) * e);
      if (k < 1) animFrame = requestAnimationFrame(step);
    };
    animFrame = requestAnimationFrame(step);
  }

  let firstRender = true;
  let knownIds = new Set();
  let schedule = null;
  let scheduleTimer = 0;

  function updateVisibility() {
    clearTimeout(scheduleTimer);
    if (!schedule) return;
    const now = schedule.serverNow + performance.now() - schedule.receivedAt;
    const { startAt, endAt } = schedule;
    document.body.dataset.activity = (startAt === null || (now >= startAt && now < endAt)) ? 'open' : 'hidden';
    const next = startAt !== null && now < startAt ? startAt : (endAt !== null && now < endAt ? endAt : null);
    if (next !== null) scheduleTimer = setTimeout(updateVisibility, Math.max(1, Math.min(next - now + 20, 60000)));
  }

  function applySchedule(state) {
    const startAt = state.startAt ? Date.parse(state.startAt) : null;
    const endAt = state.endAt ? Date.parse(state.endAt) : null;
    schedule = {
      startAt: Number.isFinite(startAt) ? startAt : null,
      endAt: Number.isFinite(endAt) ? endAt : null,
      serverNow: Number.isFinite(state.serverNow) ? state.serverNow : Date.now(),
      receivedAt: performance.now(),
    };
    updateVisibility();
  }

  function buildLantern(donation, isNew) {
    const node = document.createElement('div');
    node.className = 'lantern' + (isNew ? ' is-new' : '');
    node.dataset.id = donation.id;
    const cord = document.createElement('div');
    cord.className = 'lantern-cord';
    const cap = document.createElement('div');
    cap.className = 'lantern-cap';
    const body = document.createElement('div');
    body.className = 'lantern-body';
    const name = document.createElement('div');
    name.className = 'lantern-name';
    name.textContent = donation.name;
    const amount = document.createElement('div');
    amount.className = 'lantern-amount';
    amount.textContent = `NT$${nf.format(donation.amount)}`;
    body.append(name, amount);
    const bottomCap = cap.cloneNode();
    const tassel = document.createElement('div');
    tassel.className = 'lantern-tassel';
    node.append(cord, cap, body, bottomCap, tassel);
    return node;
  }

  function renderLanterns(donations) {
    const visible = donations.slice(-maxLanterns);
    lanternString.replaceChildren(...visible.map((d) => buildLantern(d, !firstRender && !knownIds.has(d.id))));
    knownIds = new Set(donations.map((d) => d.id));
  }

  function render(state) {
    if (!state || typeof state !== 'object') return;
    applySchedule(state);
    const goal = Math.max(Number(state.goal) || 1, 1);
    const total = Math.max(Number(state.total) || 0, 0);
    const progress = Math.min(total / goal, 1);

    el('moon-title').textContent = state.title || '';
    el('moon-goal').textContent = nf.format(goal);
    el('moon-done').textContent = state.doneText || '';
    el('moon-done').hidden = progress < 1;
    panel.classList.toggle('is-full', progress >= 1);

    if (firstRender) {
      setShown(progress, total);
    } else {
      animateTo(progress, total);
    }

    if (!firstRender && state.latestId) {
      panel.classList.remove('is-bump');
      void panel.offsetWidth;
      panel.classList.add('is-bump');
    }

    renderLanterns(Array.isArray(state.donations) ? state.donations : []);
    firstRender = false;
  }

  SocketClient.on('moon:update', render);
  document.addEventListener('visibilitychange', updateVisibility);
  SocketClient.init('moon');
})();
