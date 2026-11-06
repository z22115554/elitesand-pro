#!/usr/bin/env python3
"""Offline practice guide extraction from an isolated vocal (never the mix).

Notes are cut by lyric timing: with word-level lyrics one sung word becomes one
block (split again only for real melisma); with line-level lyrics the whole
line is the window and the pitch track decides the cuts.  Without lyrics the
voiced runs themselves are the windows.

torchcrepe's bundled tiny weights are used when installed; the independent YIN
fallback uses only NumPy. CUDA is preferred when available, with same-model
CPU retry on failure. This worker never installs packages or downloads weights.
"""
from __future__ import annotations

import argparse
import importlib.util
import heapq
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
ALGORITHM_VERSION = "practice-pitch-8"
SAMPLE_RATE = 16000
HOP = 160                 # 10 ms
HOP_SECONDS = HOP / SAMPLE_RATE
VOICING_WINDOW = 320      # 20 ms local waveform evidence; pitch still uses 1024 samples
YIN_ENERGY_WINDOW = 640   # 40 ms: over two periods at the 65 Hz lower bound
CONTOUR_STEP = 2          # contour output every 20 ms
MAX_SECONDS = 1200
MIN_HZ = 65.0
MAX_HZ = 1400.0            # shared with the live YIN; below CREPE's native 2006 Hz ceiling

# Note cutting (frames of 10 ms)
MIN_VOICED_IN_WORD = 6    # < 60 ms voiced in a word: breath / consonant, no block
NOTE_CHANGE_COST = 12.0   # squared-semitone fit cost; same cost for any pitch jump
STABLE_NOTE_CHANGE_COST = 2.5  # a measured 60ms plateau can establish a short note
STABLE_NOTE_SPREAD = 0.25      # semitones across that plateau, independent of register
STABLE_NOTE_STEP = 0.8         # old and new stable observations must actually differ
NOTE_RESIDUAL_CAP = 5.0  # six clear frames can outweigh two ordinary change costs
UNCERTAIN_NOTE_CHANGE_COST = 36.0  # brief marginal plateaus need more accumulated evidence
MAX_MERGED_CENTER_DEVIATION = 3.0  # reject grossly unrepresentative inherited centers
MIN_PIECE = 15            # only unstable pieces under 150 ms join their neighbour
MAX_SPIKE_FRAMES = 4      # only <= 40 ms weak-confidence islands can be repaired
MAX_DROPOUT_FRAMES = 4    # <= 40 ms, only with agreeing raw pitch and non-quiet audio
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

