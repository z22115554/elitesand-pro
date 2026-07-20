'use strict';

// The Electron main process is deliberately a thin host around the existing
// HTTP server.  It does not replace the socket, PIN, OBS, or playback layers.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { SHUTDOWN_MESSAGE } = require('../server/utils/parent-shutdown');

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
  processObject = process,
  fsImpl = fs,
  probeHealthImpl = probeHealth,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  projectRoot = path.resolve(__dirname, '..'),
  port = resolveShellPort(processObject.env.ELITESAND_SHELL_PORT),
  startTimeoutMs = START_TIMEOUT_MS,
  healthIntervalMs = HEALTH_INTERVAL_MS,
  shutdownTimeoutMs = SHUTDOWN_TIMEOUT_MS,
  headless = processObject.env.ELITESAND_SHELL_HEADLESS === '1',
  autoQuitAfterReadyMs = Number.parseInt(processObject.env.ELITESAND_SHELL_QUIT_AFTER_READY_MS || '0', 10) || 0,
  userDataPath = processObject.env.ELITESAND_SHELL_USER_DATA_DIR || '',
} = {}) {
  if (!app || !BrowserWindow || !utilityProcess || !dialog || !shell || !Tray || !Menu || !nativeImage || !clipboard) {
    throw new TypeError('createElectronShell requires Electron app, BrowserWindow, utilityProcess, dialog, shell, Tray, Menu, nativeImage, and clipboard');
  }

  const serverEntry = path.join(projectRoot, 'server', 'index.js');
  const preload = path.join(projectRoot, 'electron', 'preload.js');
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

  function hideWindowToTray(event, window) {
    if (isQuitting) return;
    if (!tray) {
      app.quit();
      return;
    }
    event.preventDefault();
    window.hide();
    if (!hasShownTrayBalloon && processObject.platform === 'win32') {
      hasShownTrayBalloon = true;
      try {
        tray.displayBalloon({
          title: 'Elitesand Pro 仍在執行',
          content: '程式仍在執行，音訊不中斷；從系統匣結束。',
        });
      } catch (_) { /* Tray balloons are optional shell feedback. */ }
    }
  }

  function runtimeEnvironment() {
    const runtimePaths = getRuntimePaths(app.getPath('userData'));
    ensureRuntimePaths(runtimePaths, fsImpl);
    return {
      ...processObject.env,
      PORT: String(port),
      OPEN_BROWSER: '0',
      ELITESAND_SHELL: '1',
      ELITESAND_DATA_DIR: runtimePaths.dataDir,
      ELITESAND_DOWNLOADS_DIR: runtimePaths.downloadsDir,
      ELITESAND_LOGS_DIR: runtimePaths.logsDir,
    };
  }

  async function createWindow() {
    const window = new BrowserWindow({
      width: 1280,
      height: 850,
      minWidth: 960,
      minHeight: 650,
      show: false,
      backgroundColor: '#101114',
      title: 'Elitesand Pro',
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    mainWindow = window;
    window.once('ready-to-show', () => {
      if (!headless) window.show();
    });
    window.on('close', (event) => hideWindowToTray(event, window));
    window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isProjectReleaseUrl(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (!isTrustedLocalUrl(url, port)) event.preventDefault();
    });
    await window.loadURL(`http://127.0.0.1:${port}/panel`);
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

  function startServer() {
    serverProcess = utilityProcess.fork(serverEntry, [], {
      cwd: projectRoot,
      env: runtimeEnvironment(),
      stdio: 'pipe',
      serviceName: 'Elitesand Pro Server',
    });
    serverProcess.on('exit', (code) => {
      startupExitCode = code;
      if (serverReady && !isQuitting) {
        dialog.showErrorBox('Elitesand Pro 已停止', `本機服務意外結束（代碼 ${code}）。請查看記錄後重新開啟程式。`);
        app.exit(1);
      }
    });
    return serverProcess;
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
    if (!ownsServer || !serverProcess?.pid) return;
    try { serverProcess.postMessage({ type: SHUTDOWN_MESSAGE }); } catch (_) { /* Best effort before the force timeout. */ }
    await waitForExit(serverProcess, shutdownTimeoutMs, delay);
    if (serverProcess?.pid) {
      try { serverProcess.kill(); } catch (_) { /* Already gone or unavailable. */ }
    }
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
      if (isQuitting || !ownsServer || !serverProcess?.pid) return;
      event.preventDefault();
      isQuitting = true;
      shutdownOwnedServer().finally(() => app.exit(0));
    });
    app.on('window-all-closed', () => app.quit());
    await app.whenReady();
    try {
      const server = await startServerOrReuseExisting();
      serverReady = true;
      createTray();
      await createWindow();
      if (autoQuitAfterReadyMs > 0) setTimeout(() => app.quit(), autoQuitAfterReadyMs).unref?.();
      return { started: true, ...server };
    } catch (error) {
      dialog.showErrorBox('Elitesand Pro 無法啟動', `${error.message}\n\n請確認 port ${port} 沒有被其他程式占用後再試。`);
      await shutdownOwnedServer();
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
