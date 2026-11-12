'use strict';

// 歌曲筆記（主播私用）：存讀、清理、只推給主播端
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

function runIsolated(script) {
  const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-song-notes-'));
  try {
    const result = spawnSync(process.execPath, ['-e', script, root], {
      encoding: 'utf8', timeout: 20000,
      env: { ...process.env, ELITESAND_DATA_DIR: tempData, ELITESAND_DOWNLOADS_DIR: path.join(tempData, 'dl'), ELITESAND_LOGS_DIR: path.join(tempData, 'logs') },
    });
    assert.equal(result.status, 0, result.stderr);
    return { out: JSON.parse(result.stdout.split('__RESULT__')[1]), file: path.join(tempData, 'song-notes.json'), tempData };
  } catch (error) {
    fs.rmSync(tempData, { recursive: true });
    throw error;
  }
}

test('歌曲筆記：整首與逐句分開更新、清掉控制字元與超長內容、兩者都清空就刪掉紀錄、會落盤', () => {
  const { out, file, tempData } = runIsolated(`
    const path = require('path');
    const notes = require(path.join(process.argv[1], 'server/services/song-notes'));
    const a = notes.set('aaaaaaaaaaa', { songNote: ' 降 2 Key\\r\\n唱完謝謝小明\\u0007 ' });
    const b = notes.set('aaaaaaaaaaa', { lines: [
      { time: 12000.4, text: '第二句', note: '換氣' },
      { time: 3000, text: '第一句', note: 'x'.repeat(500) },
      { time: 5000, text: '空的', note: '   ' },
      { time: 'abc', text: '壞的', note: '壞' },
      { time: 12000, text: '第二句', note: '重複的不收' },
    ] });
    const keepSong = notes.get('aaaaaaaaaaa').songNote;
    const invalid = notes.set('', { songNote: 'x' });
    notes.set('bbbbbbbbbbb', { songNote: '暫時的' });
    notes.set('bbbbbbbbbbb', { songNote: '' });
    notes.saveNow();
    process.stdout.write('__RESULT__' + JSON.stringify({ a, b, keepSong, invalid, empty: notes.get('bbbbbbbbbbb'), missing: notes.get('zzz') }));
  `);
  try {
    assert.equal(out.a.songNote, '降 2 Key\n唱完謝謝小明', '保留換行、去掉控制字元');
    assert.deepEqual(out.b.lines.map((l) => [l.time, l.text, l.note.length]), [[3000, '第一句', 200], [12000, '第二句', 2]], '依時間排序、截長、丟掉空的／壞的／重複的');
    assert.equal(out.keepSong, '降 2 Key\n唱完謝謝小明', '只改逐句不會動到整首');
    assert.equal(out.invalid, null);
    assert.deepEqual(out.empty, { songNote: '', lines: [], updatedAt: 0 });
    assert.deepEqual(out.missing.lines, []);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const doc = saved.data || saved;
    const stored = (doc.notes || doc).aaaaaaaaaaa || JSON.stringify(saved).includes('aaaaaaaaaaa');
    assert.ok(stored, '要落盤');
    assert.ok(!JSON.stringify(saved).includes('bbbbbbbbbbb'), '清空的那首不留紀錄');
  } finally {
    fs.rmSync(tempData, { recursive: true });
  }
});

test('歌曲筆記：更新只推給主播端房間，絕不 io.emit 到 OBS', () => {
  const { out, tempData } = runIsolated(`
    const path = require('path');
    const register = require(path.join(process.argv[1], 'server/routes/handlers/song-notes'));
    const rooms = []; const globalEmits = []; const events = new Map();
    const io = { to(room) { return { emit(event) { rooms.push([room, event]); } }; }, emit(event) { globalEmits.push(event); } };
    register(io, { on(event, handler) { events.set(event, handler); } });
    let setAck = null; let getAck = null; let badAck = null;
    events.get('song-notes:set')({ trackId: 'aaaaaaaaaaa', songNote: '換氣' }, (r) => { setAck = r; });
    events.get('song-notes:get')({ trackId: 'aaaaaaaaaaa' }, (r) => { getAck = r; });
    events.get('song-notes:set')({ trackId: 'aaaaaaaaaaa' }, (r) => { badAck = r; });
    process.stdout.write('__RESULT__' + JSON.stringify({ rooms, globalEmits, setAck, getAck, badAck }));
  `);
  fs.rmSync(tempData, { recursive: true });
  const { CONTROL_ROOM } = require('../server/utils/socket-broadcast');
  assert.deepEqual(out.rooms, [[CONTROL_ROOM, 'song-notes:updated']]);
  assert.deepEqual(out.globalEmits, []);
  assert.equal(out.setAck.ok, true);
  assert.equal(out.getAck.notes.songNote, '換氣');
  assert.deepEqual(out.badAck, { ok: false, error: 'invalid' });
});

test('歌曲筆記：唯讀端不能讀寫、只在非唯讀 socket 註冊、不放進 track／播放清單、跟唱視圖已接上', () => {
  // CI 的 Windows checkout 是 CRLF，下面比對含換行的字串前先統一成 LF
  const handler = fs.readFileSync(path.join(root, 'server/routes/socket-handler.js'), 'utf8').replace(/\r\n/g, '\n');
  const start = handler.indexOf('const READ_ONLY_EVENTS');
  const readOnly = handler.slice(start, handler.indexOf(']);', start));
  assert.ok(!readOnly.includes('song-notes'), 'OBS／唯讀端不可讀寫筆記');
  const guarded = handler.slice(handler.indexOf('if (!socket.readOnly) {\n      registerPlaybackHandlers'));
  assert.ok(guarded.indexOf('registerSongNotesHandlers(io, socket)') > 0, '要在非唯讀區塊裡註冊');
  const schema = fs.readFileSync(path.join(root, 'server/utils/track-schema.js'), 'utf8');
  assert.ok(!/songNote|lineNotes/.test(schema), '筆記不可放進 track（會跟著播放清單廣播到唯讀端）');
  const prompter = fs.readFileSync(path.join(root, 'public/js/prompter.js'), 'utf8');
  assert.ok(prompter.includes("'song-notes:get'") && prompter.includes("SocketClient.on('song-notes:updated'"));
  for (const page of ['display', 'setlist']) {
    const html = fs.readFileSync(path.join(root, `public/${page}.html`), 'utf8');
    assert.ok(!html.includes('song-notes'), `${page} 不可碰筆記`);
  }
  const html = fs.readFileSync(path.join(root, 'public/prompter.html'), 'utf8');
  assert.ok(html.includes('data-new-feature="song-notes"'));
  assert.match(fs.readFileSync(path.join(root, 'public/js/new-badges.js'), 'utf8'), /'song-notes': '\d{4}-\d{2}-\d{2}'/);
});
