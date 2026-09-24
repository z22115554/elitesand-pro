#!/usr/bin/env python3
"""Song-section analysis job worker (SongFormer).

One process per job, spawned by section_supervisor.py with the job request
as a single JSON line on stdin — same shape as ai/worker.py (AI vocal
separation), see that file's docstring for why a fresh process per job.

V1 scope: CUDA only. No forceCpu, no WebGPU/CPU fallback chain — if this
process can't see CUDA, it fails the job with ENGINE_UNAVAILABLE and
section-analysis-jobs.js does not retry on another backend (there isn't one
yet; SongFormer's CPU/WebGPU paths were never validated, see
E:/music-section-poc-20260908/candidate-results/REPORT.md).

Model loading takes ~7s (MuQ + MusicFM + SongFormer checkpoints), inference
~6-14s on an RTX 3060 — both measured in the research POC. A fresh worker
per job re-pays the ~7s load cost every time; that's an accepted V1
trade-off for crash-isolation consistency with the AI-separation worker,
not an oversight (usage is a manual, occasional button click, not a batch
pipeline).

Inference itself (process_audio) is one call into vendored SongFormer code
with no chunk-level progress hook, so cancellation is only honored between
stages (before model load finishes, before inference starts) — once
process_audio() is running it cannot be interrupted mid-flight. Typical
inference is ~10s, so this is an acceptable limitation, not a redesign target.
"""
import ast
import json
import math
import os
import sys
import threading

_INITIAL_REQUEST_LINE = sys.stdin.readline()
_INITIAL_REQUEST = json.loads(_INITIAL_REQUEST_LINE) if _INITIAL_REQUEST_LINE.strip() else None

_cancel_requested = threading.Event()


class _CancelledBeforeInference(Exception):
    pass


def _emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _watch_stdin_for_cancel():
    # 跟 ai/worker.py 同一個理由：closed stdin（supervisor 死了）也代表「停」，
    # 不能讓孤兒 worker 一直跑。故意延後到 heavy import 跑完才啟動這條 thread
    # （見 ai/worker.py 的說明：背景 thread 在 blocking 讀 stdin 時，torch 相關
    # 的重量級 import 會整個卡死不返回）。
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line.lstrip("\ufeff"))
        except json.JSONDecodeError as exc:
            print(f"[section_worker] ignored unparseable stdin line: {exc}", file=sys.stderr, flush=True)
            continue
        if msg.get("method") == "cancel":
            _cancel_requested.set()
            return
    _cancel_requested.set()


def _enable_sdpa_patch():
    """Inference-only SDPA adapter，直接搬 POC 驗證過的
    E:/music-section-poc-20260908/songformer_sdpa.py：拿掉 SongFormer 官方
    程式碼裡把 attention 鎖死只能用 flash-only 後端的設定（該設定在 FP32、
    非資料中心 GPU 上很慢——RTX 3060 上第一首歌從 351.76 秒的元凶），改用
    PyTorch 自己挑一個適合這張卡+這個精度的 SDPA 後端。只在 rotary 位置編碼
    情境套用，其餘（relative／訓練模式／需要 attention 權重輸出）原樣呼叫
    官方實作。已用小型合成輸入在 CUDA 上驗證數值一致（atol=2e-5）。
    """
    import torch
    import torch.nn.functional as F
    from transformers.models.wav2vec2_conformer.modeling_wav2vec2_conformer import (
        Wav2Vec2ConformerSelfAttention,
    )

    original_forward = Wav2Vec2ConformerSelfAttention.forward

    def patched_forward(self, hidden_states, attention_mask=None, relative_position_embeddings=None, output_attentions=False):
        if self.position_embeddings_type == "relative" or output_attentions or self.training:
            return original_forward(self, hidden_states, attention_mask, relative_position_embeddings, output_attentions)
        b, t, _ = hidden_states.shape
        qk = hidden_states
        if self.position_embeddings_type == "rotary":
            if relative_position_embeddings is None:
                raise ValueError("Missing rotary positions")
            qk = self._apply_rotary_embedding(qk, relative_position_embeddings)
        q = self.linear_q(qk).view(b, t, self.num_heads, self.head_size).transpose(1, 2)
        k = self.linear_k(qk).view(b, t, self.num_heads, self.head_size).transpose(1, 2)
        v = self.linear_v(hidden_states).view(b, t, self.num_heads, self.head_size).transpose(1, 2)
        z = F.scaled_dot_product_attention(q, k, v, attn_mask=attention_mask, dropout_p=0.0)
        z = z.transpose(1, 2).reshape(b, t, self.num_heads * self.head_size)
        return self.linear_out(z), None

    from transformers import Wav2Vec2ConformerConfig
    from transformers.models.wav2vec2_conformer.modeling_wav2vec2_conformer import (
        Wav2Vec2ConformerRotaryPositionalEmbedding,
    )

    torch.manual_seed(42)
    cfg = Wav2Vec2ConformerConfig(hidden_size=1024, num_attention_heads=16, position_embeddings_type="rotary", attention_dropout=0.0)
    m = Wav2Vec2ConformerSelfAttention(cfg).cuda().eval()
    x = torch.randn(1, 257, 1024, device="cuda")
    pos = Wav2Vec2ConformerRotaryPositionalEmbedding(cfg).cuda()(x)
    with torch.no_grad():
        a = original_forward(m, x, relative_position_embeddings=pos)[0]
        b = patched_forward(m, x, relative_position_embeddings=pos)[0]
        torch.testing.assert_close(a, b, atol=2e-5, rtol=2e-4)
    del m, x, a, b, pos
    torch.cuda.empty_cache()
    Wav2Vec2ConformerSelfAttention.forward = patched_forward


