#!/usr/bin/env python3
"""Optional real singing benchmark against Vocadito v3's human F0 labels.

Fetch https://zenodo.org/records/5578807 (CC BY 4.0), verify the published
archive MD5 dea40fd18f14d899643c4ba221b33a46, and pass its extracted directory.
No downloading, uploading, or redistribution is performed by this tool.
Requires NumPy and FFmpeg; torchcrepe is optional and fails explicitly
when requested but absent. Each model extraction runs in a fresh process.
"""
import argparse
import csv
import hashlib
import importlib.util
import importlib.metadata
import inspect
import json
from pathlib import Path
import subprocess
import sys
import time

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def load_worker(filename):
    spec = importlib.util.spec_from_file_location('benchmark_worker', filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module



def input_paths(args, track):
    if not args.manifest:
        return (args.dataset / 'Audio' / f'vocadito_{track}.wav',
                args.dataset / 'Annotations/F0' / f'vocadito_{track}_f0.csv', None)
    manifest = json.loads(args.manifest.read_text())
    item = next(t for t in manifest['tracks'] if t['id'] == track)
    paths = [(args.dataset / item[k]).resolve() for k in ('audio', 'f0')]
    if any(not p.is_relative_to(args.dataset.resolve()) for p in paths):
        raise ValueError('Manifest inputs must stay inside the dataset directory')
    return *paths, item.get('annotationFormat')


def read_annotation(filename, format=None):
    if format == 'vocalset-raw':
        rows = list(csv.reader(filename.open(encoding='utf-8-sig')))[1:]
        result = np.asarray([[float(r[0]), float(r[1])] for r in rows if r and r[0].strip()])
    else:
        result = np.loadtxt(filename, delimiter=',')
    if (result.ndim != 2 or result.shape[1] != 2 or not len(result) or not np.all(np.isfinite(result))
            or np.any(result < 0) or np.any(np.diff(result[:, 0]) <= 0)):
        raise ValueError(f'Invalid time/F0 annotations: {filename}')
    return result


def decode(filename, rate):
    result = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(filename), '-ac', '1', '-ar', str(rate),
                             '-f', 'f32le', 'pipe:1'], check=True, capture_output=True)
    return np.frombuffer(result.stdout, dtype='<f4').copy()


def labels_at(annotation, times):
    # Nearest-neighbour, never interpolate a voiced pitch through a labelled rest.
    right = np.clip(np.searchsorted(annotation[:, 0], times), 0, len(annotation) - 1)
    left = np.maximum(0, right - 1)
    indices = np.where(abs(annotation[left, 0] - times) <= abs(annotation[right, 0] - times), left, right)
    return annotation[indices, 1]


def metrics(expected, hz):
    voice = expected > 0
    supported = voice & (expected >= 65) & (expected <= 1400)
    detected = hz > 0
    error = np.zeros(len(hz))
    both = supported & detected
    error[both] = 1200 * np.log2(hz[both] / expected[both])
    return {'frames': len(hz), 'referenceVoiced': int(voice.sum()), 'supportedVoiced': int(supported.sum()),
            'referenceUnvoiced': int((~voice).sum()), 'unsupportedVoiced': int((voice & ~supported).sum()),
            'missedVoiced': int((supported & ~detected).sum()),
            'falseVoiced': int((~voice & detected).sum()),
            'within50c': int((both & (abs(error) <= 50)).sum()),
            'within75c': int((both & (abs(error) <= 75)).sum()),
            'over220c': int((both & (abs(error) >= 220)).sum()),
            'lowOctave': int((both & (abs(error + 1200) <= 100)).sum()),
            'highOctave': int((both & (abs(error - 1200) <= 100)).sum())}


def note_metrics(notes, annotation, tuning):
    times, expected = annotation.T
    hz = np.zeros(len(times))
    for note in notes:
        # The engine subtracts tuning from the observed singer, so compare the
        # physical target (quantized MIDI + global tuning) with human F0 truth.
        hz[(times >= note['start']) & (times < note['end'])] = 440 * 2 ** ((note['midi'] + tuning - 69) / 12)
    return metrics(expected, hz)


