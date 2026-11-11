'use strict';

// 核心回歸測試（playback-sync-3）。由 tests/run-tests.js 依序載入，不要單獨執行。
const {
  fs,
  path,
  vm,
  TEST_RUNTIME_ROOT,
  failed,
  test,
  testAsync,
  eq,
  ok,
} = require('./core-harness');
const AudioProcessor = require('../server/services/audio-processor');

test('yt-dlp 工作副本不可寫時安全退回 seed，且 packaged updater 禁止原地修改 seed', () => {
  const shell = require('../electron/shell');
  const fixtureRoot = fs.mkdtempSync(path.join(TEST_RUNTIME_ROOT, 'ytdlp-runtime-fallback-'));
  try {
    const resources = path.join(fixtureRoot, 'resources');
    const tools = path.join(resources, 'tools');
    const userData = path.join(fixtureRoot, 'user-data');
    fs.mkdirSync(tools, { recursive: true });
    fs.writeFileSync(path.join(tools, 'yt-dlp.exe'), 'trusted-seed', 'utf8');
    const failingFs = Object.create(fs);
    failingFs.mkdirSync = () => { throw new Error('simulated read-only userData'); };
    const result = shell.prepareMutableYtdlp(resources, userData, failingFs);
    eq(result.mutable, false);
    eq(result.action, 'readonly-seed-fallback');
    eq(result.command, path.join(tools, 'yt-dlp.exe'));

    const updaterSource = fs.readFileSync(path.join(__dirname, '../server/services/ytdlp-updater.js'), 'utf8');
    ok(updaterSource.includes("process.env.ELITESAND_PACKAGED === '1' && process.env.ELITESAND_YTDLP_MUTABLE !== '1'"),
      'Installer 若無 writable working copy，更新器必須 fail closed，不能修改 integrity-protected seed: ');
    ok(updaterSource.includes('nightlyRelease.installStagedRelease(resolved, staging'), '更新器必須使用已驗證的工作副本，不可修改 seed: ');
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('所有 yt-dlp 執行入口共用明確工作副本路徑', () => {
  const serviceFiles = [
    'audio-processor.js',
    'ytdlp-updater.js',
    'ytdlp-compatibility.js',
    'system-check.js',
  ];
  for (const name of serviceFiles) {
    const source = fs.readFileSync(path.join(__dirname, '../server/services', name), 'utf8');
    ok(source.includes('getYtdlpCommand'), `${name} 必須共用 ytdlp-command resolver: `);
  }
  const shellSource = fs.readFileSync(path.join(__dirname, '../electron/shell.js'), 'utf8');
  ok(shellSource.includes('ELITESAND_YTDLP_PATH: packagedYtdlpRuntime.command'));
  ok(shellSource.includes("ELITESAND_YTDLP_MUTABLE: packagedYtdlpRuntime.mutable ? '1' : '0'"));
  ok(shellSource.includes('ELITESAND_YTDLP_STATE_PATH: packagedYtdlpRuntime.statePath'));
  ok(shellSource.includes("expectedSeedHash: packagedResourceIntegrity?.files?.['tools/yt-dlp.exe']"));
  ok(shellSource.includes('prepareMutableYtdlp('));
  const updaterSource = fs.readFileSync(path.join(__dirname, '../server/services/ytdlp-updater.js'), 'utf8');
  ok(updaterSource.includes('writeApprovedRuntimeTrust(release.version)'), '官方 Nightly 驗證後必須刷新 runtime trusted hash: ');
  ok(updaterSource.includes('runtimeMatchesRecordedTrust()'), '更新失敗不得無條件把較新的可信 runtime 降級成 seed: ');
});

test('Electron P1 smoke starts with a disposable Electron user-data directory', () => {
  const packageJson = require('../package.json');
  const smoke = fs.readFileSync(path.join(__dirname, '..', 'tools', 'smoke-electron-shell.js'), 'utf8');
  eq(packageJson.scripts.shell, 'electron electron/main.js');
  eq(packageJson.scripts['smoke:electron'], 'node tools/smoke-electron-shell.js');
  eq(packageJson.devDependencies.electron, '^43.8.1');
  ok(smoke.includes('ELITESAND_SHELL_USER_DATA_DIR'));
  ok(smoke.includes('ELITESAND_SHELL_HEADLESS'));
  ['STDIO_STRESS_REQUESTS', 'MIN_STRESS_LOG_BYTES', '/api/twitch/status', '/api/announcements?force=1', 'healthAfterStress']
    .forEach((required) => ok(smoke.includes(required), `Electron smoke 缺少 stdout 壓力守衛 ${required}: `));
  ok(!smoke.includes("ELITESAND_DATA_DIR: path.join(runtimeRoot"));
});

test('Electron shell chrome stays inside the Elitesand Pro design system', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const panelCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'panel.css'), 'utf8');
  const chrome = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'electron-shell-chrome.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.js'), 'utf8');
  ok(panel.includes('class="desktop-windowbar"'));
  ok(panel.includes('id="electron-window-minimize"'));
  ok(panel.includes('id="electron-window-maximize"'));
  ok(panel.includes('id="electron-window-close"'));
  ok(panel.includes('id="electron-close-modal"'));
  ok(panel.includes('>收到系統匣</button>'));
  ok(panel.includes('>確認關閉</button>'));
  ok(panelCss.includes('-webkit-app-region: drag'));
  ok(panelCss.includes('-webkit-app-region: no-drag'));
  ok(panelCss.includes('html.electron-shell .app'));
  ok(chrome.includes("get('electronShell') === '1'"));
  ok(chrome.includes("shell.decideClose('tray')"));
  ok(chrome.includes("shell.decideClose('quit')"));
  ok(chrome.includes("shell.windowControl('toggle-maximize')"));
  ok(preload.includes("ipcRenderer.send('elitesand:close-decision', action)"));
  ok(preload.includes("ipcRenderer.send('elitesand:window-control', action)"));

  // 安裝精靈選的語言要能一路傳到面板並被記住，否則使用者裝英文版打開卻看到中文。
  const shellSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'shell.js'), 'utf8');
  const installerNsh = fs.readFileSync(path.join(__dirname, '..', 'electron', 'installer.nsh'), 'utf8');
  ok(chrome.includes("shellQuery.get('lang')"), '殼層必須讀出精靈語言參數：');
  ok(chrome.includes('window.I18n?.setLocale?.(installerLang)'), '讀到的語言必須真的套用並持久化，不能只是顯示一次：');
  ok(shellSource.includes("await window.loadURL(`http://127.0.0.1:${port}/panel?electronShell=1${localeQuery}`)"), '殼層開窗網址必須帶上語言參數：');
  ok(shellSource.includes('function consumeInstallerLocale'), '缺少讀取＋刪除 installer-locale marker 的邏輯：');
  ok(installerNsh.includes('installer-locale.txt'), 'NSIS 端必須把精靈語言寫進 marker 檔：');
});