def frame_rms(audio, count, window=1024):
    padded = np.pad(audio, (window // 2, window // 2))
    frames = np.lib.stride_tricks.sliding_window_view(padded, window)[::HOP][:count]
    # A view and an inner product avoid allocating a count-by-window square
    # matrix or thousands of per-hop temporary arrays on long recordings.
    return np.sqrt(np.einsum('ij,ij->i', frames, frames, dtype=np.float64) / window)


def voicing_features(audio, frequency, confidence, rms, min_confidence, method):
    """Local waveform evidence for a fade/breath or a weak measured pitch.

    YIN uses a 40ms energy aperture. CREPE retains its 64ms energy context;
    shortening both indiscriminately loses quiet professional singing. Only
    questionable neural fades and marginal-confidence frames need a local
    periodicity check. No alternative F0 is synthesized or selected here.
    """
    count = len(frequency)
    local = frame_rms(audio, count, VOICING_WINDOW)
    if method == 'yin-cpu':
        energy = frame_rms(audio, count, YIN_ENERGY_WINDOW)
        fading = np.zeros(count, dtype=bool)
    else:
        energy = rms.copy()
        fading = local < rms * 0.75
    gate = max(0.004, float(np.percentile(energy, 90)) * 0.06) if count else 0.004
    weak = ((energy >= .0006) & (energy < gate) & (confidence >= max(.85, min_confidence + .05))
            if method.startswith("torchcrepe-") else np.zeros(count, dtype=bool))
    marginal = (confidence < min_confidence) & (confidence >= min_confidence - 0.05)
    periodicity = np.zeros(count, dtype=np.float64)
    selected = (fading | marginal | weak) & (frequency >= MIN_HZ) & (frequency <= MAX_HZ)
    padded = np.pad(audio, (512, 512))
    for i in np.flatnonzero(selected):
        lag = int(round(SAMPLE_RATE / frequency[i]))
        start = i * HOP + 512 - VOICING_WINDOW // 2 - lag // 2
        left = padded[start:start + VOICING_WINDOW].astype(np.float64)
        right = padded[start + lag:start + lag + VOICING_WINDOW].astype(np.float64)
        left -= left.mean()
        right -= right.mean()
        power = float(np.dot(left, left) + np.dot(right, right))
        agreement = float(2 * np.dot(left, right) / power) if power > 1e-15 else 0.0
        periodicity[i] = max(0.0, min(1.0, agreement))
        if agreement < 0.2:
            energy[i] = 0  # silence/aperiodic center; do not let clean() fill it again
    return energy, periodicity


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


_CREPE_TRANSITIONS = {}
_CREPE_PATH = None
_CREPE_PATH_CHECKED = False


def crepe_viterbi_path(log_probabilities, indices, band, initial, far_cost):
    """Scalar band recurrence; compiled without fast-math or parallel threads."""
    states, steps = log_probabilities.shape
    previous = log_probabilities[:, 0] + initial
    following = np.empty(states, dtype=np.float64)
    pointers = np.empty((steps, states), dtype=np.int16)
    for frame in range(1, steps):
        global_bin = int(np.argmax(previous))
        far = previous[global_bin] + far_cost
        for target in range(states):
            best = far
            chosen = global_bin
            for offset in range(indices.shape[1]):
                predecessor = indices[target, offset]
                candidate = previous[predecessor] + band[target, offset]
                if candidate > best or (candidate == best and predecessor < chosen):
                    best = candidate
                    chosen = predecessor
            pointers[frame, target] = chosen
            following[target] = log_probabilities[target, frame] + best
        previous, following = following, previous
    path = np.empty(steps, dtype=np.int64)
    path[-1] = np.argmax(previous)
    for frame in range(steps - 1, 0, -1):
        path[frame - 1] = pointers[frame, path[frame]]
    return path


def crepe_viterbi_bins(probabilities, accelerate=False):
    """Exact torchcrepe 0.0.24 transition decoding without its dense decoder.

    Keep the original epsilon transitions too: every zero-weight edge has the
    same cost, so its best predecessor is covered by one global maximum. The
    remaining edges form a 23-wide band. Ties always choose the lowest bin.
    """
    states, steps = probabilities.shape
    if states != 360 or steps < 1 or probabilities.dtype not in (np.float32, np.float64):
        raise ValueError("Unexpected CREPE probability shape or dtype")
    if not np.all(np.isfinite(probabilities)) or np.any(probabilities < 0) or np.any(probabilities > 1):
        raise ValueError("Invalid CREPE probabilities")
    dtype = probabilities.dtype
    if dtype not in _CREPE_TRANSITIONS:
        epsilon = np.finfo(dtype).tiny
        rows = np.arange(states)
        predecessors = rows[:, None] + np.arange(-11, 12)
        valid = (predecessors >= 0) & (predecessors < states)
        indices = np.clip(predecessors, 0, states - 1)
        weights = np.maximum(12 - np.abs(rows[:, None] - rows), 0)
        totals = weights.sum(axis=1)
        band = np.log((12 - np.abs(predecessors - rows[:, None])) / totals[indices] + float(epsilon))
        band[~valid] = -np.inf
        initial = np.log(np.full(states, 1 / states) + epsilon)
        _CREPE_TRANSITIONS[dtype] = rows, indices, band, initial, np.log(float(epsilon))
    rows, indices, band, initial, far_cost = _CREPE_TRANSITIONS[dtype]
    log_probabilities = np.log(probabilities + np.finfo(dtype).tiny)
    global _CREPE_PATH, _CREPE_PATH_CHECKED
    if accelerate and not _CREPE_PATH_CHECKED:
        _CREPE_PATH_CHECKED = True
        try:
            from numba import njit
            _CREPE_PATH = njit(cache=False)(crepe_viterbi_path)
        except Exception:
            pass  # Optional acceleration; the exact NumPy path remains available.
    if accelerate and _CREPE_PATH is not None:
        try:
            return _CREPE_PATH(log_probabilities, indices, band, initial, far_cost)
        except Exception:
            _CREPE_PATH = None  # A broken accelerator must not switch pitch models.
    previous = log_probabilities[:, 0] + initial
    pointers = np.empty((steps, states), dtype=np.int16)
    for frame in range(1, steps):
        candidates = previous[indices] + band
        offsets = candidates.argmax(axis=1)
        chosen = indices[rows, offsets]
        best = candidates[rows, offsets]
        global_bin = int(previous.argmax())
        far = previous[global_bin] + far_cost
        use_far = (far > best) | ((far == best) & (global_bin < chosen))
        chosen[use_far] = global_bin
        best[use_far] = far
        pointers[frame] = chosen
        previous = log_probabilities[:, frame] + best
    path = np.empty(steps, dtype=np.int64)
    path[-1] = previous.argmax()
    for frame in range(steps - 1, 0, -1):
        path[frame - 1] = pointers[frame, path[frame]]
    return path


def crepe_viterbi(logits):
    import torch
    import torchcrepe

    probabilities = torch.softmax(logits, dim=1)
    bins = torch.tensor(np.stack([crepe_viterbi_bins(sequence, accelerate=True) for sequence in probabilities.cpu().numpy()]),
                        device=probabilities.device)
    return bins, torchcrepe.convert.bins_to_frequency(bins)


def crepe_device(torch):
    if os.environ.get("ELITESAND_PRACTICE_DEVICE", "auto").strip().lower() == "cpu":
        return "cpu"
    try:
        return "cuda:0" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def crepe_track(audio, progress=True):
    import torch
    import torchcrepe

    # 預設 2 條執行緒：約快一倍，又不至於在直播中把 CPU 吃滿（ELITESAND_PRACTICE_THREADS 可調）
    threads = max(1, min(8, int(os.environ.get("ELITESAND_PRACTICE_THREADS") or 2)))
    torch.set_num_threads(threads)
    torch.set_num_interop_threads(1)

    def predict(device):
        if progress:
            emit({"type": "device", "device": "cuda" if device.startswith("cuda") else "cpu"})
        if device.startswith("cuda"):
            torch.backends.cuda.matmul.allow_tf32 = False
            torch.backends.cudnn.allow_tf32 = False
        return torchcrepe.predict(
            torch.from_numpy(audio)[None], SAMPLE_RATE, HOP, fmin=MIN_HZ,
            fmax=MAX_HZ, model="tiny", batch_size=256, device=device,
            decoder=crepe_viterbi, return_periodicity=True,
        )

    device = crepe_device(torch)
    fallback = None
    with torch.inference_mode():
        if device.startswith("cuda"):
            random_state = np.random.get_state()
            try:
                frequency, periodicity = predict(device)
            except Exception:
                # Discard the cached CUDA model before retrying: moving a failed
                # CUDA model to CPU can itself fail after a driver/kernel error.
                np.random.set_state(random_state)
                if hasattr(torchcrepe.infer, "model"):
                    del torchcrepe.infer.model
                device = "cpu"
                fallback = "cuda-runtime-unavailable-used-cpu"
            # The exception traceback can retain CUDA activations. Release the
            # allocator cache only after leaving the exception handler.
            if fallback:
                try:
                    torch.cuda.empty_cache()
                except Exception:
                    pass
        if device == "cpu":
            frequency, periodicity = predict("cpu")
        periodicity = torchcrepe.filter.median(periodicity, 3)
    frequency = frequency[0].cpu().numpy().astype(np.float64)
    periodicity = periodicity[0].cpu().numpy().astype(np.float64)
    count = min(len(frequency), int(math.ceil(len(audio) / HOP)))
    method = "torchcrepe-tiny-cuda" if device.startswith("cuda") else "torchcrepe-tiny-cpu"
    return frequency[:count], periodicity[:count], frame_rms(audio, count), method, fallback


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
            frequency, confidence, rms, method, device_fallback = crepe_track(audio, progress=progress)
            if progress:
                emit({"type": "progress", "stage": "analyzing", "progress": 80})
            return frequency, confidence, rms, method, device_fallback, 0.45
        except Exception:
            if algorithm != "auto":
                raise
            fallback = "torchcrepe-runtime-unavailable"
    frequency, confidence, rms = yin_track(audio, progress=progress)
    return frequency, confidence, rms, "yin-cpu", fallback, 0.8


def voiced_midi(frequency, confidence, rms, min_confidence, local_periodicity=None):
    gate = max(0.004, float(np.percentile(rms, 90)) * 0.06) if len(rms) else 0.004
    valid = (frequency >= MIN_HZ) & (frequency <= MAX_HZ)
    voiced = valid & (confidence >= min_confidence) & (rms >= gate)
    midi = np.zeros(len(frequency), dtype=np.float64)
    midi[valid] = 69.0 + 12.0 * np.log2(frequency[valid] / 440.0)
    # Recover measured weak onsets/tails only within half a pitch window of a
    # three-frame reliable, stable anchor. Snapshot anchors prevent cascading
    # through a long low-confidence interval. Never invent F0 or bridge silence.
    stable = np.zeros(len(midi), dtype=bool)
    close = np.abs(np.diff(midi)) <= 0.5
    stable[1:-1] = voiced[:-2] & voiced[1:-1] & voiced[2:] & close[:-1] & close[1:]
    supported = np.zeros(len(midi), dtype=bool)
    for shift in range(1, 4):
        supported[shift:] |= stable[:-shift] & (np.abs(midi[shift:] - midi[:-shift]) <= 0.5)
        supported[:-shift] |= stable[shift:] & (np.abs(midi[:-shift] - midi[shift:]) <= 0.5)
    if local_periodicity is not None:
        voiced |= valid & supported & (local_periodicity >= 0.8) & (confidence >= min_confidence - 0.05) & (rms >= gate)
    if local_periodicity is not None and len(midi):
        # Frozen strong anchors cannot be extended by recovered observations.
        strong = stable & (confidence >= min_confidence + .05)
        ids = np.arange(len(midi))
        left = np.maximum.accumulate(np.where(strong, ids, -len(midi)))
        right = np.minimum.accumulate(np.where(strong, ids, 2 * len(midi))[::-1])[::-1]
        near = np.zeros(len(midi), dtype=bool)
        for anchors in (left, right):
            bounded = (anchors >= 0) & (anchors < len(midi)) & (np.abs(ids - anchors) <= 50)
            near |= bounded & (np.abs(midi - midi[np.clip(anchors, 0, len(midi)-1)]) <= .5)
        weak = (~voiced) & valid & near & (rms >= .0006) & (local_periodicity >= .8) & (confidence >= max(.85, min_confidence + .05))
        # Require a measured 60ms plateau with at most 6dB energy spread; never fill a rest.
        for a, b in runs(weak):
            if (b - a >= MIN_VOICED_IN_WORD and np.all(np.abs(np.diff(midi[a:b])) <= .5)
                    and float(np.max(rms[a:b])) <= 2 * float(np.min(rms[a:b]))):
                voiced[a:b] = True
    midi[~voiced] = 0
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


def clean(midi, voiced, confidence=None, min_confidence=0.8, frequency=None, rms=None):
    """Suppress brief pitch spikes without inventing voice across rests.

    Pitch alone cannot distinguish a real octave phrase from a sustained detector
    error. Never transpose a voiced run to match the surrounding register. Only
    an isolated frame (or <=40 ms with substantially weaker confidence) enclosed
    by contiguous, stable, agreeing flanks is repaired. High-confidence notes,
    slides, sustained jumps and phrases separated by breaths remain untouched.
    A short detector dropout can be recovered only when the original frequency,
    confidence and energy support that pitch; neighbours alone never fill a gap.

    Returns the global tuning offset in semitones (0 when within the threshold).
    """
    n = len(midi)
    original = midi.copy()  # prevent an earlier repair from becoming evidence for another
    for start, end in runs(voiced):
        boundaries = [start] + (np.flatnonzero(np.abs(np.diff(original[start:end])) > 3.0) + start + 1).tolist() + [end]
        for a, b in zip(boundaries, boundaries[1:]):
            length = b - a
            if length > MAX_SPIKE_FRAMES or a - start < 3 or end - b < 3:
                continue
            left, right = original[a - 3:a], original[b:b + 3]
            if np.ptp(left) > 0.5 or np.ptp(right) > 0.5 or abs(float(np.median(left) - np.median(right))) > 0.5:
                continue
            if np.ptp(original[a:b]) > 0.75:
                continue
            if length > 1:
                if confidence is None:
                    continue
                flank = min(float(np.median(confidence[a - 3:a])), float(np.median(confidence[b:b + 3])))
                if flank < min_confidence + 0.05 or float(np.max(confidence[a:b])) >= flank - 0.15:
                    continue
            midi[a:b] = np.linspace(float(np.median(left)), float(np.median(right)), length + 2)[1:-1]
    if frequency is not None and rms is not None and confidence is not None:
        gate = max(0.004, float(np.percentile(rms, 90)) * 0.06) if len(rms) else 0.004
        for a, b in runs(~voiced):
            if a < 3 or b + 3 > n or b - a > MAX_DROPOUT_FRAMES:
                continue
            if not np.all(voiced[a - 3:a]) or not np.all(voiced[b:b + 3]):
                continue
            if (not np.all(confidence[a - 3:a] >= min_confidence)
                    or not np.all(confidence[b:b + 3] >= min_confidence)):
                continue  # recovered weak edges cannot become anchors for another recovery
            if not (np.all(rms[a - 3:a] >= gate) and np.all(rms[b:b + 3] >= gate)):
                continue
            flanks = midi[np.r_[a - 3:a, b:b + 3]]
            if np.ptp(flanks) > 0.5:
                continue
            valid = ((frequency[a:b] >= MIN_HZ) & (frequency[a:b] <= MAX_HZ)
                     & (confidence[a:b] >= min_confidence - 0.05) & (rms[a:b] >= gate))
            if not np.all(valid):
                continue
            observed = 69 + 12 * np.log2(frequency[a:b] / 440)
            if np.max(np.abs(observed - np.median(flanks))) <= 0.5:
                midi[a:b] = observed
                voiced[a:b] = True
    tuning_gate = max(.004, float(np.percentile(rms, 90)) * .06) if rms is not None and len(rms) else .004
    tuning_energy = np.ones(n, dtype=bool) if rms is None else rms >= tuning_gate
    tuning_stable = np.zeros(n, dtype=bool)
    tuning_stable[1:-1] = tuning_energy[:-2] & tuning_energy[1:-1] & tuning_energy[2:]
    stable = [i for i in range(1, n - 1) if tuning_stable[i] and voiced[i - 1] and voiced[i] and voiced[i + 1] and abs(midi[i + 1] - midi[i - 1]) < 0.15]
    if len(stable) > 200:
        angle = 2 * np.pi * (midi[stable] % 1.0)
        mean = float(np.angle(np.mean(np.exp(1j * angle))) / (2 * np.pi))
        if abs(mean) > TUNING_THRESHOLD:
            return mean
    return 0.0


# ── note cutting ─────────────────────────────────────────────────────────────

def pieces_in(midi, voiced, a, b, tuning=0.0, reliability=None):
    """Cut rests first, then segment pitch within each uninterrupted voiced run.

    A lyric window can contain a breath or several separated notes. Collecting
    all voiced indices before cutting pitch would stretch a note over silence,
    and the short-piece merge could erase a real note across that silence.
    """
    pieces = []
    for start, end in runs(voiced[a:b]):
        pieces.extend(pitched_pieces(midi, range(a + start, a + end), tuning, reliability))
    return pieces


def pitched_pieces(midi, indices, tuning=0.0, reliability=None):
    """Offline minimum-duration note partition, without a register prior.

    Six reliable 10ms observations already meet the note duration requirement.
    A separate eight-frame departure gate used to absorb those real short notes
    into the old pitch. Fit the entire voiced run instead: each segment lasts at
    least six frames, and every pitch change has the same cost, including large
    leaps. The grid groups observations only; final centers are medians of the
    measured pitches and this function never changes the contour or voicing.
    """
    ids = list(indices)
    if len(ids) < MIN_VOICED_IN_WORD:
        return []
    observed = midi[ids]
    weights = reliability[ids] if reliability is not None else np.ones(len(ids))
    centers = np.arange(math.floor(float(np.min(observed) - tuning)) - 1,
                        math.ceil(float(np.max(observed) - tuning)) + 2) + tuning
    count, states = len(ids), len(centers)
    stable = np.zeros(count, dtype=bool)
    clear = np.ones(count, dtype=bool)
    if reliability is not None:
        clear[:] = False
        quality = np.lib.stride_tricks.sliding_window_view(weights, MIN_VOICED_IN_WORD)
        clear[:count - MIN_VOICED_IN_WORD + 1] = np.median(quality, axis=1) >= .5
    if count >= 2 * MIN_VOICED_IN_WORD:
        windows = np.lib.stride_tricks.sliding_window_view(observed, MIN_VOICED_IN_WORD)
        flat = np.ptp(windows, axis=1) <= STABLE_NOTE_SPREAD
        flat &= np.min(np.lib.stride_tricks.sliding_window_view(weights, MIN_VOICED_IN_WORD), axis=1) >= .5
        means = np.mean(windows, axis=1)
        stable[MIN_VOICED_IN_WORD:count - MIN_VOICED_IN_WORD + 1] = (
            flat[:-MIN_VOICED_IN_WORD] & flat[MIN_VOICED_IN_WORD:]
            & (np.abs(means[MIN_VOICED_IN_WORD:] - means[:-MIN_VOICED_IN_WORD]) >= STABLE_NOTE_STEP))
    cost = np.full((MIN_VOICED_IN_WORD, states), np.inf)
    following = np.empty_like(cost)
    loss = np.empty(states)
    stay = np.zeros((count, states), dtype=bool)
    previous_note = np.zeros(count, dtype=np.int16)
    np.subtract(observed[0], centers, out=loss)
    np.square(loss, out=loss)
    np.minimum(loss, NOTE_RESIDUAL_CAP, out=loss)
    cost[0] = loss
    for i in range(1, count):
        best = int(np.argmin(cost[-1]))
        previous_note[i] = best
        stay[i] = cost[-1] <= cost[-2]
        np.subtract(observed[i], centers, out=loss)
        np.square(loss, out=loss)
        np.minimum(loss, NOTE_RESIDUAL_CAP, out=loss)
        change_cost = STABLE_NOTE_CHANGE_COST if stable[i] else NOTE_CHANGE_COST
        if not clear[i]:
            change_cost = UNCERTAIN_NOTE_CHANGE_COST
        following[0] = cost[-1, best] + change_cost + loss
        np.add(cost[:-2], loss, out=following[1:-1])
        np.minimum(cost[-1], cost[-2], out=following[-1])
        following[-1] += loss
        cost, following = following, cost
    state, age = int(np.argmin(cost[-1])), MIN_VOICED_IN_WORD - 1
    path = np.empty(count, dtype=np.int16)
    for i in range(count - 1, -1, -1):
        path[i] = state
        if age == 0:
            state, age = int(previous_note[i]), MIN_VOICED_IN_WORD - 1
        elif age != MIN_VOICED_IN_WORD - 1 or not stay[i, state]:
            age -= 1
    boundaries = [0] + (np.flatnonzero(np.diff(path)) + 1).tolist() + [count]
    segments = [ids[a:b] for a, b in zip(boundaries, boundaries[1:])]
    pieces = [{"ids": list(s), "pitch": float(np.median(midi[s]))} for s in segments]
    return merge_short_glides(midi, pieces)


def merge_short_glides(midi, pieces):
    """Keep the old merge policy without re-scanning all pitch percentiles.

    Offline runs can contain thousands of pieces. Re-evaluating every short
    piece after each merge makes a long recording quadratic in expensive array
    reductions. Only the merged neighbour can change eligibility.
    """
    count = len(pieces)
    if count < 2:
        return pieces
    previous = list(range(-1, count - 1))
    following = list(range(1, count)) + [-1]
    active = [True] * count
    revisions = [0] * count
    queue = []

    def enqueue(index):
        size = len(pieces[index]['ids'])
        if size < MIN_PIECE and (size < MIN_VOICED_IN_WORD
                or np.diff(np.percentile(midi[pieces[index]['ids']], [25, 75]))[0] > .5):
            heapq.heappush(queue, (size, index, revisions[index]))

    for i in range(count):
        enqueue(i)
    while queue:
        _, k, revision = heapq.heappop(queue)
        if not active[k] or revision != revisions[k]:
            continue
        left, right = previous[k], following[k]
        if left < 0 and right < 0:
            break
        if left < 0:
            j = right
        elif right < 0:
            j = left
        else:
            j = left if len(pieces[left]['ids']) >= len(pieces[right]['ids']) else right
        ids = pieces[j]['ids'] + pieces[k]['ids'] if j < k else pieces[k]['ids'] + pieces[j]['ids']
        pieces[j] = {'ids': ids, 'pitch': pieces[j]['pitch']}
        active[k] = False
        revisions[j] += 1
        if left >= 0:
            following[left] = right
        if right >= 0:
            previous[right] = left
        enqueue(j)
    result = []
    for i, piece in enumerate(pieces):
        if active[i]:
            if revisions[i]:
                # Merging changes the observations represented by this note.
                # A tiny neighbour's old center must not become the target for
                # a much larger merged interval (including octave mistakes).
                center = float(np.median(midi[piece['ids']]))
                if abs(piece['pitch'] - center) > MAX_MERGED_CENTER_DEVIATION:
                    piece['pitch'] = center
            result.append(piece)
    return result


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


def cut_notes(midi, voiced, windows, tuning, confidence=None, min_confidence=0.0):
    n = len(midi)
    t = np.arange(n) * HOP_SECONDS
    to_index = lambda sec: int(np.clip(round(sec / HOP_SECONDS), 0, n))
    notes = []
    # Confidence only establishes a clear short plateau. Every observation
    # retains its fit cost, so marginal but sustained notes can still establish
    # their own pitch instead of being absorbed into the preceding register.
    reliability = None if confidence is None else np.clip(
        (confidence - min_confidence) / max(1e-6, 1 - min_confidence), 0, 1) ** 2
    for line_index, word_index, start, end in windows:
        pieces = pieces_in(midi, voiced, to_index(start), to_index(end), tuning, reliability)
        for k, piece in enumerate(pieces):
            ids, raw = piece["ids"], piece["pitch"]
            # Keep scored/displayed targets inside observed voice. Lyric timing
            # and onset/offset padding are not evidence of a sung pitch.
            note_start = max(start, float(t[ids[0]]))
            note_end = min(end, float(t[ids[-1]]) + HOP_SECONDS)
            if note_end - note_start + 1e-9 < MIN_VOICED_IN_WORD * HOP_SECONDS:
                continue
            notes.append({"start": round(note_start, 3), "end": round(note_end, 3), "midi": int(round(raw - tuning)),
                          "raw": round(raw, 2), "line": line_index, "word": word_index, "cont": k > 0})
    merged = []
    for note in notes:
        previous = merged[-1] if merged else None
        if (previous and previous["line"] == note["line"] and previous["word"] == note["word"]
                and previous["midi"] == note["midi"] and note["start"] <= previous["end"]):
            previous["end"] = note["end"]
        else:
            merged.append(note)
    merged.sort(key=lambda note: (note["start"], note["end"]))
    return merged


def make_guide(audio, algorithm="auto", lyrics=None, offset_ms=0.0, progress=True):
    started = time.monotonic()
    duration = len(audio) / SAMPLE_RATE
    frequency, confidence, rms, method, fallback, min_confidence = extract(audio, algorithm, progress)
    rms, periodicity = voicing_features(audio, frequency, confidence, rms, min_confidence, method)
    midi, voiced = voiced_midi(frequency, confidence, rms, min_confidence, periodicity)
    voiced_raw = float(voiced.sum()) * HOP_SECONDS
    tuning = clean(midi, voiced, confidence, min_confidence, frequency=frequency, rms=rms)
    windows, lines = lyric_windows(lyrics, offset_ms, duration)
    limitations = ["experimental-single-voice"]
    if not windows:
        # No lyrics at all: every voiced run is a window.
        windows = [(0, 0, a * HOP_SECONDS, b * HOP_SECONDS) for a, b in runs(voiced)]
        lines = []
        limitations.append("no-lyrics")
    # YIN clarity and neural periodicity are not interchangeable confidence
    # scales. Only YIN's acoustic clarity currently calibrates short changes;
    # CREPE keeps the pitch/duration partition until independently calibrated.
    notes = cut_notes(midi, voiced, windows, tuning,
                      confidence if method == 'yin-cpu' else None, min_confidence)
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

