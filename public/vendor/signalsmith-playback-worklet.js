import { SignalsmithStretch } from './signalsmith-stretch.js';
import './soundtouch-worklet.js';

// The existing transport still owns the output cursor and scheduled changes.
globalThis.prepareElitesandStretch = async function () {
  const [active, standby] = await Promise.all([SignalsmithStretch(), SignalsmithStretch()]);
  return new SignalsmithRenderer(new SignalsmithStream(active), new SignalsmithStream(standby));
};

class SignalsmithRenderer {
  constructor(active, standby) {
    this.active = active;
    this.standby = standby;
  }

  load(left, right, preserveFormants) {
    this.left = left;
    this.right = right;
    this.active.load(left, right, preserveFormants);
    this.standby.load(left, right, preserveFormants);
  }

  reset(position, pitch, tempo) {
    this.pitch = pitch;
    this.tempo = tempo;
    this.prefetchedPosition = Math.round(position);
    this.needsPreroll = true;
  }

  prepare(position, pitch, tempo, quanta) {
    if (pitch === 0 && tempo === 1) return;
    // Prime scheduled changes a little at a time, while the active stream
    // keeps playing. Both stems can then switch without two FFT bursts.
    const standby = this.standby;
    if (!standby.matches(position, pitch, tempo)) standby.begin(position, pitch, tempo);
    standby.prime(Math.ceil(standby.remaining / quanta));
  }

  extract(target, frames, position) {
    if (this.pitch === 0 && this.tempo === 1) {
      const start = Math.round(position);
      for (let i = 0; i < frames; i++) {
        target[2 * i] = this.left[start + i] ?? 0;
        target[2 * i + 1] = this.right[start + i] ?? 0;
      }
      this.prefetchedPosition = start + frames;
      return frames;
    }

    if (this.needsPreroll) {
      if (this.standby.matches(position, this.pitch, this.tempo)) {
        const previous = this.active;
        this.active = this.standby;
        this.standby = previous;
        this.standby.invalidate();
      } else {
        this.active.begin(position, this.pitch, this.tempo);
      }
      this.active.prime(this.active.remaining);
      this.needsPreroll = false;
    }
    this.active.render(target, frames, position);
    this.prefetchedPosition = this.active.inputHead;
    return frames;
  }
}

class SignalsmithStream {
  constructor(wasm) {
    this.wasm = wasm;
    // Preserve spectral overlap for accurate pitch. Bound the FFT size at
    // high sample rates and spread the steady computation across quanta.
    const windowFrames = Math.min(Math.round(sampleRate * 0.1), 4800);
    wasm._configure(2, windowFrames, Math.round(windowFrames / 4), true);
    this.inputLatency = wasm._inputLatency();
    this.outputLatency = wasm._outputLatency();
    this.seekFrames = wasm._blockSamples() + wasm._intervalSamples();
    this.capacity = Math.max(this.seekFrames, Math.ceil(this.outputLatency * 1.5) + 1);
    this.bufferOffset = wasm._setBuffers(2, this.capacity) / Float32Array.BYTES_PER_ELEMENT;
    this._refreshViews();
    this._warmUp();
  }

  _warmUp() {
    // Warm spectral/formant code on the unconnected node.
    const tone = new Float32Array(this.seekFrames * 2);
    for (let i = 0; i < tone.length; i++) tone[i] = 0.1 * Math.sin(2 * Math.PI * 220 * i / sampleRate);
    this.load(tone, tone, true);
    this.begin(this.seekFrames, 6, 1);
    this.prime(this.remaining);
    this.left = this.right = null;
    this.invalidate();
  }

  load(left, right, preserveFormants) {
    this.left = left;
    this.right = right;
    this.preserveFormants = preserveFormants;
  }

  _refreshViews() {
    const buffer = this.wasm.HEAP8.buffer;
    if (buffer === this.buffer) return;
    this.buffer = buffer;
    const heap = new Float32Array(buffer);
    const offset = this.bufferOffset, capacity = this.capacity;
    this.inputLeft = heap.subarray(offset, offset + capacity);
    this.inputRight = heap.subarray(offset + capacity, offset + capacity * 2);
    this.outputLeft = heap.subarray(offset + capacity * 2, offset + capacity * 3);
    this.outputRight = heap.subarray(offset + capacity * 3, offset + capacity * 4);
  }

  _copyInput(start, frames) {
    // Pad with silence beyond the source bounds, with no per-quantum views.
    for (let i = 0; i < frames; i++) {
      this.inputLeft[i] = this.left[start + i] ?? 0;
      this.inputRight[i] = this.right[start + i] ?? 0;
    }
  }

  _processTo(position, frames) {
    const inputEnd = Math.round(position) + this.inputLatency;
    const inputFrames = inputEnd - this.inputHead;
    this._copyInput(this.inputHead, inputFrames);
    this.wasm._process(inputFrames, frames);
    this.inputHead = inputEnd;
    this._refreshViews();
  }

  matches(position, pitch, tempo) {
    return Math.abs(this.start - position) < 0.0001 && this.pitch === pitch && this.tempo === tempo;
  }

  invalidate() { this.start = NaN; }

  begin(position, pitch, tempo) {
    const wasm = this.wasm;
    this.start = position;
    this.pitch = pitch;
    this.tempo = tempo;
    this.remaining = this.outputLatency;
    wasm._reset();
    wasm._setTransposeSemitones(pitch, 8000 / sampleRate);
    wasm._setFormantSemitones(0, this.preserveFormants && pitch !== 0);
    this._refreshViews();
    this.inputHead = Math.round(position) + this.inputLatency;
    this._copyInput(this.inputHead - this.seekFrames, this.seekFrames);
    wasm._seek(this.seekFrames, tempo);
  }

  prime(frames) {
    if (!frames) return;
    this.remaining -= frames;
    this._processTo(this.start + (this.outputLatency - this.remaining) * this.tempo, frames);
  }

  render(target, frames, position) {
    this._processTo(position + (this.outputLatency + frames) * this.tempo, frames);
    for (let i = 0; i < frames; i++) {
      target[2 * i] = this.outputLeft[i];
      target[2 * i + 1] = this.outputRight[i];
    }
  }
}
