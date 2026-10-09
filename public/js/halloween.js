/**
 * 萬聖節活動疊加層（/halloween）：南瓜燈進度條＋萬聖節名牌。分頁、感謝提示、謝幕名單、
 * 示範模式與 socket 事件在 seasonal-overlay.js 共用核心；這裡只有萬聖節的畫面。
 * 網址參數見 seasonal-overlay.js；?part=pumpkin|treats|credits。
 *
 * 進度：南瓜燈的刻痕從下往上被燭光填滿（看得出「填到哪」），外圈光暈跟著變亮。
 */
(function () {
  'use strict';

  const TREAT_STYLES = ['candy', 'ghost', 'bat', 'pumpkin', 'witch'];

  // 美術素材插槽（public/assets/halloween/）：有圖就換圖，沒有就維持 CSS／SVG 保底畫法。
  if (window.HalloweenArt) {
    HalloweenArt.load([
      'pumpkin-unlit', 'pumpkin-lit',
      ...TREAT_STYLES.map((style) => `tag-${style}`),
      'bat', 'ghost-prank', 'pop-candy', 'pop-ghost',
    ]);
  }
  const DEMO_DONATIONS = [
    { id: 'demo-candy', name: '要糖不搗蛋', amount: 50, style: 'candy' },
    { id: 'demo-ghost', name: '飄飄', amount: 100, style: 'ghost' },
    { id: 'demo-bat', name: '夜行蝙蝠', amount: 300, style: 'bat' },
    { id: 'demo-pumpkin', name: '南瓜頭', amount: 500, style: 'pumpkin' },
    { id: 'demo-witch', name: '黑貓魔女', amount: 1000, style: 'witch' },
  ];

  // 刻痕的上下緣（viewBox 座標）：燭光從 FACE_BOTTOM 往上填到 FACE_TOP。
  const FACE_TOP = 70;
  const FACE_BOTTOM = 148;
  const glowRect = document.getElementById('pumpkin-glow-rect');
  const panel = document.getElementById('halloween-panel');
  const burst = document.getElementById('halloween-burst');

  function setProgress(p) {
    const h = p <= 0.001 ? 0 : (FACE_BOTTOM - FACE_TOP) * p + 2;
    glowRect.setAttribute('y', String(FACE_BOTTOM - h + 1));
    glowRect.setAttribute('height', String(h));
    panel.style.setProperty('--lit', p.toFixed(3));
  }

  function buildTreat(donation, { isNew, money, div }) {
    const node = div(`treat treat--${donation.style}` + (isNew ? ' is-new' : ''));
    node.dataset.id = donation.id;
    const body = div('treat-body');
    const name = div('treat-name');
    name.textContent = donation.name;
    const amount = div('treat-amount');
    amount.textContent = money(donation.amount);
    body.append(name, amount);
    node.append(div('treat-cord'), div('treat-top'), body, div('treat-bottom'));
    return node;
  }

  // 達標：南瓜後方飛出一群蝙蝠，再補一圈橘紫火花。
  function batSwarm(delay) {
    for (let i = 0; i < 14; i++) {
      const bat = document.createElement('span');
      bat.className = 'pumpkin-bat';
      const size = 30 + Math.random() * 26;
      bat.style.width = `${size}px`;
      bat.style.height = `${size * 0.5}px`;
      burst.append(bat);
      const side = i % 2 === 0 ? -1 : 1;
      const dx = side * (90 + Math.random() * 260);
      const dy = -(160 + Math.random() * 260);
      const wobble = (Math.random() - 0.5) * 80;
      bat.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.3)', opacity: 0 },
          { transform: `translate(calc(-50% + ${dx * 0.35 + wobble}px), calc(-50% + ${dy * 0.3}px)) scale(1)`, opacity: 1, offset: 0.25 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.8)`, opacity: 0 },
        ],
        { duration: 1800 + Math.random() * 900, delay: delay + i * 45, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'both' },
      ).onfinish = () => bat.remove();
    }
  }

  function sparkRing(delay) {
    for (let i = 0; i < 16; i++) {
      const spark = document.createElement('span');
      spark.className = `pumpkin-spark${i % 2 ? ' is-violet' : ''}`;
      burst.append(spark);
      const angle = (i / 16) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 110 + Math.random() * 110;
      spark.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 1 },
          { transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px)) scale(1)`, opacity: 0 },
        ],
        { duration: 1200 + Math.random() * 500, delay: delay + Math.random() * 150, easing: 'cubic-bezier(.15,.7,.3,1)', fill: 'both' },
      ).onfinish = () => spark.remove();
    }
  }

  // ─── 觀眾互動特效 ───
  const fxLayer = document.getElementById('halloween-fx');
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let overlay = null;
  const t = (key, vars) => (overlay ? overlay.t(key, vars) : key);

  // 飄過的糖果／小幽靈：同時最多 6 個，其餘排隊（最多 20），再多就丟掉——聊天室刷指令時畫面不會被塞爆。
  const POP_MAX_ON_SCREEN = 6;
  const POP_QUEUE_MAX = 20;
  const POP_GAP_MS = 350;
  const popQueue = [];
  let popsOnScreen = 0;
  let popTimer = 0;

  function labelled(text, name) {
    const [before, after = ''] = text.split('{name}');
    const who = document.createElement('b');
    who.textContent = name;
    const span = document.createElement('span');
    span.append(before, who, after);
    return span;
  }

  function pumpPops() {
    if (popTimer || !popQueue.length || popsOnScreen >= POP_MAX_ON_SCREEN) return;
    const pop = popQueue.shift();
    popsOnScreen += 1;
    const node = document.createElement('div');
    node.className = `fx-pop fx-pop--${pop.kind}`;
    const icon = document.createElement('div');
    icon.className = 'fx-pop-icon';
    node.append(icon, labelled(t(`halloween.fx.${pop.kind}`), pop.name));
    node.style.left = `${8 + Math.random() * 78}%`;
    fxLayer.append(node);
    const drift = (Math.random() - 0.5) * 120;
    const frames = reduceMotion()
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }]
      : [
        { transform: 'translate(-50%, 40px) scale(0.6)', opacity: 0 },
        { transform: `translate(calc(-50% + ${drift * 0.3}px), -60px) scale(1)`, opacity: 1, offset: 0.15 },
        { transform: `translate(calc(-50% + ${drift}px), -360px) scale(1)`, opacity: 1, offset: 0.75 },
        { transform: `translate(calc(-50% + ${drift * 1.2}px), -440px) scale(0.9)`, opacity: 0 },
      ];
    node.animate(frames, { duration: 3400, easing: 'ease-out', fill: 'both' }).onfinish = () => {
      node.remove();
      popsOnScreen -= 1;
      pumpPops();
    };
    popTimer = setTimeout(() => { popTimer = 0; pumpPops(); }, POP_GAP_MS);
  }

  function queuePop(pop) {
    if (!pop || (pop.kind !== 'treat' && pop.kind !== 'trick') || !pop.name) return;
    if (popQueue.length >= POP_QUEUE_MAX) return;
    popQueue.push(pop);
    pumpPops();
  }

  // 搗蛋獎勵：大幽靈從右側衝進畫面喊 BOO，一次一個，依序播放。
  const prankQueue = [];
  let prankBusy = false;

  function playNextPrank() {
    const prank = prankQueue.shift();
    if (!prank) { prankBusy = false; return; }
    prankBusy = true;
    const node = document.createElement('div');
    node.className = 'fx-prank';
    const ghost = document.createElement('div');
    ghost.className = 'fx-prank-ghost';
    const boo = document.createElement('div');
    boo.className = 'fx-prank-boo';
    boo.textContent = t('halloween.fx.boo');
    const label = document.createElement('div');
    label.className = 'fx-prank-label';
    label.append(labelled(t('halloween.fx.prank'), prank.name));
    node.append(ghost, boo, label);
    fxLayer.append(node);
    const frames = reduceMotion()
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }]
      : [
        { transform: 'translate(70vw, 10vh) scale(0.4) rotate(12deg)', opacity: 0 },
        { transform: 'translate(0, 0) scale(1.15) rotate(-4deg)', opacity: 1, offset: 0.18 },
        { transform: 'translate(0, -8px) scale(1) rotate(2deg)', opacity: 1, offset: 0.3 },
        { transform: 'translate(0, 6px) scale(1) rotate(-2deg)', opacity: 1, offset: 0.8 },
        { transform: 'translate(-70vw, -6vh) scale(0.6) rotate(-10deg)', opacity: 0 },
      ];
    node.animate(frames, { duration: 4000, easing: 'cubic-bezier(.3,.8,.3,1)', fill: 'both' }).onfinish = () => {
      node.remove();
      setTimeout(playNextPrank, 400);
    };
  }

  function queuePrank(prank) {
    if (!prank?.name || prankQueue.length >= 10) return;
    prankQueue.push(prank);
    if (!prankBusy) playNextPrank();
  }

  // 抽獎揭曉：名字快速輪轉後慢慢停在得主身上，停留幾秒再淡出。
  let raffleNode = null;

  function revealRaffle(raffle) {
    if (!raffle?.winner) return;
    raffleNode?.remove();
    const node = document.createElement('div');
    node.className = 'fx-raffle';
    const title = document.createElement('div');
    title.className = 'fx-raffle-title';
    title.textContent = t('halloween.raffle.title');
    const reel = document.createElement('div');
    reel.className = 'fx-raffle-name';
    const sub = document.createElement('div');
    sub.className = 'fx-raffle-sub';
    sub.textContent = t('halloween.raffle.pool', { count: raffle.poolSize || 1 });
    node.append(title, reel, sub);
    fxLayer.append(node);
    raffleNode = node;
    const names = Array.isArray(raffle.names) && raffle.names.length ? raffle.names : [raffle.winner];
    const finish = () => {
      reel.textContent = raffle.winner;
      sub.textContent = t('halloween.raffle.winner', { name: raffle.winner });
      node.classList.add('is-won');
      setTimeout(() => {
        node.classList.add('is-leaving');
        setTimeout(() => { if (raffleNode === node) raffleNode = null; node.remove(); }, 700);
      }, 7000);
    };
    if (reduceMotion() || names.length < 2) { finish(); return; }
    // 間隔從 60ms 慢慢拉長到 ~420ms，總長約 3 秒。
    let i = 0;
    let delay = 60;
    const spin = () => {
      reel.textContent = names[i % names.length];
      i += 1;
      delay *= 1.12;
      if (delay > 420) { finish(); return; }
      setTimeout(spin, delay);
    };
    spin();
  }

  // 謝幕名單的「糖果王」：!treat 前三名。
  let board = null;
  function candyKingCredits(state, { div }) {
    const top = (board?.top || []).filter((v) => v.treats > 0).slice(0, 3);
    if (!top.length) return [];
    const group = div('credits-group');
    group.dataset.style = 'candy-king';
    const label = div('credits-group-label');
    label.textContent = t('halloween.credits.candyKing');
    const list = div('credits-names');
    for (const v of top) {
      const span = document.createElement('span');
      span.textContent = t('halloween.credits.candyCount', { name: v.name, count: v.treats });
      list.append(span);
    }
    group.append(label, list);
    return [group];
  }

  SocketClient.on('halloween:pop', queuePop);
  SocketClient.on('halloween:prank', queuePrank);
  SocketClient.on('halloween:raffle', revealRaffle);
  SocketClient.on('halloween:board', (next) => { board = next; });

  overlay = SeasonalOverlay.start({
    prefix: 'halloween',
    parts: ['pumpkin', 'treats', 'fx'],
    styles: TREAT_STYLES,
    fallbackStyle: 'candy',
    demoDonations: DEMO_DONATIONS,
    ids: {
      panel: 'halloween-panel', tagString: 'treat-string', thanks: 'halloween-thanks', total: 'halloween-total',
      goal: 'halloween-goal', title: 'halloween-title', done: 'halloween-done', creditsRoll: 'halloween-credits-roll',
    },
    pageDotsClass: 'treat-page-dots',
    tagBodyClass: 'treat-body',
    // CSS 版名牌 92px 寬（翅膀／包裝紙伸出去，每格含間距約 124px）；美術素材版 112px＋間距 22px。
    tagSlotPx: () => (/\bart-tag-/.test(document.documentElement.className) ? 134 : 124),
    tagEdgePx: 80,
    tagScaleKey: 'treatScale',
    scaleVars: { treatScale: '--treat-scale', pumpkinScale: '--pumpkin-scale' },
    buildTag: buildTreat,
    setProgress,
    creditsExtra: candyKingCredits,
    celebrate() {
      batSwarm(150);
      sparkRing(300);
      sparkRing(1200);
    },
  });

  // ?demo=fx：面板預覽用，不接 Twitch 也能看到糖果、小幽靈、搗蛋幽靈與抽獎揭曉。
  if (new URLSearchParams(location.search).get('demo') === 'fx') {
    const DEMO_NAMES = ['要糖不搗蛋', '飄飄', '夜行蝙蝠', '南瓜頭', '黑貓魔女', '小熊軟糖', '月光', '巫婆湯'];
    const pick = () => DEMO_NAMES[Math.floor(Math.random() * DEMO_NAMES.length)];
    board = { top: [{ name: '小熊軟糖', treats: 12 }, { name: '飄飄', treats: 9 }, { name: '南瓜頭', treats: 7 }] };
    setInterval(() => queuePop({ kind: Math.random() < 0.6 ? 'treat' : 'trick', name: pick() }), 900);
    setTimeout(() => queuePrank({ name: pick() }), 1500);
    setInterval(() => queuePrank({ name: pick() }), 16000);
    setTimeout(() => revealRaffle({ winner: '黑貓魔女', poolSize: DEMO_NAMES.length, names: DEMO_NAMES }), 7000);
    setInterval(() => revealRaffle({ winner: pick(), poolSize: DEMO_NAMES.length, names: DEMO_NAMES }), 24000);
  }
})();