testAsync('Electron 殼：預設 port 被別的程式占用時往後找空 port 啟動，健康的 Elitesand 一樣重用，全滿才報錯', async () => {
  const { EventEmitter } = require('events');
  const { createElectronShell } = require('../electron/shell');
  const { fallbackPortsFor } = require('../server/utils/port-candidates');

  function harness({ probeByPort, dialogs = [] }) {
    const forks = [];
    const child = new EventEmitter();
    child.pid = 4321;
    child.postMessage = () => {};
    child.kill = () => {};
    const app = new EventEmitter();
    app.setName = () => {};
    app.setAppUserModelId = () => {};
    app.requestSingleInstanceLock = () => true;
    app.whenReady = async () => {};
    app.getPath = () => path.join(TEST_RUNTIME_ROOT, 'electron-port-fallback-unit');
    app.quit = () => {};
    app.exit = () => {};
    class FakeWindow extends EventEmitter {
      constructor() { super(); this.webContents = { setWindowOpenHandler: () => {}, on: () => {} }; }
      async loadURL(url) { this.loadedUrl = url; this.emit('ready-to-show'); }
      show() {} hide() {} focus() {} isMinimized() { return false; }
    }
    class FakeTray extends EventEmitter { setToolTip() {} setContextMenu() {} }
    const desktop = createElectronShell({
      app,
      BrowserWindow: FakeWindow,
      utilityProcess: { fork: (_entry, _args, options) => { forks.push(options); return child; } },
      dialog: { showErrorBox: () => {}, showMessageBoxSync: (options) => { dialogs.push(options); return 0; } },
      shell: { openExternal: () => {} },
      Tray: FakeTray,
      Menu: { buildFromTemplate: () => ({}) },
      nativeImage: { createFromPath: () => ({}) },
      clipboard: { writeText: () => {} },
      powerSaveBlocker: { start: () => 1, stop: () => {} },
      ipcMain: { handle: () => {}, on: () => {} },
      processObject: { env: {}, platform: 'win32' },
      fsImpl: { mkdirSync: () => {} },
      probeHealthImpl: async (port) => probeByPort(port),
      delay: async () => {},
    });
    return { desktop, forks };
  }

  // 3000 被別的程式占；3001 空 → 用 3001 啟動，env 帶 PORT=3001 與 ELITESAND_PORT_FALLBACK_FROM=3000
  let started = false;
  const free = harness({ probeByPort: (port) => {
    if (port === 3000) return { state: 'occupied' };
    if (port === 3001) { if (!started) { started = true; return { state: 'free' }; } return { state: 'healthy', payload: { status: 'ok' } }; }
    return { state: 'occupied' };
  } });
  const result = await free.desktop.start();
  eq(result.reused, false);
  eq(free.forks[0].env.PORT, '3001', '備援 port 要交給 server: ');
  eq(free.forks[0].env.ELITESAND_PORT_FALLBACK_FROM, '3000', '要讓 server／面板知道是備援: ');

  // 3000 被占；3001 上已有健康的 Elitesand → 重用它，不 fork
  const reuse = harness({ probeByPort: (port) => (port === 3001 ? { state: 'healthy', payload: { status: 'ok' } } : { state: 'occupied' }) });
  const reused = await reuse.desktop.start();
  eq(reused.reused, true);
  eq(reuse.forks.length, 0, '重用既有 server 不可再 fork: ');

  // 全部都被占 → 給一般使用者看的單鈕對話框，不提開發實例
  const dialogs = [];
  const full = harness({ probeByPort: () => ({ state: 'occupied' }), dialogs });
  let failed = false;
  try { await full.desktop.start(); } catch (_) { failed = true; }
  ok(failed, '全滿必須失敗: ');
  const last = fallbackPortsFor(3000).at(-1);
  ok(dialogs.some((d) => d.message.includes(`3000～${last}`)), '對話框要講清楚試過哪些連接埠: ');
  ok(!dialogs.some((d) => /npm start/.test(d.message + (d.detail || ''))), '不可再出現給開發者看的文案: ');
  ok(dialogs.every((d) => d.buttons.length === 1), '只有「結束」一顆鈕: ');
});

