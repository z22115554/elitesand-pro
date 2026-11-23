'use strict';
// Measures the real store modules (library-store / app-state / state-store /
// playlist handler) against a synthetic 10,000-track library and a 2,000-item
// playlist. Run: node bench-library.js <auditWorkRoot> <dataDir> <downloadsDir> <logsDir>
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const [root, dataDir, downloadsDir, logsDir] = process.argv.slice(2);
process.env.ELITESAND_DATA_DIR = dataDir;
process.env.ELITESAND_DOWNLOADS_DIR = downloadsDir;
process.env.ELITESAND_LOGS_DIR = logsDir;

const out = {};
const ms = (t) => Math.round((performance.now() - t) * 100) / 100;
const heapMB = () => { if (global.gc) global.gc(); return Math.round(process.memoryUsage().heapUsed / 1048576); };
function timeN(n, fn) {
  const samples = [];
  for (let i = 0; i < n; i++) { const t = performance.now(); fn(i); samples.push(performance.now() - t); }
  samples.sort((a, b) => a - b);
  return { n, medianMs: +samples[Math.floor(n / 2)].toFixed(2), minMs: +samples[0].toFixed(2), maxMs: +samples[n - 1].toFixed(2) };
}

// write a v3 state.json referencing the first 2000 library ids (compact form)
const playlist = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.playlist.seed.json'), 'utf8'));
fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ schemaVersion: 3, savedAt: Date.now(), playlist, oneTimeFixes: {} }));
out.stateJsonSeedBytes = fs.statSync(path.join(dataDir, 'state.json')).size;

out.heapBeforeMB = heapMB();
let t = performance.now();
const libraryStore = require(path.join(root, 'server/services/library-store'));
out.libraryLoadMs = ms(t);
out.heapAfterLibraryLoadMB = heapMB();
out.entries = libraryStore.getLibrary().length;

t = performance.now();
const firstSummary = libraryStore.getLibrarySummary();
out.librarySummaryFirstMs = ms(t); // includes 10k existsSync for hasLyrics
out.librarySummary = timeN(15, () => libraryStore.getLibrarySummary());
out.librarySummaryBytes = Buffer.byteLength(JSON.stringify(firstSummary));
out.librarySummaryStringify = timeN(10, () => JSON.stringify(libraryStore.getLibrarySummary()));
out.getLibrarySort = timeN(15, () => libraryStore.getLibrary());

// duplicate detection (miss = worst case full scan)
t = performance.now(); libraryStore.findByIdentity('不存在的歌手', '不存在的歌名 zzz', null); out.findByIdentityColdMs = ms(t);
out.findByIdentityWarm = timeN(20, (i) => libraryStore.findByIdentity('不存在的歌手', '不存在的歌名 ' + i, null));

// single-track metadata update -> whole-file rewrite
const anyId = firstSummary[1234].id;
out.updateMetaCall = timeN(20, (i) => libraryStore.updateMeta(anyId, { pitchShift: (i % 5) - 2 }));
out.saveNowAfterMetaUpdate = timeN(8, (i) => { libraryStore.updateMeta(anyId, { pitchShift: (i % 5) - 2 }); if (libraryStore.saveNow() !== true) throw new Error('save failed'); });
out.libraryJsonBytes = fs.statSync(path.join(dataDir, 'library.json')).size;

// recordPlay (hydrates one lyrics file) + save
const entry = libraryStore.getEntry(anyId);
out.recordPlayPlusSave = timeN(5, () => { libraryStore.recordPlay({ ...entry }); libraryStore.saveNow(); });

// rememberImport of a brand new track + save
out.rememberImportPlusSave = timeN(5, (i) => {
  libraryStore.rememberImport({ id: 'NEWVIDEO0' + i + 'x', title: '新歌 ' + i, artist: '新歌手', filename: `new${i}.mp3`, url: 'https://www.youtube.com/watch?v=NEWVIDEO0' + i + 'x', lyrics: entry.lyrics, lyricsType: 'krc', parsedLyrics: entry.parsedLyrics, source: 'youtube', duration: 200 });
  libraryStore.saveNow();
});

