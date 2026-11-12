"""Precise lyric sync worker (Chinese): phoneme-level evidence from a small speech model.

Long-lived JSON-lines process: one request per stdin line, one response per stdout line.
Logs go to stderr. Started on demand by server/services/align-model-jobs.js and closed
again after it has been idle for a while, so the model only holds GPU memory while in use.

Requests (all carry an integer "id" that the response echoes):
  {"op": "ping"}
  {"op": "warmup"}                      load the model and run it once (compiles GPU kernels)
  {"op": "global", "pcm": path, "cacheKey": str, "versions": [{"key": str, "lines": [...]}]}
        whole-song offset per lyric version: offsetMs (lyric time - audio time, same sign as
        the app's track offset), peakZ, peakRatio, units
  {"op": "lines", "pcm": path, "cacheKey": str, "lines": [...], "offsetMs": int, "bandSec": 8}
"pcm" is raw 16 kHz mono float32 little-endian audio the server already decoded (one shared ffmpeg
queue, so this worker never runs ffmpeg itself); "cacheKey" names the recording so a second request
for the same song reuses the model output.
        per-line forced alignment around a whole-song offset: onsets (audio ms) + confidence
Lines: [{"time": ms, "duration": ms, "text": str, "words": [{"text", "start", "duration"}]}],
text already converted to simplified Chinese by the caller.

The model is the sherpa-onnx small Chinese Zipformer CTC (Apache-2.0, k2-fsa). Two builds:
fp16 runs on DirectML (any DX12 GPU), int8 runs on CPU; each crashes on the other device,
so the caller passes which file to load.
"""
import json
import os
import sys
import time
import traceback

import numpy as np

MODEL_PATH = os.environ.get('ELITESAND_ALIGN_MODEL', '')
BPE_PATH = os.environ.get('ELITESAND_ALIGN_BPE', '')
DEVICE = os.environ.get('ELITESAND_ALIGN_DEVICE', 'dml')     # 'dml' or 'cpu'

SR = 16000
HOP = 160                     # 10 ms analysis frames
SUB = 4                       # the model emits one frame per 40 ms
CHUNK = 3000                  # frames (30 s) scored per model call
CTX = 200                     # frames (2 s) of context on each side, discarded
WIN = CHUNK + 2 * CTX         # every call has the same length: DirectML recompiles per input shape
MAX_LAG = 6000                # +-60 s searched for the whole-song offset
NEG = -1e12

_session = None
_sp = None
_post_key = None
_post = None


def log(msg):
    sys.stderr.write(f'[align] {msg}\n')
    sys.stderr.flush()


# ---- byte-level BPE input mapping -------------------------------------------------------------
# The tokenizer was trained on text whose UTF-8 bytes are first mapped to printable characters.
# Same mapping as fairseq's byte_utils (MIT, Facebook) as used by icefall: byte b -> chr(table[b]).
_RANGES = [(256, 287), (32, 126), (288, 305), (308, 318), (321, 328), (330, 382), (384, 422)]
_BYTE_CHARS = [chr(c) for lo, hi in _RANGES for c in range(lo, hi + 1)]
assert len(_BYTE_CHARS) == 256


def byte_encode(text):
    return ''.join(_BYTE_CHARS[b] for b in ' '.join(text.split()).encode('utf-8'))


def tokenizer():
    global _sp
    if _sp is None:
        import sentencepiece as spm
        _sp = spm.SentencePieceProcessor()
        _sp.load(BPE_PATH)
    return _sp


def char_ids(ch):
    return [i for i in tokenizer().encode(byte_encode(ch), out_type=int) if i > 2]


# ---- model -------------------------------------------------------------------------------------
def session():
    global _session
    if _session is None:
        import onnxruntime as ort
        opt = ort.SessionOptions()
        opt.log_severity_level = 3
        providers = ['DmlExecutionProvider', 'CPUExecutionProvider'] if DEVICE == 'dml' else ['CPUExecutionProvider']
        t = time.time()
        _session = ort.InferenceSession(MODEL_PATH, opt, providers=providers)
        used = _session.get_providers()
        if DEVICE == 'dml' and 'DmlExecutionProvider' not in used:
            raise RuntimeError('DirectML is not available on this computer')
        log(f'model loaded in {time.time() - t:.1f}s on {used[0]}')
    return _session


def fbank(wav):
    import kaldi_native_fbank as knf
    opts = knf.FbankOptions()
    opts.frame_opts.dither = 0
    opts.frame_opts.snip_edges = False
    opts.frame_opts.samp_freq = SR
    opts.mel_opts.num_bins = 80
    opts.mel_opts.high_freq = -400
    fb = knf.OnlineFbank(opts)
    fb.accept_waveform(SR, wav.tolist())
    fb.input_finished()
    return np.stack([fb.get_frame(i) for i in range(fb.num_frames_ready)]).astype(np.float32)


