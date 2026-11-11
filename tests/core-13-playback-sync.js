'use strict';

// 核心回歸測試（playback-sync）。由 tests/run-tests.js 依序載入，不要單獨執行。
const {
  fs,
  path,
  os,
  vm,
  failed,
  test,
  testAsync,
  eq,
  ok,
} = require('./core-harness');
const xieyin = require('../server/services/xieyin');
const { spawnSync: spawnStateStore } = require('child_process');

console.log('\n15. P2 播放邊界與 state:sync 量測');
test('單曲模式播完清空目前歌曲，等待使用者主動按下一首', () => {
  const sequence = require('../public/js/playback-sequence');
  eq(sequence.nextAfterEnded(0, 2, false), null);
  eq(sequence.nextAfterEnded(1, 2, false), null);
  eq(sequence.manualAdvance(-1, 3, 0, 1), 1, '播完第一首後按下一首應到第二首：');
  eq(sequence.manualAdvance(-1, 3, 1, -1), 1, '播完第二首後按上一首應重播第二首：');
  eq(sequence.manualAdvance(-1, 3, 2, 1), 0, '播完最後一首後按下一首維持既有循環行為：');
});

test('連續模式會自動播放下一首，但最後一首仍自然停止', () => {
  const sequence = require('../public/js/playback-sequence');
  const next = sequence.nextAfterEnded(0, 2, true);
  eq(next.index, 1);
  eq(next.autoplay, true);
  eq(sequence.nextAfterEnded(1, 2, true), null);
});

test('沒有目前歌曲時，已唱 entryId 仍會從未唱清單排除', () => {
  const { createAppState } = require('../server/state/app-state');
  const appState = createAppState({ emit() {} });
  const first = { id: 'done-a', entryId: 'done-entry-a', title: '已唱 A' };
  const second = { id: 'done-b', entryId: 'done-entry-b', title: '已唱 B' };
  const third = { id: 'wait-c', entryId: 'wait-entry-c', title: '未唱 C' };
  appState.playState.playlist = [first, second, third];
  appState.playState.currentTrack = null;
  appState.playState.currentTrackStarted = false;
  appState.playState.playedEntryIds = new Set([first.entryId, second.entryId]);
  appState.playState.lastPlayedEntryId = second.entryId;

  const payload = appState.setlistPayload();
  eq(payload.current, null);
  eq(payload.upcoming.map((track) => track.title).join(','), '未唱 C');
});

test('state:sync 每次廣播只序列化同一份 payload 並留下大小量測', () => {
  const { createAppState } = require('../server/state/app-state');
  const emitted = [];
  const appState = createAppState({ emit: (event, payload) => emitted.push({ event, payload }) });
  appState.broadcastState();
  const metrics = appState.getStateSyncMetrics();
  eq(emitted.length, 1);
  eq(emitted[0].event, 'state:sync');
  eq(metrics.samples, 1);
  ok(metrics.lastBytes > 0);
  eq(metrics.lastBytes, Buffer.byteLength(JSON.stringify(emitted[0].payload), 'utf8'));
  eq(metrics.lastPlaylistLength, emitted[0].payload.playlist.length);
});

test('歌單已開始的目前歌曲暫停後仍不可回到未唱區', () => {
  const { createAppState } = require('../server/state/app-state');
  const appState = createAppState({ emit() {} });
  const current = { id: 'current', entryId: 'current-entry', title: '暫停中的歌', artist: '測試歌手' };
  const next = { id: 'next', entryId: 'next-entry', title: '下一首', artist: '測試歌手' };
  appState.playState.playlist = [current, next];
  appState.playState.currentTrack = current;
  appState.playState.isPlaying = false;
  appState.playState.currentTrackStarted = true;

  const paused = appState.setlistPayload();
  eq(paused.current.title, '暫停中的歌');
  eq(paused.current.playing, false);
  eq(paused.upcoming.map((track) => track.title).join(','), '下一首');

  appState.playState.currentTrackStarted = false;
  const standby = appState.setlistPayload();
  eq(standby.upcoming.map((track) => track.title).join(','), '暫停中的歌,下一首');
});

