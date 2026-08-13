param(
  [string]$OutputRoot = "",
  [switch]$NoZip,
  [switch]$BundleFfmpeg,
  [switch]$WithoutFfmpeg
)

$ErrorActionPreference = "Stop"

function Assert-Inside {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Parent
  )
  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  $resolvedParent = [System.IO.Path]::GetFullPath($Parent)
  if (-not $resolvedPath.StartsWith($resolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside workspace: $resolvedPath"
  }
}

function Get-ReleaseDownload {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$OutFile
  )

  # Windows PowerShell's Invoke-WebRequest can leave a partial output file
  # without surfacing a useful process exit status. Prefer the system curl
  # when available so a failed compliance download always stops the build.
  $CurlCommand = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($CurlCommand -and (Test-Path $CurlCommand.Source)) {
    & $CurlCommand.Source --fail --location --silent --show-error --output $OutFile $Uri
    if ($LASTEXITCODE -ne 0) {
      throw "Download failed: $Uri"
    }
  } else {
    Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile
  }

  if (-not (Test-Path $OutFile) -or (Get-Item -LiteralPath $OutFile).Length -eq 0) {
    throw "Download produced an empty file: $Uri"
  }
}

$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$TestCommand = Get-Command npm.cmd -ErrorAction Stop
Write-Host "Running required test gate before packaging..."
& $TestCommand.Source --prefix $Root test
if ($LASTEXITCODE -ne 0) { throw "npm test failed; refusing to package an unverified portable build." }
$Package = Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
$Version = $Package.version

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  # Keep every release isolated.  The GitHub asset name can remain stable,
  # while local artifacts from a newer version never replace an older one.
  $OutputRoot = Join-Path $Root "dist\releases\v$Version\portable"
}

$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
$Stage = Join-Path $OutputRoot "Elitesand-Pro-v$Version-portable"
$ZipPath = "$Stage.zip"
$HashPath = "$ZipPath.sha256"

Assert-Inside -Path $OutputRoot -Parent $Root
Assert-Inside -Path $Stage -Parent $Root
Assert-Inside -Path $ZipPath -Parent $Root
Assert-Inside -Path $HashPath -Parent $Root

Write-Host "Building portable package..."
Write-Host "Project: $Root"
Write-Host "Output : $Stage"

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
if (Test-Path $Stage) {
  Remove-Item -LiteralPath $Stage -Recurse -Force
}
if (Test-Path $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}
if (Test-Path $HashPath) {
  Remove-Item -LiteralPath $HashPath -Force
}

New-Item -ItemType Directory -Force -Path $Stage | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Stage "app") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Stage "runtime") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Stage "tools") | Out-Null

$AppRoot = Join-Path $Stage "app"

