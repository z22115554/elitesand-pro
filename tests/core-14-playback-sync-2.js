'use strict';

// 核心回歸測試（playback-sync-2）。由 tests/run-tests.js 依序載入，不要單獨執行。
const {
  fs,
  readApiRoutesSource,
  path,
  os,
  vm,
  TEST_RUNTIME_ROOT,
  TEST_RUNTIME_DIRS,
  test,
  testAsync,
  eq,
  ok,
} = require('./core-harness');
const { spawnSync: spawnStateStore } = require('child_process');
const AudioProcessor = require('../server/services/audio-processor');
const { runStateStoreChild } = require('./core-harness').shared;

test('打字機模板：registry 時間驅動、完整接入設定／伺服器白名單／i18n', () => {
  const displayHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'display.html'), 'utf8');
  const panelHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const controllerHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'controller.html'), 'utf8');
  const templateJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-template-typewriter.js'), 'utf8');
  const displayCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'display.css'), 'utf8');
  const lyricExtras = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-extras.js'), 'utf8');
  const lyricsHandler = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'handlers', 'lyrics.js'), 'utf8');
  const appState = fs.readFileSync(path.join(__dirname, '..', 'server', 'state', 'app-state.js'), 'utf8');
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'i18n.js'), 'utf8');
  const displayJsSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'display.js'), 'utf8');

  ok(displayHtml.includes('/js/lyric-template-typewriter.js'), 'display 必須載入打字機模板腳本: ');
  ok(templateJs.includes("id: 'typewriter'") && templateJs.includes('onFrame(timeMs, ctx)') && templateJs.includes('onSeek(timeMs, ctx)'), '打字機必須透過 registry 並完全時間驅動: ');
  ok(templateJs.includes('ensureWordTimings') && templateJs.includes('buildGraphemeTimings') && templateJs.includes('per = (next - start)'), '打字機必須沿用逐字時間、缺時退回整句線性: ');
  ok(templateJs.includes("classList.toggle('on', i < n)") && templateJs.includes("classList.toggle('tw-done'"), '打字機必須逐字揭露且整句打完會標記 tw-done（收游標）: ');
  ok(displayCss.includes('#typewriter-root {') && displayCss.includes('.tw-caret {') && displayCss.includes('.tw-bubble.tw-done .tw-caret { display: none; }'), 'display.css 必須有打字機泡泡與游標樣式，打完收游標: ');
  const transformNoneGroup = (displayCss.match(/([^}]*)\{\s*transform:\s*none;\s*\}/) || [])[1] || '';
  ok(transformNoneGroup.includes('body.template-typewriter #lyrics-container'),
    '打字機是固定構圖模板，#lyrics-container 必須列入 transform: none: ');
  ok(lyricExtras.includes("typewriter: { label: '對話氣泡'") && lyricExtras.includes("template: 'typewriter'"), '桌面設定必須提供打字機能力與獨立預設: ');
  ok(lyricsHandler.includes("'mirror', 'typewriter'"), 'server 模板白名單必須接受 typewriter: ');
  ok(appState.includes("typewriter: { template: 'typewriter'"), 'server 預設 lyricTemplateSettings 必須包含 typewriter: ');
  ok(i18n.includes("'template.typewriter':"), '打字機模板名稱必須有五語 i18n key: ');
  ok(panelHtml.includes('data-template="typewriter"') && controllerHtml.includes('class="ctrl-template-btn" data-template="typewriter"'), '桌面與手機模板選擇器都要有打字機卡片: ');
  // 聊天室：已唱不消失、往上疊（不再逐顆淡出移除）
  ok(templateJs.includes("id = 'typewriter-root'") && templateJs.includes('KEEP = 16') && !templateJs.includes('GONE_REMOVE_MS'), '打字機必須是往上疊的聊天室（保留多顆泡泡、不逐顆移除）: ');
  // 靠邊：1–5 句一段隨機；合唱歌曲一邊代表一個聲部
  ok(templateJs.includes('RUN_MIN = 1') && templateJs.includes('RUN_SPAN = 5'), '打字機左右分散必須是 1–5 句一段: ');
  ok(templateJs.includes("return 'duet'") && templateJs.includes("s !== 'both'") && templateJs.includes('duetMap'), '合唱歌曲必須一邊固定代表一個聲部: ');
  // 同時唱的兩句（不同聲部、時間重疊／同時起唱）→ 兩顆泡泡同時上、各自逐字（KTV 式雙排同時掃）
  ok(templateJs.includes('function concurrentNext') && templateJs.includes('CONCURRENT_ONSET_MS')
    && templateJs.includes('pairMate') && templateJs.includes('function sealTail')
    && templateJs.includes('function pairEndMs'),
    '對話氣泡：同時唱的兩句必須配成一組、同時出現、各自逐字（不先打完一句再打下一句）: ');
  ok(/paintEntry\(last\.pairMate, t\)/.test(templateJs) && templateJs.includes('endHint'),
    '同組兩句每幀都要一起逐字，且第一句的字距要攤在整組唱段內（不被夥伴句起點壓縮）: ');
  ok(templateJs.includes('dataset.lyricPos'), '非合唱必須吃面板「歌詞位置」決定全左／全右／左右分散: ');
  // 面板可調：泡泡底色、邊距、靠邊方式
  ok(displayCss.includes('var(--tw-bubble-right') && displayCss.includes('var(--tw-bubble-left') && displayCss.includes('var(--lyric-padding-x'), 'display.css 泡泡底色與左右邊距必須吃 CSS 變數: ');
  // 換行時泡泡內文要貼齊自己那一側；預設會繼承 --lyric-text-align 的置中，很醜
  ok(/\.tw-bubble\.tw-left\s*\{[^}]*text-align:\s*left/.test(displayCss)
    && /\.tw-bubble\.tw-right\s*\{[^}]*text-align:\s*right/.test(displayCss),
    '打字機泡泡換行時必須左側置左、右側置右，不可置中: ');
  ok(displayJsSrc.includes("'--tw-bubble-right'") && displayJsSrc.includes("'--tw-bubble-left'"), 'display.js 必須把泡泡底色寫成 CSS 變數: ');
  ok(lyricExtras.includes("key: 'twBubbleRight'") && lyricExtras.includes("key: 'twBubbleLeft'") && lyricExtras.includes("twBubbleRight: '#0b93f6'"), '桌面設定必須提供左右泡泡底色控制與預設: ');
  ok(lyricExtras.includes('typewriter-colors-field') && lyricExtras.includes('!isTypewriter'), '泡泡底色欄位必須只在打字機時顯示: ');
  ok(panelHtml.includes('id="typewriter-colors-field"') && panelHtml.includes('id="ls-tw-bubble-right"') && panelHtml.includes('id="ls-tw-bubble-left"'), 'index.html 必須有打字機泡泡底色欄位: ');
  ok(appState.includes("lyricPosition: 'split'") && /typewriter: \{ template: 'typewriter'[^}]*twBubbleRight/.test(appState), 'server 預設必須含打字機靠邊與泡泡底色: ');
  // 左右邊距挪到「歌詞位置」下面、且打字機沒有「置中」靠邊
  ok(panelHtml.includes('id="typewriter-padding-field"') && panelHtml.includes('id="ls-tw-padding-x"'), '打字機的左右邊距必須拉到主設定頁「歌詞位置」下面: ');
  ok(panelHtml.includes('id="padding-x-field"') && lyricExtras.includes("getElementById('padding-x-field')") && lyricExtras.includes('modalPaddingXField.hidden = isTypewriter'), '打字機時詳細設定裡的左右邊距必須收起（挪走不是複製）: ');
  ok(lyricExtras.includes('data-lyric-pos="center"]') && lyricExtras.includes('posCenterBtn.hidden = isTypewriter'), '打字機的靠邊選擇不可有「置中」: ');
  ok(lyricExtras.includes("out.typewriter.lyricPosition === 'center'") && lyricExtras.includes("settings.template === 'typewriter' && settings.lyricPosition === 'center'"), '舊快照存了 center 必須被歸成 split: ');
  // 向內（往中央）可調範圍放寬 — 所有舞台模板一起
  ok(lyricExtras.includes('STAGE_OFFSET_X_INWARD = 700'), '舞台模板向內位移範圍必須放寬到 700: ');
  // 底部進度條開關（放在「歌詞顯示模式」）
  ok(lyricExtras.includes('showProgressBar: true') && lyricExtras.includes("bindGlobalToggle('ls-progress-bar', 'showProgressBar')"), '底部進度條必須有設定鍵與控制項: ');
  ok(panelHtml.includes('id="ls-progress-bar"') && panelHtml.includes('底部進度條'), 'index.html「歌詞顯示模式」必須有底部進度條開關: ');
  ok(displayJsSrc.includes("obsProgressBar") && displayJsSrc.includes("s.showProgressBar === false"), 'display.js 必須依 showProgressBar 顯示／隱藏底部進度條: ');
  // 2026-09-18 回報：切換歌詞動畫（模板）後簡轉繁／底部進度條會跟著變。根因是這兩個鍵混進
  // per-template 的 DEFAULT_SETTINGS/CONTROLS，selectTemplate() 整包替換 settings 時被覆蓋。
  // 修法：獨立成 globalDisplaySettings，不隨模板切換，也不進 templateSettings[tpl] 快照。
  ok(!lyricExtras.includes("key: 'showProgressBar'") && !lyricExtras.includes("key: 'convertTraditional'"),
    '簡轉繁／底部進度條不可再掛在 per-template 的 CONTROLS 陣列上（會被切模板覆蓋）: ');
  ok(lyricExtras.includes('let globalDisplaySettings = { convertTraditional: true, showProgressBar: true }')
    && lyricExtras.includes("function bindGlobalToggle(id, key)")
    && lyricExtras.includes("bindGlobalToggle('ls-traditional', 'convertTraditional')"),
    '簡轉繁／底部進度條必須是獨立於 per-template settings 的全域狀態: ');
  {
    // 模板切換已抽成模組層級的單一入口（快捷模板、模板畫廊共用）
    const selectTemplateStart = lyricExtras.indexOf('function selectTemplate(nextTemplate');
    const selectTemplateEnd = lyricExtras.indexOf('function visibleTemplateIds()', selectTemplateStart);
    const selectTemplateSrc = selectTemplateStart >= 0 && selectTemplateEnd > selectTemplateStart
      ? lyricExtras.slice(selectTemplateStart, selectTemplateEnd) : '';
    ok(selectTemplateSrc.length > 0
      && !selectTemplateSrc.includes('convertTraditional') && !selectTemplateSrc.includes('showProgressBar'),
      'selectTemplate() 整包替換 settings 時不可牽動簡轉繁／底部進度條: ');
  }
  ok(lyricExtras.includes('const merged = { ...s, ...globalDisplaySettings };'),
    '預覽 iframe 也要拿到通用設定，不能因為它們不在 per-template settings 裡就漏送: ');

  // ── 對話氣泡：長間奏跳貼圖（支援透明 PNG／GIF；內建三張；可上傳／刪除）──
  ok(templateJs.includes('function maybePlaceStickers') && templateJs.includes('function buildSticker')
    && templateJs.includes('function refreshStickerPool') && templateJs.includes("fetch('/api/typewriter-stickers')"),
    '對話氣泡必須有長間奏貼圖：偵測冷場、抓圖庫、塞無底框貼圖: ');
  ok(templateJs.includes('stickerGapMs()') && templateJs.includes('lineEndEstMs(lines, li)')
    && templateJs.includes("gap >= Math.max(12000, gapMs * 2) ? 2 : 1"),
    '貼圖必須依「下一句時間 − 這句估計唱完」判斷長間奏，很長的間奏跳兩張: ');
  ok(templateJs.includes('isSticker: true') && templateJs.includes('stickerPlaced')
    && templateJs.includes('hash32(li * 131 + 977) % stickerPool.length')
    && templateJs.includes('第二張避開第一張'),
    '貼圖必須併進 entries 一起往上疊／prune，依間奏序穩定抽（seek 一致），第二張避開第一張: ');
  ok(/\.tw-bubble\.tw-sticker\s*\{[^}]*background:\s*none/.test(displayCss)
    && displayCss.includes('.tw-sticker-img'),
    '間奏貼圖必須無底框、只顯示圖本身（透明直接透出）: ');
  ok(fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'typewriter-stickers', 'sticker-01.gif'))
    && fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'typewriter-stickers', 'sticker-03.gif')),
    '內建三張間奏貼圖必須隨程式打包: ');
  const apiSrc = readApiRoutesSource();
  ok(apiSrc.includes("router.post('/typewriter-stickers'") && apiSrc.includes("router.delete('/typewriter-stickers/:id'")
    && apiSrc.includes('stickerUpload') && /fileSize:\s*8\s*\*\s*1024\s*\*\s*1024/.test(apiSrc),
    'server 必須有貼圖上傳（8MB 上限、requirePin）與刪除端點: ');
  // 內建貼圖可個別隱藏（不刪檔，記在 dataDir 的 hidden 清單）＋ reset 端點全部找回
  ok(apiSrc.includes('typewriter-stickers-hidden.json') && apiSrc.includes('readHiddenBuiltinStickers')
    && apiSrc.includes("router.post('/typewriter-stickers/reset-builtin'")
    && apiSrc.includes('builtinStickerFilenames().includes(safeName)'),
    'DELETE 內建貼圖只加進 hidden 清單、reset-builtin 端點清空清單找回: ');
  ok(apiSrc.includes('builtinHiddenCount') && /listBuiltinStickers[\s\S]{0,200}id:\s*n/.test(apiSrc),
    'GET 回傳的 builtin 改成 {id,url} 並帶 builtinHiddenCount，供面板顯示「還原」鈕: ');
  ok(lyricExtras.includes("'/api/typewriter-stickers/reset-builtin'") && lyricExtras.includes('tw-sticker-reset')
    && lyricExtras.includes('data.builtinHiddenCount > 0'),
    '面板必須能拿掉內建貼圖並在有隱藏時顯示「還原內建貼圖」鈕: ');
  ok(panelHtml.includes('id="tw-sticker-reset"'), 'index.html 必須有「還原內建貼圖」按鈕: ');
  ok(!/is-builtin \.tw-sticker-del\s*\{\s*display:\s*none/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'panel.css'), 'utf8')),
    '內建貼圖的 ✕ 鈕不可再被 CSS 藏起來: ');
  const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  ok(indexSrc.includes("app.get('/typewriter-sticker/:filename'") && indexSrc.includes('startsWith(stickersDir + path.sep)'),
    'server 必須靜態送出自訂貼圖並擋路徑穿越: ');
  ok(lyricExtras.includes("twStickerEnabled: true") && lyricExtras.includes("twStickerGapMs: 6000")
    && lyricExtras.includes("key: 'twStickerEnabled'") && lyricExtras.includes('function initTypewriterStickerControls'),
    '桌面設定必須有貼圖開關／門檻／圖庫管理: ');
  ok(panelHtml.includes('id="tw-sticker-field"') && panelHtml.includes('id="tw-sticker-gallery"')
    && panelHtml.includes('id="ls-tw-sticker-gap"'),
    'index.html 必須有對話氣泡的貼圖欄位（開關／門檻／圖庫）: ');
  ok(templateJs.includes("key: 'twStickerEnabled'") && templateJs.includes("target: 'data:twStickerEnabled'")
    && templateJs.includes("key: 'twStickerGapMs'") && templateJs.includes("target: 'data:twStickerGapMs'")
    && displayJsSrc.includes('LyricTemplateSettings.apply(s)'),
    '貼圖開關／門檻必須由 typewriter 的 settings schema 宣告，經 LyricTemplateSettings 寫進 body.dataset: ');
  ok(lyricsHandler.includes('settings.twStickerEnabled = !!settings.twStickerEnabled')
    && lyricsHandler.includes('Math.max(3000, Math.min(20000'),
    'server 必須把貼圖開關布林化、門檻夾在 3–20 秒: ');
});

