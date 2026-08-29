// WebGPU 人聲分離引擎（實驗性，docs/AI-SEPARATION-PLAN.md §13 musetric 路線）。
//
// 這個模組只會被 Electron 主程序開的隱藏 BrowserWindow 載入（見
// electron/webgpu-engine-window.js），不是給人看的頁面。連上跟主程式同一個
// Socket.io、自報 client:type='webgpu-engine'，等伺服器（webgpu-separation-jobs.js）
// 派工、跑完把結果送回去。
//
// STFT/iSTFT/pack/mask 邏輯是 §13 W1 已經端到端驗證過（4 分鐘真歌重建、CPU FFT
// SNR 161.7dB）的同一套算法，逐行對應 musetric 的 pack.wgsl/applyMasks.wgsl/
// separateVocals.ts（MIT，可合法參考）。
import * as ort from '/vendor/onnxruntime-web/ort.webgpu.bundle.min.mjs';
import FFT from '/vendor/fft-browser.mjs';

ort.env.wasm.wasmPaths = '/vendor/onnxruntime-web/';
ort.env.logLevel = 'warning';
// 真正的算力都在 WebGPU EP；多執行緒 WASM 背景執行緒在這個環境下會間歇性撞上
// COEP require-corp 擋下巢狀 worker 腳本（同一個 URL 有時 200/304、有時被瀏覽器
// 判定為要擋，目前判斷是瀏覽器對同一資源並發重複請求的既有毛病，不是這裡的
// header 沒設對）。WASM 只是 fallback/初始化探測用，關掉多執行緒換穩定性完全划算。
ort.env.wasm.numThreads = 1;

const logEl = document.getElementById('log');
function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  if (logEl) { logEl.textContent += line + '\n'; logEl.scrollTop = logEl.scrollHeight; }
  console.log(line);
}

// ─── STFT/iSTFT（跟既有 W1 探針同一套常數：musetric SYHFT 模型的固定 shape）───
const N_FFT = 2048;
const HOP = 441;
const FRAMES = 1101;
const PAD = N_FFT / 2;
const PACKED_BINS = (N_FFT / 2 + 1) * 2; // 2050
const CHUNK_SAMPLES = HOP * (FRAMES - 1); // 485100，約 11 秒 @ 44.1kHz

const fft = new FFT(N_FFT);
const HANN = new Float32Array(N_FFT);
for (let n = 0; n < N_FFT; n++) HANN[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT);

function reflectIndex(index, samples) {
  if (index < 0) return -index;
  if (index >= samples) return 2 * samples - 2 - index;
  return index;
}

function stftChannel(channelSamples) {
  const samples = channelSamples.length;
  const out = new Float32Array(1025 * FRAMES * 2);
  const timeBuf = new Float64Array(N_FFT);
  const spectrum = fft.createComplexArray();
  for (let frame = 0; frame < FRAMES; frame++) {
    for (let n = 0; n < N_FFT; n++) {
      const sampleIdx = reflectIndex(frame * HOP + n - PAD, samples);
      timeBuf[n] = channelSamples[sampleIdx] * HANN[n];
    }
    fft.realTransform(spectrum, timeBuf);
    for (let freq = 0; freq <= N_FFT / 2; freq++) {
      const dst = (freq * FRAMES + frame) * 2;
      out[dst] = spectrum[freq * 2];
      out[dst + 1] = spectrum[freq * 2 + 1];
    }
  }
  return out;
}

function istftChannel(packedSpectrum, chunkSamples) {
  const framesTime = new Float64Array(FRAMES * N_FFT);
  const complexIn = fft.createComplexArray();
  const complexOut = fft.createComplexArray();
  for (let frame = 0; frame < FRAMES; frame++) {
    complexIn.fill(0);
    for (let freq = 0; freq <= N_FFT / 2; freq++) {
      const src = (freq * FRAMES + frame) * 2;
      complexIn[freq * 2] = packedSpectrum[src];
      complexIn[freq * 2 + 1] = packedSpectrum[src + 1];
    }
    fft.completeSpectrum(complexIn);
    fft.inverseTransform(complexOut, complexIn);
    for (let n = 0; n < N_FFT; n++) framesTime[frame * N_FFT + n] = complexOut[n * 2];
  }
  const audio = new Float32Array(chunkSamples);
  for (let sample = 0; sample < chunkSamples; sample++) {
    const padded = sample + PAD;
    const firstFrame = Math.max(0, Math.ceil((padded - N_FFT + 1) / HOP));
    const lastFrame = Math.min(FRAMES - 1, Math.floor(padded / HOP));
    if (firstFrame > lastFrame) { audio[sample] = 0; continue; }
    let sum = 0, envelope = 0;
    for (let frame = firstFrame; frame <= lastFrame; frame++) {
      const n = padded - frame * HOP;
      const w = HANN[n];
      sum += framesTime[frame * N_FFT + n] * w;
      envelope += w * w;
    }
    audio[sample] = sum / Math.max(envelope, 1e-8);
  }
  return audio;
}