# Runtime folders belong to the receiving user, never to the developer who
# created the archive. Reset them both before packaging and after the smoke
# test so a future smoke implementation cannot leave local data behind.
function Reset-PackagedRuntimeData {
  foreach ($dir in @("data", "downloads", "logs")) {
    $target = Join-Path $AppRoot $dir
    Assert-Inside -Path $target -Parent $Stage
    if (Test-Path $target) {
      Remove-Item -LiteralPath $target -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    if ($null -ne (Get-ChildItem -LiteralPath $target -Force | Select-Object -First 1)) {
      throw "Runtime folder was not empty after reset: $target"
    }
  }
}

$DirsToCopy = @("server", "public")
foreach ($dir in $DirsToCopy) {
  $src = Join-Path $Root $dir
  if (-not (Test-Path $src)) {
    throw "Missing required directory: $src"
  }
  Copy-Item -LiteralPath $src -Destination $AppRoot -Recurse -Force
}

# Production-only bundling: minify server/**（結構不變）與把每個 HTML 頁面的
# 本機 <script> 合併成單一 bundle。只對這份 staging 副本動手，repo 裡的
# server/、public/ 原始碼完全不受影響——npm start、npm test 繼續吃原始檔案。
# Source map 另存到 dist/.source-maps/（不隨任何發布產物打包），供未來對照
# production stack trace 用。
$NodeCommandForBundling = Get-Command node -ErrorAction Stop
$SourceMapOut = Join-Path $Root "dist\.source-maps\v$Version"
if (Test-Path $SourceMapOut) {
  Remove-Item -LiteralPath $SourceMapOut -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $SourceMapOut | Out-Null
Write-Host "Building production bundles (server minify + per-page frontend bundles)..."
& $NodeCommandForBundling.Source (Join-Path $Root "tools\build-production-bundles.js") $AppRoot --sourcemap-out $SourceMapOut
if ($LASTEXITCODE -ne 0) {
  throw "Production bundling failed (build-production-bundles.js). Portable build stopped."
}

# Never ship the developer's machine-local configuration. It may contain API keys.
$BundledConfig = Join-Path $AppRoot "server\config.js"
if (Test-Path $BundledConfig) {
  Remove-Item -LiteralPath $BundledConfig -Force
}

# 開發文件（README.md / STATUS.md / HANDOFF.md）刻意不打包：
# 發給朋友的包只需要下方產生的簡易雙語 README-FIRST.txt。
$FilesToCopy = @("package.json", "package-lock.json", "LICENSE", "EULA.txt", "THIRD-PARTY-NOTICES.txt")
foreach ($file in $FilesToCopy) {
  $src = Join-Path $Root $file
  if (Test-Path $src) {
    Copy-Item -LiteralPath $src -Destination $AppRoot -Force
  }
}
foreach ($legalFile in @("LICENSE", "EULA.txt", "THIRD-PARTY-NOTICES.txt")) {
  Copy-Item -LiteralPath (Join-Path $Root $legalFile) -Destination $Stage -Force
}

# Build the staged dependency tree from the lockfile instead of copying the
# developer's node_modules. This is important before Electron becomes a
# development dependency: a portable Node package must contain only runtime
# dependencies, never the desktop build toolchain or its cached artefacts.
$NpmCommand = Get-Command npm -ErrorAction Stop
Write-Host "Installing production dependencies in staging..."
Push-Location $AppRoot
try {
  & $NpmCommand.Source ci --omit=dev --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) {
    throw "npm ci --omit=dev failed while preparing portable dependencies."
  }
} finally {
  Pop-Location
}

Reset-PackagedRuntimeData

$LicensesDir = Join-Path $Stage "licenses"
New-Item -ItemType Directory -Force -Path $LicensesDir | Out-Null

# Nunito 字體的 OFL.txt 已經跟著 public/fonts/ 一起被複製進 app-root（滿足 OFL 授權要求
# 「授權文字要跟字體放在一起」），這裡在 licenses/ 底下再放一份方便集中查閱。
$NunitoLicenseSource = Join-Path $Root "public\fonts\OFL.txt"
if (-not (Test-Path -LiteralPath $NunitoLicenseSource)) {
  throw "Missing public/fonts/OFL.txt; Nunito is bundled but its OFL license text is not."
}
$NunitoLicenseOut = Join-Path $LicensesDir "nunito"
New-Item -ItemType Directory -Force -Path $NunitoLicenseOut | Out-Null
Copy-Item -LiteralPath $NunitoLicenseSource -Destination (Join-Path $NunitoLicenseOut "OFL.txt") -Force

# Machine-readable npm license inventory. Package-level license texts remain in app/node_modules.
# 批次 D-2：不能只看 package.json 的 "license" 欄位就放棄——有些套件（如 busboy、
# streamsearch）用的是舊式 "licenses": [{type: "MIT", ...}] 陣列格式，欄位對不上但
# 授權其實很清楚。依序嘗試：現代 license 欄位 → 舊式 licenses 陣列 → 套件目錄內是否
# 存在 LICENSE 類檔案（存在就不算真的 UNKNOWN，只是需要人工看檔案內容）。
# 三者都沒有才是真的 UNKNOWN，最後會讓這次建置直接失敗，而不是靜默放行。
$NpmLicenses = @()
Get-ChildItem -LiteralPath (Join-Path $AppRoot "node_modules") -Directory | ForEach-Object {
  $Candidates = if ($_.Name.StartsWith("@")) { Get-ChildItem -LiteralPath $_.FullName -Directory } else { @($_) }
  foreach ($Candidate in $Candidates) {
    $PackageJson = Join-Path $Candidate.FullName "package.json"
    if (-not (Test-Path $PackageJson)) { continue }
    try {
      $Meta = Get-Content -LiteralPath $PackageJson -Raw | ConvertFrom-Json
    } catch { continue }

    $License = $null
    $Source = $null
    if ($Meta.license) {
      $License = if ($Meta.license -is [string]) { $Meta.license } else { $Meta.license.type }
      $Source = 'license-field'
    } elseif ($Meta.licenses -and $Meta.licenses.Count -gt 0) {
      $License = ($Meta.licenses | ForEach-Object { $_.type }) -join ' OR '
      $Source = 'legacy-licenses-array'
    } else {
      $LicenseFile = Get-ChildItem -LiteralPath $Candidate.FullName -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^(LICEN[SC]E|COPYING)(\..*)?$' } | Select-Object -First 1
      if ($LicenseFile) {
        $License = "SEE $($LicenseFile.Name)"
        $Source = 'license-file-present'
      }
    }

    $NpmLicenses += [ordered]@{
      name = $Meta.name
      version = $Meta.version
      license = $License
      source = $Source
    }
  }
}
$UnknownLicenses = $NpmLicenses | Where-Object { -not $_.license }
if ($UnknownLicenses.Count -gt 0) {
  $UnknownNames = ($UnknownLicenses | ForEach-Object { "$($_.name)@$($_.version)" }) -join ', '
  throw "Release audit failed: packages with no discoverable license (field, legacy array, or LICENSE file): $UnknownNames"
}
$NpmLicenses | Sort-Object { $_.name } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $LicensesDir "npm-license-inventory.json") -Encoding UTF8
Write-Host "npm license inventory: $($NpmLicenses.Count) packages, 0 unknown"

