/**
 * 主分離模型（Kim Mel-Band RoFormer）由我們自己下載，不再交給 audio-separator。
 *
 * audio-separator 內建的三個檔案全在 GitHub（模型、yaml 設定、UVR 模型清單），
 * 中華電信用戶連 GitHub 常常極慢或斷線（feedback #17 卡在 77%）。這裡：
 * - 模型：多來源依序嘗試（作者的 HuggingFace → GitHub），支援續傳（跨重啟也接得上），
 *   首輪太慢就換下一個來源，最後一律用釘死的 SHA-256 驗證才轉正。
 * - yaml 設定：MIT，直接內嵌（逐位元組與上游相同，含 CRLF、無結尾換行）。
 * - download_checks.json：上游 repo 沒有授權不能散布，改寫一份我們自己的最小結構；
 *   audio-separator 只讀那七個清單鍵，我們用的模型在它自己的 models.json 裡。
 * 三個檔案都在 audio-separator 看到「已存在」就不會再連網。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { safeRemove } = require('../utils/safe-remove');

const MODEL = Object.freeze({
  filename: 'vocals_mel_band_roformer.ckpt',
  size: 913106900,
  // 2026-09-25 對過：作者 HuggingFace 的 X-Linked-ETag 與 GitHub 版實際下載的檔案一致。
  sha256: '87201f4d31afb5bc79993230fc49446918425574db48c01c405e44f365c7559e',
  sources: Object.freeze([
    { label: 'HuggingFace', url: 'https://huggingface.co/KimberleyJSN/melbandroformer/resolve/main/MelBandRoformer.ckpt' },
    { label: 'GitHub', url: 'https://github.com/nomadkaraoke/python-audio-separator/releases/download/model-configs/vocals_mel_band_roformer.ckpt' },
  ]),
});

const YAML_FILENAME = 'vocals_mel_band_roformer.yaml';
const YAML_SHA256 = 'b958b29c8f7195f0d86bee6759a33980db675c4ecaf2fcaa80fa125828e6cd38';
// 來源：nomadkaraoke/python-audio-separator（MIT）release "model-configs"。
const YAML_TEXT = [
  'audio:',
  '  chunk_size: 352800',
  '  dim_f: 1024',
  '  dim_t: 256',
  '  hop_length: 441',
  '  n_fft: 2048',
  '  num_channels: 2',
  '  sample_rate: 44100',
  '  min_mean_abs: 0.001',
  '',
  'model:',
  '  dim: 384',
  '  depth: 6',
  '  stereo: true',
  '  num_stems: 1',
  '  time_transformer_depth: 1',
  '  freq_transformer_depth: 1',
  '  num_bands: 60',
  '  dim_head: 64',
  '  heads: 8',
  '  attn_dropout: 0',
  '  ff_dropout: 0',
  '  flash_attn: True',
  '  dim_freqs_in: 1025',
  '  sample_rate: 44100  # needed for mel filter bank from librosa',
  '  stft_n_fft: 2048',
  '  stft_hop_length: 441',
  '  stft_win_length: 2048',
  '  stft_normalized: False',
  '  mask_estimator_depth: 2',
  '  multi_stft_resolution_loss_weight: 1.0',
  '  multi_stft_resolutions_window_sizes: !!python/tuple',
  '  - 4096',
  '  - 2048',
  '  - 1024',
  '  - 512',
  '  - 256',
  '  multi_stft_hop_size: 147',
  '  multi_stft_normalized: False',
  '',
  'training:',
  '  instruments:',
  '  - vocals',
  '  - other',
  '  target_instrument: vocals',
  '',
  'inference:',
  '  dim_t: 1101',
  '  num_overlap: 1',
  '  chunk_size: 352800',
].join('\r\n');

const DOWNLOAD_CHECKS_FILENAME = 'download_checks.json';
const DOWNLOAD_CHECKS_KEYS = [
  'vr_download_list', 'mdx_download_list', 'mdx_download_vip_list', 'demucs_download_list',
  'mdx23c_download_list', 'mdx23c_download_vip_list', 'roformer_download_list',
];

const RESUME_SUFFIX = '.resume';
const MAX_REDIRECTS = 5;
const IDLE_TIMEOUT_MS = 30 * 1000;
// 只在第一輪套用：來源明顯太慢且還有別的來源可試時就換；最後一輪不限速，慢也要下完。
const SLOW_CHECK_AFTER_MS = 20 * 1000;
const SLOW_BYTES_PER_SEC = 150 * 1024;
const MAX_ROUNDS = 3;

function ensureSupportFiles(modelDir) {
  fs.mkdirSync(modelDir, { recursive: true });
  const yamlPath = path.join(modelDir, YAML_FILENAME);
  if (!fs.existsSync(yamlPath)) fs.writeFileSync(yamlPath, YAML_TEXT, 'utf8');
  const checksPath = path.join(modelDir, DOWNLOAD_CHECKS_FILENAME);
  if (!fs.existsSync(checksPath)) {
    fs.writeFileSync(checksPath, JSON.stringify(Object.fromEntries(DOWNLOAD_CHECKS_KEYS.map((key) => [key, {}]))), 'utf8');
  }
}

function sizeOf(filePath) {
  try { return fs.statSync(filePath).size; } catch (_) { return 0; }
}

function cancelledError() {
  return Object.assign(new Error('下載已取消'), { code: 'CANCELLED' });
}

/** 從 partPath 目前的長度用 Range 接著下載；伺服器不支援 Range 就從頭覆寫。 */
function fetchRange(url, partPath, {
  expectedSize, abortSignal, onProgress, slowCheck = false, redirectsLeft = MAX_REDIRECTS, httpsGet = https.get,
}) {
  return new Promise((resolve, reject) => {
    let start = sizeOf(partPath);
    if (start > expectedSize) { safeRemove(partPath); start = 0; }
    if (start === expectedSize) { resolve(); return; }
    if (abortSignal?.aborted) { reject(cancelledError()); return; }

    let settled = false;
    let request = null;
    let response = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      abortSignal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    const destroy = (error) => { response?.destroy(error); request?.destroy(error); };
    function onAbort() { const e = cancelledError(); finish(reject, e); destroy(e); }
    abortSignal?.addEventListener('abort', onAbort, { once: true });

    request = httpsGet(url, { headers: { 'User-Agent': 'Elitesand-Pro-AIRuntime-Provider', Range: `bytes=${start}-` } }, (res) => {
      response = res;
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) { finish(reject, new Error('重新導向次數過多')); return; }
        const next = new URL(res.headers.location, url).toString();
        abortSignal?.removeEventListener('abort', onAbort);
        settled = true;
        fetchRange(next, partPath, { expectedSize, abortSignal, onProgress, slowCheck, redirectsLeft: redirectsLeft - 1, httpsGet })
          .then(resolve, reject);
        return;
      }

      let flags = 'a';
      if (res.statusCode === 206) {
        const match = /bytes (\d+)-\d+\/(\d+)/.exec(res.headers['content-range'] || '');
        if (!match || Number(match[1]) !== start || Number(match[2]) !== expectedSize) {
          res.resume();
          finish(reject, new Error(`來源回傳的檔案範圍不符（${res.headers['content-range'] || '無'}）`));
          return;
        }
      } else if (res.statusCode === 200) {
        const length = Number.parseInt(res.headers['content-length'] || '', 10);
        if (Number.isFinite(length) && length !== expectedSize) {
          res.resume();
          finish(reject, new Error(`來源檔案大小不符（${length} bytes）`));
          return;
        }
        flags = 'w';
        start = 0;
      } else {
        res.resume();
        finish(reject, new Error(`下載失敗，HTTP ${res.statusCode}`));
        return;
      }

      let received = 0;
      const startedAt = Date.now();
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length;
          const elapsed = Math.max(1, Date.now() - startedAt);
          const speed = (received / elapsed) * 1000;
          if (slowCheck && elapsed > SLOW_CHECK_AFTER_MS && speed < SLOW_BYTES_PER_SEC) {
            callback(Object.assign(new Error('這個來源速度太慢，改試其他來源'), { code: 'SLOW' }));
            return;
          }
          const downloadedBytes = start + received;
          onProgress?.({ downloadedBytes, totalBytes: expectedSize, percent: (downloadedBytes / expectedSize) * 100, speedBytesPerSec: speed });
          callback(null, chunk);
        },
      });
      pipeline(res, meter, fs.createWriteStream(partPath, { flags }))
        .then(() => {
          const size = sizeOf(partPath);
          if (size === expectedSize) finish(resolve);
          else finish(reject, new Error(`連線提早結束（${size}/${expectedSize} bytes），可續傳`));
        })
        .catch((error) => finish(reject, error));
    });
    request.on('error', (error) => finish(reject, error));
    request.setTimeout(IDLE_TIMEOUT_MS, () => request.destroy(new Error('連線 30 秒沒有收到資料')));
  });
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