function packStereo(specL, specR) {
  const out = new Float32Array(PACKED_BINS * FRAMES * 2);
  const chans = [specL, specR];
  for (let freq = 0; freq < 1025; freq++) {
    for (let channel = 0; channel < 2; channel++) {
      const packed = freq * 2 + channel;
      const spec = chans[channel];
      for (let frame = 0; frame < FRAMES; frame++) {
        const src = (freq * FRAMES + frame) * 2;
        const dst = (packed * FRAMES + frame) * 2;
        out[dst] = spec[src];
        out[dst + 1] = spec[src + 1];
      }
    }
  }
  return out;
}

function unpackChannel(packed2050, channel) {
  const out = new Float32Array(1025 * FRAMES * 2);
  for (let freq = 0; freq < 1025; freq++) {
    const packedIdx = freq * 2 + channel;
    for (let frame = 0; frame < FRAMES; frame++) {
      const src = (packedIdx * FRAMES + frame) * 2;
      const dst = (freq * FRAMES + frame) * 2;
      out[dst] = packed2050[src];
      out[dst + 1] = packed2050[src + 1];
    }
  }
  return out;
}

function applyMasks(stftPacked, masksPacked) {
  const out = new Float32Array(stftPacked.length);
  for (let i = 0; i < stftPacked.length; i += 2) {
    const sRe = stftPacked[i], sIm = stftPacked[i + 1];
    const mRe = masksPacked[i], mIm = masksPacked[i + 1];
    out[i] = sRe * mRe - sIm * mIm;
    out[i + 1] = sRe * mIm + sIm * mRe;
  }
  return out;
}

function normalizePeak(input, maxPeak = 0.9, minPeak) {
  let peak = 0;
  for (let i = 0; i < input.length; i++) peak = Math.max(peak, Math.abs(input[i]));
  const output = new Float32Array(input.length);
  if (peak === 0) { output.set(input); return output; }
  let scale = 1;
  if (peak > maxPeak) scale = maxPeak / peak;
  else if (minPeak !== undefined && peak < minPeak) scale = minPeak / peak;
  if (scale === 1) { output.set(input); return output; }
  for (let i = 0; i < input.length; i++) output[i] = input[i] * scale;
  return output;
}

function subtractPlanarStereo(a, b) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < out.length; i++) out[i] = a[i] - b[i];
  return out;
}

function createHammingWindow(length) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / length);
  return out;
}
function getChunkWindow(offset, samples) {
  if (offset + CHUNK_SAMPLES <= samples) return { start: offset, length: Math.min(CHUNK_SAMPLES, samples - offset) };
  if (samples >= CHUNK_SAMPLES) return { start: samples - CHUNK_SAMPLES, length: CHUNK_SAMPLES };
  return { start: 0, length: samples };
}
function fillChunk(chunk, mix, samples, start, length) {
  if (length < CHUNK_SAMPLES) chunk.fill(0);
  for (let channel = 0; channel < 2; channel++) {
    const src = channel * samples + start, dst = channel * CHUNK_SAMPLES;
    chunk.set(mix.subarray(src, src + length), dst);
  }
}
function overlapAddChunk(target, counter, chunk, samples, start, length, window) {
  for (let channel = 0; channel < 2; channel++) {
    const outOff = channel * samples + start, chunkOff = channel * CHUNK_SAMPLES;
    for (let i = 0; i < length; i++) {
      const w = window[i];
      target[outOff + i] += chunk[chunkOff + i] * w;
      counter[outOff + i] += w;
    }
  }
}
function finalizeOverlap(target, counter) {
  const out = new Float32Array(target.length);
  for (let i = 0; i < target.length; i++) out[i] = target[i] / Math.max(counter[i], 1e-10);
  return out;
}

