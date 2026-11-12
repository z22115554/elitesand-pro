# -*- coding: utf-8 -*-
"""
把演出用的字型做成子集，放進 public/alert-show/fonts/（離線也能用正確的字型）。

    python tools/alert-show/build-fonts.py <放原始 TTF 的資料夾>

原始字型不進版本庫（一個十幾 MB）；都來自 github.com/google/fonts 的 ofl/ 目錄，授權是 SIL OFL 1.1：
    DelaGothicOne-Regular.ttf  BlackHanSans-Regular.ttf  Gaegu-Bold.ttf
    NotoSansTC[wght].ttf  NotoSansSC[wght].ttf  NotoSansJP[wght].ttf  NotoSansKR[wght].ttf
    LXGWWenKaiTC-Regular.ttf  LXGWWenKaiTC-Bold.ttf
    以及各自的 OFL.txt（存成 OFL-<資料夾名>.txt）

子集只留「引擎原始碼裡出現過的字」＋基本拉丁字母與標點：演出畫面上固定的字（標題、效果字、
五語文案）一定有；觀眾名字裡其他的字，線上時由 Google Fonts 補，離線時退回系統字型。
所以引擎加了新的畫面文字後要重跑這支（tests 會檢查子集有沒有涵蓋引擎用到的字）。

需要 fonttools 與 brotli（pip install fonttools brotli）。
"""
import io
import json
import os
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'alert-show', 'fonts')
ENGINE = os.path.join(ROOT, 'public', 'alert-show', 'engine.js')

# (輸出檔名, CSS 字型名稱, 字重, 原始檔, 可變字型要固定的字重, 授權檔代號)
FACES = [
    ('dela-gothic-one.woff2', 'Dela Gothic One', 400, 'DelaGothicOne-Regular.ttf', None, 'delagothicone'),
    ('black-han-sans.woff2', 'Black Han Sans', 400, 'BlackHanSans-Regular.ttf', None, 'blackhansans'),
    ('gaegu-700.woff2', 'Gaegu', 700, 'Gaegu-Bold.ttf', None, 'gaegu'),
    ('noto-sans-tc-900.woff2', 'Noto Sans TC', 900, 'NotoSansTC[wght].ttf', 900, 'notosanstc'),
    ('noto-sans-sc-900.woff2', 'Noto Sans SC', 900, 'NotoSansSC[wght].ttf', 900, 'notosanssc'),
    ('noto-sans-jp-900.woff2', 'Noto Sans JP', 900, 'NotoSansJP[wght].ttf', 900, 'notosansjp'),
    ('noto-sans-kr-900.woff2', 'Noto Sans KR', 900, 'NotoSansKR[wght].ttf', 900, 'notosanskr'),
    ('lxgw-wenkai-tc-400.woff2', 'LXGW WenKai TC', 400, 'LXGWWenKaiTC-Regular.ttf', None, 'lxgwwenkaitc'),
    ('lxgw-wenkai-tc-700.woff2', 'LXGW WenKai TC', 700, 'LXGWWenKaiTC-Bold.ttf', None, 'lxgwwenkaitc'),
]


def wanted_chars():
    head = io.open(ENGINE, encoding='utf-8').readline()
    text = json.loads(re.match(r'window\.__V2_TEXT = (".*");', head).group(1))
    basic = ''.join(chr(c) for c in range(0x20, 0x7F))
    extra = '…‥·・「」『』（）！？：；，。、～ー—–×★☆♪♥→←↑↓％＋－＝／'
    return sorted(set(text + basic + extra))


def ranges(codepoints):
    out, start, prev = [], None, None
    for cp in sorted(codepoints):
        if start is None:
            start = prev = cp
        elif cp == prev + 1:
            prev = cp
        else:
            out.append((start, prev)); start = prev = cp
    if start is not None:
        out.append((start, prev))
    return ', '.join('U+%X' % a if a == b else 'U+%X-%X' % (a, b) for a, b in out)


def main():
    src = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    chars = wanted_chars()
    css = ['/* 由 tools/alert-show/build-fonts.py 產生，不要手改。',
           '   演出畫面上固定會出現的字放在本機（離線可用）；其餘的字由 Google Fonts 或系統字型補。',
           '   授權：SIL Open Font License 1.1，見同資料夾的 OFL.txt。 */']
    total = 0
    licenses = {}
    for name, family, weight, source, fixed, lic in FACES:
        font = TTFont(os.path.join(src, source))
        options = subset.Options()
        options.layout_features = ['*']
        options.name_IDs = ['*']
        options.notdef_outline = True
        options.glyph_names = False
        options.hinting = False
        options.desubroutinize = True
        sub = subset.Subsetter(options)
        sub.populate(unicodes=[ord(c) for c in chars])
        sub.subset(font)
        if fixed is not None:
            font = instancer.instantiateVariableFont(font, {'wght': fixed})
        font.flavor = 'woff2'
        path = os.path.join(OUT, name)
        font.save(path)
        have = sorted(set(TTFont(path).getBestCmap().keys()))
        size = os.path.getsize(path)
        total += size
        css.append("@font-face { font-family: '%s'; font-style: normal; font-weight: %d; font-display: block; src: url('fonts/%s') format('woff2'); unicode-range: %s; }"
                   % (family, weight, name, ranges(have)))
        licenses.setdefault(lic, []).append(family)
        print('%-28s %4d 字 %7.1f KB' % (name, len(have), size / 1024.0))
    io.open(os.path.join(ROOT, 'public', 'alert-show', 'fonts.css'), 'w', encoding='utf-8', newline='\n').write('\n'.join(css) + '\n')
    parts = ['聲嶼 Elitesand Pro 的訂閱／贈訂／揪團演出內附下列字型的子集（只含演出畫面用到的字）。',
             '這些字型各自依 SIL Open Font License 1.1 授權，原始授權文字如下。', '']
    for lic, families in licenses.items():
        parts.append('=' * 72)
        parts.append('字型：' + '、'.join(sorted(set(families))))
        parts.append('=' * 72)
        parts.append(io.open(os.path.join(src, 'OFL-%s.txt' % lic), encoding='utf-8').read().strip())
        parts.append('')
    io.open(os.path.join(OUT, 'OFL.txt'), 'w', encoding='utf-8', newline='\n').write('\n'.join(parts) + '\n')
    print('合計 %.1f KB；要求 %d 字' % (total / 1024.0, len(chars)))


if __name__ == '__main__':
    main()
