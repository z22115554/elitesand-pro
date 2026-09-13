#!/usr/bin/env python3
"""Japanese G2P sidecar（docs/JAPANESE-XIEYIN-V2-PLAN.md Phase 2）。

跟 ai/supervisor.py 同一套精神：常駐 process，Node 用 NDJSON（stdin/stdout，
一行一個 JSON）溝通，禁止每一句歌詞都 spawn 一次 python.exe。跟 supervisor.py
不同的地方是這裡的工作本身很快（G2P 是毫秒級同步呼叫，不是會跑很久的 GPU
推論），所以不需要 supervisor/worker 兩層、不需要背景執行緒與取消機制——
一個 process 讀一行、算完寫一行、繼續讀下一行就夠了。

協定：
  請求  {"id": <string>, "texts": [<string>, ...]}
  回應  {"id": <string>, "results": [{"phonemes": [...], "kana": <string>}, ...]}
  失敗  {"id": <string>, "error": <string>}

啟動時先送一行 {"ready": true, "version": <haqumei版本>}，Node 端可以拿這行
確認 sidecar 真的能用（haqumei import 失敗、dictionary 缺失都會在這裡先炸開，
而不是等第一筆真實請求才發現）。
"""
import json
import sys


def _emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    try:
        from haqumei import Haqumei
        engine = Haqumei()
    except Exception as exc:  # noqa: BLE001 - 任何載入失敗都要讓 Node 端拿到明確錯誤
        _emit({"ready": False, "error": f"{type(exc).__name__}: {exc}"})
        sys.exit(1)

    try:
        import importlib.metadata
        version = importlib.metadata.version("haqumei")
    except Exception:  # noqa: BLE001 - 版本號拿不到不影響功能，純粹是診斷資訊
        version = None

    _emit({"ready": True, "version": version})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            _emit({"error": f"malformed request JSON: {exc}"})
            continue

        req_id = request.get("id")
        texts = request.get("texts")
        if not isinstance(texts, list) or not texts:
            _emit({"id": req_id, "error": "texts must be a non-empty array"})
            continue

        try:
            results = []
            for text in texts:
                results.append({
                    "phonemes": engine.g2p(str(text)),
                    "kana": engine.g2k(str(text)),
                })
            _emit({"id": req_id, "results": results})
        except Exception as exc:  # noqa: BLE001 - 單筆請求失敗不能讓 sidecar 掛掉
            _emit({"id": req_id, "error": f"{type(exc).__name__}: {exc}"})


if __name__ == "__main__":
    main()