test('季節限定模板下架：選單藏起來、伺服器不接受、舊存檔換回預設、模板自己的設定保留', () => {
  const root = path.join(__dirname, '..');
  const seasonal = require('../server/utils/seasonal-templates');
  ok(seasonal.isTemplateOff('spellbook'), '萬聖咒字目前必須在下架清單: ');
  ok(!seasonal.isTemplateOff('classic') && !seasonal.isTemplateOff(undefined), '一般模板與空值不可被當成下架: ');
  ok(seasonal.resolveTemplateId('spellbook') === 'classic' && seasonal.resolveTemplateId('pulse') === 'pulse',
    '下架模板換回 classic，其他模板原樣: ');
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  ok(read('server/routes/handlers/lyrics.js').includes('if (isTemplateOff(settings.template)) settings.template = resolveTemplateId(settings.template);'),
    'lyric-settings:update 必須擋下架模板: ');
  ok(read('server/state/app-state.js').includes('isTemplateOff(playState.lyricSettings.template)'),
    '載入舊存檔時必須把下架模板換回預設: ');
  ok(/data-template="spellbook" data-seasonal-off hidden/.test(read('public/index.html'))
    && /data-template="spellbook" data-seasonal-off hidden/.test(read('public/controller.html')),
    '面板與手機的萬聖咒字選項必須標 data-seasonal-off 並隱藏: ');
  // 只換 template，不碰 lyricTemplateSettings.spellbook：明年重新開放時使用者的調整還在
  ok(!read('server/state/app-state.js').includes('lyricTemplateSettings.spellbook'), '不可刪掉模板自己的設定: ');
});

test('萬聖咒字：七種逐字效果一個模板、時間驅動、吃通用設定並接齊面板／手機／伺服器', () => {
  const root = path.join(__dirname, '..');
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const tpl = read('public/js/lyric-template-spellbook.js');
  const effects = ['rune', 'ouija', 'bats', 'drip', 'talisman', 'moon', 'thread', 'cycle'];
  let registered = null;
  require('vm').runInNewContext(tpl, { LyricTemplates: { register(o) { registered = o; } } });
  ok(registered && registered.id === 'spellbook', '模板必須以 id spellbook 註冊: ');
  ok(typeof registered.onFrame === 'function' && typeof registered.onSeek === 'function' && typeof registered.onSettings === 'function',
    '必須完全時間驅動（onFrame／onSeek），並從 onSettings 讀通用位置設定: ');
  const effectField = (registered.settings || []).find((f) => f.key === 'spellbookEffect');
  const posField = (registered.settings || []).find((f) => f.key === 'spellbookPosition');
  ok(effectField && JSON.stringify(effectField.values) === JSON.stringify(effects) && effectField.default === 'rune',
    '逐字效果選項必須是七種＋每句輪替，預設魔法陣: ');
  ok(posField && JSON.stringify(posField.values) === JSON.stringify(['bottom', 'middle', 'top']), '上下位置只收下方／中央／上方: ');
  ok(tpl.includes('ensureWordTimings') && tpl.includes('buildGraphemeTimings'), '逐字時間必須沿用動態核心: ');
  ok(!/setInterval\(|setTimeout\(/.test(tpl), '不可自己開計時器，畫面一律由 onFrame 的時間算出: ');
  ['--display-font-family', '--display-font-size', '--display-font-weight', '--lyric-letter-spacing', '--lyric-color', '--lyric-color-active']
    .forEach((v) => ok(tpl.includes(v), `必須吃通用外觀變數 ${v}: `));
  ok(tpl.includes("p === 'split'") && tpl.includes('settings.offsetX') && tpl.includes('settings.paddingX') && tpl.includes('lyricIntensity'),
    '必須吃通用的左右位置（含左右分散）、位置微調、左右邊距與動畫強度: ');

  const lyricsHandler = read('server/routes/handlers/lyrics.js');
  const appState = read('server/state/app-state.js');
  const lyricExtras = read('public/js/lyric-extras.js');
  const panelHtml = read('public/index.html');
  const controllerHtml = read('public/controller.html');
  const controllerJs = read('public/js/controller.js');
  ok(read('public/display.html').includes('/js/lyric-template-spellbook.js'), 'display 必須載入萬聖咒字: ');
  ok(lyricsHandler.includes("'spellbook'") && lyricsHandler.includes("['rune', 'ouija', 'bats', 'drip', 'talisman', 'moon', 'thread', 'cycle'].includes(settings.spellbookEffect)"),
    '伺服器白名單必須接受 spellbook 並驗證逐字效果: ');
  ok(appState.includes("spellbook: { template: 'spellbook'") && lyricExtras.includes("spellbook: { ...DEFAULT_SETTINGS, template: 'spellbook'"),
    '伺服器與面板都要有 spellbook 預設值: ');
  ok(/spellbook: \{ label: '萬聖咒字'[^\n]*positionMode: 'stage', supportsIntensity: true/.test(lyricExtras),
    '面板必須把萬聖咒字當成舞台位置模板（置中／偏左／偏右／左右分散＋位置微調）並開放動畫強度: ');
  // 2026-10-11 使用者回報：效果收在「哪裡不對？」的下拉選單裡沒人找得到 → 改成樣式縮圖正下方的圖示格＋說明＋自動示範
  effects.forEach((e) => ok(panelHtml.includes(`<button class="sb-effect" data-spellbook-effect="${e}"`), `面板逐字效果圖示格必須有 ${e}: `));
  ok(!panelHtml.includes('id="ls-spellbook-effect"'), '逐字效果不可再藏在下拉選單裡: ');
  ok(panelHtml.includes('data-i18n="spellbook.effectGuide"') && panelHtml.includes('id="spellbook-demo-replay"'),
    '效果格上方要有一句教學、下方要有「再播一次示範」: ');
  ok(read('public/js/output-slim.js').includes("$('#spellbook-field')") && /spellbookField\.classList\.add\('oslim-featured'\);\s*s1\.sec\.appendChild\(spellbookField\)/.test(read('public/js/output-slim.js')),
    '改版面板要把效果格放在「選一個樣子」裡，不能收進「哪裡不對？」: ');
  ok(lyricExtras.includes("if (nextTemplate === 'spellbook') requestSpellbookDemo();") && lyricExtras.includes("type: 'lyrics-preview:sample', replay: true"),
    '選到萬聖咒字或點效果時，預覽要自動用示範歌詞播一次: ');
  const displayJs = read('public/js/display.js');
  ok(displayJs.includes("document.getElementById('spellbook-root')") && displayJs.includes('if (d.replay && isControllerPlaying && !previewSampleActive) return;'),
    '預覽端要真的播示範（不是停在一格），且真的有歌在播時不可被示範蓋掉: ');
  ok(panelHtml.includes('data-template="spellbook"') && controllerHtml.includes('data-template="spellbook"'), '桌面與手機都要能選萬聖咒字: ');
  ok(controllerJs.includes("'particle', 'spellbook'].includes(template)") && controllerJs.includes("nextTemplate === 'spellbook' ? SPELLBOOK_DEFAULTS"),
    '手機首次切到萬聖咒字要套預設、並顯示動畫強度: ');
  const i18n = require('../public/js/i18n');
  const keys = ['template.spellbook', 'template.spellbookTitle', 'template.spellbookDesc', 'spellbook.effectLabel', 'spellbook.positionLabel',
    'spellbook.effectCount', 'spellbook.effectGuide', 'spellbook.effect.cycleShort', 'spellbook.replayDemo']
    .concat(effects.map((e) => `spellbook.effect.${e}`), effects.map((e) => `spellbook.hint.${e}`));
  for (const locale of ['zh-TW', 'en', 'ja', 'ko', 'zh-CN']) {
    keys.forEach((k) => ok(i18n.catalogs?.[locale]?.[k], `${locale} 缺少 ${k}: `));
  }
});

test('萬聖燭光歌詞模板已移除（2026-10-11 使用者要求；萬聖節活動疊加層與歌單外觀不受影響）', () => {
  const root = path.join(__dirname, '..');
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  ok(!fs.existsSync(path.join(root, 'public', 'js', 'lyric-template-halloween.js')), 'lyric-template-halloween.js 必須刪除: ');
  ok(!read('public/display.html').includes('lyric-template-halloween'), 'display.html 不可再載入萬聖燭光: ');
  ok(!read('public/index.html').includes('data-template="halloween"') && !read('public/controller.html').includes('data-template="halloween"')
    && !read('public/index.html').includes('halloween-lyric-field'), '桌面與手機都不可再有萬聖燭光: ');
  for (const rel of ['public/js/lyric-extras.js', 'public/js/controller.js', 'server/routes/handlers/lyrics.js', 'server/state/app-state.js']) {
    ok(!read(rel).includes("'halloween'") && !read(rel).includes('halloweenPosition'), `${rel} 不可再有萬聖燭光模板: `);
  }
  const css = read('public/css/display.css');
  ok(!css.includes('template-halloween') && !css.includes('.hw-') && css.includes('body.template-spellbook #lyrics-container'),
    'display.css 只拿掉萬聖燭光，萬聖咒字的樣式要留著: ');
  const i18n = require('../public/js/i18n');
  ok(!i18n.catalogs?.['zh-TW']?.['template.halloween'] && !i18n.catalogs?.['zh-TW']?.['halloweenLyric.positionLabel'], '萬聖燭光的翻譯要一併移除: ');
  ok(fs.existsSync(path.join(root, 'public', 'js', 'halloween.js')), '萬聖節活動疊加層（/halloween）不可被誤刪: ');
});

test('燈牌：以 registry 時間驅動並完整接入設定與伺服器白名單', () => {
  const displayHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'display.html'), 'utf8');
  const panelHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const controllerHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'controller.html'), 'utf8');
  const displayCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'display.css'), 'utf8');
  const displayJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'display.js'), 'utf8');
  const lyricExtras = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-extras.js'), 'utf8');
  const lyricsHandler = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'handlers', 'lyrics.js'), 'utf8');
  const appState = fs.readFileSync(path.join(__dirname, '..', 'server', 'state', 'app-state.js'), 'utf8');
  const i18n = require('../public/js/i18n');
  const lightboard = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-template-lightboard.js'), 'utf8');

  ok(!fs.existsSync(path.join(__dirname, '..', 'public', 'js', 'lyric-template-migiwa.js')),
    'migiwa 獨立檔案不應再存在: ');
  ok(!fs.existsSync(path.join(__dirname, '..', 'public', 'js', 'lyric-template-stanza.js')),
    '逐字詩箋已解散（橫向砍掉、直排漂字併進直書句流），獨立檔案不應再存在: ');

  ok(displayHtml.includes('/js/lyric-template-lightboard.js'), 'display 必須載入燈牌模板腳本: ');
  ok(lightboard.includes("id: 'lightboard'") && lightboard.includes('onFrame(timeMs, ctx)') && lightboard.includes('onSeek(timeMs, ctx)'),
    '燈牌必須透過 registry 並完全時間驅動: ');
  ok(lightboard.includes('ensureWordTimings') && lightboard.includes('buildGraphemeTimings'),
    '燈牌必須沿用逐字時間核心（缺時退回整句線性）: ');
  ok(!/setInterval\(/.test(lightboard),
    '燈牌不可自己開 setInterval 迴圈，時間一律由 onFrame 帶進來: ');
  ok(lyricsHandler.includes("'lightboard'"), 'server 模板白名單必須接受 lightboard: ');
  ok(appState.includes("lightboard: { template: 'lightboard'"), 'server 預設 lyricTemplateSettings 必須包含 lightboard: ');
  ok(panelHtml.includes('data-template="lightboard"') && controllerHtml.includes('data-template="lightboard"'),
    '桌面與手機模板選擇器都要有 lightboard: ');
  for (const locale of ['zh-TW', 'en', 'ja', 'ko', 'zh-CN']) {
    ok(i18n.catalogs?.[locale]?.['template.lightboard'], locale + ' 缺少 template.lightboard: ');
  }

  // ── 燈牌：只吃兩款真點陣字型、字級掛在機殼上（框跟著字級走）、字級吸附到設計格數 ──
  ok(fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'fonts', 'cubic11', 'Cubic_11.woff2')),
    'Cubic 11 必須隨程式打包（使用者的電腦不會有）: ');
  ok(fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'fonts', 'cubic11', 'OFL.txt')),
    '打包的字型必須附授權檔: ');
  ok(displayCss.includes("font-family: 'Cubic 11'") && displayCss.includes('/assets/fonts/cubic11/Cubic_11.woff2'),
    'display.css 必須以 @font-face 載入打包的 Cubic 11: ');
  // 精品點陣體 9×9（BoutiqueBitmap9x9，SIL OFL）也隨程式打包——不再需要使用者本機安裝
  ok(fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'fonts', 'boutique9x9', 'BoutiqueBitmap9x9_1.93.ttf'))
    && fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'fonts', 'boutique9x9', 'OFL.txt'))
    && fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'fonts', 'boutique9x9', 'NOTICE.txt')),
    '精品點陣體 9×9 必須隨程式打包並附 OFL.txt／NOTICE.txt: ');
  ok(/@font-face\s*\{[^}]*font-family:\s*'BoutiqueBitmap9x9'[^}]*boutique9x9\/BoutiqueBitmap9x9_1\.93\.ttf/.test(displayCss.replace(/\n/g, ' '))
    && /\.lb-font-boutique9x9 \.lb-inner\s*\{[^}]*'BoutiqueBitmap9x9'/.test(displayCss),
    'display.css 必須以 @font-face 載入打包的精品點陣體，且燈牌 boutique9x9 樣式優先用它: ');
  ok(!panelHtml.includes('需本機已安裝') && !panelHtml.includes('要你自己的電腦裝過')
    && !fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-template-lightboard.js'), 'utf8').includes('需本機安裝'),
    '面板／模板不可再說精品點陣體需要本機安裝: ');
  ok(lightboard.includes('function snapSize') && lightboard.includes('Math.round(px / grid)'),
    '燈牌字級必須吸附到設計格數的整數倍（四捨五入，不是無條件捨去）: ');
  ok(lightboard.includes("boxEl.style.fontSize = size + 'px'"),
    '字級要掛在機殼上，整台機器才會跟著字級等比縮放: ');
  ok(/\.lb-box\s*\{[^}]*width:\s*[\d.]+em/.test(displayCss),
    '燈箱寬度必須是 em（框跟著字級走）: ');
  ok(lyricExtras.includes("lightboardFont: 'cubic11'") && panelHtml.includes('id="lightboard-font-field"'),
    '燈牌必須有自己的字型二選一設定: ');
  ok(lyricExtras.includes('if (fontFamilyFields) fontFamilyFields.hidden = isLightboard;')
    && panelHtml.includes('id="font-family-fields"'),
    '選燈牌時一般字體選單必須整塊收起（不支援其他字體）: ');
  ok(lyricsHandler.includes("['cubic11', 'boutique9x9'].includes(settings.lightboardFont)"),
    'server 必須把燈牌字型限制在兩款點陣字型: ');
  ok(lyricExtras.includes('lightboardPan: true') && lyricExtras.includes('lightboardIdleMarquee: true')
    && lyricExtras.includes('lightboardSlideIn: false'),
    '燈牌捲動預設：長句平移開、間奏跑馬開、進場滑入關: ');
  ok(lightboard.includes('HEAD_RATIO') && lightboard.includes('state.textW - boxW'),
    '長句平移必須夾在兩端之間，且讓正在唱的字留在燈箱內: ');
  ok(lightboard.includes('function idleGapMs') && lightboard.includes("(nextT - end) > idleGapMs()")
    && lightboard.includes("segEl.textContent = 'INTERLUDE'"),
    '間奏跑馬只在夠長的空檔跑（門檻可由面板調），並切換讀數: ');
  // 長間奏門檻可調（比照對話氣泡）：schema 宣告 int 1.5–20s、面板滑桿、server 夾限、預設 2500
  ok(lightboard.includes("key: 'lightboardIdleGapMs'") && lightboard.includes("target: 'data:lightboardIdleGapMs'")
    && lyricExtras.includes("lightboardIdleGapMs: 2500") && lyricExtras.includes("key: 'lightboardIdleGapMs'")
    && panelHtml.includes('id="ls-lightboard-idle-gap"')
    && lyricsHandler.includes('settings.lightboardIdleGapMs = Number.isFinite(g)')
    && appState.includes('lightboardIdleGapMs: 2500'),
    '燈牌長間奏門檻必須可調（schema／面板滑桿／server 夾 1.5–20s／app-state 預設）: ');
  // 間奏跑馬位移必須用真實時鐘(performance.now)自行累加、不吃會抖的歌詞時間軸，否則會「跑一下停一下」
  ok(lightboard.includes('idlePhasePx') && lightboard.includes('performance.now()')
    && lightboard.includes('idlePhasePx += dt * IDLE_SPEED_PX_MS')
    && !/\(\(\(t - end\) \* IDLE_SPEED_PX_MS\)/.test(lightboard),
    '間奏跑馬必須用真實時鐘勻速累加，不可再用 (t - end) 直接算位移: ');

  // 燈牌是固定構圖：#lyrics-container 不吃九宮格 transform
  const transformNone = (displayCss.match(/([^}]*)\{\s*transform:\s*none;\s*\}/) || [])[1] || '';
  ok(transformNone.includes('body.template-lightboard #lyrics-container'), 'lightboard 必須列入 transform: none: ');
  // 模板專屬設定走「模板宣告 settings schema → LyricTemplateSettings 統一寫 body.dataset」
  ok(displayJs.includes('LyricTemplateSettings.apply(s)') && displayHtml.includes('/js/lyric-template-settings.js'),
    'display 必須透過 LyricTemplateSettings 橋接器套用模板專屬設定: ');
  ok(displayJs.includes('function syncTrackMetaDataset') && lightboard.includes('dataset.lbTitle'),
    '燈牌銘牌／間奏跑馬要用的曲名必須由 display.js 同步進 dataset: ');
});

