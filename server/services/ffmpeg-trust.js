'use strict';

// Reviewed 2026-11-14. These hashes are shipped inside the protected app,
// never taken from mutable metadata at installation time. BtbN uses a retained
// month-end tag. The direct Gyan alias is accepted only while its bytes still
// match 9.0.2; a future alias change fails closed instead of trusting a new hash.
// Provenance: https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/tag/autobuild-2026-10-31-12-59
//             https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2
const FFMPEG_SOURCES = Object.freeze([
  {
    "id": "btbn",
    "label": "BtbN / GitHub",
    "version": "9.0.2-39-g7adfbe40dc",
    "url": "https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59/ffmpeg-n9.0.2-39-g7adfbe40dc-win64-lgpl-9.0.zip",
    "sha256": "9d37c564e0d01c18cde184a079fa6ef04d7d2783ada41da81d04165cc8f1a650",
    "size": 168715328
  },
  {
    "id": "gyan-github",
    "label": "gyan（GitHub 鏡像）",
    "version": "9.0.2",
    "url": "https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip",
    "sha256": "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba",
    "size": 114768076
  },
  {
    "id": "gyan",
    "label": "gyan.dev",
    "version": "9.0.2",
    "url": "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    "sha256": "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba",
    "size": 114768076
  }
].map(source => Object.freeze(source)));

// macOS: FFmpeg 官方不出 Mac 執行檔。Martin Riedl 的 build server 同時提供
// Apple Silicon 與 Intel、已簽章、每個版本有固定網址並附 .sha256（2026-11-23 下載
// 核對：以下雜湊與上游 .sha256 檔一致）。ffmpeg 與 ffprobe 是兩個獨立 zip，
// 各自只含一個執行檔（無資料夾）。設定為 --enable-gpl --enable-version3，與 Windows
// 版 gyan essentials 同屬 GPLv3，因此同樣採「使用者按下載才抓」而不內附。
// Provenance: https://ffmpeg.martin-riedl.de/ （macOS → Release → 9.1）
// 注意：上游公告 2027 年 1 月起不再出 Intel release；屆時 x64 固定留在最後一版。
const FFMPEG_MAC_SOURCES = Object.freeze({
  arm64: Object.freeze([
    Object.freeze({
      id: 'martin-riedl',
      label: 'Martin Riedl（macOS Apple Silicon）',
      version: '9.1',
      ffmpeg: Object.freeze({
        url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1795207104_9.1/ffmpeg.zip',
        sha256: '1f66e9a690a7f1c9e60b012379f8869c11818d1797f45b21dbb2f2564ba61ae1',
        size: 28623086,
      }),
      ffprobe: Object.freeze({
        url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1795207104_9.1/ffprobe.zip',
        sha256: '6ef2df5f575042923a28537ab37adf936f28bf3e7b85de23a1447ed447ec1dbd',
        size: 28541295,
      }),
    }),
  ]),
  x64: Object.freeze([
    Object.freeze({
      id: 'martin-riedl',
      label: 'Martin Riedl（macOS Intel）',
      version: '9.1',
      ffmpeg: Object.freeze({
        url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1795212433_9.1/ffmpeg.zip',
        sha256: '35b3d82cccc2c1d644d49d15f5e57eb913a08ef68f798042c90eecec62c51f1e',
        size: 34064287,
      }),
      ffprobe: Object.freeze({
        url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1795212433_9.1/ffprobe.zip',
        sha256: '41ca7b7cba7992e33f1da3f1bf54db8ec103a4d387b1bfac3162062e8b1074ad',
        size: 33959464,
      }),
    }),
  ]),
});

module.exports = { FFMPEG_SOURCES, FFMPEG_MAC_SOURCES };