$NodeCommand = Get-Command node -ErrorAction Stop
Copy-Item -LiteralPath $NodeCommand.Source -Destination (Join-Path $Stage "runtime\node.exe") -Force

foreach ($toolName in @("yt-dlp")) {
  $tool = Get-Command $toolName -ErrorAction SilentlyContinue
  if ($tool -and (Test-Path $tool.Source)) {
    Copy-Item -LiteralPath $tool.Source -Destination (Join-Path $Stage "tools") -Force
    Write-Host "Bundled $toolName from $($tool.Source)"

    # 批次 D-2：不能只從 PATH 複製一個無法追溯版本的 exe——記錄實際版本與 SHA-256，
    # 並抓對應的授權文件。任何一步失敗就停止，不產生缺授權材料的公開包。
    $YtdlpLicenseOut = Join-Path $LicensesDir "yt-dlp"
    New-Item -ItemType Directory -Force -Path $YtdlpLicenseOut | Out-Null
    $YtdlpVersion = (& $tool.Source --version 2>&1 | Select-Object -First 1).ToString().Trim()
    $YtdlpHash = (Get-FileHash -LiteralPath (Join-Path $Stage "tools\yt-dlp.exe") -Algorithm SHA256).Hash.ToLowerInvariant()
    Get-ReleaseDownload -Uri "https://raw.githubusercontent.com/yt-dlp/yt-dlp/$YtdlpVersion/LICENSE" -OutFile (Join-Path $YtdlpLicenseOut "LICENSE.txt")
    Get-ReleaseDownload -Uri "https://raw.githubusercontent.com/yt-dlp/yt-dlp/$YtdlpVersion/THIRD_PARTY_LICENSES.txt" -OutFile (Join-Path $YtdlpLicenseOut "THIRD_PARTY_LICENSES.txt")
    $YtdlpInfo = @"
yt-dlp binary provenance
=========================

Bundled version: $YtdlpVersion
Source: $($tool.Source)
SHA-256 of bundled tools\yt-dlp.exe: $YtdlpHash
Upstream: https://github.com/yt-dlp/yt-dlp/releases/tag/$YtdlpVersion
License: LICENSE.txt (Unlicense/public domain) and THIRD_PARTY_LICENSES.txt
(bundled dependency licenses) in this folder, fetched from the matching
upstream tag at build time.
"@
    Set-Content -LiteralPath (Join-Path $YtdlpLicenseOut "PROVENANCE.txt") -Value $YtdlpInfo -Encoding UTF8
    Write-Host "yt-dlp provenance recorded: $YtdlpVersion, sha256 $YtdlpHash"
  } else {
    Write-Warning "$toolName not found on PATH. YouTube import may be limited without it."
  }
}

