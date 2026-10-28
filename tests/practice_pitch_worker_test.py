"""Independent acoustic checks for the offline CPU pitch worker."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

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
        glide = np.concatenate([tone(392.0, 0.08), tone(440.0, 0.62)])
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

    def test_octave_slip_is_corrected_from_context(self):
        # 中間一小段被抓成高八度（偵測常見錯誤）：前後一致時要搬回來
        midi = np.full(300, 69.0); midi[140:160] = 81.0
        voiced = np.ones(300, dtype=bool); voiced[138:140] = False; voiced[160:162] = False
        worker.clean(midi, voiced)
        self.assertTrue(np.all(np.abs(midi[140:160] - 69.0) < 0.01))

    def test_short_consonant_gaps_are_bridged_but_real_rests_are_not(self):
        midi = np.full(200, 69.0); voiced = np.ones(200, dtype=bool)
        voiced[50:60] = False       # 100 ms：子音，補起來
        voiced[120:160] = False     # 400 ms：真的休止，不補
        worker.clean(midi, voiced)
        self.assertTrue(np.all(voiced[50:60]))
        self.assertFalse(np.any(voiced[120:160]))

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
