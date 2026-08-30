#!/usr/bin/env python3
"""AI Separation job worker.

One process per job. Spawned by supervisor.py with the job request as a
single JSON line on stdin. Emits NDJSON progress/result/error lines to
stdout — one job per process, so every line implicitly belongs to this job's
id (supervisor re-stamps the id when relaying, this file trusts its own).

A3: real Kim Mel-Band RoFormer inference via audio_separator, wired through
a monkey-patched tqdm so both progress reporting and graceful cancellation
piggyback on the same per-chunk callback (audio_separator has no native
progress hook, but every chunk goes through tqdm.update()).

A4: forceCpu param hides the GPU from torch before it's ever imported —
CUDA_VISIBLE_DEVICES only takes effect if set before torch initialises a
CUDA context, so this MUST happen at the very top of the process (a fresh
worker per job makes that trivial; ai-separation.js is what decides to
retry a GPU_OOM job with forceCpu=true, spawning a brand new worker).
"""
import json
import os
import sys

# 一定要在 import torch（透過 audio_separator）之前就讀到 request 並視情況設好
# CUDA_VISIBLE_DEVICES——這個環境變數只有在 torch 第一次建立 CUDA context 之前
# 設定才有效，main() 裡才讀 request 的話已經太遲了。main() 直接沿用這個已經
# parse 好的 _INITIAL_REQUEST，不會重複讀 stdin。
_INITIAL_REQUEST_LINE = sys.stdin.readline()
_INITIAL_REQUEST = json.loads(_INITIAL_REQUEST_LINE) if _INITIAL_REQUEST_LINE.strip() else None
if _INITIAL_REQUEST and _INITIAL_REQUEST.get("params", {}).get("forceCpu"):
    os.environ["CUDA_VISIBLE_DEVICES"] = "-1"

import threading
import time

_cancel_requested = threading.Event()


class _CancelledDuringInference(Exception):
    pass


def _emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _watch_stdin_for_cancel():
    # Supervisor writes a single {"method":"cancel"} line to ask for a
    # graceful stop. A closed stdin (supervisor died/exited) also means
    # "stop" — an orphaned worker must not keep running forever.
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line.lstrip("\ufeff"))
        except json.JSONDecodeError as exc:
            # 這條通道只有 supervisor 會寫，收到讀不懂的東西代表協定壞了。忽略沒關係
            # （worker 照樣跑完這個 job），但不能一聲不響——取消訊號漏掉會很難查。
            print(f"[worker] ignored unparseable stdin line: {exc}", file=sys.stderr, flush=True)
            continue
        if msg.get("method") == "cancel":
            _cancel_requested.set()
            return
    _cancel_requested.set()


CANCEL_POLL_INTERVAL_S = 0.1  # A1 假 job 用的檢查頻率


def _run_fake_job(job_id, params):
    duration_s = float(params.get("fakeDurationSeconds", 6))
    steps = 12
    step_s = duration_s / steps
    for i in range(steps):
        elapsed_in_step = 0.0
        while elapsed_in_step < step_s:
            if _cancel_requested.is_set():
                _emit({"id": job_id, "error": {"code": "CANCELLED", "retryable": False}})
                return
            sleep_for = min(CANCEL_POLL_INTERVAL_S, step_s - elapsed_in_step)
            time.sleep(sleep_for)
            elapsed_in_step += sleep_for
        progress = (i + 1) / steps
        _emit({
            "id": job_id,
            "event": "progress",
            "stage": "inference",
            "progress": round(progress, 3),
            "etaSeconds": round(duration_s - (i + 1) * step_s, 1),
        })
    _emit({"id": job_id, "result": {"vocal": "(fake) vocal.mp3", "instrumental": "(fake) instrumental.mp3"}})


