'use strict';

// The Electron main process is deliberately a thin host around the existing
// HTTP server.  It does not replace the socket, PIN, OBS, or playback layers.
const fs = require('fs');
const http = require('http');
const path = require('path');

const DEFAULT_PORT = 3000;
const START_TIMEOUT_MS = 15000;
const HEALTH_INTERVAL_MS = 250;
const SHUTDOWN_TIMEOUT_MS = 5000;

function resolveShellPort(value) {
  const port = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT;
}

function getRuntimePaths(userDataPath) {
  const root = path.resolve(userDataPath);
  return {
    root,
    dataDir: path.join(root, 'data'),
    downloadsDir: path.join(root, 'downloads'),
    logsDir: path.join(root, 'logs'),
  };
}

function ensureRuntimePaths(paths, fsImpl = fs) {
  for (const directory of [paths.root, paths.dataDir, paths.downloadsDir, paths.logsDir]) {
    fsImpl.mkdirSync(directory, { recursive: true });
  }
}

function isTrustedLocalUrl(rawUrl, port) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:'
      && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
      && Number(url.port || 80) === port;
  } catch (_) {
    return false;
  }
}

function isProjectReleaseUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.pathname.startsWith('/z22115554/elitesand-pro');
  } catch (_) {
    return false;
  }
}

function probeHealth(port, { httpImpl = http, timeoutMs = 1000 } = {}) {
  return new Promise((resolve) => {
    const request = httpImpl.get({
      hostname: '127.0.0.1',
      port,
      path: '/api/health',
      timeout: timeoutMs,
      headers: { 'User-Agent': 'ElitesandProElectronShell/1.0' },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (response.statusCode === 200 && payload?.status === 'ok') {
            resolve({ state: 'healthy', payload });
            return;
          }
        } catch (_) { /* A listener is using this port, but not Elitesand Pro. */ }
        resolve({ state: 'occupied' });
      });
    });
    request.once('timeout', () => request.destroy(new Error('health request timed out')));
    request.once('error', (error) => {
      resolve(error?.code === 'ECONNREFUSED' ? { state: 'free' } : { state: 'occupied' });
    });
  });
}

function waitForExit(child, timeoutMs, delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  if (!child) return Promise.resolve();
  return Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(timeoutMs),
  ]);
}

