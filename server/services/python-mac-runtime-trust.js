'use strict';

/**
 * macOS（Apple Silicon）AI 分離用的 Python runtime 信任根。
 *
 * 來源：astral-sh/python-build-standalone 的 install_only 版本（官方 CPython 編譯，可攜、
 * 不依賴系統 Python）。版本與 SHA-256 取自該 release 的 SHA256SUMS（2026-11-26 下載核對，
 * 並用實際下載的檔案再算一次確認相符），之後每次安裝都驗這個值，不信任下載當下的回應。
 *
 * 只提供 aarch64：PyTorch 已不出 macOS x86_64 版本，Intel Mac 不支援人聲分離（見 macSupport）。
 * 套件清單在 python-locks/ai-mac-arm64-py312.lock（--require-hashes）。
 */
const MAC_PYTHON = Object.freeze({
  version: '3.12.16',
  release: '20261124',
  file: 'cpython-3.12.16+20261124-aarch64-apple-darwin-install_only.tar.gz',
  url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20261124/cpython-3.12.16%2B20261124-aarch64-apple-darwin-install_only.tar.gz',
  sha256: '431b99a9c2cdd37ad9b06e425be0e520d2dbce0552abe454257abef592fe3634',
  size: 25399370,
  // 解壓後的頂層資料夾與執行檔、site-packages 位置（相對於 runtime 的 python/ 目錄）
  executable: ['bin', 'python3'],
  sitePackages: ['lib', 'python3.12', 'site-packages'],
});

// 本機 marker 用的版本字串：換 Python 或換鎖定清單時改這裡，舊安裝就會被視為需要重裝。
const MAC_RUNTIME_ID = `pbs-${MAC_PYTHON.version}+${MAC_PYTHON.release}/ai-mac-r1`;

// Apple Silicon 必要條件：macOS 14（Darwin 23）以上——torch 2.15 的 wheel 是 macosx_14_0_arm64。
const MIN_DARWIN_MAJOR = 23;

module.exports = { MAC_PYTHON, MAC_RUNTIME_ID, MIN_DARWIN_MAJOR };