test('意外關閉後會恢復目前歌曲與已唱／未唱狀態，但播放位置歸零且不自動播放', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-playback-recovery-'));
  try {
    const appStatePath = path.join(__dirname, '..', 'server', 'state', 'app-state.js');
    const stateStorePath = path.join(__dirname, '..', 'server', 'services', 'state-store.js');
    const script = [
      "const appStatePath=process.argv[1];",
      "const stateStorePath=process.argv[2];",
      "const {createAppState}=require(appStatePath);",
      "const stateStore=require(stateStorePath);",
      "const io={emit(){}};",
      "const first=createAppState(io);",
      "first.playState.playlist=[",
      " {id:'a',entryId:'entry-a',title:'A'},",
      " {id:'b',entryId:'entry-b',title:'B'},",
      " {id:'c',entryId:'entry-c',title:'C'}",
      "];",
      "first.playState.currentTrack=first.playState.playlist[1];",
      "first.playState.currentTrackStarted=true;",
      "first.playState.currentTime=87.25;",
      "first.playState.isPlaying=true;",
      "first.markTrackPlayed(first.playState.playlist[0]);",
      "first.markTrackPlayed(first.playState.playlist[1]);",
      "first.persistState();",
      "stateStore.saveNow();",
      "const restored=createAppState(io);",
      "const publicState=restored.getPublicState();",
      "const setlist=restored.setlistPayload();",
      "process.stdout.write('__RECOVERY__'+JSON.stringify({",
      " currentEntryId:publicState.currentTrack&&publicState.currentTrack.entryId,",
      " currentTime:publicState.currentTime, isPlaying:publicState.isPlaying,",
      " currentTrackStarted:publicState.currentTrackStarted,",
      " playedEntryIds:publicState.playedEntryIds, lastPlayedEntryId:publicState.lastPlayedEntryId,",
      " upcoming:setlist.upcoming.map((track)=>track.title)",
      "})+'\\n');",
    ].join('\n');
    const child = spawnStateStore(process.execPath, ['-e', script, appStatePath, stateStorePath], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir },
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    eq(child.status, 0, `playback recovery child stderr=${child.stderr} stdout=${child.stdout}: `);
    const markerAt = child.stdout.lastIndexOf('__RECOVERY__');
    ok(markerAt >= 0, `playback recovery child 缺少結果：${child.stdout}`);
    const result = JSON.parse(child.stdout.slice(markerAt + '__RECOVERY__'.length).trim().split(/\r?\n/, 1)[0]);
    eq(result.currentEntryId, 'entry-b');
    eq(result.currentTime, 0, '不保存歌曲內秒數，重開後應從該首開頭準備：');
    eq(result.isPlaying, false, '重開後不可自行播放出聲：');
    eq(result.currentTrackStarted, true, '暫停中的已開始歌曲要維持已唱狀態：');
    eq(result.playedEntryIds.sort().join(','), 'entry-a,entry-b');
    eq(result.lastPlayedEntryId, 'entry-b');
    eq(result.upcoming.join(','), 'C');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('舊 state 沒有播放恢復欄位時，會用既有 session 歌曲回填已唱狀態', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-playback-backfill-'));
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({
      schemaVersion: 3,
      savedAt: 1,
      playlist: [
        { id: 'a', entryId: 'entry-a', title: 'A' },
        { id: 'b', entryId: 'entry-b', title: 'B' },
        { id: 'c', entryId: 'entry-c', title: 'C' },
      ],
      session: {
        active: false, startedAt: null, source: null,
        songs: [{ id: 'a', entryId: 'session-a', title: 'A' }, { id: 'b', entryId: 'session-b', title: 'B' }],
      },
    }), 'utf8');
    const appStatePath = path.join(__dirname, '..', 'server', 'state', 'app-state.js');
    const script = [
      "const {createAppState}=require(process.argv[1]);",
      "const restored=createAppState({emit(){}});",
      "const publicState=restored.getPublicState();",
      "const setlist=restored.setlistPayload();",
      "process.stdout.write('__BACKFILL__'+JSON.stringify({played:publicState.playedEntryIds,upcoming:setlist.upcoming.map((t)=>t.title)})+'\\n');",
    ].join('\n');
    const child = spawnStateStore(process.execPath, ['-e', script, appStatePath], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir },
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    eq(child.status, 0, `playback backfill child stderr=${child.stderr} stdout=${child.stdout}: `);
    const markerAt = child.stdout.lastIndexOf('__BACKFILL__');
    ok(markerAt >= 0, `playback backfill child 缺少結果：${child.stdout}`);
    const result = JSON.parse(child.stdout.slice(markerAt + '__BACKFILL__'.length).trim().split(/\r?\n/, 1)[0]);
    eq(result.played.sort().join(','), 'entry-a,entry-b');
    eq(result.upcoming.join(','), 'C');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('還原到 age > 24h 的「開台中」session 會降級成非開台，但保留已唱歌單', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-zombie-session-'));
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const staleStartedAt = Date.now() - 25 * 60 * 60 * 1000;
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({
      schemaVersion: 3,
      savedAt: 1,
      session: {
        active: true, startedAt: staleStartedAt, source: 'twitch',
        songs: [{ id: 'a', entryId: 'session-a', title: 'A' }],
      },
    }), 'utf8');
    const appStatePath = path.join(__dirname, '..', 'server', 'state', 'app-state.js');
    const script = [
      "const {createAppState}=require(process.argv[1]);",
      "const restored=createAppState({emit(){}});",
      "const s=restored.setlistPayload();",
      "process.stdout.write('__ZOMBIE__'+JSON.stringify({active:s.active,source:s.source,songs:s.songs.length,startedAt:s.startedAt})+'\\n');",
    ].join('\n');
    const child = spawnStateStore(process.execPath, ['-e', script, appStatePath], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir },
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    eq(child.status, 0, `zombie session child stderr=${child.stderr} stdout=${child.stdout}: `);
    const markerAt = child.stdout.lastIndexOf('__ZOMBIE__');
    ok(markerAt >= 0, `zombie session child 缺少結果：${child.stdout}`);
    const result = JSON.parse(child.stdout.slice(markerAt + '__ZOMBIE__'.length).trim().split(/\r?\n/, 1)[0]);
    eq(result.active, false, '一天前的「開台中」要被視為殭屍狀態、還原成非開台：');
    eq(result.source, null, '殭屍 session 的 source 一併清掉：');
    eq(result.songs, 1, '已唱歌單必須保留、不因降級被清空：');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('還原到最近才開始的「開台中」session 維持開台（不被殭屍防護誤殺）', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-live-session-'));
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({
      schemaVersion: 3,
      savedAt: 1,
      session: {
        active: true, startedAt: Date.now() - 90 * 60 * 1000, source: 'twitch',
        songs: [{ id: 'a', entryId: 'session-a', title: 'A' }],
      },
    }), 'utf8');
    const appStatePath = path.join(__dirname, '..', 'server', 'state', 'app-state.js');
    const script = [
      "const {createAppState}=require(process.argv[1]);",
      "const restored=createAppState({emit(){}});",
      "const s=restored.setlistPayload();",
      "process.stdout.write('__LIVE__'+JSON.stringify({active:s.active,source:s.source})+'\\n');",
    ].join('\n');
    const child = spawnStateStore(process.execPath, ['-e', script, appStatePath], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir },
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    eq(child.status, 0, `live session child stderr=${child.stderr} stdout=${child.stdout}: `);
    const markerAt = child.stdout.lastIndexOf('__LIVE__');
    ok(markerAt >= 0, `live session child 缺少結果：${child.stdout}`);
    const result = JSON.parse(child.stdout.slice(markerAt + '__LIVE__'.length).trim().split(/\r?\n/, 1)[0]);
    eq(result.active, true, '90 分鐘前開始的直播是正常狀態，必須維持開台：');
    eq(result.source, 'twitch', 'source 維持不變：');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('控制面板重開後只在本地載入保存歌曲，不回送 play:track 改寫伺服器狀態', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/app-playback.js'), 'utf8');
  const restore = source.slice(source.indexOf('function restorePlaybackState'), source.indexOf('function restorePlaybackState') + 1800);
  ok(restore.includes("playTrack(index, false, { notifyServer: false, startTime: seconds })"),
    '恢復歌曲必須禁止回送 play:track；程式重開後伺服器提供的秒數固定為 0：');
  ok(source.includes('AppShared.restorePlaybackState = restorePlaybackState'),
    'app.js 的 state:sync 必須能呼叫本地恢復流程：');
});

test('播放秒數不寫入 state.json，lyrics:sync 與拖曳 seek 也不觸發存檔', () => {
  const appStateSource = fs.readFileSync(path.join(__dirname, '../server/state/app-state.js'), 'utf8');
  const playbackSource = fs.readFileSync(path.join(__dirname, '../server/routes/handlers/playback.js'), 'utf8');
  const snapshot = appStateSource.slice(
    appStateSource.indexOf('playback: {'),
    appStateSource.indexOf('playback: {') + 700,
  );
  ok(!snapshot.includes('currentTime:'), 'playback 持久化快照不可保存歌曲內秒數：');

  const seekHandler = playbackSource.slice(
    playbackSource.indexOf("socket.on('play:seek'"),
    playbackSource.indexOf("socket.on('play:prev'"),
  );
  const syncHandler = playbackSource.slice(
    playbackSource.indexOf("socket.on('lyrics:sync'"),
    playbackSource.indexOf("socket.on('lyrics:romanized'"),
  );
  ok(!seekHandler.includes('persistState('), '拖曳進度只做即時同步，不可寫入 state.json：');
  ok(!syncHandler.includes('persistState('), '播放中的高頻 lyrics:sync 不可寫入 state.json：');
  ok(!playbackSource.includes('PROGRESS_PERSIST_INTERVAL_MS') && !playbackSource.includes('persistPlaybackProgress'),
    '不可保留每 5 秒存檔的計時／節流邏輯：');
});

test('state:sync 清單不再攜帶歌詞，2000 首重歌詞清單維持緊湊', () => {
  const { createAppState } = require('../server/state/app-state');
  const emitted = [];
  const appState = createAppState({ emit: (event, payload) => emitted.push({ event, payload }) });
  const parsedLyrics = Array.from({ length: 120 }, (_, line) => ({
    time: line * 3000,
    endTime: line * 3000 + 2500,
    text: `第 ${line + 1} 句測試歌詞 ${'同步資料'.repeat(16)}`,
    phonetic: `test line ${line + 1} ${'phonetic '.repeat(12)}`,
    xieyin: `測試 ${'諧音'.repeat(24)}`,
  }));
  const lyrics = parsedLyrics.map((line) => {
    const seconds = Math.floor(line.time / 1000);
    return `[${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.00]${line.text}`;
  }).join('\n');
  appState.playState.playlist = Array.from({ length: 2000 }, (_, index) => ({
    id: `heavy-${index}`, title: `重歌詞歌曲 ${index + 1}`, artist: '測試歌手', filename: null,
    duration: 240, lyrics, lyricsType: 'lrc', parsedLyrics,
  }));
  appState.playState.currentTrack = appState.playState.playlist[0];
  appState.broadcastState();
  const payload = emitted[0].payload;
  const metrics = appState.getStateSyncMetrics();
  ok(payload.playlist.every((track) => !Object.prototype.hasOwnProperty.call(track, 'lyrics') && !Object.prototype.hasOwnProperty.call(track, 'parsedLyrics')),
    '清單摘要不可帶原始或解析歌詞: ');
  eq(payload.currentTrack.lyrics, lyrics, '目前歌曲必須保留完整歌詞: ');
  ok(metrics.lastEstimatedLegacyBytes > 8 * 1024 * 1024, '舊結構應跨過 8MB 風險線: ');
  ok(metrics.lastBytes < 1024 * 1024, '新 state:sync 應維持在 1MB 以下: ');
  ok(metrics.lastSavingsBytes > 8 * 1024 * 1024, '應量測到超過 8MB 的節省: ');
});

test('state.json 只瘦身已落盤媒體庫歌曲；local/未落盤歌曲保留完整 fallback，重開可還原 stems/重複 entryId/手動歌詞', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-slim-'));
  const downloadsDir = path.join(dataDir, 'downloads');
  try {
    const appStatePath = path.join(__dirname, '..', 'server', 'state', 'app-state.js');
    const stateStorePath = path.join(__dirname, '..', 'server', 'services', 'state-store.js');
    const libraryStorePath = path.join(__dirname, '..', 'server', 'services', 'library-store.js');
    const script = [
      "const fs=require('fs'); const path=require('path');",
      "const {createAppState}=require(process.argv[1]); const stateStore=require(process.argv[2]); const library=require(process.argv[3]);",
      "const heavy='LIBRARY-LYRIC-'.repeat(2000); const parsed=[{time:0,text:heavy.slice(0,200)}];",
      "const lib={id:'lib-track',title:'Library',artist:'Artist',filename:'lib.mp3',vocalsFile:'lib.vocals.wav',instrumentalFile:'lib.instrumental.wav',separationStatus:'done',lyrics:heavy,lyricsType:'lrc',parsedLyrics:parsed};",
      "library.rememberImport(lib); if(!library.saveNow()) throw new Error('library durable save failed');",
      "const dirty={id:'dirty-track',title:'Dirty',filename:'dirty.mp3',lyrics:'DIRTY-FALLBACK',lyricsType:'txt',parsedLyrics:[{time:0,text:'DIRTY-FALLBACK'}]}; library.rememberImport(dirty);",
      "const local={id:'local-track',entryId:'entry-local',title:'Local',filename:'local.wav',lyrics:'LOCAL-FALLBACK',lyricsType:'lrc',parsedLyrics:[{time:0,text:'LOCAL-FALLBACK'}]};",
      "const first=createAppState({emit(){}});",
      "first.playState.playlist=[{...lib,entryId:'entry-lib-a'},{...lib,entryId:'entry-lib-b'},dirty,local];",
      "first.playState.currentTrack=first.playState.playlist[1]; first.playState.currentTrackStarted=true; first.playState.playedEntryIds=new Set(['entry-lib-a','entry-lib-b']); first.playState.lastPlayedEntryId='entry-lib-b';",
      "first.manualLyricsCache.set('lib-track',{lyrics:'MANUAL-LIB',lyricsType:'txt',parsedLyrics:[{time:0,text:'MANUAL-LIB'}]});",
      "first.persistState(); stateStore.saveNow();",
      "const disk=JSON.parse(fs.readFileSync(path.join(process.env.ELITESAND_DATA_DIR,'state.json'),'utf8'));",
      "const compact=disk.playlist.slice(0,2).every((t)=>!Object.prototype.hasOwnProperty.call(t,'lyrics')&&!Object.prototype.hasOwnProperty.call(t,'parsedLyrics'));",
      "const dirtyFallback=disk.playlist[2].lyrics; const localFallback=disk.playlist[3].lyrics; const manual=disk.manualLyrics['lib-track']&&disk.manualLyrics['lib-track'].lyrics;",
      "library.remove('dirty-track');",
      "const restored=createAppState({emit(){}}); const p=restored.playState.playlist; const restoredCount=p.length; const restoredEntryIds=p.map(t=>t.entryId);",
      "const later={id:'later-track',entryId:'entry-later',title:'Later',filename:'later.mp3',lyrics:'LATER-FALLBACK',lyricsType:'txt',parsedLyrics:[{time:0,text:'LATER-FALLBACK'}]}; library.rememberImport(later); restored.playState.playlist.push(later); restored.persistState(); stateStore.saveNow();",
      "const beforeDurable=JSON.parse(fs.readFileSync(path.join(process.env.ELITESAND_DATA_DIR,'state.json'),'utf8')).playlist.find(t=>t.id==='later-track');",
      "library.saveNow(); stateStore.saveNow();",
      "const afterDurable=JSON.parse(fs.readFileSync(path.join(process.env.ELITESAND_DATA_DIR,'state.json'),'utf8')).playlist.find(t=>t.id==='later-track');",
      "process.stdout.write('__STATE_SLIM__'+JSON.stringify({compact,dirtyFallback,localFallback,manual,count:restoredCount,entryIds:restoredEntryIds,libLyrics:p[0].lyrics,dirtyLyrics:p[2].lyrics,localLyrics:p[3].lyrics,stems:[p[0].vocalsFile,p[0].instrumentalFile,p[0].separationStatus],currentEntryId:restored.playState.currentTrack&&restored.playState.currentTrack.entryId,played:[...restored.playState.playedEntryIds],laterBefore:beforeDurable&&beforeDurable.lyrics,laterCompacted:afterDurable&&!Object.prototype.hasOwnProperty.call(afterDurable,'lyrics')})+'\\n');",
    ].join('\n');
    const child = spawnStateStore(process.execPath, ['-e', script, appStatePath, stateStorePath, libraryStorePath], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir, ELITESAND_DOWNLOADS_DIR: downloadsDir },
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    eq(child.status, 0, `state slim child stderr=${child.stderr} stdout=${child.stdout}: `);
    const markerAt = child.stdout.lastIndexOf('__STATE_SLIM__');
    ok(markerAt >= 0, `state slim child 缺少結果：${child.stdout}`);
    const result = JSON.parse(child.stdout.slice(markerAt + '__STATE_SLIM__'.length).trim().split(/\r?\n/, 1)[0]);
    eq(result.compact, true, '已落盤 library track 不應在 state 重複完整歌詞: ');
    eq(result.dirtyFallback, 'DIRTY-FALLBACK', 'library 尚未落盤時 state 必須保留完整 fallback: ');
    eq(result.localFallback, 'LOCAL-FALLBACK', '非 library 本機歌必須保留完整 fallback: ');
    eq(result.manual, 'MANUAL-LIB', '手動歌詞仍由獨立 manualLyrics 保存: ');
    eq(result.count, 4);
    eq(result.entryIds[0], 'entry-lib-a'); eq(result.entryIds[1], 'entry-lib-b');
    eq(result.libLyrics, 'LIBRARY-LYRIC-'.repeat(2000), '重開時 library-backed 歌詞必須完整 rehydrate: ');
    eq(result.dirtyLyrics, 'DIRTY-FALLBACK', '即使 library entry 消失，dirty fallback 仍可還原: ');
    eq(result.localLyrics, 'LOCAL-FALLBACK');
    eq(result.stems.join(','), 'lib.vocals.wav,lib.instrumental.wav,done');
    eq(result.currentEntryId, 'entry-lib-b', '重複同 id 仍以 entryId 還原正確目前歌曲: ');
    eq(result.played.sort().join(','), 'entry-lib-a,entry-lib-b');
    eq(result.laterBefore, 'LATER-FALLBACK', 'library 落盤前仍要有 crash-safe fallback: ');
    eq(result.laterCompacted, true, 'library 落盤成功後應自動排程 state 再瘦身，不等下一次使用者操作: ');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('儲存歌單：建立／改名／加歌去重／移歌／刪除／上限，並原子落盤可重新載入', () => {
  const savedPlaylists = require('../server/services/saved-playlists');
  const before = savedPlaylists.list().map((p) => p.id);
  try {
    eq(savedPlaylists.create({ name: '   ' }).error, 'name_required', '空白名稱: ');
    const created = savedPlaylists.create({ name: '  歌回 A  \n', trackIds: ['t1', 't2', 't1', '', null, 't3'] });
    ok(created.ok, '建立: ');
    eq(created.playlist.name, '歌回 A', '名稱去頭尾空白與換行: ');
    eq(created.playlist.trackIds.join(','), 't1,t2,t3', '建立時去重並過濾空值: ');
    const id = created.playlist.id;

    const added = savedPlaylists.addTracks(id, ['t2', 't4']);
    eq(added.added, 1, '已在歌單的 id 不重複加入: ');
    eq(added.playlist.trackIds.join(','), 't1,t2,t3,t4', '附加到末端: ');
    const removed = savedPlaylists.removeTracks(id, ['t1', 'nope']);
    eq(removed.removed, 1);
    eq(removed.playlist.trackIds.join(','), 't2,t3,t4', '移除保持順序: ');

    eq(savedPlaylists.rename(id, '').error, 'name_required');
    eq(savedPlaylists.rename('missing', 'x').error, 'not_found');
    eq(savedPlaylists.rename(id, 'x'.repeat(200)).playlist.name.length, savedPlaylists.MAX_NAME_LENGTH, '名稱長度上限: ');

    // 媒體庫刪歌後同步剪掉；null 代表清空媒體庫
    eq(savedPlaylists.pruneTrackIds(['t3']), 1);
    eq(savedPlaylists.get(id).trackIds.join(','), 't2,t4');
    eq(savedPlaylists.pruneTrackIds(['not-in-any']), 0, '沒有命中就不觸發保存: ');

    // 回傳的是副本，外部改動不可污染 store
    savedPlaylists.get(id).trackIds.push('leak');
    eq(savedPlaylists.get(id).trackIds.length, 2, 'get() 必須回傳副本: ');

    ok(savedPlaylists.saveNow(), '落盤: ');
    const file = path.join(process.env.ELITESAND_DATA_DIR, 'playlists.json');
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    eq(onDisk.schemaVersion, 1);
    ok(onDisk.playlists.some((p) => p.id === id && p.trackIds.join(',') === 't2,t4'), '磁碟內容: ');

    eq(savedPlaylists.remove(id).ok, true);
    eq(savedPlaylists.remove(id).error, 'not_found');
  } finally {
    for (const p of savedPlaylists.list()) if (!before.includes(p.id)) savedPlaylists.remove(p.id);
    savedPlaylists.saveNow();
  }
});

test('儲存歌單 socket：只收媒體庫存在的 id、變更才廣播給控制端、媒體庫刪歌／清空會同步剪歌單', () => {
  const registerLibraryHandlers = require('../server/routes/handlers/library');
  const libraryStore = require('../server/services/library-store');
  const savedPlaylists = require('../server/services/saved-playlists');
  const before = savedPlaylists.list().map((p) => p.id);
  const originalRemove = libraryStore.remove;
  const originalClear = libraryStore.clear;
  const originalGetEntry = libraryStore.getEntry;
  const originalHasEntry = libraryStore.hasEntry;
  const events = new Map();
  const broadcasts = [];
  const io = { to() { return { emit(event, data) { broadcasts.push({ event, data }); } }; }, sockets: { sockets: new Map() } };
  const socket = { id: 'sp-controller', clientType: 'controller', on(event, handler) { events.set(event, handler); }, emit() {} };
  const persisted = [];
  try {
    const knownIds = new Set(['lib-a', 'lib-b']);
    libraryStore.getEntry = (id) => (knownIds.has(String(id)) ? { id: String(id), title: id } : null);
    libraryStore.hasEntry = (id) => knownIds.has(String(id));
    libraryStore.remove = (id) => knownIds.delete(String(id));
    libraryStore.clear = () => { knownIds.clear(); return true; };
    registerLibraryHandlers(io, socket, { playState: { playlist: [], currentTrack: null }, persistState: () => persisted.push(1) });

    let ack = null;
    events.get('savedPlaylists:create')({ name: '直播 set', trackIds: [] }, (r) => { ack = r; });
    ok(ack.ok, '建立: ');
    const id = ack.playlist.id;
    const listBroadcasts = () => broadcasts.filter((b) => b.event === 'savedPlaylists:list').length;
    const afterCreate = listBroadcasts();
    ok(afterCreate >= 1, '建立要廣播清單: ');

    events.get('savedPlaylists:addTracks')({ id, trackIds: ['lib-a', 'ghost', 'lib-b'] }, (r) => { ack = r; });
    eq(ack.added, 2, '不在媒體庫的 id 要被擋掉: ');
    eq(ack.playlist.trackIds.join(','), 'lib-a,lib-b');
    const afterAdd = listBroadcasts();
    events.get('savedPlaylists:addTracks')({ id, trackIds: ['lib-a'] }, (r) => { ack = r; });
    eq(ack.added, 0);
    eq(listBroadcasts(), afterAdd, '沒有實際變更不可再廣播: ');

    events.get('library:remove')('lib-a', (r) => { ack = r; });
    ok(ack.ok);
    eq(savedPlaylists.get(id).trackIds.join(','), 'lib-b', '媒體庫刪歌後歌單同步剪掉: ');
    ok(listBroadcasts() > afterAdd, '剪掉後要廣播歌單: ');

    events.get('library:clear')(null, (r) => { ack = r; });
    ok(ack.ok);
    eq(savedPlaylists.get(id).trackIds.length, 0, '清空媒體庫後歌單清空但保留歌單本身: ');
    ok(savedPlaylists.get(id), '歌單本身不可被刪除: ');

    events.get('savedPlaylists:rename')({ id, name: '' }, (r) => { ack = r; });
    eq(ack.error, 'name_required');
    events.get('savedPlaylists:delete')(id, (r) => { ack = r; });
    ok(ack.ok);
    eq(savedPlaylists.get(id), null);
  } finally {
    libraryStore.remove = originalRemove;
    libraryStore.clear = originalClear;
    libraryStore.getEntry = originalGetEntry;
    libraryStore.hasEntry = originalHasEntry;
    for (const p of savedPlaylists.list()) if (!before.includes(p.id)) savedPlaylists.remove(p.id);
    savedPlaylists.saveNow();
  }
});

test('儲存歌單 setOrder：只接受既有 id 的排列，未列出的依原順序補回末端，沒變不落盤', () => {
  const savedPlaylists = require('../server/services/saved-playlists');
  const created = savedPlaylists.create({ name: 'order', trackIds: ['a', 'b', 'c', 'gone'] });
  const id = created.playlist.id;
  try {
    let res = savedPlaylists.setOrder(id, ['c', 'a', 'b', 'stranger']);
    ok(res.ok && res.changed);
    eq(res.playlist.trackIds.join(','), 'c,a,b,gone', '面板看不到的 gone 要補回末端、stranger 丟掉: ');
    res = savedPlaylists.setOrder(id, ['c', 'a', 'b']);
    eq(res.changed, false, '同順序不可標為變更: ');
    eq(savedPlaylists.setOrder('missing', []).error, 'not_found');
  } finally {
    savedPlaylists.remove(id);
    savedPlaylists.saveNow();
  }
});

test('savedPlaylists:load 伺服器端整份載入：音檔在的依序附加到播放清單，音檔不在的只回報、絕不自行下載', () => {
  const registerLibraryHandlers = require('../server/routes/handlers/library');
  const libraryStore = require('../server/services/library-store');
  const savedPlaylists = require('../server/services/saved-playlists');
  const { MAX_PLAYLIST_SIZE } = require('../server/utils/track-schema');
  const originalGetEntry = libraryStore.getEntry;
  const originalLookup = libraryStore.getAudioExistsLookup;
  const events = new Map();
  const rooms = [];
  const io = { to(room) { return { emit(event, data) { rooms.push({ room, event, count: Array.isArray(data) ? data.length : null }); } }; } };
  const socket = { id: 'sp-remote', clientType: 'remote', on(event, handler) { events.set(event, handler); }, emit() {} };
  const playState = { playlist: [], currentTrack: null };
  const calls = { persist: 0, setlist: 0, broadcast: 0 };
  const entries = {
    ready1: { id: 'ready1', title: 'Ready 1', filename: 'ready1.webm', url: 'https://youtu.be/r1', lyrics: '[00:01.00]hi', separationStatus: 'done', vocalsFile: 'ready1.vocals.wav', instrumentalFile: 'ready1.inst.wav' },
    dl1: { id: 'dl1', title: 'Needs download', filename: 'gone.webm', url: 'https://youtu.be/d1' },
    nourl: { id: 'nourl', title: 'Local gone', filename: 'local-gone.mp3' },
    ready2: { id: 'ready2', title: 'Ready 2', filename: 'ready2.webm' },
  };
  const created = savedPlaylists.create({ name: 'load', trackIds: ['ready1', 'dl1', 'ghost', 'nourl', 'ready2'] });
  try {
    libraryStore.getEntry = (id) => entries[String(id)] || null;
    libraryStore.getAudioExistsLookup = () => (name) => name === 'ready1.webm' || name === 'ready2.webm';
    registerLibraryHandlers(io, socket, {
      playState,
      persistState: () => calls.persist++,
      emitSetlist: () => calls.setlist++,
      broadcastState: () => calls.broadcast++,
      getPublicPlaylist: () => playState.playlist,
      getReadOnlyPlaylist: () => playState.playlist.map((t) => ({ id: t.id })),
    });
    let ack = null;
    events.get('savedPlaylists:load')({ id: created.playlist.id }, (r) => { ack = r; });
    ok(ack.ok, '載入: ');
    eq(ack.added, 2);
    eq(ack.missing, 2, 'ghost（不在庫）與 nourl（無音檔也無網址）都算 missing: ');
    eq(ack.needsDownload.length, 1);
    eq(ack.needsDownload[0].id, 'dl1');
    eq(ack.needsDownload[0].url, 'https://youtu.be/d1');
    eq(playState.playlist.map((t) => t.id).join(','), 'ready1,ready2', '依歌單順序附加: ');
    ok(playState.playlist.every((t) => t.entryId), '要有 entryId（等同 playlist:add）: ');
    eq(playState.playlist[0].vocalsFile, 'ready1.vocals.wav', 'AI stems 欄位不可被組 track 時漏掉: ');
    eq(playState.playlist[0].lyrics, '[00:01.00]hi');
    ok(rooms.some((r) => r.event === 'playlist:update' && r.room === 'access:control' && r.count === 2), '控制端 playlist:update: ');
    ok(rooms.some((r) => r.event === 'playlist:update' && r.room === 'access:read-only'), '唯讀端 playlist:update: ');
    eq(calls.persist, 1); eq(calls.setlist, 1); eq(calls.broadcast, 1);

    // 播放清單快滿時只加得下的部分
    playState.playlist = Array.from({ length: MAX_PLAYLIST_SIZE - 1 }, (_, i) => ({ id: `fill-${i}`, title: 'x' }));
    events.get('savedPlaylists:load')({ id: created.playlist.id }, (r) => { ack = r; });
    eq(ack.added, 1); eq(ack.overflow, 1);
    eq(playState.playlist.length, MAX_PLAYLIST_SIZE);

    events.get('savedPlaylists:load')({ id: 'nope' }, (r) => { ack = r; });
    eq(ack.error, 'not_found');
  } finally {
    libraryStore.getEntry = originalGetEntry;
    libraryStore.getAudioExistsLookup = originalLookup;
    savedPlaylists.remove(created.playlist.id);
    savedPlaylists.saveNow();
  }
});

test('BGM 待機清單：加歌去重／移歌／重排／刪歌同步／原子落盤可重新載入', () => {
  const bgmPlaylist = require('../server/services/bgm-playlist');
  const before = bgmPlaylist.list();
  try {
    const added = bgmPlaylist.addTracks(['b1', 'b2', 'b1', '', null, 'b3']);
    eq(added.added, 3, '空值/重複要被過濾: ');
    eq(bgmPlaylist.list().join(','), 'b1,b2,b3');
    const addedAgain = bgmPlaylist.addTracks(['b2', 'b4']);
    eq(addedAgain.added, 1, '已在清單的 id 不重複加入: ');
    eq(bgmPlaylist.list().join(','), 'b1,b2,b3,b4');

    const removed = bgmPlaylist.removeTracks(['b1', 'nope']);
    eq(removed.removed, 1);
    eq(bgmPlaylist.list().join(','), 'b2,b3,b4', '移除保持順序: ');

    const ordered = bgmPlaylist.setOrder(['b4', 'b2', 'stranger']);
    ok(ordered.changed);
    eq(ordered.trackIds.join(','), 'b4,b2,b3', '面板看不到的 b3 補回末端、stranger 丟掉: ');
    const same = bgmPlaylist.setOrder(['b4', 'b2', 'b3']);
    eq(same.changed, false, '同順序不可標為變更: ');

    eq(bgmPlaylist.pruneTrackIds(['b2']), true, '媒體庫刪歌後同步剪掉: ');
    eq(bgmPlaylist.list().join(','), 'b4,b3');
    eq(bgmPlaylist.pruneTrackIds(['not-in-any']), false, '沒有命中就不觸發保存: ');

    ok(bgmPlaylist.saveNow(), '落盤: ');
    const file = path.join(process.env.ELITESAND_DATA_DIR, 'bgm-playlist.json');
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    eq(onDisk.trackIds.join(','), 'b4,b3', '磁碟內容: ');

    eq(bgmPlaylist.pruneTrackIds(null), true, 'null 代表全部清空: ');
    eq(bgmPlaylist.list().length, 0);
  } finally {
    // 試跑期間清單已被清空（pruneTrackIds(null)）；只需要把原本的 id 加回來。
    for (const id of bgmPlaylist.list()) bgmPlaylist.removeTracks([id]);
    for (const id of before) bgmPlaylist.addTracks([id]);
    bgmPlaylist.saveNow();
  }
});

test('BGM socket：開關走 io.emit 廣播給所有端（含手機遙控器），清單管理限桌面 controller', () => {
  const registerBgmHandlers = require('../server/routes/handlers/bgm');
  const bgmPlaylist = require('../server/services/bgm-playlist');
  const libraryStore = require('../server/services/library-store');
  const before = bgmPlaylist.list();
  const originalGetEntry = libraryStore.getEntry;
  const originalHasEntry = libraryStore.hasEntry;
  const originalLookup = libraryStore.getAudioExistsLookup;
  const broadcasts = [];
  const io = { emit(event, data) { broadcasts.push({ event, data }); } };
  const playState = { bgmSettings: { enabled: false, playing: false } };
  const persisted = [];
  const ctx = { playState, persistState: () => persisted.push(1) };
  try {
    libraryStore.getEntry = (id) => (id === 'lib-a' ? { id, title: 'A', filename: 'a.mp3' } : null);
    libraryStore.hasEntry = (id) => id === 'lib-a';
    libraryStore.getAudioExistsLookup = () => (() => true);

    // 桌面面板：開關 + 清單管理都能用
    const controllerEvents = new Map();
    const controllerSocket = { clientType: 'controller', on(event, handler) { controllerEvents.set(event, handler); } };
    registerBgmHandlers(io, controllerSocket, ctx);

    let ack = null;
    controllerEvents.get('bgm:enable')(null, (r) => { ack = r; });
    ok(ack.ok && playState.bgmSettings.enabled, '啟用: ');
    ok(broadcasts.some((b) => b.event === 'bgm:settings:update' && b.data.enabled === true), '開關要走 io.emit 廣播給所有端: ');
    eq(persisted.length, 1, '啟用要持久化: ');

    controllerEvents.get('bgm:addTracks')({ trackIds: ['lib-a', 'ghost'] }, (r) => { ack = r; });
    eq(ack.added, 1, '不在媒體庫的 id 要被擋掉: ');
    ok(broadcasts.some((b) => b.event === 'bgm:playlist'), '新增要廣播播放清單: ');

    controllerEvents.get('bgm:list')(null, (r) => { ack = r; });
    eq(ack.trackIds.join(','), 'lib-a', '媒體庫「加入 BGM」勾選框要靠 trackIds 判斷歸屬，不能只看 tracks/needsDownload: ');

    controllerEvents.get('bgm:status')({ playing: true });
    eq(playState.bgmSettings.playing, true, '面板回報播放狀態: ');
    controllerEvents.get('bgm:status')({ playing: true });
    const statusBroadcasts = broadcasts.filter((b) => b.event === 'bgm:settings:update').length;
    controllerEvents.get('bgm:status')({ playing: true });
    eq(broadcasts.filter((b) => b.event === 'bgm:settings:update').length, statusBroadcasts, '狀態沒變不可重複廣播: ');

    // 手機遙控器：開關可以用，清單管理不掛（remote 沒有這幾個事件）
    const remoteEvents = new Map();
    const remoteSocket = { clientType: 'remote', on(event, handler) { remoteEvents.set(event, handler); } };
    registerBgmHandlers(io, remoteSocket, ctx);
    ok(remoteEvents.has('bgm:enable') && remoteEvents.has('bgm:disable') && remoteEvents.has('bgm:status'), '手機遙控器要能開關與回報狀態: ');
    ok(!remoteEvents.has('bgm:addTracks') && !remoteEvents.has('bgm:removeTracks') && !remoteEvents.has('bgm:setOrder'), '清單管理不對手機遙控器開放: ');

    remoteEvents.get('bgm:disable')(null, (r) => { ack = r; });
    ok(ack.ok && !playState.bgmSettings.enabled && !playState.bgmSettings.playing, '手機遙控器可以關閉 BGM，且連帶清掉播放狀態: ');
  } finally {
    libraryStore.getEntry = originalGetEntry;
    libraryStore.hasEntry = originalHasEntry;
    libraryStore.getAudioExistsLookup = originalLookup;
    for (const id of bgmPlaylist.list()) bgmPlaylist.removeTracks([id]);
    for (const id of before) bgmPlaylist.addTracks([id]);
    bgmPlaylist.saveNow();
  }
});

test('BGM 音量／恢復延遲：數值會夾在合法範圍、限桌面 controller、變更才廣播與持久化', () => {
  const bgmSettingsSchema = require('../server/services/bgm-settings');
  eq(bgmSettingsSchema.clampSettings({ volume: 999, pauseResumeDelayMs: -5, endResumeDelayMs: 999999 }).volume, 100, '音量超出上限要夾住: ');
  eq(bgmSettingsSchema.clampSettings({ volume: -5 }).volume, 0, '音量低於下限要夾住: ');
  eq(bgmSettingsSchema.clampSettings({ pauseResumeDelayMs: -5 }).pauseResumeDelayMs, 0, '延遲不可為負: ');
  eq(bgmSettingsSchema.clampSettings({ endResumeDelayMs: 999999 }).endResumeDelayMs, bgmSettingsSchema.LIMITS.delayMsMax, '延遲要夾在上限: ');
  eq(bgmSettingsSchema.clampSettings({ volume: 'nope' }, { volume: 42 }).volume, 42, '非數字要退回目前值，不是預設值: ');

  const registerBgmHandlers = require('../server/routes/handlers/bgm');
  const broadcasts = [];
  const io = { emit(event, data) { broadcasts.push({ event, data }); } };
  const playState = { bgmSettings: { enabled: true, playing: false, volume: 70, pauseResumeDelayMs: 3000, endResumeDelayMs: 5000 } };
  const persisted = [];
  const ctx = { playState, persistState: () => persisted.push(1) };
  const controllerEvents = new Map();
  registerBgmHandlers(io, { clientType: 'controller', on(event, handler) { controllerEvents.set(event, handler); } }, ctx);
  const remoteEvents = new Map();
  registerBgmHandlers(io, { clientType: 'remote', on(event, handler) { remoteEvents.set(event, handler); } }, ctx);

  ok(!remoteEvents.has('bgm:settings:set'), '手機遙控器沒有音量/延遲調整入口: ');

  let ack = null;
  controllerEvents.get('bgm:settings:set')({ volume: 40, pauseResumeDelayMs: 1000, endResumeDelayMs: 2000 }, (r) => { ack = r; });
  ok(ack.ok, '桌面 controller 可以調整: ');
  eq(playState.bgmSettings.volume, 40);
  eq(playState.bgmSettings.pauseResumeDelayMs, 1000);
  eq(playState.bgmSettings.endResumeDelayMs, 2000);
  ok(broadcasts.some((b) => b.event === 'bgm:settings:update' && b.data.volume === 40), '調整要廣播給所有端: ');
  eq(persisted.length, 1, '調整要持久化: ');
});

test('手機遙控器收藏歌單：兩段式點擊載入、走伺服器端 savedPlaylists:load、不含建立／編輯入口', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'controller.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'controller.js'), 'utf8');
  ok(html.includes('id="ctrl-collections"'), '遙控器要有收藏歌單區: ');
  ok(js.includes("sendWithCallback('savedPlaylists:load'"), '遙控器載入必須走伺服器端整份載入: ');
  ok(js.includes('armedCollectionId === item.id'), '要有兩段式點擊確認: ');
  ['savedPlaylists:create', 'savedPlaylists:delete', 'savedPlaylists:rename', 'importYouTubeUrl'].forEach((needle) =>
    ok(!js.includes(needle), `遙控器不可有 ${needle}: `));
});

test('儲存歌單 UI：面板有 chip／建立／載入入口，載入走既有逐首還原佇列，且五語翻譯鍵齊全', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'media-library.js'), 'utf8');
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'i18n.js'), 'utf8');
  ['id="lib-playlist-chips"', 'id="lib-playlist-new"', 'id="lib-playlist-load"', 'id="lib-playlist-rename"', 'id="lib-playlist-delete"']
    .forEach((needle) => ok(html.includes(needle), `面板缺少 ${needle}: `));
  ok(js.includes("restoreQueue.push({ item, btn: null"), '整份載入必須重用逐首還原佇列，不可另開一條併發路徑: ');
  ok(js.includes("SocketClient.on('savedPlaylists:list'"), '要接伺服器廣播: ');
  ok(!js.includes('window.prompt('), '命名不可用瀏覽器原生 prompt: ');
  for (const match of js.matchAll(/tx\('([^']+)'/g)) {
    ok(i18n.includes(`'${match[1]}':`), `media-library.js 引用的翻譯鍵 ${match[1]} 不存在: `);
  }
});