# 批次 D-1（CLOSED_SOURCE_MIGRATION_PLAN.md）：預設不再內附 FFmpeg。
# GPLv3 static build 的完整對應原始碼義務很重，改成程式內「按需下載＋SHA-256 驗證」
# （見 server/services/ffmpeg-provider.js）。只有明確傳 -BundleFfmpeg 才會走舊的內附流程
# （每次打包都從實際 exe 讀出 commit，下載同一 commit 的 FFmpeg source + GPLv3，
# 任何一步失敗就停止，不產生缺授權材料的公開包）——保留這個選項只是給需要離線內附版的
# 情境用，預設關閉。
$ShouldBundleFfmpeg = [bool]$BundleFfmpeg
if ($ShouldBundleFfmpeg) {
  $FfmpegCommand = Get-Command ffmpeg -ErrorAction Stop
  $FfprobeCommand = Get-Command ffprobe -ErrorAction Stop
  $FfmpegVersionText = (& $FfmpegCommand.Source -version 2>&1) -join "`r`n"
  $CommitMatch = [regex]::Match($FfmpegVersionText, 'git-([0-9a-fA-F]{7,40})')
  if (-not $CommitMatch.Success) {
    throw "Cannot bundle FFmpeg: unable to identify the exact git commit from ffmpeg -version"
  }
  $FfmpegCommit = $CommitMatch.Groups[1].Value.ToLowerInvariant()
  $ComplianceOut = Join-Path $LicensesDir "ffmpeg"
  New-Item -ItemType Directory -Force -Path $ComplianceOut | Out-Null

  foreach ($toolName in @("ffmpeg", "ffprobe")) {
    $tool = Get-Command $toolName -ErrorAction Stop
    Copy-Item -LiteralPath $tool.Source -Destination (Join-Path $Stage "tools") -Force
    Write-Host "Bundled $toolName from $($tool.Source)"
  }

  $SourceUrl = "https://github.com/FFmpeg/FFmpeg/archive/$FfmpegCommit.zip"
  $LicenseUrl = "https://raw.githubusercontent.com/FFmpeg/FFmpeg/$FfmpegCommit/COPYING.GPLv3"
  $SourceZip = Join-Path $ComplianceOut "ffmpeg-source-$FfmpegCommit.zip"
  Write-Host "Downloading matching FFmpeg source: $FfmpegCommit"
  Get-ReleaseDownload -Uri $SourceUrl -OutFile $SourceZip
  Get-ReleaseDownload -Uri $LicenseUrl -OutFile (Join-Path $ComplianceOut "COPYING.GPLv3")
  if ((Get-Item -LiteralPath $SourceZip).Length -lt 1000000) {
    throw "Cannot bundle FFmpeg: downloaded source archive is unexpectedly small"
  }

  $BuildInfo = @"
FFmpeg binary build information
===============================

Binary distributor: https://www.gyan.dev/ffmpeg/builds/
Detected FFmpeg commit: $FfmpegCommit
Exact source archive: $SourceUrl

ffmpeg -version output:
$FfmpegVersionText

This package redistributes ffmpeg.exe and ffprobe.exe as separate command-line
programs under GPLv3. Elitesand Pro invokes them as external processes.
"@
  Set-Content -LiteralPath (Join-Path $ComplianceOut "BUILD.txt") -Value $BuildInfo -Encoding UTF8

  $SourceInfo = @"
Corresponding source information
================================

The exact FFmpeg source snapshot detected from the bundled binary is included
beside this file as ffmpeg-source-$FfmpegCommit.zip.

Upstream source: https://github.com/FFmpeg/FFmpeg/tree/$FfmpegCommit
Binary build project and external-library list: https://www.gyan.dev/ffmpeg/builds/
FFmpeg legal guidance: https://ffmpeg.org/legal.html

The Gyan essentials build is static GPLv3 and includes external libraries.
Their names and upstream projects are listed by the build distributor. This
notice and BUILD.txt must remain with any redistribution of these binaries.
"@
  Set-Content -LiteralPath (Join-Path $ComplianceOut "SOURCE.txt") -Value $SourceInfo -Encoding UTF8
} else {
  Write-Host "FFmpeg not bundled (default since batch D-1). App will offer an in-app download on first use, or a system/config-specified FFmpeg is used automatically."
}

