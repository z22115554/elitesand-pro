'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createJsonStore } = require('../server/services/json-store');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-audit-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'store.json');
  return { root, file, make: () => createJsonStore({ file, defaultValue: () => ({ tracks: [] }) }) };
}

test('ESP-001: a full disk never quarantines a readable primary', t => {
  const f = fixture(t); f.make().save({ tracks: ['a', 'b', 'c'] });
  fs.unlinkSync(`${f.file}.last-good`);
  const before = fs.readFileSync(f.file, 'utf8');
  const write = fs.writeFileSync;
  try {
    fs.writeFileSync = () => { throw Object.assign(new Error('full'), { code: 'ENOSPC' }); };
    assert.deepEqual(f.make().load().tracks, ['a', 'b', 'c']);
  } finally { fs.writeFileSync = write; }
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(f.root), ['store.json']);
});

test('ESP-001: a valid backup remains readable when restoring the primary fails', t => {
  const f = fixture(t); f.make().save({ tracks: ['saved'] }); fs.unlinkSync(f.file);
  const store = f.make(), write = fs.writeFileSync;
  try {
    fs.writeFileSync = () => { throw Object.assign(new Error('full'), { code: 'ENOSPC' }); };
    assert.deepEqual(store.load().tracks, ['saved']);
    assert.equal(store.getStatus().writeBlocked, true);
  } finally { fs.writeFileSync = write; }
  assert.deepEqual(fs.readdirSync(f.root), ['store.json.last-good']);
  assert.equal(store.save({ tracks: [] }), false);
});

test('ESP-011: restart preserves the previous generation backup', t => {
  const f = fixture(t); const store = f.make();
  assert.equal(store.save({ tracks: ['first'] }), true);
  assert.equal(store.save({ tracks: ['second'] }), true);
  assert.deepEqual(f.make().load().tracks, ['second']);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${f.file}.last-good`)).tracks, ['first']);
});

test('ESP-001: corrupt PIN data fails closed instead of removing PIN protection', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'auth.json'), '{broken');
  const result = execFileSync(process.execPath, ['-e', `
    const auth = require('./server/services/auth-store');
    console.log('RESULT:'+JSON.stringify({hasPin:auth.hasPin(),valid:auth.verifyPin('1234'),reset:auth.setPin('5678').ok}));
  `], { cwd: path.join(__dirname, '..'), env: { ...process.env, ELITESAND_DATA_DIR: f.root, ELITESAND_LOGS_DIR: path.join(f.root, 'logs') }, encoding: 'utf8' });
  const value = JSON.parse(result.split('RESULT:')[1].split('\n')[0]);
  assert.deepEqual(value, { hasPin: true, valid: false, reset: false });
});

test('ESP-004: cleanup preserves local media, covers, BGM, saved lists and active imports', t => {
  const f = fixture(t);
  const script = `
    const fs=require('fs'), path=require('path');
    const lib=require('./server/services/library-store'), bgm=require('./server/services/bgm-playlist');
    const saved=require('./server/services/saved-playlists'), registry=require('./server/services/import-temp-registry');
    const dir=process.env.ELITESAND_DOWNLOADS_DIR; fs.mkdirSync(dir,{recursive:true});
    const rows=[['local',null],['bgm','bgmvideo001'],['saved','savedvid001'],['delete','deletevid01'],['active','activevid01']];
    for(const [id,video] of rows) {lib.rememberImport({id,title:id,filename:(id==='active'?'activevid01':id)+'.mp3',url:video?'https://youtu.be/'+video:null});}
    bgm.addTracks(['bgm']); const list=saved.create({name:'keep',trackIds:['saved']});
    registry.begin('activevid01');
    for(const name of ['local.mp3','bgm.mp3','saved.mp3','delete.mp3','activevid01.mp3','cover.png','.elitesand-pro-media-root','untracked.mp3']) fs.writeFileSync(path.join(dir,name),'x');
    const preview=lib.cleanupAudio(new Set(),{dryRun:true});
    const before=fs.readdirSync(dir); const result=lib.cleanupAudio();
    console.log('RESULT:'+JSON.stringify({preview,before,result,after:fs.readdirSync(dir)}));
  `;
  const output = execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), encoding: 'utf8',
    env: { ...process.env, ELITESAND_DATA_DIR: f.root, ELITESAND_DOWNLOADS_DIR: path.join(f.root, 'media'), ELITESAND_LOGS_DIR: path.join(f.root, 'logs') } });
  const value = JSON.parse(output.split('RESULT:')[1].split('\n')[0]);
  assert.equal(value.preview.deleted, 1);
  assert.equal(value.before.length, 8);
  assert.equal(value.result.deleted, 1);
  assert.equal(value.after.includes('delete.mp3'), false);
  for (const name of ['local.mp3', 'bgm.mp3', 'saved.mp3', 'activevid01.mp3', 'cover.png', '.elitesand-pro-media-root', 'untracked.mp3']) assert.ok(value.after.includes(name), name);
});

test('ESP-001: corrupt PIN data stays locked for remote devices but the desktop can set a new PIN', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'auth.json'), '{broken');
  const result = execFileSync(process.execPath, ['-e', `
    const auth = require('./server/services/auth-store');
    const before = { remote: auth.hasPinFor({ loopback: false }), local: auth.hasPinFor({ loopback: true }), recovery: auth.needsRecovery(),
      remoteSet: auth.setPin('5678').ok };
    const localSet = auth.setPin('5678', '', { localRecovery: true }).ok;
    console.log('RESULT:'+JSON.stringify({ ...before, localSet, after: { recovery: auth.needsRecovery(), remote: auth.hasPinFor({ loopback: false }),
      local: auth.hasPinFor({ loopback: true }), ok: auth.verifyPin('5678'), wrong: auth.verifyPin('0000') } }));
  `], { cwd: path.join(__dirname, '..'), env: { ...process.env, ELITESAND_DATA_DIR: f.root, ELITESAND_LOGS_DIR: path.join(f.root, 'logs') }, encoding: 'utf8' });
  const value = JSON.parse(result.split('RESULT:')[1].split('\n')[0]);
  assert.deepEqual(value, { remote: true, local: false, recovery: true, remoteSet: false, localSet: true,
    after: { recovery: false, remote: true, local: true, ok: true, wrong: false } });
});

test('ESP-011: saving rotates the previous file into the backup without re-reading it', t => {
  const f = fixture(t); const store = f.make();
  store.save({ tracks: ['first'] });
  const read = fs.readFileSync; let reads = 0;
  try {
    fs.readFileSync = function (...args) { if (String(args[0]) === f.file) reads++; return read.apply(this, args); };
    assert.equal(store.save({ tracks: ['second'] }), true);
  } finally { fs.readFileSync = read; }
  assert.equal(reads, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${f.file}.last-good`)).tracks, ['first']);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file)).tracks, ['second']);
});

