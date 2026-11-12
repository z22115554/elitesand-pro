/**
 * 面板「訂閱與贈訂演出」：開關、音量，以及「演出與門檻」視窗（每一級的門檻、要用哪幾種演出、預覽）。
 *
 * - 設定以伺服器為準（overlay-show-settings.json 的 alerts 與 raid.mode），這裡不存在瀏覽器端（鐵則 4）。
 * - 演出清單讀 /alert-show/catalog.json（等級、每種演出的秒數）；名稱走翻譯表 alertShow.v.<等級>.<第幾種>。
 * - 預覽用內嵌的 /alert-show/stage.html，只在這個視窗播放；「在 OBS 試播」才走伺服器的演出佇列。
 */
(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const group = el('alert-show-group');
  const modal = el('alert-show-modal');
  if (!group || !modal || typeof SocketClient === 'undefined') return;

  const GIFT_STEPS = ['g5', 'g10', 'g25', 'g50', 'g100'];
  const RAID_STEPS = ['r2', 'r3', 'r4'];
  const PRESETS = {
    std: { giftMin: { g5: 5, g10: 10, g25: 25, g50: 50, g100: 100 }, raidMin: { r2: 10, r3: 50, r4: 200 } },
    small: { giftMin: { g5: 3, g10: 5, g25: 10, g50: 20, g100: 50 }, raidMin: { r2: 5, r3: 15, r4: 40 } },
  };
  const STAGE_URL = '/alert-show/stage.html';

  const fields = {
    sub: el('alert-show-sub-enabled'),
    gift: el('alert-show-gift-enabled'),
    volume: el('alert-show-volume'),
    volumeValue: el('alert-show-volume-value'),
  };
  const ui = {
    tabs: el('alert-show-tabs'),
    presets: el('alert-show-presets'),
    note: el('alert-show-note'),
    tiers: el('alert-show-tiers'),
    frame: el('alert-show-frame'),
    empty: el('alert-show-stage-empty'),
    now: el('alert-show-now'),
    name: el('alert-show-name'),
    replay: el('alert-show-replay'),
    obsTest: el('alert-show-obs-test'),
    character: el('alert-show-character'),
    girlState: el('alert-show-girl-state'),
    girlUpload: el('alert-show-girl-upload'),
    girlReset: el('alert-show-girl-reset'),
    faceCanvas: el('alert-show-face-canvas'),
    faceSize: el('alert-show-face-size'),
    charPreview: el('alert-show-char-preview'),
    mascotMode: el('alert-show-mascot-mode'),
    mascotCanvas: el('alert-show-mascot-canvas'),
    mascotUpload: el('alert-show-mascot-upload'),
    file: el('alert-show-file'),
  };

  let catalog = null;
  let settings = null;
  let activeGroup = 'gift';
  let selected = null;      // { tier, variant }：目前預覽的那一支
  let stageReady = false;
  let pendingPlay = null;
  let focusBefore = null;
  let nameTouched = false;

  function toast(message, type) {
    if (window.AppShared && typeof window.AppShared.showToast === 'function') window.AppShared.showToast(message, type);
  }

  // ─── 設定讀寫 ───

  function send(partial, done) {
    SocketClient.sendWithCallback('overlay-show:settings:update', partial, (result) => {
      if (!result?.ok) { toast(result?.error || t('overlayShow.saveFailed'), 'error'); if (settings) render(settings); return; }
      render(result.settings); // 伺服器夾過範圍後的值才是真值
      if (typeof done === 'function') done(result.settings);
    });
  }

  function load() {
    SocketClient.sendWithCallback('overlay-show:settings:get', {}, (result) => { if (result?.ok) render(result.settings); });
  }

  function render(next) {
    if (!next || !next.alerts) return;
    settings = next;
    if (next.alerts.character && !faceDirty) syncCharacterToStage();
    if (fields.sub) fields.sub.checked = !!next.alerts.subEnabled;
    if (fields.gift) fields.gift.checked = !!next.alerts.giftEnabled;
    if (fields.volume && document.activeElement !== fields.volume) fields.volume.value = next.alerts.volume;
    if (fields.volumeValue) fields.volumeValue.textContent = String(next.alerts.volume);
    if (!modal.hidden) renderTiers();
  }

  fields.sub?.addEventListener('change', () => send({ alerts: { subEnabled: fields.sub.checked } }));
  fields.gift?.addEventListener('change', () => send({ alerts: { giftEnabled: fields.gift.checked } }));
  fields.volume?.addEventListener('input', () => { if (fields.volumeValue) fields.volumeValue.textContent = fields.volume.value; });
  fields.volume?.addEventListener('change', () => send({ alerts: { volume: Number(fields.volume.value) } }));

  // ─── 「演出與門檻」視窗 ───

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function variantName(tierId, index) {
    const key = `alertShow.v.${tierId}.${index}`;
    const name = t(key);
    if (name && name !== key) return name;
    const tier = catalog?.tiers.find((item) => item.id === tierId);
    return tier?.variants[index]?.name || `${tierId} ${index + 1}`;
  }

  function tierMin(tierId) {
    if (!settings) return 1;
    if (tierId === 'sub') return 0;
    if (tierId === 'g1') return 1;
    if (tierId === 'r1') return Math.max(1, Number(settings.raid?.minViewers) || 1);
    return (tierId[0] === 'g' ? settings.alerts.giftMin : settings.alerts.raidMin)[tierId] || 1;
  }

  /** 這一級實際涵蓋的範圍文字，例如「5–9 份」「100 份以上」。 */
  function rangeText(tierId) {
    const steps = tierId[0] === 'g' ? ['g1', ...GIFT_STEPS] : ['r1', ...RAID_STEPS];
    const index = steps.indexOf(tierId);
    const from = tierMin(tierId);
    const next = index >= 0 && index < steps.length - 1 ? tierMin(steps[index + 1]) : null;
    const unit = t(tierId[0] === 'g' ? 'alertShow.unitGift' : 'alertShow.unitRaid');
    if (next == null) return t('alertShow.rangeUp', { from, unit });
    if (next - 1 <= from) return t('alertShow.rangeOne', { from, unit });
    return t('alertShow.range', { from, to: next - 1, unit });
  }

  function isOff(tierId, index) {
    return !!settings && settings.alerts.off.includes(`${tierId}:${index}`);
  }

  function renderTiers() {
    if (!catalog || !settings) return;
    ui.tabs.querySelectorAll('button').forEach((button) => {
      const on = button.dataset.group === activeGroup;
      button.classList.toggle('active', on);
      button.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const isCharacter = activeGroup === 'character';
    ui.tiers.hidden = isCharacter;
    ui.character.hidden = !isCharacter;
    if (isCharacter) {
      ui.presets.hidden = true;
      ui.note.hidden = true;
      renderCharacter();
      return;
    }
    ui.presets.hidden = activeGroup === 'sub';
    const raidCard = activeGroup === 'raid' && settings.raid?.mode !== 'show';
    ui.note.hidden = !raidCard;
    ui.note.textContent = raidCard ? t('alertShow.raidCardNote') : '';

    const keepFocus = document.activeElement && ui.tiers.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
    ui.tiers.textContent = '';
    catalog.tiers.filter((tier) => tier.group === activeGroup).forEach((tier) => {
      const section = node('section', 'alert-tier');
      const head = node('div', 'alert-tier-head');
      const title = node('div', 'alert-tier-title');
      title.appendChild(node('span', 'alert-tier-name', t(`alertShow.tier.${tier.id}`)));
      if (tier.group !== 'sub') title.appendChild(node('span', 'alert-tier-range', rangeText(tier.id)));
      head.appendChild(title);

      const steps = tier.group === 'gift' ? GIFT_STEPS : RAID_STEPS;
      if (steps.includes(tier.id)) {
        const label = node('label', 'alert-tier-min');
        label.appendChild(node('span', '', t('alertShow.minLabel')));
        const input = node('input', 'input');
        input.type = 'number'; input.min = '2'; input.max = '100000'; input.step = '1'; input.inputMode = 'numeric';
        input.value = String(tierMin(tier.id));
        input.dataset.focusKey = `min-${tier.id}`;
        input.addEventListener('change', () => {
          const key = tier.group === 'gift' ? 'giftMin' : 'raidMin';
          send({ alerts: { [key]: { ...settings.alerts[key], [tier.id]: Number(input.value) } } });
        });
        label.appendChild(input);
        label.appendChild(node('span', '', t(tier.group === 'gift' ? 'alertShow.unitGift' : 'alertShow.unitRaid')));
        head.appendChild(label);
      } else if (tier.id === 'r1') {
        head.appendChild(node('span', 'alert-tier-fixed', t('alertShow.raidMinFixed')));
      }
      section.appendChild(head);

      const list = node('ul', 'alert-variants');
      tier.variants.forEach((variant) => {
        const item = node('li', 'alert-variant');
        if (selected && selected.tier === tier.id && selected.variant === variant.index) item.classList.add('is-selected');
        const label = node('label', 'alert-variant-check');
        const box = node('input');
        box.type = 'checkbox';
        box.checked = !isOff(tier.id, variant.index);
        box.dataset.focusKey = `v-${tier.id}-${variant.index}`;
        box.addEventListener('change', () => toggleVariant(tier, variant.index, box));
        label.appendChild(box);
        label.appendChild(node('span', 'alert-variant-name', variantName(tier.id, variant.index)));
        item.appendChild(label);
        item.appendChild(node('span', 'alert-variant-dur', t('alertShow.seconds', { n: variant.dur.toFixed(1) })));
        const preview = node('button', 'btn btn-sm btn-ghost', t('alertShow.preview'));
        preview.type = 'button';
        preview.dataset.focusKey = `p-${tier.id}-${variant.index}`;
        preview.setAttribute('aria-label', `${t('alertShow.preview')}：${variantName(tier.id, variant.index)}`);
        preview.addEventListener('click', () => previewVariant(tier.id, variant.index));
        item.appendChild(preview);
        list.appendChild(item);
      });
      section.appendChild(list);
      ui.tiers.appendChild(section);
    });
    if (keepFocus) ui.tiers.querySelector(`[data-focus-key="${keepFocus}"]`)?.focus();
  }

  function toggleVariant(tier, index, box) {
    const off = new Set(settings.alerts.off);
    const key = `${tier.id}:${index}`;
    if (box.checked) off.delete(key); else off.add(key);
    if (tier.variants.every((variant) => off.has(`${tier.id}:${variant.index}`))) {
      box.checked = true; // 每一級至少留一種，不然這一級收到時沒東西可演
      toast(t('alertShow.keepOne'), 'error');
      return;
    }
    send({ alerts: { off: [...off] } });
  }

  function applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    send({ alerts: { giftMin: { ...preset.giftMin }, raidMin: { ...preset.raidMin } } }, () => toast(t('alertShow.presetApplied'), 'success'));
  }

  // ─── 預覽舞台 ───

  function postToStage(message) {
    if (!ui.frame.contentWindow) return;
    ui.frame.contentWindow.postMessage({ target: 'alert-show-stage', ...message }, window.location.origin);
  }

  function ensureStage() {
    if (ui.frame.getAttribute('src')) return;
    stageReady = false;
    ui.frame.setAttribute('src', STAGE_URL);
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || event.source !== ui.frame.contentWindow) return;
    const data = event.data;
    if (!data || data.source !== 'alert-show-stage') return;
    if (data.type === 'ready') {
      stageReady = true;
      lastStageCharacterKey = '';
      syncCharacterToStage();
      if (pendingPlay) { postToStage(pendingPlay); pendingPlay = null; }
    }
  });

  function previewName() {
    const value = (ui.name.value || '').trim();
    return value || t('alertShow.sampleName');
  }

  function previewVariant(tierId, index) {
    selected = { tier: tierId, variant: index };
    ui.empty.hidden = true;
    ui.replay.disabled = false;
    ui.obsTest.disabled = false;
    const count = tierMin(tierId);
    ui.now.textContent = tierId === 'sub'
      ? `${t(`alertShow.tier.${tierId}`)} · ${variantName(tierId, index)}`
      : `${t(`alertShow.tier.${tierId}`)} · ${variantName(tierId, index)} · ${count} ${t(tierId[0] === 'g' ? 'alertShow.unitGift' : 'alertShow.unitRaid')}`;
    ui.tiers.querySelectorAll('.alert-variant.is-selected').forEach((item) => item.classList.remove('is-selected'));
    ui.tiers.querySelector(`[data-focus-key="p-${tierId}-${index}"]`)?.closest('.alert-variant')?.classList.add('is-selected');
    const command = {
      type: 'play',
      id: `preview-${Date.now()}`,
      tier: tierId,
      variant: index,
      n: count,
      name: previewName(),
      lang: window.I18n && typeof window.I18n.current === 'function' ? window.I18n.current() : 'zh-TW',
      volume: (settings ? settings.alerts.volume : 70) / 100,
    };
    ensureStage();
    if (stageReady) postToStage(command); else pendingPlay = command;
  }

  function testOnObs() {
    if (!selected) return;
    SocketClient.sendWithCallback('overlay-show:test', {
      kind: 'alert', tier: selected.tier, variant: selected.variant, count: tierMin(selected.tier), name: previewName(),
    }, (result) => {
      if (!result?.ok) toast(result?.error || t('overlayShow.testFailed'), 'error');
      else toast(t('alertShow.obsTestSent'), 'success');
    });
  }

  // ─── 開關視窗 ───

  function loadCatalog() {
    if (catalog) return Promise.resolve(catalog);
    return fetch('/alert-show/catalog.json', { cache: 'no-store' })
      .then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.json(); })
      .then((data) => { catalog = data; return data; });
  }

  function open() {
    focusBefore = document.activeElement;
    if (modal.parentElement !== document.body) document.body.appendChild(modal);
    if (!nameTouched) ui.name.value = t('alertShow.sampleName');
    modal.hidden = false;
    loadCatalog().then(() => { load(); renderTiers(); }).catch(() => toast(t('alertShow.catalogFailed'), 'error'));
    window.setTimeout(() => el('alert-show-modal-title')?.focus(), 0);
  }

  // ─── 角色圖（角色、吉祥物）───
  //
  // 上傳前在這裡先處理：裁掉透明邊（跟引擎的 trimmed() 同一套門檻，臉的位置才對得上）、
  // 長邊縮到 GIRL_MAX／MASCOT_MAX、轉成 WebP。沒有透明背景的圖直接擋下，免得直播畫面出現一個方框。

  const GIRL_MAX = 1600;
  const MASCOT_MAX = 900;
  const DEFAULT_FACE = { x: 0.49, y: 0.15, s: 0.12 };
  const imageCache = new Map(); // url -> Promise<裁好透明邊的 canvas|null>
  let faceDraft = null;          // 拖動／點擊中還沒存進伺服器的臉部位置
  let faceDirty = false;
  let faceTimer = 0;
  let uploadKind = 'girl';
  let busy = false;
  let lastStageCharacterKey = '';

  function character() {
    const c = settings?.alerts?.character;
    return c ? { ...c, face: faceDraft || c.face } : { girl: 'default', mascot: 'default', face: DEFAULT_FACE, rev: 0 };
  }

  function imageUrl(kind, c) {
    const mode = c[kind];
    if (mode === 'custom') return `/alert-show/custom/${kind}?rev=${c.rev || 0}`;
    return `/alert-show/assets/${kind}.webp`;
  }

  function trimCanvas(source, width, height) {
    const work = document.createElement('canvas');
    work.width = width; work.height = height;
    const ctx = work.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    let x0 = width, y0 = height, x1 = -1, y1 = -1, see = 0;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const a = data[(y * width + x) * 4 + 3];
        if (a < 20) { see += 1; continue; }
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return { canvas: null, transparent: true, empty: true };
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 2; out.height = y1 - y0 + 2;
    out.getContext('2d').drawImage(work, -x0, -y0);
    return { canvas: out, transparent: see > 0, empty: false };
  }

  function loadTrimmed(url) {
    if (!imageCache.has(url)) {
      imageCache.set(url, new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(trimCanvas(img, img.naturalWidth, img.naturalHeight).canvas);
        img.onerror = () => resolve(null);
        img.src = url;
      }));
    }
    return imageCache.get(url);
  }

  function drawContain(canvas, img) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!img) return null;
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    const w = img.width * scale, h = img.height * scale, x = (canvas.width - w) / 2, y = (canvas.height - h) / 2;
    ctx.drawImage(img, x, y, w, h);
    return { x, y, w, h };
  }

  let faceBox = null; // 角色圖畫在縮圖上的位置，點擊換算用

  function renderFace() {
    const c = character();
    loadTrimmed(imageUrl('girl', c)).then((img) => {
      const canvas = ui.faceCanvas;
      if (img) {
        // 縮圖框跟著圖的比例走，圖小時不留大片空白
        const ratio = img.height / img.width;
        const height = Math.round(Math.min(560, Math.max(260, 360 * ratio)));
        if (canvas.height !== height) canvas.height = height;
      }
      faceBox = drawContain(canvas, img);
      if (!faceBox) return;
      const f = character().face;
      const ctx = canvas.getContext('2d');
      const cx = faceBox.x + f.x * faceBox.w, cy = faceBox.y + f.y * faceBox.h, r = f.s * faceBox.h * 0.95;
      ctx.save();
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = '#E9B949'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#E9B949'; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
  }

  function renderMascot() {
    const c = character();
    ui.mascotMode.querySelectorAll('button[data-mascot]').forEach((button) => {
      const on = button.dataset.mascot === c.mascot;
      button.classList.toggle('active', on);
      button.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    ui.mascotUpload.hidden = c.mascot !== 'custom';
    if (c.mascot === 'none') { drawContain(ui.mascotCanvas, null); return; }
    loadTrimmed(imageUrl('mascot', c)).then((img) => drawContain(ui.mascotCanvas, img));
  }

  function renderCharacter() {
    const c = character();
    ui.girlState.textContent = t(c.girl === 'custom' ? 'alertShow.charStateCustom' : 'alertShow.charStateDefault');
    ui.girlReset.hidden = c.girl !== 'custom';
    if (document.activeElement !== ui.faceSize) ui.faceSize.value = String(c.face.s);
    [ui.girlUpload, ui.girlReset, ui.mascotUpload].forEach((button) => { button.disabled = busy; });
    renderFace();
    renderMascot();
  }

  /** 把角色設定送給預覽框（同一組設定只送一次）。 */
  function syncCharacterToStage() {
    if (!stageReady) return;
    const c = character();
    const key = JSON.stringify(c);
    if (key === lastStageCharacterKey) return;
    lastStageCharacterKey = key;
    postToStage({ type: 'character', character: c });
  }

  function setFace(next) {
    const cur = character().face;
    faceDraft = {
      x: Math.round(Math.max(0, Math.min(1, next.x ?? cur.x)) * 1000) / 1000,
      y: Math.round(Math.max(0, Math.min(1, next.y ?? cur.y)) * 1000) / 1000,
      s: Math.round(Math.max(0.05, Math.min(0.35, next.s ?? cur.s)) * 1000) / 1000,
    };
    faceDirty = true;
    renderFace();
    postToStage({ type: 'face', face: faceDraft });
    clearTimeout(faceTimer);
    faceTimer = setTimeout(() => {
      const face = faceDraft;
      send({ alerts: { character: { face } } }, () => { faceDirty = false; faceDraft = null; syncCharacterToStage(); });
    }, 300);
  }

  ui.faceCanvas.addEventListener('click', (event) => {
    if (!faceBox) return;
    const rect = ui.faceCanvas.getBoundingClientRect();
    const px = (event.clientX - rect.left) * (ui.faceCanvas.width / rect.width);
    const py = (event.clientY - rect.top) * (ui.faceCanvas.height / rect.height);
    setFace({ x: (px - faceBox.x) / faceBox.w, y: (py - faceBox.y) / faceBox.h });
  });
  ui.faceCanvas.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 0.03 : 0.006;
    const f = character().face;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setFace({ x: f.x + move[0], y: f.y + move[1] });
  });
  ui.faceSize.addEventListener('input', () => setFace({ s: Number(ui.faceSize.value) }));
  ui.charPreview.addEventListener('click', () => previewVariant('g10', 3)); // VS 對決：結尾有大張臉部特寫

  function pickFile(kind) {
    if (busy) return;
    uploadKind = kind;
    ui.file.value = '';
    ui.file.click();
  }

  function encode(canvas) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (blob && blob.type === 'image/webp') resolve(blob);
        else canvas.toBlob(resolve, 'image/png'); // 少數環境不支援輸出 WebP
      }, 'image/webp', 0.92);
    });
  }

  async function prepareUpload(file, kind) {
    if (!/^image\/(png|webp)$/.test(file.type)) throw new Error(t('alertShow.charBadType'));
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) throw new Error(t('alertShow.charBadType'));
    const limit = kind === 'girl' ? GIRL_MAX : MASCOT_MAX;
    // 原圖太大時先縮到兩倍上限再裁，免得手機拍的超大圖把面板卡住
    const pre = Math.min(1, (limit * 2) / Math.max(bitmap.width, bitmap.height));
    const trimmed = trimCanvas(bitmap, Math.round(bitmap.width * pre), Math.round(bitmap.height * pre));
    bitmap.close?.();
    if (trimmed.empty) throw new Error(t('alertShow.charEmpty'));
    if (!trimmed.transparent) throw new Error(t('alertShow.charNoAlpha'));
    const src = trimmed.canvas;
    const scale = Math.min(1, limit / Math.max(src.width, src.height));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(src.width * scale));
    out.height = Math.max(1, Math.round(src.height * scale));
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, out.width, out.height);
    return { blob: await encode(out), width: out.width, height: out.height };
  }

  /** 新圖的臉先猜一個位置：直長的全身圖臉在上面，接近正方形的半身圖臉在中上。 */
  function guessFace(width, height) {
    const tall = height / width;
    return tall > 1.25 ? { x: 0.5, y: 0.13, s: 0.11 } : { x: 0.5, y: 0.3, s: 0.2 };
  }

  ui.file.addEventListener('change', async () => {
    const file = ui.file.files && ui.file.files[0];
    if (!file) return;
    const kind = uploadKind;
    busy = true;
    renderCharacter();
    toast(t('alertShow.charUploading'));
    try {
      const prepared = await prepareUpload(file, kind);
      const form = new FormData();
      form.append('image', prepared.blob, `${kind}.${prepared.blob.type === 'image/webp' ? 'webp' : 'png'}`);
      const response = await PinAuth.fetchWithPin(`/api/alert-show/character/${kind}`, { method: 'POST', body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error || t('alertShow.charUploadFailed'));
      imageCache.clear();
      const patch = kind === 'girl'
        ? { girl: 'custom', rev: result.rev, face: guessFace(prepared.width, prepared.height) }
        : { mascot: 'custom', rev: result.rev };
      faceDraft = null; faceDirty = false;
      send({ alerts: { character: patch } }, () => {
        toast(t(kind === 'girl' ? 'alertShow.charUploaded' : 'alertShow.charMascotUploaded'), 'success');
        if (kind === 'girl') ui.faceCanvas.focus();
        previewVariant(kind === 'girl' ? 'g10' : 'g25', kind === 'girl' ? 3 : 1);
      });
    } catch (err) {
      toast((err && err.message) || t('alertShow.charUploadFailed'), 'error');
    } finally {
      busy = false;
      ui.file.value = '';
      renderCharacter();
    }
  });

  ui.girlUpload.addEventListener('click', () => pickFile('girl'));
  ui.mascotUpload.addEventListener('click', () => pickFile('mascot'));
  ui.girlReset.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    try {
      await PinAuth.fetchWithPin('/api/alert-show/character/girl', { method: 'DELETE' }).catch(() => null);
      imageCache.clear();
      faceDraft = null; faceDirty = false;
      send({ alerts: { character: { girl: 'default', face: { ...DEFAULT_FACE } } } });
    } finally {
      busy = false;
      renderCharacter();
    }
  });
  ui.mascotMode.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-mascot]');
    if (!button || busy) return;
    const mode = button.dataset.mascot;
    if (mode !== 'custom') { send({ alerts: { character: { mascot: mode } } }); return; }
    // 自訂：之前上傳過就直接用，沒有就請使用者選一張
    const head = await fetch(`/alert-show/custom/mascot?rev=${Date.now()}`, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
    if (head && head.ok) send({ alerts: { character: { mascot: 'custom' } } });
    else pickFile('mascot');
  });

  function close() {
    if (modal.hidden) return;
    modal.hidden = true;
    pendingPlay = null;
    postToStage({ type: 'stop' }); // 關掉視窗就停，聲音不要繼續播
    selected = null;               // 下次打開從「還沒選」開始，不留著上一支的說明文字
    ui.now.textContent = '';
    ui.empty.hidden = false;
    ui.replay.disabled = true;
    ui.obsTest.disabled = true;
    (focusBefore && focusBefore.isConnected ? focusBefore : el('alert-show-open'))?.focus();
  }

  el('alert-show-open')?.addEventListener('click', open);
  el('alert-show-close')?.addEventListener('click', close);
  modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
  modal.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
  ui.tabs.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-group]');
    if (!button) return;
    activeGroup = button.dataset.group;
    renderTiers();
  });
  el('alert-show-preset-std')?.addEventListener('click', () => applyPreset('std'));
  el('alert-show-preset-small')?.addEventListener('click', () => applyPreset('small'));
  ui.name.addEventListener('input', () => { nameTouched = true; });
  ui.replay.addEventListener('click', () => { if (selected) previewVariant(selected.tier, selected.variant); });
  ui.obsTest.addEventListener('click', testOnObs);

  SocketClient.on('overlay-show:settings', render);
  SocketClient.on('connection-change', (connected) => { if (connected) load(); });
  window.addEventListener('i18n:change', () => {
    if (!nameTouched) ui.name.value = t('alertShow.sampleName');
    if (!modal.hidden) renderTiers();
  });
  load();
})();