def _load_songformer_functions(songformer_dir):
    """從官方 app.py 用 ast 抽出 initialize_models/process_audio/format_as_segments
    這幾個推論用得到的函式（連同它們用到的 import/module-level assignment），
    跳過 gradio/matplotlib——那兩個只有官方 Gradio demo UI 需要，我們不需要裝。
    直接搬 POC 驗證過 18 首歌都能跑的做法（見
    E:/music-section-poc-20260908/run_candidates.py 的 setup_songformer()），
    好處是永遠跟隨 vendor 進來的 app.py 版本，不用手動維護一份分岔出來的複本。
    """
    src_songformer = os.path.join(songformer_dir, "src", "SongFormer")
    sys.path.insert(0, os.path.join(songformer_dir, "src", "third_party"))
    sys.path.insert(0, src_songformer)

    app_py_path = os.path.join(songformer_dir, "app.py")
    source = open(app_py_path, "r", encoding="utf-8").read()
    tree = ast.parse(source)
    nodes = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef):
            if node.name in ("load_checkpoint", "initialize_models", "process_audio", "format_as_segments"):
                nodes.append(node)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            segment = ast.get_source_segment(source, node)
            if not any(x in segment for x in ("gradio", "matplotlib")):
                nodes.append(node)
        elif isinstance(node, ast.Assign):
            nodes.append(node)

    # app.py 自己開頭就 os.chdir 到這裡；相對路徑（ckpts/、configs/）都是照這個
    # 假設寫的，抽出來的函式一樣要在同一個 cwd 底下跑才找得到檔案。
    os.chdir(src_songformer)
    namespace = {"__name__": "section_worker_songformer"}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "songformer_app_functions", "exec"), namespace)
    return namespace


def _run_real_job(job_id, params):
    input_path = params.get("inputPath")
    songformer_dir = params.get("songformerDir")

    if not input_path or not os.path.isfile(input_path):
        _emit({"id": job_id, "error": {"code": "INPUT_UNREADABLE", "retryable": False, "message": f"input file not found: {input_path}"}})
        return
    if not songformer_dir or not os.path.isdir(songformer_dir):
        _emit({"id": job_id, "error": {"code": "RUNTIME_MISSING", "retryable": False, "message": f"SongFormer runtime directory not found: {songformer_dir}"}})
        return

    _emit({"id": job_id, "event": "progress", "stage": "load", "progress": 0.0})

    try:
        import torch

        if not torch.cuda.is_available():
            _emit({"id": job_id, "error": {"code": "PROVIDER_UNAVAILABLE", "retryable": False, "message": "CUDA not available (V1 has no CPU/WebGPU fallback for section analysis)"}})
            return

        _enable_sdpa_patch()
        namespace = _load_songformer_functions(songformer_dir)
        namespace["initialize_models"]("SongFormer", "SongFormer.safetensors", "SongFormer.yaml")

        threading.Thread(target=_watch_stdin_for_cancel, daemon=True).start()
        if _cancel_requested.is_set():
            raise _CancelledBeforeInference()

        _emit({"id": job_id, "event": "progress", "stage": "inference", "progress": 0.0})
        _, msa_output = namespace["process_audio"](input_path)
        raw_segments = namespace["format_as_segments"](msa_output)
        sections = [
            {"start": float(s["start"]), "end": float(s["end"]), "label": s["label"]}
            for s in raw_segments
        ]
        torch.cuda.synchronize()
        _emit({"id": job_id, "result": {"sections": sections}})
    except _CancelledBeforeInference:
        _emit({"id": job_id, "error": {"code": "CANCELLED", "retryable": False}})
    except Exception as exc:  # noqa: BLE001 — 使用者不該看到 PyTorch stack trace
        message = str(exc)
        code = "GPU_OOM" if "CUDA out of memory" in message else "INTERNAL"
        _emit({"id": job_id, "error": {"code": code, "retryable": True, "message": message}})
    finally:
        try:
            import torch
            torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001
            pass


def main():
    request = _INITIAL_REQUEST
    if request is None:
        sys.exit(1)
    job_id = request.get("id")
    params = request.get("params", {})
    _run_real_job(job_id, params)


if __name__ == "__main__":
    main()
