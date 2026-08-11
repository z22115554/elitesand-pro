'use strict';

// The Electron main process is deliberately a thin host around the existing
// HTTP server.  It does not replace the socket, PIN, OBS, or playback layers.
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_PORT = 3000;
const START_TIMEOUT_MS = 15000;
const HEALTH_INTERVAL_MS = 250;
const SHUTDOWN_TIMEOUT_MS = 5000;

function resolveShellPort(value) {
  const port = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT;
}

const MEDIA_FOLDER_NAME = 'Elitesand Pro Media';
const MEDIA_MARKER_NAME = '.elitesand-pro-media-root';

const INSTALLER_LOCALE_FILE = 'installer-locale.txt';
// Keep the shell independent from renderer assets. The packaged Electron shell
// and the web application now live together in app.asar, so all packaged paths
// resolve from one integrity-protected application root.
const VALID_LOCALES = new Set(['zh-TW', 'en', 'ja', 'ko', 'zh-CN']);

// electron/installer.nsh writes this marker with the language the user picked
// in the installer wizard, since that choice has no other way to reach the
// renderer's i18n layer. Consumed (and deleted) at most once, on the very
// first launch after install/reinstall; later launches fall back to the
// panel's normal saved-preference/browser-locale detection.
function consumeInstallerLocale(userDataPath, fsImpl = fs) {
  const file = path.join(path.resolve(userDataPath), INSTALLER_LOCALE_FILE);
  let locale = null;
  try {
    const raw = fsImpl.readFileSync(file, 'utf8').trim();
    if (VALID_LOCALES.has(raw)) locale = raw;
  } catch (_) { /* no marker: dev mode, Portable build, or already consumed */ }
  try { fsImpl.unlinkSync(file); } catch (_) { /* best effort; missing file is fine */ }
  return locale;
}

function getRuntimePaths(userDataPath, downloadsDir) {
  const root = path.resolve(userDataPath);
  return {
    root,
    dataDir: path.join(root, 'data'),
    downloadsDir: downloadsDir ? path.resolve(downloadsDir) : path.join(root, 'downloads'),
    logsDir: path.join(root, 'logs'),
  };
}

function hasFiles(directory, fsImpl = fs) {
  try { return fsImpl.readdirSync(directory).length > 0; } catch (_) { return false; }
}

function readConfiguredMediaDir(userDataPath, fsImpl = fs) {
  try {
    const file = path.join(path.resolve(userDataPath), 'data', 'media-storage.json');
    const parsed = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
    return typeof parsed?.mediaDir === 'string' && path.isAbsolute(parsed.mediaDir)
      ? path.resolve(parsed.mediaDir)
      : null;
  } catch (_) {
    return null;
  }
}

function resolveMediaRuntime(userDataPath, { isPackaged = false, executablePath = '', fsImpl = fs } = {}) {
  const legacyDir = path.join(path.resolve(userDataPath), 'downloads');
  const configuredDir = readConfiguredMediaDir(userDataPath, fsImpl);
  // A migration writes this setting for both the development shell and the
  // packaged app. Ignoring it in development made a successful move appear
  // to revert after relaunch, with every new import returning to userData.
  if (configuredDir && fsImpl.existsSync?.(configuredDir)) return { downloadsDir: configuredDir, mode: 'configured' };
  if (!isPackaged) return { downloadsDir: legacyDir, mode: 'legacy' };
  if (hasFiles(legacyDir, fsImpl)) return { downloadsDir: legacyDir, mode: 'legacy-migration-required' };
  // A stale configuration must not become a new empty migration source.
  // The server will automatically search the legacy locations during a
  // migration, without asking the user to locate them manually.
  if (configuredDir) return { downloadsDir: configuredDir, mode: 'configured-missing' };
  const installRoot = path.dirname(path.resolve(executablePath || process.execPath));
  return { downloadsDir: path.join(installRoot, MEDIA_FOLDER_NAME), mode: 'install-default' };
}

function persistPackagedMediaReference(runtimePaths, mediaRuntime, fsImpl = fs) {
  if (!mediaRuntime || ['legacy-migration-required', 'configured-missing'].includes(mediaRuntime.mode)) return;
  const mediaDir = runtimePaths.downloadsDir;
  const marker = path.join(mediaDir, MEDIA_MARKER_NAME);
  try {
    fsImpl.mkdirSync(mediaDir, { recursive: true });
    if (!fsImpl.existsSync(marker)) fsImpl.writeFileSync(marker, 'Elitesand Pro managed media root\n', 'utf8');
    fsImpl.mkdirSync(runtimePaths.dataDir, { recursive: true });
    const config = path.join(runtimePaths.dataDir, 'media-storage.json');
    if (!fsImpl.existsSync(config)) fsImpl.writeFileSync(config, `${JSON.stringify({ version: 1, mediaDir }, null, 2)}\n`, 'utf8');
    fsImpl.writeFileSync(path.join(runtimePaths.root, 'media-storage.ini'), `[media]\npath=${mediaDir}\n`, 'utf8');
  } catch (_) {
    // Media storage should never prevent the local server from starting.
  }
}