testAsync('Media migration relaunches through Electron graceful quit', async () => {
  const { EventEmitter } = require('events');
  const { createElectronShell } = require('../electron/shell');
  let windowInstance;
  let restartHandler;
  const shutdownMessages = [];
  const child = new EventEmitter();
  child.pid = 9876;
  child.postMessage = (message) => shutdownMessages.push(message);
  child.kill = () => { child.killed = true; };
  const app = new EventEmitter();
  app.setName = () => {};
  app.setAppUserModelId = () => {};
  app.requestSingleInstanceLock = () => true;
  app.whenReady = async () => {};
  app.getPath = () => path.join(TEST_RUNTIME_ROOT, 'electron-media-restart-unit');
  app.relaunchCalls = 0;
  app.relaunch = () => { app.relaunchCalls++; };
  app.quitCalls = 0;
  app.quit = () => {
    app.quitCalls++;
    app.emit('before-quit', { preventDefault() {} });
  };
  app.exitCodes = [];
  app.exit = (code) => app.exitCodes.push(code);
  class FakeWindow extends EventEmitter {
    constructor() {
      super();
      windowInstance = this;
      this.webContents = { setWindowOpenHandler: () => {}, on: () => {} };
    }
    async loadURL() { this.emit('ready-to-show'); }
    show() {}
    hide() {}
    focus() {}
    isMinimized() { return false; }
  }
  class FakeTray extends EventEmitter {
    setToolTip() {}
    setContextMenu() {}
  }
  let probes = 0;
  const desktop = createElectronShell({
    app,
    BrowserWindow: FakeWindow,
    utilityProcess: { fork: () => child },
    dialog: { showErrorBox: () => {}, showMessageBoxSync: () => 1 },
    shell: { openExternal: () => {} },
    Tray: FakeTray,
    Menu: { buildFromTemplate: () => ({}) },
    nativeImage: { createFromPath: () => ({}) },
    clipboard: { writeText: () => {} },
    powerSaveBlocker: { start: () => 1, stop: () => {} },
    ipcMain: { handle: (channel, handler) => { if (channel === 'elitesand:restart-after-media-migration') restartHandler = handler; } },
    processObject: { env: {}, platform: 'win32' },
    fsImpl: { mkdirSync: () => {} },
    probeHealthImpl: async () => (++probes === 1 ? { state: 'free' } : { state: 'healthy', payload: { status: 'ok' } }),
    delay: async () => {},
  });

  await desktop.start();
  eq(restartHandler({ sender: windowInstance.webContents }), true);
  await new Promise((resolve) => setImmediate(resolve));
  eq(app.relaunchCalls, 1);
  eq(app.quitCalls, 1, 'migration must use app.quit so before-quit can run');
  eq(shutdownMessages[0]?.type, 'elitesand:shutdown');
  ok(child.killed, 'graceful shutdown keeps the bounded fallback kill');
  eq(app.exitCodes.join(','), '0');
});

