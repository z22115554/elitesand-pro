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

$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$Package = Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
$Version = $Package.version

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  $OutputRoot = Join-Path $Root "dist"
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

$DirsToCopy = @("server", "public", "node_modules")
foreach ($dir in $DirsToCopy) {
  $src = Join-Path $Root $dir
  if (-not (Test-Path $src)) {
    throw "Missing required directory: $src"
  }
  Copy-Item -LiteralPath $src -Destination $AppRoot -Recurse -Force
}

# Never ship the developer's machine-local configuration. It may contain API keys.
$BundledConfig = Join-Path $AppRoot "server\config.js"
if (Test-Path $BundledConfig) {
  Remove-Item -LiteralPath $BundledConfig -Force
}

# 開發文件（README.md / STATUS.md / HANDOFF.md）刻意不打包：
# 發給朋友的包只需要下方產生的簡易雙語 README-FIRST.txt。
$FilesToCopy = @("package.json", "package-lock.json", "LICENSE", "THIRD-PARTY-NOTICES.txt")
foreach ($file in $FilesToCopy) {
  $src = Join-Path $Root $file
  if (Test-Path $src) {
    Copy-Item -LiteralPath $src -Destination $AppRoot -Force
  }
}
foreach ($legalFile in @("LICENSE", "THIRD-PARTY-NOTICES.txt")) {
  Copy-Item -LiteralPath (Join-Path $Root $legalFile) -Destination $Stage -Force
}

foreach ($dir in @("data", "downloads", "logs")) {
  New-Item -ItemType Directory -Force -Path (Join-Path $AppRoot $dir) | Out-Null
}

$LicensesDir = Join-Path $Stage "licenses"
New-Item -ItemType Directory -Force -Path $LicensesDir | Out-Null

# Machine-readable npm license inventory. Package-level license texts remain in app/node_modules.
$NpmLicenses = @()
Get-ChildItem -LiteralPath (Join-Path $AppRoot "node_modules") -Directory | ForEach-Object {
  $Candidates = if ($_.Name.StartsWith("@")) { Get-ChildItem -LiteralPath $_.FullName -Directory } else { @($_) }
  foreach ($Candidate in $Candidates) {
    $PackageJson = Join-Path $Candidate.FullName "package.json"
    if (Test-Path $PackageJson) {
      try {
        $Meta = Get-Content -LiteralPath $PackageJson -Raw | ConvertFrom-Json
        $NpmLicenses += [ordered]@{ name = $Meta.name; version = $Meta.version; license = $Meta.license }
      } catch { }
    }
  }
}
$NpmLicenses | Sort-Object { $_.name } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $LicensesDir "npm-license-inventory.json") -Encoding UTF8

$NodeCommand = Get-Command node -ErrorAction Stop
Copy-Item -LiteralPath $NodeCommand.Source -Destination (Join-Path $Stage "runtime\node.exe") -Force

foreach ($toolName in @("yt-dlp")) {
  $tool = Get-Command $toolName -ErrorAction SilentlyContinue
  if ($tool -and (Test-Path $tool.Source)) {
    Copy-Item -LiteralPath $tool.Source -Destination (Join-Path $Stage "tools") -Force
    Write-Host "Bundled $toolName from $($tool.Source)"
  } else {
    Write-Warning "$toolName not found on PATH. YouTube import may be limited without it."
  }
}

# v0.7.2 公開測試暫時預設隨附 FFmpeg；可用 -WithoutFfmpeg 建立分離版。
# 每次打包都從實際 exe 讀出 commit，下載同一 commit 的 FFmpeg source + GPLv3。
# 任何一步失敗就停止，不產生缺授權材料的公開包。
$ShouldBundleFfmpeg = -not $WithoutFfmpeg
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
  Invoke-WebRequest -UseBasicParsing -Uri $SourceUrl -OutFile $SourceZip
  Invoke-WebRequest -UseBasicParsing -Uri $LicenseUrl -OutFile (Join-Path $ComplianceOut "COPYING.GPLv3")
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
  Write-Warning "FFmpeg was excluded with -WithoutFfmpeg. YouTube-to-MP3 requires a separate FFmpeg installation."
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

$FfmpegStatusZh = if ($HasFfmpeg) { "已隨附完整授權資料" } else { "未內附；要使用 YouTube 轉 MP3，請另外安裝 FFmpeg" }
$FfmpegStatusEn = if ($HasFfmpeg) { "bundled with matching compliance materials" } else { "not bundled; install FFmpeg separately for YouTube-to-MP3 conversion" }

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
