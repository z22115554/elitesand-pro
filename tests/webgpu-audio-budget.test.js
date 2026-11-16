'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { loadDspWorker } = require('./helpers/webgpu-dsp-fixture');
const utils = import('../public/js/webgpu-audio-utils.mjs');

async function workerFixture() {
  const filename = path.resolve(__dirname, '../public/js/webgpu-separation-worker.mjs');
  const sent = [];
  let adapters = 0, downloads = 0, contexts = 0, closed = 0;
  const imports = await utils;
  const context = { ...imports, FFT: class {}, Float32Array, Float64Array, Uint8Array, ArrayBuffer, DataView,
    performance: { now: () => 0 }, console: { log() {} }, document: { getElementById: () => null },
    ort: { env: { wasm: {} } }, navigator: {}, AbortController,
    SocketClient: { init() {}, on() {}, send: (event, payload) => sent.push({ event, payload }) },
    window: { AudioContext: class {
      constructor() { contexts++; this.sampleRate = 44100; }
      async decodeAudioData() { throw new Error('invalid audio fixture'); }
      async close() { closed++; }
    } },
    async fetch() { downloads++; throw new Error('audio was fetched before admission'); },
    adapterRequested() { adapters++; },
  };
  const source = fs.readFileSync(filename, 'utf8').replace(/^import .+;\s*$/gm, '');
  vm.runInNewContext(source + `
    getAdapterInfo = async () => { globalThis.adapterRequested(); return {ok:true,shaderF16:true,vendor:'unknown'}; };
    runCanary = async () => true;
    globalThis.workerTestApi = { runJob, decodeToStereo44100 };
  `, context, { filename });
  return { ...context.workerTestApi, sent, counts: () => ({ adapters, downloads, contexts, closed }) };
}

test('20-minute jobs are rejected before GPU setup, download or decode', async () => {
  const f = await workerFixture();
  await f.runJob({ jobId:'long', trackId:'fixture', audioUrl:'/audio/fixture.mp3', audioSeconds:1200 });
  assert.deepEqual(f.counts(), { adapters:0, downloads:0, contexts:0, closed:0 });
  assert.equal(f.sent.at(-1).payload.code, 'input_too_large');
});

test('unknown or malformed duration cannot start full-file decoding', async () => {
  for (const audioSeconds of [undefined, NaN, Infinity, 0, -1, '300']) {
    const f = await workerFixture();
    await f.runJob({ jobId:'unknown', audioUrl:'/audio/fixture.mp3', audioSeconds });
    assert.equal(f.counts().downloads, 0);
    assert.equal(f.sent.at(-1).payload.code, 'invalid_audio');
  }
});

test('decode failure always closes its temporary AudioContext', async () => {
  const f = await workerFixture();
  await assert.rejects(f.decodeToStereo44100(new ArrayBuffer(16)), /invalid audio fixture/);
  assert.equal(f.counts().closed, 1);
});

test('the real worker reuses song buffers and preserves stereo residual semantics', async () => {
  const f = loadDspWorker(); const output = await f.run();
  assert.deepEqual(output.songArrays.sort((a,b)=>a-b), [f.samples, f.samples*2, f.samples*2]);
  assert.equal(output.songArrayBytes, f.samples*20);
  assert.equal(f.api.contextOptions.sampleRate, 44100); assert.equal(f.api.closed,true);
  assert.equal(output.vocals.toString('ascii',0,4),'RIFF');
  assert.equal(output.vocals.readUInt32LE(24),44100);
  assert.equal(output.vocals.length,44+f.samples*4);
  assert.ok(output.vocals.readInt16LE(44)>29000);
  // Fixture raw vocals are 2.0; normalizing before subtraction would produce
  // -0.4/-0.6, instead of this normalized -1.5/-1.7 stereo residual.
  assert.ok(Math.abs(output.instrumental.readInt16LE(44)/32768-(-1.5/1.7*0.9))<0.0001);
  assert.ok(Math.abs(output.instrumental.readInt16LE(46)/32768-(-0.9))<0.0001);
});

