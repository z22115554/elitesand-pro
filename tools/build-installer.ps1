param()

$ErrorActionPreference = "Stop"

function Assert-Inside {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Parent
  )
  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  $resolvedParent = [System.IO.Path]::GetFullPath($Parent)
  $prefix = $resolvedParent.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if ($resolvedPath -ne $resolvedParent -and -not $resolvedPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside workspace: $resolvedPath"
  }
}

$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$Resources = Join-Path $Root "dist\.electron-builder-resources"
$PortableOutput = Join-Path $Resources "portable"
$Package = Get-Content -LiteralPath (Join-Path $Root "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$PortableStage = Join-Path $PortableOutput "Elitesand-Pro-v$($Package.version)-portable"
$InstallerOutput = Join-Path $Root "dist\releases\v$($Package.version)\installer"

Assert-Inside -Path $Resources -Parent $Root
Assert-Inside -Path $PortableOutput -Parent $Root
Assert-Inside -Path $PortableStage -Parent $Root

if (Test-Path -LiteralPath $Resources) {
  Remove-Item -LiteralPath $Resources -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $Resources | Out-Null

# 打包版 server 的可啟動驗證：把 resources 複製到 repo「外」的 temp 目錄再開機。
# 在 repo 內驗證是無效的——app-root 缺 node_modules 時，Node 模組解析會往上層
# 找到開發用的 node_modules，開發機上永遠正常、使用者機器上直接崩潰。
function Test-InstallerBootOutsideRepo {
  param([Parameter(Mandatory = $true)][string]$UnpackedResources)

  $bootRoot = Join-Path $env:TEMP ("elitesand-installer-boot-" + [System.IO.Path]::GetRandomFileName())
  $bootAppRoot = Join-Path $bootRoot "app-root"
  $bootData = Join-Path $bootRoot "data"
  $bootDownloads = Join-Path $bootRoot "downloads"
  $bootLogs = Join-Path $bootRoot "logs"
  $port = 39000 + (Get-Random -Maximum 1000)
  $serverProcess = $null
  try {
    Write-Host "Installer boot check: staging app-root outside the repo ($bootRoot)..."
    New-Item -ItemType Directory -Force -Path $bootRoot, $bootData, $bootDownloads, $bootLogs | Out-Null
    Copy-Item -LiteralPath (Join-Path $UnpackedResources "app-root") -Destination $bootAppRoot -Recurse -Force

    $env:ELITESAND_DATA_DIR = $bootData
    $env:ELITESAND_DOWNLOADS_DIR = $bootDownloads
    $env:ELITESAND_LOGS_DIR = $bootLogs
    $env:PORT = "$port"
    $env:OPEN_BROWSER = "0"
    $serverProcess = Start-Process -FilePath "node" -ArgumentList @((Join-Path $bootAppRoot "server\index.js")) -PassThru -WindowStyle Hidden

    $healthy = $false
    for ($i = 0; $i -lt 60; $i++) {
      if ($serverProcess.HasExited) { break }
      try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) { $healthy = $true; break }
      } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $healthy) {
      throw "Installer boot check failed: packaged app-root server never became healthy on port $port (missing node_modules?)."
    }
    Write-Host "Installer boot check passed: packaged app-root serves /api/health outside the repo."
  } finally {
    if ($serverProcess -and -not $serverProcess.HasExited) {
      try { Stop-Process -Id $serverProcess.Id -Force -Confirm:$false } catch {}
    }
    Remove-Item Env:ELITESAND_DATA_DIR, Env:ELITESAND_DOWNLOADS_DIR, Env:ELITESAND_LOGS_DIR, Env:PORT, Env:OPEN_BROWSER -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $bootRoot) {
      try { Remove-Item -LiteralPath $bootRoot -Recurse -Force } catch {}
    }
  }
}

try {
  # Keep the installer binaries and FFmpeg GPLv3 material on the exact same
  # path as the portable package. Do not duplicate its compliance workflow.
  & (Join-Path $PSScriptRoot "build-portable.ps1") -OutputRoot $PortableOutput -NoZip
  if ($LASTEXITCODE -ne 0) { throw "Portable staging failed; installer build stopped." }

  foreach ($name in @("app", "tools", "licenses")) {
    $source = Join-Path $PortableStage $name
    if (-not (Test-Path -LiteralPath $source)) { throw "Portable staging is missing $name" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $Resources $(if ($name -eq "app") { "app-root" } else { $name })) -Recurse -Force
  }

  # The staged app-root must carry its production dependency tree; without it the
  # installed server dies with MODULE_NOT_FOUND on any machine that is not this one.
  if (-not (Test-Path -LiteralPath (Join-Path $Resources "app-root\node_modules\express\package.json"))) {
    throw "Staged app-root is missing node_modules\express; refusing to build a broken installer."
  }

  # The installer must never carry an empty-but-writable portable layout.
  $AppRoot = Join-Path $Resources "app-root"
  foreach ($name in @("data", "downloads", "logs")) {
    $runtimeDir = Join-Path $AppRoot $name
    if (Test-Path -LiteralPath $runtimeDir) { Remove-Item -LiteralPath $runtimeDir -Recurse -Force }
    if (Test-Path -LiteralPath $runtimeDir) { throw "Installer app-root still contains $name" }
  }

  Push-Location $Root
  try {
    & (Join-Path $Root "node_modules\.bin\electron-builder.cmd") --win nsis
    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed." }
  } finally {
    Pop-Location
  }

  # electron-builder has silently dropped node_modules from extraResources before.
  # Verify the actual output, then boot the packaged server outside the repo.
  $UnpackedResources = Join-Path $InstallerOutput "win-unpacked\resources"
  foreach ($required in @("app-root\node_modules\express\package.json", "app-root\server\index.js", "tools\yt-dlp.exe", "tools\ffmpeg.exe")) {
    if (-not (Test-Path -LiteralPath (Join-Path $UnpackedResources $required))) {
      throw "Installer output is missing $required; the built installer would be broken on user machines."
    }
  }
  Test-InstallerBootOutsideRepo -UnpackedResources $UnpackedResources

  Write-Host "Installer build complete: $InstallerOutput"
} finally {
  if (Test-Path -LiteralPath $Resources) { Remove-Item -LiteralPath $Resources -Recurse -Force }
}