def run_window(feats):
    lp = session().run(['log_probs'], {'x': feats[None], 'x_lens': np.array([feats.shape[0]], dtype=np.int64)})[0][0]
    return lp.astype(np.float32)          # [T/4, vocab]


def posteriors(req):
    """Log-probabilities [vocab, T] at 10 ms (40 ms model frames repeated). Last song is kept in memory."""
    global _post_key, _post
    key = str(req.get('cacheKey') or req['pcm'])
    if key == _post_key:
        return _post
    t = time.time()
    wav = np.fromfile(req['pcm'], dtype='<f4')
    total = len(wav) // HOP
    padded = np.concatenate([np.zeros(CTX * HOP, dtype=np.float32), wav, np.zeros((WIN + CHUNK) * HOP, dtype=np.float32)])
    out = None
    for f0 in range(0, total, CHUNK):
        lp = run_window(fbank(padded[f0 * HOP:(f0 + WIN) * HOP])[:WIN])
        if out is None:
            out = np.full((lp.shape[1], total), -20.0, dtype=np.float32)
        lp10 = np.repeat(lp.T, SUB, axis=1)
        n = min(CHUNK, total - f0)
        seg = lp10[:, CTX:CTX + n]
        out[:, f0:f0 + seg.shape[1]] = seg
    if out is None:
        raise ValueError('audio is empty')
    _post_key, _post = key, out
    log(f'posteriors for {total / 100:.0f}s of audio in {time.time() - t:.1f}s')
    return out


# ---- lyrics -> scoring units -------------------------------------------------------------------
def is_han(ch):
    o = ord(ch)
    return 0x4e00 <= o <= 0x9fff or 0x3400 <= o <= 0x4dbf


def lyric_units(lines):
    """Han characters with the time span the lyric file gives them: dict(line, s, e, ids) in seconds."""
    used = [(k, l) for k, l in enumerate(lines) if isinstance(l, dict) and str(l.get('text') or '').strip()]
    out = []
    for n, (k, l) in enumerate(used):
        t0 = float(l.get('time') or 0) / 1000
        nxt = float(used[n + 1][1].get('time') or 0) / 1000 if n + 1 < len(used) else t0 + 6
        words = [w for w in (l.get('words') or []) if isinstance(w, dict) and w.get('duration')]
        spans = []
        if len(words) >= 2:
            for w in words:
                s = t0 + float(w.get('start') or 0) / 1000
                spans.append((str(w.get('text') or ''), s, s + float(w['duration']) / 1000))
        else:
            dur = float(l.get('duration') or 0)
            end = t0 + dur / 1000 if dur else min(nxt, t0 + 8)
            if nxt > t0:
                end = min(end, nxt)
            spans.append((str(l.get('text') or ''), t0, max(end, t0 + 0.5)))
        for text, s, e in spans:
            chars = [c for c in text if is_han(c)]
            if not chars:
                continue
            step = (e - s) / len(chars)
            for m, c in enumerate(chars):
                ids = char_ids(c)
                if ids:
                    out.append({'line': k, 's': s + m * step, 'e': s + (m + 1) * step, 'ids': ids})
    return out


# ---- whole-song offset -------------------------------------------------------------------------
def global_offset(prob, units):
    """Slide the lyric's own character timeline over the per-frame character probabilities."""
    T = prob.shape[1]
    lags = np.arange(-MAX_LAG, MAX_LAG + 1)
    total = np.zeros(len(lags))
    cache = {}
    for u in units:
        key = tuple(sorted(set(u['ids'])))
        c = cache.get(key)
        if c is None:
            c = cache[key] = np.concatenate([[0.0], np.cumsum(prob[list(key)].sum(axis=0))])
        s = int(round(u['s'] * 100))
        e = max(s + 3, int(round(u['e'] * 100)))
        a = np.clip(s + lags, 0, T)
        b = np.clip(e + lags, 0, T)
        total += (c[b] - c[a]) / (e - s)
    best = int(np.argmax(total))
    z = (total[best] - total.mean()) / (total.std() + 1e-9)
    mask = np.abs(lags - lags[best]) > 150
    second = total[mask].max() if mask.any() else 0.0
    base = np.median(total)
    ratio = (total[best] - base) / max(second - base, 1e-6)
    return {'offsetMs': int(-lags[best] * 10), 'peakZ': float(z), 'peakRatio': float(ratio), 'units': len(units)}


