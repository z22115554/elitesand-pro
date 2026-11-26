# Runtime dependency locks

Windows x64 / CPython 3.11 (runtime 3.11.9) / PyTorch 2.6.0 + CUDA 12.4.
Maintainer generation: `python tools/lock-python-runtime.py` (uv 0.13.6).
Offline consistency check: `python tools/lock-python-runtime.py --check`.
Inspect all version, hash and license changes before committing. These tools
are never called by the app. Bump section PACKAGES_REVISION when updating its
lock and keep diagnostic constraints/import checks consistent.

AI and section installs use --require-hashes, --isolated and
--no-build-isolation. MuQ's separately pinned local source uses --no-index,
--no-deps and --no-build-isolation; section.in explicitly includes its nnAudio,
easydict and x-clip dependency closure. Torchcrepe is an optional single-package
lock installed without dependencies, all of which are already in the AI lock.

get-pip itself is pinned by python-bootstrap-trust.js. It implicitly adds an
unpinned pip request, so supplying a hashed requirements file alone fails.
The app instead fetches the exact four wheels in bootstrap-wheels.json,
verifies app-pinned hashes and sizes, then gives get-pip only that offline
wheelhouse with --no-index/--no-deps. Source builds cannot fetch hidden build
dependencies: pinned setuptools, wheel and packaging are already available.
The wheelhouse is removed through safeRemove, which supports Chinese paths.

The protected manifest verifies lock bytes before materializing them outside
app.asar for python.exe. Existing AI environments are retained until repair;
they are not retroactively proven by a new lock. Section revision 3 performs
package repair without downloading all models again. Real Windows/GPU
installation and inference validation is still required. Dependency locks
do not grant extra rights to research model weights.

macOS arm64 / CPython 3.12 (python-build-standalone, pinned in
python-mac-runtime-trust.js): ai-mac-arm64-py312.lock (AI separation) and
align-mac-arm64-py312.lock (precise sync: CPU onnxruntime with the same
versions as the Windows list in align-runtime-provider.js). Both are installed
with --require-hashes --no-deps --only-binary=:all: from PyPI only. Bump the
r-number in MAC_RUNTIME_ID / MAC_ALIGN_RUNTIME_ID when changing either lock.
Intel Macs are not covered: torch, onnxruntime >= 1.24 and sentencepiece
0.2.3 publish no macOS x86_64 wheels.
