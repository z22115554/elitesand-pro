/** A bounded, effective-state audio clock. All times are AudioContext seconds. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PracticeClock = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

  class Timeline {
    constructor(options = {}) {
      this.maxSegments = clamp(Math.floor(finite(options.maxSegments, 4096)), 8, 16384);
      this.maxExtrapolationSeconds = clamp(finite(options.maxExtrapolationSeconds, 0.5), 0.02, 10);
      this.duration = finite(options.duration, Infinity);
      this.latencies = {
        inputLatencySec: clamp(finite(options.inputLatencySec, 0), 0, 2),
        outputLatencySec: clamp(finite(options.outputLatencySec, 0), 0, 2),
        dspLatencySec: clamp(finite(options.dspLatencySec, 0), 0, 2),
        calibrationMs: clamp(finite(options.calibrationMs, 0), -2000, 2000),
      };
      this.reset();
    }

    reset() {
      this.segments = [];
      this.generation = 0;
      this.droppedRecords = 0;
    }

    setLatencies(values = {}) {
      for (const key of Object.keys(this.latencies)) {
        if (!Number.isFinite(values[key])) continue;
        this.latencies[key] = key === 'calibrationMs'
          ? clamp(values[key], -2000, 2000) : clamp(values[key], 0, 2);
      }
    }

    record(state = {}) {
      const audioTime = finite(state.audioTime,
        Number.isFinite(state.frame) && state.sampleRate > 0 ? state.frame / state.sampleRate : NaN);
      const sourceTime = finite(state.sourceTime, finite(state.position, NaN));
      if (!Number.isFinite(audioTime) || audioTime < 0 || !Number.isFinite(sourceTime) || sourceTime < 0) return false;
      const previous = this.segments[this.segments.length - 1];
      // A delayed old acknowledgement must not rewrite a newer effective state.
      if (previous && audioTime < previous.audioTime - 1e-7) { this.droppedRecords++; return false; }
      const key = clamp(finite(state.key, finite(state.pitchShift, previous ? previous.key : 0)), -12, 12);
      const tempo = clamp(finite(state.tempo, finite(state.playbackRate, previous ? previous.tempo : 1)), 0.5, 1.5);
      const playing = state.playing === undefined ? !!(previous && previous.playing) : state.playing === true;
      const explicitGeneration = Number.isSafeInteger(state.generation) && state.generation >= 0;
      let generation = explicitGeneration ? state.generation : this.generation;
      const boundary = /^(seek|track|reset|loop|load)$/.test(state.reason || '');
      if (!explicitGeneration && boundary) generation++;
      if (previous && !explicitGeneration && !boundary) {
        const expected = previous.sourceTime + (previous.playing ? (audioTime - previous.audioTime) * previous.tempo : 0);
        if (Math.abs(sourceTime - expected) > 0.35) generation++;
      }
      if (previous && explicitGeneration && generation < previous.generation) { this.droppedRecords++; return false; }
      this.generation = generation;
      const segment = { audioTime, sourceTime, key, tempo, playing, generation, reason: String(state.reason || 'position') };
      if (previous && Math.abs(audioTime - previous.audioTime) <= 1e-7) this.segments[this.segments.length - 1] = segment;
      else this.segments.push(segment);
      if (this.segments.length > this.maxSegments) this.segments.splice(0, this.segments.length - this.maxSegments);
      return true;
    }

    map(audioTime, options = {}) {
      if (!Number.isFinite(audioTime)) return { valid: false, reason: 'invalid-time' };
      const latency = { ...this.latencies };
      for (const key of Object.keys(latency)) if (Number.isFinite(options[key])) latency[key] = options[key];
      const correction = clamp(latency.inputLatencySec, 0, 2) + clamp(latency.outputLatencySec, 0, 2)
        + clamp(latency.dspLatencySec, 0, 2) + clamp(latency.calibrationMs, -2000, 2000) / 1000;
      const effectiveTime = audioTime - correction;
      let lo = 0, hi = this.segments.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (this.segments[mid].audioTime <= effectiveTime + 1e-9) lo = mid + 1; else hi = mid;
      }
      if (lo === 0) return { valid: false, reason: 'before-history', audioTime, effectiveTime };
      const segment = this.segments[lo - 1];
      const delta = Math.max(0, effectiveTime - segment.audioTime);
      const newest = lo === this.segments.length;
      if (segment.playing && newest && delta > this.maxExtrapolationSeconds) {
        return { valid: false, reason: 'stale-clock', audioTime, effectiveTime, generation: segment.generation };
      }
      return {
        valid: true, audioTime, effectiveTime,
        sourceTime: clamp(segment.sourceTime + (segment.playing ? delta * segment.tempo : 0), 0, this.duration),
        key: segment.key, tempo: segment.tempo, playing: segment.playing,
        generation: segment.generation, correctionSeconds: correction,
      };
    }

    getSnapshot() {
      return { generation: this.generation, segments: this.segments.length,
        droppedRecords: this.droppedRecords, last: this.segments.length ? { ...this.segments[this.segments.length - 1] } : null };
    }
  }

  return { Timeline, createTimeline: (options) => new Timeline(options) };
});
