"""Independent acoustic and device-fallback checks for the offline pitch worker."""
import importlib.util
import contextlib
import json
import os
import sys
from types import SimpleNamespace
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

import numpy as np

SPEC = importlib.util.spec_from_file_location("pitch_guide_worker", Path(__file__).resolve().parents[1] / "ai" / "pitch_guide_worker.py")
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


def tone(frequency, seconds=2.4):
    time = np.arange(round(seconds * worker.SAMPLE_RATE)) / worker.SAMPLE_RATE
    return (0.3 * np.sin(2 * np.pi * frequency * time)).astype(np.float32)


def melody(frequencies, seconds_each):
    return np.concatenate([tone(f, seconds_each) if f else np.zeros(round(seconds_each * worker.SAMPLE_RATE), dtype=np.float32)
                           for f in frequencies])


def word_lyrics(spans, offset=0):
    """spans: [(start_s, end_s, text)] in one line; returns the parsedLyrics-shaped list."""
    return [{"time": offset, "text": " ".join(s[2] for s in spans),
             "words": [{"text": text, "start": round((a * 1000) - offset), "duration": round((b - a) * 1000)} for a, b, text in spans]}]


class PitchGuideWorkerTests(unittest.TestCase):
    def test_neural_weak_tail_needs_local_waveform_and_a_frozen_strong_anchor(self):
        count = 190
        frequency = np.full(count, 440.)
        confidence = np.full(count, .99)
        for tail in ('voice', 'noise'):
            audio = np.zeros(count * worker.HOP, dtype=np.float32)
            audio[:9600] = tone(440, .6) * (.08 / .3)
            if tail == 'voice':
                audio[9600:14400] = tone(440, .3) * (.0015 / .3)
            else:
                audio[9600:14400] = np.random.default_rng(17).uniform(-.002, .002, 4800)
            rms = worker.frame_rms(audio, count)
            energy, periodicity = worker.voicing_features(audio, frequency, confidence, rms, .45, 'torchcrepe-tiny-cpu')
            midi, voiced = worker.voiced_midi(frequency, confidence, energy, .45, periodicity)
            if tail == 'voice':
                self.assertTrue(np.all(voiced[72:85]), 'measured quiet vowel must survive the whole-song energy gate')
                np.testing.assert_allclose(midi[72:85], 69.)
            else:
                self.assertFalse(np.any(voiced[72:85]), 'strong model confidence cannot invent periodic voice in noise')
            self.assertFalse(np.any(voiced[100:]), 'no F0 recovery through actual silence')

    def test_recovered_weak_reference_cannot_chain_or_recalibrate_the_song(self):
        frequency = 440 * 2 ** ((np.r_[np.full(240, 69.2), np.full(100, 69.4)] - 69) / 12)
        confidence = np.full(340, .99)
        energy = np.r_[np.full(240, .1), np.full(100, .001)]
        midi, voiced = worker.voiced_midi(frequency, confidence, energy, .45, np.ones(340))
        self.assertTrue(np.any(voiced[245:270]))
        self.assertFalse(np.any(voiced[300:]), 'recovered frames must never become new strong anchors')
        tuning = worker.clean(midi, voiced, confidence, .45, frequency=frequency, rms=energy)
        self.assertAlmostEqual(tuning, .2, places=10, msg='weak tails must not move every original target')
        wrong_pitch = frequency.copy(); wrong_pitch[240:] *= 2
        _, wrong_voiced = worker.voiced_midi(wrong_pitch, confidence, energy, .45, np.ones(340))
        self.assertFalse(np.any(wrong_voiced[240:]), 'neighbours cannot supply an octave that was not supported')

    def test_short_weak_files_cannot_supply_their_own_missing_anchor(self):
        for count in (0, 1, 2, 6, 20, 40, 60):
            _, voiced = worker.voiced_midi(np.full(count, 440.), np.full(count, .99),
                                           np.full(count, .001), .45, np.ones(count))
            self.assertFalse(np.any(voiced), 'a missing left/right anchor must never become a clipped file-edge index')


    def device_fixture(self, cuda=True, failure=None, cpu_failure=False):
        class Tensor:
            def __init__(self, value): self.value = value
            def __getitem__(self, key): return Tensor(self.value[key])
            def cpu(self): return self
            def numpy(self): return self.value

        calls, draws = [], []
        torch = SimpleNamespace(cuda=SimpleNamespace(is_available=Mock(return_value=cuda), empty_cache=Mock()),
            backends=SimpleNamespace(cuda=SimpleNamespace(matmul=SimpleNamespace(allow_tf32=True)),
                                     cudnn=SimpleNamespace(allow_tf32=True)),
            set_num_threads=Mock(), set_num_interop_threads=Mock(),
            inference_mode=contextlib.nullcontext, from_numpy=lambda value: value)
        crepe = SimpleNamespace(infer=SimpleNamespace(), filter=SimpleNamespace(median=lambda value, _: value))
        def predict(audio, rate, hop, **options):
            device = options['device']; calls.append(device); draws.append(np.random.random())
            self.assertEqual(options['model'], 'tiny'); self.assertEqual(options['batch_size'], 256)
            if device.startswith('cuda'):
                crepe.infer.model = 'failed-cuda-model'
                if failure: raise RuntimeError(failure)
            else:
                self.assertFalse(hasattr(crepe.infer, 'model'), 'CPU retry must load clean weights')
                if cpu_failure: raise RuntimeError('CPU model failed')
            count = int(np.ceil(audio.shape[-1] / hop))
            return Tensor(np.full((1, count), 440.)), Tensor(np.full((1, count), .99))
        crepe.predict = predict
        return torch, crepe, calls, draws

    def test_cuda_is_preferred_with_the_same_model_and_full_precision(self):
        torch, crepe, calls, _ = self.device_fixture()
        with patch.dict(sys.modules, {'torch': torch, 'torchcrepe': crepe}), patch.dict(os.environ, {'ELITESAND_PRACTICE_DEVICE': 'auto'}), patch.object(worker, 'emit'):
            result = worker.crepe_track(tone(440, .2))
        self.assertEqual(calls, ['cuda:0']); self.assertEqual(result[3:], ('torchcrepe-tiny-cuda', None))
        self.assertFalse(torch.backends.cuda.matmul.allow_tf32); self.assertFalse(torch.backends.cudnn.allow_tf32)

    def test_missing_cuda_and_explicit_cpu_use_cpu_without_changing_models(self):
        for cuda, setting in [(False, 'auto'), (True, 'cpu')]:
            torch, crepe, calls, _ = self.device_fixture(cuda=cuda)
            with patch.dict(sys.modules, {'torch': torch, 'torchcrepe': crepe}), patch.dict(os.environ, {'ELITESAND_PRACTICE_DEVICE': setting}), patch.object(worker, 'emit'):
                result = worker.crepe_track(tone(440, .2))
            self.assertEqual(calls, ['cpu']); self.assertEqual(result[3:], ('torchcrepe-tiny-cpu', None))
            if setting == 'cpu': torch.cuda.is_available.assert_not_called()

    def test_cuda_failure_reloads_on_cpu_and_restores_pitch_dither_state(self):
        torch, crepe, calls, draws = self.device_fixture(failure='CUDA out of memory')
        torch.cuda.empty_cache.side_effect = RuntimeError('driver unavailable')
        with patch.dict(sys.modules, {'torch': torch, 'torchcrepe': crepe}), patch.dict(os.environ, {'ELITESAND_PRACTICE_DEVICE': 'auto'}), patch.object(worker, 'emit'), patch.object(worker, 'crepe_available', return_value=True):
            result = worker.extract(tone(440, .2), 'torchcrepe', progress=False)
        self.assertEqual(calls, ['cuda:0', 'cpu']); self.assertEqual(draws[0], draws[1])
        self.assertEqual(result[3], 'torchcrepe-tiny-cpu')
        self.assertEqual(result[4], 'cuda-runtime-unavailable-used-cpu'); self.assertEqual(result[5], .45)

    def test_cuda_probe_errors_fall_back_to_cpu(self):
        torch, crepe, calls, _ = self.device_fixture()
        torch.cuda.is_available.side_effect = RuntimeError('driver unavailable')
        with patch.dict(sys.modules, {'torch': torch, 'torchcrepe': crepe}), patch.dict(os.environ, {'ELITESAND_PRACTICE_DEVICE': 'auto'}), patch.object(worker, 'emit'):
            result = worker.crepe_track(tone(440, .2))
        self.assertEqual(calls, ['cpu']); self.assertEqual(result[3], 'torchcrepe-tiny-cpu')

    def test_quiet_analysis_keeps_benchmark_json_output_clean(self):
        torch, crepe, _, _ = self.device_fixture()
        with patch.dict(sys.modules, {'torch': torch, 'torchcrepe': crepe}), patch.dict(os.environ, {'ELITESAND_PRACTICE_DEVICE': 'auto'}), patch.object(worker, 'emit') as emit, patch.object(worker, 'crepe_available', return_value=True):
            worker.extract(tone(440, .2), 'torchcrepe', progress=False)
        emit.assert_not_called()

    def test_only_failure_of_both_neural_backends_uses_the_existing_auto_yin_fallback(self):
        torch, crepe, calls, _ = self.device_fixture(failure='CUDA failed', cpu_failure=True)
        with patch.dict(sys.modules, {'torch': torch, 'torchcrepe': crepe}), patch.dict(os.environ, {'ELITESAND_PRACTICE_DEVICE': 'auto'}), patch.object(worker, 'emit'), patch.object(worker, 'crepe_available', return_value=True):
            result = worker.extract(tone(440, .2), 'auto', progress=False)
        self.assertEqual(calls, ['cuda:0', 'cpu']); self.assertEqual(result[3], 'yin-cpu')

    def test_banded_crepe_decoder_matches_full_transition_search(self):
        # Independent dense recurrence, including finite epsilon costs for zero
        # transitions. Exercise masks, ties, jumps, boundary bins and both dtypes.
        def dense(probability):
            count, steps = probability.shape
            weights = np.maximum(12 - abs(np.arange(count)[:, None] - np.arange(count)), 0)
            epsilon = np.finfo(probability.dtype).tiny
            transitions = np.log(weights / weights.sum(axis=1, keepdims=True) + epsilon)
            emissions = np.log(probability + epsilon)
            values = emissions[:, 0] + np.log(np.full(count, 1 / count) + epsilon)
            parents = []
            for frame in range(1, steps):
                scores = values[:, None] + transitions
                parent = scores.argmax(axis=0)
                parents.append(parent)
                values = emissions[:, frame] + scores[parent, np.arange(count)]
            path = [int(values.argmax())]
            for parent in reversed(parents):
                path.append(int(parent[path[-1]]))
            return np.array(path[::-1])

        for dtype in (np.float32, np.float64):
            examples = [np.full((360, 20), 1 / 360, dtype=dtype), np.zeros((360, 1), dtype=dtype)]
            jumps = np.zeros((360, 25), dtype=dtype)
            jumps[0, :8] = 1; jumps[359, 8:16] = 1; jumps[180, 16:] = 1
            examples.append(jumps)
            for seed in range(5):
                probability = np.random.default_rng(seed).random((360, 40)).astype(dtype)
                probability[:30] = 0; probability[300:] = 0
                probability /= probability.sum(axis=0)
                examples.append(probability)
            for probability in examples:
                np.testing.assert_array_equal(worker.crepe_viterbi_bins(probability), dense(probability))
                np.testing.assert_array_equal(worker.crepe_viterbi_bins(probability, accelerate=True), dense(probability))

    def test_crepe_decoder_rejects_invalid_model_output(self):
        for probability in (np.zeros((359, 2), np.float32), np.zeros((360, 0), np.float32),
                            np.full((360, 2), np.nan), np.full((360, 2), -1.)):
            with self.assertRaises(ValueError):
                worker.crepe_viterbi_bins(probability)

    def test_failed_decoder_acceleration_retains_the_same_numpy_path(self):
        probability = np.random.default_rng(7).random((360, 20)).astype(np.float32)
        probability /= probability.sum(axis=0)
        expected = worker.crepe_viterbi_bins(probability)
        with patch.object(worker, '_CREPE_PATH_CHECKED', True), patch.object(worker, '_CREPE_PATH', side_effect=RuntimeError('unavailable')):
            np.testing.assert_array_equal(worker.crepe_viterbi_bins(probability, accelerate=True), expected)

    def test_merged_glide_cannot_keep_a_tiny_neighbours_unrepresentative_pitch(self):
        # A 140ms moving pitch joins a 60ms plateau. The plateau's old center
        # must not overwrite the majority of the merged observations.
        midi = np.r_[np.linspace(60., 61.2, 14), np.full(6, 67.)]
        notes = worker.cut_notes(midi, midi > 0, [(0, 0, 0, .2)], 0)
        self.assertEqual(len(notes), 1)
        self.assertEqual(notes[0]['midi'], 61)
        self.assertLess(abs(notes[0]['raw'] - np.median(midi)), .01)
        # A genuine short approach slide still joins its measured destination;
        # indiscriminately taking the merged median would detune this target.
        midi = np.r_[np.linspace(60., 64., 14), np.full(6, 64.)]
        notes = worker.cut_notes(midi, midi > 0, [(0, 0, 0, .2)], 0)
        self.assertEqual([n['midi'] for n in notes], [64])

    def test_acoustic_100ms_octave_notes_survive_segmentation_in_every_register(self):
        for low, high in ((261.63, 523.25), (440., 880.), (523.25, 1046.5), (261.63, 1046.5)):
            frequencies = [low, high] * 5
            audio = np.r_[np.zeros(3200), melody(frequencies, .1), np.zeros(3200)].astype(np.float32)
            guide = worker.make_guide(audio, 'yin', word_lyrics([(0, 1.4, 'aa')]), progress=False)
            expected = [round(69 + 12*np.log2(f/440)) for f in frequencies]
            with self.subTest(low=low, high=high):
                self.assertEqual([n['midi'] for n in guide['notes']], expected)
                self.assertTrue(all(n['end']-n['start']+1e-9 >= .06 for n in guide['notes']))
                for index, note in enumerate(guide['notes']):
                    self.assertLessEqual(abs(note['start'] - (.2 + .1*index)), .05)
                    self.assertLessEqual(abs(note['end'] - (.3 + .1*index)), .05)

    def test_acoustic_vibrato_keeps_one_note_without_flattening_the_contour(self):
        time = np.arange(38400) / worker.SAMPLE_RATE
        for depth in (.35, .65):
            frequency = 440 * 2 ** (depth * np.sin(2*np.pi*5.2*time) / 12)
            audio = (.3*np.sin(2*np.pi*np.cumsum(frequency)/worker.SAMPLE_RATE)).astype(np.float32)
            guide = worker.make_guide(audio, 'yin', progress=False)
            self.assertEqual([n['midi'] for n in guide['notes']], [69])
            contour = [m for t,m in guide['contour'] if .15 < t < 2.2 and m]
            self.assertGreater(np.ptp(contour), depth)

    def test_short_note_partition_has_no_register_prior_and_never_crosses_a_rest(self):
        for transpose in (-5., 0., 7., 12.):
            midi = np.r_[np.tile(np.r_[np.full(6,48.+transpose),np.full(6,60.+transpose)],5),
                         np.zeros(9),np.full(6,48.+transpose)]
            original=midi.copy()
            notes=worker.cut_notes(midi,midi>0,[(0,0,0,len(midi)*.01)],0)
            self.assertEqual([n['midi'] for n in notes], [int(48+transpose),int(60+transpose)]*5+[int(48+transpose)])
            self.assertTrue(all(n['end'] <= .6 or n['start'] >= .69 for n in notes))
            np.testing.assert_array_equal(midi,original)

    def test_stable_short_semitones_are_not_sacrificed_to_glide_regularization(self):
        for shift in (0., .35, 7.):
            midi=np.r_[np.full(20,60.+shift),np.full(8,61.+shift),np.full(20,60.+shift)]
            notes=worker.cut_notes(midi,midi>0,[(0,0,0,.48)],shift)
            self.assertEqual([n['midi'] for n in notes],[60,61,60])

    def test_note_changes_use_confidence_and_duration_without_an_octave_prior(self):
        for jump in (7., 12., 24.):
            for length, confidence, preserved in ((7, .88, False), (7, .99, True), (80, .81, True)):
                midi = np.r_[np.full(30, 60.), np.full(length, 60.+jump), np.full(30, 60.)]
                original = midi.copy()
                clarity = np.r_[np.full(30, .99), np.full(length, confidence), np.full(30, .99)]
                notes = worker.cut_notes(midi, midi > 0, [(0, 0, 0, len(midi)*.01)], 0, clarity, .8)
                self.assertEqual([n['midi'] for n in notes], [60, int(60+jump), 60] if preserved else [60])
                np.testing.assert_array_equal(midi, original)

    def test_local_energy_does_not_borrow_a_vowel_from_both_sides_of_a_breath(self):
        audio = np.concatenate([tone(440, .2), np.zeros(640), tone(440, .2)])
        count = int(np.ceil(len(audio) / worker.HOP))
        rms = worker.frame_rms(audio, count)
        frequency, confidence = np.full(count, 440.), np.full(count, .99)
        self.assertGreater(rms[22], 0)
        rms, periodicity = worker.voicing_features(audio, frequency, confidence, rms, .8, "torchcrepe-tiny-cpu")
        _, voiced = worker.voiced_midi(frequency, confidence, rms, .8, periodicity)
        self.assertEqual(rms[22], 0)
        self.assertFalse(voiced[22])
        self.assertTrue(voiced[15] and voiced[28])

    def test_weak_measured_onset_and_tail_need_a_reliable_anchor_without_cascading(self):
        frequency = np.full(30, 440.)
        confidence = np.full(30, .79)
        confidence[12:18] = .98
        rms = np.full(30, .1)
        _, voiced = worker.voiced_midi(frequency, confidence, rms, .8, np.ones(30))
        self.assertTrue(np.all(voiced[10:20]))
        self.assertFalse(np.any(voiced[:9]))
        self.assertFalse(np.any(voiced[21:]))
        confidence[:] = .79
        self.assertFalse(np.any(worker.voiced_midi(frequency, confidence, rms, .8, np.ones(30))[1]))
        confidence[12:18] = .98
        rms[10] = 0
        frequency[19] = 523.25
        _, voiced = worker.voiced_midi(frequency, confidence, rms, .8, np.ones(30))
        self.assertFalse(voiced[10] or voiced[19])
        # At a file edge two strong observations are not a three-frame anchor.
        for strong in (slice(0, 2), slice(-2, None)):
            confidence = np.full(8, .79)
            confidence[strong] = .98
            _, voiced = worker.voiced_midi(np.full(8, 440.), confidence, np.full(8, .1), .8, np.ones(8))
            np.testing.assert_array_equal(voiced, confidence >= .8)
        for count in (0, 1, 2):
            _, voiced = worker.voiced_midi(np.full(count, 440.), np.full(count, .79),
                                           np.full(count, .1), .8, np.ones(count))
            self.assertFalse(np.any(voiced))

    def test_stable_short_notes_are_not_automatically_merged_as_glides(self):
        midi = np.r_[np.full(20, 60.), np.full(8, 62.), np.full(20, 60.)]
        notes = worker.cut_notes(midi, np.ones(len(midi), dtype=bool), [(0, 0, 0, .48)], 0)
        self.assertEqual([n['midi'] for n in notes], [60, 62, 60])
        glide = np.r_[np.full(30, 60.), np.linspace(60, 64, 8), np.full(30, 64.)]
        notes = worker.cut_notes(glide, np.ones(len(glide), dtype=bool), [(0, 0, 0, .68)], 0)
        self.assertEqual([n['midi'] for n in notes], [60, 64])

    def test_exactly_60ms_notes_survive_float_roundoff_at_every_position(self):
        for first in range(200):
            midi = np.zeros(first + 6)
            midi[first:] = 69.
            notes = worker.cut_notes(midi, midi > 0, [(0, 0, 0, len(midi) * .01)], 0)
            self.assertEqual(len(notes), 1, f'60ms note starting at frame {first}')
            self.assertEqual(notes[0]['midi'], 69)

    def test_waveform_periodicity_rescues_a_weak_voice_but_not_neighbouring_breath_noise(self):
        frequency = np.full(30, 440.)
        confidence = np.full(30, .79)
        confidence[12:18] = .98
        for noise in (False, True):
            audio = tone(440., .3)
            if noise:
                audio[9 * 160:12 * 160] = np.random.default_rng(9).normal(0, .1, 480)
            rms = worker.frame_rms(audio, 30)
            rms, periodicity = worker.voicing_features(audio, frequency, confidence, rms, .8, 'yin-cpu')
            _, voiced = worker.voiced_midi(frequency, confidence, rms, .8, periodicity)
            self.assertEqual(bool(voiced[10]), not noise)
            self.assertTrue(voiced[15])

    def test_rms_windows_are_views_with_the_same_energy_as_individual_frames(self):
        audio = np.random.default_rng(5).normal(0, .2, 17003).astype(np.float32)
        count = int(np.ceil(len(audio) / worker.HOP))
        for window in (320, 640, 1024):
            padded = np.pad(audio.astype(np.float64), (window // 2, window // 2))
            expected = np.asarray([np.sqrt(np.mean(padded[i * 160:i * 160 + window] ** 2)) for i in range(count)])
            np.testing.assert_allclose(worker.frame_rms(audio, count, window), expected, rtol=1e-12, atol=1e-12)

    def test_neural_fade_check_keeps_a_periodic_quiet_vowel_but_rejects_actual_silence(self):
        for frequency in (65.406, 440., 1318.51):
            for silent in (False, True):
                audio = tone(frequency, .5)
                audio[3200:3840] *= 0 if silent else .004 / .3
                count = len(audio) // worker.HOP
                f0, confidence = np.full(count, frequency), np.full(count, .99)
                rms = worker.frame_rms(audio, count)
                energy, periodicity = worker.voicing_features(audio, f0, confidence, rms, .45, 'torchcrepe-tiny-cpu')
                _, voiced = worker.voiced_midi(f0, confidence, energy, .45, periodicity)
                self.assertEqual(bool(voiced[22]), not silent, f'{frequency}Hz silent={silent}')

    def test_acoustic_80ms_held_note_is_not_the_same_as_an_80ms_continuous_glide(self):
        audio = np.concatenate([tone(392., .08), tone(440., .62)])
        guide = worker.make_guide(audio, 'yin', word_lyrics([(0, .7, 'a')]), progress=False)
        self.assertEqual([n['midi'] for n in guide['notes']], [67, 69])


    def test_recorded_song_observations_preserve_sustained_octaves_in_both_directions(self):
        # Real separated-vocal observations, not audio or manually labelled F0 truth.
        # Original v2 clean moved all 47/93 target frames by 12 semitones merely
        # to match the surrounding register; v3 must preserve these sustained runs.
        filename = Path(__file__).parent / 'fixtures/practice/kaiju-octave-observations.json'
        fixture = json.loads(filename.read_text(encoding='utf-8'))
        for segment in fixture['segments']:
            with self.subTest(start=segment['startSeconds']):
                frames = np.asarray(segment['frames'])
                original = frames[:, 0].copy()
                midi, voiced, confidence = original.copy(), frames[:, 1].astype(bool), frames[:, 2]
                a, b = segment['preserveStart'], segment['preserveEnd']
                self.assertTrue(np.all(voiced[a:b]))
                self.assertGreaterEqual(b - a, 40)
                worker.clean(midi, voiced, confidence, .45)
                np.testing.assert_array_equal(midi[a:b], original[a:b])

    def test_high_range_acoustic_accuracy(self):
        for frequency in (65.406, 261.63, 523.25, 880, 987.77, 1046.5, 1100, 1174.66, 1318.51):
            with self.subTest(frequency=frequency):
                audio = tone(frequency, 0.7)
                f0, confidence, rms = worker.yin_track(audio, progress=False)
                cents = 1200 * np.log2(np.maximum(f0[12:-8], 1e-15) / frequency)
                self.assertGreaterEqual(float(np.mean(np.abs(cents) <= 50)), .95)
                rms, periodicity = worker.voicing_features(audio, f0, confidence, rms, .8, 'yin-cpu')
                _, voiced = worker.voiced_midi(f0, confidence, rms, .8, periodicity)
                self.assertGreaterEqual(float(np.mean(voiced[12:-8] & (np.abs(cents) <= 50))), .95)

    def test_true_octave_phrases_separated_by_breaths_are_preserved(self):
        for high in (72, 84):
            midi = np.concatenate([np.full(100, 60.0), np.zeros(20), np.full(60, float(high)), np.zeros(20), np.full(100, 60.0)])
            original = midi.copy()
            voiced = midi > 0
            worker.clean(midi, voiced)
            np.testing.assert_array_equal(midi, original)
            self.assertFalse(np.any(voiced[100:120]))
            self.assertFalse(np.any(voiced[180:200]))

    def test_sustained_octaves_and_short_confident_notes_are_not_forced_to_context(self):
        for length in (2, 3, 4, 20, 60):
            midi = np.concatenate([np.full(50, 60.), np.full(length, 72.), np.full(50, 60.)])
            original = midi.copy()
            worker.clean(midi, np.ones(len(midi), dtype=bool))
            np.testing.assert_array_equal(midi, original)

    def test_acoustic_octave_melisma_and_breaths_keep_note_and_lyric_boundaries(self):
        for frequencies in ([261.63, 523.25, 261.63], [440, 880, 440], [523.25, 1046.5, 523.25],
                            [261.63, 1046.5, 261.63], [261.63, 0, 523.25, 0, 261.63]):
            audio = melody(frequencies, .4)
            lyrics = word_lyrics([(0, len(audio) / worker.SAMPLE_RATE, "aa")])
            guide = worker.make_guide(audio, "yin", lyrics, progress=False)
            expected = [round(69 + 12 * np.log2(f / 440)) for f in frequencies if f]
            self.assertEqual([n["midi"] for n in guide["notes"]], expected)
            self.assertTrue(all(n["line"] == 0 and n["word"] == 0 for n in guide["notes"]))

    def test_cleanup_suppresses_isolated_spikes_without_cascading_across_a_leap(self):
        midi = np.full(100, 60.); midi[40] = 72.
        worker.clean(midi, np.ones(100, dtype=bool))
        np.testing.assert_array_equal(midi, 60.)
        # Missing voice next to a spike is not evidence to alter a note across a breath.
        midi[40] = 72.; voiced = np.ones(100, dtype=bool); voiced[39] = False
        worker.clean(midi, voiced)
        self.assertEqual(midi[40], 72.)

    def test_yin_tracks_low_and_high_register(self):
        for frequency in (82.4069, 220.0, 440.0, 880.0):
            with self.subTest(frequency=frequency):
                guide = worker.make_guide(tone(frequency), "yin", progress=False)
                voiced = [midi for _, midi in guide["contour"][3:-3] if midi]
                expected = 69 + 12 * np.log2(frequency / 440)
                self.assertGreater(len(voiced), 50)
                self.assertLess(abs(float(np.median(voiced)) - expected), 0.15)
                self.assertEqual([note["midi"] for note in guide["notes"]], [round(expected)])

    def test_silence_and_white_noise_are_not_melody(self):
        for audio in (np.zeros(16000, dtype=np.float32), np.random.default_rng(10).normal(0, 0.05, 16000).astype(np.float32)):
            guide = worker.make_guide(audio, "yin", progress=False)
            self.assertEqual(guide["voicedSeconds"], 0)
            self.assertEqual(guide["notes"], [])

    def test_one_block_per_word_and_short_glides_do_not_split(self):
        # 一個字裡先滑 80ms 再到主音：滑音併進主音，不另成一格
        # A held 80ms note is not a glide; retain it in a separate acoustic test.
        frequencies = np.r_[np.linspace(392., 440., 1280, endpoint=False), np.full(9920, 440.)]
        glide = (.3 * np.sin(2 * np.pi * np.cumsum(frequencies) / worker.SAMPLE_RATE)).astype(np.float32)
        audio = np.concatenate([glide, tone(493.88, 0.7)])
        lyrics = word_lyrics([(0.0, 0.7, "a"), (0.7, 1.4, "b")])
        guide = worker.make_guide(audio, "yin", lyrics, 0, progress=False)
        self.assertEqual([(n["midi"], n["word"]) for n in guide["notes"]], [(69, 0), (71, 1)])

    def test_real_melisma_inside_one_word_is_split(self):
        audio = np.concatenate([tone(440.0, 0.5), tone(523.25, 0.5)])
        guide = worker.make_guide(audio, "yin", word_lyrics([(0.0, 1.0, "aa")]), 0, progress=False)
        self.assertEqual([n["midi"] for n in guide["notes"]], [69, 72])
        self.assertEqual([n["cont"] for n in guide["notes"]], [False, True])

    def test_lyric_offset_moves_words_back_onto_the_audio(self):
        # 歌詞時間＝音訊時間＋偏移：偏移 +300ms 的歌詞，字要往前 0.3 秒才對得上聲音
        audio = melody([0, 440.0], 0.6)
        lyrics = word_lyrics([(0.9, 1.5, "a")])
        aligned = worker.make_guide(audio, "yin", lyrics, 300, progress=False)
        self.assertAlmostEqual(aligned["lines"][0]["words"][0]["start"], 0.6, places=3)
        self.assertEqual([n["midi"] for n in aligned["notes"]], [69])

    def test_context_alone_cannot_identify_a_200ms_octave_phrase_as_a_detector_error(self):
        # 同一組 MIDI 也可能是真實演唱；缺少聲學／信心證據，不得強制搬回低音。
        midi = np.full(300, 69.0); midi[140:160] = 81.0
        voiced = np.ones(300, dtype=bool); voiced[138:140] = False; voiced[160:162] = False
        worker.clean(midi, voiced)
        self.assertTrue(np.all(np.abs(midi[140:160] - 81.0) < 0.01))

    def test_only_brief_low_confidence_islands_are_repaired(self):
        for length in (2, 3, 4):
            for shift in (-12, 7, 12):
                midi = np.full(100, 69.); midi[40:40 + length] += shift
                confidence = np.full(100, .98); confidence[40:40 + length] = .81
                worker.clean(midi, np.ones(100, dtype=bool), confidence)
                np.testing.assert_array_equal(midi, 69.)
        # A long, low-confidence octave cannot be safely repaired from pitch alone either.
        midi = np.full(100, 69.); midi[40:60] = 81.
        confidence = np.full(100, .98); confidence[40:60] = .6
        worker.clean(midi, np.ones(100, dtype=bool), confidence)
        np.testing.assert_array_equal(midi[40:60], 81.)

    def test_cleanup_uses_only_evidence_from_frames_that_passed_the_real_voicing_gate(self):
        frequency = np.full(100, 440.); frequency[40:43] = 880.
        confidence = np.full(100, .98); confidence[40:43] = .81
        midi, voiced = worker.voiced_midi(frequency, confidence, np.full(100, .1), .8)
        self.assertTrue(np.all(voiced))
        worker.clean(midi, voiced, confidence, .8)
        np.testing.assert_array_equal(midi, 69.)
        # Identical pitches, reliable confidence: keep the real 30ms leap.
        confidence[:] = .98
        midi, voiced = worker.voiced_midi(frequency, confidence, np.full(100, .1), .8)
        worker.clean(midi, voiced, confidence, .8)
        np.testing.assert_array_equal(midi[40:43], 81.)

    def test_missing_voicing_is_not_invented_from_agreeing_neighbours(self):
        # Pitch on each side cannot identify whether the gap was a breath,
        # unpitched consonant or a detector dropout. Keep the original evidence.
        for gap in (1, 3, 10, 40):
            midi = np.full(200, 69.0)
            voiced = np.ones(200, dtype=bool)
            midi[50:50 + gap] = 0
            voiced[50:50 + gap] = False
            worker.clean(midi, voiced)
            self.assertFalse(np.any(voiced[50:50 + gap]))
            np.testing.assert_array_equal(midi[50:50 + gap], 0)

    def test_one_lyric_window_does_not_turn_real_rests_into_required_notes(self):
        for gap in (.10, .40):
            audio = np.concatenate([tone(440, .5), np.zeros(round(gap * worker.SAMPLE_RATE)), tone(440, .5)])
            for lyrics in (word_lyrics([(0, 1 + gap, "la")]),
                           [{"time": 0, "duration": round((1 + gap) * 1000), "text": "one line"}]):
                guide = worker.make_guide(audio, "yin", lyrics, progress=False)
                self.assertEqual([n["midi"] for n in guide["notes"]], [69, 69])
                # Exclude the 32 ms analysis-window transition on either side.
                for note in guide["notes"]:
                    self.assertTrue(note["end"] <= .54 or note["start"] >= .5 + gap - .04,
                                    str(guide["notes"]))
                center = .5 + gap / 2
                self.assertFalse(any(n["start"] <= center < n["end"] for n in guide["notes"]))
                self.assertEqual(next(m for t, m in guide["contour"] if abs(t - round(center / .02) * .02) < .001), 0)

    def test_short_dropouts_need_raw_pitch_confidence_and_energy_evidence(self):
        for reason in ('weak-pitch', 'quiet', 'aperiodic', 'different-pitch', 'long-gap'):
            length = 8 if reason == 'long-gap' else 3
            frequency = np.full(100, 440.)
            confidence = np.full(100, .98)
            rms = np.full(100, .1)
            confidence[40:40 + length] = .79
            if reason == 'quiet':
                rms[40:40 + length] = 0
            if reason == 'aperiodic':
                frequency[40:40 + length] = 0
            if reason == 'different-pitch':
                frequency[40:40 + length] = 523.25
            midi, voiced = worker.voiced_midi(frequency, confidence, rms, .8)
            worker.clean(midi, voiced, confidence, .8, frequency=frequency, rms=rms)
            self.assertEqual(bool(np.all(voiced[40:40 + length])), reason == 'weak-pitch')

    def test_rest_splits_notes_before_short_piece_merging(self):
        # Two reliably voiced 80ms notes are separated by a real 200ms breath.
        # They must not disappear into one long note or merge across the breath.
        midi = np.r_[np.full(8, 60.), np.zeros(20), np.full(8, 72.)]
        notes = worker.cut_notes(midi, midi > 0, [(0, 0, 0, .36)], 0)
        self.assertEqual([n["midi"] for n in notes], [60, 72])
        self.assertLessEqual(notes[0]["end"], .08)
        self.assertGreaterEqual(notes[1]["start"], .28)

    def test_auto_falls_back_when_optional_model_is_broken(self):
        with patch.object(worker, "crepe_available", return_value=True), patch.object(worker, "crepe_track", side_effect=RuntimeError("bad optional installation")):
            guide = worker.make_guide(tone(440), "auto", progress=False)
            self.assertEqual(guide["algorithm"], "yin-cpu")
            self.assertIn("torchcrepe-runtime-unavailable", guide["limitations"])
            with self.assertRaises(RuntimeError):
                worker.make_guide(tone(440), "torchcrepe", progress=False)

    def test_explicit_model_requirement_is_honest(self):
        with patch.object(worker, "crepe_available", return_value=False):
            with self.assertRaises(ModuleNotFoundError):
                worker.make_guide(tone(440), "torchcrepe", progress=False)


if __name__ == "__main__":
    unittest.main()

