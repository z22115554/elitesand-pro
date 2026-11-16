// Song-sized CPU buffers have a fixed admission budget. This is not a free
// VRAM estimate: model/GPU admission still uses the existing canary.
export const AUDIO_SAMPLE_RATE = 44100;
export const MAX_AUDIO_SECONDS = 600;
export const MAX_ENCODED_AUDIO_BYTES = 96 * 1024 * 1024;

function audioError(code, message) { return Object.assign(new Error(message), { code }); }

export function assertAudioSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw audioError('invalid_audio', '無法確認音檔長度，改用 CPU 處理');
  if (seconds > MAX_AUDIO_SECONDS) throw audioError('input_too_large', '音檔超過 WebGPU 長度上限，改用 CPU 處理');
  return seconds;
}

export function assertEncodedAudioBytes(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_ENCODED_AUDIO_BYTES) {
    throw audioError('input_too_large', '音檔超過 WebGPU 大小上限，改用 CPU 處理');
  }
}

export async function readBoundedAudio(response) {
  const advertised = response.headers?.get('content-length');
  if (advertised !== null && advertised !== undefined) {
    try { assertEncodedAudioBytes(Number(advertised)); }
    catch (error) { try { await response.body?.cancel?.(); } catch (_) {} throw error; }
  }
  // An arrayBuffer() fallback would remove the body-size boundary.
  const reader = response.body?.getReader?.();
  if (!reader) throw audioError('invalid_audio', '無法安全讀取音檔，改用 CPU 處理');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      assertEncodedAudioBytes(size);
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch (_) {}
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

export function normalizePeakInPlace(input, maxPeak = 0.9, minPeak) {
  let peak = 0;
  for (let i = 0; i < input.length; i++) peak = Math.max(peak, Math.abs(input[i]));
  let scale = 1;
  if (peak > maxPeak) scale = maxPeak / peak;
  else if (peak > 0 && minPeak !== undefined && peak < minPeak) scale = minPeak / peak;
  if (scale !== 1) for (let i = 0; i < input.length; i++) input[i] *= scale;
  return input;
}

export function subtractInPlace(mixture, rawVocals) {
  for (let i = 0; i < mixture.length; i++) mixture[i] -= rawVocals[i];
  return mixture;
}

export function finalizeStereoOverlapInPlace(target, monoCounter) {
  for (let channel = 0; channel < 2; channel++) {
    const offset = channel * monoCounter.length;
    for (let i = 0; i < monoCounter.length; i++) target[offset + i] /= Math.max(monoCounter[i], 1e-10);
  }
  return target;
}