testAsync('Electron P1：關窗可明確選擇結束或收到系統匣，四項選單可叫回面板', async () => {
  const { EventEmitter } = require('events');
  const { createElectronShell } = require('../electron/shell');
  let windowInstance;
  let trayInstance;
  const clipboardWrites = [];
  const app = new EventEmitter();
  app.setName = () => {};
  app.setAppUserModelId = () => {};
  app.requestSingleInstanceLock = () => true;
  app.whenReady = async () => {};
  app.getPath = () => path.join(TEST_RUNTIME_ROOT, 'electron-tray-unit');
  app.quitCalls = 0;
  app.quit = () => { app.quitCalls++; };
  const closeDialogs = [];
  let closeDecisionHandler;
  let windowControlHandler;
  const ipcMain = {
    on: (channel, handler) => {
      if (channel === 'elitesand:close-decision') closeDecisionHandler = handler;
      if (channel === 'elitesand:window-control') windowControlHandler = handler;
    },
  };
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      windowInstance = this;
      this.options = options;
      this.webContents = {
        setWindowOpenHandler: () => {},
        on: () => {},
        send: (channel) => { this.lastSentChannel = channel; },
      };
      this.hideCalls = 0;
      this.showCalls = 0;
      this.minimizeCalls = 0;
      this.maximizeCalls = 0;
      this.unmaximizeCalls = 0;
      this.maximized = false;
    }
    async loadURL(url) { this.loadedUrl = url; this.emit('ready-to-show'); }
    show() { this.showCalls++; }
    hide() { this.hideCalls++; }
    removeMenu() { this.menuRemoved = true; }
    focus() {}
    isMinimized() { return false; }
    minimize() { this.minimizeCalls++; }
    isMaximized() { return this.maximized; }
    maximize() { this.maximizeCalls++; this.maximized = true; this.emit('maximize'); }
    unmaximize() { this.unmaximizeCalls++; this.maximized = false; this.emit('unmaximize'); }
  }
  class FakeTray extends EventEmitter {
    constructor(icon) { super(); trayInstance = this; this.icon = icon; }
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu; }
    displayBalloon(balloon) { this.balloon = balloon; }
  }
  const shell = createElectronShell({
    app,
    BrowserWindow: FakeWindow,
    utilityProcess: { fork: () => { throw new Error('reused server must not fork'); } },
    dialog: { showErrorBox: () => {}, showMessageBoxSync: (options) => { closeDialogs.push(options); return closeChoice; } },
    shell: { openExternal: () => {} },
    Tray: FakeTray,
    Menu: { buildFromTemplate: (template) => ({ template }) },
    nativeImage: { createFromPath: (iconPath) => ({ iconPath }) },
    clipboard: { writeText: (value) => clipboardWrites.push(value) },
    powerSaveBlocker: { start: () => 1, stop: () => {} },
    ipcMain,
    processObject: { env: {}, platform: 'win32' },
    fsImpl: { mkdirSync: () => {} },
    probeHealthImpl: async () => ({ state: 'healthy', payload: { status: 'ok' } }),
  });

  await shell.start();
  eq(windowInstance.options.frame, false, '桌面殼必須由 Elitesand Pro 面板繪製視窗頂欄：');
  ok(!('titleBarOverlay' in windowInstance.options), 'Elitesand 自有的視窗按鈕不可再被 Windows caption overlay 蓋住：');
  ok(windowInstance.loadedUrl.endsWith('/panel?electronShell=1'), '僅 Electron 面板可啟用自訂視窗頂欄：');
  eq(windowInstance.menuRemoved, true, '桌面殼不可保留 Electron 的 File/Edit/View 額外選單列：');
  ok(typeof windowControlHandler === 'function', '桌面殼必須接住自有視窗按鈕：');
  windowControlHandler({ sender: windowInstance.webContents }, 'minimize');
  eq(windowInstance.minimizeCalls, 1, '最小化按鈕必須最小化視窗：');
  windowControlHandler({ sender: windowInstance.webContents }, 'toggle-maximize');
  eq(windowInstance.maximizeCalls, 1, '最大化按鈕必須放大視窗：');
  eq(windowInstance.lastSentChannel, 'elitesand:window-maximized', '最大化狀態必須回傳給面板按鈕：');
  windowControlHandler({ sender: windowInstance.webContents }, 'toggle-maximize');
  eq(windowInstance.unmaximizeCalls, 1, '再次點最大化按鈕必須還原視窗：');
  const closeEvent = { prevented: false, preventDefault() { this.prevented = true; } };
  windowInstance.emit('close', closeEvent);
  eq(closeEvent.prevented, true, '有系統匣時 close 必須被攔截：');
  eq(windowInstance.lastSentChannel, 'elitesand:close-requested', '關窗必須交由面板顯示 Elitesand 風格確認視窗：');
  eq(windowInstance.hideCalls, 0, '使用者尚未決定前不可隱藏面板：');
  eq(closeDialogs.length, 0, 'Electron 面板不可退回 Windows 原生關閉對話框：');
  ok(typeof closeDecisionHandler === 'function', '桌面殼必須接住面板的關閉決定：');
  closeDecisionHandler({ sender: windowInstance.webContents }, 'tray');
  eq(windowInstance.hideCalls, 1, '收到系統匣後應隱藏面板：');
  eq(app.quitCalls, 0, '收到系統匣不可結束程式：');
  eq(trayInstance.balloon.content, '程式已收到系統匣；音訊與 OBS 會繼續運作。');
  eq(trayInstance.menu.template.map((item) => item.label).join('|'), '顯示面板|複製 OBS 歌詞網址|複製 OBS 歌單網址|結束');
  const visibleBeforeTrayFocus = windowInstance.showCalls;
  trayInstance.menu.template[0].click();
  eq(windowInstance.showCalls, visibleBeforeTrayFocus + 1, '系統匣必須可叫回視窗：');
  trayInstance.menu.template[1].click();
  trayInstance.menu.template[2].click();
  eq(clipboardWrites.join('|'), 'http://localhost:3000/display|http://localhost:3000/setlist');

  const quitEvent = { prevented: false, preventDefault() { this.prevented = true; } };
  windowInstance.emit('close', quitEvent);
  eq(quitEvent.prevented, true, '確認前仍需攔截視窗的預設關閉：');
  closeDecisionHandler({ sender: windowInstance.webContents }, 'quit');
  eq(app.quitCalls, 1, '選確認關閉時必須走正常 app.quit 生命週期：');
  eq(windowInstance.hideCalls, 1, '選確認關閉不可誤藏到系統匣：');
});

test('Electron 關閉確認要有取消，且強制更新公告遮罩會阻斷點擊', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const chrome = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'electron-shell-chrome.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.js'), 'utf8');
  const shellSrc = fs.readFileSync(path.join(__dirname, '..', 'electron', 'shell.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'panel.css'), 'utf8');
  // 關閉確認框除了收到系統匣/確認關閉，必須有取消（放棄本次關閉）。
  ok(html.includes('id="electron-close-cancel"'), '關閉確認需有取消按鈕：');
  ok(chrome.includes("shell.decideClose('cancel')"), '取消需通知殼放棄關閉：');
  ok(/action === 'cancel'/.test(preload), 'preload 需放行 cancel 決定：');
  ok(/action === 'cancel'/.test(shellSrc), '殼端需處理 cancel（重設 pending、不結束不藏匣）：');
  // 強制更新公告是阻斷式：遮罩不可 pointer-events:none（否則後面面板仍可點）。
  ok(!/\.announcement-critical-modal\s*\{[^}]*pointer-events\s*:\s*none/.test(css),
    '強制更新公告遮罩不可點擊穿透：');
});

