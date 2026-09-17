#!/usr/bin/env python3
"""Japanese G2P sidecar（docs/JAPANESE-XIEYIN-V2-PLAN.md Phase 2）。

跟 ai/supervisor.py 同一套精神：常駐 process，Node 用 NDJSON（stdin/stdout，
一行一個 JSON）溝通，禁止每一句歌詞都 spawn 一次 python.exe。跟 supervisor.py
不同的地方是這裡的工作本身很快（G2P 是毫秒級同步呼叫，不是會跑很久的 GPU
推論），所以不需要 supervisor/worker 兩層、不需要背景執行緒與取消機制——
一個 process 讀一行、算完寫一行、繼續讀下一行就夠了。

協定：
  請求  {"id": <string>, "texts": [<string>, ...], "wordLengths"?: [<int[]>|null, ...]}
  回應  {"id": <string>, "results": [{"phonemes": [...], "kana": <string>, "words"?: [int[]] }, ...]}
  失敗  {"id": <string>, "error": <string>}

啟動時先送一行 {"ready": true, "version": <haqumei版本>}，Node 端可以拿這行
確認 sidecar 真的能用（haqumei import 失敗、dictionary 缺失都會在這裡先炸開，
而不是等第一筆真實請求才發現）。

`wordLengths`（可省略；跟 `texts` 等長，每一項是 KRC 逐字模式每個 word 的
字元數陣列，或 null 表示這句不需要逐字拆分）：這是「整句一起做諧音、再切
回逐字」的機制。KRC 逐字的字塊是排時間軸用的人工切法（例如「満員電」／
「車」），常常切在日文詞的中間，跟 Haqumei 自己用 g2p_mapping_prosody()
算出來的詞界對不上——沒辦法完美一一對應。這裡採用「貪婪吃字元數」的近似：
依序把 Haqumei 自己切出來的詞（連同其完整、不拆開的 phoneme 序列）塞進目前
這個 KRC word 的字元預算，塞到達到或超過預算就換下一個 KRC word。任何一個
Haqumei 詞永遠整個給同一個 KRC word，絕不會把一個詞的 phoneme 攔腰拆開——
代價是相鄰 KRC word 的分界點可能跟 Haqumei 詞界差一兩個字（例如「電車」
整個被算進「満員電」，讓「車」那格看起來只從下一個 Haqumei 詞開始），但
整句的讀音本身（尤其是 は／へ／を 這類靠上下文才能讀對的助詞）永遠是用
整句上下文算出來的，不會因為被拆進某個 KRC word 而讀錯。
"""
import json
import sys


def _emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _flatten_word_phonemes(word_detail):
    """WordPhonemeDetail → 純字串 phoneme 列表，遇到 accent_phrase_boundary 轉成
    xieyin-v2-mapper.js 認得的 '#' 詞界標記（PyProsodicPhoneme 是 PyO3 物件，不能
    直接塞進 json.dumps，這裡先攤平成一般 Python list[str]）。"""
    tokens = []
    for p in word_detail.phonemes:
        if p.kind == "accent_phrase_boundary":
            tokens.append("#")
        elif p.phoneme is not None:
            tokens.append(p.phoneme)
    return tokens


def _bucket_by_krc_word_lengths(engine, text, word_lengths):
    """整句只呼叫一次 g2p_mapping_prosody，依 word_lengths（每個 KRC word 的
    字元數）貪婪切回逐字——見上方 docstring。回傳跟 word_lengths 等長的
    list[list[str]]。"""
    haqumei_words = engine.g2p_mapping_prosody(str(text))
    units = [(len(wd.word), _flatten_word_phonemes(wd)) for wd in haqumei_words]

    buckets = []
    h_index = 0
    consumed_chars = 0
    for word_len in word_lengths:
        target = consumed_chars + word_len
        collected = []
        while h_index < len(units) and consumed_chars < target:
            h_len, h_tokens = units[h_index]
            collected.extend(h_tokens)
            collected.append("#")  # 相鄰兩個被塞進同一格的 Haqumei 詞之間也要有邊界，
            # 避免它們湊巧同母音時被 xieyin-v2-mapper.js 誤判成長音。
            consumed_chars += h_len
            h_index += 1
        buckets.append(collected)
    return buckets


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
        word_lengths_list = request.get("wordLengths")
        if not isinstance(texts, list) or not texts:
            _emit({"id": req_id, "error": "texts must be a non-empty array"})
            continue
        if word_lengths_list is not None and (
            not isinstance(word_lengths_list, list) or len(word_lengths_list) != len(texts)
        ):
            _emit({"id": req_id, "error": "wordLengths must be omitted or the same length as texts"})
            continue

        try:
            results = []
            for index, text in enumerate(texts):
                entry = {
                    # g2p_prosody（不是 g2p）：xieyin-v2-mapper.js 需要它夾帶的
                    # #（詞界）標記才能分辨「同一個詞內部的長音」跟「兩個詞
                    # 邊界剛好同母音」——只用 g2p() 的扁平陣列會把後者也誤判
                    # 成長音，吞掉一個音節（2026-09-13 benchmark 實測到的
                    # 案例：「明日また会おう」）。
                    "phonemes": engine.g2p_prosody(str(text)),
                    "kana": engine.g2k(str(text)),
                }
                word_lengths = word_lengths_list[index] if word_lengths_list else None
                if isinstance(word_lengths, list) and word_lengths:
                    entry["words"] = _bucket_by_krc_word_lengths(engine, text, word_lengths)
                results.append(entry)
            _emit({"id": req_id, "results": results})
        except Exception as exc:  # noqa: BLE001 - 單筆請求失敗不能讓 sidecar 掛掉
            _emit({"id": req_id, "error": f"{type(exc).__name__}: {exc}"})


if __name__ == "__main__":
    main()