test('直書句流「漂字」進場：四相漂入 + 動畫強度（取代原本的逐字詩箋）', () => {
  const cf = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-template-columnflow.js'), 'utf8');
  const displayCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'display.css'), 'utf8');
  const lyricExtras = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-extras.js'), 'utf8');
  const lyricsHandler = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'handlers', 'lyrics.js'), 'utf8');
  const appState = fs.readFileSync(path.join(__dirname, '..', 'server', 'state', 'app-state.js'), 'utf8');
  const panelHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const controllerHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'controller.html'), 'utf8');
  const controllerJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'controller.js'), 'utf8');
  const i18n = require('../public/js/i18n');
  const cssFlat = displayCss.replace(/\n/g, ' ');

  // 逐字詩箋整包移除：檔案、面板卡片、i18n、server 白名單、app-state 預設、stanzaOrient 驗證
  ok(!lyricExtras.includes("template: 'stanza'") && !lyricExtras.includes('stanzaOrient') && !lyricExtras.includes('STANZA_ORIENTS'),
    'lyric-extras 不可再有 stanza/stanzaOrient: ');
  ok(!appState.includes("stanza: { template") && !lyricsHandler.includes("'stanza'") && !lyricsHandler.includes('stanzaOrient'),
    'server（app-state／lyrics handler）不可再有 stanza: ');
  ok(!panelHtml.includes('data-template="stanza"') && !controllerHtml.includes('data-template="stanza"')
    && !panelHtml.includes('id="stanza-orient-buttons"'),
    '模板選擇器與排向按鈕不可再有 stanza: ');
  ok(!i18n.catalogs?.['zh-TW']?.['template.stanza'], 'template.stanza i18n key 必須移除: ');
  ok(!/\.st-col\b/.test(displayCss) && !displayCss.includes('#stanza-root'),
    'display.css 的 #stanza-root／.st-* 樣式必須全部移除: ');

  // 漂字不再是 columnflow 的第三個外觀 variant，改成獨立一欄「逐字進場」（可疊在 sen／fuda 上）
  ok(cf.includes("VARIANTS = ['sen', 'fuda']") && !cf.includes("'sen', 'fuda', 'drift'"),
    'columnflowVariant 只能有 sen／fuda 兩個外觀: ');
  ok(cf.includes("ENTRANCES = ['native', 'drift']") && cf.includes("classList.toggle('cf-ent-drift'"),
    '逐字進場必須是獨立的 columnflowEntrance（cf-ent-drift class）: ');
  // 2026-09-12 重構：四角方向不再由 columnflow 自己另外準備一份 DRIFT_DIRS 備援陣列
  // （會跟 kernel 的同一份規格重複、有走鐘風險），改成 QUAD_DRIFT 不存在時 currentEntrance()
  // 直接安全退回 native，isDrift 為真時保證 QUAD_DRIFT.glyphSpec() 可用。
  ok(cf.includes('const QUAD_DRIFT = LyricMotion.quadDrift') && !cf.includes('DRIFT_DIRS')
    && cf.includes("if (value === 'drift' && !QUAD_DRIFT) return 'native';")
    && cf.includes('QUAD_DRIFT.glyphSpec(driftIdx, gi)') && cf.includes('--cf-qx') && cf.includes('--cf-qy')
    && cf.includes("isDrift = currentEntrance() === 'drift'"),
    '漂字必須靠共用的 LyricMotion.quadDrift 算四角方向（不可另外重複硬寫一份備援陣列）、逐字寫入 --cf-qx/--cf-qy，且由 columnflowEntrance 判斷: ');
  ok(displayCss.includes('@keyframes cf-quad-drift')
    && /#columnflow-root\.cf-ent-drift \.cf-g\.cf-on\s*\{[^}]*animation:\s*cf-quad-drift/.test(cssFlat),
    '漂字進場必須是純 CSS 的 cf-quad-drift keyframe，選擇器要用 cf-ent-drift（不綁外觀 class，sen／fuda 都能套）: ');
  ok(!/#columnflow-root\.cf-drift\b/.test(displayCss), 'display.css 不可再有舊的 #columnflow-root.cf-drift 選擇器: ');

  // 動畫強度：只有 columnflowEntrance === 'drift' 吃，透過 lyricIntensity → cf-int-*
  ok(cf.includes('CF_INTENSITY') && cf.includes('function syncIntensity')
    && cf.includes('document.body.dataset.lyricIntensity') && cf.includes('cf-int-'),
    'columnflow 必須讀 lyricIntensity 切 cf-int-* class: ');
  ok(/#columnflow-root\.cf-int-calm/.test(displayCss) && /#columnflow-root\.cf-int-chaotic/.test(displayCss)
    && displayCss.includes('--cf-drift-dist') && displayCss.includes('--cf-drift-blur'),
    'display.css 必須有沉穩／狂放的漂入距離／模糊／旋轉變體: ');
  ok(/columnflow:[^}]*supportsIntensity: true/.test(lyricExtras)
    && lyricExtras.includes("settings.template === 'columnflow' && settings.columnflowEntrance !== 'drift'"),
    '直書句流必須支援動畫強度，且只在「四相漂字」逐字進場顯示強度選項: ');
  ok(appState.includes("columnflowEntrance: 'native'") && appState.includes("columnflowMaxLines: 4, animationIntensity: 'normal'"),
    'columnflow server 預設必須帶 columnflowEntrance 與 animationIntensity: ');
  ok(lyricsHandler.includes("['sen', 'fuda'].includes(settings.columnflowVariant)")
    && lyricsHandler.includes("['native', 'drift'].includes(settings.columnflowEntrance)"),
    'server 的 columnflowVariant 白名單只能是 sen／fuda，columnflowEntrance 白名單要含 native／drift: ');
  ok(!lyricsHandler.includes("['sen', 'fuda', 'drift'].includes(settings.columnflowVariant)"),
    'server 不可再把 drift 當成 columnflowVariant 的合法值: ');
  ok(panelHtml.includes('data-columnflow-entrance="drift"') && controllerHtml.includes('data-columnflow-entrance="drift"')
    && !panelHtml.includes('data-columnflow-variant="drift"') && !controllerHtml.includes('data-columnflow-variant="drift"'),
    '桌面與手機都要有「逐字進場：四相漂字」選擇器，且不可再有 columnflowVariant="drift"（外觀只剩 sen／fuda）: ');
  for (const locale of ['zh-TW', 'en', 'ja', 'ko', 'zh-CN']) {
    ok(i18n.catalogs?.[locale]?.['template.columnEntranceDrift'], locale + ' 缺少 template.columnEntranceDrift: ');
  }
  ok(/function templateSupportsIntensity[\s\S]{0,160}'columnflow'/.test(controllerJs)
    && controllerJs.includes("(lyricSettings.columnflowEntrance || 'native') !== 'drift'"),
    '手機遙控的動畫強度也要只在「四相漂字」逐字進場顯示: ');
});