function encodeWav({ sampleRate, samples, channels, data }) {
  const bytesPerSample = 2, dataSize = samples * channels * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeStr(8, 'WAVE');
  writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true); view.setUint16(34, 16, true);
  writeStr(36, 'data'); view.setUint32(40, dataSize, true);
  let off = 44;
  for (let s = 0; s < samples; s++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, data[c * samples + s]));
      view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      off += 2;
    }
  }
  return buf;
}

async function decodeToStereo44100(arrayBuffer) {
  const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await tempCtx.decodeAudioData(arrayBuffer);
  await tempCtx.close();
  const targetLen = Math.ceil(decoded.duration * 44100);
  const offline = new OfflineAudioContext(2, targetLen, 44100);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  const samples = rendered.length;
  const data = new Float32Array(samples * 2);
  data.set(rendered.numberOfChannels > 0 ? rendered.getChannelData(0) : new Float32Array(samples), 0);
  data.set(rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : rendered.getChannelData(0), samples);
  return { sampleRate: 44100, samples, channels: 2, data };
}

// ─── WebGPU buffer 峰值追蹤（跟這次規劃階段驗證 windowed-roformer 用的同一招）───
function instrumentGpuMemory() {
  const mem = { live: 0, peak: 0 };
  if (typeof GPUDevice === 'undefined') return mem;
  const orig = GPUDevice.prototype.createBuffer;
  GPUDevice.prototype.createBuffer = function (desc) {
    const buf = orig.call(this, desc);
    mem.live += desc.size || 0;
    if (mem.live > mem.peak) mem.peak = mem.live;
    const origDestroy = buf.destroy.bind(buf);
    let destroyed = false;
    buf.destroy = () => { if (!destroyed) { destroyed = true; mem.live -= desc.size || 0; } return origDestroy(); };
    return buf;
  };
  return mem;
}

// ─── 單一 GPUDevice ───────────────────────────────────────────────────────────
// adapter 偵測、ORT WebGPU 推論、device.lost 監聽全部對到「同一顆」實體裝置。
// 之前這裡有三處各自 requestAdapter()／requestDevice()：adapter 偵測拿完就丟、
// ORT 內部自己再建一顆、device.lost 監聽器又建第三顆——在雙 GPU（例如 AMD
// 內顯＋Intel、或獨顯＋內顯）機器上，這三顆可能不是同一張卡，於是 vendor 記錯、
// device.lost 監聽到一顆跟推論無關的裝置。現在只建一次，全程共用。
let gpuAdapter = null;
let gpuDevice = null;
let gpuInfo = null; // { vendor, architecture, shaderF16 }

function classifyVendor(raw) {
  const v = String(raw || '').toLowerCase();
  if (v.includes('nvidia') || v === '0x10de') return 'nvidia';
  if (v.includes('amd') || v.includes('ati') || v === '0x1002') return 'amd';
  if (v.includes('intel') || v === '0x8086') return 'intel';
  if (v.includes('apple')) return 'apple';
  return 'unknown';
}

