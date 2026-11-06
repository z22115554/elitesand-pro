#!/usr/bin/env python3
"""Opt-in, public-data acoustic benchmark. Does not upload audio or modify git refs."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
import urllib.error
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[2]


def request(url, headers=None):
    for attempt in range(4):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=30)
        except urllib.error.HTTPError as error:
            if error.code not in (429, 502, 503, 504) or attempt == 3:
                raise
        except urllib.error.URLError:
            if attempt == 3:
                raise
        time.sleep(2 ** attempt)


def record(number):
    with request(f'https://zenodo.org/api/records/{number}') as response:
        data = json.load(response)
    if data['metadata'].get('license', {}).get('id') != 'cc-by-4.0':
        raise ValueError(f'Unexpected dataset license: {number}')
    return data


class RemoteZip(io.RawIOBase):
    def __init__(self, item, directory_cache=None):
        self.url, self.size, self.pos = item['links']['self'], item['size'], 0
        self.cache_start, self.cache = directory_cache or (0, b'')

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        return self.pos

    def read(self, count=-1):
        count = self.size - self.pos if count < 0 else min(count, self.size - self.pos)
        if count <= 0:
            return b''
        if self.cache_start <= self.pos and self.pos + count <= self.cache_start + len(self.cache):
            data = self.cache[self.pos - self.cache_start:self.pos - self.cache_start + count]
            self.pos += count
            return data
        size = min(max(count, 131072), self.size - self.pos)
        with request(self.url, {'Range': f'bytes={self.pos}-{self.pos + size - 1}'}) as response:
            if response.status != 206:
                raise RuntimeError('Public archive does not support byte ranges; full download was not attempted')
            data = response.read(size + 1)
        if len(data) != size:
            raise RuntimeError('Truncated archive range')
        self.cache_start, self.cache = self.pos, data
        self.pos += count
        return data[:count]


def prepare_vocadito(folder):
    data = record(5578807)
    item = next(f for f in data['files'] if f['key'] == 'vocadito.zip')
    archive = folder / 'vocadito.zip'
    with request(item['links']['self']) as response, archive.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    digest = hashlib.md5(archive.read_bytes()).hexdigest()
    if digest != 'dea40fd18f14d899643c4ba221b33a46':
        raise ValueError('Vocadito archive checksum mismatch')
    destination = folder / 'vocadito'
    with zipfile.ZipFile(archive) as source:
        for info in source.infolist():
            path = Path(info.filename)
            if path.is_absolute() or '..' in path.parts:
                raise ValueError('Unsafe archive path')
        source.extractall(destination)
    return destination


def prepare_vocalset(folder, validation=False):
    data = record(10200775)
    item = next(f for f in data['files'] if f['key'] == 'VocalSet.zip')
    destination = folder / ('vocalset-validation' if validation else 'vocalset')
    destination.mkdir(exist_ok=True)
    stems = (['f2_scales_breathy_a', 'f5_arpeggios_breathy_a', 'f6_scales_belt_a',
              'f8_scales_vibrato_a', 'f4_arpeggios_c_fast_piano_a',
              'm2_arpeggios_breathy_a', 'm4_scales_breathy_a', 'm5_scales_vibrato_a',
              'm6_arpeggios_belt_a', 'm8_scales_c_fast_forte_a'] if validation else
             ['f1_row_straight', 'f3_dona_vibrato', 'f7_row_straight', 'f9_dona_vibrato',
             'm1_row_straight', 'm3_dona_vibrato', 'm7_row_straight', 'm9_dona_vibrato',
             'f2_scales_c_fast_piano_a', 'f4_scales_c_fast_piano_a'])
    members, tracks = [], []
    index = RemoteZip(item)
    index.seek(max(0, item['size'] - 2 * 1024 * 1024))
    index.read(2 * 1024 * 1024)
    directory_cache = index.cache_start, index.cache
    with zipfile.ZipFile(index) as source:
        names = source.namelist()
    def extract_track(pair):
        index, stem = pair
        extracted = []
        # Each worker owns its seek position/cache. Never share a RemoteZip
        # between downloads, and never fetch the complete 2.5GB archive.
        with zipfile.ZipFile(RemoteZip(item, directory_cache)) as source:
            selected = [
                (next(n for n in names if '/FULL/' in n and n.endswith('/' + stem + '.wav')), stem + '.wav'),
                (next(n for n in names if n.startswith('VocalSet/annotations/raw 4/csv/') and n.endswith('/' + stem + '.csv')), stem + '-f0.csv'),
                (next(n for n in names if n.startswith('VocalSet/annotations/extended 4/with file header/') and n.endswith('/' + stem + '.csv')), stem + '-notes.csv'),
            ]
            for name, local in selected:
                info = source.getinfo(name)
                target = destination / local
                raw = target.read_bytes() if target.exists() else b''
                if zlib.crc32(raw) != info.CRC:
                    raw = source.read(name)
                if zlib.crc32(raw) != info.CRC:
                    raise ValueError('Archive member CRC mismatch')
                target.write_bytes(raw)
                extracted.append({'member': name, 'local': local, 'crc32': f'{info.CRC:08x}',
                                'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)})
        return extracted, {'id': index, 'audio': stem + '.wav', 'f0': stem + '-f0.csv',
                           'annotationFormat': 'vocalset-raw', 'metadata': {'name': stem}}
    with ThreadPoolExecutor(max_workers=2) as pool:
        for extracted, track in pool.map(extract_track, enumerate(stems, 1)):
            members.extend(extracted)
            tracks.append(track)
    manifest = {'dataset': 'VocalSet revised annotations 10200775', 'doi': '10.5281/zenodo.10200775',
                'license': 'CC BY 4.0', 'scope': 'External professional singing; corrected published annotations include algorithm-derived F0, not wholly manual truth.',
                'validationMaterial': validation,
                'tracks': tracks, 'members': members, 'wholeZipChecksumVerified': False,
                'publishedZipChecksum': item['checksum']}
    manifest_file = destination / 'manifest.json'
    manifest_file.write_text(json.dumps(manifest, indent=2))
    return destination, manifest_file


def run(args, output=None, env=None):
    if output:
        with output.open('w') as target:
            subprocess.run(args, cwd=ROOT, stdout=target, check=True, env=env)
    else:
        subprocess.run(args, cwd=ROOT, check=True, env=env)


def aggregate(rows, method, version):
    metrics = [r['versions'][version]['notes'] for r in rows if r['algorithm'] == method]
    total = {k: sum(m[k] for m in metrics) for k in metrics[0]}
    return {key: 100 * total[field] / total[denominator] for key, field, denominator in
            [('falseTargetPercent', 'falseVoiced', 'referenceUnvoiced'),
             ('missedTargetPercent', 'missedVoiced', 'supportedVoiced'),
             ('within75cPercent', 'within75c', 'supportedVoiced')]}


def aggregate_live(rows, method, version, rate):
    cases = [c['processedPitch'] for row in rows if row['rate'] == rate for c in row['cases']
             if c['method'] == method and c['version'] == version and not c['allowOctave']]
    counts = {key: sum(c[key] for c in cases) for key in cases[0]}
    true_voice = counts['supportedVoiced'] - counts['missedVoiced']
    return {'within75cPercent': 100 * counts['within75c'] / counts['supportedVoiced'],
            'missedVoicePercent': 100 * counts['missedVoiced'] / counts['supportedVoiced'],
            'falseVoicePercent': 100 * counts['falseVoiced'] / counts['referenceUnvoiced'],
            'voicingF1Percent': 200 * true_voice / (2 * true_voice + counts['falseVoiced'] + counts['missedVoiced']),
            'counts': counts}



def profile_yin(vocadito, baseline, results):
    import numpy as np
    import resource
    spec = importlib.util.spec_from_file_location('benchmark', ROOT / 'tools/benchmark-practice-vocadito.py')
    bench = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bench)
    modules = {'before': bench.load_worker(baseline), 'after': bench.load_worker(ROOT / 'ai/pitch_guide_worker.py')}
    signals = [bench.decode(vocadito / 'Audio' / f'vocadito_{i}.wav', 16000)
               for i in [1, 4, 8, 12, 16, 21, 26, 31, 35, 40]]
    rows = []
    for index in range(3):
        for version in (['before', 'after'] if index % 2 == 0 else ['after', 'before']):
            cpu, wall = time.process_time(), time.perf_counter()
            for audio in signals:
                modules[version].make_guide(audio, 'yin', progress=False)
            rows.append({'round': index, 'version': version, 'cpuSeconds': time.process_time() - cpu,
                         'wallSeconds': time.perf_counter() - wall,
                         'maxRssKb': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})
    report = {'audioSeconds': sum(len(x) / 16000 for x in signals), 'rows': rows}
    (results / 'cpu.json').write_text(json.dumps(report, indent=2))
    t = np.arange(7680) / 16000
    cycle = np.concatenate([np.r_[.18 * np.sin(2 * np.pi * f * t), np.zeros(320)]
                            for f in [65.406, 261.63, 440, 880, 1046.5, 1318.51]]).astype(np.float32)
    audio = np.tile(cycle, 400)
    soak = []
    for version in ['before', 'after']:
        cpu, wall = time.process_time(), time.perf_counter()
        guide = modules[version].make_guide(audio, 'yin', progress=False)
        assert len(guide['contour']) == 60000
        assert all(np.isfinite(v) for point in guide['contour'] for v in point)
        soak.append({'version': version, 'audioSeconds': 1200, 'cpuSeconds': time.process_time() - cpu,
                     'wallSeconds': time.perf_counter() - wall, 'contourFrames': len(guide['contour']),
                     'notes': len(guide['notes']), 'maxRssKb': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})
    (results / 'soak.json').write_text(json.dumps(soak, indent=2))
    return {'cpu': report, 'soak': soak}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--baseline', default='b1dd44e49c61148acc24168ba845fc2a44700cce')
    args = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{40}', args.baseline):
        raise ValueError('Baseline must be an explicit 40-character commit SHA')
    args.directory.mkdir(parents=True, exist_ok=True)
    results = args.directory / 'results'
    results.mkdir(exist_ok=True)
    baseline = args.directory / 'baseline.py'
    baseline.write_bytes(subprocess.check_output(['git', 'show', f'{args.baseline}:ai/pitch_guide_worker.py'], cwd=ROOT))
    baseline_engine = args.directory / 'baseline-engine.js'
    baseline_engine.write_bytes(subprocess.check_output(['git', 'show', f'{args.baseline}:public/js/practice/practice-engine.js'], cwd=ROOT))
    vocadito = prepare_vocadito(args.directory)
    vocalset, manifest = prepare_vocalset(args.directory)
    validation, validation_manifest = prepare_vocalset(args.directory, validation=True)
    (results / 'vocalset-manifest.json').write_bytes(manifest.read_bytes())
    python = sys.executable
    datasets = [('vocadito', vocadito, None), ('vocalset', vocalset, manifest),
                ('vocalset-validation', validation, validation_manifest)]
    summary = {'baseline': args.baseline, 'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
               'datasets': {}, 'sources': {}}
    for tag, dataset, external in datasets:
        cache = args.directory / f'{tag}-cache'
        command = [python, 'tools/benchmark-practice-vocadito.py', '--dataset', str(dataset),
                   '--baseline', str(baseline), '--cache', str(cache), '--output', str(results / f'{tag}-offline.json')]
        if external:
            command += ['--manifest', str(external)]
        # These regression rows compare a pinned CPU baseline and share CPU raw
        # observations; keep the requested backend explicit after CUDA became default.
        run(command, env={**os.environ, 'ELITESAND_PRACTICE_DEVICE': 'cpu'})
        offline = json.loads((results / f'{tag}-offline.json').read_text())
        summary['datasets'][tag] = {}
        for method in ['yin-cpu', 'torchcrepe-tiny-cpu']:
            before, after = [aggregate(offline['rows'], method, v) for v in ['before', 'after']]
            summary['datasets'][tag][method] = {'before': before, 'after': after}
            if tag == 'vocadito':
                assert after['falseTargetPercent'] <= before['falseTargetPercent'], method + ': false targets regressed'
                assert after['missedTargetPercent'] <= before['missedTargetPercent'], method + ': missed targets regressed'
        if tag == 'vocadito':
            boundary_file = results / 'vocadito-note-boundaries.json'
            run([python, 'tools/benchmark-practice-note-boundaries.py', '--dataset', str(dataset),
                 '--observations', str(cache), '--baseline', str(baseline), '--guide-cache', str(cache),
                 '--output', str(boundary_file)])
            boundaries = json.loads(boundary_file.read_text())
            assert len(boundaries['rows']) == 80
            summary['noteBoundaries'] = boundaries['summary']
            for method, values in boundaries['summary'].items():
                assert values['after']['completeNoteF1Percent'] >= values['before']['completeNoteF1Percent'], method + ': complete notes regressed'
                assert values['after']['targetWithin75cPercent'] >= values['before']['targetWithin75cPercent'], method + ': target pitch fit regressed'
        env = dict(os.environ)
        env['PRACTICE_BENCHMARK_ENGINE_BASELINE'] = str(baseline_engine)
        if external:
            env['PRACTICE_BENCHMARK_MANIFEST'] = str(external)
        run(['node', '--expose-gc', 'tools/benchmark-practice-vocadito.js', str(dataset), str(cache),
             str(results / f'{tag}-live.json')], env=env)
        live = json.loads((results / f'{tag}-live.json').read_text())
        cases = [c for row in live['rows'] for c in row['cases']]
        summary['datasets'][tag]['replayCases'] = len(cases)
        summary['datasets'][tag]['nullScores'] = sum(c['score'] is None for c in cases)
        assert all(c['obsScoreMatches'] for c in cases)
        summary['datasets'][tag]['microphone'] = {}
        for method in ['yin', 'torchcrepe']:
            for rate in [44100, 48000, 96000]:
                values = {v: aggregate_live(live['rows'], method, v, rate) for v in ['before', 'after']}
                summary['datasets'][tag]['microphone'][f'{method}-{rate}'] = values
                assert values['after']['within75cPercent'] >= values['before']['within75cPercent'], f'{tag}/{method}/{rate}: mic pitch regressed'
                assert values['after']['voicingF1Percent'] >= values['before']['voicingF1Percent'], f'{tag}/{method}/{rate}: mic voicing regressed'
    for version, filename in [('before', baseline), ('after', None)]:
        command = [python, 'tools/benchmark-practice-guide.py'] + ([str(filename)] if filename else [])
        output = results / f'synthetic-{version}.json'
        run(command, output)
        tones = [r for r in json.loads(output.read_text())['rows'] if r['scenario'] == 'sine']
        assert len(tones) == 12 and min(r['correct'] for r in tones) >= .95
    for path in ['ai/pitch_guide_worker.py', 'public/js/practice/pitch-detector-worklet.js',
                 'public/js/practice/practice-engine.js', 'tools/benchmark-practice-vocadito.py',
                 'tools/benchmark-practice-vocadito.js']:
        summary['sources'][path] = hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
    summary['performance'] = profile_yin(vocadito, baseline, results)
    cpu = summary['performance']['cpu']['rows']
    before_cpu = sum(r['cpuSeconds'] for r in cpu if r['version'] == 'before')
    after_cpu = sum(r['cpuSeconds'] for r in cpu if r['version'] == 'after')
    assert after_cpu <= 1.15 * before_cpu, 'Sustained YIN CPU regression exceeds 15%'
    (results / 'summary.json').write_text(json.dumps(summary, indent=2))
    print('PRACTICE_ACCURACY_SUMMARY_BEGIN', flush=True)
    print(json.dumps(summary, separators=(',', ':')), flush=True)
    print('PRACTICE_ACCURACY_SUMMARY_END', flush=True)


if __name__ == '__main__':
    main()