test('字界巡航（wordscape）已整包移除：無鏡頭效果就完全不成立，2026-09-04 取消', () => {
  const root = path.join(__dirname, '..');
  const displayHtml = fs.readFileSync(path.join(root, 'public', 'display.html'), 'utf8');
  const panelHtml = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const controllerHtml = fs.readFileSync(path.join(root, 'public', 'controller.html'), 'utf8');
  const controllerJs = fs.readFileSync(path.join(root, 'public', 'js', 'controller.js'), 'utf8');
  const lyricExtras = fs.readFileSync(path.join(root, 'public', 'js', 'lyric-extras.js'), 'utf8');
  const appState = fs.readFileSync(path.join(root, 'server', 'state', 'app-state.js'), 'utf8');
  const lyricsHandler = fs.readFileSync(path.join(root, 'server', 'routes', 'handlers', 'lyrics.js'), 'utf8');
  const displayCss = fs.readFileSync(path.join(root, 'public', 'css', 'display.css'), 'utf8');
  const i18n = require('../public/js/i18n');

  ok(!fs.existsSync(path.join(root, 'public', 'js', 'lyric-template-wordscape.js')),
    'lyric-template-wordscape.js 必須刪除: ');
  ok(!displayHtml.includes('wordscape'), 'display.html 不可再載入 wordscape 腳本: ');
  ok(!panelHtml.includes('data-template="wordscape"') && !controllerHtml.includes('data-template="wordscape"'),
    '桌面／手機模板選擇器不可再有字界巡航: ');
  ok(!lyricExtras.includes('wordscape') && !controllerJs.includes('wordscape')
    && !controllerJs.includes('WORDSCAPE_DEFAULTS'),
    'lyric-extras／controller.js 不可再有 wordscape: ');
  ok(!appState.includes("wordscape: { template") && !lyricsHandler.includes("'wordscape'"),
    'server（app-state／lyrics allowlist）不可再有 wordscape: ');
  ok(!i18n.catalogs?.['zh-TW']?.['template.wordscape'], 'template.wordscape i18n key 必須移除: ');
  ok(!displayCss.includes('wordscape') && !displayCss.includes('字界巡航'),
    'display.css 的 #wordscape-root／.wordscape-stage／body.template-wordscape 樣式必須全部移除: ');
  ok(!fs.existsSync(path.join(root, 'tests', 'visual', '__snapshots__', 'wordscape-line-1.png')),
    '字界巡航的視覺回歸基準也要一起刪: ');
});

test('v2 將既有模板設定與預設快照遷移到新 ID', () => {
  const { migrateState, CURRENT_STATE_SCHEMA_VERSION } = require('../server/services/state-migrations');
  const result = migrateState({
    schemaVersion: 1,
    lyricSettings: {
      template: 'mindscape',
      lyricTemplateSettings: {
        luminous: { template: 'luminous', fontSize: 50 },
        partita: { template: 'partita', fontSize: 45 },
        tilt: { template: 'tilt', fontSize: 45 },
        mindscape: { template: 'mindscape', fontSize: 72 },
      },
      lyricPresets: [{ id: 'legacy', name: '舊模板', settings: { template: 'tilt' } }],
    },
  });
  eq(CURRENT_STATE_SCHEMA_VERSION, 3);
  eq(result.state.schemaVersion, 3);
  eq(result.state.lyricSettings.template, 'aura');
  eq(result.state.lyricSettings.lyricTemplateSettings.pulse.template, 'pulse');
  eq(result.state.lyricSettings.lyricTemplateSettings.facet.template, 'facet');
  eq(result.state.lyricSettings.lyricTemplateSettings.drift.template, 'drift');
  eq(result.state.lyricSettings.lyricTemplateSettings.aura.template, 'aura');
  eq(result.state.lyricSettings.lyricPresets[0].settings.template, 'drift');
});

test('使用者更新時會把 v1 state.json 轉成新的模板 ID 並落盤', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-template-id-migrate-'));
  const original = {
    schemaVersion: 1,
    savedAt: 100,
    playlist: [],
    lyricSettings: {
      template: 'mindscape',
      lyricTemplateSettings: {
        luminous: { template: 'luminous', fontSize: 50 },
        partita: { template: 'partita', fontSize: 45 },
        tilt: { template: 'tilt', fontSize: 45 },
        mindscape: { template: 'mindscape', fontSize: 72 },
      },
    },
  };
  try {
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify(original), 'utf8');
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const path=require('path'); const store=require(process.argv[1]); const dir=process.argv[2];",
      "const loaded=store.loadState(); const disk=JSON.parse(fs.readFileSync(store.STATE_FILE,'utf8')); const files=fs.readdirSync(dir);",
      "const backup=files.find((name)=>/^state\\.json\\.pre-migration-v1-/.test(name));",
      "process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,disk,backupRaw:backup?fs.readFileSync(path.join(dir,backup),'utf8'):null}));",
    ].join('\n'));
    eq(result.loaded.schemaVersion, 3);
    eq(result.disk.schemaVersion, 3);
    eq(result.loaded.lyricSettings.template, 'aura');
    eq(result.disk.lyricSettings.lyricTemplateSettings.pulse.template, 'pulse');
    eq(result.disk.lyricSettings.lyricTemplateSettings.facet.template, 'facet');
    eq(result.disk.lyricSettings.lyricTemplateSettings.drift.template, 'drift');
    eq(result.disk.lyricSettings.lyricTemplateSettings.aura.template, 'aura');
    eq(result.backupRaw, JSON.stringify(original));
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('v3 遷移：既有播放清單的每一列補上 entryId，讓重複歌曲不再靠歌曲 id 誤判位置', () => {
  const { migrateState } = require('../server/services/state-migrations');
  const result = migrateState({
    schemaVersion: 2,
    playlist: [
      { id: 'superwoman', title: 'Superwoman' },
      { id: 'other', title: 'Other', entryId: 'already-has-one' }, // 已有 entryId 的不該被換掉
      { id: 'superwoman', title: 'Superwoman' },
    ],
  });
  eq(result.state.schemaVersion, 3);
  ok(result.state.playlist[0].entryId, '第一列應補上 entryId: ');
  ok(result.state.playlist[2].entryId, '第三列應補上 entryId: ');
  ok(result.state.playlist[0].entryId !== result.state.playlist[2].entryId, '兩個同名 Superwoman 補上的 entryId 不可相同: ');
  eq(result.state.playlist[1].entryId, 'already-has-one', '已經有 entryId 的列不該被覆蓋: ');
});

test('一次性修正：文字PV 舊存檔的偏右改成兩側，只做一次、不升 schemaVersion', () => {
  const { applyOneTimeFixes, CURRENT_STATE_SCHEMA_VERSION } = require('../server/services/state-migrations');
  const state = {
    schemaVersion: CURRENT_STATE_SCHEMA_VERSION,
    lyricSettings: {
      template: 'jizura', jizuraPlacement: 'right',
      lyricTemplateSettings: { jizura: { jizuraPlacement: 'right' }, classic: { jizuraPlacement: 'left' } },
      lyricPresets: [{ settings: { jizuraPlacement: 'right', lyricTemplateSettings: { jizura: { jizuraPlacement: 'full' } } } }],
    },
  };
  eq(applyOneTimeFixes(state).join(','), 'jizuraSidesDefault');
  eq(state.schemaVersion, CURRENT_STATE_SCHEMA_VERSION, '不可升 schemaVersion（退回舊版會讀不了 state.json）: ');
  eq(state.lyricSettings.jizuraPlacement, 'sides');
  eq(state.lyricSettings.lyricTemplateSettings.jizura.jizuraPlacement, 'sides');
  eq(state.lyricSettings.lyricPresets[0].settings.jizuraPlacement, 'sides', '預設組合裡的偏右也要換: ');
  eq(state.lyricSettings.lyricTemplateSettings.classic.jizuraPlacement, 'left', '偏左是使用者自己選的，不動: ');
  eq(state.lyricSettings.lyricPresets[0].settings.lyricTemplateSettings.jizura.jizuraPlacement, 'full', '置中不動: ');
  eq(state.oneTimeFixes.jizuraSidesDefault, true);

  // 做過之後使用者再改回偏右，下次啟動不可再被改掉
  state.lyricSettings.jizuraPlacement = 'right';
  eq(applyOneTimeFixes(state).length, 0);
  eq(state.lyricSettings.jizuraPlacement, 'right', '修正只做一次: ');

  const appStateSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'state', 'app-state.js'), 'utf8');
  ok(appStateSrc.includes('applyOneTimeFixes(saved)') && /\n\s+oneTimeFixes,\n\s+\}\), callback\);/.test(appStateSrc.replace(/\r\n/g, '\n')),
    'app-state 要在還原時套用修正，並把 oneTimeFixes 存回 state.json（否則每次啟動都重做）: ');
});

test('統一音量：增益計算對齊 -14 LUFS 並夾在 ±12 dB', () => {
  const LoudnessGain = require('../public/js/loudness-gain');
  eq(LoudnessGain.TARGET_LUFS, -14);
  eq(LoudnessGain.computeTrackGainDb(-14), 0, '目標響度不調整：');
  eq(LoudnessGain.computeTrackGainDb(-9), -5, '大聲歌壓低：');
  eq(LoudnessGain.computeTrackGainDb(-24), 10, '小聲歌提升：');
  eq(LoudnessGain.computeTrackGainDb(-40), 12, '提升上限 +12dB：');
  eq(LoudnessGain.computeTrackGainDb(-0.5), -12, '壓低下限 -12dB：');
  eq(LoudnessGain.computeTrackGainDb(null), 0, '未量測維持原音量：');
  eq(LoudnessGain.computeTrackGainDb(NaN), 0, 'NaN 維持原音量：');
  eq(LoudnessGain.computeTrackGainDb(5), 0, '範圍外視為量測異常：');
  eq(LoudnessGain.computeTrackGainDb(-80), 0, '近無聲素材不套 +12dB：');
  ok(Math.abs(LoudnessGain.dbToLinear(-6) - 0.5012) < 0.001, 'dB 轉線性增益：');
  ok(Math.abs(LoudnessGain.dbToLinear(0) - 1) < 1e-9, '0dB＝1：');
});

test('統一音量：ffmpeg ebur128 摘要解析取整曲值，異常回 null', () => {
  const AudioProcessorService = require('../server/services/audio-processor');
  const sample = [
    '[Parsed_ebur128_0 @ 0000019] t: 12.5     TARGET:-23 LUFS    M: -10.2 S: -11.0     I: -11.5 LUFS       LRA:   3.2 LU',
    '[Parsed_ebur128_0 @ 0000019] Summary:',
    '',
    '  Integrated loudness:',
    '    I:         -9.3 LUFS',
    '    Threshold: -19.6 LUFS',
    '',
    '  Loudness range:',
    '    LRA:         5.2 LU',
  ].join('\n');
  eq(AudioProcessorService.parseEbur128Loudness(sample), -9.3, '取最後（Summary）的 I 值：');
  eq(AudioProcessorService.parseEbur128Loudness('沒有摘要'), null);
  eq(AudioProcessorService.parseEbur128Loudness(''), null);
  eq(AudioProcessorService.parseEbur128Loudness('I: 5.0 LUFS'), null, '正值視為異常：');
});

