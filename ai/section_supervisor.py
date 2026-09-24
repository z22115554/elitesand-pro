#!/usr/bin/env python3
"""Song-section analysis sidecar supervisor.

Long-lived process spawned once by Node (server/services/section-analysis.js).
Talks NDJSON over stdin/stdout, same protocol as ai/supervisor.py (AI vocal
separation) — this file is a deliberate near-duplicate of that one, not a
shared base class, matching this project's existing convention of one
independent supervisor/worker pair per ML feature (see japanese-g2p-provider.js
for the other precedent).

Every `analyze` request gets its own short-lived worker process (section_worker.py)
so a crash in one job can never take the supervisor down with it.

V1 scope: CUDA only, single job at a time (鐵則 #12 的同一類理由——GPU 記憶體
禁不起併發推論）。沒有 WebGPU/CPU 降級鏈；section-analysis-jobs.js 沒有 CUDA
時直接回錯誤，不會走到這支 supervisor。
"""
import json
import os
import subprocess
import sys
import threading
import time

WORKER_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "section_worker.py")
CANCEL_GRACE_SECONDS = 2.0

_stdout_lock = threading.Lock()
_active_job = None  # dict: id, proc, cancel_initiated (bool)
_active_lock = threading.Lock()


def _emit(obj):
    with _stdout_lock:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def _clear_active_job(job_id):
    global _active_job
    with _active_lock:
        if _active_job is not None and _active_job["id"] == job_id:
            job = _active_job
            _active_job = None
            return job
    return None


def _stderr_reader_thread_fn(proc):
    # 同 ai/supervisor.py 的說明：worker 的 stderr 必須是獨立 PIPE 並在這裡主動讀掉，
    # 不能繼承 supervisor 自己的 stderr handle，否則 Windows 上 worker 一開始寫 log
    # 就會卡死在等一個沒人讀的管線。
    try:
        for line in proc.stderr:
            sys.stderr.write("[section_worker] " + line)
            sys.stderr.flush()
    except Exception:  # noqa: BLE001
        pass


def _reader_thread_fn(job_id, proc):
    terminal_seen = False
    try:
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if "result" in msg or "error" in msg:
                terminal_seen = True
                _clear_active_job(job_id)
            with _stdout_lock:
                sys.stdout.write(line + "\n")
                sys.stdout.flush()
    finally:
        proc.wait()
        cleared_job = _clear_active_job(job_id)
        if not terminal_seen:
            if cleared_job is not None and cleared_job.get("cancel_initiated"):
                _emit({"id": job_id, "error": {"code": "CANCELLED", "retryable": False}})
            else:
                code = proc.returncode
                _emit({
                    "id": job_id,
                    "error": {
                        "code": "INTERNAL",
                        "retryable": True,
                        "message": f"worker terminated unexpectedly (exit code {code})",
                    },
                })


def handle_hello(request):
    _emit({"id": request.get("id"), "result": {"pong": True, "pid": os.getpid()}})


def handle_probe(request):
    try:
        import torch
        available = bool(torch.cuda.is_available())
        name = torch.cuda.get_device_name(0) if available else None
        _emit({"id": request.get("id"), "result": {"implemented": True, "cudaAvailable": available, "deviceName": name}})
    except Exception as exc:  # noqa: BLE001
        _emit({"id": request.get("id"), "result": {"implemented": True, "cudaAvailable": False, "error": str(exc)}})


def handle_analyze(request):
    job_id = request.get("id")
    global _active_job
    with _active_lock:
        if _active_job is not None:
            _emit({
                "id": job_id,
                "error": {"code": "BUSY", "retryable": True, "message": "another job is already running"},
            })
            return
        proc = subprocess.Popen(
            [sys.executable, WORKER_PATH],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"},
        )
        job = {"id": job_id, "proc": proc, "cancel_initiated": False}
        _active_job = job

    proc.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
    proc.stdin.flush()

    reader = threading.Thread(target=_reader_thread_fn, args=(job_id, proc), daemon=True)
    reader.start()
    stderr_reader = threading.Thread(target=_stderr_reader_thread_fn, args=(proc,), daemon=True)
    stderr_reader.start()


def handle_cancel(request):
    target_id = request.get("params", {}).get("jobId") or request.get("id")
    with _active_lock:
        job = _active_job if _active_job and _active_job["id"] == target_id else None
        if job is None:
            _emit({"id": request.get("id"), "result": {"cancelled": False, "reason": "no active job"}})
            return
        job["cancel_initiated"] = True
        proc = job["proc"]

    try:
        proc.stdin.write(json.dumps({"method": "cancel"}, ensure_ascii=False) + "\n")
        proc.stdin.flush()
    except (BrokenPipeError, OSError):
        pass

    def _escalate():
        time.sleep(CANCEL_GRACE_SECONDS)
        if proc.poll() is None:
            proc.terminate()

    threading.Thread(target=_escalate, daemon=True).start()
    _emit({"id": request.get("id"), "result": {"cancelled": True}})


HANDLERS = {
    "hello": handle_hello,
    "probe": handle_probe,
    "analyze": handle_analyze,
    "cancel": handle_cancel,
}


def _shutdown():
    with _active_lock:
        job = _active_job
    if job is not None and job["proc"].poll() is None:
        job["proc"].terminate()


def main():
    try:
        for raw_line in sys.stdin:
            line = raw_line.lstrip("﻿").strip()
            if not line:
                continue
            try:
                request = json.loads(line)
            except json.JSONDecodeError as exc:
                _emit({"id": None, "error": {"code": "BAD_REQUEST", "retryable": False, "message": f"could not parse request line: {exc}"}})
                print(f"[section_supervisor] dropped unparseable stdin line: {exc}", file=sys.stderr, flush=True)
                continue
            if not isinstance(request, dict):
                _emit({"id": None, "error": {"code": "BAD_REQUEST", "retryable": False, "message": "request must be a JSON object"}})
                print("[section_supervisor] dropped non-object stdin request", file=sys.stderr, flush=True)
                continue
            handler = HANDLERS.get(request.get("method"))
            if handler is None:
                _emit({"id": request.get("id"), "error": {"code": "INTERNAL", "retryable": False, "message": f"unknown method: {request.get('method')}"}})
                continue
            try:
                handler(request)
            except Exception as exc:  # noqa: BLE001
                _emit({"id": request.get("id"), "error": {"code": "INTERNAL", "retryable": True, "message": str(exc)}})
    finally:
        _shutdown()


if __name__ == "__main__":
    main()
