'use strict';

// 核心回歸測試（config-state）。由 tests/run-tests.js 依序載入，不要單獨執行。
const {
  fs,
  path,
  os,
  vm,
  test,
  eq,
  ok,
} = require('./core-harness');

// ═══════════════════════════════════════════
console.log('\n📦 8. 設定載入器與狀態持久化');
// ═══════════════════════════════════════════
const loadedConfig = require('../server/utils/load-config');

test('設定載入器：所有預設鍵存在且型別正確', () => {
  ok(typeof loadedConfig.port === 'number');
  ok(typeof loadedConfig.cacheDays === 'number');
  ok(typeof loadedConfig.maxCacheEntries === 'number');
  ok(typeof loadedConfig.updateCheckRepo === 'string');
  ok(typeof loadedConfig.updateCheckIntervalMs === 'number');
});

const appPathsModulePath = path.join(__dirname, '..', 'server', 'utils', 'app-paths.js');

function runAppPathsChild(env, expected, { writeLibrary = true } = {}) {
  const script = [
    "const fs=require('fs'),path=require('path');",
    "const root=process.argv[1],expected=JSON.parse(process.argv[2]);",
    "const paths=require(path.join(root,'server','utils','app-paths'));",
    "const logger=require(path.join(root,'server','utils','logger'));",
    `const writeLibrary=${JSON.stringify(writeLibrary)};`,
    "if(writeLibrary){const library=require(path.join(root,'server','services','library-store'));library.rememberImport({id:'app-paths-track',title:'Path Test',filename:'path-test.mp3'});library.saveNow();}",
    "const result={paths,logDir:logger.LOG_DIR,libraryWritten:writeLibrary&&fs.existsSync(path.join(paths.dataDir,'library.json')),expected};",
    "process.stdout.write('__APP_PATHS_RESULT__'+JSON.stringify(result)+'\\n');",
  ].join('\n');
  const child = require('child_process').spawnSync(process.execPath, ['-e', script, path.join(__dirname, '..'), JSON.stringify(expected)], {
    env, encoding: 'utf8', timeout: 10000, windowsHide: true,
  });
  eq(child.status, 0, `app-paths child stderr=${child.stderr} stdout=${child.stdout}: `);
  const marker = '__APP_PATHS_RESULT__';
  const markerAt = child.stdout.lastIndexOf(marker);
  ok(markerAt >= 0, `app-paths child returned no result: ${child.stdout}`);
  return JSON.parse(child.stdout.slice(markerAt + marker.length).trim().split(/\r?\n/, 1)[0]);
}

test('app-paths keeps the portable default layout when no override is set', () => {
  const root = path.join(__dirname, '..');
  const result = runAppPathsChild({
    ...process.env,
    ELITESAND_DATA_DIR: '', ELITESAND_DOWNLOADS_DIR: '', ELITESAND_LOGS_DIR: '',
  }, {}, { writeLibrary: false });
  eq(result.paths.projectRoot, root);
  eq(result.paths.dataDir, path.join(root, 'data'));
  eq(result.paths.downloadsDir, path.join(root, 'downloads'));
  eq(result.paths.logsDir, path.join(root, 'logs'));
  eq(result.paths.configPath, path.join(root, 'server', 'config.js'));
  eq(result.logDir, result.paths.logsDir);
});

test('打包預設依版本隔離 dist 產物，避免固定 update.zip 跨版覆寫', () => {
  const portableBuild = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-portable.ps1'), 'utf8');
  const updateBuild = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-update.ps1'), 'utf8');
  ok(portableBuild.includes('dist\\releases\\v$Version\\portable'), 'Portable 預設輸出必須置於版本資料夾: ');
  ok(updateBuild.includes('dist\\releases\\v$Version\\update'), '更新包預設輸出必須置於版本資料夾: ');
  ok(updateBuild.includes('$ZipPath = Join-Path $OutputRoot "update.zip"'), 'GitHub Release 所需的 update.zip 固定檔名不可改變: ');
});

