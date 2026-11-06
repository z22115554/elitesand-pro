/**
 * 練唱音高偵測（AudioWorklet，跑在音訊執行緒）：YIN，降到約 16kHz，1024 點視窗、每約 10ms 一格。
 * 與離線參考軌共用 65–1400 Hz 音域；44.1kHz 輸入實際降到 14.7kHz（視窗約 70ms）。
 * 只回傳音高、清晰度與音量，不錄音、不保留原始聲音。
 * time 是這一格視窗中心的 AudioContext 時間，主執行緒用播放時鐘換算成原曲秒數與當下的 Key。
 */
class PracticePitchDetector extends AudioWorkletProcessor {
  constructor() {
    super();
    this.factor = Math.max(1, Math.round(sampleRate / 16000));
    this.rate = sampleRate / this.factor;
    this.size = 1024;
    this.hop = Math.round(this.rate * 0.01);
    this.buf = new Float32Array(this.size * 2);
    this.n = 0; this.k = 0; this.sinceHop = 0;
    this.d = new Float32Array(this.size / 2);
    this.previousF0 = 0; this.previousClarity = 0; this.centerRms = 0;
    this.filterDelaySeconds = 0;
    if (this.factor > 1) {
      // 線性相位低通，在降採樣前擋住會折回人聲音域的高頻。係數與歷史只配置一次。
      const length = this.factor * 8 + 1, center = (length - 1) / 2;
      const cutoff = 0.4 / this.factor;
      this.kernel = new Float64Array(length);
      this.history = new Float32Array(length);
      this.historyIndex = 0;
      let sum = 0;
      for (let i = 0; i < length; i++) {
        const x = i - center;
        const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
        const window = .42 - .5 * Math.cos(2 * Math.PI * i / (length - 1)) + .08 * Math.cos(4 * Math.PI * i / (length - 1));
        this.kernel[i] = sinc * window; sum += this.kernel[i];
      }
      for (let i = 0; i < length; i++) this.kernel[i] /= sum;
      this.filterDelaySeconds = center / sampleRate;
    }
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const ch2 = inputs[0][1];
    for (let i = 0; i < ch.length; i++) {
      const input = ch2 ? (ch[i] + ch2[i]) * 0.5 : ch[i];
      let v = input;
      if (this.kernel) {
        this.history[this.historyIndex] = input;
        if (++this.historyIndex === this.history.length) this.historyIndex = 0;
      }
      if (++this.k < this.factor) continue;
      this.k = 0;
      if (this.kernel) {
        v = 0;
        let j = this.historyIndex;
        for (let tap = 0; tap < this.kernel.length; tap++) {
          if (--j < 0) j = this.history.length - 1;
          v += this.kernel[tap] * this.history[j];
        }
      }
      if (this.n === this.buf.length) { this.buf.copyWithin(0, this.size); this.n = this.size; }
      this.buf[this.n++] = v;
      if (++this.sinceHop >= this.hop && this.n >= this.size) {
        this.sinceHop = 0;
        const res = this.detect(this.buf.subarray(this.n - this.size, this.n));
        this.previousF0 = res.f0; this.previousClarity = res.clarity;
        // 回到原音訊的視窗中心，扣除低通的固定群延遲；不增加使用者的校準補償。
        const time = currentTime + (i + 1) / sampleRate - (this.size / 2) / this.rate - this.filterDelaySeconds;
        this.port.postMessage({ time, f0: res.f0, clarity: res.clarity, rms: res.rms, localClarity: res.localClarity || 0 });
      }
    }
    return true;
  }

  detect(x) {
    let e = 0;
    for (let i = 0; i < x.length; i++) e += x[i] * x[i];
    const rms = Math.sqrt(e / x.length);
    if (rms < 0.0006) return { f0: 0, clarity: 0, rms };
    const W = x.length / 2, d = this.d, minT = Math.max(2, Math.floor(this.rate / 1400)), maxT = Math.min(W - 1, Math.ceil(this.rate / 65));
    d[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= maxT; tau++) {
      let s = 0;
      // 兩個比較區段的共同中心須對齊回報時間；固定從 0 開始會把滑音估成十多毫秒前的音高。
      const first = (x.length - W - tau) >> 1;
      for (let i = first; i < first + W; i++) { const q = x[i] - x[i + tau]; s += q * q; }
      run += s; d[tau] = run > 0 ? s * tau / run : 1;
    }
    let best = -1;
    for (let tau = minT; tau < maxT; tau++) {
      if (d[tau] < 0.15) { while (tau + 1 < maxT && d[tau + 1] < d[tau]) tau++; best = tau; break; }
    }
    if (best < 0) {
      // 沒有點低於門檻：退而取全域最低點（YIN 原始做法），夠清楚才採用
      best = minT;
      for (let tau = minT + 1; tau < maxT; tau++) if (d[tau] < d[best]) best = tau;
      if (d[best] > 0.3 || best <= minT || best >= maxT - 1) return { f0: 0, clarity: 0, rms };
    }
    // 只比較本格實際支持的週期；前格只用來辨認歧義，不回填舊音或吸附參考軌。
    const ratio = this.previousF0 > 0 ? this.rate / best / this.previousF0 : 0;
    if (ratio > .45 && ratio < .55 && this.previousClarity > .8) {
      const middle = Math.round(best / 2);
      let upper = Math.max(minT + 1, middle - 3);
      for (let tau = upper + 1; tau <= Math.min(maxT - 1, middle + 3); tau++) if (d[tau] < d[upper]) upper = tau;
      if (d[upper] < d[upper - 1] && d[upper] < d[upper + 1] && d[upper] < .2 && d[upper] <= d[best] + .08
          && Math.abs(1200 * Math.log2(this.rate / upper / this.previousF0)) < 100
          && this.centerEvidence(x, upper) > .85) best = upper;
    }
    const a = d[best - 1], b = d[best], c = d[best + 1], den = a - 2 * b + c;
    const off = Math.abs(den) > 1e-9 ? Math.max(-1, Math.min(1, 0.5 * (a - c) / den)) : 0;
    const agreement = this.centerEvidence(x, best);
    if (agreement < .2) return { f0: 0, clarity: 0, rms };
    const f0 = this.rate / (best + off);
    // 短音／弱聲要有當下中心的週期與能量證據，不靠長視窗殘留的母音判定。
    if (rms < 0.002 && !(1 - b > .88 && agreement > .8 && this.centerRms >= .0006)) {
      return { f0: 0, clarity: 1 - b, rms, localClarity: Math.max(0, agreement) };
    }
    return { f0: f0 >= 65 && f0 <= 1400 ? f0 : 0, clarity: 1 - b, rms, localClarity: Math.max(0, agreement) };
  }

  centerEvidence(x, period) {
    const localSize = Math.round(this.rate * .02), localCount = Math.ceil(localSize / 2);
    const start = Math.floor((x.length - localSize - period) / 2);
    let leftSum = 0, rightSum = 0, leftPower = 0, rightPower = 0, cross = 0;
    for (let i = start; i < start + localSize; i += 2) {
      const left = x[i], right = x[i + period];
      leftSum += left; rightSum += right; leftPower += left * left; rightPower += right * right; cross += left * right;
    }
    const power = leftPower + rightPower - (leftSum * leftSum + rightSum * rightSum) / localCount;
    this.centerRms = Math.sqrt(Math.max(0, power) / (2 * localCount));
    return power > 1e-15 ? 2 * (cross - leftSum * rightSum / localCount) / power : 0;
  }
}

registerProcessor('practice-pitch-detector', PracticePitchDetector);