for (const kind of ['json', 'state']) {
  for (const fault of ['write', 'fsync', 'commit']) {
    test(`shared storage: ${kind} survives ${fault} failure and a fresh reload`, t => {
      const f = fixture(t);
      const script = `
        const fs = require('fs'), path = require('path');
        const kind = ${JSON.stringify(kind)}, fault = ${JSON.stringify(fault)};
        const root = process.env.ELITESAND_DATA_DIR;
        const file = path.join(root, kind === 'state' ? 'state.json' : 'store.json');
        let store, saved;
        if (kind === 'state') {
          store = require('./server/services/state-store');
          saved = n => { let result; store.scheduleSave(() => ({ savedAt:n, playlist:[{id:String(n)}] }), r => result=r); store.saveNow(); return result.ok; };
        } else {
          store = require('./server/services/json-store').createJsonStore({file});
          saved = n => store.save({entries:[String(n)]});
        }
        if (!saved(1) || !saved(2)) throw Error('fixture save failed');
        const before = fs.readFileSync(file, 'utf8'), backup = fs.readFileSync(file+'.last-good','utf8');
        const originals = {writeFileSync:fs.writeFileSync,fsyncSync:fs.fsyncSync,renameSync:fs.renameSync};
        const full = () => {throw Object.assign(Error('injected full disk'),{code:'ENOSPC'});};
        if (fault === 'write') fs.writeFileSync = full;
        else if (fault === 'fsync') fs.fsyncSync = full;
        else fs.renameSync = function(from,to) {
          if (String(from).includes('.tmp-') && to === file) throw Object.assign(Error('locked destination'),{code:'EACCES'});
          return originals.renameSync.apply(this,arguments);
        };
        let ok;
        try {ok=saved(3);} finally {Object.assign(fs,originals);}
        const primaryUnchanged = fs.existsSync(file) && fs.readFileSync(file,'utf8')===before;
        const backupUnchanged = fs.readFileSync(file+'.last-good','utf8')===backup;
        if (kind === 'state') { delete require.cache[require.resolve('./server/services/state-store')]; store=require('./server/services/state-store'); }
        else store=require('./server/services/json-store').createJsonStore({file});
        const recovered = kind === 'state' ? store.loadState() : store.load();
        const value = kind === 'state' ? recovered.playlist[0].id : recovered.entries[0];
        console.log('RESULT:'+JSON.stringify({ok,primaryUnchanged,backupUnchanged,value,temps:fs.readdirSync(root).filter(n=>n.includes('.tmp-'))}));
        process.exit(0);
      `;
      const output = execFileSync(process.execPath, ['-e', script], {
        cwd: path.join(__dirname, '..'), encoding: 'utf8',
        env: { ...process.env, ELITESAND_DATA_DIR: f.root, ELITESAND_LOGS_DIR: path.join(f.root, 'logs') },
      });
      const result = JSON.parse(output.split('RESULT:')[1].split('\n')[0]);
      assert.equal(result.ok, false);
      assert.equal(result.value, '2', 'restart must recover the last successful save');
      assert.deepEqual(result.temps, []);
      if (fault !== 'commit') {
        assert.equal(result.primaryUnchanged, true);
        assert.equal(result.backupUnchanged, true);
      }
    });
  }
}