test('app-paths directs persisted data, downloads, and logs to isolated overrides', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-app-paths-'));
  const expected = {
    dataDir: path.join(root, 'state'),
    downloadsDir: path.join(root, 'media'),
    logsDir: path.join(root, 'runtime-logs'),
  };
  try {
    const result = runAppPathsChild({
      ...process.env,
      ELITESAND_DATA_DIR: expected.dataDir,
      ELITESAND_DOWNLOADS_DIR: expected.downloadsDir,
      ELITESAND_LOGS_DIR: expected.logsDir,
    }, expected);
    eq(result.paths.dataDir, expected.dataDir);
    eq(result.paths.downloadsDir, expected.downloadsDir);
    eq(result.paths.logsDir, expected.logsDir);
    eq(result.logDir, expected.logsDir);
    ok(result.libraryWritten, 'library store must write under ELITESAND_DATA_DIR');
    ok(fs.existsSync(path.join(expected.dataDir, 'library.json')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('本機 smoke 工具必須隔離 data、downloads 與 logs 三個可寫目錄', () => {
  for (const tool of ['reliability-smoke.js', 'smoke-portable.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'tools', tool), 'utf8');
    for (const envName of ['ELITESAND_DATA_DIR', 'ELITESAND_DOWNLOADS_DIR', 'ELITESAND_LOGS_DIR']) {
      ok(source.includes(envName), `${tool} 遺漏 ${envName} 隔離: `);
    }
    ok(source.includes('runtimeRoot'), `${tool} 必須以單一自建 runtimeRoot 收納暫存資料: `);
    ok(source.includes('fs.rmSync(runtimeRoot'), `${tool} 結束後必須只清除自建 runtimeRoot: `);
  }
});

test('desktop parent shutdown accepts only the explicit message and runs once', () => {
  const { EventEmitter } = require('events');
  const { SHUTDOWN_MESSAGE, isShutdownMessage, attachParentShutdown } = require('../server/utils/parent-shutdown');
  const parentPort = new EventEmitter();
  const processObject = new EventEmitter();
  let calls = 0;
  const detach = attachParentShutdown({
    parentPort,
    processObject,
    onShutdown: () => { calls++; },
  });

  ok(isShutdownMessage(SHUTDOWN_MESSAGE));
  ok(isShutdownMessage({ type: SHUTDOWN_MESSAGE }));
  ok(!isShutdownMessage({ type: 'shutdown' }));
  ok(!isShutdownMessage({ data: SHUTDOWN_MESSAGE }), 'Node IPC payloads must not be treated as Electron events');

  parentPort.emit('message', { data: 'ignore-this' });
  processObject.emit('message', { type: 'ignore-this' });
  eq(calls, 0);

  parentPort.emit('message', { data: SHUTDOWN_MESSAGE });
  processObject.emit('message', SHUTDOWN_MESSAGE);
  eq(calls, 1, 'the first valid parent message starts exactly one shutdown');

  detach();
  parentPort.emit('message', { data: SHUTDOWN_MESSAGE });
  eq(calls, 1, 'detached listeners must not receive later messages');
});

test('server wires the parent shutdown adapter into its graceful shutdown path', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  ok(source.includes("require('./utils/parent-shutdown')"));
  ok(source.includes("reason: 'parent-message'"));
  ok(source.includes('attachParentShutdown({'));
});

test('portable build creates a clean production-only dependency tree in staging', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-portable.ps1'), 'utf8');
  const copiedDirs = source.match(/\$DirsToCopy\s*=\s*@\(([^)]*)\)/);
  ok(copiedDirs, 'portable build must explicitly list source directories');
  ok(!/node_modules/i.test(copiedDirs[1]), 'portable build must never copy the developer node_modules directory');
  ok(/ci\s+--omit=dev\b/i.test(source), 'portable build must install production dependencies with npm ci --omit=dev');
  ok(/--ignore-scripts\b/i.test(source), 'portable dependency install must not run package lifecycle scripts');
  ok(source.includes('Installing production dependencies in staging'));
});

test('installer and portable builds run the full test gate before packaging', () => {
  const installer = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-installer.ps1'), 'utf8');
  const portable = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-portable.ps1'), 'utf8');
  ok(installer.includes('npm.cmd') && installer.includes('--prefix $Root test'), 'installer build must run npm test before packaging');
  ok(portable.includes('npm.cmd') && portable.includes('--prefix $Root test'), 'portable build must run npm test before packaging');
});

test('Installer packaged E2E covers yt-dlp seed, approved runtime restart, tamper recovery, and immutable seed', () => {
  const installer = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-installer.ps1'), 'utf8');
  [
    'runtime-state.json',
    'initial-seed',
    'approved-runtime-restart',
    'tamper-recovery',
    'approved-runtime-e2e',
    'unapproved-tamper-e2e',
    'protected packaged seed changed',
  ].forEach((required) => ok(installer.includes(required), `Installer yt-dlp packaged E2E 缺少 ${required}: `));
  ok(installer.includes('Get-Sha256Hex -LiteralPath $runtimePath'), 'packaged E2E 必須用實際 runtime bytes 驗證 trust hash: ');
  ok(installer.includes('Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health"'), '每個 packaged restart phase 都必須真的啟動 app 並通過 health: ');
});

test('bilingual EULA is shipped with portable builds as a finalized agreement', () => {
  const root = path.join(__dirname, '..');
  const eulaPath = path.join(root, 'EULA.txt');
  ok(fs.existsSync(eulaPath), 'EULA.txt must exist at the project root');
  const eula = fs.readFileSync(eulaPath, 'utf8');
  ok(eula.includes('END-USER LICENSE AGREEMENT AND DISCLAIMER'), 'EULA must include the English title');
  ok(eula.includes('最終使用者授權暨免責聲明'), 'EULA must include the Chinese title');
  ok(/^Version:\s*\d+\.\d+\.\d+$/m.test(eula), 'EULA must carry a x.y.z version line (the acceptance gate keys off it)');
  ok(!eula.includes('Draft for legal review') && !eula.includes('[待填]'), 'EULA must stay finalized: no draft marker or placeholder fields');
  ok(eula.includes('權利人暨授權人') && eula.includes('Elitesand.pro@gmail.com'), 'EULA must name the rights holder and a contact address');
  ok(eula.includes('https://github.com/z22115554/elitesand-pro'), 'EULA must state the official download channel');
  ok(eula.includes('YouTube') && eula.includes('Twitch') && eula.includes('OBS'), 'EULA must state third-party platform boundaries');
  const portableBuild = fs.readFileSync(path.join(root, 'tools', 'build-portable.ps1'), 'utf8');
  ok(portableBuild.includes('"EULA.txt"'), 'portable build must copy EULA.txt into the app');
  ok(portableBuild.includes('foreach ($legalFile in @("LICENSE", "EULA.txt", "THIRD-PARTY-NOTICES.txt"))'), 'portable root must expose EULA.txt beside the other legal notices');
  const portableSmoke = fs.readFileSync(path.join(root, 'tools', 'smoke-portable.js'), 'utf8');
  ok(portableSmoke.includes("path.join(stage, 'EULA.txt')"), 'portable smoke must fail if EULA.txt is missing');
});

test('portable build clears runtime data again after packaged-app smoke', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-portable.ps1'), 'utf8');
  const smokeIndex = source.indexOf('Running packaged-app smoke test...');
  const resetAfterSmoke = source.indexOf('Reset-PackagedRuntimeData', smokeIndex);
  ok(smokeIndex >= 0, 'portable build must retain the packaged-app smoke test');
  ok(resetAfterSmoke > smokeIndex, 'portable build must clear runtime folders after smoke before zipping');
  ok(source.includes('Assert-Inside -Path $target -Parent $Stage'), 'runtime cleanup must remain scoped to the package stage');
  ok(source.includes('Runtime folder was not empty after reset'), 'runtime cleanup must fail closed if a folder remains populated');
});

test('all writable runtime path consumers use app-paths as their single authority', () => {
  const root = path.join(__dirname, '..');
  const consumers = [
    'server/index.js',
    'server/routes/api.js',
    'server/routes/api/display-assets.js',
    'server/routes/api/separation.js',
    'server/services/audio-processor.js',
    'server/services/library-store.js',
    'server/services/app-updater.js',
    'server/services/state-store.js',
    'server/services/auth-store.js',
    'server/services/twitch-store.js',
    'server/services/twitch-request-store.js',
    'server/services/twitch-history-store.js',
    'server/services/lyrics-engine.js',
    'server/services/playlist-export-store.js',
    'server/services/announcement-service.js',
    'server/services/import-temp-registry.js',
    'server/utils/logger.js',
    'server/utils/load-config.js',
  ];
  for (const file of consumers) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    ok(source.includes('app-paths'), `${file} must import app-paths`);
  }
  ok(fs.existsSync(appPathsModulePath), 'app-paths module must exist');
});

