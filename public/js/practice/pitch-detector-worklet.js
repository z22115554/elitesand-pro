/**
 * 練唱音高偵測（AudioWorklet，跑在音訊執行緒）：YIN，降到約 16kHz，視窗 64ms、每 10ms 一格。
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
    this.n = 0; this.acc = 0; this.k = 0; this.sinceHop = 0;
    this.d = new Float32Array(this.size / 2);
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const ch2 = inputs[0][1];
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch2 ? (ch[i] + ch2[i]) * 0.5 : ch[i];
      if (++this.k < this.factor) continue;
      const v = this.acc / this.factor; this.acc = 0; this.k = 0;
      if (this.n === this.buf.length) { this.buf.copyWithin(0, this.size); this.n = this.size; }
      this.buf[this.n++] = v;
      if (++this.sinceHop >= this.hop && this.n >= this.size) {
        this.sinceHop = 0;
        const res = this.detect(this.buf.subarray(this.n - this.size, this.n));
        const time = currentTime + (i - ch.length) / sampleRate - (this.size / 2) / this.rate;
        this.port.postMessage({ time, f0: res.f0, clarity: res.clarity, rms: res.rms });
      }
    }
    return true;
  }

  detect(x) {
    let e = 0;
    for (let i = 0; i < x.length; i++) e += x[i] * x[i];
    const rms = Math.sqrt(e / x.length);
    if (rms < 0.002) return { f0: 0, clarity: 0, rms };
    const W = x.length / 2, d = this.d, minT = Math.floor(this.rate / 1000), maxT = Math.min(W - 1, Math.ceil(this.rate / 70));
    d[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= maxT; tau++) {
      let s = 0;
      for (let i = 0; i < W; i++) { const q = x[i] - x[i + tau]; s += q * q; }
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
    const a = d[best - 1], b = d[best], c = d[best + 1], den = a - 2 * b + c;
    const off = Math.abs(den) > 1e-9 ? Math.max(-1, Math.min(1, 0.5 * (a - c) / den)) : 0;
    return { f0: this.rate / (best + off), clarity: 1 - b, rms };
  }
}

registerProcessor('practice-pitch-detector', PracticePitchDetector);