test('媒體庫 BGM 假歌單：跟收藏歌單共用同一套 chip／篩選/拖曳排序機制，但讀寫各自呼叫 bgm:*，且不受「沒有收藏歌單」影響', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'media-library.js'), 'utf8');
  // 迴歸：這顆「+」按鈕曾經在使用者一份收藏歌單都沒建立時完全不渲染，導致從主列表
  // 完全點不到「加入 BGM」（2026-09-16 手動驗證時發現並修掉）。
  ok(!/if \(!savedPlaylists\.length\) return '';/.test(js),
    '「加入歌單」按鈕不可再因為沒有收藏歌單就整顆不顯示——BGM 一定存在，永遠至少有一個可選目標: ');
  ok(js.includes("const BGM_PLAYLIST_ID = '__bgm__'"), '要有 BGM 假歌單 id 常數: ');
  ['bgm:addTracks', 'bgm:removeTracks', 'bgm:setOrder', 'bgm:list'].forEach((needle) =>
    ok(js.includes(`'${needle}'`), `媒體庫要能呼叫 ${needle}: `));
  ok(js.includes('active.isBgm'), 'BGM 分支要用 isBgm 旗標區分，不能跟一般收藏歌單共用同一條寫入路徑: ');
  ok(js.includes('loadBtn.hidden = isBgmActive') && js.includes('renameBtn.hidden = isBgmActive') && js.includes('deleteBtn.hidden = isBgmActive'),
    'BGM 是系統內建固定清單，「全部載入播放清單」／改名／刪除都不該對它開放: ');
  ok(js.includes('activePlaylistId !== BGM_PLAYLIST_ID && !savedPlaylists.some'),
    '收藏歌單清單變動時的「歌單消失了」偵測，不可誤判 BGM 假歌單也消失並把使用者踢出篩選畫面: ');

  // 迴歸：BGM 篩選畫面下，音檔不在本機的歌一樣會顯示「加入清單」（.lib-reimport）按鈕
  // ——那顆按鈕的原本行為（reimport()）無條件把歌塞進 playState.playlist（正在唱的
  // 清單），在 BGM 篩選畫面下按下去卻被塞進正在唱的清單而不是 BGM，是完全錯的行為
  // （2026-09-17 使用者回報）。必須改成 BGM 篩選下只重新下載音檔、不碰播放清單。
  ok(js.includes('async function reimportForBgm(item, row)'), '需要一條 BGM 專用的「加入清單」路徑: ');
  ok(js.includes('if (activePlaylistId === BGM_PLAYLIST_ID) return reimportForBgm(item, row);'),
    'reimport() 進入點要先判斷是不是在 BGM 篩選畫面: ');
  const reimportForBgmBody = js.slice(js.indexOf('async function reimportForBgm'), js.indexOf('async function reimport(item, row)'));
  ok(!reimportForBgmBody.includes('addLibraryTrack') && !reimportForBgmBody.includes('runRestoreQueue'),
    'BGM 的「加入清單」絕不可呼叫會把歌塞進正在唱的播放清單的既有共用路徑: ');
  ok(reimportForBgmBody.includes('skipPlaylistInsert: true'), 'BGM 重新下載一樣要走 skipPlaylistInsert，不進播放清單: ');
});