def _install_progress_and_cancel_hook(job_id, stage_ref):
    """audio_separator has no progress callback API — every chunk goes
    through tqdm.update() internally, so that's the one hook point we have
    for both progress reporting AND graceful cancellation (raising inside
    update() unwinds out of audio_separator's separate() call cleanly,
    same as a real interrupt would).

    2026-08-22 加了 stage_ref（外部可變的一格陣列，stage_ref[0] 是目前階段名稱）：
    第一次真的分離某首歌時，audio_separator 會在 Separator()/load_model() 裡
    自己下載模型權重（Kim checkpoint 動輒 900MB+），那段下載也是用 tqdm，但這個
    hook 原本裝在 load_model() 之後，所以模型下載的進度完全沒有被轉成 NDJSON
    事件，只會原始 tqdm 文字漏到 stderr（使用者只在終端機看得到、UI 上卡在
    「分離中…」看不出真正進度，網路慢的話會誤以為卡死）。現在改成呼叫端在
    下載階段跟推論階段呼叫前，各自把 stage_ref[0] 設成對應的名字，同一個
    patched_update 動態讀這個值，不用重新裝解一次 hook。"""
    import tqdm as tqdm_module

    original_update = tqdm_module.tqdm.update

    def patched_update(self, n=1):
        result = original_update(self, n)
        if _cancel_requested.is_set():
            raise _CancelledDuringInference()
        total = getattr(self, "total", None)
        current = getattr(self, "n", None)
        if total and current is not None:
            _emit({
                "id": job_id,
                "event": "progress",
                "stage": stage_ref[0],
                "progress": round(min(1.0, current / total), 3),
            })
        return result

    tqdm_module.tqdm.update = patched_update
    return lambda: setattr(tqdm_module.tqdm, "update", original_update)


