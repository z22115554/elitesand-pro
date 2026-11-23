'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Production orchestration, overlap-add, normalization and WAV encoding run
// unchanged. Decoder and fixed-shape FFT/model outputs are fixtures. This is
// a CPU allocation probe, not a browser/GPU peak-memory benchmark.
function loadDspWorker({ root = path.resolve(__dirname, '../..'), seconds = 1 } = {}) {
  const samples = Math.round(44100 * seconds), allocations = [], sent = [], uploads = [];
  let decodedRate = 44100, channels = 2;
  function TrackedFloat32Array(...args) {
    const value = new Float32Array(...args);
    allocations.push({ length: value.length, bytes: value.byteLength });
    return value;
  }
  TrackedFloat32Array.prototype = Float32Array.prototype;
  TrackedFloat32Array.from = Float32Array.from.bind(Float32Array);
  const decoded = () => ({ length: samples, duration: samples / decodedRate, sampleRate: decodedRate,
    numberOfChannels: channels, getChannelData: c => new Float32Array(samples).fill(c ? 0.3 : 0.5) });
  const api = {};
  const context = {
    FFT: class {}, ort: { env: { wasm: {} }, Tensor: class { constructor(_type, data) { this.data = data; } dispose() {} } },
    Float32Array: TrackedFloat32Array, Float64Array, Uint8Array, ArrayBuffer, DataView,
    Blob, FormData, AbortController, performance: { now: () => 1000 }, console: { log() {} },
    document: { getElementById: () => null },
    SocketClient: { init() {}, on() {}, send: (event, payload) => sent.push({ event, payload }) },
    window: { AudioContext: class {
      constructor(options) { api.contextOptions = options; }
      async decodeAudioData() { return decoded(); }
      async close() { api.closed = true; }
    } },
    OfflineAudioContext: class {
      createBufferSource() { return { connect() {}, start() {} }; }
      async startRendering() { return decoded(); }
    },
    async fetch(_url, options) {
      if (options?.method === 'POST') { uploads.push(options.body); return { ok: true }; }
      let done = false;
      return { ok: true, headers: { get: () => '16' }, arrayBuffer: async () => new ArrayBuffer(16),
        body: { getReader: () => ({ read: async () => done ? { done: true } : (done = true, { done: false, value: new Uint8Array(16) }),
          cancel: async () => {}, releaseLock() {} }) } };
    },
  };
  const utilityFile = path.join(root, 'public/js/webgpu-audio-utils.mjs');
  const utilities = fs.existsSync(utilityFile) ? fs.readFileSync(utilityFile, 'utf8').replace(/^export\s+/gm, '') : '';
  const worker = fs.readFileSync(path.join(root, 'public/js/webgpu-separation-worker.mjs'), 'utf8').replace(/^import .+;\s*$/gm, '');
  vm.runInNewContext(utilities + '\n' + worker + `
    getAdapterInfo = async () => ({ok:true,shaderF16:true,vendor:'unknown'});
    runCanary = async () => true;
    ensureSession = async () => ({ inputNames:['input'],outputNames:['output'],
      run:async () => ({output:{data:new Float32Array(4),dispose(){}}}) });
    stftChannel = () => new Float32Array(4);
    packStereo = () => new Float32Array(4);
    applyMasks = () => new Float32Array(4);
    unpackChannel = () => new Float32Array(4);
    istftChannel = () => new Float32Array(CHUNK_SAMPLES).fill(2);
    globalThis.workerApi = {runJob,decodeToStereo44100};
  `, context, { filename: 'webgpu-separation-worker.mjs' });
  return { ...context.workerApi, samples, allocations, uploads, sent, api,
    setFormat: (rate, count) => { decodedRate = rate; channels = count; },
    async run() {
      await context.workerApi.runJob({jobId:'dsp-fixture',trackId:'fixture',audioUrl:'/audio/fixture.wav',audioSeconds:seconds});
      if (!uploads.length) throw new Error(JSON.stringify(sent));
      return { vocals: Buffer.from(await uploads[0].get('vocals').arrayBuffer()),
        instrumental: Buffer.from(await uploads[0].get('instrumental').arrayBuffer()),
        songArrayBytes: allocations.filter(x => x.length === samples || x.length === samples * 2).reduce((n,x) => n+x.bytes,0),
        songArrays: allocations.filter(x => x.length === samples || x.length === samples * 2).map(x => x.length) };
    },
  };
}
module.exports = { loadDspWorker };