test('媒體庫直接刪除前先同步保存播放清單完整 fallback，library.json 落盤後重開不丟歌詞', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-library-remove-barrier-'));
  const downloadsDir = path.join(dataDir, 'downloads');
  try {
    const appStatePath = path.join(__dirname, '..', 'server', 'state', 'app-state.js');
    const stateStorePath = path.join(__dirname, '..', 'server', 'services', 'state-store.js');
    const libraryStorePath = path.join(__dirname, '..', 'server', 'services', 'library-store.js');
    const script = [
      "const fs=require('fs'); const path=require('path');",
      "const {createAppState}=require(process.argv[1]); const stateStore=require(process.argv[2]); const library=require(process.argv[3]);",
      "const track={id:'remove-me',entryId:'remove-entry',title:'Remove',filename:'remove.mp3',lyrics:'REMOVE-FALLBACK',lyricsType:'lrc',parsedLyrics:[{time:0,text:'REMOVE-FALLBACK'}],vocalsFile:'remove.vocals.wav',instrumentalFile:'remove.instrumental.wav',separationStatus:'done'};",
      "library.rememberImport(track); if(!library.saveNow()) throw new Error('initial library save failed');",
      "const first=createAppState({emit(){}}); first.playState.playlist=[track]; first.persistState(); stateStore.saveNow();",
      "const before=JSON.parse(fs.readFileSync(path.join(process.env.ELITESAND_DATA_DIR,'state.json'),'utf8')).playlist[0];",
      "const removed=library.remove(track.id); const afterBarrier=JSON.parse(fs.readFileSync(path.join(process.env.ELITESAND_DATA_DIR,'state.json'),'utf8')).playlist[0];",
      "if(!library.saveNow()) throw new Error('library removal save failed'); stateStore.saveNow();",
      "const restored=createAppState({emit(){}}).playState.playlist[0];",
      "process.stdout.write('__REMOVE_BARRIER__'+JSON.stringify({removed,beforeHasLyrics:Object.prototype.hasOwnProperty.call(before,'lyrics'),barrierLyrics:afterBarrier.lyrics,restoredLyrics:restored.lyrics,stems:[restored.vocalsFile,restored.instrumentalFile,restored.separationStatus]})+'\\n');",
    ].join('\n');
    const child = spawnStateStore(process.execPath, ['-e', script, appStatePath, stateStorePath, libraryStorePath], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir, ELITESAND_DOWNLOADS_DIR: downloadsDir },
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    eq(child.status, 0, `library remove barrier child stderr=${child.stderr} stdout=${child.stdout}: `);
    const markerAt = child.stdout.lastIndexOf('__REMOVE_BARRIER__');
    ok(markerAt >= 0, `library remove barrier child 缺少結果：${child.stdout}`);
    const result = JSON.parse(child.stdout.slice(markerAt + '__REMOVE_BARRIER__'.length).trim().split(/\r?\n/, 1)[0]);
    eq(result.removed, true);
    eq(result.beforeHasLyrics, false, 'durable library backing 時 state 原本應是 compact: ');
    eq(result.barrierLyrics, 'REMOVE-FALLBACK', '刪 library 前必須同步寫入完整 state fallback: ');
    eq(result.restoredLyrics, 'REMOVE-FALLBACK', 'library 真正刪除落盤後仍可從 state 還原: ');
    eq(result.stems.join(','), 'remove.vocals.wav,remove.instrumental.wav,done');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('手動歌詞上限只裁歷史記憶：播放清單內超過 200 首仍全部保存', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-manual-lyrics-cap-'));
  try {
    const stateStorePath = path.join(__dirname, '..', 'server', 'services', 'state-store.js');
    const script = [
      "const fs=require('fs'); const path=require('path'); const store=require(process.argv[1]);",
      "const playlist=Array.from({length:250},(_,i)=>({id:'active-'+i,entryId:'entry-'+i,title:'A'+i}));",
      "const manual={}; for(let i=0;i<250;i++) manual['active-'+i]={lyrics:'ACTIVE-'+i,timestamp:i}; for(let i=0;i<250;i++) manual['history-'+i]={lyrics:'HISTORY-'+i,timestamp:1000+i};",
      "store.scheduleSave(()=>({schemaVersion:store.CURRENT_STATE_SCHEMA_VERSION,savedAt:Date.now(),playlist,manualLyrics:manual})); store.saveNow();",
      "const disk=JSON.parse(fs.readFileSync(path.join(process.env.ELITESAND_DATA_DIR,'state.json'),'utf8')); const keys=Object.keys(disk.manualLyrics||{});",
      "process.stdout.write('__MANUAL_CAP__'+JSON.stringify({active:keys.filter(k=>k.startsWith('active-')).length,history:keys.filter(k=>k.startsWith('history-')).length,total:keys.length,oldestHistory:!!disk.manualLyrics['history-50'],newestHistory:!!disk.manualLyrics['history-249']})+'\\n');",
    ].join('\n');
    const child = spawnStateStore(process.execPath, ['-e', script, stateStorePath], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir }, encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    eq(child.status, 0, `manual lyrics cap child stderr=${child.stderr} stdout=${child.stdout}: `);
    const markerAt = child.stdout.lastIndexOf('__MANUAL_CAP__');
    ok(markerAt >= 0, `manual lyrics cap child 缺少結果：${child.stdout}`);
    const result = JSON.parse(child.stdout.slice(markerAt + '__MANUAL_CAP__'.length).trim().split(/\r?\n/, 1)[0]);
    eq(result.active, 250, '目前歌單引用的 250 筆手動歌詞必須全部保留: ');
    eq(result.history, 200, '歷史手動歌詞仍維持 200 筆安全上限: ');
    eq(result.total, 450);
    eq(result.oldestHistory, true, '最新 200 筆歷史中 history-50 應保留: ');
    eq(result.newestHistory, true);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('state-store debounce has a bounded max wait during continuous edits', () => {
  const { SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS, saveDelayMs } = require('../server/services/state-store');
  eq(SAVE_DEBOUNCE_MS, 800);
  eq(SAVE_MAX_WAIT_MS, 5000);
  eq(saveDelayMs(1000, 1000), 800, '第一次排程保留正常 debounce: ');
  eq(saveDelayMs(1000, 4500), 800, '距離 max wait 還遠時持續合併: ');
  eq(saveDelayMs(1000, 5600), 400, '接近 max wait 時只能再延到上限: ');
  eq(saveDelayMs(1000, 7000), 0, '超過上限必須立刻保存，不得無限重設計時器: ');
});

test('state:sync excludes setlist style snapshots while setlist:update retains them', () => {
  const { createAppState, SETLIST_LAYOUTS } = require('../server/state/app-state');
  const state = createAppState({ emit() {} });
  const sync = state.getPublicState();
  const setlist = state.setlistPayload();
  ok(!Object.prototype.hasOwnProperty.call(sync.session, 'styles'), 'state:sync 不可攜帶完整 setlist styles: ');
  ok(!Object.prototype.hasOwnProperty.call(sync.session, 'style') && !Object.prototype.hasOwnProperty.call(sync.session, 'sceneStyles'),
    'state:sync 不可攜帶 legacy setlist style 視圖: ');
  eq(Object.keys(setlist.styles).length, SETLIST_LAYOUTS.length, 'setlist:update 初始載入必須保留各模板外觀: ');
  const socketSource = fs.readFileSync(path.join(__dirname, '../server/routes/socket-handler.js'), 'utf8');
  const panelSource = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  ok(socketSource.includes("socket.on('setlist:get', (_data, ack) => {"),
    'setlist payload 必須可按需取得，不能綁在 controller 初始同步後: ');
  ok(panelSource.includes("SocketClient.on('connection-change', (connected) => {"),
    '控制面板連線後必須主動取得 setlist 外觀: ');
  ok(panelSource.includes("SocketClient.on('setlist:update', applySetlistControls)"));
});

test('R2-2 2000-song playlist stays compact across all real Socket roles including display-spout', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-state-sync-matrix-'));
  try {
    const result = spawnStateStore(process.execPath, [
      path.join(__dirname, 'socket-state-sync-matrix-child.js'),
      path.join(__dirname, '..'),
      dataDir,
    ], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      // Windows runner 需要把 2000 首 fixture 的 state/library 原子落盤後才會退出；
      // 慢速磁碟上收尾曾超過 20 秒，但功能結果早已成功輸出。保留外層保底，僅把
      // 它拉到高於 production graceful shutdown 與這份大型 fixture 的合理總時間。
      timeout: 45000,
      windowsHide: true,
    });
    ok(!result.error || result.error.code !== 'ETIMEDOUT', `state-sync matrix timed out: ${result.stdout}\n${result.stderr}`);
    const markerAt = result.stdout.lastIndexOf('__STATE_SYNC_MATRIX__');
    ok(markerAt >= 0, `state-sync matrix returned no result: ${result.stdout}\n${result.stderr}`);
    const line = result.stdout.slice(markerAt + '__STATE_SYNC_MATRIX__'.length).trim().split(/\r?\n/, 1)[0];
    const matrix = JSON.parse(line);
    eq(result.status, 0, `state-sync matrix failed: ${matrix.error || result.stderr}`);
    ok(matrix.ok, matrix.error || 'state-sync matrix should pass');
    eq(matrix.playlistLength, 2000);
    eq(matrix.roles.join(','), 'controller,remote,display,display-spout,setlist');
    const statePayloadBytes = [
      ...Object.values(matrix.initialBytes || {}),
      ...Object.values(matrix.broadcastBytes || {}),
      matrix.recoveryBytes,
    ];
    ok(statePayloadBytes.length === 11 && statePayloadBytes.every((bytes) => bytes < 1024 * 1024),
      `state-sync matrix public payload exceeds 1 MiB: ${JSON.stringify(matrix)}`);
    ok(matrix.initialBytes.controller === matrix.initialBytes.remote
      && matrix.initialBytes.display === matrix.initialBytes['display-spout']
      && matrix.initialBytes.display === matrix.initialBytes.setlist
      && matrix.initialBytes.controller > matrix.initialBytes.display,
    `state-sync matrix must keep control and read-only payloads separated: ${JSON.stringify(matrix)}`);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
testAsync('下載前 metadata 檢查可由工作中心立即取消', async () => {
  const http = require('http');
  const { fetchWithTimeout } = require('../server/utils/helpers');
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const controller = new AbortController();
  const pending = fetchWithTimeout(`http://127.0.0.1:${server.address().port}/pending`, { signal: controller.signal }, 5000);
  controller.abort();
  let error;
  try { await pending; } catch (caught) { error = caught; }
  await new Promise((resolve) => server.close(resolve));
  eq(error?.name, 'AbortError');
});

test('startup import cleanup removes only registered orphan temporary files', () => {
  const { createImportTempRegistry } = require('../server/services/import-temp-registry');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-import-temp-'));
  const dataDir = path.join(root, 'data');
  const downloadsDir = path.join(root, 'downloads');
  fs.mkdirSync(downloadsDir, { recursive: true });
  let activePid = null;
  const registry = createImportTempRegistry({
    dataDir,
    pid: 7788,
    now: () => 123456,
    processAlive: (pid) => pid === activePid,
  });
  try {
    const orphan = registry.begin('orphanFile1');
    fs.writeFileSync(path.join(downloadsDir, 'orphanFile1.webm'), 'partial');
    fs.writeFileSync(path.join(downloadsDir, 'orphanFile1.part'), 'partial');
    fs.writeFileSync(path.join(downloadsDir, 'orphanFile1.m4a'), 'partial');
    fs.writeFileSync(path.join(downloadsDir, 'orphanFile1.mp3'), 'keep');
    fs.writeFileSync(path.join(downloadsDir, 'orphanFile1.txt'), 'keep');
    fs.writeFileSync(path.join(downloadsDir, 'untracked01.webm'), 'keep');
    const result = registry.cleanupOrphans(downloadsDir);
    eq(result.removedFiles.length, 3);
    eq(result.clearedEntries, 1);
    ok(!fs.existsSync(path.join(downloadsDir, 'orphanFile1.webm')));
    ok(fs.existsSync(path.join(downloadsDir, 'orphanFile1.mp3')), 'normal mp3 must survive cleanup');
    ok(fs.existsSync(path.join(downloadsDir, 'orphanFile1.txt')));
    ok(fs.existsSync(path.join(downloadsDir, 'untracked01.webm')), 'unregistered webm must survive cleanup');
    eq(Object.keys(registry.getEntries()).length, 0);

    const active = registry.begin('activeFile1');
    fs.writeFileSync(path.join(downloadsDir, 'activeFile1.webm'), 'running');
    activePid = 7788;
    const activeResult = registry.cleanupOrphans(downloadsDir);
    eq(activeResult.skippedActive, 1);
    ok(fs.existsSync(path.join(downloadsDir, 'activeFile1.webm')), 'live import must survive cleanup');
    eq(registry.finish(active), true);

    const firstAttempt = registry.begin('retryFile01');
    const secondAttempt = registry.begin('retryFile01');
    eq(registry.finish(firstAttempt), false, 'old retry must not clear the newer import entry');
    eq(registry.finish(secondAttempt), true);
    ok(orphan, 'valid imports receive a registry entry');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createObsRecoveryToastHarness() {
  const listeners = new Map();
  const timers = new Map();
  const toasts = [];
  let timerId = 0;
  const makeElement = () => ({
    className: '', textContent: '',
    setAttribute() {},
    classList: {
      add() {}, remove() {}, toggle() {},
    },
  });
  const dom = {
    connectionStatus: makeElement(),
    connectionText: makeElement(),
    displaySourceStatus: makeElement(),
    setlistSourceStatus: makeElement(),
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-toast-utils.js'), 'utf8'),
    {
      AppShared: { dom },
      SocketClient: { on: (event, handler) => listeners.set(event, handler) },
      ErrorHandler: { showToast: (message, type) => toasts.push({ message, type }) },
      document: { getElementById: () => makeElement() },
      setTimeout: (handler) => { const id = ++timerId; timers.set(id, handler); return id; },
      clearTimeout: (id) => timers.delete(id),
    }
  );
  return {
    emit(event, data) { listeners.get(event)?.(data); },
    flushTimers() {
      for (const [id, handler] of [...timers]) {
        timers.delete(id);
        handler();
      }
    },
    toasts,
  };
}

test('R6-2 follow-up OBS 來源服務重啟恢復提示只針對曾連線卻未回來的來源', () => {
  const counts = { displays: 1, setlists: 1, displayRuntime: {} };
  const missing = createObsRecoveryToastHarness();
  missing.emit('connection-change', true);
  missing.emit('client:counts', counts);
  missing.emit('connection-change', false);
  missing.emit('connection-change', true);
  missing.emit('client:counts', { displays: 0, setlists: 0, displayRuntime: {} });
  missing.flushTimers();
  eq(missing.toasts.length, 1);
  eq(missing.toasts[0].type, 'warning');
  ok(missing.toasts[0].message.includes('歌詞、歌單來源沒有重新連回來') && missing.toasts[0].message.includes('重新整理快取'));

  const recovered = createObsRecoveryToastHarness();
  recovered.emit('connection-change', true);
  recovered.emit('client:counts', counts);
  recovered.emit('connection-change', false);
  recovered.emit('connection-change', true);
  recovered.emit('client:counts', counts);
  recovered.flushTimers();
  eq(recovered.toasts.length, 0, '已恢復的來源不可收到多餘提醒: ');

  const firstRun = createObsRecoveryToastHarness();
  firstRun.emit('connection-change', true);
  firstRun.emit('client:counts', { displays: 0, setlists: 0, displayRuntime: {} });
  firstRun.emit('connection-change', false);
  firstRun.emit('connection-change', true);
  firstRun.flushTimers();
  eq(firstRun.toasts.length, 0, '首次尚未設定 OBS 的使用者不可被誤判為來源恢復失敗: ');
});

test('R6-3 非經典模板會在可見範圍說明中交代拼音與諧音限制', () => {
  const lyricExtras = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-extras.js'), 'utf8');
  const unsupportedCopy = '此模板不支援拼音／諧音；需要雙語請選「經典疊層」。';
  const expectedTemplates = ['pulse', 'facet', 'drift', 'aura', 'ktv', 'paperstrip', 'mirror'];
  expectedTemplates.forEach((template) => {
    const entry = new RegExp(`${template}: \\{[^\\n]*${unsupportedCopy.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}`).exec(lyricExtras)?.[0] || '';
    ok(entry.includes(unsupportedCopy), `${template} 必須在模板範圍說明中交代雙語限制: `);
  });
  ok(lyricExtras.includes("classic: { label: '經典疊層'") && lyricExtras.includes('拼音與諧音'), '經典疊層必須持續明示為雙語可用模板: ');
});

test('README 顯示的版號必須跟 package.json 一致（改版號一律用 npm run version:set）', () => {
  // 以前手動改 package.json、README「最新版本」常忘記改，公開倉首頁停在舊版號好幾版
  const tool = require(path.join(__dirname, '..', 'tools', 'set-version.js'));
  const { version, stale } = tool.check();
  ok(stale.length === 0, `README 版號落後 package.json（${version}）：${stale.map((s) => s.rule + '=' + s.version).join('、')}；請跑 npm run version:set -- ${version}: `);
  const sample = ['**最新版本 / Latest：`v1.0.4`**', 'Get-FileHash -Algorithm SHA256 "Elitesand Pro Setup 1.0.0.exe"'].join(' ');
  const out = tool.setReadme(sample, '9.8.7');
  ok(out.includes('Latest：`v9.8.7`') && out.includes('"Elitesand.Pro.Setup.9.8.7.exe"'), '改版號要同時改最新版本與 GitHub 資產實際檔名（空格變點）: ');
});

test('文字PV（JIZURA）：統一感／文字整列吃真實段落，兩側模式只用稽核過的輕量版面', () => {
  const root = path.join(__dirname, '..');
  const tpl = fs.readFileSync(path.join(root, 'public', 'js', 'lyric-template-jizura.js'), 'utf8');
  const listOf = (name) => {
    const m = tpl.match(new RegExp('const ' + name + ' = (\\[[\\s\\S]*?\\]);'));
    ok(m, `模板必須宣告 ${name}: `);
    return vm.runInNewContext(m[1]);
  };
  const SAFE = listOf('SAFE_LAYOUTS_LANDSCAPE');
  const HEAVY = listOf('HEAVY_LAYOUTS');
  const CF = listOf('CENTER_FREE_LAYOUTS');
  ok(CF.length >= 20, '兩側模式要有足夠多的版面可以輪: ');
  // 2026-10-31（PR #44）起兩側與全畫面分開核准：兩側只畫左右兩半，用 tools/audit-jizura-layouts.js --center-free
  // 量「中央保留區不透明 ≤2%」與 p95 ≤25ms。下面這 8 個是只在兩側稽核通過、不在全畫面白名單的；
  // 要再加兩側專用版面，必須重跑 --center-free 稽核並把結果寫進這張表，不能只改模板清單（鐵則 #11：不擋主播）。
  const SIDE_ONLY_AUDITED = ['stack', 'ema', 'ransom', 'clapper', 'warningLabel', 'cube', 'tiles', 'ledScroll'];
  const notSafe = CF.filter((k) => !SAFE.includes(k));
  eq(notSafe.slice().sort().join(','), SIDE_ONLY_AUDITED.slice().sort().join(','), '兩側模式的版面必須在全畫面白名單或兩側稽核表裡（鐵則 #11）: ');
  const heavy = CF.filter((k) => HEAVY.includes(k));
  eq(heavy.join(','), '', '兩側模式每句畫兩份，太重的版面一個都不能收: ');
  ok(HEAVY.includes('ring'), '2026-09-25 稽核：ring 新舊版 p95 都約 28ms，要列為太重: ');

  // 統一感／文字整列一律開；兩側＝centerFree；段落交界翻成空行讓 unify 切段
  ok(/unify: true,/.test(tpl) && /typeset: true,/.test(tpl) && /centerFree: sides,/.test(tpl), 'plan 要開 unify／typeset，兩側模式開 centerFree: ');
  ok(tpl.includes("lineSection[i] !== lineSection[i - 1] ? '\\n' : ''"), '段落交界要插空行（unify 靠空行切段）: ');
  ok(/function sectionIndexAt\(/.test(tpl), '要用 SongFormer 的段落編號切段，不是 profile（主歌一、主歌二是不同段）: ');
  // 兩側模式的另一半要跟著逐字對齊移動
  ok(/function syncCompanion\(c, tl\)/.test(tpl) && tpl.includes('for (const c of list) syncCompanion(c, tl);'), '另一半（附屬 cut）要跟主 cut 一起對齊逐字時間: ');
  // 字型只載這份 plan 用到的
  ok(tpl.includes('J.fontsOfPlan(plan)') && !tpl.includes('J.ensureFonts(text, null)'), '字型只載入 plan 實際用到的，不可整個字型目錄都下載: ');

  // 設定一路打通：模板 enum、面板正規化、伺服器驗證、按鈕、五語文案
  ok(tpl.includes("values: ['right', 'left', 'sides', 'full']"), '模板設定要接受 sides: ');
  const extras = fs.readFileSync(path.join(root, 'public', 'js', 'lyric-extras.js'), 'utf8');
  ok(extras.includes("const JIZURA_PLACEMENTS = ['right', 'left', 'sides', 'full'];"), '面板正規化要接受 sides，否則存檔後被改回偏右: ');
  const lyricsHandler = fs.readFileSync(path.join(root, 'server', 'routes', 'handlers', 'lyrics.js'), 'utf8');
  ok(lyricsHandler.includes("['right', 'left', 'sides', 'full'].includes(out[id].jizuraPlacement)"), '伺服器驗證要接受 sides，否則設定被丟掉: ');
  const panel = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  ok(panel.includes('data-jizura-placement="sides"'), '面板要有「兩側」按鈕: ');

  // 預設兩側：新安裝、壞值、display 還沒收到設定時都落在 sides，面板按鈕也預設亮兩側
  ok(/\? v : 'sides';/.test(tpl) && tpl.includes("default: 'sides' }"), '模板預設（含未知值）要落在兩側: ');
  ok(extras.includes("jizuraPlacement: 'sides', jizuraMotion") && extras.includes("out[id].jizuraPlacement = 'sides';"), '面板預設與壞值回退要是兩側: ');
  const appStateSrc = fs.readFileSync(path.join(root, 'server', 'state', 'app-state.js'), 'utf8');
  ok(appStateSrc.includes("jizuraPlacement: 'sides', jizuraMotion"), '伺服器預設要是兩側: ');
  ok(panel.includes('class="style-thumb active" data-jizura-placement="sides"'), '面板預設要亮「兩側」按鈕: ');
  const i18n = require('../public/js/i18n');
  for (const locale of ['zh-TW', 'en', 'ja', 'ko', 'zh-CN']) {
    ok(i18n.catalogs?.[locale]?.['jizura.placementSides'] && i18n.catalogs?.[locale]?.['jizura.placementSidesTitle'], `${locale} 缺少「兩側」文案: `);
  }
});

test('文字PV（JIZURA）：MIT 授權表記隨引擎一起出貨，display 先載引擎再載模板', () => {
  // JIZURA 是 MIT：可以用、可以改，但著作權與授權全文必須跟著程式走（作者已私訊確認）。
  const root = path.join(__dirname, '..');
  const engine = fs.readFileSync(path.join(root, 'public', 'vendor', 'jizura', 'jizura-engine.js'), 'utf8');
  const license = fs.readFileSync(path.join(root, 'public', 'vendor', 'jizura', 'LICENSE'), 'utf8');
  const notices = fs.readFileSync(path.join(root, 'THIRD-PARTY-NOTICES.txt'), 'utf8');
  const displayHtml = fs.readFileSync(path.join(root, 'public', 'display.html'), 'utf8');
  ok(/MIT License/.test(license) && license.includes('Copyright (c) 2026 hakoniwa'), 'vendor/jizura/LICENSE 必須是完整的 MIT 授權全文: ');
  ok(engine.slice(0, 600).includes('Copyright (c) 2026 hakoniwa') && engine.slice(0, 600).includes('MIT'), '引擎檔頭必須保留著作權與授權表記: ');
  ok(!engine.includes('src/12_ui.js ----') && !engine.includes('src/11_export.js ----'), '只收規劃＋繪製，不收上游 UI 與 MP4 匯出: ');
  // 效能修改（2026-09-25 實測）：每幀換一個小數點字級，canvas 每次 fillText 要 3–8ms 重新解析字型；
  // 色差／震動事件在透明模式下會白做三次整張複製，還把半透明的字與光暈 alpha 平方變暗
  // 2026-09-25 引擎升級後主繪字多了可變字重分支（統一感的「太さ」），兩條路都要吃量化字級；
  // 引擎檔由 tools/vendor-jizura.js 產生並自動套上這些修補
  ok(engine.includes('J.fontPx = ') && engine.includes('J.fontCSS(it.font, fq)') && engine.includes('J.varFontCSS(it.font, fq, wg)'),
    '引擎繪字必須用量化字級（J.fontPx）＋縮放補差，不可每幀換新字級: ');
  ok(engine.includes('font: ctx.font, px: fq,'), '變形（モーフ）記錄的字級要跟量化後的字型一致，重畫時大小才對: ');
  ok(fs.existsSync(path.join(root, 'tools', 'vendor-jizura.js')) && fs.existsSync(path.join(root, 'tools', 'audit-jizura-layouts.js')),
    '引擎升級要走 tools/vendor-jizura.js（自動套修補）＋ tools/audit-jizura-layouts.js（重跑版面稽核）: ');
  ok(engine.includes('const POST_BUILTIN = ') && engine.includes('POST_BUILTIN.includes(ev.type)'), '後製只處理真的會畫的事件，色差／震動不可進透明模式的 alpha 遮罩: ');
  ok(notices.includes('JIZURA') && notices.includes('hakoniwa'), 'THIRD-PARTY-NOTICES 必須列出 JIZURA: ');
  const engineAt = displayHtml.indexOf('/vendor/jizura/jizura-engine.js');
  const tplAt = displayHtml.indexOf('/js/lyric-template-jizura.js');
  ok(engineAt > 0 && tplAt > engineAt, 'display.html 必須先載入引擎、再載入文字PV 模板: ');
});

test('文字PV（JIZURA）：版面白名單不可收進會整面蓋住主播的 layout（鐵則 #11）', () => {
  // 2026-09-24 逐一在透明模式畫一幀量出來、覆蓋率 >50% 的 layout，分橫式／直式兩份：
  // 同一個 layout 在兩種比例的覆蓋率可能差很多（掛け軸橫式 OK、直式整面）。
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-template-jizura.js'), 'utf8');
  // 不用 new RegExp 字串拼接：字串裡的反斜線會被吃掉（run-tests 裡實際踩過），直接切出陣列字面值
  const list = (name) => {
    const at = src.indexOf(`${name} = [`);
    const body = at < 0 ? '' : src.slice(at, src.indexOf('];', at));
    return new Set((body.match(/'(\w+)'/g) || []).map((x) => x.slice(1, -1)));
  };
  const land = list('SAFE_LAYOUTS_LANDSCAPE');
  const quiet = list('QUIET_LAYOUTS');
  const COVER_LANDSCAPE = ['tile', 'subtitleBar', 'splitScreen', 'filmstrip', 'keycaps', 'dotMatrix', 'magazine', 'ransom', 'newspaper', 'cassette', 'polaroid', 'stampSheet', 'postcard', 'letterPaper', 'stationSign', 'noren', 'omikuji', 'shoji', 'warningLabel', 'magnets', 'bulbs', 'crossword', 'wordSearch', 'puzzle', 'wall', 'zipper', 'glitchGrid', 'mosaicTiles', 'contour'];
  ok(land.size > 50, '白名單應該解析得到: ');
  ok(!src.includes('SAFE_LAYOUTS_PANEL') && !src.includes('SAFE_LAYOUTS_PORTRAIT'), '畫布一律全畫面 16:9，不可再有縮小畫布用的另一份白名單: ');
  COVER_LANDSCAPE.forEach((k) => ok(!land.has(k), `橫式白名單不可有會蓋滿畫面的 ${k}: `));
  ok(!land.has('shadowPlay'), '影絵是不透明幕布，要排除: ');
  quiet.forEach((k) => ok(land.has(k), `安靜段落的 ${k} 必須在白名單內: `));
  // 2026-09-24 實機回報「字很多的（文字雲）會嚴重掉幀」與「想要靜一點的風格」
  const heavy = list('HEAVY_LAYOUTS');
  const busy = list('BUSY_LAYOUTS');
  ['wordCloud', 'neon', 'tunnel', 'circleWords', 'wave'].forEach((k) => ok(heavy.has(k), `${k} 實測撐不住 30fps，必須列在 HEAVY_LAYOUTS: `));
  quiet.forEach((k) => ok(!heavy.has(k) && !busy.has(k), `安靜清單不可有太重或太吵的版面 ${k}: `));
  ok(src.includes('!heavy.has(k)'), '任何強度都必須排除 HEAVY_LAYOUTS: ');
  ok(src.includes("mode === 'calm' ? PROFILES_CALM"), '「沉穩」強度要整首換成安靜的 profile，不能只調慢速度: ');
  // 逐字時間對齊：引擎只照字數比例切段，有逐字時間的歌要把段落邊界對到實際開唱的字
  ok(src.includes('function alignCutsToWords') && src.includes('alignCutsToWords(cuts, events, usable)'), '規劃完必須用逐字時間校正段落邊界: ');
  ok(src.includes('function findSeq'), '逐字比對必須在字元陣列上做（字串 indexOf 遇到 emoji 會跟時間表錯位）: ');
  ok(/flash: false/.test(src) && /bgSwitch: 0/.test(src), '不可開全畫面閃白，也不可切換 scheme（淺底 scheme 會變深色字）: ');
  ok(/transparent: true/.test(src) && /noTrans: true/.test(src), '必須用透明模式繪製、關掉整幀合成的轉場: ');
  // 2026-09-24 實機回報：縮成窄欄時裝飾碰到畫布邊緣會切出硬邊界 → 偏左／偏右改成全畫面畫布＋鏡頭位移
  ok(src.includes('function cutOffset') && src.includes('__jzOffset'), '偏左／偏右必須用逐 cut 的鏡頭位移，不可縮小畫布: ');
  // 在播放幀裡量寬度，每換一個 cut 就頓一下 → 量測排在閒置時間
  ok(src.includes('requestIdleCallback') && !src.includes('下一個 cut 的位移先量好'), '版面寬度量測必須排在閒置時間，不可在播放幀裡做: ');
  ok(/const SMOOTH_KOMA = \d+;/.test(src) && src.includes("values: ['smooth', 'koma']"), '動作節奏要有流暢／作畫感兩種，流暢不可回到每幀全畫（實測掉幀）: ');
});

test('歌詞模板名稱：程式、i18n 與 README 必須是同一套', () => {
  // 2026-07-17 把三個模板改名成 Pulse/Facet/Aura 並加了這條守衛，但 7/27 補五語 i18n 時
  // template.* 又把詩意舊名寫了回去；I18n.t() 優先於 label，於是使用者看到的一直是
  // 「星砂流光／折光階梯／潮汐心景」，README 與這條測試卻還停在 Pulse/Facet/Aura——
  // 三套名字各說各話十週沒被發現，因為當時的守衛是「再抄一份寫死清單」。
  // 2026-09-07 使用者決定認回詩意名稱，這條改成從 i18n 推導，不再抄第二份。
  const lyricExtras = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-extras.js'), 'utf8');
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const i18nCatalogs = require('../public/js/i18n').catalogs;

  const ids = /const TEMPLATE_IDS = \[([^\]]*)\]/.exec(lyricExtras)[1]
    .split(',').map((v) => v.trim().replace(/'/g, '')).filter(Boolean);
  // 面板卡片掛 hidden 的是「暫停提供、只為舊設定保留」的模板，不該出現在 README
  // 不用正則跳脫（樣板字串裡的 \s 會被吃掉變成字母 s，實際踩過）：直接取出那顆按鈕的
  // 開頭標籤，看有沒有獨立的 hidden 屬性。
  const cardTag = (id) => {
    const at = indexHtml.indexOf(`data-template="${id}"`);
    return at < 0 ? '' : indexHtml.slice(at, indexHtml.indexOf('>', at));
  };
  const hidden = ids.filter((id) => / hidden[ =]/.test(`${cardTag(id)} `));
  ok(hidden.includes('drift'), '斜拍告白（drift）應仍為隱藏模板：');

  ids.forEach((id) => {
    const zh = i18nCatalogs['zh-TW'][`template.${id}`];
    const en = i18nCatalogs.en[`template.${id}`];
    ok(zh && en, `${id} 必須有 template.${id} 的五語名稱：`);
    // 程式碼內的 label 是 I18n 不可用時的退路，必須跟正式名稱一致
    ok(lyricExtras.includes(`${id}: { label: '${zh}'`), `${id} 的 label 必須是正式名稱 ${zh}：`);
    if (hidden.includes(id)) {
      ok(!readme.includes(en), `${id} 已隱藏，README 不可把它列成可選模板（${en}）：`);
    } else {
      ok(readme.includes(zh), `README 繁中區必須用使用者看得到的名稱 ${zh}：`);
      ok(readme.includes(en), `README 英文區必須用使用者看得到的名稱 ${en}：`);
    }
  });

  // 真正退休、任何地方都不該再出現的舊名（改名前的第一版命名）
  ['Stardust Flow', 'Diagonal Confession', 'Neon Duet'].forEach((retired) => {
    ok(!readme.includes(retired), `README 不可保留已退休的模板名稱 ${retired}：`);
  });
});

test('桌面與手機遙控器同步模板能力，斜拍告白維持隱藏', () => {
  const controllerHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'controller.html'), 'utf8');
  const controllerJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'controller.js'), 'utf8');
  const panelHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const controllerCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'controller-new.css'), 'utf8');
  ['pulse', 'facet', 'aura', 'paperstrip', 'mirror', 'typewriter', 'particle'].forEach((template) => {
    ok(controllerHtml.includes(`class="ctrl-template-btn" data-template="${template}"`), `${template} 必須出現在手機模板選項: `);
  });
  const panelDrift = /<button[^>]*data-template="drift"[^>]*>/.exec(panelHtml)?.[0] || '';
  const controllerDrift = /<button[^>]*data-template="drift"[^>]*>/.exec(controllerHtml)?.[0] || '';
  ok(panelDrift.includes('hidden') && controllerDrift.includes('hidden'), '斜拍告白必須從桌面與手機模板選擇器隱藏: ');
  ok(!controllerHtml.includes('ctrl-template-legacy-notice'), '手機不應保留舊模板的相容性介面: ');
  const ctrlIds = (controllerJs.match(/const TEMPLATE_IDS = \[([^\]]*)\]/) || [])[1] || '';
  ['classic', 'pulse', 'facet', 'drift', 'aura', 'ktv', 'columnflow', 'paperstrip', 'mirror', 'typewriter', 'lightboard', 'particle']
    .forEach((id) => ok(ctrlIds.includes(`'${id}'`), `遙控器的 TEMPLATE_IDS 必須包含 ${id}: `));
  ok(!ctrlIds.includes("'stanza'") && !ctrlIds.includes("'wordscape'"),
    '逐字詩箋／字界巡航已移除，遙控器 TEMPLATE_IDS 不可再有它們: ');
  ok(controllerJs.includes('if (!TEMPLATE_IDS.includes(nextTemplate)) return;'), '模板切換必須接受所有現行模板: ');
  ok(controllerJs.includes("nextTemplate === 'paperstrip' ? PAPERSTRIP_DEFAULTS"), '舊 state 從手機首次切到 paperstrip 時必須套用黑字預設，避免白底白字: ');
  ok(controllerJs.includes("nextTemplate === 'mirror' ? MIRROR_DEFAULTS") && controllerJs.includes("if (nextTemplate === 'mirror') next.lyricPosition = 'split';"), '手機首次切到 mirror 必須套用雙側預設並鎖定 split: ');
  ok(controllerHtml.includes('id="ctrl-intensity-group"') && controllerJs.includes('intensityGroup.hidden = !templateSupportsIntensity(template) || columnflowHidesIntensity;'), '手機動態強度必須與桌面模板能力同步: ');
  ok(controllerHtml.includes('id="ctrl-classic-style-group"') && controllerJs.includes('classicStyleGroup.hidden = !isClassic;'), '配色風格必須只在經典疊層顯示: ');
  ok(controllerCss.includes('#ctrl-intensity-group[hidden]') && controllerCss.includes('#ctrl-classic-style-group[hidden]'), '手機模板設定的 hidden 狀態不得被 CSS 蓋掉: ');
});

test('紙帶逐字模板以獨立時間驅動管線載入，並完整接入設定與伺服器白名單', () => {
  const displayHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'display.html'), 'utf8');
  const panelHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const templateJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-template-paperstrip.js'), 'utf8');
  const templateSettings = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-template-settings.js'), 'utf8');
  const displayCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'display.css'), 'utf8');
  const displayJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'display.js'), 'utf8');
  const motionKernel = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-motion-kernel.js'), 'utf8');
  const lyricExtras = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-extras.js'), 'utf8');
  const lyricsHandler = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'handlers', 'lyrics.js'), 'utf8');
  const appState = fs.readFileSync(path.join(__dirname, '..', 'server', 'state', 'app-state.js'), 'utf8');
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'i18n.js'), 'utf8');
  ok(displayHtml.includes('/js/lyric-template-paperstrip.js'), 'display 必須載入紙帶逐字模板腳本: ');
  ok(templateJs.includes("id: 'paperstrip'") && templateJs.includes('onFrame(timeMs, ctx)') && templateJs.includes('onSeek(timeMs, ctx)'), '紙帶逐字必須透過 registry 並以時間驅動: ');
  ok(templateJs.includes('LyricMotion.ensureWordTimings') && templateJs.includes('LyricMotion.buildGraphemeTimings'), '紙帶逐字必須沿用既有逐字時間資料與 LRC 降級管線: ');
  ok(templateJs.includes('PRE_ROLL_MS') && templateJs.includes("classList.toggle('is-current'"), '紙帶逐字必須有預展開與逐字目前字狀態: ');
  ok(templateJs.includes('function barRevealProgress(value)') && templateJs.includes('t <= 0.24') && templateJs.includes('t <= 0.34') && templateJs.includes('Math.pow(1 - u, 2.45)'), '紙帶展開必須使用前段蓄力、中段快速拉開、後段長尾減速的分段速度曲線，不可退回單一 smoothstep: ');
  ok(templateJs.includes('const PRE_ROLL_MS = 900;') && templateJs.includes('const BAR_OPEN_MS = 700;') && templateJs.includes('const MIN_BAR_OPEN = 0.08;'), '同頁紙帶必須保留 pre-roll 與足夠動畫時長，起始為短白條而不是瞬間從零寬拉滿: ');
  ok(templateJs.includes('const TEXT_REVEAL_MIN_OPEN = 0.985;'), '同頁與 split 仍需保留白條完成度文字閘門: ');
  ok(templateJs.includes("setProperty('--ps-clip-right'") && templateJs.includes('clampedOpen >= TEXT_REVEAL_MIN_OPEN'), '白條必須使用左到右揭露比例，且文字受白條完成度硬閘門保護: ');
  ok(displayCss.includes('clip-path: inset(0 var(--ps-clip-right, 100%) 0 0);') && templateJs.includes("setProperty('--ps-clip-right', `${(100 - clampedOpen * 100).toFixed(3)}%`)") && !displayCss.includes('transform: scaleX(var(--ps-open));'), '紙帶白底必須固定左邊界、從左往右展開，且不可用 scaleX 壓扁邊框與陰影: ');
  ok(templateJs.includes('const MIN_BATCH_SIZE = 1;') && templateJs.includes('const MAX_BATCH_SIZE = 4;') && templateJs.includes('function areLinesTemporallyClose') && templateJs.includes('const interlineGap = Math.max(0, nextPlan.startMs - previousPlan.endMs);') && templateJs.includes('MAX_INTERLINE_GAP_MS') && templateJs.includes('temporalBatchLimit') && templateJs.includes('buildBatches(plans)') && templateJs.includes('scoreBatchCandidate'), '紙帶逐字必須在播放前依內容穩定分組：連續樂句維持 2～4 句，前句尾到後句頭有實際空拍才允許單句頁: ');
  ok(templateJs.includes('metrics.totalChars') && templateJs.includes('metrics.totalDuration') && templateJs.includes('metrics.averageChars') && templateJs.includes('count === previousCount'), '2～4 句分組必須同時考慮總字數、播放時間、平均句長與避免連續相同句數: ');
  ok(templateJs.includes('remaining - count === 1 && areLinesTemporallyClose') && templateJs.includes('count === 1 && temporalBatchLimit(allPlans, start) > 1') && templateJs.includes('LyricMotion.hashNoise(seed, 53)'), '分組必須避免可避免的單句尾頁，但時間距離很遠的下一句可單獨成頁，並使用可重現的穩定亂數: ');
  ok(templateJs.includes("2: [") && templateJs.includes("3: [") && templateJs.includes("4: [") && templateJs.includes('emphasisScore'), '紙帶逐字必須為 2／3／4 句各自提供尺寸構圖，並用句長與節奏決定大字優先句: ');
  ok(templateJs.includes('plan.batchCount = batch.length') && templateJs.includes('plans[target].batchStart'), '可變句數頁面必須把頁面邊界預先寫回每句，seek 時直接定位同一頁: ');
  ok(templateJs.includes('const pageViews = new Map();') && templateJs.includes('function neededBatchStarts(timeMs)') && templateJs.includes('timeMs < (lastPlan?.endMs || 0)'), 'split 模式必須保留既有前後頁短暫共存，上一頁保留到最後一句真正結束: ');
  ok(templateJs.includes('function batchEntryMs(batchStart)') && templateJs.includes('Math.max(batchPreviousEndMs(batchStart), firstPlan.startMs - PRE_ROLL_MS)') && templateJs.includes('function nonSplitBatchStart(timeMs)'), '非 split 跨頁必須等上一頁結束後才允許下一頁進場，空拍時才可利用剩餘 pre-roll: ');
  ok(templateJs.includes('spatialGate: 0.14') && templateJs.includes('function measureGlyphSpatialGates(entry)') && templateJs.includes('clampedOpen >= glyph.spatialGate'), '非 split 跨頁第一句必須用白條實際掃過每個字的位置逐字放行，避免交棒時整句突然跳出: ');
  ok(templateJs.includes('const crossPageLead = !splitMode && plan.batchSlot === 0 && plan.batchStart > 0;') && templateJs.includes('pageEntryMs: view.entryMs') && !displayCss.includes('.ps-group--incoming {'), '非 split 不再建立隱藏 incoming 頁；跨頁第一條白帶從 page entry 時刻真正開始，split 維持既有行為: ');
  ok(templateJs.includes('constrainRowWidth') && displayCss.includes('body.lyric-pos-left #paperstrip-root .ps-group') && displayCss.includes('width: min(100%, 760px);'), '紙帶逐字偏左／偏右必須有單邊寬度上限，超長句在首次顯示前縮放: ');
  ok(!displayCss.includes('@keyframes ps-row-enter'), '紙帶逐字不可在每句重播整列進場動畫造成閃爍: ');
  ok(motionKernel.includes('function stageSafeMarginPercent()') && motionKernel.includes('function mountStageSafeZoneGuide(rootEl)'), '主線舞台安全框核心必須移植到共用 LyricMotion: ');
  const stagePosIds = (lyricExtras.match(/const STAGE_POSITION_TEMPLATES = \[([^\]]*)\]/) || [])[1] || '';
  ok(["'paperstrip'", "'mirror'", "'pulse'"].every((id) => stagePosIds.includes(id)) && panelHtml.includes('id="stage-safe-margin-field"'), 'Paper Strip 必須接入舞台安全距離設定 UI: ');
  ok(templateJs.includes('...LyricTemplateSettings.STAGE_SAFE') && templateSettings.includes("targets: ['data:stageSafeMargin', 'cssvar:--stage-safe-margin']") && templateSettings.includes("body.style.setProperty(name, value)"), 'Paper Strip 的安全距離必須經共用 STAGE_SAFE schema 同步成 dataset + CSS 變數: ');
  ok(templateJs.includes('LyricMotion.mountStageSafeZoneGuide(rootEl)') && templateJs.includes('onSettings()') && displayCss.includes('.stage-safe-zone-band'), 'Paper Strip 必須掛共用安全框並在設定變更時即時同步: ');
  ok(displayCss.includes('width: min(calc(48% - var(--stage-safe-margin, 2) * 1%), 760px);') && displayCss.includes('overflow: visible;') && templateJs.includes('entry.groupEl.clientHeight : entry.groupEl.clientWidth) - indent - 2') && templateJs.includes('Math.max(0.22'), 'Paper Strip 安全框必須作為排版寬度而不是裁切遮罩；超長句要先計入縮排並縮到完整可見: ');
  // 直式紙帶：出場／逐字／分頁邏輯不變，只換軸；紙條顏色可調；排向與色彩預設接上
  ok(templateJs.includes('function isVertical') && templateJs.includes("classList.toggle('ps-vertical'")
    && templateJs.includes('entry.plate.scrollHeight : entry.plate.scrollWidth'),
    '直式紙帶必須沿用同一套機制、只換量測軸（scrollHeight）: ');
  ok(/#paperstrip-root\.ps-vertical[^{]*\{[^}]*writing-mode: vertical-rl/.test(displayCss.replace(/\n/g, ' '))
    && /\.ps-vertical .ps-plate::before\s*\{[^}]*inset\(0 0 var\(--ps-clip-right/.test(displayCss),
    '直式紙帶必須是 vertical-rl，且紙帶改由上往下展開（clip 從底部收）: ');
  ok(displayCss.includes('background: var(--ps-strip-color') && displayJs.includes("paperstripColor: ['--ps-strip-color'")
    && panelHtml.includes('id="ls-paperstrip-color"'),
    '紙條顏色必須可調並接上 --ps-strip-color: ');
  ok(panelHtml.includes('id="paperstrip-orient-buttons"')
    && panelHtml.includes('data-paperstrip-orient="vertical"')
    && lyricExtras.includes("settings.paperstripOrient = orient")
    && lyricExtras.includes('PAPERSTRIP_ORIENT_PRESET')
    && lyricsHandler.includes("['horizontal', 'vertical'].includes(settings.paperstripOrient)"),
    '紙帶排向必須有分段按鈕、切換帶色彩預設、server 白名單: ');
  ok(appState.includes("paperstripOrient: 'horizontal', paperstripColor: '#ffffff'"),
    '紙帶預設橫式仍是原本的白條: ');
  // 動畫強度是直書句流「漂字」進場在用，紙帶不吃
  ok(/paperstrip:[^}]*supportsIntensity: false/.test(lyricExtras)
    && !templateJs.includes('applyIntensityClass') && !templateJs.includes('PS_INTENSITY')
    && !/\.ps-vertical\.ps-int-/.test(displayCss)
    && !/paperstrip:[^}]*animationIntensity/.test(appState),
    '紙帶不再有動畫強度（已移到直書句流的漂字 variant）: ');
  ok(lyricExtras.includes("paperstrip: { label: '紙帶逐字'") && lyricExtras.includes("template: 'paperstrip'"), '桌面設定必須提供紙帶逐字能力與獨立預設: ');
  ok(lyricsHandler.includes("'columnflow', 'paperstrip'"), 'server 模板白名單必須接受 paperstrip: ');
  ok(appState.includes("paperstrip: { template: 'paperstrip'"), 'server 預設 lyricTemplateSettings 必須包含 paperstrip: ');
  ok(i18n.includes("'template.paperstrip':"), '紙帶逐字模板名稱必須有五語 i18n key: ');
});

