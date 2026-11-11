'use strict';

// 歌曲庫直接改歌名／歌手（使用者回報：為什麼只能在播放清單改）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

test('歌曲庫改歌名／歌手：寫回歌曲庫，播放清單與目前歌曲裡同一首一起改；空歌名、找不到的歌要擋', () => {
  const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-library-edit-'));
  const root = path.join(__dirname, '..');
  const script = `
    const path = require('path');
    const root = process.argv[1];
    const libraryStore = require(path.join(root, 'server/services/library-store'));
    const registerLibraryHandlers = require(path.join(root, 'server/routes/handlers/library'));
    libraryStore.rememberImport({ id: 'aaaaaaaaaaa', title: '抓錯的歌名', artist: '抓錯的歌手', duration: 200, filename: 'a.m4a' });
    libraryStore.rememberImport({ id: 'bbbbbbbbbbb', title: '另一首', artist: 'X', duration: 100, filename: 'b.m4a' });
    const inList = { id: 'aaaaaaaaaaa', entryId: 'e1', title: '抓錯的歌名', artist: '抓錯的歌手' };
    const current = { id: 'aaaaaaaaaaa', title: '抓錯的歌名', artist: '抓錯的歌手' };
    const broadcasts = []; const events = new Map(); let persisted = 0; let stateSyncs = 0; let libraryChanged = 0;
    const io = { to() { return { emit(event) { broadcasts.push(event); } }; }, emit(event) { broadcasts.push(event); }, sockets: { sockets: new Map() } };
    const socket = { id: 's1', clientType: 'controller', on(event, handler) { events.set(event, handler); }, emit() {} };
    registerLibraryHandlers(io, socket, {
      playState: { playlist: [inList], currentTrack: current },
      persistState() { persisted += 1; }, broadcastState() { stateSyncs += 1; },
    }, { onLibraryChanged() { libraryChanged += 1; } });
    const call = (data) => new Promise((resolve) => events.get('library:update-meta')(data, resolve));
    (async () => {
      const ok = await call({ id: 'aaaaaaaaaaa', title: '  正確的歌名 ', artist: '正確的歌手' });
      const cleared = await call({ id: 'bbbbbbbbbbb', title: '另一首', artist: '' });
      const empty = await call({ id: 'aaaaaaaaaaa', title: '   ', artist: 'Y' });
      const missing = await call({ id: 'zzzzzzzzzzz', title: 'T', artist: '' });
      const entry = libraryStore.getEntry('aaaaaaaaaaa');
      const summary = libraryStore.getLibrarySummary().find((it) => it.id === 'bbbbbbbbbbb');
      process.stdout.write('__RESULT__' + JSON.stringify({ ok, cleared, empty, missing,
        entry: { title: entry.title, artist: entry.artist, needs: entry.needsArtistConfirmation },
        bArtist: summary.artist, bNeeds: libraryStore.getEntry('bbbbbbbbbbb').needsArtistConfirmation,
        inList, current, broadcasts, persisted, stateSyncs, libraryChanged }));
      process.exit(0);
    })();
  `;
  try {
    const result = spawnSync(process.execPath, ['-e', script, root], {
      encoding: 'utf8', timeout: 20000,
      env: { ...process.env, ELITESAND_DATA_DIR: tempData, ELITESAND_DOWNLOADS_DIR: path.join(tempData, 'dl'), ELITESAND_LOGS_DIR: path.join(tempData, 'logs') },
    });
    assert.equal(result.status, 0, result.stderr);
    const r = JSON.parse(result.stdout.split('__RESULT__')[1]);
    assert.deepEqual(r.ok, { ok: true, title: '正確的歌名', artist: '正確的歌手' });
    assert.deepEqual(r.entry, { title: '正確的歌名', artist: '正確的歌手', needs: false });
    assert.equal(r.inList.title, '正確的歌名', '播放清單裡同一首也要改（鐵則 17）');
    assert.equal(r.inList.artist, '正確的歌手');
    assert.equal(r.current.title, '正確的歌名', '正在播的那首也要改');
    assert.ok(r.broadcasts.includes('playlist:update') && r.broadcasts.includes('library:list'));
    assert.equal(r.stateSyncs, 1, '只有在清單裡的那首要重推 state');
    assert.equal(r.persisted, 1);
    assert.equal(r.libraryChanged, 2, '點歌頁目錄可能顯示歌名，要通知');
    assert.equal(r.cleared.ok, true);
    assert.equal(r.bArtist, '', '歌手可以清空（翻唱影片）');
    assert.equal(r.bNeeds, true, '清空歌手＝原唱待確認');
    assert.deepEqual(r.empty, { ok: false, error: 'empty_title' });
    assert.deepEqual(r.missing, { ok: false, error: 'not_found' });
  } finally {
    fs.rmSync(tempData, { recursive: true });
  }
});

test('歌曲庫編輯：唯讀端不能用；面板卡片與共用的編輯視窗都接上了', () => {
  const handler = fs.readFileSync(path.join(__dirname, '../server/routes/socket-handler.js'), 'utf8');
  const readOnly = handler.slice(handler.indexOf('const READ_ONLY_EVENTS'), handler.indexOf(']);', handler.indexOf('const READ_ONLY_EVENTS')));
  assert.ok(!readOnly.includes('library:update-meta'), '唯讀端不可改歌曲庫');
  const library = fs.readFileSync(path.join(__dirname, '../public/js/media-library.js'), 'utf8');
  assert.ok(library.includes("'library:update-meta'") && library.includes('window.TrackEditDialog.open('));
  assert.ok(library.includes('data-new-feature="library-edit-meta"'));
  const playlist = fs.readFileSync(path.join(__dirname, '../public/js/app-playlist.js'), 'utf8');
  assert.ok(playlist.includes('window.TrackEditDialog = Object.freeze('));
  const badges = fs.readFileSync(path.join(__dirname, '../public/js/new-badges.js'), 'utf8');
  assert.match(badges, /'library-edit-meta': '\d{4}-\d{2}-\d{2}'/);
});
