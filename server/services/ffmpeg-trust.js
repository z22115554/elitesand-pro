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

module.exports = { FFMPEG_SOURCES };
