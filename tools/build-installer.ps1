param(
  [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"

function Get-Sha256Hex {
  param([Parameter(Mandatory = $true)][string]$LiteralPath)
  $stream = [System.IO.File]::OpenRead($LiteralPath)
  $hasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    return [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
  } finally {
    $hasher.Dispose()
    $stream.Dispose()
  }
}

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

function Get-RelativeWorkspacePath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Parent
  )
  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  $resolvedParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
  $parentUri = [System.Uri]::new($resolvedParent + [System.IO.Path]::DirectorySeparatorChar)
  $pathUri = [System.Uri]::new($resolvedPath)
  return [System.Uri]::UnescapeDataString($parentUri.MakeRelativeUri($pathUri).ToString()).Replace('\', '/')
}

$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$TestCommand = Get-Command npm.cmd -ErrorAction Stop
Write-Host "Running required test gate before packaging..."
& $TestCommand.Source --prefix $Root test
if ($LASTEXITCODE -ne 0) { throw "npm test failed; refusing to package an unverified installer." }
$Resources = Join-Path $Root "dist\.electron-builder-resources"
$PortableOutput = Join-Path $Resources "portable"
$RootPackagePath = Join-Path $Root "package.json"
$Package = Get-Content -LiteralPath $RootPackagePath -Raw -Encoding UTF8 | ConvertFrom-Json
$PortableStage = Join-Path $PortableOutput "Elitesand-Pro-v$($Package.version)-portable"
$AppStage = Join-Path $Resources "app"
$DefaultInstallerOutput = Join-Path $Root "dist\releases\v$($Package.version)\installer"
$InstallerOutput = if ([string]::IsNullOrWhiteSpace($OutputRoot)) { $DefaultInstallerOutput } else { [System.IO.Path]::GetFullPath($OutputRoot) }
$InstallerLicense = Join-Path $Resources "EULA-installer.txt"

Assert-Inside -Path $Resources -Parent $Root
Assert-Inside -Path $PortableOutput -Parent $Root
Assert-Inside -Path $PortableStage -Parent $Root
Assert-Inside -Path $AppStage -Parent $Root
Assert-Inside -Path $InstallerOutput -Parent $Root

if (Test-Path -LiteralPath $Resources) {
  Remove-Item -LiteralPath $Resources -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $Resources | Out-Null

function Test-InstallerBootOutsideRepo {
  param([Parameter(Mandatory = $true)][string]$UnpackedResources)

  $bootRoot = Join-Path $env:TEMP ("elitesand-installer-boot-" + [System.IO.Path]::GetRandomFileName())
  $bootUserData = Join-Path $bootRoot "user-data"
  $bootStdout = Join-Path $bootRoot "electron.stdout.log"
  $bootStderr = Join-Path $bootRoot "electron.stderr.log"
  $unpackedRoot = Split-Path -Parent $UnpackedResources
  $appExe = Join-Path $unpackedRoot "Elitesand Pro.exe"
  $port = 39000 + (Get-Random -Maximum 1000)
  $serverProcess = $null
  try {
    if (-not (Test-Path -LiteralPath $appExe)) { throw "Installer boot check cannot find $appExe" }
    Write-Host "Installer boot check: launching the packaged Electron app outside the repo ($bootRoot)..."
    New-Item -ItemType Directory -Force -Path $bootRoot, $bootUserData | Out-Null
    $env:PORT = "$port"
    $env:ELITESAND_SHELL_HEADLESS = "1"
    $env:ELITESAND_SHELL_PORT = "$port"
    $env:ELITESAND_SHELL_USER_DATA_DIR = $bootUserData
    $env:ELITESAND_SHELL_QUIT_AFTER_READY_MS = "0"
    $serverProcess = Start-Process -FilePath $appExe -ArgumentList @("--user-data-dir=$bootUserData") -PassThru -WindowStyle Hidden -RedirectStandardOutput $bootStdout -RedirectStandardError $bootStderr

    $healthy = $false
    for ($i = 0; $i -lt 60; $i++) {
      if ($serverProcess.HasExited) { break }
      try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) { $healthy = $true; break }
      } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $healthy) {
      $exitDetail = if ($serverProcess.HasExited) { " Electron exit code: $($serverProcess.ExitCode)." } else { "" }
      $lineBreak = [Environment]::NewLine
      $diagnostic = @($bootStdout, $bootStderr) | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object {
        $content = Get-Content -LiteralPath $_ -Tail 80 -ErrorAction SilentlyContinue
        if ($content) { "$lineBreak--- $(Split-Path -Leaf $_) ---$lineBreak$($content -join $lineBreak)" }
      }
      throw "Installer boot check failed: packaged Electron app never became healthy on port $port.$exitDetail$($diagnostic -join '')"
    }
    Write-Host "Installer boot check passed: integrity-protected Electron app serves /api/health outside the repo."
  } finally {
    if ($serverProcess -and -not $serverProcess.HasExited) {
      try { Stop-Process -Id $serverProcess.Id -Force -Confirm:$false } catch {}
    }
    Remove-Item Env:PORT, Env:ELITESAND_SHELL_HEADLESS, Env:ELITESAND_SHELL_PORT, Env:ELITESAND_SHELL_USER_DATA_DIR, Env:ELITESAND_SHELL_QUIT_AFTER_READY_MS -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $bootRoot) {
      try { Remove-Item -LiteralPath $bootRoot -Recurse -Force } catch {}
    }
  }
}

