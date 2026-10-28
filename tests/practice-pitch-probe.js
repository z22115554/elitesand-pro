'use strict';
// 測試專用的音高量測：用 YIN 量一段（合成正弦波的）輸出音訊是什麼音，驗證 SoundTouch 升降 Key／收尾有沒有算對。
// 只給測試用，不是產品裡的偵測器（產品在 public/js/practice/pitch-detector-worklet.js）。

function detectPitch(samples, sampleRate) {
  const size = Math.min(samples.length, 4096), half = size >> 1;
  const d = new Float64Array(half);
  for (let tau = 1; tau < half; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) { const x = samples[i] - samples[i + tau]; sum += x * x; }
    d[tau] = sum;
  }
  // 累積平均正規化，取第一個低於門檻的谷底，再用拋物線內插到次取樣精度
  let running = 0, best = -1;
  for (let tau = 1; tau < half; tau++) {
    running += d[tau]; d[tau] = running ? d[tau] * tau / running : 1;
  }
  for (let tau = 2; tau < half - 1; tau++) {
    if (d[tau] < 0.15) { while (tau + 1 < half && d[tau + 1] < d[tau]) tau++; best = tau; break; }
  }
  if (best < 0) return { voiced: false, midi: 0 };
  const a = d[best - 1], b = d[best], c = d[best + 1];
  const shift = (a - 2 * b + c) ? (a - c) / (2 * (a - 2 * b + c)) : 0;
  const hz = sampleRate / (best + shift);
  return { voiced: true, hz, midi: 69 + 12 * Math.log2(hz / 440) };
}

const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

module.exports = { detectPitch, midiToHz };