// app-state restore with 2000-item playlist (hydrates 2000 lyric files)
const fakeIo = { emits: [], to() { return { emit: (ev, payload) => { fakeIo.emits.push([ev, payload]); } }; }, emit(ev, payload) { fakeIo.emits.push([ev, payload]); } };
t = performance.now();
const { createAppState } = require(path.join(root, 'server/state/app-state'));
const ctx = createAppState(fakeIo);
out.appStateRestore2000Ms = ms(t);
out.playlistLen = ctx.playState.playlist.length;
out.heapAfterStateRestoreMB = heapMB();

// broadcastState (state:sync) cost and size
const s = timeN(15, () => ctx.broadcastState());
out.broadcastState = s;
const last = fakeIo.emits.filter((e) => e[0] === 'state:sync');
out.stateSyncControlBytes = Buffer.byteLength(JSON.stringify(last[last.length - 2][1]));
out.stateSyncReadOnlyBytes = Buffer.byteLength(JSON.stringify(last[last.length - 1][1]));
out.publicPlaylist = timeN(15, () => ctx.getPublicPlaylist());
out.publicPlaylistBytes = Buffer.byteLength(JSON.stringify(ctx.getPublicPlaylist()));

// persistState -> state.json write
const stateStore = require(path.join(root, 'server/services/state-store'));
out.statePersist = timeN(8, () => { ctx.persistState(); const r = stateStore.saveNow(); });
out.stateJsonBytes = fs.statSync(path.join(dataDir, 'state.json')).size;

// playlist:update handler round trip (client sends back the 2000-row summary, e.g. one drag-reorder)
const registerPlaylistHandlers = require(path.join(root, 'server/routes/handlers/playlist'));
const handlers = {};
const fakeSocket = { id: 's1', clientType: 'controller', on(ev, fn) { handlers[ev] = fn; }, emit() {} };
registerPlaylistHandlers(fakeIo, fakeSocket, ctx, {});
const summary = JSON.parse(JSON.stringify(ctx.getPublicPlaylist()));
out.playlistUpdateHandler = timeN(10, (i) => {
  const moved = summary.slice(); const [x] = moved.splice(i, 1); moved.splice(1000, 0, x);
  fakeIo.emits.length = 0;
  let ack; handlers['playlist:update'](moved, (r) => { ack = r; });
  if (!ack || !ack.ok) throw new Error('playlist:update failed');
});
out.playlistUpdateEmits = fakeIo.emits.map((e) => [e[0], Buffer.byteLength(JSON.stringify(e[1] === undefined ? null : e[1]))]);
// ack payload (server echoes the full merged playlist incl. lyrics to the caller)
{
  let ack; handlers['playlist:update'](summary, (r) => { ack = r; });
  out.playlistUpdateAckBytes = Buffer.byteLength(JSON.stringify(ack));
}
// playlist:add of one track when playlist is nearly full
ctx.playState.playlist.pop();
out.playlistAddOne = timeN(1, () => { let ack; handlers['playlist:add']([{ id: 'NEWVIDEO00x', title: '新歌', filename: 'new0.mp3' }], (r) => { ack = r; }); });

// read-path hydration is never released: getEntry on all 10k
const h0 = heapMB();
t = performance.now();
for (const row of firstSummary) libraryStore.getEntry(row.id);
out.getEntryAll10kMs = ms(t);
libraryStore.saveNow();
out.heapAfterGetEntryAllMB = heapMB();
out.heapBeforeGetEntryAllMB = h0;

// remove one + save
out.removePlusSave = timeN(3, (i) => { libraryStore.remove(firstSummary[5000 + i].id); libraryStore.saveNow(); });

console.log(JSON.stringify(out, null, 1));
process.exit(0);