test('統一音量：track schema 保留 loudnessLufs，非法值歸 null 不會變 0', () => {
  const { sanitizeTrack } = require('../server/utils/track-schema');
  const base = { id: 't1', title: '歌' };
  eq(sanitizeTrack({ ...base, loudnessLufs: -9.3 }).loudnessLufs, -9.3);
  eq(sanitizeTrack({ ...base }).loudnessLufs, null, '未量測預設 null：');
  eq(sanitizeTrack({ ...base, loudnessLufs: null }).loudnessLufs, null, 'null 不可被 Number(null)=0 誤收：');
  eq(sanitizeTrack({ ...base, loudnessLufs: 'loud' }).loudnessLufs, null);
  eq(sanitizeTrack({ ...base, loudnessLufs: -999 }).loudnessLufs, -70, '超界收斂：');
});

testAsync('統一音量：回填只量有音檔且未量測的歌，完成後回寫並只廣播一次', async () => {
  const { createLoudnessBackfill } = require('../server/services/loudness-backfill');
  const playState = {
    currentTrack: { id: 'b', title: 'B', filename: 'b.mp3' },
    playlist: [
      { id: 'a', title: 'A', filename: 'a.mp3', loudnessLufs: -10 }, // 已量測 → 跳過
      { id: 'b', title: 'B', filename: 'b.mp3' },                    // 要量測
      { id: 'c', title: 'C', filename: 'missing.mp3' },              // 檔案不存在 → 跳過
      { id: 'd', title: 'D', filename: 'd.mp3' },                    // 量測失敗 → 跳過但不中斷
    ],
  };
  const measured = [];
  let broadcasts = 0; let persists = 0; const metaUpdates = [];
  const backfill = createLoudnessBackfill({
    playState,
    persistState: () => { persists++; },
    broadcastState: () => { broadcasts++; },
    measure: async (filename) => { measured.push(filename); return filename === 'b.mp3' ? -20.5 : null; },
    audioExists: (filename) => filename !== 'missing.mp3',
    updateLibraryMeta: (id, partial) => metaUpdates.push({ id, ...partial }),
    logger: { info: () => {}, warn: () => {} },
  });
  const result = await backfill.runOnce();
  eq(result.measured, 1); eq(result.skipped, 1);
  eq(measured.join(','), 'b.mp3,d.mp3', '只量未量測且檔案存在的歌：');
  eq(playState.playlist[1].loudnessLufs, -20.5, '回寫 playState.playlist（鐵則 17 的事實來源）：');
  eq(playState.currentTrack.loudnessLufs, -20.5, '同 id 的 currentTrack 快照一併補上：');
  eq(playState.playlist[3].loudnessLufs, undefined, '量測失敗不寫入：');
  eq(broadcasts, 1, '全部完成才廣播一次：'); eq(persists, 1);
  eq(metaUpdates.length, 1); eq(metaUpdates[0].id, 'b'); eq(metaUpdates[0].loudnessLufs, -20.5);
  // 沒有待量測項目時完全靜默（不廣播）
  const idle = await backfill.runOnce();
  eq(idle.measured, 0); eq(broadcasts, 1, '無事可做不再廣播：');
});

test('統一音量：兩條播放鏈與匯入/上傳/媒體庫都接上響度資料', () => {
  const playback = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-playback.js'), 'utf8');
  ['applyTrackLoudness(track)', 'stTrackGain', 'stLimiter', 'applyStLoudnessGain()'].forEach((required) =>
    ok(playback.includes(required), `app-playback.js 缺少 ${required}`));
  const clientAudio = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'audio-processor.js'), 'utf8');
  ['setTrackLoudness', 'trackGainNode', 'applyTrackGain()'].forEach((required) =>
    ok(clientAudio.includes(required), `audio-processor.js 缺少 ${required}`));
  ok(fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8').includes('/js/loudness-gain.js'),
    'index.html 未載入 loudness-gain.js');
  const serverAudio = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'audio-processor.js'), 'utf8');
  ok(serverAudio.includes('measureLoudnessQueued'), '匯入未量測響度');
  ok(serverAudio.includes('loudnessLufs,'), '匯入 track 未帶響度');
  ok(readApiRoutesSource().includes('measureLoudnessQueued'),
    '本地上傳未量測響度');
  ok(fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'library-store.js'), 'utf8').includes('loudnessLufs'),
    '媒體庫未保留響度');
  ok(fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'socket-handler.js'), 'utf8').includes('createLoudnessBackfill'),
    '啟動回填未接上');
});

test('統一音量開關會即時重套兩條播放鏈', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  ok(panel.includes('id="normalization-toggle"'), '設定頁缺少統一音量開關');
  ok(panel.includes('統一音量（響度標準化）'), '統一音量開關缺少可見標籤');
  const playback = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-playback.js'), 'utf8');
  [
    'function reapplyTrackLoudness()',
    'return stTrackGain ? stTrackGain.gain.value : null',
    'AudioProcessor.setNormalization(dom.normalizationToggle.checked)',
    'reapplyTrackLoudness();',
    'AppShared.reapplyTrackLoudness = reapplyTrackLoudness',
  ].forEach((required) => ok(playback.includes(required), `統一音量開關缺少 ${required}`));
});

test('連點切歌不會讓 <audio> 與 SoundTouch 兩條鏈同時出聲', () => {
  // 實測回報：連點「下一首」會聽到兩個不同進度的音訊、暫停後進度條照跑、再播放歌詞亂跳。
  // 根因是舊的 stLoadCurrent().then() 沒有作廢判斷：較早的載入被丟棄後，回呼仍以「當下的
  // stReady」（新歌還在 decode 時是 false）誤判成解碼失敗，於是降級去 audioPlayer.play()。
  const playback = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-playback.js'), 'utf8').replace(/\r\n/g, '\n');
  ok(playback.includes("return 'stale'; // 已有更新的載入發生"), 'stLoadCurrent 必須回報作廢，呼叫端才擋得掉舊回呼：');
  ok(playback.includes("if (result === 'stale') return; // 已被更新的切歌取代"), '切歌的載入回呼必須先擋掉作廢的載入：');
  ok(playback.includes("if (result === 'stale') return; // 已被更新的載入取代"), '播放鍵的載入回呼必須先擋掉作廢的載入：');
  ok(playback.includes('if (stActive()) return;\n    lastPlayTimeMs'), 'SoundTouch 生效時 <audio> 的 timeupdate 不可再搶進度與 lyrics:sync：');
  ok(playback.includes('if (useSoundTouch) { try { SoundTouchEngine.pause(); } catch (e) { /* 靜默 */ } }'),
    '暫停必須兩條鏈都停，否則另一條仍會讓進度條繼續走：');
});

test('分離完成會把「目前載入中的那首歌」換成伴奏軌', () => {
  // 實測回報：清單空的時候匯入一首歌（自動載入待命）→ 按分離 → 分離完成 → 按播放，
  // 聽到的仍是原始混音，要回清單重點同一首才會換軌。原因是 state:sync 回來時
  // restorePlaybackState() 看到 loadedTrackEntryId 沒變就早退，playTrack() 不會重跑，
  // 主鏈還掛著匯入當下的 filename。重開程式正常，正是因為那條路徑會重新 playTrack()。
  const playback = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-playback.js'), 'utf8').replace(/\r\n/g, '\n');
  ok(playback.includes('function reloadLoadedTrackForSeparation('), '缺少分離完成後的重載入口：');
  ok(/SocketClient\.on\('separation:progress'[\s\S]{0,220}reloadLoadedTrackForSeparation\(/.test(playback),
    'separation:progress 完成時必須觸發重載：');
  ok(playback.includes('const wantSeparation = trackSupportsSeparation(track);')
    && playback.includes('separationActive = wantSeparation;')
    && playback.includes('const masterFilename = wantSeparation ? track.instrumentalFile : track.filename;'),
    '已分離歌曲必須自動選雙 stem，不可再依賴已移除的「分離播放模式」開關：');
  ok(playback.includes('if (separationActive) return;'), '已經在用分離音軌就不該再重載：');
  ok(playback.includes("if (!track || String(track.id) !== String(trackId)) return;"),
    '只能對「目前載入的就是剛分離完的那首」重載：');
  ok(/if \(!trackSupportsSeparation\(track\)\) \{[\s\S]{0,400}setTimeout\(\(\) => reloadLoadedTrackForSeparation\(trackId, attempt \+ 1\)/.test(playback),
    'stem 檔名還沒隨 state:sync 回填時要重試，不可把完成事件丟掉：');
  ok(playback.includes("playTrack(index, isPlaying, { notifyServer: false, startTime: lastPlayTimeMs / 1000 });"),
    '重載要沿用「載入到目前播放位置」的既有寫法：');
});

test('自動雙 stem 播放：新使用者人聲 20%，且播放區可自行調整並保存', () => {
  const root = path.join(__dirname, '..');
  const panel = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const playback = fs.readFileSync(path.join(root, 'public/js/app-playback.js'), 'utf8');
  ok(!panel.includes('id="separation-mode-toggle"'), '不可再出現分離播放模式開關：');
  ok(/id="separation-vocals-volume"[^>]+min="0"[^>]+max="150"[^>]+value="20"/.test(panel),
    '人聲音量滑桿必須保留 0–150% 可調範圍，HTML 預設 20%：');
  ok(playback.includes('let vocalsVolume = 0.2;')
    && playback.includes("localStorage.getItem('vk-separation-vocals-volume')")
    && playback.includes("localStorage.setItem('vk-separation-vocals-volume', String(vocalsVolume))"),
    '新使用者要從 20% 開始，既有使用者設定仍要讀回，調整後也要保存：');
  ok(playback.includes("dom.separationVocalsVolume.addEventListener('input'"),
    '播放區的人聲音量滑桿必須仍可即時調高／調低：');
});

test('雙路輸出保持 warm，播放前等待 sink 就緒', () => {
  const playback = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-playback.js'), 'utf8').replace(/\r\n/g, '\n');
  ok(playback.includes('let dualSinkApplyChain = Promise.resolve(false);')
    && playback.includes('function ensureDualAudioReady(options = {})'),
  '雙路輸出要有可重用的 readiness gate 與序列化 sink queue：');
  ok(playback.includes('const dualReadyPromise = wantDualAudio ? ensureDualAudioReady() : Promise.resolve(true);')
    && playback.includes('Promise.all([masterLoadPromise, vocalsPromise, dualReadyPromise])'),
  '新歌起播必須把 sink readiness 跟 decode 一起等待：');
  ok(playback.includes('if (dualAudioModeEnabled) ensureDualAudioReady().then(startSTAfterOutputsReady);'),
    '暫停後續播也必須等雙路輸出 ready：');
  ok(/function stopPlayback\(\)[\s\S]{0,1800}if \(!dualAudioModeEnabled\) wireDualRouting\(false\);/.test(playback),
    '一般歌曲停止不可拆掉仍啟用中的雙路 routing：');
  ok(/function setDualAudioMode\(enabled\)[\s\S]{0,1000}if \(dualAudioModeEnabled\)[\s\S]{0,500}ensureDualAudioReady\(\)/.test(playback),
    'idle 時開啟雙路模式要先 warm 兩個輸出：');
  ok(/function setDualAudioDevices[\s\S]{0,1200}ensureDualAudioReady\(\{ force: true \}\)/.test(playback),
    '換裝置時要強制排入最後一次 sink 設定：');
  ok(playback.includes('const generation = ++dualSinkGeneration;')
    && playback.includes('dualSinkApplyChain = tracked;'),
  '快速換裝置必須序列化，避免較慢完成的舊 setSinkId 蓋回去：');
});

test('雙路路由已接上時才建立的人聲鏈，不可繞過耳機路的同步偏移', () => {
  // 實測回報：分離完成後改播伴奏軌，聽起來仍是「伴奏比人聲慢」，暫停時伴奏還會多播一小段。
  // 根因是 wireDualRouting(true) 在「狀態沒變」時直接 return：前一首沒分離時人聲鏈還不存在，
  // 換到分離歌才由 ensureVocalsChain() 建出來，那條新鏈就永遠留在 destination 上、繞過
  // dualHeadphoneDelay（同步偏移就掛在它身上），伴奏有延遲、人聲沒有 = 兩軌差一個同步偏移。
  const playback = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-playback.js'), 'utf8').replace(/\r\n/g, '\n');
  ok(playback.includes('if (dualRoutingWired && dualHeadphoneDelay) vocalsDelay.connect(dualHeadphoneDelay);'),
    '雙路已接上時，人聲鏈必須自己接到耳機路節點：');
  ok(playback.includes('else vocalsDelay.connect(stCtx.destination);'),
    '沒接雙路時人聲鏈仍直接到 destination：');
  ok(playback.includes('if (active === dualRoutingWired) return;'),
    'wireDualRouting 的早退還在，這條測試才有意義（改掉早退時要一起重想這裡）：');
});

test('Setlist keeps template and quick controls in two columns beside the preview', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const panelCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'panel.css'), 'utf8');
  ok(panel.includes('class="setlist-main"'));
  ok(panel.includes('class="setlist-template-column"'));
  ok(panel.includes('class="setlist-quick-column"'));
  ok(panel.includes('<span class="check-box" aria-hidden="true"></span><span class="check-text">未唱歌曲</span>'));
  ok(panel.includes('<span class="check-box" aria-hidden="true"></span><span class="check-text">已唱歌曲</span>'));
  ok(panelCss.includes('.setlist-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(340px, 440px);'));
  ok(panelCss.includes('.setlist-main { display: grid; grid-template-columns: minmax(250px, .68fr) minmax(430px, 1.32fr);'));
  ok(panelCss.includes('.setlist-preview-bar { grid-column: 2; grid-row: 1; position: sticky;'));
  ok(panelCss.includes('.field--setlist-sections .check-row {'));
  ok(panelCss.includes('display:inline-flex;'));
  ok(panelCss.includes('border:1px solid var(--border-strong);'));
  ok(panelCss.includes('.field--setlist-sections .check-inline {'));
  ok(panelCss.includes('flex-direction:row;'));
  ok(panelCss.includes('border:0;'));
  ok(panelCss.includes('.field--setlist-sections .check-inline .check-text { order:1;'));
  ok(panelCss.includes('.live-session-summary-status { margin: 5px 0 0;'));
});

test('Lyrics and setlist advanced settings stay modal with entries below right previews', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const panelCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'panel.css'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-setlist-panel.js'), 'utf8');
  ok(!panel.includes('data-inline-settings-workspace="true"'), '詳細設定不可攤在頁面內：');
  ok(panel.includes('id="display-advanced-modal" class="modal modal-wide lyric-advanced-modal"'));
  ok(panel.includes('id="setlist-advanced-modal" class="modal modal-wide setlist-advanced-modal"'));
  ok(panel.includes('class="card preview-detail-card" aria-labelledby="lyrics-detail-entry-title"'));
  ok(panel.includes('class="card preview-detail-card" aria-labelledby="setlist-detail-entry-title"'));
  ok(panelCss.includes('.settings-body { grid-column: 1; grid-row: 1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));'));
  ok(panelCss.includes('.settings-preview-bar { grid-column: 2; grid-row: 1; position: sticky;'));
  ok(app.includes('modal.hidden = false;'));
  ok(setlistPanel.includes('advModal.hidden = false;'));
  ok(!panel.includes('已放在本頁下方的詳細細調工作台'), '不得保留已取消的頁內詳細設定文案：');
  ok(panel.includes('data-i18n="settings.workspace.livePreview"'));
  ok(panel.includes('data-i18n="settings.workspace.findSettings"'));
  ok(panel.includes('data-i18n-placeholder="settings.workspace.searchPlaceholder"'));
  ok(panel.includes('data-i18n="settings.workspace.searchHint"'));
  ok(panel.includes('data-i18n="settings.workspace.resetAll"'));
  ok(panel.includes('data-i18n-placeholder="settings.setlist.searchPlaceholder"'));
  ok(panel.includes('data-i18n="settings.setlist.searchHint"'));
});