const stateStoreModulePath = path.join(__dirname, '..', 'server', 'services', 'state-store.js');
const stateFixtureDir = path.join(__dirname, 'fixtures', 'state');
const { spawnSync: spawnStateStore } = require('child_process');
const { createJsonStore } = require('../server/services/json-store');

function makeTestJsonStore(file, reports = []) {
  return createJsonStore({
    file,
    label: '測試資料',
    defaultValue: () => [],
    migrations: new Map([[0, (legacy) => ({ schemaVersion: 1, entries: legacy })]]),
    serialize: (entries) => ({ entries }),
    deserialize: (document) => document.entries,
    validate: (document) => Array.isArray(document.entries),
    onError: (report) => reports.push(report),
  });
}

test('共用 JSON store：舊格式遷移、原檔與 last-good 都會保留', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-json-store-migrate-'));
  try {
    const file = path.join(dataDir, 'sample.json');
    const original = JSON.stringify([{ id: 'legacy' }]);
    fs.writeFileSync(file, original, 'utf8');
    const store = makeTestJsonStore(file);
    const loaded = store.load();
    const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
    const preserved = fs.readdirSync(dataDir).find((name) => /^sample\.json\.pre-migration-v0-/.test(name));
    eq(loaded[0].id, 'legacy');
    eq(disk.schemaVersion, 1);
    eq(disk.entries[0].id, 'legacy');
    eq(fs.readFileSync(path.join(dataDir, preserved), 'utf8'), original);
    ok(fs.existsSync(`${file}.last-good`), '應建立 last-good: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('共用 JSON store：損壞主檔會保留證據並由 last-good 恢復', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-json-store-recover-'));
  try {
    const file = path.join(dataDir, 'sample.json');
    fs.writeFileSync(file, '{broken', 'utf8');
    fs.writeFileSync(`${file}.last-good`, JSON.stringify({ schemaVersion: 1, entries: [{ id: 'safe' }] }), 'utf8');
    const reports = [];
    const loaded = makeTestJsonStore(file, reports).load();
    eq(loaded[0].id, 'safe');
    ok(fs.readdirSync(dataDir).some((name) => /^sample\.json\.corrupt-/.test(name)), '應保留損壞主檔: ');
    ok(reports.some((item) => /恢復/.test(item.message)), '應回報恢復結果: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('共用 JSON store：未來 schema 保持不變且拒絕寫入與刪除', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-json-store-future-'));
  try {
    const file = path.join(dataDir, 'sample.json');
    const original = JSON.stringify({ schemaVersion: 99, entries: [{ id: 'future' }] });
    fs.writeFileSync(file, original, 'utf8');
    const store = makeTestJsonStore(file);
    eq(store.load().length, 0);
    ok(store.getStatus().writeBlocked, '未來格式應停止寫入: ');
    eq(store.save([{ id: 'downgrade' }]), false);
    eq(store.remove(), false);
    eq(fs.readFileSync(file, 'utf8'), original);
    ok(!fs.readdirSync(dataDir).some((name) => /corrupt|pre-migration/.test(name)), '不可誤判未來格式: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('共用 JSON store：遷移無法安全落盤時保留原檔並停止寫入', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-json-store-persist-fail-'));
  const originalCopy = fs.copyFileSync;
  try {
    const file = path.join(dataDir, 'sample.json');
    const original = JSON.stringify([{ id: 'legacy' }]);
    fs.writeFileSync(file, original, 'utf8');
    const store = makeTestJsonStore(file);
    fs.copyFileSync = () => { throw new Error('simulated backup failure'); };
    eq(store.load().length, 0);
    ok(store.getStatus().writeBlocked, '遷移失敗應停止寫入: ');
    eq(store.save([{ id: 'overwrite' }]), false);
    eq(fs.readFileSync(file, 'utf8'), original);
    ok(!fs.readdirSync(dataDir).some((name) => /corrupt/.test(name)), '原檔不是損壞，不應改名: ');
  } finally {
    fs.copyFileSync = originalCopy;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('八類資料檔：舊資料可載入且落盤後都有 schemaVersion', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-store-fixtures-'));
  const fixtures = path.join(__dirname, 'fixtures', 'stores');
  try {
    for (const [fixture, target] of [
      ['library-v0.json', 'library.json'],
      ['lyrics-cache-v0.json', 'lyrics-cache.json'],
      ['auth-v0.json', 'auth.json'],
      ['twitch-auth-v0.json', 'twitch-auth.json'],
      ['twitch-requests-v0.json', 'twitch-requests.json'],
      ['twitch-history-v0.json', 'twitch-history.json'],
      ['announcement-state-v0.json', 'announcement-state.json'],
      ['announcement-cache-v1.json', 'announcement-cache.json'],
    ]) fs.copyFileSync(path.join(fixtures, fixture), path.join(dataDir, target));

    const script = [
      "const fs=require('fs'),path=require('path'); const root=process.argv[1],dir=process.argv[2];",
      "const library=require(path.join(root,'server/services/library-store'));",
      "const auth=require(path.join(root,'server/services/auth-store'));",
      "const twitch=require(path.join(root,'server/services/twitch-store'));",
      "const twitchRequests=require(path.join(root,'server/services/twitch-request-store'));",
      "const twitchHistory=require(path.join(root,'server/services/twitch-history-store'));",
      "require(path.join(root,'server/services/lyrics-engine')); require(path.join(root,'server/services/announcement-service'));",
      "const read=(name)=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));",
      "const result={libraryApi:library.getLibrary(),hasPin:auth.hasPin(),twitchApi:twitch.load(),twitchRequests:twitchRequests.load(),twitchHistory:twitchHistory.load(),files:{}};",
      "for(const name of ['library.json','lyrics-cache.json','auth.json','twitch-auth.json','twitch-requests.json','twitch-history.json','announcement-state.json','announcement-cache.json']) result.files[name]=read(name);",
      "process.stdout.write('__STORE_RESULT__'+JSON.stringify(result)+'\\n');",
    ].join('\n');
    const child = spawnStateStore(process.execPath, ['-e', script, path.join(__dirname, '..'), dataDir], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir }, encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    eq(child.status, 0, `store fixture child stderr=${child.stderr} stdout=${child.stdout}: `);
    const markerAt = child.stdout.lastIndexOf('__STORE_RESULT__');
    ok(markerAt >= 0, `store fixture child 缺少結果：${child.stdout}`);
    const result = JSON.parse(child.stdout.slice(markerAt + '__STORE_RESULT__'.length).trim().split(/\r?\n/, 1)[0]);
    eq(result.libraryApi[0].title, '舊版媒體庫歌曲');
    ok(result.hasPin, '舊 PIN 雜湊應仍可辨識: ');
    eq(result.twitchApi.refreshToken, 'fixture-refresh-token');
    eq(result.twitchRequests[0].requestId, 'fixture-request');
    eq(result.twitchHistory[0].requestCode, 'LEGACY1');
    // library.json 在 2026-09-23 升到 v2（歌詞分檔），其餘七類仍是 v1。
    for (const [name, document] of Object.entries(result.files)) eq(document.schemaVersion, name === 'library.json' ? 2 : 1, `${name}: `);
    eq(result.files['library.json'].entries['legacy-track'].playCount, 2);
    ok(Array.isArray(result.files['lyrics-cache.json'].entries), '歌詞快取 entries 應保留: ');
    eq(result.files['announcement-state.json'].dismissed[0], 'fixture-announcement');
    for (const target of ['library.json', 'lyrics-cache.json', 'auth.json', 'twitch-auth.json', 'twitch-requests.json', 'twitch-history.json', 'announcement-state.json']) {
      ok(fs.readdirSync(dataDir).some((name) => name.startsWith(`${target}.pre-migration-v0-`)), `${target} 應保留遷移前原檔: `);
    }
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

function runStateStoreChild(dataDir, script) {
  const result = spawnStateStore(process.execPath, ['-e', script, stateStoreModulePath, dataDir], {
    env: { ...process.env, ELITESAND_DATA_DIR: dataDir },
    encoding: 'utf8', timeout: 10000, windowsHide: true,
  });
  eq(result.status, 0, `state-store child stderr=${result.stderr} stdout=${result.stdout}: `);
  const marker = '__STATE_RESULT__';
  const markerAt = result.stdout.lastIndexOf(marker);
  ok(markerAt >= 0, `state-store child 缺少結果：${result.stdout}`);
  return JSON.parse(result.stdout.slice(markerAt + marker.length).trim().split(/\r?\n/, 1)[0]);
}

test('狀態持久化：隔離資料夾 round-trip 並建立 last-good', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-roundtrip-'));
  try {
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const store=require(process.argv[1]);",
      "const snapshot={savedAt:Date.now(),playlist:[{id:'t1',title:'測試歌曲',artist:'測試歌手'}],style:'rock',romanizationMode:'full',trackOffsets:{t1:300},manualLyrics:{t1:{lyrics:'手動歌詞',timestamp:1}}};",
      "store.scheduleSave(()=>snapshot); store.saveNow(); const loaded=store.loadState();",
      "process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,backup:fs.existsSync(store.STATE_BACKUP_FILE)}));",
    ].join('\n'));
    eq(result.loaded.playlist[0].title, '測試歌曲');
    eq(result.loaded.style, 'rock');
    eq(result.loaded.trackOffsets.t1, 300);
    eq(result.loaded.manualLyrics.t1.lyrics, '手動歌詞');
    eq(result.loaded.schemaVersion, 3);
    ok(result.backup, '成功保存後應建立 last-good: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('狀態持久化：狀態檔不存在時回傳 null 不報錯', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-empty-'));
  try {
    const result = runStateStoreChild(dataDir, [
      "const store=require(process.argv[1]);",
      "process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded:store.loadState(),alert:store.consumeStartupAlert()}));",
    ].join('\n'));
    eq(result.loaded, null);
    eq(result.alert, null);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('狀態持久化：last-good 保留前一份有效狀態而非鏡像新檔', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-last-good-'));
  try {
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const store=require(process.argv[1]); const first={savedAt:100,marker:'first',playlist:[]}; const second={savedAt:200,marker:'second',playlist:[]};",
      "store.scheduleSave(()=>first); store.saveNow(); store.scheduleSave(()=>second); store.saveNow();",
      "const primary=JSON.parse(fs.readFileSync(store.STATE_FILE,'utf8')); const backup=JSON.parse(fs.readFileSync(store.STATE_BACKUP_FILE,'utf8')); process.stdout.write('__STATE_RESULT__'+JSON.stringify({primary,backup}));",
    ].join('\n'));
    eq(result.primary.marker, 'second');
    eq(result.backup.marker, 'first');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('state.json 遺失時從 last-good 恢復', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-missing-primary-'));
  try {
    fs.writeFileSync(path.join(dataDir, 'state.json.last-good'), JSON.stringify({ schemaVersion: 1, savedAt: 8, playlist: [{ id: 'backup-only' }] }), 'utf8');
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const store=require(process.argv[1]); const loaded=store.loadState(); const alert=store.consumeStartupAlert();",
      "const disk=JSON.parse(fs.readFileSync(store.STATE_FILE,'utf8')); process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,alert,disk}));",
    ].join('\n'));
    eq(result.loaded.playlist[0].id, 'backup-only');
    eq(result.disk.playlist[0].id, 'backup-only');
    ok(/找不到 state\.json/.test(result.alert.message), '應說明主檔遺失與恢復結果: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('主檔遺失但 last-good 為未來 schema 時持續阻止降版覆寫', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-future-backup-'));
  const fixture = path.join(stateFixtureDir, 'future-v99.json');
  try {
    fs.copyFileSync(fixture, path.join(dataDir, 'state.json.last-good'));
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const store=require(process.argv[1]); const alerts=[]; store.setErrorReporter((a)=>alerts.push(a)); const before=fs.readFileSync(store.STATE_BACKUP_FILE,'utf8');",
      "const loaded=store.loadState(); store.scheduleSave(()=>({savedAt:Date.now(),playlist:[{id:'downgrade'}]})); store.saveNow();",
      "const after=fs.readFileSync(store.STATE_BACKUP_FILE,'utf8'); process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,alerts,unchanged:before===after,primaryExists:fs.existsSync(store.STATE_FILE)}));",
    ].join('\n'));
    eq(result.loaded, null);
    ok(result.unchanged, '未來格式 last-good 必須保持不變: ');
    ok(!result.primaryExists, '不可用舊程式從未來格式建立降版主檔: ');
    ok(result.alerts.some((item) => /停止狀態寫入/.test(item.message)), '應持續阻止降版覆寫: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('無版本 state fixture 可逐步遷移並保留原檔', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-migrate-v0-'));
  const fixture = path.join(stateFixtureDir, 'v0-versionless.json');
  try {
    const original = fs.readFileSync(fixture, 'utf8');
    fs.copyFileSync(fixture, path.join(dataDir, 'state.json'));
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const path=require('path'); const store=require(process.argv[1]); const dir=process.argv[2];",
      "const loaded=store.loadState(); const files=fs.readdirSync(dir); const disk=JSON.parse(fs.readFileSync(store.STATE_FILE,'utf8'));",
      "const preserved=files.find((name)=>/^state\\.json\\.pre-migration-v0-/.test(name));",
      "process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,disk,files,preservedRaw:preserved?fs.readFileSync(path.join(dir,preserved),'utf8'):null}));",
    ].join('\n'));
    eq(result.loaded.schemaVersion, 3);
    eq(result.disk.schemaVersion, 3);
    eq(result.loaded.playlist[0].title, '舊版測試歌曲');
    eq(result.loaded.trackOffsets['legacy-track'], 350);
    eq(result.loaded.manualLyrics['legacy-track'].lyrics, '[00:01.00]舊版歌詞');
    eq(result.loaded.lyricSettings.template, 'classic');
    eq(result.preservedRaw, original);
    ok(result.files.includes('state.json.last-good'), '遷移後應建立目前格式的 last-good: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('目前 schema 載入不重複建立 migration 備份', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-current-schema-'));
  try {
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ schemaVersion: 3, savedAt: 7, playlist: [] }), 'utf8');
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const store=require(process.argv[1]); const dir=process.argv[2];",
      "const loaded=store.loadState(); process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,files:fs.readdirSync(dir)}));",
    ].join('\n'));
    eq(result.loaded.schemaVersion, 3);
    ok(!result.files.some((name) => name.includes('.pre-migration-')), '目前 schema 不應產生多餘遷移備份: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('未來 schema 保持原檔且阻止舊程式降版覆寫', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-future-schema-'));
  const fixture = path.join(stateFixtureDir, 'future-v99.json');
  try {
    fs.copyFileSync(fixture, path.join(dataDir, 'state.json'));
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const store=require(process.argv[1]); const dir=process.argv[2]; const alerts=[]; store.setErrorReporter((a)=>alerts.push(a));",
      "const before=fs.readFileSync(store.STATE_FILE,'utf8'); const loaded=store.loadState();",
      "store.scheduleSave(()=>({savedAt:Date.now(),playlist:[{id:'downgrade'}]})); store.saveNow();",
      "const after=fs.readFileSync(store.STATE_FILE,'utf8'); process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,alerts,unchanged:before===after,files:fs.readdirSync(dir)}));",
    ].join('\n'));
    eq(result.loaded, null);
    ok(result.unchanged, '未來版本資料必須逐 byte 保持不變: ');
    ok(!result.files.some((name) => /corrupt|pre-migration/.test(name)), '未來 schema 不應被誤判成損壞或舊格式: ');
    ok(result.alerts.some((item) => /停止狀態寫入/.test(item.message)), '應說明已阻止降版覆寫: ');
    ok(result.alerts.some((item) => /已拒絕寫入/.test(item.message)), '實際保存也必須被拒絕: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('非法 schema fixture 視為損壞並保留證據', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-invalid-schema-'));
  const fixture = path.join(stateFixtureDir, 'invalid-schema.json');
  try {
    const original = fs.readFileSync(fixture, 'utf8');
    fs.copyFileSync(fixture, path.join(dataDir, 'state.json'));
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const path=require('path'); const store=require(process.argv[1]); const dir=process.argv[2];",
      "const loaded=store.loadState(); const alert=store.consumeStartupAlert(); const files=fs.readdirSync(dir); const preserved=files.find((name)=>/^state\\.json\\.corrupt-/.test(name));",
      "process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,alert,files,preservedRaw:preserved?fs.readFileSync(path.join(dir,preserved),'utf8'):null}));",
    ].join('\n'));
    eq(result.loaded, null);
    eq(result.preservedRaw, original);
    ok(/沒有可用備份/.test(result.alert.message), '非法 schema 應走可理解的安全降級: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('state.json 損壞時保留原檔並從 last-good 自動恢復', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-recover-'));
  try {
    fs.writeFileSync(path.join(dataDir, 'state.json'), '{broken', 'utf8');
    fs.writeFileSync(path.join(dataDir, 'state.json.last-good'), JSON.stringify({ savedAt: 42, playlist: [{ id: 'safe' }], style: 'rock' }), 'utf8');
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const path=require('path'); const store=require(process.argv[1]); const dir=process.argv[2];",
      "const loaded=store.loadState(); const alert=store.consumeStartupAlert(); const disk=JSON.parse(fs.readFileSync(store.STATE_FILE,'utf8'));",
      "process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,alert,disk,files:fs.readdirSync(dir)}));",
    ].join('\n'));
    eq(result.loaded.playlist[0].id, 'safe');
    eq(result.disk.playlist[0].id, 'safe');
    eq(result.disk.schemaVersion, 3);
    ok(result.files.some((name) => /^state\.json\.corrupt-/.test(name)), '應保留損壞原檔: ');
    ok(/最近可用備份恢復/.test(result.alert.message), `提示應說明恢復結果：${result.alert?.message}`);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('state.json 損壞且無備份時保留原檔並以預設狀態啟動', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-no-backup-'));
  try {
    fs.writeFileSync(path.join(dataDir, 'state.json'), '[]', 'utf8');
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const store=require(process.argv[1]); const dir=process.argv[2];",
      "const loaded=store.loadState(); const alert=store.consumeStartupAlert();",
      "process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,alert,files:fs.readdirSync(dir)}));",
    ].join('\n'));
    eq(result.loaded, null);
    ok(result.files.some((name) => /^state\.json\.corrupt-/.test(name)), '應保留無效狀態物件: ');
    ok(/沒有可用備份/.test(result.alert.message), `提示應說明降級結果：${result.alert?.message}`);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('state.json 與 last-good 都損壞時保留兩份證據並安全啟動', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-both-corrupt-'));
  try {
    fs.writeFileSync(path.join(dataDir, 'state.json'), '{broken-primary', 'utf8');
    fs.writeFileSync(path.join(dataDir, 'state.json.last-good'), '{broken-backup', 'utf8');
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const store=require(process.argv[1]); const dir=process.argv[2];",
      "const loaded=store.loadState(); const alert=store.consumeStartupAlert();",
      "process.stdout.write('__STATE_RESULT__'+JSON.stringify({loaded,alert,files:fs.readdirSync(dir)}));",
    ].join('\n'));
    eq(result.loaded, null);
    ok(result.files.some((name) => /^state\.json\.corrupt-/.test(name)), '主檔損壞證據應保留: ');
    ok(result.files.some((name) => /^state\.json\.last-good\.corrupt-/.test(name)), '備份損壞證據應保留: ');
    ok(/損壞備份另存/.test(result.alert.message), `提示應說明備份也損壞：${result.alert?.message}`);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('運行中 state.json 損壞不會造成拒寫死鎖', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-runtime-corrupt-'));
  try {
    fs.writeFileSync(path.join(dataDir, 'state.json'), '{broken', 'utf8');
    const result = runStateStoreChild(dataDir, [
      "const fs=require('fs'); const store=require(process.argv[1]); const dir=process.argv[2]; const alerts=[]; store.setErrorReporter((a)=>alerts.push(a));",
      "const snapshot={savedAt:Date.now(),playlist:[{id:'new'}]}; store.scheduleSave(()=>snapshot); store.saveNow();",
      "const disk=JSON.parse(fs.readFileSync(store.STATE_FILE,'utf8'));",
      "process.stdout.write('__STATE_RESULT__'+JSON.stringify({disk,alerts,files:fs.readdirSync(dir)}));",
    ].join('\n'));
    eq(result.disk.playlist[0].id, 'new');
    ok(result.files.some((name) => /^state\.json\.corrupt-/.test(name)), '運行中壞檔應另存: ');
    ok(result.alerts.some((item) => /目前狀態將重新保存/.test(item.message)), '應通知控制面板已解除拒寫: ');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('啟動恢復提示延遲到第一個桌面控制面板連線', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'socket-handler.js'), 'utf8');
  ok(source.includes("type === 'controller'"));
  ok(source.includes('stateStore.consumeStartupAlert()'));
  ok(source.includes("socket.emit('server:alert', startupAlert)"));
});