# ---- per-line forced alignment -----------------------------------------------------------------
def ctc_align(logp10, units, offset_ms, band_s):
    """CTC forced alignment of the whole lyric; each token may only fire within +-band of where the
    lyric (shifted by the whole-song offset) expects it. Returns ({line: onset_ms}, {line: confidence})."""
    lp = logp10[:, ::SUB]
    T = lp.shape[1]
    toks, exp, owner = [], [], []
    for u in units:
        t0 = (u['s'] * 1000 - offset_ms) / (10 * SUB)
        t1 = (u['e'] * 1000 - offset_ms) / (10 * SUB)
        for m, tid in enumerate(u['ids']):
            toks.append(tid); exp.append(t0 + (t1 - t0) * m / len(u['ids'])); owner.append(u['line'])
    n = len(toks)
    if n == 0 or T < 2:
        return {}, {}
    S = 2 * n + 1
    ids = np.zeros(S, dtype=np.int64); ids[1::2] = toks
    e = np.zeros(S); e[1::2] = exp; e[2::2] = exp; e[0] = exp[0]
    band = band_s * 100 / SUB
    lo = np.clip(e - band, 0, T - 1); hi = np.clip(e + band, 0, T - 1)
    lo[0] = 0; hi[-1] = T - 1
    hi[0:-1:2] = np.maximum(hi[0:-1:2], np.append(hi[1::2], T - 1)[:len(hi[0:-1:2])])
    skip_ok = np.zeros(S, dtype=bool)
    skip_ok[3::2] = ids[3::2] != ids[1:-2:2]
    em = lp[ids]
    dp = np.full(S, NEG); dp[0] = em[0, 0]; dp[1] = em[1, 0] if lo[1] <= 0 else NEG
    back = np.zeros((T, S), dtype=np.int8)
    idx = np.arange(S)
    for t in range(1, T):
        adv = np.full(S, NEG); adv[1:] = dp[:-1]
        skp = np.full(S, NEG); skp[2:] = dp[:-2]; skp[~skip_ok] = NEG
        st = np.stack([dp, adv, skp])
        ch = np.argmax(st, axis=0)
        dp = np.maximum(st[ch, idx] + em[:, t], NEG)
        dp[(t < lo) | (t > hi)] = NEG
        back[t] = ch
    s = S - 1 if dp[S - 1] >= dp[S - 2] else S - 2
    enter = np.full(S, -1)
    for t in range(T - 1, 0, -1):
        ch = int(back[t, s])
        if ch:
            enter[s] = t
            s -= ch
    onset, seen = {}, {}
    for k in range(n):
        si = 2 * k + 1
        if enter[si] < 0:
            continue
        line = owner[k]
        if line not in onset:
            onset[line] = int(enter[si] * 10 * SUB)
        seen.setdefault(line, []).append(float(em[si, enter[si]:enter[si] + 2].max()))
    conf = {line: float(np.mean(v)) for line, v in seen.items()}
    return onset, conf


# ---- request loop ------------------------------------------------------------------------------
def handle(req):
    op = req.get('op')
    if op == 'ping':
        return {'pong': True, 'device': DEVICE}
    if op == 'warmup':
        t = time.time()
        feats = np.zeros((WIN, 80), dtype=np.float32)
        run_window(feats)
        return {'seconds': round(time.time() - t, 2), 'device': DEVICE}
    if op == 'global':
        logp = posteriors(req)
        prob = np.exp(logp)
        results = {}
        for v in req.get('versions') or []:
            units = lyric_units(v.get('lines') or [])
            results[str(v.get('key'))] = global_offset(prob, units) if len(units) >= 20 else {'units': len(units)}
        return {'results': results}
    if op == 'lines':
        logp = posteriors(req)
        units = lyric_units(req.get('lines') or [])
        onset, conf = ctc_align(logp, units, float(req.get('offsetMs') or 0), float(req.get('bandSec') or 8))
        return {'onsets': {str(k): v for k, v in onset.items()}, 'conf': {str(k): round(v, 3) for k, v in conf.items()}}
    raise ValueError(f'unknown op {op!r}')


def main():
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        rid = None
        try:
            req = json.loads(raw)
            rid = req.get('id')
            t = time.time()
            res = handle(req)
            res.update({'id': rid, 'ok': True, 'ms': int((time.time() - t) * 1000)})
        except Exception as err:  # noqa: BLE001 - every failure goes back to the caller as data
            log(traceback.format_exc())
            res = {'id': rid, 'ok': False, 'error': f'{type(err).__name__}: {err}'[:500]}
        sys.stdout.write(json.dumps(res) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