def _run_real_job(job_id, params):
    input_path = params.get("inputPath")
    output_dir = params.get("outputDir")
    model_filename = params.get("model", "vocals_mel_band_roformer.ckpt")
    model_file_dir = params.get("modelFileDir")
    use_autocast = params.get("useAutocast", True)

    if not input_path or not os.path.isfile(input_path):
        _emit({"id": job_id, "error": {"code": "INPUT_UNREADABLE", "retryable": False, "message": f"input file not found: {input_path}"}})
        return
    if not output_dir:
        _emit({"id": job_id, "error": {"code": "INTERNAL", "retryable": False, "message": "outputDir missing"}})
        return
    os.makedirs(output_dir, exist_ok=True)

    _emit({"id": job_id, "event": "progress", "stage": "load", "progress": 0.0})

    restore_tqdm = lambda: None  # noqa: E731 - 若 import/load_model 階段就失敗，finally 仍要有東西可呼叫

    # audio_separator 自己把 sep.separate() 內部的例外 catch 住、印完 log 就回傳
    # 空結果，不會往外拋（2026-08-18 實測發現：CUDA OOM 也是這樣被吞掉的，我們的
    # except Exception 完全看不到它）。掛一個 logging.Handler 偷看 ERROR log
    # 內容，才知道「回傳空結果」的真正原因是不是 OOM，藉此決定要不要觸發 A4 的
    # CPU 降級（跟一般錯誤不同，OOM 才值得自動重試）。
    import logging

    class _OomSniffer(logging.Handler):
        saw_oom = False

        def emit(self, record):
            if "CUDA out of memory" in record.getMessage():
                self.saw_oom = True

    oom_sniffer = _OomSniffer()
    logging.getLogger().addHandler(oom_sniffer)

    try:
        # watcher thread 故意延後到這裡（import + load_model 都跑完）才啟動，
        # 見 main() 裡那段註解——heavy import 當下有背景 thread 在 blocking 讀
        # stdin 會直接卡死。這代表 import/load 這幾秒鐘理論上「取消」還沒有效，
        # 可接受：這段本來就短（正常 3-5 秒），沒有人需要在這裡按取消。
        from audio_separator.separator import Separator

        # 2026-08-22：第一次真的分離某首歌時，Separator()/load_model() 會自己下載
        # 模型權重（Kim checkpoint 900MB+），這段下載本來完全沒有進度事件——hook
        # 提早裝在這裡（import 完成之後、load_model 之前），下載的 tqdm 進度才會
        # 一起被轉成 NDJSON。stage_ref 是可變的一格陣列，讓同一個 hook 在「下載
        # 模型」跟「推論」兩個階段回報不同的 stage 名稱，不用重裝兩次。
        stage_ref = ["download-model"]
        restore_tqdm = _install_progress_and_cancel_hook(job_id, stage_ref)

        # 測試專用：人為限制這個 process 能配置的顯存上限，逼真的觸發 GPU_OOM
        # 來驗證 A4 的降級鏈,不用等真的低顯存硬體（跟 vram_limit_test.py 同技巧）。
        # 只有測試腳本會傳這個參數，正式流程不會用到。
        simulate_vram_limit_gb = params.get("_simulateVramLimitGb")
        if simulate_vram_limit_gb and not os.environ.get("CUDA_VISIBLE_DEVICES") == "-1":
            import torch
            total = torch.cuda.get_device_properties(0).total_memory
            torch.cuda.set_per_process_memory_fraction((simulate_vram_limit_gb * 1024**3) / total, device=0)

        sep = Separator(
            model_file_dir=model_file_dir,
            output_dir=output_dir,
            output_format=params.get("outputFormat", "mp3"),
            use_autocast=bool(use_autocast),
        )
        sep.load_model(model_filename=model_filename)

        # watcher thread 故意延後到這裡（import + load_model 都跑完）才啟動，
        # 見上面／main() 的說明：heavy import 當下有背景 thread 在 blocking 讀
        # stdin 會直接卡死。tqdm hook 已經提早裝好了，這裡只補上取消監聽。
        threading.Thread(target=_watch_stdin_for_cancel, daemon=True).start()
        if _cancel_requested.is_set():
            raise _CancelledDuringInference()

        stage_ref[0] = "inference"
        _emit({"id": job_id, "event": "progress", "stage": "inference", "progress": 0.0})
        outputs = sep.separate(input_path)
        if not outputs:
            if oom_sniffer.saw_oom:
                _emit({"id": job_id, "error": {"code": "GPU_OOM", "retryable": True, "message": "CUDA out of memory (caught via audio_separator's own log output, not a raised exception)"}})
            else:
                _emit({"id": job_id, "error": {"code": "INTERNAL", "retryable": True, "message": "separation produced no output files"}})
            return

        output_paths = [os.path.join(output_dir, name) for name in outputs]
        vocal = next((p for p in output_paths if "(vocals)" in p), None)
        instrumental = next((p for p in output_paths if "(other)" in p or "(instrumental)" in p), None)
        _emit({"id": job_id, "result": {"vocal": vocal, "instrumental": instrumental, "files": output_paths}})
    except _CancelledDuringInference:
        _emit({"id": job_id, "error": {"code": "CANCELLED", "retryable": False}})
    except Exception as exc:  # noqa: BLE001 — 使用者永遠不該看到 PyTorch stack trace，這裡就是那道最後防線
        message = str(exc)
        code = "GPU_OOM" if "CUDA out of memory" in message else "INTERNAL"
        _emit({"id": job_id, "error": {"code": code, "retryable": True, "message": message}})
    finally:
        restore_tqdm()
        logging.getLogger().removeHandler(oom_sniffer)


def main():
    request = _INITIAL_REQUEST  # 已經在模組頂端讀過了（forceCpu 要在 import torch 前決定）
    if request is None:
        sys.exit(1)
    job_id = request.get("id")
    params = request.get("params", {})

    if params.get("fake"):
        # 假 job 沒有重量級 import，直接啟動 watcher 沒有下面那個問題。
        threading.Thread(target=_watch_stdin_for_cancel, daemon=True).start()
        _run_fake_job(job_id, params)
    else:
        # 注意：watcher thread 故意不在這裡先啟動——2026-08-18 實測發現，一個背景
        # thread 在 blocking 讀 stdin（`for line in sys.stdin`）的情況下，
        # `from audio_separator.separator import Separator` 這個重量級 import
        # 會整個卡死不返回（用三層 Node->Python->Python 的最小重現版本才抓到；
        # 兩層 Python 巢狀、或沒有背景 thread 都不會重現，原因目前不明，猜測
        # 跟 torch/onnxruntime import 當下對執行緒環境的偵測有關，沒有再深究）。
        # `_run_real_job()` 自己會在 import／load_model 都跑完、真正進入
        # inference 之前才啟動這個 thread。
        _run_real_job(job_id, params)


if __name__ == "__main__":
    main()