// 迴歸：重用既有 server（ownsServer=false）時，before-quit 舊碼會提早 return 而不設
// isQuitting，於是接下來 Electron 關窗序列的 window 'close' 又被 hideWindowToTray
// preventDefault 攔下，app.quit 被自己的關窗流程卡住——系統匣「結束」與確認關閉都
// 永遠關不掉程式。上面的 3941 測試用的 fake app.quit 不送 before-quit，剛好漏掉這條。
testAsync('Electron P1：重用既有 server 時決定結束後，關窗不可再被攔截（否則關不掉）', async () => {
  const { EventEmitter } = require('events');
  const { createElectronShell } = require('../electron/shell');
  let windowInstance;
  let trayInstance;
  const app = new EventEmitter();
  app.setName = () => {};
  app.setAppUserModelId = () => {};
  app.requestSingleInstanceLock = () => true;
  app.whenReady = async () => {};
  app.getPath = () => path.join(TEST_RUNTIME_ROOT, 'electron-reused-quit-unit');
  app.exitCodes = [];
  app.exit = (code) => app.exitCodes.push(code);
  app.quitCalls = 0;
  // 真實 Electron 的 app.quit() 會先送出 before-quit，才進入關窗序列。
  app.quit = () => { app.quitCalls++; app.emit('before-quit', { preventDefault() { this.prevented = true; } }); };
  class FakeWindow extends EventEmitter {
    constructor() {
      super();
      windowInstance = this;
      this.webContents = { setWindowOpenHandler: () => {}, on: () => {}, send: () => {} };
      this.hideCalls = 0;
    }
    async loadURL() { this.emit('ready-to-show'); }
    show() {}
    hide() { this.hideCalls++; }
    removeMenu() {}
    focus() {}
    isMinimized() { return false; }
  }
  class FakeTray extends EventEmitter {
    constructor() { super(); trayInstance = this; }
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu; }
    displayBalloon() {}
  }
  const shell = createElectronShell({
    app,
    BrowserWindow: FakeWindow,
    // 健康的既有 server 只重用、不 fork；一旦 fork 就代表誤判。
    utilityProcess: { fork: () => { throw new Error('reused server must not fork'); } },
    dialog: { showErrorBox: () => {}, showMessageBoxSync: () => 1 },
    shell: { openExternal: () => {} },
    Tray: FakeTray,
    Menu: { buildFromTemplate: (template) => ({ template }) },
    nativeImage: { createFromPath: () => ({}) },
    clipboard: { writeText: () => {} },
    powerSaveBlocker: { start: () => 1, stop: () => {} },
    ipcMain: { on: () => {} },
    processObject: { env: {}, platform: 'win32' },
    fsImpl: { mkdirSync: () => {} },
    probeHealthImpl: async () => ({ state: 'healthy', payload: { status: 'ok' } }),
  });

  await shell.start();
  // 使用者按系統匣「結束」：走正常 app.quit 生命週期（會送出 before-quit）。
  trayInstance.menu.template.find((item) => item.label === '結束').click();
  eq(app.quitCalls, 1, '系統匣「結束」必須呼叫 app.quit：');
  // before-quit 之後 Electron 會逐一關窗；此時 close 絕不可再被攔截，否則 app.quit
  // 會被自家關窗流程卡住，程式永遠關不掉。
  const closeDuringQuit = { prevented: false, preventDefault() { this.prevented = true; } };
  windowInstance.emit('close', closeDuringQuit);
  eq(closeDuringQuit.prevented, false, '決定結束後關窗不可再被攔截（重用 server 時的關不掉主因）：');
  eq(windowInstance.hideCalls, 0, '結束流程不可把視窗藏到系統匣：');
});