test('decoded duration or format mismatches fail before planar allocation', async () => {
  const f=loadDspWorker({seconds:601});
  await assert.rejects(f.decodeToStereo44100(new ArrayBuffer(16)),{code:'input_too_large'});
  assert.equal(f.allocations.filter(x=>x.length>=601*44100).length,0);
  const g=loadDspWorker(); g.setFormat(48000,2);
  await assert.rejects(g.decodeToStereo44100(new ArrayBuffer(16)),{code:'invalid_audio'});
  g.setFormat(44100,6);
  await assert.rejects(g.decodeToStereo44100(new ArrayBuffer(16)),{code:'invalid_audio'});
});

test('mono decode duplicates into stereo without a second whole-song render', async () => {
  const f=loadDspWorker(); f.setFormat(44100,1);
  const decoded=await f.decodeToStereo44100(new ArrayBuffer(16));
  assert.equal(decoded.data.length,f.samples*2);
  for(let i=0;i<f.samples;i++)assert.equal(decoded.data[i],decoded.data[i+f.samples]);
});

test('HTTP advertised size and streamed bytes are bounded; overflow cancels reading', async () => {
  const {readBoundedAudio,MAX_ENCODED_AUDIO_BYTES}=await utils;
  let cancelled=0,released=0,read=0;
  await assert.rejects(readBoundedAudio({headers:{get:()=>String(MAX_ENCODED_AUDIO_BYTES+1)},body:{
    cancel:async()=>{cancelled++;},getReader(){throw Error('reader must not start');}}}),{code:'input_too_large'});
  const big=new Uint8Array(MAX_ENCODED_AUDIO_BYTES);
  await assert.rejects(readBoundedAudio({headers:{get:()=>null},body:{getReader:()=>({
    read:async()=>({done:false,value:++read===1?big:new Uint8Array(1)}),
    cancel:async()=>{cancelled++;},releaseLock:()=>{released++;},
  })}}),{code:'input_too_large'});
  assert.equal(cancelled,2);assert.equal(released,1);
  await assert.rejects(readBoundedAudio({headers:{get:()=>null}}),{code:'invalid_audio'});
});

test('streamed audio remains byte-exact even if content length underreports', async () => {
  const {readBoundedAudio}=await utils, chunks=[new Uint8Array([1,2]),new Uint8Array([3,4,5])];
  const output=await readBoundedAudio({headers:{get:()=> '1'},body:{getReader:()=>({
    read:async()=>chunks.length?{done:false,value:chunks.shift()}:{done:true},releaseLock(){},cancel:async()=>{},
  })}});
  assert.deepEqual([...new Uint8Array(output)],[1,2,3,4,5]);
});

function createSparseWav(file,seconds,channels=1){
  const size=Math.round(seconds*8000)*channels*2,h=Buffer.alloc(44);
  h.write('RIFF');h.writeUInt32LE(36+size,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);
  h.writeUInt16LE(1,20);h.writeUInt16LE(channels,22);h.writeUInt32LE(8000,24);
  h.writeUInt32LE(8000*channels*2,28);h.writeUInt16LE(channels*2,32);h.writeUInt16LE(16,34);
  h.write('data',36);h.writeUInt32LE(size,40);
  const fd=fs.openSync(file,'w');try{fs.writeSync(fd,h);fs.ftruncateSync(fd,44+size);}finally{fs.closeSync(fd);}
}

test('real metadata admits 10 minutes but rejects 20 minutes, oversized and surround input', async t=>{
  const {inspectWebgpuAudio}=require('../server/services/webgpu-audio-admission');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'webgpu-admission-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const short=path.join(root,'ten.wav'),long=path.join(root,'twenty.wav'),surround=path.join(root,'surround.wav');
  createSparseWav(short,600);createSparseWav(long,1200);createSparseWav(surround,1,6);
  assert.deepEqual(await inspectWebgpuAudio(short),{ok:true,audioSeconds:600});
  assert.deepEqual(await inspectWebgpuAudio(long),{ok:false,code:'input_too_large'});
  assert.deepEqual(await inspectWebgpuAudio(surround),{ok:false,code:'input_too_large'});
  assert.deepEqual(await inspectWebgpuAudio(path.join(root,'missing.wav')),{ok:false,code:'invalid_audio'});
  const {MAX_ENCODED_AUDIO_BYTES}=await utils, fd=fs.openSync(long,'r+');
  try{fs.ftruncateSync(fd,MAX_ENCODED_AUDIO_BYTES+1);}finally{fs.closeSync(fd);}
  assert.deepEqual(await inspectWebgpuAudio(long),{ok:false,code:'input_too_large'});
});

