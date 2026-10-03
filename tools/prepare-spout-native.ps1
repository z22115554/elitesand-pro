param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sdkRoot = Join-Path $projectRoot '.local\spout-sdk'
$sdkCommit = 'f49e2f469f8cb25f559a6eaa61a3f5b8173fc100'
$headersRoot = Join-Path $projectRoot '.local\electron-headers'
$electronVersion = (Get-Content (Join-Path $projectRoot 'node_modules\electron\package.json') -Raw | ConvertFrom-Json).version

if (-not (Test-Path -LiteralPath $sdkRoot)) {
  git clone --no-checkout https://github.com/leadedge/Spout2.git $sdkRoot
  if ($LASTEXITCODE -ne 0) { throw 'Spout SDK download failed.' }
  git -C $sdkRoot checkout --detach $sdkCommit
  if ($LASTEXITCODE -ne 0) { throw 'Pinned Spout SDK checkout failed.' }
}

& node (Join-Path $projectRoot 'node_modules\node-gyp\bin\node-gyp.js') install "--target=$electronVersion" --arch=x64 --dist-url=https://electronjs.org/headers "--devdir=$headersRoot" --ensure
if ($LASTEXITCODE -ne 0) { throw 'Electron native headers download failed.' }

& (Join-Path $PSScriptRoot 'build-spout-native.ps1') -SpoutSdkRoot $sdkRoot -ElectronHeadersRoot (Join-Path $headersRoot $electronVersion)
if ($LASTEXITCODE -ne 0) { throw 'Spout native build failed.' }
