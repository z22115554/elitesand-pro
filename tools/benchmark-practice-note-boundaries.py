#!/usr/bin/env python3
"""Paired v5/candidate note-boundary check on pinned Vocadito observations.

Runs production voicing, clean and cut functions separately in both versions.
Uses both manual note annotation sets, without fitting on their labels.
"""
import argparse
from collections import Counter
import hashlib
import importlib.metadata
import importlib.util
import inspect
import json
from pathlib import Path
import time
import warnings

import numpy as np
import mir_eval.transcription

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def match_counts(notes, tuning, reference, offsets=True, raw=False):
    intervals=np.asarray([[n['start'],n['end']] for n in notes],dtype=float).reshape(-1,2)
    pitches=np.asarray([440*2**(((n['raw'] if raw else n['midi']+tuning)-69)/12) for n in notes])
    with warnings.catch_warnings():
        warnings.simplefilter('ignore',UserWarning)
        matches=mir_eval.transcription.match_notes(reference[:,:2],reference[:,2],intervals,pitches,
            onset_tolerance=.05,pitch_tolerance=50,offset_ratio=.2 if offsets else None,offset_min_tolerance=.05)
    return {'matched':len(matches),'reference':len(reference),'estimated':len(notes)}


def observation_signature(module, algorithm, legacy=False):
    source = (inspect.getsource(module.yin_track) + inspect.getsource(module.crepe_track)
              + inspect.getsource(module.extract))
    if legacy:
        source += str((module.MIN_HZ, module.MAX_HZ))
    else:
        source += (inspect.getsource(module.frame_rms)
                   + str((module.MIN_HZ, module.MAX_HZ, module.SAMPLE_RATE, module.HOP))
                   + 'benchmark-dither-seed=0'
                   + str([(p, importlib.metadata.version(p)) for p in
                          (['numpy', 'torch', 'torchcrepe'] if algorithm == 'torchcrepe' else ['numpy'])]))
    return hashlib.sha256(source.encode()).hexdigest()


def summarize(rows):
    summary = {}
    for method in sorted({row['method'] for row in rows}):
        summary[method] = {}
        for version in ['before', 'after']:
            matches = Counter()
            frames = Counter()
            for row in rows:
                if row['method'] != method:
                    continue
                frames.update(row['versions'][version]['notes'])
                for counts in row['versions'][version]['complete']:
                    matches.update(counts)
            summary[method][version] = {
                'completeNoteF1Percent': 200 * matches['matched'] / (matches['reference'] + matches['estimated']),
                'targetWithin75cPercent': 100 * frames['within75c'] / frames['supportedVoiced'],
                'falseTargetPercent': 100 * frames['falseVoiced'] / frames['referenceUnvoiced'],
                'missedTargetPercent': 100 * frames['missedVoiced'] / frames['supportedVoiced'],
                'completeCounts': dict(matches), 'frameCounts': dict(frames)}
    return summary


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset',type=Path,required=True)
    parser.add_argument('--observations',type=Path,required=True)
    parser.add_argument('--baseline',type=Path,required=True)
    parser.add_argument('--candidate',type=Path,default=ROOT/'ai/pitch_guide_worker.py')
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--guide-cache',type=Path,required=True)
    parser.add_argument('--allow-legacy-observations', action='store_true',
                        help='Explicitly use older unseeded comparison caches; retain their weaker provenance in the report.')
    args=parser.parse_args()
    modules={'before':load('old_worker',args.baseline),'after':load('new_worker',args.candidate)}
    bench=load('acoustic_metrics',ROOT/'tools/benchmark-practice-vocadito.py')
    args.guide_cache.mkdir(parents=True,exist_ok=True)
    rows=[]
    for track in range(1,41):
        filename=args.dataset/'Audio'/f'vocadito_{track}.wav'
        audio=bench.decode(filename,16000)
        audio_hash=hashlib.sha256(filename.read_bytes()).hexdigest()
        annotation=np.loadtxt(args.dataset/'Annotations/F0'/f'vocadito_{track}_f0.csv',delimiter=',')
        references=[]
        for annotator in ['A1','A2']:
            data=np.loadtxt(args.dataset/'Annotations/Notes'/f'vocadito_{track}_notes{annotator}.csv',delimiter=',',ndmin=2)
            references.append(np.column_stack([data[:,0],data[:,0]+data[:,2],data[:,1]]))
        for algorithm in ['yin','torchcrepe']:
            with np.load(args.observations/f'{track}-{algorithm}-observations.npz',allow_pickle=False) as cached:
                if str(cached['audioHash'])!=audio_hash: raise ValueError('Audio fingerprint mismatch')
                for module in modules.values():
                    signature=observation_signature(module, algorithm, args.allow_legacy_observations)
                    if signature!=str(cached['signature']): raise ValueError('Raw detector source mismatch')
                frequency,confidence=cached['frequency'],cached['confidence']
                method,threshold=str(cached['method']),float(cached['threshold'])
            row={'id':track,'method':method,'audioSeconds':len(audio)/16000,'audioSha256':audio_hash,'versions':{}}
            for version,module in modules.items():
                started=time.process_time()
                rms=module.frame_rms(audio,len(frequency))
                rms,periodicity=module.voicing_features(audio,frequency,confidence,rms,threshold,method)
                midi,voiced=module.voiced_midi(frequency,confidence,rms,threshold,periodicity)
                tuning=module.clean(midi,voiced,confidence,threshold,frequency=frequency,rms=rms)
                arguments = {'confidence': confidence if method == 'yin-cpu' else None, 'min_confidence': threshold} if 'confidence' in inspect.signature(module.cut_notes).parameters else {}
                notes=module.cut_notes(midi,voiced,[(0,0,0,len(audio)/16000)],tuning,**arguments)
                cpu=time.process_time()-started
                row['versions'][version]={'notes':bench.note_metrics(notes,annotation,tuning),
                    'complete':[match_counts(notes,tuning,ref) for ref in references],
                    'onset':[match_counts(notes,tuning,ref,False) for ref in references],
                    'rawComplete':[match_counts(notes,tuning,ref,raw=True) for ref in references],
                    'noteCount':len(notes),'postprocessCpuSeconds':cpu}
                guide={'duration':len(audio)/16000,'tuning':tuning,'notes':notes,
                       'lines':[{'start':0,'end':len(audio)/16000,'text':'untimed excerpt','words':[]}]}
                (args.guide_cache/f'{track}-{algorithm}-{version}.json').write_text(json.dumps(guide,allow_nan=False))
            rows.append(row)
            print(f'{track}/{algorithm}: {row["versions"]["before"]["noteCount"]} -> {row["versions"]["after"]["noteCount"]} notes',flush=True)
        report={'scope':'40 excerpts, paired cached F0 observations, separately executed production pipeline; both corrected manual note labels. Annotation workflow originally used Tony/pYIN; not a blind test.',
                'observationProvenance': 'legacy-unseeded' if args.allow_legacy_observations else 'seed=0; package and source fingerprint verified',
                'baselineSha256':hashlib.sha256(args.baseline.read_bytes()).hexdigest(),
                'candidateSha256':hashlib.sha256(args.candidate.read_bytes()).hexdigest(),'rows':rows}
        temporary=args.output.with_suffix(args.output.suffix+'.tmp')
        temporary.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
        temporary.replace(args.output)
    if len(rows) != 80:
        raise RuntimeError('Incomplete 40-excerpt, two-detector comparison')
    report['summary'] = summarize(rows)
    temporary.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    temporary.replace(args.output)
    print(json.dumps(report['summary']), flush=True)


if __name__=='__main__': main()