test('Live session records live on the home view and no longer occupy setlist settings', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-setlist-panel.js'), 'utf8');
  const setlistStart = panel.indexOf('data-view="setlist"');
  const setlistEnd = panel.indexOf('<!-- ═══════════════════════════════════════════', setlistStart);
  const setlistView = panel.slice(setlistStart, setlistEnd);
  // 首頁重構：本場直播從獨立 Modal 攤平成「本場直播」分頁，直接展開，不再另開視窗。
  const sessionPanelStart = panel.indexOf('data-prep-panel="session"');
  const sessionPanelEnd = panel.indexOf('/.prep-panel session', sessionPanelStart);
  const sessionPanel = panel.slice(sessionPanelStart, sessionPanelEnd);
  ok(sessionPanelStart > 0, '首頁必須有「本場直播」分頁：');
  ok(!panel.includes('id="session-record-modal"'), '本場直播不應再是獨立 Modal：');
  ok(sessionPanel.includes('id="session-status"'));
  ok(sessionPanel.includes('id="setlist-panel"'));
  ok(sessionPanel.includes('id="session-new-start"'));
  ok(sessionPanel.includes('id="btn-copy-chapters"'));
  ok(!setlistView.includes('id="session-status"'), 'Session 狀態不可留在歌單設定頁：');
  ok(!setlistView.includes('id="setlist-panel"'), '已唱歌曲不可留在歌單設定頁：');
  ok(setlistPanel.includes("document.getElementById('session-summary-status')"));
});

test('Setlist style save stays immediate, sends once, and ignores stale acknowledgements', () => {
  const setlistPanel = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-setlist-panel.js'), 'utf8');
  ok(setlistPanel.includes("SocketClient.sendWithCallback('setlist:style', collectStyle()"));
  ok(!setlistPanel.includes("SocketClient.send('setlist:style', collectStyle())"), '不可在 ACK 儲存前再額外送一次：');
  ok(!setlistPanel.includes('styleSaveTimer'), '歌單預覽不可再因前端 debounce 延遲：');
  ok(setlistPanel.includes('const requestId = ++latestStyleSaveRequest;'));
  ok(setlistPanel.includes('if (requestId !== latestStyleSaveRequest) return;'), '舊 ACK 不可覆蓋最新歌單儲存狀態：');
  ok(setlistPanel.includes("document.querySelectorAll('[data-setlist-save-status]')"));
  ok(setlistPanel.includes('let styleSaveStatus = {'));
  ok(setlistPanel.includes("window.addEventListener('i18n:change', renderStyleSaveStatus)"), '歌單儲存狀態必須在切換語言後重新格式化：');
  ok(setlistPanel.includes('savedAt: savedAt || null'), '歌單儲存時間必須保留原始時間戳，而不是保留已翻譯字串：');
});

test('Settings pages keep right previews on desktop and move previews first at 1024px', () => {
  const panelCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'panel.css'), 'utf8');
  const normalizedCss = panelCss.replace(/\r\n/g, '\n');
  ok(normalizedCss.includes('@media (max-width: 1024px) {\n  .setlist-split { grid-template-columns: minmax(0, 1fr); }'));
  ok(panelCss.includes('.setlist-preview-bar { grid-column: 1; grid-row: 1; position: static; }'));
  ok(panelCss.includes('.setlist-main { grid-column: 1; grid-row: 2; }'));
  ok(normalizedCss.includes('@media (max-width: 1024px) {\n  .view[data-view="settings"].is-active { display: block; }'));
  ok(!normalizedCss.includes('@media (max-width: 1120px) {\n  .view[data-view="settings"].is-active { display: block; }'), '桌面設定頁不可過早把右側預覽移到頁首：');
});

test('Lyrics settings send exactly once and ignore stale acknowledgements', () => {
  const lyricExtras = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-extras.js'), 'utf8');
  eq((lyricExtras.match(/SocketClient\.sendWithCallback\('lyric-settings:update'/g) || []).length, 1, '歌詞設定只應有一個 ACK 傳送入口：');
  ok(!lyricExtras.includes("SocketClient.send('lyric-settings:update'"), '歌詞設定不可先送一次再為 ACK 重送：');
  ok(lyricExtras.includes('const requestId = ++latestSaveRequest;'));
  ok(lyricExtras.includes('if (requestId !== latestSaveRequest) return;'), '舊 ACK 不可覆蓋最新儲存狀態：');
  ok(lyricExtras.includes("window.I18n?.current?.() || 'zh-TW'"), '儲存時間必須跟隨目前介面語言：');
  ok(lyricExtras.includes('let lyricSaveStatus = {'));
  ok(lyricExtras.includes("window.addEventListener('i18n:change', renderLyricSaveStatus)"), '歌詞儲存狀態必須在切換語言後重新格式化：');
  ok(lyricExtras.includes('savedAt: savedAt || null'), '歌詞儲存時間必須保留原始時間戳，而不是保留已翻譯字串：');
});

test('Shared settings workspace runtime is included before dependent panel scripts', () => {
  const root = path.join(__dirname, '..');
  const panel = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const workspacePath = path.join(root, 'public', 'js', 'settings-workspace.js');
  ok(fs.existsSync(workspacePath), '發行內容缺少 settings-workspace.js：');
  const workspace = fs.readFileSync(workspacePath, 'utf8');
  ok(workspace.includes('window.SettingsWorkspace = Object.freeze({ create });'));
  ok(workspace.includes("nav.setAttribute('role', 'tablist')"));
  ok(workspace.includes("tab.setAttribute('role', 'tab')"));
  ok(workspace.includes("panel.setAttribute('role', 'tabpanel')"));
  ok(workspace.includes("tab.setAttribute('aria-selected', String(selected))"));
  ok(workspace.includes("tab.setAttribute('aria-controls', panel.id)"));
  ok(workspace.includes("panel.setAttribute('aria-labelledby', activeTab.id)"));
  ok(panel.includes('id="lyrics-settings-search-status" class="field-hint" role="status" aria-live="polite"'));
  ok(panel.includes('id="setlist-settings-search-status" class="field-hint" role="status" aria-live="polite"'));
  ok(panel.includes('<script src="/js/settings-workspace.js"></script>'));
  ok(panel.indexOf('/js/settings-workspace.js') < panel.indexOf('/js/app-setlist-panel.js'), '共用工作台必須先於歌單面板載入：');
  ok(panel.indexOf('/js/settings-workspace.js') < panel.indexOf('/js/app.js'), '共用工作台必須先於歌詞 Modal 邏輯載入：');
});

test('Electron P1 shell keeps runtime data isolated and locks down the renderer', () => {
  const electronShell = require('../electron/shell');
  const runtimeRoot = path.join(os.tmpdir(), 'elitesand-electron-shell-unit');
  const runtimePaths = electronShell.getRuntimePaths(runtimeRoot);
  eq(runtimePaths.root, path.resolve(runtimeRoot));
  eq(runtimePaths.dataDir, path.join(path.resolve(runtimeRoot), 'data'));
  eq(runtimePaths.downloadsDir, path.join(path.resolve(runtimeRoot), 'downloads'));
  eq(runtimePaths.logsDir, path.join(path.resolve(runtimeRoot), 'logs'));
  // Use native absolute fixtures: a Windows drive literal is relative on Linux.
  const installDir = path.resolve(runtimeRoot, 'installed app');
  const externalMediaDir = path.resolve(runtimeRoot, 'external music', 'Elitesand Pro Media');
  const missingMediaDir = path.resolve(runtimeRoot, 'missing music', 'Elitesand Pro Media');
  const freshMedia = electronShell.resolveMediaRuntime(runtimeRoot, {
    isPackaged: true,
    executablePath: path.join(installDir, 'Elitesand Pro.exe'),
    fsImpl: { readdirSync: () => [], readFileSync: () => { throw new Error('no config'); } },
  });
  eq(freshMedia.mode, 'install-default');
  eq(freshMedia.downloadsDir, path.join(installDir, 'Elitesand Pro Media'));
  const legacyMedia = electronShell.resolveMediaRuntime(runtimeRoot, {
    isPackaged: true,
    executablePath: path.join(installDir, 'Elitesand Pro.exe'),
    fsImpl: { readdirSync: () => ['existing-song.mp3'], readFileSync: () => { throw new Error('no config'); } },
  });
  eq(legacyMedia.mode, 'legacy-migration-required');
  eq(legacyMedia.downloadsDir, path.join(path.resolve(runtimeRoot), 'downloads'));
  const configuredMedia = electronShell.resolveMediaRuntime(runtimeRoot, {
    isPackaged: true,
    executablePath: path.join(installDir, 'Elitesand Pro.exe'),
    fsImpl: { existsSync: () => true, readdirSync: () => { throw new Error('must not inspect legacy'); }, readFileSync: () => JSON.stringify({ mediaDir: externalMediaDir }) },
  });
  eq(configuredMedia.mode, 'configured');
  eq(configuredMedia.downloadsDir, externalMediaDir);
  const configuredDevelopmentMedia = electronShell.resolveMediaRuntime(runtimeRoot, {
    isPackaged: false,
    fsImpl: {
      existsSync: () => true,
      readFileSync: () => JSON.stringify({ mediaDir: externalMediaDir }),
    },
  });
  eq(configuredDevelopmentMedia.mode, 'configured', 'development Electron must respect a completed media migration');
  eq(configuredDevelopmentMedia.downloadsDir, externalMediaDir);
  const staleConfiguredMedia = electronShell.resolveMediaRuntime(runtimeRoot, {
    isPackaged: true,
    executablePath: path.join(installDir, 'Elitesand Pro.exe'),
    fsImpl: {
      existsSync: () => false,
      readdirSync: () => ['existing-song.mp3'],
      readFileSync: () => JSON.stringify({ mediaDir: missingMediaDir }),
    },
  });
  eq(staleConfiguredMedia.mode, 'legacy-migration-required', 'stale media config must fall back to a usable legacy source');
  eq(electronShell.resolveShellPort('3100'), 3100);
  eq(electronShell.resolveShellPort('not-a-port'), 3000);
  ok(electronShell.isTrustedLocalUrl('http://127.0.0.1:3000/panel', 3000));
  ok(!electronShell.isTrustedLocalUrl('https://127.0.0.1:3000/panel', 3000));
  ok(!electronShell.isTrustedLocalUrl('http://example.com:3000/panel', 3000));
  ok(electronShell.isProjectReleaseUrl('https://github.com/z22115554/elitesand-pro/releases'));
  ok(!electronShell.isProjectReleaseUrl('https://github.com/other/project/releases'));
  // Twitch device-code 驗證頁必須可外開，否則「前往 Twitch 輸入代碼」在殼裡點了沒反應。
  ok(electronShell.isTwitchVerificationUrl('https://www.twitch.tv/activate'), 'Twitch 驗證頁必須放行外開：');
  ok(electronShell.isTwitchVerificationUrl('https://www.twitch.tv/activate?device-code=ABCD1234'));
  ok(electronShell.isTwitchVerificationUrl('https://id.twitch.tv/oauth2/device'));
  ok(!electronShell.isTwitchVerificationUrl('http://www.twitch.tv/activate'), '非 https 不放行：');
  ok(!electronShell.isTwitchVerificationUrl('https://twitch.tv.evil.com/activate'), '仿冒網域不放行：');
  ok(!electronShell.isTwitchVerificationUrl('https://example.com/activate'));
  // 跟唱視圖用 window.open 開 /prompter；殼裡預設 deny 一切 window.open，
  // 使用者實測回報 Electron 打不開、看到的視窗沒有退出按鈕，根因是這裡沒放行。
  ok(electronShell.isPrompterUrl('http://127.0.0.1:3000/prompter', 3000), '/prompter 必須被殼放行，否則 Electron 裡按鈕沒反應：');
  ok(!electronShell.isPrompterUrl('http://127.0.0.1:3000/panel', 3000), '只放行 /prompter，不是整個本機來源都放行：');
  ok(!electronShell.isPrompterUrl('https://127.0.0.1:3000/prompter', 3000), '非 http 不放行：');
  ok(!electronShell.isPrompterUrl('http://evil.com/prompter', 3000), '非本機網域不放行：');

  // electron/installer.nsh 把使用者在精靈選的語言寫進這個 marker，殼要讀一次、刪一次，
  // 只影響安裝後的第一次啟動，不能每次開程式都覆蓋使用者後來自己在面板改的語言。
  let unlinked = null;
  const localeFsImpl = {
    readFileSync: () => ' en \n',
    unlinkSync: (file) => { unlinked = file; },
  };
  eq(electronShell.consumeInstallerLocale(runtimeRoot, localeFsImpl), 'en', '合法語言代碼必須被讀出並套用：');
  ok(unlinked.endsWith('installer-locale.txt'), 'consumeInstallerLocale 必須刪除 marker，避免每次啟動都套用：');

  const invalidLocaleFsImpl = { readFileSync: () => 'not-a-real-locale', unlinkSync: () => {} };
  eq(electronShell.consumeInstallerLocale(runtimeRoot, invalidLocaleFsImpl), null, '非白名單內容不可被當成語言代碼採用：');

  const missingMarkerFsImpl = {
    readFileSync: () => { throw new Error('ENOENT'); },
    unlinkSync: () => { throw new Error('ENOENT'); },
  };
  eq(electronShell.consumeInstallerLocale(runtimeRoot, missingMarkerFsImpl), null, '沒有 marker（開發模式／Portable／已消費過）必須安靜回傳 null：');

  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'shell.js'), 'utf8');
  [
   'utilityProcess.fork',
    "stdio: 'ignore'",
    'cwd: app.isPackaged ? path.dirname(projectRoot) : projectRoot',
    "OPEN_BROWSER: '0'",
    'contextIsolation: true',
    'nodeIntegration: false',
    'sandbox: true',
    'backgroundThrottling: false',
    'Tray',
    'displayBalloon',
    'preventDefault',
    'powerSaveBlocker',
    'showMessageBoxSync',
    'setWindowOpenHandler',
    'ELITESAND_SHELL_USER_DATA_DIR',
    'ELITESAND_MEDIA_STORAGE_MODE',
    'consumeInstallerLocale(app.getPath(\'userData\'))',
    'elitesand:choose-media-location',
    'restart-after-media-migration',
    'SHUTDOWN_MESSAGE',
    // 跟唱視圖子視窗必須是一般原生 frame（有系統關閉鈕）：這個子視窗沒有配對的自訂標題列
    // IPC 控制鈕，用主視窗那套 frame:false 會開出一個關不掉的視窗（已修的實測回報）。
    'frame: true',
    'did-create-window',
  ].forEach((required) => ok(source.includes(required), `Electron shell is missing ${required}`));

});