test('狀態保存 callback 只在實際落盤後回報成功', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-save-ack-'));
  const storePath = path.join(__dirname, '..', 'server', 'services', 'state-store.js');
  const script = `
    const store=require(process.argv[1]); let report=null;
    store.scheduleSave(()=>({savedAt:Date.now(),playlist:[],lyricSettings:{fontSize:64}}),(result)=>{report=result;});
    store.saveNow(); process.stdout.write('__RESULT__'+JSON.stringify(report));
  `;
  try {
    const result = require('child_process').spawnSync(process.execPath, ['-e', script, storePath], {
      encoding: 'utf8', env: { ...process.env, ELITESAND_DATA_DIR: dataDir }, timeout: 10000,
    });
    eq(result.status, 0, result.stderr || 'state save ack 子程序失敗: ');
    const report = JSON.parse(result.stdout.split('__RESULT__')[1]);
    ok(report.ok);
    ok(Number.isFinite(report.savedAt));
    eq(JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8')).lyricSettings.fontSize, 64);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('首次使用 checklist 可稍後繼續，Twitch 不列入三項必要條件', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const nav = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'nav.js'), 'utf8');
  ok(html.includes('guide-later'));
  ok(html.includes('Twitch 連線（選配）'));
  ok(nav.includes("['environment', 'song', 'obs']"));
  ok(!nav.includes("['environment', 'song', 'obs', 'twitch']"));
});

test('新手教學完成預覽後會收起，里程碑可跳到對應設定並高亮', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const nav = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'nav.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'panel.css'), 'utf8');
  for (const target of ['ytdlp-card', 'music-source-card', 'obs-url-card', 'obs-ws-card', 'twitch-card']) {
    ok(html.includes(`data-guide-target="${target}"`), `缺少新手引導目標 ${target}: `);
  }
  ok(html.includes('設定 OBS WebSocket（選配）'));
  ok(nav.includes("GUIDE_PREVIEW_COMPLETE_KEY = 'elite-guide-preview-complete-v1'"));
  ok(nav.includes('if (route) route.hidden = false'));
  ok(nav.includes("tourCompleted ? 'tour.guide.review' : 'tour.welcome.start'"));
  ok(nav.includes(".onboard-task[data-guide-nav][data-guide-target]"));
  ok(nav.includes("target.classList.add('guide-target-highlight')"));
  ok(css.includes('.guide-target-highlight') && css.includes('@keyframes guide-target-highlight'));
});