async function acquireGpu() {
  if (gpuDevice) return { device: gpuDevice, info: gpuInfo };
  if (!navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
  if (!adapter) return null;
  const hasF16 = adapter.features.has('shader-f16');
  const device = await adapter.requestDevice({ requiredFeatures: hasF16 ? ['shader-f16'] : [] }).catch(() => null);
  if (!device) return null;
  const raw = adapter.info || {};
  gpuAdapter = adapter;
  gpuDevice = device;
  gpuInfo = { vendor: classifyVendor(raw.vendor), architecture: raw.architecture || '', shaderF16: hasF16 };
  // 這顆、也只有這顆，才是 ORT 待會拿去跑推論的裝置——把 device.lost 掛在它身上。
  device.lost.then(handleDeviceLost);
  return { device: gpuDevice, info: gpuInfo };
}

async function getAdapterInfo() {
  const gpu = await acquireGpu();
  if (!gpu) return { ok: false };
  return { ok: true, vendor: gpu.info.vendor, architecture: gpu.info.architecture, shaderF16: gpu.info.shaderF16 };
}

function handleDeviceLost(info) {
  // reason 'destroyed' 是正常 teardown，不是故障：清掉本地引用就好，不回報。
  const destroyed = info && info.reason === 'destroyed';
  gpuAdapter = null;
  gpuDevice = null;
  gpuInfo = null;
  session = null;       // 裝置已死，下一個 job 要重建 session
  canaryPassed = false; // 也要重新 canary，不能沿用「探測過沒事」的舊結論
  if (destroyed || deviceLostReported) return;
  deviceLostReported = true;
  log(`GPU 裝置遺失: ${info && info.reason} - ${info && info.message}`);
  if (currentJob) reportDeviceLost(currentJob, info);
}

// ─── 輸出健檢：WebGPU EP 偶發會吐 NaN/Inf（fp16 溢位、驅動 bug），若原封不動寫進
// WAV 就是使用者聽到的爆音。抓到就把這次推論當失效，讓上層降級到 CPU。
function assertFinite(arr, label, stride = 1) {
  for (let i = 0; i < arr.length; i += stride) {
    if (!Number.isFinite(arr[i])) {
      throw Object.assign(
        new Error(`${label} 含非有限值（NaN/Inf），WebGPU 推論結果不可用`),
        { code: 'invalid_output' },
      );
    }
  }
}

// ─── ONNX session（懶建立，job 之間重用；跟 canary 探測共用同一份 session）───
const GRAPH_FILE = 'syhft_core_folded_fp16_webgpu.onnx';
const WEIGHTS_FILE = 'syhft_core_folded_fp16_webgpu.onnx.data';

let session = null;
let sessionMem = null;
// 每個 job 開始時重置（見 runJob），只代表「這個 job 期間有沒有已經回報過 device lost」，
// 不是「這個引擎的一生只能回報一次」——不然裝置復原、下一首歌又真的當機時會被誤判成
// 已經報過而整個吞掉，使用者跟遙測都看不到第二次失敗。
let deviceLostReported = false;

async function ensureSession() {
  if (session) return session;
  const gpu = await acquireGpu();
  if (!gpu) throw Object.assign(new Error('這台機器沒有可用的 WebGPU 裝置'), { code: 'unsupported_gpu' });
  if (!gpu.info.shaderF16) {
    throw Object.assign(new Error('這張顯示卡不支援 shader-f16，fp16 模型無法執行'), { code: 'unsupported_gpu' });
  }
  sessionMem = instrumentGpuMemory();
  // 把預先建立好的那顆 device 交給 ORT，別讓它自己 requestAdapter/requestDevice
  // ——否則 adapter 偵測與實際推論會落在不同 GPU 上（見上方「單一 GPUDevice」）。
  ort.env.webgpu.device = gpu.device;
  session = await ort.InferenceSession.create(`/webgpu-separation/model/${GRAPH_FILE}`, {
    executionProviders: [{ name: 'webgpu', storageBufferCacheMode: 'simple' }],
    externalData: [{ path: WEIGHTS_FILE, data: `/webgpu-separation/model/${WEIGHTS_FILE}` }],
  });
  return session;
}

// ─── canary 探測：用假輸入跑一次完整 session-create + 單次推論，本身若讓裝置當機
// （W3 實測：~4GB 顯存會一致性 DXGI_ERROR_DEVICE_HUNG）就直接擋下、不進到正式那首歌
// 的推論。WebGPU 無法事先精確查詢可用顯存，canary 就是實質的顯存 admission 關卡。
let canaryPassed = false;
async function runCanary() {
  if (canaryPassed) return true;
  try {
    const s = await ensureSession();
    // 形狀要跟 runJob() 實際餵的 stft_repr 完全一致（[1, 2050, 1101, 2]，
    // 2050 = 2 聲道 * 1025 頻點打包成一維），不然探測本身就先因為 rank/shape
    // 不符而假性失敗，不代表這張顯卡真的跑不動。
    const size = 1 * 2050 * 1101 * 2;
    const data = new Float32Array(size);
    const feeds = { [s.inputNames[0]]: new ort.Tensor('float32', data, [1, 2050, 1101, 2]) };
    const result = await s.run(feeds);
    const out = result[s.outputNames[0]];
    assertFinite(out?.data || [], 'canary 輸出', 997); // 全零輸入本來就該給有限輸出
    out?.dispose?.();
    canaryPassed = true;
    return true;
  } catch (err) {
    log(`canary 探測失敗: ${err.message}`);
    return false;
  }
}

let currentJob = null;
let cancelRequested = false;

function reportProgress(job, stage, progress) {
  SocketClient.send('webgpu:job:progress', { jobId: job.jobId, stage, progress });
}
function reportDeviceLost(job, info) {
  SocketClient.send('webgpu:job:device-lost', {
    jobId: job.jobId, code: 'device_lost', message: info?.message || 'GPU device lost',
    gpuVendor: job.gpuVendor, audioSeconds: job.audioSeconds,
  });
  currentJob = null;
}
function reportError(job, err) {
  SocketClient.send('webgpu:job:error', {
    jobId: job.jobId, code: err.code || 'unknown', message: err.message || String(err),
    gpuVendor: job.gpuVendor, audioSeconds: job.audioSeconds,
  });
  currentJob = null;
}

async function runJob({ jobId, trackId, audioUrl }) {
  const job = { jobId, trackId };
  currentJob = job;
  deviceLostReported = false;
  cancelRequested = false;
  const t0 = performance.now();
  try {
    const adapterInfo = await getAdapterInfo();
    job.gpuVendor = adapterInfo.ok ? adapterInfo.vendor : 'unknown';
    if (!adapterInfo.ok) throw Object.assign(new Error('這台機器沒有可用的 WebGPU adapter'), { code: 'unsupported_gpu' });
    if (!adapterInfo.shaderF16) {
      throw Object.assign(new Error('這張顯示卡不支援 shader-f16，fp16 模型無法執行'), { code: 'unsupported_gpu' });
    }

    reportProgress(job, 'canary', 0);
    const canaryOk = await runCanary();
    if (!canaryOk) {
      if (deviceLostReported) return; // device.lost 監聽器已經處理過回報，這裡不要重複送
      throw Object.assign(new Error('canary 探測失敗，這張顯示卡目前不適合跑 WebGPU 分離'), { code: 'unsupported_gpu' });
    }

    reportProgress(job, 'download-audio', 0);
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw Object.assign(new Error(`音檔下載失敗 HTTP ${audioRes.status}`), { code: 'audio_fetch_failed' });
    const audioBuf = await audioRes.arrayBuffer();

    reportProgress(job, 'decode', 0);
    const source = await decodeToStereo44100(audioBuf);
    job.audioSeconds = source.samples / source.sampleRate;

    const s = await ensureSession();
    const mixture = normalizePeak(source.data, 0.9, 0);
    const stepSize = Math.min(8 * source.sampleRate, CHUNK_SAMPLES);
    const hammingWindow = createHammingWindow(CHUNK_SAMPLES);
    const chunk = new Float32Array(2 * CHUNK_SAMPLES);
    const target = new Float32Array(mixture.length);
    const counter = new Float32Array(mixture.length);
    const totalSteps = Math.ceil(source.samples / stepSize);

    let stepIndex = 0;
    for (let offset = 0; offset < source.samples; stepIndex++, offset += stepSize) {
      // 伺服器端的 hang watchdog 逾時後會送 webgpu:job:cancel，讓卡在慢（但還沒完全
      // wedge）的迴圈能在下一個 chunk 之前收手，不要在上層已經改走 CPU 之後還在燒 GPU。
      if (cancelRequested) throw Object.assign(new Error('工作已取消'), { code: 'cancelled' });
      const win = getChunkWindow(offset, source.samples);
      fillChunk(chunk, mixture, source.samples, win.start, win.length);
      const specL = stftChannel(chunk.subarray(0, CHUNK_SAMPLES));
      const specR = stftChannel(chunk.subarray(CHUNK_SAMPLES, 2 * CHUNK_SAMPLES));
      const stftPacked = packStereo(specL, specR);
      const feeds = { [s.inputNames[0]]: new ort.Tensor('float32', stftPacked, [1, 2050, 1101, 2]) };
      const result = await s.run(feeds);
      const outputTensor = result[s.outputNames[0]];
      const masksPacked = outputTensor.data;
      // WebGPU EP 的輸出 tensor 底下扣著一塊顯存 buffer，JS GC 收不管這塊——不手動
      // dispose 的話，每個 chunk 都會再累加一塊，跑到長一點的歌就會把顯存吃爆到
      // 驅動層當機（真機實測就是這樣爆的：canary 只跑一次抓不到，累積到一半才炸）。
      outputTensor.dispose?.();
      // 抓 NaN/Inf 用跨步取樣就夠了——溢位/驅動 bug 造成的非有限值幾乎都是整片，
      // 不會只有零星一格；每個 chunk 全掃 450 萬個 float × 33 次太貴。
      assertFinite(masksPacked, '模型輸出遮罩', 101);
      const maskedPacked = applyMasks(stftPacked, masksPacked);
      const outL = istftChannel(unpackChannel(maskedPacked, 0), CHUNK_SAMPLES);
      const outR = istftChannel(unpackChannel(maskedPacked, 1), CHUNK_SAMPLES);
      const separated = new Float32Array(2 * CHUNK_SAMPLES);
      separated.set(outL, 0); separated.set(outR, CHUNK_SAMPLES);
      overlapAddChunk(target, counter, separated, source.samples, win.start, win.length, hammingWindow);
      reportProgress(job, 'run', (stepIndex + 1) / totalSteps);
    }

    const rawVocals = finalizeOverlap(target, counter);
    const vocals = normalizePeak(rawVocals, 0.9, 0);
    const instrumental = normalizePeak(subtractPlanarStereo(mixture, rawVocals), 0.9, 0);
    // 最終成品全掃一次（各只有一趟，成本可忽略）——確保沒有任何一個 chunk 的
    // 非有限值漏過跨步取樣、混進了 overlap-add 的結果。
    assertFinite(vocals, '人聲輸出');
    assertFinite(instrumental, '伴奏輸出');
    const vocalsWav = encodeWav({ sampleRate: source.sampleRate, samples: source.samples, channels: 2, data: vocals });
    const instWav = encodeWav({ sampleRate: source.sampleRate, samples: source.samples, channels: 2, data: instrumental });

    const totalS = (performance.now() - t0) / 1000;
    currentJob = null;
    // 兩個 WAV 加起來很容易超過 Socket.io 的封包上限，改用 HTTP multipart 上傳
    // 到 /api/webgpu-separation/result/:jobId（見 server 端 finishJobWithResult
    // 的註解）——真機首測第一輪就是在這裡用 socket 送大檔案時斷線，誤報成失敗。
    const form = new FormData();
    form.append('vocals', new Blob([vocalsWav], { type: 'audio/wav' }), 'vocals.wav');
    form.append('instrumental', new Blob([instWav], { type: 'audio/wav' }), 'instrumental.wav');
    if (job.gpuVendor) form.append('gpuVendor', job.gpuVendor);
    if (sessionMem) form.append('peakBufferMb', String(Math.round(sessionMem.peak / 1024 / 1024)));
    if (job.audioSeconds) form.append('realtimeFactor', String(job.audioSeconds / totalS));
    form.append('audioSeconds', String(Math.round(job.audioSeconds || 0)));
    const uploadRes = await fetch(`/api/webgpu-separation/result/${encodeURIComponent(jobId)}`, {
      method: 'POST', body: form,
    });
    if (!uploadRes.ok) throw new Error(`結果上傳失敗 HTTP ${uploadRes.status}`);
    log(`job ${jobId} 完成，${totalS.toFixed(1)}s`);
  } catch (err) {
    if (currentJob === job) currentJob = null;
    if (deviceLostReported) return;
    log(`job ${jobId} 失敗: ${err.message}`);
    reportError(job, err);
  }
}

SocketClient.init('webgpu-engine');
SocketClient.on('webgpu:job:start', (payload) => {
  log(`收到 job:start ${payload && payload.jobId}`);
  if (currentJob) {
    // 理論上 server 端已經有 activeJob 檢查擋住不會派發第二個，這裡是最後一道防線。
    SocketClient.send('webgpu:job:error', { jobId: payload.jobId, code: 'busy', message: '引擎目前正在跑另一個工作' });
    return;
  }
  runJob(payload);
});
SocketClient.on('webgpu:job:cancel', (payload) => {
  if (currentJob && payload && payload.jobId === currentJob.jobId) {
    log(`收到 job:cancel ${payload.jobId}，將在下個 chunk 前收手`);
    cancelRequested = true;
  }
});
log('WebGPU 分離引擎已啟動，等待連線與工作派發。');