function ensureRuntimePaths(paths, fsImpl = fs, { includeDownloads = true } = {}) {
  const directories = [paths.root, paths.dataDir, paths.logsDir];
  if (includeDownloads) directories.splice(2, 0, paths.downloadsDir);
  for (const directory of directories) {
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

// Twitch device-code 授權會回一個官方驗證頁（verification_uri，通常是
// https://www.twitch.tv/activate）。面板的「前往 Twitch 輸入代碼」是 target=_blank，
// 在殼裡走 setWindowOpenHandler；不放行的話會被 deny → 按了沒反應，授權整條走不下去。
// 值來自 Twitch 自己的 OAuth 回應，這裡只再收斂到 twitch.tv 網域做防禦深度。
function isTwitchVerificationUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'www.twitch.tv' || host === 'twitch.tv' || host === 'id.twitch.tv';
  } catch (_) {
    return false;
  }
}

// 跟唱視圖（面板頂欄「跟唱視圖」按鈕）走 window.open 開新分頁；殼裡預設 deny 一切
// window.open（見下方 setWindowOpenHandler），不特別放行的話按了會完全沒反應。
// 只收斂到自己 server 的 /prompter 這條路徑，不是任何同源網址都放行。
function isPrompterUrl(rawUrl, port) {
  if (!isTrustedLocalUrl(rawUrl, port)) return false;
  try {
    return new URL(rawUrl).pathname === '/prompter';
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

function verifyPackagedResourceIntegrity(resourcesPath, manifest, fsImpl = fs) {
  const files = manifest?.files;
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length === 0) {
    throw new Error('Packaged resource integrity manifest is missing or invalid.');
  }

  const root = path.resolve(resourcesPath);
  const rootPrefix = `${root}${path.sep}`;
  for (const [relativePath, expectedHash] of Object.entries(files)) {
    if (typeof relativePath !== 'string' || !relativePath.startsWith('tools/') ||
      relativePath.includes('..') || !/^[a-f0-9]{64}$/i.test(String(expectedHash || ''))) {
      throw new Error('Packaged resource integrity manifest contains an unsafe entry.');
    }
    const target = path.resolve(root, ...relativePath.split('/'));
    if (!target.startsWith(rootPrefix)) throw new Error('Packaged resource integrity path escaped resources.');
    let actualHash;
    try {
      actualHash = crypto.createHash('sha256').update(fsImpl.readFileSync(target)).digest('hex');
    } catch (_) {
      throw new Error(`Required packaged resource is missing: ${relativePath}`);
    }
    if (actualHash !== String(expectedHash).toLowerCase()) {
      throw new Error(`Packaged resource integrity check failed: ${relativePath}`);
    }
  }
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
  packagedResourceIntegrity = null,
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
    const mediaRuntime = resolveMediaRuntime(app.getPath('userData'), {
      isPackaged: app.isPackaged,
      executablePath: app.getPath?.('exe') || processObject.execPath,
      fsImpl,
    });
    const runtimePaths = getRuntimePaths(app.getPath('userData'), mediaRuntime.downloadsDir);
    ensureRuntimePaths(runtimePaths, fsImpl, { includeDownloads: mediaRuntime.mode !== 'configured-missing' });
    if (app.isPackaged) persistPackagedMediaReference(runtimePaths, mediaRuntime, fsImpl);
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
      // Production-only remote announcements must never lock the source-tree
      // Electron shell. The packaged installer deliberately receives `0`.
      ELITESAND_SHELL_DEVELOPMENT: app.isPackaged ? '0' : '1',
      ELITESAND_DATA_DIR: runtimePaths.dataDir,
      ELITESAND_DOWNLOADS_DIR: runtimePaths.downloadsDir,
      ELITESAND_LOGS_DIR: runtimePaths.logsDir,
      ELITESAND_MEDIA_STORAGE_MODE: mediaRuntime.mode,
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
      icon: path.join(shellRoot, 'assets', 'elitesand-pro.ico'),
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
    if (ipcMain?.handle) {
      ipcMain.handle('elitesand:choose-media-location', async (event) => {
        if (event?.sender !== window.webContents || typeof dialog.showOpenDialog !== 'function') return null;
        const result = await dialog.showOpenDialog(window, {
          title: 'Choose a new media storage location',
          properties: ['openDirectory', 'createDirectory'],
        });
        return result?.canceled || !result?.filePaths?.[0] ? null : result.filePaths[0];
      });
      ipcMain.handle('elitesand:restart-after-media-migration', (event) => {
        if (event?.sender !== window.webContents) return false;
        app.relaunch?.();
        // Do not use app.exit(): it bypasses before-quit, leaving the owned
        // Node server without its graceful shutdown and clean-session marker.
        app.quit?.();
        return true;
      });
    }
    if (ipcMain?.on) {
      ipcMain.on('elitesand:close-decision', (event, action) => {
        if (event?.sender !== window.webContents || !isCloseDecisionPending) return;
        if (action === 'cancel') {
          // 放棄本次關閉：關窗事件已 preventDefault，視窗維持原狀，不藏匣也不結束。
          isCloseDecisionPending = false;
          return;
        }
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
      if (isProjectReleaseUrl(url) || isTwitchVerificationUrl(url)) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
      // 跟唱視圖用一般原生視窗（有系統標題列與關閉鈕），不像主視窗走自家 frame:false
      // 那套自訂標題列——這個子視窗沒有配對的 IPC 控制鈕，用 frame:false 反而會開出一個
      // 關不掉的視窗（使用者實測回報：Electron 打不開、看預覽窗找不到退出按鈕，根因就是這裡）。
      if (isPrompterUrl(url, port)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 1000,
            height: 700,
            minWidth: 640,
            minHeight: 480,
            backgroundColor: '#121317',
            title: 'Elitesand Pro 跟唱視圖',
            icon: path.join(shellRoot, 'assets', 'elitesand-pro.ico'),
            frame: true,
            webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
          },
        };
      }
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (!isTrustedLocalUrl(url, port)) event.preventDefault();
    });
    // 跟唱視圖子視窗建立後，一樣把「拒絕未知彈窗／只信任本機網址」的防護補上，
    // 不能因為它是子視窗就少一層——防禦深度跟主視窗一致。
    window.webContents.on('did-create-window', (childWindow) => {
      childWindow.removeMenu?.();
      childWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      childWindow.webContents.on('will-navigate', (event, url) => {
        if (!isTrustedLocalUrl(url, port)) event.preventDefault();
      });
    });
    const installerLocale = consumeInstallerLocale(app.getPath('userData'));
    const localeQuery = installerLocale ? `&lang=${installerLocale}` : '';
    await window.loadURL(`http://127.0.0.1:${port}/panel?electronShell=1${localeQuery}`);
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
    // Keep both pipes drained. This retains server startup diagnostics without
    // allowing a full stdout buffer to freeze the utility process.
    //
    // 2026-08-03 實機根因：'pipe' 會建立 stdout/stderr 管道，但這個檔案從來沒有讀取
    // child.stdout／child.stderr。伺服器每寫一行日誌都會先 console.log()（見
    // server/utils/logger.js 的 writeLog），而 Node 在 Windows 上對「管道」的
    // stdout 寫入是同步的——管道緩衝區被寫滿又沒人排空時，下一次 console.log()
    // 就會卡在 WriteFile 不返回，直接凍結整個事件迴圈：HTTP、Socket.io、所有計時器
    // 全部停擺，行程還活著但完全沒回應（使用者看到「與伺服器連線中斷」）。
    //
    // 三次實機卡死的量化指紋：歷時 19.5／68.7／77 分鐘（差約 4 倍），但累積寫入
    // stdout 的量是 53,269／53,273／53,321 bytes（全距 52 bytes，0.1%）。卡死取決於
    // 寫了多少位元組、與經過多久無關，正是固定容量緩衝區被填滿的行為。
    //
    // 日誌檔本身是獨立的 createWriteStream，不受影響，功能完全不減。若日後真的需要
    // 讀取子行程輸出，必須「同時」持續排空 stdout 與 stderr 兩條，否則等於重演本 bug。
    const child = utilityProcess.fork(serverEntry, [], {
      // app.asar is a file, not a valid process working directory. The
      // server entry itself can be loaded from ASAR; its cwd must remain the
      // enclosing resources directory on packaged Windows builds.
      cwd: app.isPackaged ? path.dirname(projectRoot) : projectRoot,
      env: runtimeEnvironment(),
      stdio: 'pipe',
      serviceName: 'Elitesand Pro Server',
    });
    serverProcess = child;
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', (chunk) => {
      const message = String(chunk || '').trim();
      if (message) console.error(`[Elitesand Pro Server] ${message}`);
    });
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
    if (app.isPackaged) {
      verifyPackagedResourceIntegrity(
        processObject.resourcesPath || process.resourcesPath,
        packagedResourceIntegrity,
        fsImpl,
      );
    }
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
  consumeInstallerLocale,
  getRuntimePaths,
  resolveMediaRuntime,
  readConfiguredMediaDir,
  persistPackagedMediaReference,
  ensureRuntimePaths,
  isTrustedLocalUrl,
  isProjectReleaseUrl,
  isTwitchVerificationUrl,
  isPrompterUrl,
  probeHealth,
  waitForExit,
  verifyPackagedResourceIntegrity,
  createElectronShell,
};