test('播放音量在 SoundTouch 先啟動時仍會寫入記憶，KTV 掃色對齊逐字來源且走合成器', () => {
  // 同上：這裡有跨行片段的比對，worktree 取出的 CRLF 會誤判，先正規化行尾。
  const playback = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-playback.js'), 'utf8').replace(/\r\n/g, '\n');
  const ktv = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-template-ktv.js'), 'utf8');
  const display = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'display.js'), 'utf8');
  const panelCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'panel.css'), 'utf8');
  const displayCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'display.css'), 'utf8');
  ok(playback.includes('seeking: !finalize'), '拖曳歌詞同步必須明確標記，不能讓顯示端猜測：');
  ok(display.includes('const isScrubbing = data.seeking === true;') && !display.includes('now - lastSyncWall < 160'), '正常同步不可被誤判為拖曳而停掉 KTV 的 rAF 掃色：');
  ok(panelCss.includes('html.electron-shell .toast-container { top: calc(var(--desktop-windowbar-height) + 16px); }'), 'Electron 通知必須避開自訂標題列：');
  ok(playback.includes("if (typeof AudioProcessor !== 'undefined' && AudioProcessor.setVolume) {"), '音量改動必須一律交給 AudioProcessor 持久化：');
  ok(playback.includes('if (!audioProcessorReady) {\n        audioPlayer.volume = vol;'), 'AudioProcessor 未接管前仍要即時套到原生 audio：');
  ok(ktv.includes('scanTimes: buildScanTimes(seg.chars)'), 'KTV 必須保留每個字的來源掃色節點：');
  ok(ktv.includes('Math.max(previous.endMs, current.startMs, times[times.length - 1])'), 'KTV 字間空拍必須延長前一字，不能停住再追趕：');
  ok(ktv.includes('const fromPx = unit.offsets[charIndex] || 0;'), 'KTV 掃色必須依逐字像素邊界前進：');
  ok(ktv.includes('slot.fillWindow.style.transform') && !ktv.includes('slot.fill.style.clipPath'), 'KTV 逐幀掃色必須走 transform，不可重繪 clip-path：');
  ok(displayCss.includes('.ktv-fill-window') && displayCss.includes('will-change: transform'), 'KTV 填色窗口必須宣告合成器優先：');
  ok(ktv.includes('COUNTDOWN_GLYPHS') && ktv.includes('COUNTDOWN_ICON_COUNT = 5') && !ktv.includes('COUNTDOWN_PATTERNS'), 'KTV 間奏倒數必須是五個同圖案，星星與圓點不得混合：');
  ok(ktv.includes('FILLER_FULL_HOLD_MS = 2000') && ktv.includes('const fillerSweepEnd = countdownStart - FILLER_FULL_HOLD_MS;'), 'KTV 間奏文案必須在倒數前兩秒掃完：');
  ok(ktv.includes('showCountdown(curSlot, nextUnit, frac, seeking);') && ktv.includes('showPreview(nextSlot, nextUnit);'), 'KTV 倒數必須取代間奏行，並讓下一句提前在自己的行位顯示：');
  ok(ktv.includes('const stablePx = seeking ? requestedPx : Math.max(requestedPx, slot.maxFillPx || 0);'), 'KTV 倒數與間奏掃色必須在正常播放時單調前進，只有 seek 可回跳：');
});