$HasFfmpeg = Test-Path (Join-Path $Stage "tools\ffmpeg.exe")

# Keep the launcher pure cmd: no PowerShell, no network calls.
# A version using hidden-window PowerShell + Invoke-WebRequest polling gets flagged by
# Windows Defender as a malware pattern and silently deleted (verified: the file does not
# even survive on disk), so the app would simply "not start" on a tester machine.
# The browser is opened by Node once the server is ready (see OPEN_BROWSER in server/index.js).
$Launcher = @'
@echo off
chcp 65001 >nul
title Elitesand Pro
cd /d "%~dp0app"
set "PATH=%~dp0tools;%PATH%"
set "PORT=3000"
set "OPEN_BROWSER=1"

echo.
echo ============================================================
echo  Elitesand Pro is starting...
echo.
echo  Control panel     : http://localhost:3000/
echo  Phone remote      : http://localhost:3000/controller
echo  OBS lyrics source : http://localhost:3000/display
echo  OBS setlist source: http://localhost:3000/setlist
echo.
echo  Please wait - the browser opens automatically when ready.
echo  The FIRST launch can take 10-30 seconds. Please be patient.
echo.
echo  Keep this window open while using Elitesand Pro.
echo  Close this window to stop the app.
echo ============================================================
echo.

"%~dp0runtime\node.exe" server\index.js
set "ELITESAND_EXIT=%ERRORLEVEL%"

rem Exit code 42 means the verified external updater owns the restart.
rem Leave this launcher immediately so it does not keep an obsolete console paused.
if "%ELITESAND_EXIT%"=="42" exit /b 0

echo.
echo Elitesand Pro has stopped. Press any key to close this window.
pause >nul
'@

# Write the .cmd as ascii (no BOM): PowerShell 5.1 -Encoding UTF8 adds a BOM, which cmd.exe
# folds into the first line `@echo off` and shows a garbled error on launch. The launcher is
# all ASCII, so ascii encoding is the safest and is guaranteed BOM-free.
Set-Content -LiteralPath (Join-Path $Stage "Start Elitesand Pro.cmd") -Value $Launcher -Encoding ascii

$FfmpegStatusZh = if ($HasFfmpeg) { "已隨附完整授權資料" } else { "未內附；第一次需要轉 MP3 時，控制面板會提示一鍵下載（來自官方建置頁，自動驗證雜湊）" }
$FfmpegStatusEn = if ($HasFfmpeg) { "bundled with matching compliance materials" } else { "not bundled; the control panel offers a one-click download from the official build page (SHA-256 verified) the first time MP3 conversion is needed" }

$Readme = @"
==============================================
 Elitesand Pro
 版本 / Version: $Version
==============================================

── 中文說明 ──────────────────────────────

【怎麼開始】
1. 在 ZIP 上按右鍵 →「解壓縮全部」到一般資料夾（例如桌面）。
   （不要直接在 ZIP 裡面執行，一定要先解壓縮。）
2. 雙擊「Start Elitesand Pro.cmd」。
3. 如果 Windows 跳出藍色視窗「Windows 已保護您的電腦」：
   點「其他資訊」→「仍要執行」。（未簽章程式的正常現象。）
4. 會開啟一個黑色視窗。第一次啟動可能需要 10~30 秒
   （Windows 會掃描檔案），請耐心等候、不要關閉視窗。
5. 瀏覽器會自動開啟控制面板：
   http://localhost:3000/

