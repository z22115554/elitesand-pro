#!/usr/bin/env python3
"""Maintainer-only Windows CPython 3.11 locks plus the macOS arm64 AI lock. --check is offline."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
LOCKS = ROOT / 'server/services/python-locks'
GROUPS = ('bootstrap', 'ai', 'section', 'practice-pitch')
# macOS arm64 / CPython 3.12 (python-build-standalone). diffq is Demucs-only and has no
# cp312 macOS wheel, so it is excluded; the app installs this lock with --no-deps --only-binary.
MAC_GROUPS = {'ai-mac': 'ai-mac-arm64-py312.lock'}

def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()

def check():
    manifest = json.loads((LOCKS / 'manifest.json').read_text())
    for group in (*GROUPS, *MAC_GROUPS):
        entry = manifest['locks'][group]
        if digest(LOCKS / entry['file']) != entry['sha256']:
            raise ValueError(f'{group}: packaged lock hash differs')
    for name, expected in manifest['inputs'].items():
        if digest(LOCKS / name) != expected:
            raise ValueError(f'{name}: regenerate after changing an input')
    bootstrap = (LOCKS / manifest['locks']['bootstrap']['file']).read_text()
    for wheel in json.loads((LOCKS / 'bootstrap-wheels.json').read_text()):
        if f"--hash=sha256:{wheel['sha256']}" not in bootstrap:
            raise ValueError(f"{wheel['name']}: unapproved bootstrap wheel")

def generate(uv):
    for group in GROUPS:
        command = [uv, 'pip', 'compile', str(LOCKS / f'{group}.in'),
                   '--python-version', '3.11', '--python-platform', 'x86_64-pc-windows-msvc',
                   '--default-index', 'https://pypi.org/simple', '--generate-hashes',
                   '--no-header', '--no-annotate', '--output-file', str(LOCKS / f'{group}-win-py311.lock')]
        if group in ('ai', 'section'):
            command += ['--torch-backend', 'cu124', '--constraint', str(LOCKS / 'bootstrap.in')]
        if group == 'section':
            command += ['--constraint', str(LOCKS / 'section-constraints.in')]
        if group == 'practice-pitch':
            command += ['--no-deps']
        subprocess.run(command, cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    for group, output in MAC_GROUPS.items():
        subprocess.run([uv, 'pip', 'compile', str(LOCKS / f'{group}.in'),
                        '--python-version', '3.12', '--python-platform', 'aarch64-apple-darwin',
                        '--default-index', 'https://pypi.org/simple', '--generate-hashes',
                        '--no-header', '--no-annotate', '--no-emit-package', 'diffq',
                        '--output-file', str(LOCKS / output)],
                       cwd=ROOT, check=True, stdout=subprocess.DEVNULL,
                       env={**os.environ, 'MACOSX_DEPLOYMENT_TARGET': '14.0'})
    wheels = []
    for requirement in (LOCKS / 'bootstrap.in').read_text().splitlines():
        if not requirement or requirement.startswith('#'):
            continue
        name, version = requirement.split('==')
        with urllib.request.urlopen(f'https://pypi.org/pypi/{name}/{version}/json', timeout=30) as response:
            metadata = json.load(response)
        wheel = next(item for item in metadata['urls'] if item['filename'].endswith('py3-none-any.whl'))
        wheels.append({'name': name, 'version': version, 'file': wheel['filename'], 'url': wheel['url'],
                       'sha256': wheel['digests']['sha256'], 'size': wheel['size']})
    (LOCKS / 'bootstrap-wheels.json').write_text(json.dumps(wheels, indent=2) + '\n', encoding='utf8')
    manifest = {'schemaVersion': 1, 'target': 'CPython 3.11 / Windows x64 / CUDA 12.4',
        'locks': {group: {'file': f'{group}-win-py311.lock',
                           'sha256': digest(LOCKS / f'{group}-win-py311.lock')} for group in GROUPS}
                 | {group: {'file': output, 'sha256': digest(LOCKS / output)} for group, output in MAC_GROUPS.items()},
        'inputs': {file.name: digest(file) for file in sorted(LOCKS.glob('*.in'))}}
    (LOCKS / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf8')
    check()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--uv', default='uv')
    args = parser.parse_args()
    check() if args.check else generate(args.uv)
    print('Python locks verified; review versions, hashes and licenses before committing.')
