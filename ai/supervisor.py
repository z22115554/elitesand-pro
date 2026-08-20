#!/usr/bin/env python3
"""AI Separation sidecar supervisor.

Long-lived process spawned once by Node (server/services/ai-separation.js).
Talks NDJSON over stdin/stdout (see docs/AI-SEPARATION-PLAN.md §4). Every
`separate` request gets its own short-lived worker.py process so a crash or
OOM in one job can never take the supervisor down with it — the supervisor
detects the dead worker, reports a retryable error, and stays ready for the
next job.

A1 skeleton: only one job runs at a time (mirrors the single-worker download
queue rule — CLAUDE.md 鐵則 #12 — concurrent yt-dlp/ffmpeg OOMs this machine,
concurrent AI inference would be worse). worker.py's job body is a fake
sleep loop until A3 wires in real Kim inference.
"""
import json
import os
import subprocess
import sys
import threading
import time

WORKER_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "worker.py")
CANCEL_GRACE_SECONDS = 2.0

_stdout_lock = threading.Lock()
_active_job = None  # dict: id, proc, reader_thread, cancel_initiated (bool)
_active_lock = threading.Lock()


def _emit(obj):
    with _stdout_lock:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def _clear_active_job(job_id):
    """Clear _active_job if it's still this job, returning its dict (for
    callers that need cancel_initiated etc. — read it under the same lock
    as the clear so there's no window where the job info could be seen as
    already gone)."""
    global _active_job
    with _active_lock:
        if _active_job is not None and _active_job["id"] == job_id:
            job = _active_job
            _active_job = None
            return job
    return None


def _stderr_reader_thread_fn(proc):
    # audio_separator（跟 Python logging 本身）預設把一堆 INFO log 寫到 stderr。
    # 曾經直接把 worker 的 stderr 設成 stderr=sys.stderr（繼承 supervisor 自己的
    # handle）——在 Windows 上、supervisor 自己的 stderr 又是被 Node 用 pipe 接住
    # 時，這個 handle 繼承會壞掉，worker 一開始寫 log 就整個卡死在等一個沒人在讀
    # 的管線（2026-08-17 實測：worker 卡在 emit 完第一個 progress 事件之後，
    # GPU 完全閒置，因為它還沒真的走到 CUDA 那一步就先卡在寫 log）。改成獨立
    # PIPE 並在這裡主動讀掉，才不會回頭把整個 process 卡住。
    try:
        for line in proc.stderr:
            sys.stderr.write("[worker] " + line)
            sys.stderr.flush()
    except Exception:  # noqa: BLE001 - 這條 thread 掛了也不該拖累主流程
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
                # 收到終局事件當下就讓下一個 job 可以排進來，不要卡到
                # OS 真的回收這個 process（proc.wait()）——那段空窗會讓
                # Node 端「job 完成後馬上送下一個」誤撞成 BUSY。
                terminal_seen = True
                _clear_active_job(job_id)
            with _stdout_lock:
                sys.stdout.write(line + "\n")
                sys.stdout.flush()
    finally:
        proc.wait()
        cleared_job = _clear_active_job(job_id)
        if not terminal_seen:
            # Worker died without reporting — synthesize the terminal event
            # so Node never hangs waiting for one that will never arrive.
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
    # Real hardware probe (GPU vendor/VRAM/driver) is out of scope for the
    # A1 skeleton — this is a stub so Node's contract test can exercise the
    # method dispatch path without needing torch installed yet.
    _emit({"id": request.get("id"), "result": {"implemented": False}})


def handle_separate(request):
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
    "separate": handle_separate,
    "cancel": handle_cancel,
}


def _shutdown():
    with _active_lock:
        job = _active_job
    if job is not None and job["proc"].poll() is None:
        job["proc"].terminate()


def main():
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
            except json.JSONDecodeError:
                continue
            handler = HANDLERS.get(request.get("method"))
            if handler is None:
                _emit({"id": request.get("id"), "error": {"code": "INTERNAL", "retryable": False, "message": f"unknown method: {request.get('method')}"}})
                continue
            try:
                handler(request)
            except Exception as exc:  # noqa: BLE001 - 一個 request 處理失敗不該拖垮整個 supervisor
                # 2026-08-17 實測過真的會發生（UnicodeEncodeError），沒包住時整個 supervisor
                # process 直接崩潰、後面所有 job 全部收不到回應。
                _emit({"id": request.get("id"), "error": {"code": "INTERNAL", "retryable": True, "message": str(exc)}})
    finally:
        # stdin closed = Node/Electron is gone. Never leave an orphaned
        # worker process behind (memory `electron-quit-orphan-server`).
        _shutdown()


if __name__ == "__main__":
    main()