def report_track(args):
    worker = load_worker(ROOT / 'ai/pitch_guide_worker.py')
    old = load_worker(args.baseline) if args.baseline else worker
    filename, annotation_file, format = input_paths(args, args.track)
    annotation = read_annotation(annotation_file, format)
    audio = decode(filename, 16000)
    audio_hash = hashlib.sha256(filename.read_bytes()).hexdigest()
    # Cache only detector observations, never the clean/cut result under test.
    signature = hashlib.sha256((inspect.getsource(worker.yin_track) + inspect.getsource(worker.crepe_track)
                                + inspect.getsource(worker.extract) + inspect.getsource(worker.frame_rms)
                                + str((worker.MIN_HZ, worker.MAX_HZ, worker.SAMPLE_RATE, worker.HOP))
                                + 'benchmark-dither-seed=0'
                                + str([(p, importlib.metadata.version(p)) for p in
                                       (['numpy', 'torch', 'torchcrepe'] if args.algorithm == 'torchcrepe' else ['numpy'])])).encode()).hexdigest()
    raw_file = args.cache / f'{args.track}-{args.algorithm}-observations.npz' if args.cache else None
    started = time.perf_counter()
    cached = False
    if raw_file and raw_file.exists():
        with np.load(raw_file, allow_pickle=False) as raw:
            if str(raw['audioHash']) == audio_hash and str(raw['signature']) == signature:
                frequency, confidence, rms = [raw[key] for key in ('frequency', 'confidence', 'rms')]
                method, threshold, extraction = str(raw['method']), float(raw['threshold']), float(raw['extraction'])
                cached = True
    if not cached:
        np.random.seed(0)  # benchmark-only: torchcrepe frequency conversion uses SciPy dither
        frequency, confidence, rms, method, fallback, threshold = worker.extract(audio, args.algorithm, progress=False)
        extraction = time.perf_counter() - started
        if fallback:
            raise RuntimeError(f'Unexpected fallback: {fallback}')
        if raw_file:
            raw_file.parent.mkdir(parents=True, exist_ok=True)
            np.savez(raw_file, frequency=frequency, confidence=confidence, rms=rms, method=method,
                     threshold=threshold, extraction=extraction, audioHash=audio_hash, signature=signature)
    times = np.arange(len(frequency)) * .01
    row = {'id': args.track, 'algorithm': method, 'audioSeconds': len(audio) / 16000,
           'audioSha256': audio_hash, 'extractorSha256': signature, 'usedRawCache': cached,
           'annotationSha256': hashlib.sha256(annotation_file.read_bytes()).hexdigest(),
           'extractionSeconds': extraction, 'versions': {}}
    # Deliberately one line spanning the entire excerpt: lyric text is untimed.
    # This exercises breaths *inside* a lyric window, not perfect manual note cuts.
    windows = [(0, 0, 0, len(audio) / 16000)]
    for version, module in [('before', old), ('after', worker)]:
        energy_start = time.perf_counter()
        rms = module.frame_rms(audio, len(frequency))
        energy_seconds = time.perf_counter() - energy_start
        start = time.perf_counter()
        if hasattr(module, 'voicing_features'):
            rms, periodicity = module.voicing_features(audio, frequency, confidence, rms, threshold, method)
            midi, voiced = module.voiced_midi(frequency, confidence, rms, threshold, periodicity)
        else:
            midi, voiced = module.voiced_midi(frequency, confidence, rms, threshold)
        arguments = {'frequency': frequency, 'rms': rms} if 'frequency' in inspect.signature(module.clean).parameters else {}
        tuning = module.clean(midi, voiced, confidence, threshold, **arguments)
        note_arguments = {'confidence': confidence if method == 'yin-cpu' else None, 'min_confidence': threshold} if 'confidence' in inspect.signature(module.cut_notes).parameters else {}
        notes = module.cut_notes(midi, voiced, windows, tuning, **note_arguments)
        notes_elapsed = time.perf_counter() - start
        hz = np.where(voiced, 440 * 2 ** ((midi - 69) / 12), 0)
        row['versions'][version] = {'contour': metrics(labels_at(annotation, times), hz),
                                    'notes': note_metrics(notes, annotation, tuning), 'noteCount': len(notes),
                                    'energySeconds': energy_seconds, 'postprocessSeconds': notes_elapsed, 'tuningSemitones': tuning}
        if args.cache:
            args.cache.mkdir(parents=True, exist_ok=True)
            guide = {'duration': len(audio) / 16000, 'tuning': tuning, 'notes': notes,
                     'lines': [{'start': 0, 'end': len(audio) / 16000, 'text': 'untimed excerpt', 'words': []}]}
            (args.cache / f'{args.track}-{args.algorithm}-{version}.json').write_text(json.dumps(guide))
    print(json.dumps(row, allow_nan=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, help='Optional external dataset manifest with relative audio/F0 paths')
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--cache', type=Path)
    parser.add_argument('--ids', help='Comma-separated IDs; defaults to all metadata tracks')
    parser.add_argument('--algorithms', nargs='+', default=['yin', 'torchcrepe'], choices=['yin', 'torchcrepe'])
    parser.add_argument('--track', type=int, help=argparse.SUPPRESS)
    parser.add_argument('--algorithm', choices=['yin', 'torchcrepe'], help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.track is not None:
        return report_track(args)
    args.dataset = args.dataset.resolve()
    manifest = json.loads(args.manifest.read_text()) if args.manifest else None
    metadata = ({r['id']: r.get('metadata', {}) for r in manifest['tracks']} if manifest else
                {int(r['track_id']): r for r in csv.DictReader((args.dataset / 'vocadito_metadata.csv').open())})
    ids = [int(i) for i in args.ids.split(',')] if args.ids else sorted(metadata)
    rows = []
    for algorithm in args.algorithms:
        for track in ids:
            command = [sys.executable, str(Path(__file__).resolve()), '--dataset', str(args.dataset),
                       '--track', str(track), '--algorithm', algorithm]
            if args.baseline:
                command += ['--baseline', str(args.baseline.resolve())]
            if args.cache:
                command += ['--cache', str(args.cache.resolve())]
            if args.manifest:
                command += ['--manifest', str(args.manifest.resolve())]
            result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=180)
            row = json.loads(result.stdout)
            row['metadata'] = metadata[track]
            rows.append(row)
            report = {'dataset': manifest['dataset'] if manifest else 'Vocadito v3',
                      'doi': manifest['doi'] if manifest else '10.5281/zenodo.5578807',
                      'license': manifest.get('license', 'unspecified') if manifest else 'CC BY 4.0',
                      'scope': manifest['scope'] if manifest else 'Real solo singing excerpts; human F0 truth. Untimed lyrics, one test window per excerpt.',
                      'rows': rows}
            if args.output:
                args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
            print(f'{algorithm} {track}: before/after note coverage '
                  f'{row["versions"]["before"]["notes"]["missedVoiced"]}/'
                  f'{row["versions"]["after"]["notes"]["missedVoiced"]} missed frames', file=sys.stderr, flush=True)
    if not args.output:
        print(json.dumps(report, indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