function coordinatorFixture({admission=async()=>({ok:true,audioSeconds:60})}={}){
  const filename=path.resolve(__dirname,'../server/services/ai-separation-jobs.js');
  const python=[],dispatched=[],emitter=new EventEmitter(),webgpuEvents=new EventEmitter(),timers=[];
  const sandbox={module:{exports:{}},process:{env:{}},setTimeout(fn,ms){timers.push({fn,ms});return{unref(){}};},clearTimeout(){},
    require(name){
      if(name==='path')return path;
      if(name==='./ai-separation')return{supervisor:{emitter,probe:async()=>({cudaAvailable:false}),
        separate:params=>{python.push(params);return'python-'+python.length;},cancel(){}}};
      if(name==='./webgpu-separation-jobs')return{events:webgpuEvents,isEngineAvailable:()=>true,
        startJobForTrack:(...args)=>{dispatched.push(args);},cancelJob(){}};
      if(name==='./webgpu-audio-admission')return{inspectWebgpuAudio:admission};
      if(name==='./webgpu-runtime-provider')return{isAvailable:()=>true};
      if(name==='./library-store')return{getLibrary:()=>[],getLibrarySummary:()=>[]};
      if(name==='./usage-telemetry')return{recordAiSeparation(){}};
      if(name==='./section-analysis-jobs')return{isGpuBusy:()=>false};
      if(name==='../utils/logger')return{createLogger:()=>({info(){},warn(){}})};
      if(name==='../utils/socket-broadcast')return{emitToControlClients(){}};
      throw Error('unexpected require '+name);
    }};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),sandbox,{filename});
  const jobs=sandbox.module.exports;
  jobs.wireDependencies({io:{emit(){}},playState:{playlist:[]},persistState(){},broadcastState(){},updateLibraryMeta(){}});
  return{jobs,python,dispatched,timers,webgpuEvents};
}

test('over-budget jobs fall directly to CPU without dispatch or retry timers',async()=>{
  const f=coordinatorFixture({admission:async()=>({ok:false,code:'input_too_large'})});
  await f.jobs.startJobForTrack('long',{inputPath:'fixture.wav',sourceFilename:'fixture.wav'});
  assert.equal(f.dispatched.length,0);assert.equal(f.python.length,1);
  assert.equal(f.python[0].forceCpu,true);assert.equal(f.timers.length,0);
});

test('accepted duration is forwarded and permanent WebGPU errors never retry',async()=>{
  for(const code of ['unsupported_gpu','timeout','input_too_large','invalid_audio']){
    const f=coordinatorFixture(),id=await f.jobs.startJobForTrack('short',{inputPath:'fixture.wav',sourceFilename:'fixture.wav'});
    assert.equal(f.dispatched[0][1].audioSeconds,60);f.webgpuEvents.emit('error',{jobId:id,code});
    assert.equal(f.python.length,1);assert.equal(f.timers.length,0);
  }
});

test('transient failures retain the existing three-attempt WebGPU retry policy',async()=>{
  const f=coordinatorFixture(),id=await f.jobs.startJobForTrack('short',{inputPath:'fixture.wav'});
  for(let attempt=1;attempt<3;attempt++){
    f.webgpuEvents.emit('error',{jobId:id,code:'engine_disconnected'});
    assert.equal(f.python.length,0);assert.equal(f.timers.length,1);await f.timers.shift().fn();
  }
  assert.equal(f.dispatched.length,3);f.webgpuEvents.emit('error',{jobId:id,code:'engine_disconnected'});
  assert.equal(f.python.length,1);assert.equal(f.timers.length,0);
});

test('cancellation during metadata inspection cannot dispatch GPU or CPU work',async()=>{
  let release;const f=coordinatorFixture({admission:()=>new Promise(resolve=>{release=resolve;})});
  const pending=f.jobs.startJobForTrack('cancel',{inputPath:'fixture.wav'});
  for(let i=0;i<5;i++)await Promise.resolve();assert.ok(release);
  f.jobs.cancelJobForTrack('cancel');release({ok:true,audioSeconds:60});await pending;
  assert.equal(f.python.length,0);assert.equal(f.dispatched.length,0);
});