【常用網址】
   控制面板（電腦）  http://localhost:3000/
   手機遙控器        http://localhost:3000/controller
   OBS 歌詞來源      http://localhost:3000/display
   OBS 歌單來源      http://localhost:3000/setlist

【怎麼關閉】
   關掉黑色視窗即可。

【授權條款】
- 第一次啟動時，控制面板會顯示最終使用者授權（EULA）；
  請閱讀到最底、勾選同意後即可開始使用（之後不會再出現）。
- 完整條文請見本資料夾內的 EULA.txt 與 LICENSE。

【注意事項】
- 不需要安裝 Node.js、不需要打任何指令，所有東西都已內附。
- 防毒軟體詢問時，請允許「Start Elitesand Pro.cmd」與 node.exe 執行。
- yt-dlp 已內附；FFmpeg：$FfmpegStatusZh。
- 歌曲、快取與設定存在 app\data、app\downloads、app\logs。
- 如果 3000 埠被占用，先關掉占用的程式再重新啟動。

── English ──────────────────────────────

[Getting started]
1. Right-click the ZIP -> "Extract All..." to a normal folder (e.g. Desktop).
   (Do NOT run it from inside the ZIP - extract first.)
2. Double-click "Start Elitesand Pro.cmd".
3. If Windows shows a blue box "Windows protected your PC":
   click "More info" -> "Run anyway". (Normal for unsigned apps.)
4. A black window opens. The FIRST launch can take 10-30 seconds while
   Windows scans the files - please be patient and keep the window open.
5. The control panel opens automatically in your browser:
   http://localhost:3000/

[URLs]
   Control panel (PC)  http://localhost:3000/
   Phone remote        http://localhost:3000/controller
   OBS lyrics source   http://localhost:3000/display
   OBS setlist source  http://localhost:3000/setlist

[To stop]
   Close the black window.

[License]
- On first launch, the control panel shows the End-User License Agreement.
  Read to the bottom and tick "I agree" to start (it will not appear again).
- Full terms: EULA.txt and LICENSE in this folder.

[Notes]
- You do NOT need to install Node.js or run any commands. Everything is included.
- If your antivirus asks, allow "Start Elitesand Pro.cmd" / node.exe to run.
- yt-dlp is bundled; FFmpeg is $FfmpegStatusEn.
- Songs, cache, and settings are saved inside app\data, app\downloads, app\logs.
- If port 3000 is already in use, close the other app first, then try again.
"@

Set-Content -LiteralPath (Join-Path $Stage "README-FIRST.txt") -Value $Readme -Encoding UTF8

$Manifest = [ordered]@{
  name = "Elitesand Pro portable"
  version = $Version
  builtAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz")
  node = (& $NodeCommand.Source --version)
  bundledTools = @(Get-ChildItem -LiteralPath (Join-Path $Stage "tools") -File | Select-Object -ExpandProperty Name)
}
$Manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $Stage "portable-manifest.json") -Encoding UTF8

Write-Host "Running packaged-app smoke test..."
& $NodeCommand.Source (Join-Path $Root "tools\smoke-portable.js") $Stage
if ($LASTEXITCODE -ne 0) {
  throw "Packaged-app smoke test failed. ZIP creation was stopped."
}

# The smoke test must not make a release archive carry developer-local state,
# media, or logs. The empty folders are recreated for first launch.
Reset-PackagedRuntimeData

if (-not $NoZip) {
  Write-Host "Creating zip..."
  Compress-Archive -LiteralPath $Stage -DestinationPath $ZipPath -Force
  $Hash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  [System.IO.File]::WriteAllText($HashPath, $Hash, [System.Text.Encoding]::ASCII)
  if ((Get-Content -LiteralPath $HashPath -Raw -Encoding ASCII) -notmatch '^[a-f0-9]{64}$') {
    throw "Generated portable SHA-256 file is not exactly 64 hexadecimal characters."
  }
  Write-Host "Zip created: $ZipPath"
  Write-Host "SHA-256 : $HashPath"
}

Write-Host ""
Write-Host "Portable package ready:"
Write-Host "  $Stage"
if (-not $NoZip) {
  Write-Host "  $ZipPath"
  Write-Host "  $HashPath"
}
