'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter, once } = require('node:events');
const { PassThrough } = require('node:stream');
const { promisify } = require('node:util');
const { createOwnedProcessManager } = require('../server/utils/owned-process');
const fixture = path.join(__dirname, 'fixtures/import-process-tree-child.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-owned-tree-'));
  t.after(() => require('../server/utils/safe-remove').safeRemove(dir));
  return dir;
}

async function ready(child) {
  let buffer = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Owned fixture did not become ready')), 3000);
    child.stdout.on('data', data => {
      buffer += data;
      if (!buffer.includes('\n')) return;
      clearTimeout(timer); resolve(JSON.parse(buffer.split('\n')[0]));
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

async function stopped(prefix) {
  await sleep(60);
  const before = fs.statSync(prefix + '.ticks').size;
  await sleep(90);
  assert.equal(fs.statSync(prefix + '.ticks').size, before, 'the descendant must stop writing');
}

test('S-01: cancelling an owned process also stops its writing descendant', async t => {
  const dir = workspace(t), manager = createOwnedProcessManager(), controller = new AbortController();
  t.after(() => manager.stopAll());
  const prefix = path.join(dir, 'cancel');
  const child = manager.spawn(process.execPath, [fixture, 'parent', prefix], {
    stdio: ['ignore','pipe','pipe'], signal: controller.signal,
  });
  await ready(child);
  const closed = once(child, 'close'); controller.abort(); await closed;
  await stopped(prefix); assert.equal(manager.activeCount(), 0);
});

test('terminating one owned group cannot terminate another simultaneous import', async t => {
  const dir = workspace(t), manager = createOwnedProcessManager();
  t.after(() => manager.stopAll());
  const a = path.join(dir, 'a'), b = path.join(dir, 'b');
  const first = manager.spawn(process.execPath, [fixture,'parent',a], {stdio:['ignore','pipe','pipe']});
  const second = manager.spawn(process.execPath, [fixture,'parent',b], {stdio:['ignore','pipe','pipe']});
  await Promise.all([ready(first),ready(second)]);
  const closed = once(first,'close'); await manager.terminate(first); await closed; await stopped(a);
  const before = fs.statSync(b+'.ticks').size; await sleep(60);
  assert.ok(fs.statSync(b+'.ticks').size > before, 'the other import remains alive');
  const secondClosed=once(second,'close'); const result=await manager.stopAll(); await secondClosed;
  assert.equal(result.length,1); await stopped(b); assert.equal(manager.activeCount(),0);
});

test('metadata timeout terminates the whole group and retains partial stdout', async t => {
  const dir=workspace(t),manager=createOwnedProcessManager(),prefix=path.join(dir,'timeout');
  t.after(()=>manager.stopAll());
  await assert.rejects(promisify(manager.execFile)(process.execPath,[fixture,'parent',prefix],{
    timeout:2000,maxBuffer:4096,encoding:'utf8',
  }),error=>{
    assert.equal(error.code,'ETIMEDOUT'); assert.equal(error.killed,true);
    assert.ok(JSON.parse(error.stdout.trim()).leaf>0); return true;
  });
  await stopped(prefix); assert.equal(manager.activeCount(),0);
});

test('metadata abort waits for tree termination rather than returning a live descendant', async t => {
  const dir=workspace(t),manager=createOwnedProcessManager(),prefix=path.join(dir,'metadata'),controller=new AbortController();
  t.after(()=>manager.stopAll());
  const pending=promisify(manager.execFile)(process.execPath,[fixture,'parent',prefix],{
    timeout:3000,maxBuffer:4096,encoding:'utf8',signal:controller.signal,
  });
  const rejected=assert.rejects(pending,{code:'ABORT_ERR'});
  await ready(pending.child);controller.abort();await rejected;await stopped(prefix);
});

test('buffered metadata keeps UTF-8 stdout/stderr and nonzero errors', async () => {
  const manager=createOwnedProcessManager(),run=promisify(manager.execFile);
  const value=await run(process.execPath,['-e',"process.stdout.write('歌詞');process.stderr.write('訊息');"],{encoding:'utf8'});
  assert.deepEqual(value,{stdout:'歌詞',stderr:'訊息'});
  await assert.rejects(run(process.execPath,['-e',"process.stdout.write('partial');process.stderr.write('failed');process.exit(7)"],{}),
    error=>error.code===7&&error.stdout==='partial'&&error.stderr==='failed');
  assert.equal(manager.activeCount(),0);
});

test('maxBuffer, missing binary and pre-aborted metadata fail without leaking a child', async () => {
  const manager=createOwnedProcessManager(),run=promisify(manager.execFile);
  await assert.rejects(run(process.execPath,['-e',"process.stdout.write('x'.repeat(1024));setInterval(()=>{},1000)"],{maxBuffer:64}),{code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'});
  await assert.rejects(run(path.join(os.tmpdir(),'elitesand-no-such-executable-20261115'),[],{}),{code:'ENOENT'});
  const c=new AbortController();c.abort();
  await assert.rejects(run(process.execPath,['-e','process.exit(99)'],{signal:c.signal}),{code:'ABORT_ERR'});
  assert.equal(manager.activeCount(),0);
});

function windowsManager({ failure, neverReply=false }={}) {
  const calls=[];
  let directKills=0;
  const child=Object.assign(new EventEmitter(),{pid:24680,exitCode:null,signalCode:null,stdout:new PassThrough(),stderr:new PassThrough(),
    kill(){directKills++;return true;}});
  const manager=createOwnedProcessManager({platform:'win32',environment:{SystemRoot:'C:\\Windows'},terminationTimeoutMs:20,
    spawnImpl(_file,_args,options){calls.push({spawnOptions:options});return child;},
    execFileImpl(file,args,options,callback){calls.push({file,args,options});if(!neverReply)setTimeout(()=>callback(failure),5);},
  });
  return {manager,child,calls,directKills:()=>directKills};
}

test('Windows uses bounded taskkill /PID /T /F before touching the parent handle', async () => {
  const f=windowsManager();f.manager.spawn('owned.exe',[]);
  const a=f.manager.terminate(f.child),b=f.manager.terminate(f.child);
  assert.equal(a,b);assert.equal(f.directKills(),0);
  assert.equal((await a).ok,true);assert.equal(f.calls.length,2);
  assert.equal(f.calls[0].spawnOptions.detached,false);
  assert.equal(f.calls[1].file,'C:\\Windows\\System32\\taskkill.exe');
  assert.deepEqual(f.calls[1].args,['/PID','24680','/T','/F']);
  assert.equal(f.calls[1].options.timeout,20);assert.equal(f.calls[1].options.shell,undefined);
  assert.equal(f.directKills(),0);
});

test('unknown handles and invalid PIDs never issue an OS tree kill', async () => {
  const f=windowsManager();
  assert.equal((await f.manager.terminate({pid:1})).ok,false);
  f.child.pid=-1;f.manager.spawn('owned.exe',[]);
  assert.equal((await f.manager.terminate(f.child)).ok,false);
  assert.equal(f.calls.length,1);assert.equal(f.directKills(),0);
});

test('a missing or stalled taskkill has a bounded fallback and cannot report tree success', async () => {
  for(const options of [{failure:Object.assign(new Error('missing'),{code:'ENOENT'})},{neverReply:true}]){
    const f=windowsManager(options);f.manager.spawn('owned.exe',[]);
    assert.equal((await f.manager.terminate(f.child)).ok,false);assert.equal(f.directKills(),1);
  }
});

test('audio and graceful shutdown use the owned manager for every subprocess', () => {
  const audio=fs.readFileSync(path.join(__dirname,'../server/services/audio-processor.js'),'utf8');
  const server=fs.readFileSync(path.join(__dirname,'../server/index.js'),'utf8');
  assert.ok(audio.includes("require('../utils/owned-process')"));
  assert.ok(!audio.includes('child.kill()'));
  assert.ok(server.includes("await require('./services/audio-processor').shutdownImports()"));
});

test('shutdown rejects any late fallback which tries to spawn another subprocess', async () => {
  let spawned = 0;
  const manager = createOwnedProcessManager({ spawnImpl() { spawned++; throw new Error('should never spawn'); } });
  await manager.shutdown();
  assert.throws(() => manager.spawn('late-download.exe', []), { code: 'IMPORT_CANCELLED' });
  await assert.rejects(promisify(manager.execFile)('late-metadata.exe', [], {}), { code: 'IMPORT_CANCELLED' });
  assert.equal(spawned, 0);
});