test('錯誤歷史使用文字節點並會遮蔽敏感 token', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'error-handler.js'), 'utf8');
  ok(source.includes("message.textContent = entry.message"));
  ok(source.includes("'$1 [redacted]'"));
  ok(source.includes('MAX_HISTORY = 30'));
});

function createErrorHandlerToastHarness() {
  const timers = new Map();
  let nextTimerId = 0;

  function makeNode() {
    const classes = new Set();
    return {
      parentNode: null,
      children: [],
      className: '',
      innerHTML: '',
      classList: {
        add(...values) { values.forEach((value) => classes.add(value)); },
        remove(...values) { values.forEach((value) => classes.delete(value)); },
        contains(value) { return classes.has(value); },
      },
      appendChild(child) {
        this.children.push(child);
        child.parentNode = this;
        return child;
      },
      removeChild(child) {
        const index = this.children.indexOf(child);
        if (index !== -1) this.children.splice(index, 1);
        child.parentNode = null;
        return child;
      },
      querySelector(selector) {
        return selector === '.toast-close' ? { addEventListener() {} } : null;
      },
    };
  }

  const toastContainer = makeNode();
  const context = {
    SharedUtils: { escapeHtml: (value) => String(value) },
    document: {
      getElementById: (id) => id === 'toast-container' ? toastContainer : null,
      createElement: () => makeNode(),
      body: makeNode(),
    },
    window: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    console: { log() {}, warn() {}, error() {} },
    requestAnimationFrame: (handler) => handler(),
    setTimeout: (handler) => {
      const id = ++nextTimerId;
      timers.set(id, handler);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'error-handler.js'), 'utf8'), context);
  const handler = vm.runInContext('ErrorHandler', context);

  return {
    show(message) { handler.showToast(message, 'success', 0); },
    toastContainer,
  };
}

test('toast overflow keeps five visible unique notifications without blocking', () => {
  const harness = createErrorHandlerToastHarness();
  for (let index = 1; index <= 6; index++) harness.show(`track-${index}`);

  eq(harness.toastContainer.children.length, 5, 'overflow must remove the oldest toast immediately: ');
  eq(
    harness.toastContainer.children.filter((toast) => !toast.classList.contains('toast-exit')).length,
    5,
    'all remaining toasts must stay active after a rapid burst: '
  );

  harness.show('track-7');
  eq(harness.toastContainer.children.length, 5, 'subsequent overflow must remain bounded: ');
});

// 後面的測試檔也會用到
Object.assign(require('./core-harness').shared, { runStateStoreChild, makeTestJsonStore });