function createElectronShell({
  app,
  BrowserWindow,
  utilityProcess,
  dialog,
  shell,
  Tray,
  Menu,
  nativeImage,
  clipboard,
  powerSaveBlocker,
  ipcMain = null,
  processObject = process,
  fsImpl = fs,
  probeHealthImpl = probeHealth,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  projectRoot = path.resolve(__dirname, '..'),
  shellRoot = path.resolve(__dirname, '..'),
  port = resolveShellPort(processObject.env.ELITESAND_SHELL_PORT),
  startTimeoutMs = START_TIMEOUT_MS,
  healthIntervalMs = HEALTH_INTERVAL_MS,
  shutdownTimeoutMs = SHUTDOWN_TIMEOUT_MS,
  headless = processObject.env.ELITESAND_SHELL_HEADLESS === '1',
  autoQuitAfterReadyMs = Number.parseInt(processObject.env.ELITESAND_SHELL_QUIT_AFTER_READY_MS || '0', 10) || 0,
  userDataPath = processObject.env.ELITESAND_SHELL_USER_DATA_DIR || '',
} = {}) {
  if (!app || !BrowserWindow || !utilityProcess || !dialog || !shell || !Tray || !Menu || !nativeImage || !clipboard || !powerSaveBlocker) {
    throw new TypeError('createElectronShell requires Electron app, BrowserWindow, utilityProcess, dialog, shell, Tray, Menu, nativeImage, clipboard, and powerSaveBlocker');
  }

  const { SHUTDOWN_MESSAGE } = require(path.join(projectRoot, 'server', 'utils', 'parent-shutdown'));
  const serverEntry = path.join(projectRoot, 'server', 'index.js');
  const preload = path.join(shellRoot, 'electron', 'preload.js');
  let mainWindow = null;
  // Keep the Tray instance in this closure. Electron will garbage-collect an
  // unreferenced tray icon, which would make a hidden window unrecoverable.
  let tray = null;
  let serverProcess = null;
  let ownsServer = false;
  let isQuitting = false;
  let serverReady = false;
  let startupExitCode = null;
  let hasShownTrayBalloon = false;
  let isCloseDecisionPending = false;
  let powerSaveBlockerId = null;
  let serverRestartAttempted = false;
  let shouldShowPortableDataMigrationNotice = false;

  function focusWindow() {
    if (!mainWindow) return;
    if (mainWindow.isMinimized?.()) mainWindow.restore();
    mainWindow.show?.();
    mainWindow.focus?.();
  }

  function createTray() {
    if (headless) return null;
    try {
      const icon = nativeImage.createFromPath(path.join(projectRoot, 'public', 'img', 'logo-icon.png'));
      tray = new Tray(icon);
      tray.setToolTip?.('Elitesand Pro');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: '顯示面板', click: focusWindow },
        { label: '複製 OBS 歌詞網址', click: () => clipboard.writeText(`http://localhost:${port}/display`) },
        { label: '複製 OBS 歌單網址', click: () => clipboard.writeText(`http://localhost:${port}/setlist`) },
        { label: '結束', click: () => app.quit() },
      ]));
      tray.on('double-click', focusWindow);
      return tray;
    } catch (error) {
      // A tray is occasionally unavailable in constrained desktop sessions.
      // In that case a close must remain a real exit, never a hidden window
      // the user has no way to bring back.
      tray = null;
      console.warn('[Elitesand Pro Electron] System tray unavailable:', error?.message || error);
      return null;
    }
  }

  function moveWindowToTray(window) {
    window.hide();
    if (!hasShownTrayBalloon && processObject.platform === 'win32') {
      hasShownTrayBalloon = true;
      try {
        tray.displayBalloon({
          title: 'Elitesand Pro 仍在執行',
          content: '程式已收到系統匣；音訊與 OBS 會繼續運作。',
        });
      } catch (_) { /* Tray balloons are optional shell feedback. */ }
    }
  }

  function hideWindowToTray(event, window) {
    if (isQuitting) return;
    if (!tray) {
      app.quit();
      return;
    }
    event.preventDefault();
    if (ipcMain?.on && typeof window.webContents?.send === 'function') {
      isCloseDecisionPending = true;
      window.webContents.send('elitesand:close-requested');
      return;
    }
    const choice = dialog.showMessageBoxSync({
      type: 'question',
      title: '要結束 Elitesand Pro 嗎？',
      message: '確認關閉會停止本機服務與音訊。收到系統匣會讓程式繼續執行，OBS 與音訊不中斷。',
      buttons: ['確認關閉', '收到系統匣'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (choice === 0) {
      app.quit();
      return;
    }
    moveWindowToTray(window);
  }

  function startPowerSaveBlocker() {
    if (powerSaveBlockerId !== null) return;
    try {
      powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    } catch (error) {
      console.warn('[Elitesand Pro Electron] Could not prevent system suspension:', error?.message || error);
    }
  }

  function stopPowerSaveBlocker() {
    if (powerSaveBlockerId === null) return;
    try { powerSaveBlocker.stop(powerSaveBlockerId); } catch (_) { /* Electron is already closing. */ }
    powerSaveBlockerId = null;
  }

  function runtimeEnvironment() {
    const runtimePaths = getRuntimePaths(app.getPath('userData'));
    ensureRuntimePaths(runtimePaths, fsImpl);
    const packagedTools = app.isPackaged
      ? path.join(processObject.resourcesPath || process.resourcesPath, 'tools')
      : '';
    // Windows 的環境變數鍵通常是 "Path"：必須覆寫「既有的那個鍵」。若另外新增一個
    // "PATH" 鍵，環境區塊裡出現大小寫不同的重複鍵，子程序採用哪個是未定義行為，
    // 前置的 tools 目錄可能整個失效（＝打包版 yt-dlp/ffmpeg 找不到、匯入直接壞）。
    const pathKey = Object.keys(processObject.env).find((key) => key.toUpperCase() === 'PATH') || 'PATH';
    const inheritedPath = processObject.env[pathKey] || '';
    return {
      ...processObject.env,
      ...(packagedTools ? { [pathKey]: `${packagedTools}${path.delimiter}${inheritedPath}` } : {}),
      PORT: String(port),
      OPEN_BROWSER: '0',
      ELITESAND_SHELL: '1',
      ELITESAND_DATA_DIR: runtimePaths.dataDir,
      ELITESAND_DOWNLOADS_DIR: runtimePaths.downloadsDir,
      ELITESAND_LOGS_DIR: runtimePaths.logsDir,
    };
  }

  function needsPortableDataMigrationNotice() {
    if (!app.isPackaged) return false;
    const runtimePaths = getRuntimePaths(app.getPath('userData'));
    const marker = path.join(runtimePaths.root, '.portable-data-migration-notice-v1');
    const isEmpty = [runtimePaths.dataDir, runtimePaths.downloadsDir]
      .every((directory) => {
        try { return fsImpl.readdirSync(directory).length === 0; } catch (_) { return true; }
      });
    return isEmpty && !fsImpl.existsSync?.(marker);
  }

  function showPortableDataMigrationNotice() {
    if (!shouldShowPortableDataMigrationNotice) return;
    const runtimePaths = getRuntimePaths(app.getPath('userData'));
    const marker = path.join(runtimePaths.root, '.portable-data-migration-notice-v1');
    try { fsImpl.writeFileSync?.(marker, 'shown\n', 'utf8'); } catch (_) { /* A notice must never block startup. */ }
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'Elitesand Pro 資料位置',
      message: `這是新的安裝版資料目錄：\n${runtimePaths.root}\n\n若要沿用可攜版資料，請手動把舊版的 data/ 與 downloads/ 複製到這裡。程式不會自動搬移資料。`,
      buttons: ['知道了'],
      defaultId: 0,
      noLink: true,
    });
    shouldShowPortableDataMigrationNotice = false;
  }

  async function createWindow() {
    const window = new BrowserWindow({
      width: 1280,
      height: 850,
      minWidth: 960,
      minHeight: 650,
      show: false,
      backgroundColor: '#20222a',
      title: 'Elitesand Pro',
      // The panel owns the entire title strip, including controls, so the
      // chrome stays visually consistent across Windows versions.
      frame: false,
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    mainWindow = window;
    window.removeMenu?.();
    if (ipcMain?.on) {
      ipcMain.on('elitesand:close-decision', (event, action) => {
        if (event?.sender !== window.webContents || !isCloseDecisionPending) return;
        if (action === 'quit') {
          isCloseDecisionPending = false;
          app.quit();
          return;
        }
        if (action === 'tray') {
          isCloseDecisionPending = false;
          moveWindowToTray(window);
        }
      });
      ipcMain.on('elitesand:window-control', (event, action) => {
        if (event?.sender !== window.webContents) return;
        if (action === 'minimize') {
          window.minimize?.();
          return;
        }
        if (action === 'toggle-maximize') {
          if (window.isMaximized?.()) window.unmaximize?.();
          else window.maximize?.();
          return;
        }
        if (action === 'close') window.close?.();
      });
    }
    window.once('ready-to-show', () => {
      if (!headless) window.show();
    });
    window.on('close', (event) => hideWindowToTray(event, window));
    window.on('maximize', () => window.webContents.send?.('elitesand:window-maximized', true));
    window.on('unmaximize', () => window.webContents.send?.('elitesand:window-maximized', false));
    window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isProjectReleaseUrl(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (!isTrustedLocalUrl(url, port)) event.preventDefault();
    });
    await window.loadURL(`http://127.0.0.1:${port}/panel?electronShell=1`);
    return window;
  }

  async function waitForHealthyServer() {
    const deadline = Date.now() + startTimeoutMs;
    let lastState = 'free';
    while (Date.now() < deadline) {
      if (startupExitCode !== null) throw new Error(`Elitesand Pro server exited during startup (code ${startupExitCode})`);
      const result = await probeHealthImpl(port);
      lastState = result?.state || 'occupied';
      if (lastState === 'healthy') return result.payload;
      if (lastState === 'occupied') throw new Error(`Port ${port} is already occupied by another application`);
      await delay(healthIntervalMs);
    }
    throw new Error(`Elitesand Pro server did not become ready on port ${port} (${lastState})`);
  }

  async function handleUnexpectedServerExit(code) {
    if (!serverReady || isQuitting) return;
    serverReady = false;
    if (serverRestartAttempted) {
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'Elitesand Pro 已停止',
        message: `本機服務再次意外結束（代碼 ${code}）。請查看記錄後重新開啟程式。`,
        buttons: ['結束'],
        defaultId: 0,
        noLink: true,
      });
      app.quit();
      return;
    }

    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: 'Elitesand Pro 伺服器意外停止',
      message: `本機服務意外結束（代碼 ${code}）。是否重新啟動伺服器？`,
      buttons: ['重新啟動伺服器', '結束'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (choice !== 0 || isQuitting) {
      app.quit();
      return;
    }

    serverRestartAttempted = true;
    startupExitCode = null;
    try {
      startServer();
      await waitForHealthyServer();
      serverReady = true;
      // 恢復健康後歸零：語義是「每次事故重試一次」，不是「整個程式生命週期只有一次」。
      // 每次崩潰都有對話框把關，不會形成無人值守的重啟迴圈。
      serverRestartAttempted = false;
      focusWindow();
    } catch (error) {
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'Elitesand Pro 無法重新啟動',
        message: `${error.message}\n\n請查看記錄後重新開啟程式。`,
        buttons: ['結束'],
        defaultId: 0,
        noLink: true,
      });
      app.quit();
    }
  }

  function startServer() {
    const child = utilityProcess.fork(serverEntry, [], {
      cwd: projectRoot,
      env: runtimeEnvironment(),
      stdio: 'pipe',
      serviceName: 'Elitesand Pro Server',
    });
    serverProcess = child;
    child.on('exit', (code) => {
      startupExitCode = code;
      if (serverProcess === child) serverProcess = null;
      void handleUnexpectedServerExit(code);
    });
    return child;
  }

  async function startServerOrReuseExisting() {
    const existing = await probeHealthImpl(port);
    if (existing?.state === 'healthy') return { reused: true, health: existing.payload };
    if (existing?.state === 'occupied') throw new Error(`Port ${port} is already occupied by another application`);
    ownsServer = true;
    startServer();
    return { reused: false, health: await waitForHealthyServer() };
  }

  async function shutdownOwnedServer() {
    const child = serverProcess;
    if (!ownsServer || !child?.pid) return;
    try { child.postMessage({ type: SHUTDOWN_MESSAGE }); } catch (_) { /* Best effort before the force timeout. */ }
    await waitForExit(child, shutdownTimeoutMs, delay);
    if (child.pid) {
      try { child.kill(); } catch (_) { /* Already gone or unavailable. */ }
    }
    if (serverProcess === child) serverProcess = null;
  }

  function showStartupError(error) {
    if (/already occupied by another application/.test(error?.message || '')) {
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        title: 'port 已被占用',
        message: `port ${port} 已被占用——可能已有一份 Elitesand Pro 在執行（含 npm start 的開發實例）。`,
        buttons: ['開啟既有面板', '結束'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (choice === 0) shell.openExternal(`http://127.0.0.1:${port}/panel`);
      return;
    }
    dialog.showErrorBox('Elitesand Pro 無法啟動', `${error.message}\n\n請確認 port ${port} 沒有被其他程式占用後再試。`);
  }

  async function start() {
    // This is only supplied by the lifecycle smoke. It must happen before
    // requesting Electron's single-instance lock, otherwise a smoke run can
    // collide with an open real application.
    if (String(userDataPath || '').trim() && typeof app.setPath === 'function') {
      app.setPath('userData', path.resolve(userDataPath));
    }
    app.setName?.('Elitesand Pro');
    app.setAppUserModelId?.('com.elitesand.pro');
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return { started: false, reason: 'second-instance' };
    }
    app.on('second-instance', focusWindow);
    app.on('before-quit', (event) => {
      stopPowerSaveBlocker();
      if (isQuitting) return;
      // 一旦決定結束就立刻標記，讓稍後 Electron 關窗序列裡的 window 'close'
      // 事件（hideWindowToTray）直接放行，而不是又 preventDefault 把整個 app.quit
      // 卡住。這對「重用既有 server（ownsServer=false）」尤其關鍵：那條路徑本來不會
      // 設 isQuitting，於是系統匣「結束」與確認關閉都會被關窗攔截而永遠關不掉。
      isQuitting = true;
      if (!ownsServer || !serverProcess?.pid) return;
      event.preventDefault();
      shutdownOwnedServer().finally(() => app.exit(0));
    });
    await app.whenReady();
    // Snapshot before the server creates its state files. Checking after the
    // fork makes a genuinely first-run data directory look non-empty, so the
    // portable-data handoff notice would never be shown.
    shouldShowPortableDataMigrationNotice = needsPortableDataMigrationNotice();
    startPowerSaveBlocker();
    try {
      const server = await startServerOrReuseExisting();
      serverReady = true;
      showPortableDataMigrationNotice();
      createTray();
      await createWindow();
      if (autoQuitAfterReadyMs > 0) setTimeout(() => app.quit(), autoQuitAfterReadyMs).unref?.();
      return { started: true, ...server };
    } catch (error) {
      showStartupError(error);
      await shutdownOwnedServer();
      stopPowerSaveBlocker();
      app.exit(1);
      throw error;
    }
  }

  return {
    start,
    shutdownOwnedServer,
    focusWindow,
    getState: () => ({ port, ownsServer, serverReady, hasWindow: !!mainWindow, serverPid: serverProcess?.pid || null }),
  };
}

module.exports = {
  DEFAULT_PORT,
  START_TIMEOUT_MS,
  HEALTH_INTERVAL_MS,
  SHUTDOWN_TIMEOUT_MS,
  resolveShellPort,
  getRuntimePaths,
  ensureRuntimePaths,
  isTrustedLocalUrl,
  isProjectReleaseUrl,
  probeHealth,
  waitForExit,
  createElectronShell,
};