/**
 * 下載主分離模型到 modelDir。成功才把 .resume 改名成正式檔；失敗保留 .resume 讓下次續傳
 * （雜湊不符例外：那代表內容壞了，刪掉重來）。
 */
async function downloadPrimaryModelFile(modelDir, { abortSignal, onProgress, log, file = MODEL, httpsGet } = {}) {
  ensureSupportFiles(modelDir);
  const finalPath = path.join(modelDir, file.filename);
  const partPath = finalPath + RESUME_SUFFIX;
  const errors = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    for (let i = 0; i < file.sources.length; i++) {
      const source = file.sources[i];
      const hasAlternative = file.sources.length > 1;
      try {
        await fetchRange(source.url, partPath, {
          expectedSize: file.size,
          abortSignal,
          httpsGet,
          slowCheck: round === 0 && hasAlternative,
          onProgress: (p) => onProgress?.({ ...p, step: 'model-download', detail: `${file.filename}（${source.label}）` }),
        });
        onProgress?.({ step: 'model-verify', detail: file.filename, downloadedBytes: file.size, totalBytes: file.size, percent: 100 });
        const actual = await sha256File(partPath);
        if (actual !== file.sha256) {
          safeRemove(partPath);
          throw new Error(`檔案驗證失敗（SHA-256 不符），已刪除重新下載`);
        }
        fs.renameSync(partPath, finalPath);
        return { source: source.label };
      } catch (error) {
        if (error.code === 'CANCELLED' || abortSignal?.aborted) throw cancelledError();
        errors.push(`${source.label}：${error.message}`);
        log?.warn(`主分離模型從 ${source.label} 下載中斷（第 ${round + 1} 輪）：${error.message}`);
      }
    }
  }
  const error = new Error(`主分離模型所有下載來源都失敗，已下載的部分會保留，重試時接著下載。\n${errors.slice(-file.sources.length).join('\n')}`);
  error.code = 'ALL_SOURCES_FAILED';
  throw error;
}

module.exports = {
  MODEL,
  YAML_FILENAME,
  YAML_TEXT,
  YAML_SHA256,
  DOWNLOAD_CHECKS_FILENAME,
  DOWNLOAD_CHECKS_KEYS,
  RESUME_SUFFIX,
  ensureSupportFiles,
  fetchRange,
  downloadPrimaryModelFile,
};