test('鏡像模板 P0 固定雙側構圖、語言安全轉換與 deterministic glyph 排版', () => {
  const displayHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'display.html'), 'utf8');
  const panelHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const templateJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-template-mirror.js'), 'utf8');
  const displayCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'display.css'), 'utf8');
  const lyricExtras = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-extras.js'), 'utf8');
  const lyricsHandler = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'handlers', 'lyrics.js'), 'utf8');
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const appState = fs.readFileSync(path.join(__dirname, '..', 'server', 'state', 'app-state.js'), 'utf8');
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'i18n.js'), 'utf8');

  ok(displayHtml.includes('/js/lyric-template-mirror.js'), 'display 必須載入 Mirror P0 模板腳本: ');
  ok(templateJs.includes("id: 'mirror'") && templateJs.includes('onFrame(timeMs, ctx)') && templateJs.includes('onSeek(timeMs, ctx)'), 'Mirror 必須透過 registry 並保持完全時間驅動: ');
  ok(templateJs.includes('const MIN_BATCH_SIZE = 1;') && templateJs.includes('const MAX_BATCH_SIZE = 4;') && templateJs.includes('function areLinesTemporallyClose') && templateJs.includes('const interlineGap = Math.max(0, nextPlan.startMs - previousPlan.endMs);') && templateJs.includes('MAX_INTERLINE_GAP_MS') && !templateJs.includes('NEAR_LINE_START_GAP_MS') && templateJs.includes('scoreBatchCandidate') && templateJs.includes('buildBatches(plans)'), 'Mirror P1-E 必須只以「前句尾到後句頭」的空拍決定分組；長句句首相距再遠也不可被拆成單句群組: ');
  ok(templateJs.includes('function mirrorText(text)') && templateJs.includes('code + 0x60') && templateJs.includes("normalize('NFC')"), 'Mirror 右側只能用 Unicode 平假名→片假名安全轉換，不可改寫漢字／中文: ');
  ok(templateJs.includes('const pureChinese = hasHan(plan.text) && !hasKana(plan.text);') && templateJs.includes('if (pureChinese && chars.length > 7) return -1;'), '中文歌曲不可把所有漢字當日文 kanji hero，長中文句要停用漢字加權: ');
  ok(templateJs.includes('LyricMotion.hashNoise') && templateJs.includes('glyphVisual') && templateJs.includes('--mirror-glyph-rotation') && templateJs.includes('--mirror-glyph-y'), 'glyph 級大小、旋轉、上下錯位必須由 deterministic hash 在進場前決定: ');
  ok(templateJs.includes("primaryPanel.className = 'mirror-panel mirror-panel--primary'") && templateJs.includes("echoPanel.className = 'mirror-panel mirror-panel--echo'"), 'Mirror 只能使用固定左右雙側 DOM，不得退回單側位置模式: ');
  ok(displayCss.includes('.mirror-panel--primary') && displayCss.includes('right: calc(50% + var(--stage-safe-margin, 13) * 1%);') && displayCss.includes('.mirror-panel--echo') && displayCss.includes('left: calc(50% + var(--stage-safe-margin, 13) * 1%);'), '左右兩側必須直接以中央安全距離作為排版邊界: ');
  ok(displayCss.includes('.mirror-line--echo .mirror-glyph') && displayCss.includes('-webkit-text-fill-color: transparent !important;') && displayCss.includes('-webkit-text-stroke:') && displayCss.includes('paint-order: stroke;'), '右側鏡像必須是真正透明填色＋純描邊，不可只是降低實心字透明度: ');
  ok(templateJs.includes('function contentBounds(entry)') && templateJs.includes('glyph.getBoundingClientRect()') && templateJs.includes('allowedLeft') && templateJs.includes('allowedRight'), 'Mirror 長度限制必須量測 glyph 旋轉／放大後的真實外框，同時守住畫面邊緣與中央安全區: ');
  ok(templateJs.includes('constrainLine') && templateJs.includes('Math.max(0.20') && templateJs.includes("setProperty('--mirror-compress-x'") && !displayCss.includes('#mirror-root {\r\n  position: fixed;\r\n  inset: 0;\r\n  overflow: hidden;'), 'Mirror 極端長句必須先縮字、最後才水平壓縮，不可用 overflow hidden 裁字: ');
  ok(templateJs.includes("content.className = 'mirror-line-content'") && displayCss.includes('.mirror-line-content') && displayCss.includes('transform: none;') && displayCss.includes('transform-origin: 100% 50%;') && displayCss.includes('transform-origin: 0 50%;'), 'Mirror 不可旋轉 100% 寬 line；只允許自然寬度文字 wrapper／glyph 輕微旋轉，避免安全區與畫面邊界被甩出: ');
  const kongyuanFont = path.join(__dirname, '..', 'public', 'assets', 'fonts', 'kongyuan', 'Kongyuan-Sans-L.otf');
  const kongyuanLicense = path.join(__dirname, '..', 'public', 'assets', 'fonts', 'kongyuan', 'OFL-1.1.txt');
  const kongyuanNotice = path.join(__dirname, '..', 'public', 'assets', 'fonts', 'kongyuan', 'NOTICE.txt');
  ok(fs.existsSync(kongyuanFont) && fs.statSync(kongyuanFont).size > 30000000 && fs.existsSync(kongyuanLicense) && fs.readFileSync(kongyuanLicense, 'utf8').includes('SIL OPEN FONT LICENSE Version 1.1') && fs.existsSync(kongyuanNotice), 'Kongyuan Sans L 以未修改 OTF、OFL-1.1 和歸屬聲明隨 public 資產發行: ');
  ok(displayCss.includes("font-family: 'Kongyuan Sans L'") && displayCss.includes("url('/assets/fonts/kongyuan/Kongyuan-Sans-L.otf')") && displayCss.includes('#mirror-root.mirror-kongyuan-ready') && displayCss.includes('-webkit-text-stroke: 0 transparent !important;') && templateJs.includes('enableKongyuanFont'), 'Kongyuan 正式資產可載入並保留原字型實心鏡像字處理: ');
  ok(!serverIndex.includes('/__mirror-font/kongyuan-sans-l.otf') && !serverIndex.includes('_tmp-kongyuan-inspect'), 'Mirror 不再依賴工作樹外的暫存字型路由: ');
  ok(templateJs.includes('function buildAssemblyRanks') && templateJs.includes('function glyphAssemblyPlan') && templateJs.includes('function applyAssemblyFrame') && templateJs.includes('LINE_ASSEMBLY_STEP_MS') && templateJs.includes('ECHO_ASSEMBLY_DELAY_MS'), 'Mirror P1 的雙側 deterministic 逐字散布計畫已存在: ');
  ok(templateJs.includes('entry.lineStartMs + motion.startOffset') && templateJs.includes('function mountStartedLines') && templateJs.includes('if (timeMs >= plan.startMs) mountLine(plan);') && !templateJs.includes('PAGE_ASSEMBLY_STAGGER_MS'), 'Mirror P1 只在每句開始時掛載，不預先渲染同頁未唱歌詞: ');
  ok(templateJs.includes('updateAssembly(timeMs)') && templateJs.includes('onSeek(timeMs, ctx)') && templateJs.includes('onFrame(timeMs, ctx)') && displayCss.includes('--mirror-assembly-x') && displayCss.includes('--mirror-assembly-opacity'), 'Mirror P1-B 由播放時間驅動組裝，seek 與重載可重算同一狀態: ');
  ok(templateJs.includes('function easeOutBack') && templateJs.includes('rotationProgress') && templateJs.includes('const idleStartMs') && templateJs.includes('motion.idle.periodMs') && displayCss.includes('--mirror-idle-rotation') && displayCss.includes('--mirror-idle-scale'), 'Mirror P1-C 必須讓逐字旋轉入場、落點回彈，並在就位後保持 deterministic 微動: ');
  ok(templateJs.includes('if (japanese && isHanGlyph(char)) scale *= 1.56') && templateJs.includes('scale *= 1.19') && templateJs.includes("entry.line.style.setProperty('--mirror-fit-scale', next.toFixed(3))") && displayCss.includes('font-size: clamp(8px, calc(var(--display-font-size, 60px) * var(--mirror-line-scale) * var(--mirror-fit-scale))') && displayCss.includes('scale(var(--mirror-glyph-scale, 1))'), 'Mirror P1 漢字主副層級必須有明顯比例；安全縮放只能等比縮整行，不能覆寫 glyph emphasis: ');
  const mirrorControllerSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'controller.js'), 'utf8');
  ok(templateJs.includes('const MIRROR_MOTION_PROFILES') && templateJs.includes('function syncMotionIntensity') && templateJs.includes("normal: {") && templateJs.includes('moveOvershoot: 1.32') && templateJs.includes('rotationOvershoot: 1.86') && templateJs.includes('scaleOvershoot: 1.52') && templateJs.includes('pulse: 0.62') && templateJs.includes('pulse: 1.28') && templateJs.includes('pulse: 2.35') && templateJs.includes('amplitude: (side === \'echo\' ? 0.14 : 0.17) * profile.pulse') && lyricExtras.includes("mirror: { label: '虛實鏡書'") && lyricExtras.includes("supportsIntensity: true") && /function templateSupportsIntensity[\s\S]{0,200}'mirror'/.test(mirrorControllerSource) && mirrorControllerSource.includes("animationIntensity: 'normal'"), 'Mirror P1-F 必須接上既有沉穩／標準／狂放控制；唱詞逐字彈跳在不動其他動態層的前提下分級加強: ');
  ok(templateJs.includes('LyricMotion.ensureWordTimings(line, lines, index)') && templateJs.includes('LyricMotion.buildGraphemeTimings(word)') && templateJs.includes('glyphTimings: timingMatchesText ? sourceGlyphs : fallbackGlyphs') && templateJs.includes("timingSource: hasNativeWordTimings && timingMatchesText ? 'source' : 'fallback'") && templateJs.includes('function glyphSingingPulsePlan') && templateJs.includes('const singingStartMs') && !templateJs.includes('lineLandedOffset') && displayCss.includes('--mirror-sung-scale'), 'Mirror P1-D 必須優先讀取來源逐字時間，讓每個非標點 glyph 在自己的時間點放大後回到原尺寸；普通 LRC 才可等分降級: ');
  const mirrorRenderBatch = templateJs.slice(templateJs.indexOf('function renderBatch'), templateJs.indexOf('function syncLayout'));
  const mirrorConstrainIdx = mirrorRenderBatch.indexOf('renderedEntries.forEach(constrainLine);');
  const mirrorUpdateAssemblyIdx = mirrorRenderBatch.indexOf('updateAssembly(timeMs);');
  ok(mirrorConstrainIdx >= 0 && mirrorUpdateAssemblyIdx >= 0 && mirrorConstrainIdx < mirrorUpdateAssemblyIdx, 'Mirror P1 先以最散布狀態限縮，倒退 seek 不會把 glyph 推出安全側: ');
  ok(lyricExtras.includes("mirror: { label: '虛實鏡書'") && lyricExtras.includes("template: 'mirror'") && lyricExtras.includes("lyricPosition: 'split'") && lyricExtras.includes('stageSafeMargin: 13'), '桌面設定必須提供 Mirror P0 獨立預設並鎖定 split: ');
  ok(panelHtml.includes('data-template="mirror"') && panelHtml.includes('style-thumb-mirror'), '桌面模板選擇器必須有 Mirror P0 卡片: ');
  ok(!/data-template="mirror"[^>]*\bhidden\b/.test(panelHtml), 'Mirror 模板已正式公開，桌面模板卡片不可再帶 hidden: ');
  ok(lyricsHandler.includes("'paperstrip', 'mirror'"), 'server 模板白名單必須接受 mirror: ');
  ok(appState.includes("mirror: { template: 'mirror'"), 'server 預設 lyricTemplateSettings 必須包含 mirror: ');
  ok(i18n.includes("'template.mirror':"), 'Mirror 模板名稱必須有五語 i18n key: ');
  ok(displayCss.includes('#mirror-root {') && displayCss.slice(displayCss.indexOf('#mirror-root {'), displayCss.indexOf('}', displayCss.indexOf('#mirror-root {'))).includes('transform: translateY(var(--lyric-offset-y, 0px));'), '鏡像必須直接在 #mirror-root 消費全域 --lyric-offset-y 位移，不能透過 #lyrics-container（position:fixed 的 containing block 限制）: ');
  ok(displayCss.includes('#paperstrip-root {') && displayCss.slice(displayCss.indexOf('#paperstrip-root {'), displayCss.indexOf('}', displayCss.indexOf('#paperstrip-root {'))).includes('transform: translateY(var(--lyric-offset-y, 0px));'), '紙帶逐字必須在 #paperstrip-root 消費全域 --lyric-offset-y 位移: ');
  ok(lyricExtras.includes('const isPaperstrip = ') && lyricExtras.includes('const isYOnlyOffset = isKtv || isPaperstrip || isMirror') && lyricExtras.includes("(settings.lyricPosition !== 'split' || isMirror || isPaperstrip)"), '紙帶逐字／鏡像的位置微調必須只開放 Y，且鏡像固定 split 時仍要能調整 Y: ');
});
