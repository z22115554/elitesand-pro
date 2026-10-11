/**
 * 萬聖節活動疊加層（/halloween）：魔女的大鍋＋萬聖節名牌（設計：docs/HALLOWEEN-CAULDRON.md）。
 * 分頁、感謝提示、謝幕名單、示範模式與 socket 事件在 seasonal-overlay.js 共用核心；這裡只有萬聖節的畫面。
 * 網址參數見 seasonal-overlay.js；?part=cauldron（舊網址 pumpkin 也可）|treats|fx|credits，
 * ?demo=cauldron（模擬丟材料）、?demo=brew（每隔一段時間重播熬煮）。
 *
 * 大鍋：液面高度＝總量／目標；液面是依材料比例分色、慢慢旋轉的漩渦。比例由伺服器算好放在
 * halloween:update 的 cauldron 欄位，這裡只負責畫。熬煮結果出現時播一次 12 秒動畫，
 * 重新整理時已經有結果就直接顯示藥水、不重播。
 */
(function () {
  'use strict';

  const INGREDIENTS = ['candy', 'ghost', 'bat', 'pumpkin', 'witch'];
  const TREAT_STYLES = ['water', ...INGREDIENTS];
  // 液體顏色（扁平剪影色票；黑貓的毛在深色鍋裡看不見，用藤綠的亮色代表）。
  const LIQUID = { candy: '#F5A3C0', ghost: '#F7F1E6', bat: '#9B6BE0', pumpkin: '#F28A1E', witch: '#7FB03E', water: '#C3AEEB' };
  const INTERIOR = '#1a1024';

  // 美術素材插槽（public/assets/halloween/）：有圖就換圖，沒有就維持 CSS／SVG 保底畫法。
  if (window.HalloweenArt) {
    HalloweenArt.load([
      'cauldron', ...INGREDIENTS.map((key) => `potion-${key}`),
      ...TREAT_STYLES.map((style) => `tag-${style}`),
      'bat', 'ghost-prank', 'pop-candy', 'pop-ghost',
    ]);
  }
  const DEMO_DONATIONS = [
    { id: 'demo-water', name: '路過的魔女', amount: 30, style: 'water' },
    { id: 'demo-candy', name: '要糖不搗蛋', amount: 50, style: 'candy', ingredient: 'candy' },
    { id: 'demo-ghost', name: '飄飄', amount: 100, style: 'ghost', ingredient: 'ghost' },
    { id: 'demo-bat', name: '夜行蝙蝠', amount: 300, style: 'bat', ingredient: 'bat' },
    { id: 'demo-pumpkin', name: '南瓜頭', amount: 500, style: 'pumpkin', ingredient: 'pumpkin' },
    { id: 'demo-witch', name: '黑貓魔女', amount: 1000, style: 'witch', ingredient: 'witch' },
  ];

  const params = new URLSearchParams(location.search);
  const demoMode = params.get('demo');
  const panel = document.getElementById('halloween-panel');
  const wrap = document.getElementById('cauldron-wrap');
  const burst = document.getElementById('halloween-burst');
  const canvas = document.getElementById('cauldron-liquid');
  const ctx2d = canvas.getContext('2d');
  const potionBox = document.getElementById('cauldron-potion');
  const topLine = document.getElementById('cauldron-top');
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let overlay = null;
  const t = (key, vars) => (overlay ? overlay.t(key, vars) : key);
  const styleLabel = (style) => t(`halloween.style.${TREAT_STYLES.includes(style) ? style : 'fallback'}`);

  // ─── 大鍋液面 ───
  let level = 0;            // 目標液面（0～1）
  let shownLevel = 0;
  let hasLiquid = false;
  let target = { water: 1 }; // 目標比例（含清水，用來決定顏色分區）
  let shown = { water: 1 };
  let swirlSpeed = 1;
  let bubbleRate = 1;
  let rotation = 0;
  const bubbles = [];
  const splashes = [];
  let lastFrame = 0;
  let lastBubble = 0;

  function setProgress(p) {
    level = Math.max(0, Math.min(p, 1));
    panel.style.setProperty('--lit', level.toFixed(3));
  }

  /** 液體顏色分區：有投票就用材料比例；只有清水（或還沒有比例）就整鍋清水色。 */
  function setTargetShares(cauldron) {
    const shares = cauldron?.shares || {};
    const voted = INGREDIENTS.filter((key) => shares[key] > 0);
    hasLiquid = (cauldron?.totalShares || 0) > 0;
    if (!voted.length) { target = { water: 1 }; return; }
    target = Object.fromEntries(voted.map((key) => [key, shares[key]]));
  }

  function resizeCanvas() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const h = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  function pickColor() {
    let roll = Math.random();
    for (const [key, value] of Object.entries(shown)) {
      roll -= value;
      if (roll <= 0) return LIQUID[key];
    }
    return LIQUID.water;
  }

  function drawLiquid(now) {
    const dt = Math.min((now - lastFrame) / 1000 || 0, 0.1);
    lastFrame = now;
    resizeCanvas();
    const W = canvas.width;
    const H = canvas.height;
    const g = ctx2d;
    g.clearRect(0, 0, W, H);
    g.save();
    g.beginPath();
    g.ellipse(W / 2, H / 2, W / 2, H / 2, 0, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = INTERIOR;
    g.fillRect(0, 0, W, H);

    // 比例、液面平滑過渡（新材料進來時顏色慢慢滲開，不是瞬間跳）。
    const ease = 1 - Math.pow(0.04, dt);
    const keys = new Set([...Object.keys(shown), ...Object.keys(target)]);
    for (const key of keys) {
      const next = (shown[key] || 0) + ((target[key] || 0) - (shown[key] || 0)) * ease;
      if (next < 0.001 && !target[key]) delete shown[key]; else shown[key] = next;
    }
    shownLevel += ((hasLiquid ? Math.max(level, 0.12) : 0) - shownLevel) * ease;
    rotation += dt * 0.18 * swirlSpeed;

    if (shownLevel > 0.01) {
      // 液面：越滿越大、越靠近鍋緣。
      const L = shownLevel;
      const rx = (W / 2) * (0.62 + 0.38 * L);
      const ry = (H / 2) * (0.62 + 0.38 * L);
      const cy = H / 2 + (1 - L) * H * 0.26;
      g.save();
      g.beginPath();
      g.ellipse(W / 2, cy, rx, ry, 0, 0, Math.PI * 2);
      g.clip();
      // 扇區：在單位圓上畫好再壓扁成液面的橢圓，旋轉起來才像漩渦。
      g.translate(W / 2, cy);
      g.scale(1, ry / rx);
      const total = Object.values(shown).reduce((a, b) => a + b, 0) || 1;
      let angle = rotation;
      for (const [key, value] of Object.entries(shown)) {
        const sweep = (value / total) * Math.PI * 2;
        g.beginPath();
        g.moveTo(0, 0);
        g.arc(0, 0, rx * 1.05, angle, angle + sweep);
        g.closePath();
        g.fillStyle = LIQUID[key];
        g.fill();
        angle += sweep;
      }
      // 漩渦紋：兩條淡淡的螺旋線。
      g.strokeStyle = 'rgba(32, 21, 43, 0.28)';
      g.lineWidth = Math.max(1, rx * 0.025);
      for (let arm = 0; arm < 2; arm++) {
        g.beginPath();
        for (let i = 0; i <= 40; i++) {
          const k = i / 40;
          const a = rotation * 1.6 + arm * Math.PI + k * Math.PI * 1.4;
          const r = rx * (0.12 + 0.8 * k);
          if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r); else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        g.stroke();
      }
      g.restore();

      // 泡泡：比例高的顏色冒得多；熬煮時冒得又快又多。
      if (!reduceMotion() && now - lastBubble > 650 / bubbleRate) {
        lastBubble = now;
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * 0.85;
        bubbles.push({ x: W / 2 + Math.cos(a) * rx * d, y: cy + Math.sin(a) * ry * d, r: 0, max: H * (0.08 + Math.random() * 0.1), color: pickColor(), life: 0 });
        if (bubbles.length > 40) bubbles.shift();
      }
    }
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.life += dt;
      b.r = b.max * Math.min(b.life / 0.6, 1);
      const fade = b.life > 0.8 ? Math.max(0, 1 - (b.life - 0.8) / 0.3) : 1;
      if (fade <= 0) { bubbles.splice(i, 1); continue; }
      g.globalAlpha = fade;
      g.fillStyle = b.color;
      g.strokeStyle = 'rgba(32, 21, 43, 0.8)';
      g.lineWidth = Math.max(1, b.max * 0.18);
      g.beginPath();
      g.ellipse(b.x, b.y - b.r * 0.3, b.r, b.r * 0.8, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.globalAlpha = 1;
    }
    for (let i = splashes.length - 1; i >= 0; i--) {
      const s = splashes[i];
      s.life += dt;
      const k = s.life / 0.7;
      if (k >= 1) { splashes.splice(i, 1); continue; }
      g.globalAlpha = 1 - k;
      g.strokeStyle = s.color;
      g.lineWidth = Math.max(2, H * 0.05 * (1 - k));
      g.beginPath();
      g.ellipse(W / 2, H / 2, W * 0.08 + W * 0.3 * k * s.size, H * 0.12 + H * 0.3 * k * s.size, 0, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }
    g.restore();
  }

  // OBS 隱藏來源時 rAF 會停，回來直接接著畫。
  function loop(now) {
    drawLiquid(now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame((now) => { lastFrame = now; loop(now); });

  // ─── 材料落鍋 ───
  const DROPS_PER_SECOND = 3;
  const dropQueue = [];
  let dropTimer = 0;
  const floatGroups = new Map(); // 同一種材料 1.5 秒內的飄字合併

  function renderFloat(group) {
    const names = [...group.names];
    const label = styleLabel(group.ingredient);
    group.node.textContent = names.length > 1
      ? t('halloween.cauldron.dropMany', { name: names[0], count: names.length, style: label })
      : t('halloween.cauldron.drop', { name: names[0], style: label });
  }

  function showFloat(drop) {
    const group = floatGroups.get(drop.ingredient);
    if (group && performance.now() - group.at < 1500) {
      group.names.add(drop.name);
      group.at = performance.now();
      renderFloat(group);
      return;
    }
    const node = document.createElement('div');
    node.className = 'cauldron-float';
    node.style.setProperty('--drop-color', LIQUID[drop.ingredient]);
    // 不同材料的飄字同時在畫面上時往上疊，不互相蓋住。
    node.style.setProperty('--stack', String(wrap.querySelectorAll('.cauldron-float').length));
    wrap.append(node);
    const next = { node, ingredient: drop.ingredient, names: new Set([drop.name]), at: performance.now() };
    floatGroups.set(drop.ingredient, next);
    renderFloat(next);
    node.animate([{ opacity: 0, transform: 'translate(-50%, 10px)' }, { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.15 },
      { opacity: 1, offset: 0.8 }, { opacity: 0, transform: 'translate(-50%, -24px)' }], { duration: 2400, fill: 'both' })
      .onfinish = () => { node.remove(); if (floatGroups.get(drop.ingredient) === next) floatGroups.delete(drop.ingredient); };
  }

  function playDrop(drop) {
    const big = drop.source === 'donation';
    if (!reduceMotion()) {
      const bead = document.createElement('span');
      bead.className = `cauldron-drop${big ? ' is-big' : ''}`;
      bead.style.setProperty('--drop-color', LIQUID[drop.ingredient] || LIQUID.water);
      bead.style.left = `${46 + Math.random() * 8}%`;
      wrap.append(bead);
      bead.animate([
        { transform: 'translate(-50%, -160px) scale(0.6)', opacity: 0 },
        { transform: 'translate(-50%, -120px) scale(1)', opacity: 1, offset: 0.2 },
        { transform: 'translate(-50%, 0) scale(1)', opacity: 1 },
      ], { duration: 700, easing: 'cubic-bezier(.5,0,.9,.6)', fill: 'both' }).onfinish = () => {
        bead.remove();
        splashes.push({ color: LIQUID[drop.ingredient] || LIQUID.water, life: 0, size: big ? 1.4 : 1 });
      };
    }
    if (drop.source === 'points') showFloat(drop);
  }

  function pumpDrops() {
    if (dropTimer || !dropQueue.length) return;
    playDrop(dropQueue.shift());
    dropTimer = setTimeout(() => { dropTimer = 0; pumpDrops(); }, 1000 / DROPS_PER_SECOND);
  }

  function queueDrop(drop) {
    if (!drop || !TREAT_STYLES.includes(drop.ingredient)) return;
    // 洗版時只保留最近的 30 顆；數字由 halloween:update 校正，掉的只是動畫。
    if (dropQueue.length >= 30) dropQueue.shift();
    dropQueue.push(drop);
    pumpDrops();
  }

  // ─── 熬煮與藥水 ───
  let brewShownAt = null;
  let brewTimers = [];
  let firstUpdate = true;

  function winnerColors(brew) {
    const winners = brew.tie || [brew.winner];
    return Object.fromEntries(winners.map((key) => [key, 1 / winners.length]));
  }

  function potionName(key, potions) {
    return potions?.[key]?.name || styleLabel(key);
  }

  function buildPotionCard(brew, cauldron) {
    const potions = cauldron?.potions || {};
    const winners = brew.tie || [brew.winner];
    const card = document.createElement('div');
    card.className = `potion-card${brew.reachedGoal ? ' is-bonus' : ''}${brew.tie ? ' is-tie' : ''}`;
    const bottles = document.createElement('div');
    bottles.className = 'potion-bottles';
    for (const key of winners) {
      const bottle = document.createElement('div');
      bottle.className = `potion-bottle potion-bottle--${key}`;
      bottle.style.setProperty('--potion-color', LIQUID[key]);
      bottles.append(bottle);
    }
    const label = document.createElement('div');
    label.className = 'potion-label';
    if (brew.reachedGoal) {
      const tag = document.createElement('span');
      tag.className = 'potion-bonus';
      tag.textContent = t('halloween.cauldron.bonus');
      label.append(tag);
    }
    const name = document.createElement('div');
    name.className = 'potion-name';
    name.textContent = brew.tie
      ? t('halloween.cauldron.tieName', { a: potionName(winners[0], potions), b: potionName(winners[1], potions) })
      : potionName(brew.winner, potions);
    label.append(name);
    for (const key of winners) {
      const reward = potions[key]?.reward;
      if (!reward) continue;
      const line = document.createElement('div');
      line.className = 'potion-reward';
      line.textContent = reward;
      label.append(line);
    }
    if (brew.reachedGoal && cauldron?.bonusReward) {
      const line = document.createElement('div');
      line.className = 'potion-reward potion-reward--bonus';
      line.textContent = cauldron.bonusReward;
      label.append(line);
    }
    const ranking = document.createElement('div');
    ranking.className = 'potion-ranking';
    ranking.textContent = INGREDIENTS.filter((key) => brew.shares[key] > 0)
      .sort((a, b) => brew.shares[b] - brew.shares[a])
      .map((key) => `${potionName(key, potions)} ${Math.round(brew.shares[key] * 100)}%`).join('・');
    label.append(ranking);
    card.append(bottles, label);
    return card;
  }

  function clearBrewTimers() {
    brewTimers.forEach(clearTimeout);
    brewTimers = [];
  }

  function showPotion(brew, cauldron, animate) {
    potionBox.replaceChildren(buildPotionCard(brew, cauldron));
    potionBox.classList.add('is-shown');
    if (animate && !reduceMotion()) {
      potionBox.firstChild.animate([
        { transform: 'translateY(40px) scale(0.4)', opacity: 0 },
        { transform: 'translateY(-10px) scale(1.08)', opacity: 1, offset: 0.6 },
        { transform: 'translateY(0) scale(1)', opacity: 1 },
      ], { duration: 1100, easing: 'cubic-bezier(.3,1.4,.5,1)', fill: 'both' });
    }
  }

  function hidePotion() {
    clearBrewTimers();
    potionBox.classList.remove('is-shown');
    potionBox.replaceChildren();
    panel.classList.remove('is-brewing', 'is-converging');
    swirlSpeed = 1;
    bubbleRate = 1;
  }

  function smokePuff() {
    for (let i = 0; i < 10; i++) {
      const puff = document.createElement('span');
      puff.className = 'cauldron-smoke';
      burst.append(puff);
      const dx = (Math.random() - 0.5) * 220;
      const dy = -(120 + Math.random() * 160);
      puff.animate([
        { transform: 'translate(-50%, -50%) scale(0.3)', opacity: 0.9 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${1.4 + Math.random()})`, opacity: 0 },
      ], { duration: 1800 + Math.random() * 800, easing: 'cubic-bezier(.2,.6,.3,1)', fill: 'both' }).onfinish = () => puff.remove();
    }
  }

  /** 12 秒熬煮：猛冒泡 → 顏色收斂成第一名＋大團煙霧 → 浮出藥水。 */
  function playBrew(brew, cauldron) {
    hidePotion();
    const converge = () => { target = winnerColors(brew); hasLiquid = true; };
    if (reduceMotion()) { converge(); showPotion(brew, cauldron, false); return; }
    panel.classList.add('is-brewing');
    swirlSpeed = 6;
    bubbleRate = 6;
    brewTimers.push(setTimeout(() => {
      panel.classList.add('is-converging');
      converge();
      smokePuff();
    }, 4000));
    brewTimers.push(setTimeout(() => {
      smokePuff();
      panel.classList.remove('is-brewing');
      swirlSpeed = 1.5;
      bubbleRate = 2;
      showPotion(brew, cauldron, true);
    }, 7000));
    brewTimers.push(setTimeout(() => {
      panel.classList.remove('is-converging');
      bubbleRate = 1;
    }, 12000));
  }

  let lastDonationIds = null;
  let seenBrewAt = null;

  function renderCauldron(state) {
    if (!state || typeof state !== 'object') return;
    const cauldron = state.cauldron;
    const shares = state.unit === 'shares';
    document.getElementById('halloween-currency').hidden = shares;
    document.getElementById('halloween-unit').textContent = shares ? t('halloween.cauldron.unit') : '';
    const potions = cauldron?.potions || {};
    topLine.replaceChildren(...(cauldron?.top3 || []).flatMap((key, i) => {
      const span = document.createElement('span');
      span.style.color = LIQUID[key];
      span.textContent = `${potionName(key, potions).replace(/藥水$/, '')} ${Math.round((cauldron.shares[key] || 0) * 100)}%`;
      return i ? ['・', span] : [span];
    }));

    // 新斗內：落一顆比較大的材料（點數兌換的落料走 halloween:drop）。
    const donations = Array.isArray(state.donations) ? state.donations : [];
    if (lastDonationIds && state.latestId && !lastDonationIds.has(state.latestId)) {
      const fresh = donations.find((d) => d.id === state.latestId);
      if (fresh) queueDrop({ ingredient: fresh.ingredient || 'water', name: fresh.name, source: 'donation' });
    }
    lastDonationIds = new Set(donations.map((d) => d.id));

    const brew = cauldron?.brew && !cauldron.brew.hidden ? cauldron.brew : null;
    // 熬過、只是被收起來：記住是哪一鍋，再打開時直接顯示，不重熬。
    if (cauldron?.brew?.hidden) seenBrewAt = cauldron.brew.at;
    if (!brew) {
      if (brewShownAt !== null) { brewShownAt = null; hidePotion(); }
      // 收起藥水後液面維持熬好的顏色；重新開鍋（沒有 brew）才回到比例。
      if (!cauldron?.brew) setTargetShares(cauldron);
      else { target = winnerColors(cauldron.brew); hasLiquid = true; }
    } else if (brewShownAt !== brew.at) {
      brewShownAt = brew.at;
      // 連上時已經熬好（OBS 重新整理），或收起後再打開：直接顯示藥水，不重熬。
      if (firstUpdate || seenBrewAt === brew.at) {
        target = winnerColors(brew);
        hasLiquid = true;
        showPotion(brew, cauldron, false);
      } else {
        playBrew(brew, cauldron);
      }
    }
    firstUpdate = false;
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

  // 達標：鍋子後方飛出一群蝙蝠，再補一圈橘紫火花。
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
    // 時長由面板設定（抽獎規則）：名字輪轉 spinMs、得主停留 holdMs；舊事件沒帶就用 3 秒／7 秒。
    const spinMs = Number.isFinite(raffle.spinMs) ? raffle.spinMs : 3000;
    const holdMs = Number.isFinite(raffle.holdMs) ? raffle.holdMs : 7000;
    const finish = () => {
      reel.textContent = raffle.winner;
      sub.textContent = t('halloween.raffle.winner', { name: raffle.winner });
      node.classList.add('is-won');
      setTimeout(() => {
        node.classList.add('is-leaving');
        setTimeout(() => { if (raffleNode === node) raffleNode = null; node.remove(); }, 700);
      }, holdMs);
    };
    if (reduceMotion() || names.length < 2) { finish(); return; }
    // 間隔從 60ms 依經過時間慢慢拉長到 ~420ms（越接近結束越慢），總長＝spinMs。
    let i = 0;
    const begin = performance.now();
    const spin = () => {
      reel.textContent = names[i % names.length];
      i += 1;
      const k = (performance.now() - begin) / spinMs;
      if (k >= 1) { finish(); return; }
      setTimeout(spin, 60 + 360 * k * k);
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

  // 謝幕名單的大鍋段落：熬出了哪瓶藥水、各派大將、丟了材料的觀眾人數。
  function cauldronCredits(state, { div }) {
    const cauldron = state?.cauldron;
    if (!cauldron) return [];
    const blocks = [];
    const potions = cauldron.potions || {};
    if (cauldron.brew) {
      const group = div('credits-group');
      group.dataset.style = 'brew';
      const label = div('credits-group-label');
      label.textContent = t('halloween.credits.brewed');
      const list = div('credits-names');
      const span = document.createElement('span');
      const winners = cauldron.brew.tie || [cauldron.brew.winner];
      span.textContent = winners.map((key) => potionName(key, potions)).join(' × ');
      list.append(span);
      group.append(label, list);
      blocks.push(group);
    }
    const champs = INGREDIENTS.filter((key) => cauldron.champions?.[key]);
    if (champs.length) {
      const group = div('credits-group');
      group.dataset.style = 'champions';
      const label = div('credits-group-label');
      label.textContent = t('halloween.credits.champions');
      const list = div('credits-names');
      for (const key of champs) {
        const span = document.createElement('span');
        span.textContent = t('halloween.credits.champion', { faction: potionName(key, potions).replace(/藥水$/, ''), name: cauldron.champions[key] });
        list.append(span);
      }
      group.append(label, list);
      blocks.push(group);
    }
    if (cauldron.voters > 0) {
      const line = div('credits-group');
      line.dataset.style = 'voters';
      const label = div('credits-group-label');
      label.textContent = t('halloween.credits.voters', { count: cauldron.voters });
      line.append(label);
      blocks.push(line);
    }
    return blocks;
  }

  SocketClient.on('halloween:pop', queuePop);
  SocketClient.on('halloween:prank', queuePrank);
  SocketClient.on('halloween:raffle', revealRaffle);
  SocketClient.on('halloween:board', (next) => { board = next; });
  SocketClient.on('halloween:drop', queueDrop);

  // 示範模式用的假大鍋：比例與液面在本地模擬，不碰伺服器資料。
  const demoCauldron = (demoMode === 'cauldron' || demoMode === 'brew' || demoMode === '1' || demoMode === 'celebrate') ? {
    potions: {
      candy: { name: '甜蜜藥水', reward: '甜歌回' }, ghost: { name: '幽魂藥水', reward: '怪談朗讀' },
      bat: { name: '夜宴藥水', reward: '吸血鬼 cosplay' }, pumpkin: { name: '豐收藥水', reward: '觀眾點歌大會' },
      witch: { name: '魔女藥水', reward: '主播接受指定懲罰' },
    },
    amounts: { candy: 40, ghost: 120, bat: 30, pumpkin: 85, witch: 25 },
    bonusReward: '加開一小時延長賽',
  } : null;

  function demoState(state) {
    const amounts = demoCauldron.amounts;
    const total = INGREDIENTS.reduce((sum, key) => sum + amounts[key], 0);
    const shares = Object.fromEntries(INGREDIENTS.map((key) => [key, amounts[key] / total]));
    const top3 = INGREDIENTS.slice().sort((a, b) => amounts[b] - amounts[a]).slice(0, 3);
    return {
      ...state, unit: 'shares', total, goal: 500,
      cauldron: { mode: 'points', potions: demoCauldron.potions, bonusReward: demoCauldron.bonusReward, shares, top3, totalShares: total,
        champions: { ghost: '飄飄', pumpkin: '南瓜頭' }, voters: 87, brew: demoCauldron.brew || null },
    };
  }

  overlay = SeasonalOverlay.start({
    prefix: 'halloween',
    parts: ['cauldron', 'pumpkin', 'treats', 'fx'],
    styles: TREAT_STYLES,
    fallbackStyle: 'water',
    demoDonations: DEMO_DONATIONS,
    ids: {
      panel: 'halloween-panel', tagString: 'treat-string', thanks: 'halloween-thanks', total: 'halloween-total',
      goal: 'halloween-goal', title: 'halloween-title', done: 'halloween-done', creditsRoll: 'halloween-credits-roll',
    },
    pageDotsClass: 'treat-page-dots',
    tagBodyClass: 'treat-body',
    // CSS 版名牌 92px 寬（翅膀／包裝紙伸出去，每格含間距約 124px）；美術素材版最寬 143px＋間距 22px。
    tagSlotPx: () => (/\bart-tag-/.test(document.documentElement.className) ? 165 : 124),
    tagEdgePx: 80,
    tagScaleKey: 'treatScale',
    scaleVars: { treatScale: '--treat-scale', pumpkinScale: '--pumpkin-scale' },
    buildTag: buildTreat,
    setProgress,
    // 示範模式把伺服器快照換成假大鍋；正式畫面原樣使用。
    transformState: demoCauldron ? demoState : null,
    onRender: renderCauldron,
    // 點數模式的總量是「份」，謝幕結尾那行改顯示份數與斗內人數。
    creditsSummary: (state, count) => (state?.unit === 'shares'
      ? t('halloween.credits.summaryShares', { total: Math.round(Number(state.total) || 0), count })
      : null),
    creditsExtra: (state, helpers) => [...cauldronCredits(state, helpers), ...candyKingCredits(state, helpers)],
    celebrate() {
      batSwarm(150);
      sparkRing(300);
      sparkRing(1200);
    },
  });

  // ?demo=fx：面板預覽用，不接 Twitch 也能看到糖果、小幽靈、搗蛋幽靈與抽獎揭曉。
  if (demoMode === 'fx') {
    const DEMO_NAMES = ['要糖不搗蛋', '飄飄', '夜行蝙蝠', '南瓜頭', '黑貓魔女', '小熊軟糖', '月光', '巫婆湯'];
    const pick = () => DEMO_NAMES[Math.floor(Math.random() * DEMO_NAMES.length)];
    board = { top: [{ name: '小熊軟糖', treats: 12 }, { name: '飄飄', treats: 9 }, { name: '南瓜頭', treats: 7 }] };
    setInterval(() => queuePop({ kind: Math.random() < 0.6 ? 'treat' : 'trick', name: pick() }), 900);
    setTimeout(() => queuePrank({ name: pick() }), 1500);
    setInterval(() => queuePrank({ name: pick() }), 16000);
    setTimeout(() => revealRaffle({ winner: '黑貓魔女', poolSize: DEMO_NAMES.length, names: DEMO_NAMES }), 7000);
    setInterval(() => revealRaffle({ winner: pick(), poolSize: DEMO_NAMES.length, names: DEMO_NAMES }), 24000);
  }

  // ?demo=cauldron：模擬觀眾用點數丟材料，比例跟著變。
  if (demoMode === 'cauldron') {
    const NAMES = ['飄飄', '南瓜頭', '小熊軟糖', '月光', '巫婆湯', '夜行蝙蝠'];
    setInterval(() => {
      const ingredient = INGREDIENTS[Math.floor(Math.random() * INGREDIENTS.length)];
      demoCauldron.amounts[ingredient] += 6;
      queueDrop({ ingredient, name: NAMES[Math.floor(Math.random() * NAMES.length)], source: 'points' });
      renderCauldron(demoState({}));
      setProgress(Math.min(INGREDIENTS.reduce((sum, key) => sum + demoCauldron.amounts[key], 0) / 500, 1));
    }, 1400);
  }

  // ?demo=brew：熬煮動畫每 20 秒重播一次（第一次在載入 2 秒後）。
  if (demoMode === 'brew') {
    const replay = () => {
      demoCauldron.brew = null;
      renderCauldron(demoState({}));
      const amounts = demoCauldron.amounts;
      const total = INGREDIENTS.reduce((sum, key) => sum + amounts[key], 0);
      demoCauldron.brew = { at: Date.now(), winner: 'ghost', tie: null, reachedGoal: true,
        shares: Object.fromEntries(INGREDIENTS.map((key) => [key, amounts[key] / total])), totalShares: total };
      renderCauldron(demoState({}));
    };
    setTimeout(replay, 2000);
    setInterval(replay, 20000);
  }
})();