test('Media migration copies from the selected source without nesting the media folder', () => {
  const mediaStorage = require('../server/services/media-storage');
  const fixtureRoot = fs.mkdtempSync(path.join(TEST_RUNTIME_ROOT, 'media-migration-unit-'));
  const sourceDir = path.join(fixtureRoot, 'old-media');
  const destinationDir = path.join(fixtureRoot, 'Elitesand Pro Media');
  const emptySourceDir = path.join(fixtureRoot, 'empty-media');
  const emptyDestinationParent = path.join(fixtureRoot, 'empty-target');
  const configFile = path.join(TEST_RUNTIME_DIRS.data, 'media-storage.json');
  const uninstallReference = path.join(TEST_RUNTIME_ROOT, 'media-storage.ini');
  const originalConfig = fs.existsSync(configFile) ? fs.readFileSync(configFile) : null;
  const originalReference = fs.existsSync(uninstallReference) ? fs.readFileSync(uninstallReference) : null;
  try {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'song.mp3'), 'audio');
    fs.mkdirSync(emptySourceDir, { recursive: true });
    const recoveredSource = mediaStorage.resolveMigrationSource([emptySourceDir, sourceDir]);
    eq(recoveredSource.sourceDir, sourceDir, 'migration must automatically fall back to the first location that still has media');
    const result = mediaStorage.migrateToParent(destinationDir, sourceDir);
    eq(result.mediaDir, destinationDir, 'selecting the final media folder must not create a nested copy');
    eq(result.sourceDir, sourceDir);
    eq(result.movedEntries, 1);
    ok(fs.existsSync(path.join(destinationDir, 'song.mp3')));
    ok(!fs.existsSync(path.join(destinationDir, 'Elitesand Pro Media', 'song.mp3')));
    ok(!fs.existsSync(path.join(sourceDir, 'song.mp3')));
    let error;
    try { mediaStorage.migrateToParent(emptyDestinationParent, emptySourceDir); } catch (caught) { error = caught; }
    ok(error?.message.includes('No media files were found'), 'empty migrations must fail before creating a destination');
    ok(!fs.existsSync(emptyDestinationParent), 'empty migrations must not create an empty destination folder');
    const mediaLibrary = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'media-library.js'), 'utf8');
    ok(!mediaLibrary.includes("chooseMediaLocation('source')"), 'migration UI must never ask the user to locate the original media folder');
    ok(mediaLibrary.includes("library:storage:migrate', { parentDir }"), 'migration UI sends only the destination; the server resolves the source');
  } finally {
    if (originalConfig) fs.writeFileSync(configFile, originalConfig); else fs.rmSync(configFile, { force: true });
    if (originalReference) fs.writeFileSync(uninstallReference, originalReference); else fs.rmSync(uninstallReference, { force: true });
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('Electron assisted installer stays per-user with an integrity-protected ASAR app', () => {
  const root = path.join(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  eq(packageJson.main, 'electron/main.js');
  eq(packageJson.build.asar.smartUnpack, false, 'all application code must remain inside app.asar');
  eq(packageJson.build.directories.app, 'dist/.electron-builder-resources/app');
  eq(packageJson.build.directories.output, 'dist/releases/v${version}/installer');
  eq(packageJson.build.afterPack, 'tools/after-pack-electron-security.js');
  eq(packageJson.build.forceCodeSigning, false, 'current releases must support an unsigned Windows distribution');
  const expectedFuses = {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false,
  };
  Object.entries(expectedFuses).forEach(([name, expected]) =>
    eq(packageJson.build.electronFuses[name], expected, `Electron security fuse ${name} must be explicit`));
  eq(packageJson.build.nsis.oneClick, false);
  eq(packageJson.build.nsis.perMachine, false, 'NSIS must not install per-machine');
  eq(packageJson.build.nsis.allowToChangeInstallationDirectory, true,
    'assisted installer must let the user choose a per-user destination');
  eq(packageJson.build.nsis.createDesktopShortcut, false,
    'custom installer page must own the desktop shortcut choice');
  eq(packageJson.build.nsis.createStartMenuShortcut, false,
    'custom installer page must own the Start menu shortcut choice');
  eq(packageJson.build.nsis.include, 'electron/installer.nsh');
  eq(packageJson.build.nsis.license, 'dist/.electron-builder-resources/EULA-installer.txt',
    'installer must use its generated Unicode-safe EULA copy before install');
  eq(packageJson.build.win.icon, 'assets/elitesand-pro.ico', 'installer 必須使用正式 Elitesand Pro 圖示：');
  ok(packageJson.build.files.includes('assets/**/*'), 'Electron 殼必須攜帶視窗圖示資產：');
  const iconPath = path.join(root, packageJson.build.win.icon);
  const icon = fs.readFileSync(iconPath);
  eq(icon.readUInt16LE(0), 0, 'ICO reserved header 必須為 0：');
  eq(icon.readUInt16LE(2), 1, 'Electron 圖示必須是 ICO：');
  const iconCount = icon.readUInt16LE(4);
  ok(iconCount >= 9, 'ICO 必須包含至少九個為 Windows 小尺寸優化的圖層：');
  const iconSizes = new Set(Array.from({ length: iconCount }, (_, index) => {
    const encoded = icon[6 + (index * 16)];
    return encoded === 0 ? 256 : encoded;
  }));
  [16, 20, 24, 32, 40, 48, 64, 128, 256].forEach((size) => {
    ok(iconSizes.has(size), `ICO 缺少 ${size}px 圖層：`);
  });
  ok(packageJson.build.nsis.deleteAppDataOnUninstall !== true,
    'uninstaller must not delete Electron userData without explicit consent');
  ok(!packageJson.build.extraResources.some((entry) => String(entry.to || '').startsWith('app-root')),
    'installer must not expose a raw app-root directory outside app.asar');
  ok(packageJson.build.extraResources.some((entry) => entry.to === 'tools'), 'installer must contain bundled tools');
  const installerNsh = fs.readFileSync(path.join(root, 'electron', 'installer.nsh'), 'utf8');
  ok(installerNsh.includes('!macro customInstallMode'), 'assisted installer must force the current-user mode');
  ok(installerNsh.includes('StrCpy $isForceCurrentInstall "1"'), 'installer must not offer a per-machine branch');
  ok(installerNsh.includes('!insertmacro setInstallModePerUser'), 'silent installs must remain per-user');
  ok(installerNsh.includes('!macro customPageAfterChangeDir'), 'installer must provide shortcut options after choosing a directory');
  ok(installerNsh.includes('EsCreateDesktopShortcut') && installerNsh.includes('EsCreateStartMenuShortcut'),
    'desktop and Start menu shortcuts must remain independent choices');
  ['!macro customUnWelcomePage', 'EsRemoveAllData', 'media-storage.ini', '.elitesand-pro-media-root', 'RMDir /r "$APPDATA\\Elitesand Pro"'].forEach((required) =>
    ok(installerNsh.includes(required), `uninstaller cleanup flow is missing ${required}`));
  ok(installerNsh.includes('UninstPage custom un.EsCleanupPre un.EsCleanupLeave'),
    'custom uninstall welcome page must use the explicit UninstPage form, otherwise NSIS rejects the callbacks');
  const shellSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'shell.js'), 'utf8');
  ok(!shellSource.includes("require('../public/js/i18n.js')"),
    'packaged Electron shell 不可直接 require renderer 的 i18n.js；兩者位於不同 resources 目錄，會讓 installer 啟動直接 MODULE_NOT_FOUND：');
  ['app.isPackaged', "path.join(processObject.resourcesPath || process.resourcesPath, 'tools')", 'verifyPackagedResourceIntegrity',
    'showPortableDataMigrationNotice',
    'function needsPortableDataMigrationNotice', 'shouldShowPortableDataMigrationNotice = needsPortableDataMigrationNotice()',
    "Object.keys(processObject.env).find((key) => key.toUpperCase() === 'PATH')", 'ELITESAND_G2P_PYTHON'].forEach((required) =>
    ok(shellSource.includes(required), `Electron packed runtime is missing ${required}`));
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  ok(mainSource.includes('app.getAppPath()'), 'Electron main must resolve the packaged app from app.asar');
  ok(mainSource.includes('packaged-resource-integrity.generated'),
    'Electron main must load the generated external-resource integrity manifest');
  const installerBuild = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-installer.ps1'), 'utf8');
  ['build-portable.ps1', 'dist\\.electron-builder-resources', 'Get-RelativeWorkspacePath',
    'write-packaged-resource-integrity.js',
    '--electron-only', 'electron-builder.cmd', 'node_modules\\express\\package.json',
    'Test-InstallerBootOutsideRepo', 'win-unpacked\\resources', 'verify-electron-package.js',
    'Invoke-PackagedBootPhase', '$phaseProcess.ExitCode',
    'EULA-installer.txt', '[System.Text.UTF8Encoding]::new($true)', 'NSIS installer EULA must be UTF-8 with a BOM',
    'NSIS installer EULA diverged from the approved EULA.txt'].forEach((required) =>
    ok(installerBuild.includes(required), `Installer build is missing ${required}`));
  const updater = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'app-updater-runner.js'), 'utf8');
  ok(!updater.includes("'electron'"), 'incremental updater must never allow Electron shell files');
  const updaterService = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'app-updater.js'), 'utf8');
  ok(updaterService.includes('try {') && updaterService.includes('currentLock = null'),
    'packaged installer must not require a development package-lock.json at module load');
  ok(!installerBuild.includes('[System.IO.Path]::GetRelativePath('),
    'installer build must remain compatible with Windows PowerShell 5.1');
  ok(installerBuild.includes("Properties.Remove('build')"),
    'staged app package must not carry electron-builder development configuration');
});