try {
  $EulaText = [System.IO.File]::ReadAllText((Join-Path $Root "EULA.txt"), [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText($InstallerLicense, $EulaText, [System.Text.UTF8Encoding]::new($true))
  $InstallerLicenseBytes = [System.IO.File]::ReadAllBytes($InstallerLicense)
  if ($InstallerLicenseBytes.Length -lt 3 -or $InstallerLicenseBytes[0] -ne 0xEF -or $InstallerLicenseBytes[1] -ne 0xBB -or $InstallerLicenseBytes[2] -ne 0xBF) {
    throw "NSIS installer EULA must be UTF-8 with a BOM."
  }
  if ([System.IO.File]::ReadAllText($InstallerLicense, [System.Text.UTF8Encoding]::new($true)) -cne $EulaText) {
    throw "NSIS installer EULA diverged from the approved EULA.txt."
  }

  & (Join-Path $PSScriptRoot "build-portable.ps1") -OutputRoot $PortableOutput -NoZip
  if ($LASTEXITCODE -ne 0) { throw "Portable staging failed; installer build stopped." }

  foreach ($name in @("app", "tools", "licenses")) {
    $source = Join-Path $PortableStage $name
    if (-not (Test-Path -LiteralPath $source)) { throw "Portable staging is missing $name" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $Resources $(if ($name -eq "app") { "app" } else { $name })) -Recurse -Force
  }

  # A dedicated Node runtime executes updater-v2 outside the Electron process.
  # It is integrity-protected as a resources/tools file and remains immutable
  # across incremental updates; changing it forces the next full Installer.
  $UpdaterNodeSource = Join-Path $PortableStage "runtime\node.exe"
  $UpdaterNodeTarget = Join-Path $Resources "tools\updater-node.exe"
  if (-not (Test-Path -LiteralPath $UpdaterNodeSource)) {
    throw "Portable staging is missing runtime\node.exe; secure updater runtime cannot be created."
  }
  Copy-Item -LiteralPath $UpdaterNodeSource -Destination $UpdaterNodeTarget -Force

  foreach ($name in @("electron", "assets")) {
    $source = Join-Path $Root $name
    if (-not (Test-Path -LiteralPath $source)) { throw "Missing required Electron application directory: $source" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $AppStage $name) -Recurse -Force
  }

  if (-not (Test-Path -LiteralPath (Join-Path $AppStage "node_modules\express\package.json"))) {
    throw "Staged app is missing node_modules\express; refusing to build a broken installer."
  }

  $AppRoot = $AppStage
  foreach ($name in @("data", "downloads", "logs")) {
    $runtimeDir = Join-Path $AppRoot $name
    if (Test-Path -LiteralPath $runtimeDir) { Remove-Item -LiteralPath $runtimeDir -Recurse -Force }
    if (Test-Path -LiteralPath $runtimeDir) { throw "Installer app still contains $name" }
  }

  $OriginalRootPackageBytes = [System.IO.File]::ReadAllBytes($RootPackagePath)
  $BuilderMetadataWritten = $false
  $BuilderVersion = [string]$Package.version
  if ($BuilderVersion -match '^(\d+)\.(\d+)\.(\d+)\.(\d+)$') {
    $BuilderVersion = "$($Matches[1]).$($Matches[2]).$($Matches[3])+$($Matches[4])"
  }
  $BuilderOutputRelative = Get-RelativeWorkspacePath -Path $InstallerOutput -Parent $Root
  if ($BuilderOutputRelative -eq '..' -or $BuilderOutputRelative.StartsWith('../')) {
    throw "Installer output must stay inside the workspace."
  }
  if ($BuilderVersion -ne [string]$Package.version -or -not [string]::IsNullOrWhiteSpace($OutputRoot)) {
    $BuilderPackage = Get-Content -LiteralPath $RootPackagePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $BuilderPackage.version = $BuilderVersion
    if ($null -eq $BuilderPackage.build -or $null -eq $BuilderPackage.build.directories) {
      throw "package.json is missing build.directories; cannot prepare installer metadata."
    }
    $BuilderPackage.build.directories.output = $BuilderOutputRelative
    $ArtifactName = "Elitesand Pro Setup $($Package.version).`${ext}"
    if ($BuilderPackage.build.PSObject.Properties.Name -contains 'artifactName') {
      $BuilderPackage.build.artifactName = $ArtifactName
    } else {
      $BuilderPackage.build | Add-Member -NotePropertyName artifactName -NotePropertyValue $ArtifactName
    }
    if ($BuilderPackage.build.PSObject.Properties.Name -contains 'buildVersion') {
      $BuilderPackage.build.buildVersion = [string]$Package.version
    } else {
      $BuilderPackage.build | Add-Member -NotePropertyName buildVersion -NotePropertyValue ([string]$Package.version)
    }
    [System.IO.File]::WriteAllText(
      $RootPackagePath,
      ($BuilderPackage | ConvertTo-Json -Depth 20),
      [System.Text.UTF8Encoding]::new($false)
    )
    $BuilderMetadataWritten = $true
    Write-Host "Installer metadata version: $BuilderVersion (public version remains $($Package.version))"
  }

  $StagedAppPackagePath = Join-Path $AppStage "package.json"
  $StagedAppPackage = Get-Content -LiteralPath $StagedAppPackagePath -Raw -Encoding UTF8 | ConvertFrom-Json
  $StagedAppPackage.version = $BuilderVersion
  if ($StagedAppPackage.PSObject.Properties.Name -contains 'build') {
    [void]$StagedAppPackage.PSObject.Properties.Remove('build')
  }
  if ($StagedAppPackage.PSObject.Properties.Name -contains 'elitesandPublicVersion') {
    $StagedAppPackage.elitesandPublicVersion = [string]$Package.version
  } else {
    $StagedAppPackage | Add-Member -NotePropertyName elitesandPublicVersion -NotePropertyValue ([string]$Package.version)
  }
  [System.IO.File]::WriteAllText($StagedAppPackagePath, ($StagedAppPackage | ConvertTo-Json -Depth 20), [System.Text.UTF8Encoding]::new($false))

  $NodeCommand = Get-Command node -ErrorAction Stop
  $SourceMapOut = Join-Path $Root "dist\.source-maps\v$($Package.version)"
  & $NodeCommand.Source (Join-Path $Root "tools\build-production-bundles.js") $AppStage --electron-only --sourcemap-out $SourceMapOut
  if ($LASTEXITCODE -ne 0) { throw "Electron shell minification failed; Installer build stopped." }
  & $NodeCommand.Source (Join-Path $Root "tools\write-packaged-resource-integrity.js") $AppStage (Join-Path $Resources "tools")
  if ($LASTEXITCODE -ne 0) { throw "Packaged external-resource integrity manifest generation failed." }

  Push-Location $Root
  try {
    & (Join-Path $Root "node_modules\.bin\electron-builder.cmd") --win nsis
    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed." }
  } finally {
    Pop-Location
    if ($BuilderMetadataWritten) {
      [System.IO.File]::WriteAllBytes($RootPackagePath, $OriginalRootPackageBytes)
    }
  }

  $UnpackedRoot = Join-Path $InstallerOutput "win-unpacked"
  $UnpackedResources = Join-Path $InstallerOutput "win-unpacked\resources"
  foreach ($required in @("app.asar", "tools\yt-dlp.exe", "tools\updater-node.exe")) {
    if (-not (Test-Path -LiteralPath (Join-Path $UnpackedResources $required))) {
      throw "Installer output is missing $required; the built installer would be broken on user machines."
    }
  }
  if (Test-Path -LiteralPath (Join-Path $UnpackedResources "app")) {
    throw "Installer output still contains raw resources\app; refusing a bypassable ASAR build."
  }
  & $NodeCommand.Source (Join-Path $Root "tools\verify-electron-package.js") $UnpackedRoot
  if ($LASTEXITCODE -ne 0) { throw "Secure Electron package verification failed." }

  $InstallerPath = Join-Path $InstallerOutput "Elitesand Pro Setup $($Package.version).exe"
  $InstallerHashPath = "$InstallerPath.sha256"
  if (-not (Test-Path -LiteralPath $InstallerPath) -or (Get-Item -LiteralPath $InstallerPath).Length -eq 0) {
    throw "Installer output is missing or empty: $InstallerPath"
  }
  $InstallerHash = Get-Sha256Hex -LiteralPath $InstallerPath
  [System.IO.File]::WriteAllText($InstallerHashPath, $InstallerHash, [System.Text.Encoding]::ASCII)
  if ((Get-Content -LiteralPath $InstallerHashPath -Raw -Encoding ASCII) -notmatch '^[a-f0-9]{64}$') {
    throw "Installer SHA-256 file is not exactly 64 hexadecimal characters."
  }

  Test-InstallerBootOutsideRepo -UnpackedResources $UnpackedResources

  # Persist a small hash-only description of the immutable Electron runtime.
  # The next release can build update.zip from this file without retaining the
  # entire previous win-unpacked directory, and clients can verify their local
  # runtime against it before updater-v2 replaces EXE/app.asar.
  $IncrementalBaselinePath = Join-Path $InstallerOutput "incremental-baseline.json"
  & $NodeCommand.Source (Join-Path $Root "tools\write-update-baseline.js") $UnpackedRoot $IncrementalBaselinePath
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $IncrementalBaselinePath)) {
    throw "Incremental runtime baseline generation failed."
  }

  Write-Host "Installer build complete: $InstallerOutput"
  Write-Host "Incremental baseline: $IncrementalBaselinePath"
} finally {
  if (Test-Path -LiteralPath $Resources) { Remove-Item -LiteralPath $Resources -Recurse -Force }
}
