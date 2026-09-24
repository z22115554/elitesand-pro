/**
 * 中秋活動疊加層（/moon）：月相進度條＋燈籠名牌。資料全部來自 server 的 moon:update。
 * 網址參數：?part=moon|lanterns|credits（只顯示其中一塊）、?max=每頁燈籠數（預設 12）、
 * ?rotate=超過一頁時幾秒換頁（預設 12，0＝不輪播）、?autoplay=1（credits 載入即播）、
 * ?demo=1（面板預覽用：燈籠換成五種樣式的示範）、
 * ?demo=celebrate（同上，且月亮滿月、每隔幾秒重播一次滿月慶祝）。
 */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const part = params.get('part');
  if (part === 'moon' || part === 'lanterns' || part === 'credits') document.body.dataset.part = part;
  const maxLanterns = Math.min(Math.max(parseInt(params.get('max'), 10) || 12, 1), 40);
  const rotateParam = parseInt(params.get('rotate'), 10);
  const rotateMs = (Number.isFinite(rotateParam) ? Math.min(Math.max(rotateParam, 0), 600) : 12) * 1000;
  const demoCelebrate = params.get('demo') === 'celebrate';
  const demo = params.get('demo') === '1' || demoCelebrate;

  const STYLE_LABELS = { paper: '紙燈籠', red: '紅燈籠', pomelo: '柚子燈', palace: '宮燈', rabbit: '月兔燈' };
  const DEMO_DONATIONS = [
    { id: 'demo-paper', name: '湯圓', amount: 50, style: 'paper' },
    { id: 'demo-red', name: '月餅好好吃', amount: 100, style: 'red' },
    { id: 'demo-pomelo', name: '柚子帽', amount: 300, style: 'pomelo' },
    { id: 'demo-palace', name: '賞月的人', amount: 500, style: 'palace' },
    { id: 'demo-rabbit', name: '月兔', amount: 1000, style: 'rabbit' },
  ];

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
  let lastProgress = 0;
  let knownIds = new Set();
  function div(className) {
    const node = document.createElement('div');
    node.className = className;
    return node;
  }

  function buildLantern(donation, isNew) {
    const style = STYLE_LABELS[donation.style] ? donation.style : 'red';
    const node = div(`lantern lantern--${style}` + (isNew ? ' is-new' : ''));
    node.dataset.id = donation.id;
    const body = document.createElement('div');
    body.className = 'lantern-body';
    const name = document.createElement('div');
    name.className = 'lantern-name';
    name.textContent = donation.name;
    const amount = document.createElement('div');
    amount.className = 'lantern-amount';
    amount.textContent = `NT$${nf.format(donation.amount)}`;
    body.append(name, amount);
    node.append(div('lantern-cord'), div('lantern-top'), body, div('lantern-bottom'), div('lantern-tassel'));
    return node;
  }

  // 輪播：第 0 頁＝最新的 max 盞，往後每頁往更早的斗內翻；有新斗內立刻回第 0 頁。
  let allLanterns = [];
  let page = 0;
  let rotateTimer = 0;
  let swapTimer = 0;

  function pageCount() {
    return Math.max(1, Math.ceil(allLanterns.length / maxLanterns));
  }

  function pageSlice(index) {
    const end = allLanterns.length - index * maxLanterns;
    return allLanterns.slice(Math.max(0, end - maxLanterns), end);
  }

  function drawPage(newIds) {
    const nodes = pageSlice(page).map((d) => buildLantern(d, newIds.has(d.id)));
    const pages = pageCount();
    if (pages > 1) {
      const dots = div('lantern-page-dots');
      for (let i = pages - 1; i >= 0; i--) {
        const dot = document.createElement('span');
        if (i === page) dot.className = 'is-current';
        dots.append(dot);
      }
      nodes.push(dots);
    }
    lanternString.replaceChildren(...nodes);
  }

  function scheduleRotation() {
    clearTimeout(rotateTimer);
    rotateTimer = 0;
    if (!rotateMs || demo || pageCount() <= 1) return;
    rotateTimer = setTimeout(() => {
      lanternString.classList.add('is-swapping');
      swapTimer = setTimeout(() => {
        page = (page + 1) % pageCount();
        drawPage(new Set());
        lanternString.classList.remove('is-swapping');
        scheduleRotation();
      }, 600);
    }, rotateMs);
  }

  function renderLanterns(donations, hasNew) {
    const newIds = new Set(firstRender ? [] : donations.filter((d) => !knownIds.has(d.id)).map((d) => d.id));
    knownIds = new Set(donations.map((d) => d.id));
    allLanterns = donations;
    if (hasNew || page >= pageCount()) {
      clearTimeout(swapTimer);
      lanternString.classList.remove('is-swapping');
      page = 0;
    }
    drawPage(page === 0 ? newIds : new Set());
    if (hasNew || firstRender || !rotateTimer) scheduleRotation();
  }

  // ─── 滿月慶祝 ───
  const burst = el('moon-burst');
  let celebrateTimer = 0;

  function sparkBurst(delay) {
    const ring = div('moon-burst-ring');
    burst.append(ring);
    ring.animate(
      [{ transform: 'scale(0.9)', opacity: 0.9 }, { transform: 'scale(2.4)', opacity: 0 }],
      { duration: 1300, delay, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' },
    ).onfinish = () => ring.remove();
    for (let i = 0; i < 18; i++) {
      const spark = document.createElement('span');
      spark.className = 'moon-spark';
      spark.textContent = i % 3 === 0 ? '✦' : '•';
      spark.style.fontSize = `${10 + Math.random() * 14}px`;
      burst.append(spark);
      const angle = (i / 18) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 120 + Math.random() * 130;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      spark.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 1 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.1)`, opacity: 1, offset: 0.7 },
          { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy * 1.1 + 30}px)) scale(0.8)`, opacity: 0 },
        ],
        { duration: 1500 + Math.random() * 700, delay: delay + Math.random() * 200, easing: 'cubic-bezier(.15,.7,.3,1)', fill: 'both' },
      ).onfinish = () => spark.remove();
    }
  }

  function celebrate() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    clearTimeout(celebrateTimer);
    panel.classList.remove('is-celebrating');
    lanternString.classList.remove('is-celebrating');
    void panel.offsetWidth;
    lanternString.querySelectorAll('.lantern-body').forEach((body, i) => {
      body.style.setProperty('--cheer-delay', `${i * 90}ms`);
    });
    panel.classList.add('is-celebrating');
    lanternString.classList.add('is-celebrating');
    sparkBurst(150);
    sparkBurst(1050);
    celebrateTimer = setTimeout(() => {
      panel.classList.remove('is-celebrating');
      lanternString.classList.remove('is-celebrating');
    }, 6200);
  }

  // ─── 謝幕名單 ───
  const STYLE_RANK = ['rabbit', 'palace', 'pomelo', 'red', 'paper'];
  const creditsRoll = el('moon-credits-roll');
  let creditsState = null;
  let creditsAnimation = null;

  function buildCredits(state) {
    const byName = new Map();
    for (const d of state.donations || []) {
      const rank = STYLE_RANK.indexOf(d.style);
      const prev = byName.get(d.name);
      if (prev === undefined || (rank >= 0 && rank < prev)) byName.set(d.name, rank >= 0 ? rank : STYLE_RANK.length - 1);
    }
    const heading = div('credits-heading');
    heading.textContent = '感 謝 名 單';
    const title = div('credits-title');
    title.textContent = state.title || '';
    const blocks = [heading, title];
    STYLE_RANK.forEach((style, rank) => {
      const names = [...byName].filter(([, r]) => r === rank).map(([name]) => name);
      if (!names.length) return;
      const group = div('credits-group');
      group.dataset.style = style;
      const label = div('credits-group-label');
      label.textContent = STYLE_LABELS[style];
      const list = div('credits-names');
      for (const name of names) {
        const span = document.createElement('span');
        span.textContent = name;
        list.append(span);
      }
      group.append(label, list);
      blocks.push(group);
    });
    const closing = div('credits-closing');
    closing.textContent = '謝謝每一份心意';
    const sub = div('credits-closing-sub');
    sub.textContent = `NT$${nf.format(Math.max(Number(state.total) || 0, 0))}・${byName.size} 位`;
    blocks.push(closing, sub);
    creditsRoll.replaceChildren(...blocks);
  }

  function playCredits() {
    if (document.body.dataset.part !== 'credits' || !creditsState) return;
    creditsAnimation?.cancel();
    buildCredits(creditsState);
    const distance = window.innerHeight + creditsRoll.offsetHeight;
    const duration = Math.max(12000, (distance / 70) * 1000);
    creditsRoll.classList.add('is-rolling');
    creditsAnimation = creditsRoll.animate(
      [{ transform: 'translate(-50%, 0)' }, { transform: `translate(-50%, ${-distance}px)` }],
      { duration, easing: 'linear', fill: 'forwards' },
    );
    creditsAnimation.onfinish = () => {
      creditsRoll.classList.remove('is-rolling');
      creditsAnimation = null;
    };
  }

  // 連續幾筆斗內時排隊逐一顯示，不互相蓋掉。
  const thanksEl = el('moon-thanks');
  const thanksQueue = [];
  let thanksBusy = false;

  function showNextThanks() {
    const donation = thanksQueue.shift();
    if (!donation) { thanksBusy = false; return; }
    thanksBusy = true;
    const who = document.createElement('b');
    who.textContent = donation.name;
    thanksEl.replaceChildren('感謝 ', who, ` 點亮${STYLE_LABELS[donation.style] || '燈籠'}`);
    thanksEl.classList.add('is-shown');
    setTimeout(() => {
      thanksEl.classList.remove('is-shown');
      setTimeout(showNextThanks, 600);
    }, 4500);
  }

  function queueThanks(donation) {
    if (!donation) return;
    thanksQueue.push(donation);
    if (thanksQueue.length > 5) thanksQueue.shift();
    if (!thanksBusy) showNextThanks();
  }

  function render(state) {
    if (!state || typeof state !== 'object') return;
    if (ended) return;
    document.body.dataset.activity = 'open';
    const goal = Math.max(Number(state.goal) || 1, 1);
    const total = demoCelebrate ? goal : Math.max(Number(state.total) || 0, 0);
    const progress = Math.min(total / goal, 1);
    const crossedGoal = !firstRender && lastProgress < 1 && progress >= 1;
    lastProgress = progress;

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

    const donations = Array.isArray(state.donations) ? state.donations : [];
    if (!firstRender && state.latestId && !demo) queueThanks(donations.find((d) => d.id === state.latestId));
    renderLanterns(demo ? DEMO_DONATIONS : donations, !firstRender && !!state.latestId);
    const autoplayCredits = firstRender && params.get('autoplay') === '1';
    creditsState = state;
    const startDemoLoop = firstRender && demoCelebrate;
    firstRender = false;
    if (autoplayCredits) playCredits();
    // 等數字與月相漸進走完再放，視覺上是「月亮剛好填滿」的那一刻。
    if (crossedGoal) setTimeout(celebrate, 1300);
    if (startDemoLoop) {
      setTimeout(celebrate, 600);
      setInterval(celebrate, 8000);
    }
  }

  SocketClient.on('moon:celebrate', celebrate);

  SocketClient.on('moon:credits', playCredits);

  SocketClient.on('moon:update', render);
  // 活動已結束（伺服器啟動時判斷）：重連上新伺服器的舊來源整個藏起來。
  let ended = false;
  SocketClient.on('moon:ended', () => {
    ended = true;
    document.body.dataset.activity = 'hidden';
  });
  SocketClient.init('moon');
})();