testAsync('Electron ASAR security hook adds readable per-file SHA-256 metadata', async () => {
  const asar = require('@electron/asar');
  const securityHook = require('../tools/after-pack-electron-security');
  const fixtureRoot = fs.mkdtempSync(path.join(TEST_RUNTIME_ROOT, 'asar-integrity-'));
  const sourceRoot = path.join(fixtureRoot, 'source');
  const archivePath = path.join(fixtureRoot, 'app.asar');
  try {
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, 'fixture.txt'), 'integrity-fixture', 'utf8');
    const archiveStream = await asar.createPackage(sourceRoot, archivePath);
    await new Promise((resolve, reject) => archiveStream.once('close', resolve).once('error', reject));
    const result = securityHook.addAsarFileIntegrity(archivePath);
    ok(result.protectedFiles >= 1, 'security hook must protect every packed ASAR file');
    const entry = asar.getRawHeader(archivePath).header.files['fixture.txt'];
    eq(entry.integrity.algorithm, 'SHA256');
    eq(entry.integrity.hash.length, 64);
    eq(asar.extractFile(archivePath, 'fixture.txt').toString('utf8'), 'integrity-fixture');
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('Packaged helper integrity rejects a changed external binary', () => {
  const shell = require('../electron/shell');
  const fixtureRoot = fs.mkdtempSync(path.join(TEST_RUNTIME_ROOT, 'external-integrity-'));
  try {
    const toolsDir = path.join(fixtureRoot, 'tools');
    fs.mkdirSync(toolsDir, { recursive: true });
    const helperPath = path.join(toolsDir, 'helper.exe');
    fs.writeFileSync(helperPath, 'trusted-helper', 'utf8');
    const crypto = require('crypto');
    const manifest = { files: { 'tools/helper.exe': crypto.createHash('sha256').update('trusted-helper').digest('hex') } };
    shell.verifyPackagedResourceIntegrity(fixtureRoot, manifest);
    fs.writeFileSync(helperPath, 'changed-helper', 'utf8');
    let rejection;
    try { shell.verifyPackagedResourceIntegrity(fixtureRoot, manifest); } catch (error) { rejection = error; }
    ok(rejection && /integrity/i.test(rejection.message), 'changed external helpers must abort the packaged shell');
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('yt-dlp runtime 信任鏈：官方更新可續用、外部竄改會 reseed，Installer seed 只升不降', () => {
  const shell = require('../electron/shell');
  const { getYtdlpCommand } = require('../server/utils/ytdlp-command');
  const { hashFileSync, readTrustState, writeTrustStateAtomic } = require('../server/utils/ytdlp-runtime-trust');
  const fixtureRoot = fs.mkdtempSync(path.join(TEST_RUNTIME_ROOT, 'ytdlp-runtime-copy-'));
  try {
    const resources = path.join(fixtureRoot, 'resources');
    const tools = path.join(resources, 'tools');
    const userData = path.join(fixtureRoot, 'user-data');
    fs.mkdirSync(tools, { recursive: true });
    const seed = path.join(tools, 'yt-dlp.exe');
    fs.writeFileSync(seed, 'trusted-seed-v1', 'utf8');
    const crypto = require('crypto');
    const seedHash = crypto.createHash('sha256').update('trusted-seed-v1').digest('hex');
    const manifest = { files: { 'tools/yt-dlp.exe': seedHash } };
    const versionByContents = (command) => {
      const contents = fs.readFileSync(command, 'utf8');
      if (contents === 'trusted-seed-v1') return '2026.09.01';
      if (contents === 'trusted-seed-v2') return '2026.10.15';
      if (contents === 'trusted-seed-v3') return '2027.01.15';
      return null;
    };

    shell.verifyPackagedResourceIntegrity(resources, manifest);
    const first = shell.prepareMutableYtdlp(resources, userData, {
      expectedSeedHash: seedHash,
      versionResolver: versionByContents,
    });
    eq(first.mutable, true);
    eq(first.action, 'seeded-runtime-copy');
    eq(fs.readFileSync(first.command, 'utf8'), 'trusted-seed-v1');
    ok(path.resolve(first.command).startsWith(path.resolve(userData) + path.sep), '工作副本必須在 userData 下: ');
    const firstTrust = readTrustState(first.statePath);
    eq(firstTrust.runtimeHash, seedHash);
    eq(firstTrust.runtimeVersion, '2026.09.01');
    eq(firstTrust.provenance, 'seed');

    // 模擬官方 updater 成功後：binary 改變，並且 mutation point 原子刷新 trusted hash/version。
    fs.writeFileSync(first.command, 'official-updated-runtime-v2', 'utf8');
    writeTrustStateAtomic(first.statePath, {
      runtimeHash: hashFileSync(first.command), runtimeVersion: '2026.12.01',
      seedHash, seedVersion: '2026.09.01', provenance: 'official-update',
    });
    eq(fs.readFileSync(seed, 'utf8'), 'trusted-seed-v1');
    shell.verifyPackagedResourceIntegrity(resources, manifest);

    // 重開程式不得用舊 seed 把已更新版本蓋回去。
    const second = shell.prepareMutableYtdlp(resources, userData, {
      expectedSeedHash: seedHash,
      versionResolver: versionByContents,
    });
    eq(second.action, 'kept-runtime-copy');
    eq(fs.readFileSync(second.command, 'utf8'), 'official-updated-runtime-v2');
    eq(getYtdlpCommand({ ELITESAND_YTDLP_PATH: second.command }), path.normalize(second.command));
    eq(getYtdlpCommand({ ELITESAND_YTDLP_PATH: 'relative\\yt-dlp.exe' }), 'yt-dlp', '相對 override 不可信，必須退回 PATH 命令: ');

    // 外部只改 binary、沒有同步 app-owned trust state：下一次啟動不得執行，直接恢復已驗證 seed。
    fs.writeFileSync(second.command, 'tampered-runtime', 'utf8');
    const afterTamper = shell.prepareMutableYtdlp(resources, userData, {
      expectedSeedHash: seedHash,
      versionResolver: versionByContents,
    });
    eq(afterTamper.action, 'reseeded-untrusted-runtime');
    eq(fs.readFileSync(afterTamper.command, 'utf8'), 'trusted-seed-v1');
    eq(readTrustState(afterTamper.statePath).runtimeHash, seedHash);

    // 先建立「runtime 比下一版 Installer seed 還新」的可信狀態；安裝新版不可倒退。
    fs.writeFileSync(afterTamper.command, 'official-newer-runtime', 'utf8');
    writeTrustStateAtomic(afterTamper.statePath, {
      runtimeHash: hashFileSync(afterTamper.command), runtimeVersion: '2026.12.01',
      seedHash, seedVersion: '2026.09.01', provenance: 'official-update',
    });
    fs.writeFileSync(seed, 'trusted-seed-v2', 'utf8');
    const seedV2Hash = hashFileSync(seed);
    const noDowngrade = shell.prepareMutableYtdlp(resources, userData, {
      expectedSeedHash: seedV2Hash,
      versionResolver: versionByContents,
    });
    eq(noDowngrade.action, 'kept-newer-runtime-copy');
    eq(fs.readFileSync(noDowngrade.command, 'utf8'), 'official-newer-runtime');
    eq(readTrustState(noDowngrade.statePath).seedHash, seedV2Hash, '跨 Installer 決策後 sidecar 應更新成目前 seed 身分: ');

    // 再下一版 Installer seed 真正較新時，必須升級 runtime。
    fs.writeFileSync(seed, 'trusted-seed-v3', 'utf8');
    const seedV3Hash = hashFileSync(seed);
    const upgraded = shell.prepareMutableYtdlp(resources, userData, {
      expectedSeedHash: seedV3Hash,
      versionResolver: versionByContents,
    });
    eq(upgraded.action, 'upgraded-runtime-from-seed');
    eq(fs.readFileSync(upgraded.command, 'utf8'), 'trusted-seed-v3');
    eq(readTrustState(upgraded.statePath).runtimeVersion, '2027.01.15');

    // sidecar 損壞也不能只因 runtime 非空就接受。
    fs.writeFileSync(upgraded.statePath, '{not-json', 'utf8');
    fs.writeFileSync(upgraded.command, 'mystery-runtime', 'utf8');
    const corruptState = shell.prepareMutableYtdlp(resources, userData, {
      expectedSeedHash: seedV3Hash,
      versionResolver: versionByContents,
    });
    eq(corruptState.action, 'reseeded-untrusted-runtime');
    eq(fs.readFileSync(corruptState.command, 'utf8'), 'trusted-seed-v3');
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('yt-dlp packaged updater 成功後直接寫入 runtime trust hash，且重新驗證 packaged seed', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(TEST_RUNTIME_ROOT, 'ytdlp-updater-trust-'));
  try {
    const seed = path.join(fixtureRoot, 'seed-yt-dlp.exe');
    const runtimeDir = path.join(fixtureRoot, 'runtime');
    const runtime = path.join(runtimeDir, 'yt-dlp.exe');
    const statePath = path.join(runtimeDir, 'runtime-state.json');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(seed, 'trusted-packaged-seed', 'utf8');
    fs.writeFileSync(runtime, 'official-updated-runtime', 'utf8');
    const crypto = require('crypto');
    const seedHash = crypto.createHash('sha256').update(fs.readFileSync(seed)).digest('hex');
    const runtimeHash = crypto.createHash('sha256').update(fs.readFileSync(runtime)).digest('hex');
    const updaterPath = path.join(__dirname, '..', 'server', 'services', 'ytdlp-updater.js');
    const script = [
      "const updater=require(process.argv[1]);",
      "updater.writeApprovedRuntimeTrust('2026.12.31');",
      "const fs=require('fs'); process.stdout.write('__YTDLP_TRUST__'+fs.readFileSync(process.env.ELITESAND_YTDLP_STATE_PATH,'utf8'));",
    ].join('\n');
    const child = spawnStateStore(process.execPath, ['-e', script, updaterPath], {
      env: {
        ...process.env,
        ELITESAND_PACKAGED: '1',
        ELITESAND_YTDLP_MUTABLE: '1',
        ELITESAND_YTDLP_PATH: runtime,
        ELITESAND_YTDLP_STATE_PATH: statePath,
        ELITESAND_YTDLP_SEED_PATH: seed,
        ELITESAND_YTDLP_SEED_HASH: seedHash,
        ELITESAND_YTDLP_SEED_VERSION: '2026.09.01',
      },
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    eq(child.status, 0, `yt-dlp updater trust child stderr=${child.stderr} stdout=${child.stdout}: `);
    const markerAt = child.stdout.lastIndexOf('__YTDLP_TRUST__');
    ok(markerAt >= 0, `yt-dlp updater trust child 缺少結果：${child.stdout}`);
    const trust = JSON.parse(child.stdout.slice(markerAt + '__YTDLP_TRUST__'.length));
    eq(trust.runtimeHash, runtimeHash);
    eq(trust.runtimeVersion, '2026.12.31');
    eq(trust.seedHash, seedHash);
    eq(trust.seedVersion, '2026.09.01');
    eq(trust.provenance, 'official-update');

    fs.writeFileSync(seed, 'tampered-packaged-seed', 'utf8');
    const tamperChild = spawnStateStore(process.execPath, ['-e', "require(process.argv[1]).writeApprovedRuntimeTrust('2027.01.01')", updaterPath], {
      env: {
        ...process.env,
        ELITESAND_PACKAGED: '1',
        ELITESAND_YTDLP_MUTABLE: '1',
        ELITESAND_YTDLP_PATH: runtime,
        ELITESAND_YTDLP_STATE_PATH: statePath,
        ELITESAND_YTDLP_SEED_PATH: seed,
        ELITESAND_YTDLP_SEED_HASH: seedHash,
        ELITESAND_YTDLP_SEED_VERSION: '2026.09.01',
      },
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    ok(tamperChild.status !== 0, 'packaged seed hash 已變更時不得批准新的 runtime trust: ');
    ok(/seed hash changed unexpectedly/i.test(`${tamperChild.stderr} ${tamperChild.stdout}`), '拒絕原因必須指向 packaged seed integrity: ');
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