test('KTV 掃色以 Facet 相同的下一字起點接續，字間空拍不會停住', () => {
  const kernelSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-motion-kernel.js'), 'utf8');
  const ktvSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-template-ktv.js'), 'utf8');
  const kernelSandbox = {};
  vm.runInNewContext(`${kernelSource}\n;globalThis.__motionForKtvTest = LyricMotion;`, kernelSandbox);
  const motion = kernelSandbox.__motionForKtvTest;
  motion.measureCharOffsets = (text) => Array.from(text).map((_, index) => index * 10).concat(Array.from(text).length * 10);

  const nodes = [];
  function makeNode() {
    const node = {
      children: [], style: {}, className: '', textContent: '', parentNode: null, clientWidth: 1280,
      appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
      removeChild(child) { this.children = this.children.filter((entry) => entry !== child); child.parentNode = null; },
    };
    nodes.push(node);
    return node;
  }
  const cssValues = {
    '--display-font-size': '42', '--display-font-family': 'sans-serif',
    '--lyric-color': '#ffffff', '--lyric-color-active': '#0400ff',
  };
  const templateSandbox = {
    LyricMotion: motion,
    LyricTemplates: { register(template) { this.template = template; } },
    document: { documentElement: {}, createElement: makeNode },
    window: { innerWidth: 1280 },
    getComputedStyle: () => ({ getPropertyValue: (name) => cssValues[name] || '' }),
    console,
  };
  vm.runInNewContext(ktvSource, templateSandbox, { filename: 'lyric-template-ktv.js' });

  let activeLines = [{
    time: 0, text: '甲乙丙',
    words: [
      { text: '甲', start: 0, duration: 100 },
      { text: '乙', start: 200, duration: 100 },
      { text: '丙', start: 300, duration: 100 },
    ],
  }];
  const ctx = { getLyrics: () => activeLines, isFastMode: () => false };
  const container = makeNode();
  const template = templateSandbox.LyricTemplates.template;
  template.mount(container, ctx);
  template.onLyricsLoaded(activeLines, ctx);

  template.onFrame(150, ctx);
  const topSlot = container.children[0].children[0];
  const fillWindow = topSlot.children[1];
  const fill = fillWindow.children[0];
  eq(fillWindow.style.transform, 'scaleX(0.25)', '字間 100ms 空拍必須讓前一字持續掃過：');
  eq(fill.style.transform, 'scaleX(4)', '反向縮放必須保持字形不變：');

  template.onFrame(200, ctx);
  eq(fillWindow.style.transform, 'scaleX(0.3333333333333333)', '下一字必須在來源起點 200ms 準時開始：');
  template.onFrame(400, ctx);
  eq(fillWindow.style.transform, 'scaleX(1)', '單位結束時必須填滿：');

  activeLines = [
    {
      time: 0, text: '甲',
      words: [{ text: '甲', start: 0, duration: 100 }],
    },
    {
      time: 12000, text: '乙',
      words: [{ text: '乙', start: 0, duration: 100 }],
    },
  ];
  template.onLyricsLoaded(activeLines, ctx);
  template.onFrame(1800, ctx);
  const interludeTop = container.children[0].children[0];
  const interludeTopFillWindow = interludeTop.children[1];
  ok(
    ['《Elitesand Pro伴唱歡樂無限》', '《間奏請稍後》', '《下一段即將開始》'].includes(interludeTop.children[0].textContent),
    '長間奏必須顯示可閱讀的間奏文字：',
  );
  eq(interludeTopFillWindow.style.transform, 'scaleX(0.13513513513513514)', '間奏文字必須沿可用的間奏時間慢速掃色：');
  template.onFrame(5000, ctx);
  eq(interludeTopFillWindow.style.transform, 'scaleX(1)', '間奏文字必須在倒數前兩秒掃完：');
  template.onFrame(6500, ctx);
  eq(interludeTopFillWindow.style.transform, 'scaleX(1)', '掃完的間奏文字必須完整停留到倒數接手：');

  template.onFrame(7000, ctx);
  const countdownTop = container.children[0].children[0];
  const previewBottom = container.children[0].children[1];
  const countdownText = countdownTop.children[0].textContent;
  ok(['★ ★ ★ ★ ★', '● ● ● ● ●'].includes(countdownText), '倒數必須是五個同圖案，不得混合星星與圓點：');
  eq(previewBottom.children[0].textContent, '乙', '倒數開始時必須同步顯示下一句，不能等起唱才突然出現：');
  eq(previewBottom.children[1].style.transform, 'scaleX(0)', '預先顯示的下一句必須維持未掃色：');
  eq(countdownTop.children[1].style.transform, 'scaleX(0)', '倒數開始時必須從零進度起跑：');
  template.onFrame(7500, ctx);
  eq(countdownTop.children[1].style.transform, 'scaleX(0.1)', '下一句前五秒才開始掃倒數圖案：');
  eq(previewBottom.children[0].textContent, '乙', '倒數掃色期間下一句必須穩定留在原行位：');
  template.onFrame(7450, ctx);
  eq(countdownTop.children[1].style.transform, 'scaleX(0.1)', '正常播放的微小回撥不可讓倒數圖案回彈：');
  template.onSeek(7450, ctx);
  eq(countdownTop.children[1].style.transform, 'scaleX(0.09)', '明確 seek 必須仍可讓倒數回跳到正確位置：');
  template.onFrame(12000, ctx);
  eq(countdownTop.children[0].textContent, '', '下一句起點必須立即清掉倒數：');
  eq(previewBottom.children[0].textContent, '乙', '下一句起點不得換行或跳位：');
  eq(previewBottom.children[1].style.transform, 'scaleX(0)', '下一句起點必須從尚未掃色的歌詞開始：');

  activeLines = [
    { time: 0, text: '甲', words: [{ text: '甲', start: 0, duration: 100 }] },
    { time: 7100, text: '乙', words: [{ text: '乙', start: 0, duration: 100 }] },
  ];
  template.onLyricsLoaded(activeLines, ctx);
  template.onFrame(1500, ctx);
  eq(container.children[0].children[0].children[0].textContent, '甲', '放不下完整階段的短間奏不可硬塞文案：');
  template.onFrame(2100, ctx);
  ok(
    ['★ ★ ★ ★ ★', '● ● ● ● ●'].includes(container.children[0].children[0].children[0].textContent),
    '短間奏也必須在倒數開始時用五格取代上一句：',
  );
  eq(container.children[0].children[1].children[0].textContent, '乙', '短間奏倒數開始時也必須同步預告下一句：');
  ok(
    container.children[0].children[1].children[1].style.transform === 'scaleX(0)',
    '短間奏預告的下一句不可提前掃色：',
  );
});

testAsync('Electron P1：系統匣結束會先 graceful shutdown，並釋放防休眠鎖', async () => {
  const { EventEmitter } = require('events');
  const { createElectronShell } = require('../electron/shell');
  let trayInstance;
  const shutdownMessages = [];
  const powerStops = [];
  let forkOptions;
  let windowOptions;
  const child = new EventEmitter();
  child.pid = 4321;
  child.postMessage = (message) => shutdownMessages.push(message);
  child.kill = () => { child.killed = true; };
  const app = new EventEmitter();
  app.setName = () => {};
  app.setAppUserModelId = () => {};
  app.requestSingleInstanceLock = () => true;
  app.whenReady = async () => {};
  app.getPath = () => path.join(TEST_RUNTIME_ROOT, 'electron-quit-unit');
  app.exitCodes = [];
  app.exit = (code) => app.exitCodes.push(code);
  app.quitCalls = 0;
  app.quit = () => {
    app.quitCalls++;
    app.emit('before-quit', { preventDefault() { this.prevented = true; } });
  };
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      windowOptions = options;
      this.webContents = { setWindowOpenHandler: () => {}, on: () => {} };
    }
    async loadURL() { this.emit('ready-to-show'); }
    show() {}
    hide() {}
    focus() {}
    isMinimized() { return false; }
  }
  class FakeTray extends EventEmitter {
    constructor() { super(); trayInstance = this; }
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu; }
  }
  let probes = 0;
  const desktop = createElectronShell({
    app,
    BrowserWindow: FakeWindow,
    utilityProcess: { fork: (_entry, _args, options) => { forkOptions = options; return child; } },
    dialog: { showErrorBox: () => {}, showMessageBoxSync: () => 1 },
    shell: { openExternal: () => {} },
    Tray: FakeTray,
    Menu: { buildFromTemplate: (template) => ({ template }) },
    nativeImage: { createFromPath: () => ({}) },
    clipboard: { writeText: () => {} },
    powerSaveBlocker: { start: () => 77, stop: (id) => powerStops.push(id) },
    processObject: { env: {}, platform: 'win32' },
    fsImpl: { mkdirSync: () => {} },
    probeHealthImpl: async () => (++probes === 1 ? { state: 'free' } : { state: 'healthy', payload: { status: 'ok' } }),
    delay: async () => {},
  });

  await desktop.start();
  eq(forkOptions.stdio, 'ignore', 'utilityProcess 不可建立會堵塞 server event loop 的 stdout/stderr pipe：');
  eq(windowOptions.icon, path.join(path.resolve(__dirname, '..'), 'assets', 'elitesand-pro.ico'),
    '桌面視窗必須從 Electron 殼資源讀取正式圖示：');
  trayInstance.menu.template.find((item) => item.label === '結束').click();
  await new Promise((resolve) => setImmediate(resolve));
  eq(app.quitCalls, 1);
  eq(shutdownMessages[0].type, 'elitesand:shutdown', '結束必須走既有 graceful shutdown 訊息：');
  ok(child.killed, '受控 server 未在期限內結束時才 fallback kill：');
  eq(powerStops.join(','), '77', '結束必須釋放 prevent-app-suspension：');
  eq(app.exitCodes.join(','), '0', '關閉完成才退出 Electron：');
});

