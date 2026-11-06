#!/usr/bin/env python3
"""Reproducible offline acoustic report; optional argv[1] selects an unmodified baseline worker."""
import importlib.util
import json
from pathlib import Path
import sys
import time
import numpy as np

filename = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / 'ai/pitch_guide_worker.py'
spec = importlib.util.spec_from_file_location('measured_pitch_worker', filename)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
rows = []
started = time.perf_counter()
for frequency in (65.406, 82.4069, 130.81, 261.63, 440, 523.25, 880, 987.77, 1046.5, 1100, 1174.66, 1318.51):
    for scenario in ('sine', 'harmonics', 'weakFundamental', 'envelope', 'noise', 'vibrato', 'glide', 'falsettoLike', 'bleed', 'short'):
        seconds = .25 if scenario == 'short' else 1.
        t = np.arange(round(seconds * worker.SAMPLE_RATE)) / worker.SAMPLE_RATE
        frequencies = np.full(len(t), frequency, dtype=np.float64)
        if scenario == 'vibrato':
            frequencies *= 2 ** (.3 * np.sin(2 * np.pi * 6 * t) / 12)
        if scenario == 'glide':
            frequencies *= 2 ** ((t - .5) * 1.5 / 12)
        phase = 2 * np.pi * np.cumsum(frequencies) / worker.SAMPLE_RATE
        harmonics = {'harmonics': [1, .6, .35, .2], 'weakFundamental': [.25, 1, .4, .2],
                     'falsettoLike': [1, .12, .04], 'bleed': [1, .7, .2]}.get(scenario, [1])
        audio = .18 * sum(amplitude * np.sin((k + 1) * phase) for k, amplitude in enumerate(harmonics))
        if scenario == 'envelope':
            audio *= .08 + .92 * np.sin(np.pi * t) ** 2
        if scenario in ('noise', 'falsettoLike'):
            audio += np.random.default_rng(42).uniform(-1, 1, len(t)) * (.18 if scenario == 'noise' else .015)
        if scenario == 'bleed':
            audio += .035 * (np.sin(2 * np.pi * 196 * t) + .5 * np.sin(2 * np.pi * 293.66 * t))
        before = time.perf_counter()
        f0, confidence, rms = worker.yin_track(audio.astype(np.float32), progress=False)
        if hasattr(worker, 'voicing_features'):
            rms, periodicity = worker.voicing_features(audio.astype(np.float32), f0, confidence, rms, .8, 'yin-cpu')
            midi, voiced = worker.voiced_midi(f0, confidence, rms, .8, periodicity)
        else:
            midi, voiced = worker.voiced_midi(f0, confidence, rms, .8)
        elapsed = time.perf_counter() - before
        times = np.arange(len(f0)) * worker.HOP_SECONDS
        use = (times >= (.08 if scenario == 'short' else .18)) & (times < seconds - .04)
        expected = np.interp(times[use], t, frequencies)
        errors = 1200 * np.log2(np.maximum(f0[use], 1e-15) / expected)
        valid = voiced[use]
        rows.append({'f': frequency, 'scenario': scenario, 'frames': int(use.sum()),
                     'hz': float(np.median(f0[use][valid])) if np.any(valid) else 0,
                     'midi': float(np.median(midi[use][valid])) if np.any(valid) else 0,
                     'cents': float(np.median(errors[valid])) if np.any(valid) else None,
                     'correct': float(np.mean(valid & (np.abs(errors) <= 50))),
                     'voiced': float(np.mean(valid)), 'highOctave': float(np.mean(valid & (np.abs(errors - 1200) <= 100))),
                     'lowOctave': float(np.mean(valid & (np.abs(errors + 1200) <= 100))), 'unvoiced': float(np.mean(~valid)),
                     'meanFrameMs': elapsed * 1000 / len(f0)})

# Exactly the same pitch/voicing observations can describe a real short octave phrase.
midi = np.concatenate([np.full(100, 60.), np.zeros(20), np.full(60, 72.), np.zeros(20), np.full(100, 60.)])
voiced = midi > 0
worker.clean(midi, voiced)
print(json.dumps({'syntheticOnly': True, 'file': str(filename), 'algorithmVersion': worker.ALGORITHM_VERSION,
                  'sampleRate': worker.SAMPLE_RATE, 'wallSeconds': time.perf_counter() - started,
                  'breathSeparatedPhraseMidi': [float(np.median(midi[a:b])) for a, b in [(0, 100), (120, 180), (200, 300)]],
                  'rows': rows}, indent=2))
