#!/usr/bin/env python3
"""Offline, CPU-only practice guide extraction from an isolated vocal (never the mix).

Notes are cut by lyric timing: with word-level lyrics one sung word becomes one
block (split again only for real melisma); with line-level lyrics the whole
line is the window and the pitch track decides the cuts.  Without lyrics the
voiced runs themselves are the windows.

torchcrepe's bundled tiny weights are used when installed; the independent YIN
fallback uses only NumPy.  This worker never installs packages, downloads
weights or touches the GPU.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
from pathlib import Path
import sys
import time
import wave

for _key in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ[_key] = "1"

import numpy as np

SCHEMA_VERSION = 2
ALGORITHM_VERSION = "practice-pitch-2"
SAMPLE_RATE = 16000
HOP = 160                 # 10 ms
HOP_SECONDS = HOP / SAMPLE_RATE
CONTOUR_STEP = 2          # contour output every 20 ms
MAX_SECONDS = 1200
MIN_HZ = 65.0
MAX_HZ = 1100.0

# Note cutting (frames of 10 ms)
MIN_VOICED_IN_WORD = 6    # < 60 ms voiced in a word: breath / consonant, no block
SPLIT_DEVIATION = 0.8     # semitones away from the running note …
SPLIT_SUSTAIN = 8         # … for 80 ms starts a new note
MIN_PIECE = 15            # pieces under 150 ms join their longer neighbour (glides, passing tones)
MAX_BRIDGE_GAP = 15       # bridge unvoiced gaps up to 150 ms when both sides agree
BRIDGE_AGREEMENT = 2.0    # … within 2 semitones
OCTAVE_CONTEXT = 100      # ±1 s context for octave correction
TUNING_THRESHOLD = 0.10   # correct global tuning only beyond 10 cents


def emit(value):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False), flush=True)


def read_wav(filename):
    with wave.open(str(filename), "rb") as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2 or source.getframerate() != SAMPLE_RATE:
            raise ValueError("Decoded vocal must be mono 16-bit PCM at 16000 Hz")
        frames = source.getnframes()
        if frames <= 0:
            raise ValueError("The vocal contains no samples")
        if frames > MAX_SECONDS * SAMPLE_RATE:
            raise OverflowError("The vocal exceeds the 20-minute practice guide limit")
        data = source.readframes(frames)
        if len(data) != frames * 2:
            raise ValueError("Decoded vocal is truncated")
    return np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0


# ── pitch extraction ─────────────────────────────────────────────────────────

def frame_rms(audio, count):
    padded = np.pad(audio, (512, 512))
    return np.asarray([math.sqrt(float(np.mean(padded[i * HOP:i * HOP + 1024] ** 2))) for i in range(count)])


def yin_track(audio, progress=True):
    """YIN cumulative-mean-normalized difference, fixed comparison window.

    FFT correlation avoids the O(window * max-lag) Python/array allocation at
    every hop. The first threshold crossing avoids choosing octave subharmonics
    simply because their later minima are a little deeper.
    """
    window = 1024
    max_tau = min(window // 2, int(SAMPLE_RATE / MIN_HZ))
    min_tau = max(2, int(SAMPLE_RATE / MAX_HZ))
    comparison = window - max_tau
    padded = np.pad(audio, (window // 2, window // 2))
    count = int(math.ceil(len(audio) / HOP))
    f0 = np.zeros(count, dtype=np.float64)
    confidence = np.zeros(count, dtype=np.float64)
    fft_size = 1 << (2 * window - 1).bit_length()
    lags = np.arange(1, max_tau + 1)
    last_progress = -1
    for index in range(count):
        segment = padded[index * HOP:index * HOP + window].astype(np.float64)
        segment -= segment.mean()
        if math.sqrt(float(np.mean(segment * segment))) >= 0.0005:
            prefix = np.zeros(window, dtype=np.float64)
            prefix[:comparison] = segment[:comparison]
            correlation = np.fft.irfft(np.fft.rfft(segment, fft_size) * np.conj(np.fft.rfft(prefix, fft_size)), fft_size)
            energy = np.concatenate(([0.0], np.cumsum(segment * segment)))
            difference = np.maximum(0.0, energy[comparison] + energy[lags + comparison] - energy[lags] - 2.0 * correlation[lags])
            cumulative = np.cumsum(difference)
            cmnd = np.ones(max_tau + 1, dtype=np.float64)
            cmnd[1:] = difference * lags / np.maximum(cumulative, 1e-15)
            tau = None
            for candidate in range(min_tau, max_tau):
                if cmnd[candidate] < 0.15:
                    while candidate + 1 <= max_tau and cmnd[candidate + 1] < cmnd[candidate]:
                        candidate += 1
                    tau = candidate
                    break
            if tau is None:
                candidate = int(np.argmin(cmnd[min_tau:max_tau + 1])) + min_tau
                if cmnd[candidate] < 0.25:
                    tau = candidate
            if tau is not None:
                refined = float(tau)
                if 1 < tau < max_tau:
                    left, center, right = cmnd[tau - 1:tau + 2]
                    denominator = left - 2.0 * center + right
                    shift = (0.5 * (left - right) / denominator) if abs(denominator) > 1e-12 else 0.0
                    if abs(shift) <= 1.0:
                        refined += float(shift)
                hz = SAMPLE_RATE / refined
                if MIN_HZ <= hz <= MAX_HZ:
                    f0[index] = hz
                    confidence[index] = max(0.0, min(1.0, 1.0 - float(cmnd[tau])))
        current = int((index + 1) * 80 / max(1, count))
        if progress and current // 5 != last_progress:
            last_progress = current // 5
            emit({"type": "progress", "stage": "analyzing", "progress": current})
    return f0, confidence, frame_rms(audio, count)


def crepe_available():
    if importlib.util.find_spec("torch") is None:
        return False
    spec = importlib.util.find_spec("torchcrepe")
    if spec is None or spec.origin is None:
        return False
    return (Path(spec.origin).parent / "assets" / "tiny.pth").is_file()


def crepe_track(audio):
    import torch
    import torchcrepe

    # 預設 2 條執行緒：約快一倍，又不至於在直播中把 CPU 吃滿（ELITESAND_PRACTICE_THREADS 可調）
    threads = max(1, min(8, int(os.environ.get("ELITESAND_PRACTICE_THREADS") or 2)))
    torch.set_num_threads(threads)
    torch.set_num_interop_threads(1)
    with torch.inference_mode():
        frequency, periodicity = torchcrepe.predict(
            torch.from_numpy(audio)[None], SAMPLE_RATE, HOP, fmin=MIN_HZ,
            fmax=MAX_HZ, model="tiny", batch_size=256, device="cpu",
            decoder=torchcrepe.decode.viterbi, return_periodicity=True,
        )
        periodicity = torchcrepe.filter.median(periodicity, 3)
    frequency = frequency[0].cpu().numpy().astype(np.float64)
    periodicity = periodicity[0].cpu().numpy().astype(np.float64)
    count = min(len(frequency), int(math.ceil(len(audio) / HOP)))
    return frequency[:count], periodicity[:count], frame_rms(audio, count)


def extract(audio, algorithm, progress=True):
    selected = algorithm
    if algorithm == "auto":
        selected = "torchcrepe" if crepe_available() else "yin"
    fallback = None
    if selected == "torchcrepe":
        if not crepe_available():
            raise ModuleNotFoundError("torchcrepe tiny and its bundled weights are not installed")
        try:
            if progress:
                emit({"type": "progress", "stage": "analyzing", "progress": 10})
            frequency, confidence, rms = crepe_track(audio)
            if progress:
                emit({"type": "progress", "stage": "analyzing", "progress": 80})
            return frequency, confidence, rms, "torchcrepe-tiny-cpu", None, 0.45
        except Exception:
            if algorithm != "auto":
                raise
            fallback = "torchcrepe-runtime-unavailable"
    frequency, confidence, rms = yin_track(audio, progress=progress)
    return frequency, confidence, rms, "yin-cpu", fallback, 0.8


def voiced_midi(frequency, confidence, rms, min_confidence):
    gate = max(0.004, float(np.percentile(rms, 90)) * 0.06) if len(rms) else 0.004
    voiced = (frequency >= MIN_HZ) & (frequency <= MAX_HZ) & (confidence >= min_confidence) & (rms >= gate)
    midi = np.zeros(len(frequency), dtype=np.float64)
    midi[voiced] = 69.0 + 12.0 * np.log2(frequency[voiced] / 440.0)
    return midi, voiced


# ── cleanup ──────────────────────────────────────────────────────────────────

def runs(mask):
    """[(start, end)] of contiguous True runs, end exclusive."""
    out, i, n = [], 0, len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j < n and mask[j]:
                j += 1
            out.append((i, j))
            i = j
        else:
            i += 1
    return out


def clean(midi, voiced):
    """Bridge consonant gaps, fix octave slips from context, flatten single-frame spikes.

    Returns the global tuning offset in semitones (0 when within the threshold).
    """
    n = len(midi)
    for a, b in runs(~voiced):
        if a == 0 or b >= n or b - a > MAX_BRIDGE_GAP:
            continue
        left, right = midi[a - 1], midi[b]
        if abs(left - right) <= BRIDGE_AGREEMENT:
            midi[a:b] = np.linspace(left, right, b - a + 2)[1:-1]
            voiced[a:b] = True
    for a, b in runs(voiced):
        lo, hi = max(0, a - OCTAVE_CONTEXT), min(n, b + OCTAVE_CONTEXT)
        context = np.concatenate((midi[lo:a][voiced[lo:a]], midi[b:hi][voiced[b:hi]]))
        if len(context) < 20:
            continue
        offset = float(np.median(midi[a:b])) - float(np.median(context))
        for k in (12.0, -12.0):
            if abs(offset - k) < 2.5:
                midi[a:b] -= k
                break
    for i in range(2, n - 2):
        if voiced[i] and voiced[i - 2] and voiced[i + 2] and abs(midi[i - 2] - midi[i + 2]) < 1:
            neighbour = (midi[i - 2] + midi[i + 2]) / 2
            if abs(midi[i] - neighbour) > 3:
                midi[i] = neighbour
    stable = [i for i in range(1, n - 1) if voiced[i - 1] and voiced[i] and voiced[i + 1] and abs(midi[i + 1] - midi[i - 1]) < 0.15]
    if len(stable) > 200:
        angle = 2 * np.pi * (midi[stable] % 1.0)
        mean = float(np.angle(np.mean(np.exp(1j * angle))) / (2 * np.pi))
        if abs(mean) > TUNING_THRESHOLD:
            return mean
    return 0.0


# ── note cutting ─────────────────────────────────────────────────────────────

def pieces_in(midi, voiced, a, b):
    """Split one lyric window into stable-pitch pieces; glides join the longer neighbour."""
    ids = [i for i in range(a, b) if voiced[i]]
    if len(ids) < MIN_VOICED_IN_WORD:
        return []
    segments, current, off = [], [ids[0]], []
    for i in ids[1:]:
        reference = float(np.median(midi[current[-12:]]))
        if abs(midi[i] - reference) > SPLIT_DEVIATION:
            off.append(i)
            if len(off) >= SPLIT_SUSTAIN:
                segments.append(current)
                current, off = off, []
        else:
            current.extend(off)
            off = []
            current.append(i)
    current.extend(off)
    segments.append(current)
    pieces = [{"ids": list(s), "pitch": float(np.median(midi[s]))} for s in segments]
    while len(pieces) > 1:
        sizes = [len(p["ids"]) for p in pieces]
        k = min(range(len(pieces)), key=lambda j: sizes[j])
        if sizes[k] >= MIN_PIECE:
            break
        if k == 0:
            j = 1
        elif k == len(pieces) - 1:
            j = k - 1
        else:
            j = k - 1 if sizes[k - 1] >= sizes[k + 1] else k + 1
        pieces[j] = {"ids": sorted(pieces[k]["ids"] + pieces[j]["ids"]), "pitch": pieces[j]["pitch"]}
        pieces.pop(k)
    return pieces


def lyric_windows(lyrics, offset_ms, duration):
    """[(line_index, word_index, start, end, text)] in audio seconds, plus the public line list.

    The app stores lyric offsets as "lyric time = audio time + offset", so the
    audio time of a lyric timestamp is the timestamp minus the offset.
    """
    shift = (offset_ms or 0) / 1000.0
    windows, lines = [], []
    for raw in lyrics or []:
        base = float(raw.get("time", 0)) / 1000.0 - shift
        words = []
        for word in raw.get("words") or []:
            start = base + float(word.get("start", 0)) / 1000.0
            end = start + max(0.0, float(word.get("duration", 0)) / 1000.0)
            if end > start:
                words.append({"text": str(word.get("text", "")), "start": start, "end": end})
        if not words:
            # Line-level lyrics: the whole line is one window; pitch decides the cuts.
            length = float(raw.get("duration") or 0) / 1000.0
            end = base + length if length > 0 else None
            words = [{"text": str(raw.get("text", "")), "start": base, "end": end}]
        lines.append({"text": str(raw.get("text", "")), "words": words})
    # Line-level lines without a duration end where the next line begins.
    for index, line in enumerate(lines):
        last = line["words"][-1]
        if last["end"] is None:
            following = lines[index + 1]["words"][0]["start"] if index + 1 < len(lines) else duration
            last["end"] = min(following, last["start"] + 12.0)
    public = []
    for index, line in enumerate(lines):
        words = [w for w in line["words"] if w["end"] > w["start"] and w["end"] > 0 and w["start"] < duration]
        if not words:
            continue
        line_index = len(public)
        for word_index, word in enumerate(words):
            windows.append((line_index, word_index, max(0.0, word["start"]), min(duration, word["end"])))
        public.append({"start": round(max(0.0, words[0]["start"]), 3), "end": round(min(duration, words[-1]["end"]), 3),
                       "text": line["text"], "words": [{"text": w["text"], "start": round(w["start"], 3), "end": round(w["end"], 3)} for w in words]})
    return windows, public


def cut_notes(midi, voiced, windows, tuning):
    n = len(midi)
    t = np.arange(n) * HOP_SECONDS
    to_index = lambda sec: int(np.clip(round(sec / HOP_SECONDS), 0, n))
    notes = []
    for line_index, word_index, start, end in windows:
        pieces = pieces_in(midi, voiced, to_index(start), to_index(end))
        for k, piece in enumerate(pieces):
            ids, raw = piece["ids"], piece["pitch"]
            note_start = float(t[ids[0]]) if k else max(start, float(t[ids[0]]) - 0.03)
            note_end = float(t[ids[-1]]) + HOP_SECONDS
            if k == len(pieces) - 1:
                note_end = min(end, max(note_end, float(t[ids[-1]]) + 0.03))
            if note_end - note_start < 0.06:
                continue
            notes.append({"start": round(note_start, 3), "end": round(note_end, 3), "midi": int(round(raw - tuning)),
                          "raw": round(raw, 2), "line": line_index, "word": word_index, "cont": k > 0})
    merged = []
    for note in notes:
        previous = merged[-1] if merged else None
        if (previous and previous["line"] == note["line"] and previous["word"] == note["word"]
                and previous["midi"] == note["midi"] and note["start"] - previous["end"] < 0.04):
            previous["end"] = note["end"]
        else:
            merged.append(note)
    merged.sort(key=lambda note: (note["start"], note["end"]))
    return merged


def make_guide(audio, algorithm="auto", lyrics=None, offset_ms=0.0, progress=True):
    started = time.monotonic()
    duration = len(audio) / SAMPLE_RATE
    frequency, confidence, rms, method, fallback, min_confidence = extract(audio, algorithm, progress)
    midi, voiced = voiced_midi(frequency, confidence, rms, min_confidence)
    voiced_raw = float(voiced.sum()) * HOP_SECONDS
    tuning = clean(midi, voiced)
    windows, lines = lyric_windows(lyrics, offset_ms, duration)
    limitations = ["experimental-single-voice"]
    if not windows:
        # No lyrics at all: every voiced run is a window.
        windows = [(0, 0, a * HOP_SECONDS, b * HOP_SECONDS) for a, b in runs(voiced)]
        lines = []
        limitations.append("no-lyrics")
    notes = cut_notes(midi, voiced, windows, tuning)
    if fallback:
        limitations.append(fallback)
    contour = [[round(i * HOP_SECONDS, 2), round(float(midi[i]), 2) if voiced[i] else 0] for i in range(0, len(midi), CONTOUR_STEP)]
    if progress:
        emit({"type": "progress", "stage": "analyzing", "progress": 95})
    return {"schemaVersion": SCHEMA_VERSION, "algorithmVersion": ALGORITHM_VERSION, "algorithm": method,
            "hopSeconds": HOP_SECONDS, "contourSeconds": HOP_SECONDS * CONTOUR_STEP, "sampleRate": SAMPLE_RATE,
            "duration": round(duration, 3), "tuning": round(tuning, 3), "lyricOffsetMs": float(offset_ms or 0),
            "voicedSeconds": round(min(voiced_raw, duration), 3), "lines": lines, "notes": notes, "contour": contour,
            "analysisSeconds": round(time.monotonic() - started, 3), "limitations": limitations}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--algorithm", choices=("auto", "yin", "torchcrepe"), default="auto")
    parser.add_argument("--lyrics", help="JSON file: {\"lines\": parsed lyric lines, \"offsetMs\": number}")
    args = parser.parse_args()
    try:
        audio = read_wav(args.input)
        lyrics, offset_ms = None, 0.0
        if args.lyrics:
            with open(args.lyrics, encoding="utf-8") as source:
                payload = json.load(source)
            lyrics = payload.get("lines") or []
            offset_ms = float(payload.get("offsetMs") or 0)
        guide = make_guide(audio, args.algorithm, lyrics, offset_ms)
        with open(args.output, "w", encoding="utf-8") as output:
            json.dump(guide, output, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        emit({"type": "result", "notes": len(guide["notes"]), "algorithm": guide["algorithm"]})
    except Exception as error:
        code = "GUIDE_TOO_LONG" if isinstance(error, OverflowError) else "PITCH_MODEL_UNAVAILABLE" if isinstance(error, ModuleNotFoundError) else "GUIDE_ANALYSIS_FAILED"
        emit({"type": "error", "code": code, "message": str(error)[:300]})
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