// 規格 D5 語義：「重啟一次仍失敗就只留結束」——封頂的是「單次事故內的重試」，
// 成功恢復健康後，下一次（可能是數小時後的）事故仍可再重啟一次；直播中強迫
// 使用者整個重開程式比多按一次「重新啟動」更傷。每次事故都有對話框把關，
// 不會形成無人值守的重啟迴圈。
testAsync('Electron P1：server 意外退出每次事故可重啟一次，重啟失敗才只能結束', async () => {
  const { EventEmitter } = require('events');
  const { createElectronShell } = require('../electron/shell');
  const children = [];
  const dialogs = [];
  const app = new EventEmitter();
  app.setName = () => {};
  app.setAppUserModelId = () => {};
  app.requestSingleInstanceLock = () => true;
  app.whenReady = async () => {};
  app.getPath = () => path.join(TEST_RUNTIME_ROOT, 'electron-restart-unit');
  app.exit = () => {};
  app.quitCalls = 0;
  app.quit = () => { app.quitCalls++; app.emit('before-quit', { preventDefault: () => {} }); };
  class FakeWindow extends EventEmitter {
    constructor() { super(); this.webContents = { setWindowOpenHandler: () => {}, on: () => {} }; }
    async loadURL() { this.emit('ready-to-show'); }
    show() {}
    hide() {}
    focus() {}
    isMinimized() { return false; }
  }
  class FakeTray extends EventEmitter {
    setToolTip() {}
    setContextMenu() {}
  }
  let probes = 0;
  let failRestartProbes = false;
  const desktop = createElectronShell({
    startTimeoutMs: 50,
    app,
    BrowserWindow: FakeWindow,
    utilityProcess: {
      fork: () => {
        const child = new EventEmitter();
        child.pid = 5000 + children.length;
        child.postMessage = () => {};
        child.kill = () => {};
        children.push(child);
        return child;
      },
    },
    dialog: {
      showErrorBox: () => {},
      showMessageBoxSync: (options) => { dialogs.push(options); return 0; },
    },
    shell: { openExternal: () => {} },
    Tray: FakeTray,
    Menu: { buildFromTemplate: () => ({}) },
    nativeImage: { createFromPath: () => ({}) },
    clipboard: { writeText: () => {} },
    powerSaveBlocker: { start: () => 1, stop: () => {} },
    processObject: { env: {}, platform: 'win32' },
    fsImpl: { mkdirSync: () => {} },
    probeHealthImpl: async () => {
      if (failRestartProbes) return { state: 'free' };
      return ++probes === 1 ? { state: 'free' } : { state: 'healthy', payload: { status: 'ok' } };
    },
    delay: async () => {},
  });

  await desktop.start();
  children[0].emit('exit', 9);
  await new Promise((resolve) => setImmediate(resolve));
  eq(children.length, 2, '第一次意外退出允許重 fork 一次：');
  eq(dialogs[0].buttons.join('|'), '重新啟動伺服器|結束');
  // 重啟成功恢復健康 → 下一次事故仍可再重啟一次（per-incident，不是一生一次）
  children[1].emit('exit', 10);
  await new Promise((resolve) => setImmediate(resolve));
  eq(dialogs[1].buttons.join('|'), '重新啟動伺服器|結束', '恢復健康後的下一次事故仍可重啟：');
  eq(children.length, 3, '第二次事故同樣重 fork 一次：');
  eq(app.quitCalls, 0, '成功恢復期間不得結束程式：');
  // 這次讓重啟後的 health 永遠不過 → 事故內重試失敗 → 只剩結束
  failRestartProbes = true;
  children[2].emit('exit', 11);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 120));
  eq(dialogs[dialogs.length - 1].buttons.join('|'), '結束', '重啟失敗後只能結束：');
  eq(app.quitCalls, 1);
});
