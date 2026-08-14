param(
  [string]$OutputRoot = "",
  [string]$BaselineManifest = "",
  [string]$BaselineRoot = "",
  [string]$SigningKeyPath = "",
  [switch]$SkipBaselineCheck
)

$ErrorActionPreference = "Stop"

# Legacy schema-v1 regression anchor only. v2 never stages EULA.txt as a loose
# root file because EULA now lives inside the integrity-protected app.asar.
# if ($BaselineAcceptsEula) {
#   Copy-Item -LiteralPath (Join-Path $Root "EULA.txt") -Destination $Stage -Force
# }

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

function Remove-TreeWithRetry {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [switch]$BestEffort
  )
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $lastError = $null
  for ($attempt = 1; $attempt -le 12; $attempt++) {
    try {
      Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
      if (-not (Test-Path -LiteralPath $Path)) { return }
    } catch {
      $lastError = $_
    }
    Start-Sleep -Milliseconds 250
  }
  if ($BestEffort) {
    Write-Warning "Unable to fully clean temporary build directory after retries: $Path ($($lastError.Exception.Message))"
    return
  }
  throw "Unable to clean build directory after retries: $Path ($($lastError.Exception.Message))"
}

function Get-RelativePath {
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

function Test-UpdateOwnedPath {
  param([Parameter(Mandatory = $true)][string]$RelativePath)
  $rel = $RelativePath.Replace('\', '/')
  if ($rel -eq 'resources/tools/updater-node.exe') { return $false }
  if ($rel -eq 'Elitesand Pro.exe') { return $true }
  if ($rel -eq 'resources/app.asar') { return $true }
  if ($rel.StartsWith('resources/tools/', [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
  if ($rel.StartsWith('resources/licenses/', [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
  return $false
}

function Read-BaselineManifest {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Incremental baseline manifest not found: $Path" }
  $baseline = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($baseline.schemaVersion -ne 1 -or $baseline.mode -ne 'electron-asar-v1') {
    throw "Incremental baseline manifest schema/mode is unsupported."
  }
  if ([string]::IsNullOrWhiteSpace([string]$baseline.version)) { throw "Incremental baseline manifest has no version." }
  if ([string]$baseline.immutableFingerprint -notmatch '^[a-f0-9]{64}$') { throw "Incremental baseline fingerprint is invalid." }
  if ($null -eq $baseline.immutableFiles -or $baseline.immutableFiles.Count -eq 0) { throw "Incremental baseline contains no immutable runtime files." }
  $updater = $baseline.immutableFiles | Where-Object { $_.path -eq 'resources/tools/updater-node.exe' } | Select-Object -First 1
  if ($null -eq $updater) { throw "Incremental baseline does not protect resources/tools/updater-node.exe." }
  foreach ($item in $baseline.immutableFiles) {
    if ([string]::IsNullOrWhiteSpace([string]$item.path) -or [string]$item.path -match '(^/|\\|(^|/)\.\.(/|$))') {
      throw "Incremental baseline contains an unsafe path: $($item.path)"
    }
    if ([string]$item.sha256 -notmatch '^[a-f0-9]{64}$' -or [int64]$item.size -lt 0) {
      throw "Incremental baseline contains invalid metadata: $($item.path)"
    }
    if (Test-UpdateOwnedPath -RelativePath ([string]$item.path)) {
      throw "Incremental baseline incorrectly marks an update-owned file immutable: $($item.path)"
    }
  }
  return $baseline
}

$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$Package = Get-Content -LiteralPath (Join-Path $Root "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$Version = [string]$Package.version
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  $OutputRoot = Join-Path $Root "dist\releases\v$Version\update"
}
$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
$BuildRoot = Join-Path $Root "dist\.incremental-build\v$Version"
$Stage = Join-Path $OutputRoot ".update-stage"
$ZipPath = Join-Path $OutputRoot "update.zip"
$HashPath = Join-Path $OutputRoot "update.zip.sha256"
$GeneratedBaselineManifest = Join-Path $OutputRoot ".baseline-from-root.json"
$DefaultSigningKeyPath = Join-Path $Root ".local\update-signing\private-key.pem"
$TestSigningKeyPath = Join-Path $Root "tests\fixtures\update-signing-test-private.pem"
$HasSigningSecret = -not [string]::IsNullOrWhiteSpace([string]$env:ELITESAND_UPDATE_SIGNING_PRIVATE_KEY_B64)

if ([string]::IsNullOrWhiteSpace($SigningKeyPath)) {
  if ($HasSigningSecret) {
    $SigningKeyPath = ""
  } elseif ($SkipBaselineCheck) {
    $SigningKeyPath = $TestSigningKeyPath
  } else {
    $SigningKeyPath = $DefaultSigningKeyPath
  }
}
if (-not [string]::IsNullOrWhiteSpace($SigningKeyPath)) {
  $SigningKeyPath = [System.IO.Path]::GetFullPath($SigningKeyPath)
  if (-not (Test-Path -LiteralPath $SigningKeyPath -PathType Leaf)) {
    throw "Update signing private key not found: $SigningKeyPath. Put the official key at .local\update-signing\private-key.pem, pass -SigningKeyPath, or set ELITESAND_UPDATE_SIGNING_PRIVATE_KEY_B64."
  }
  if (-not $SkipBaselineCheck -and $SigningKeyPath -eq [System.IO.Path]::GetFullPath($TestSigningKeyPath)) {
    throw "Refusing to publish with the repository test signing key. Use the official private key."
  }
} elseif (-not $HasSigningSecret) {
  throw "Secure incremental updates require an Ed25519 signing private key."
}

foreach ($target in @($OutputRoot, $BuildRoot, $Stage, $ZipPath, $HashPath, $GeneratedBaselineManifest)) {
  Assert-Inside -Path $target -Parent $Root
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
foreach ($target in @($Stage, $ZipPath, $HashPath, $GeneratedBaselineManifest)) {
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}
Remove-TreeWithRetry -Path $BuildRoot

$Baseline = $null
if (-not $SkipBaselineCheck) {
  if ([string]::IsNullOrWhiteSpace($BaselineManifest)) {
    if ([string]::IsNullOrWhiteSpace($BaselineRoot)) {
      throw "Secure Electron updates require -BaselineManifest from the previous Installer build (preferred), or -BaselineRoot pointing to its win-unpacked root."
    }
    $BaselineRoot = [System.IO.Path]::GetFullPath($BaselineRoot)
    foreach ($required in @('Elitesand Pro.exe', 'resources\app.asar', 'resources\tools\updater-node.exe')) {
      if (-not (Test-Path -LiteralPath (Join-Path $BaselineRoot $required))) {
        throw "Baseline is not update-v2 capable (missing $required). Publish a full Installer for this upgrade."
      }
    }
    & node (Join-Path $Root "tools\write-update-baseline.js") $BaselineRoot $GeneratedBaselineManifest
    if ($LASTEXITCODE -ne 0) { throw "Unable to derive incremental baseline from -BaselineRoot." }
    $BaselineManifest = $GeneratedBaselineManifest
  }
  $BaselineManifest = [System.IO.Path]::GetFullPath($BaselineManifest)
  $Baseline = Read-BaselineManifest -Path $BaselineManifest
  if ([string]$Baseline.version -eq $Version) { throw "Baseline version equals target version ($Version); refusing a no-op update." }
}

# Build through the exact Installer production chain. This produces the same
# minified/encrypted app.asar, matching EXE integrity resource and verified
# Electron fuses as the full Installer release.
& (Join-Path $PSScriptRoot "build-installer.ps1") -OutputRoot $BuildRoot
if ($LASTEXITCODE -ne 0) { throw "Secure Installer staging failed; update.zip was not created." }

$NewRoot = Join-Path $BuildRoot "win-unpacked"
$NewBaselinePath = Join-Path $BuildRoot "incremental-baseline.json"
foreach ($required in @('Elitesand Pro.exe', 'resources\app.asar', 'resources\tools\updater-node.exe', 'incremental-baseline.json')) {
  if (-not (Test-Path -LiteralPath (Join-Path $BuildRoot $required)) -and $required -eq 'incremental-baseline.json') {
    throw "Secure build output is missing incremental-baseline.json"
  }
  if ($required -ne 'incremental-baseline.json' -and -not (Test-Path -LiteralPath (Join-Path $NewRoot $required))) {
    throw "Secure build output is missing $required"
  }
}
if (Test-Path -LiteralPath (Join-Path $NewRoot 'resources\app')) {
  throw "Secure build unexpectedly contains raw resources\app; refusing incremental package."
}
if (Test-Path -LiteralPath (Join-Path $NewRoot 'resources\app.asar.unpacked')) {
  $unpackedEntries = Get-ChildItem -LiteralPath (Join-Path $NewRoot 'resources\app.asar.unpacked') -Force -Recurse -ErrorAction SilentlyContinue
  if ($unpackedEntries) { throw "Secure build contains app.asar.unpacked application files; refusing incremental package." }
}

$NewBaseline = Read-BaselineManifest -Path $NewBaselinePath
# Even local smoke packages carry a complete, self-consistent immutable runtime
# baseline so the production updater-v2 parser can validate them end-to-end.
# fromVersion 0.0.0 makes the artifact impossible for a real release client to
# apply accidentally; -SkipBaselineCheck remains strictly non-publishable.
$FromVersion = '0.0.0'
$BaselineFingerprint = [string]$NewBaseline.immutableFingerprint
$BaselineImmutableFiles = @($NewBaseline.immutableFiles)
if (-not $SkipBaselineCheck) {
  $FromVersion = [string]$Baseline.version
  $BaselineFingerprint = [string]$Baseline.immutableFingerprint
  $BaselineImmutableFiles = @($Baseline.immutableFiles)
  if ($BaselineFingerprint -ne [string]$NewBaseline.immutableFingerprint) {
    throw "Electron/updater runtime outside the update-owned payload changed. Do not publish update.zip; publish the full Installer."
  }
} else {
  Write-Warning "Skipping baseline compatibility check. This package is structurally valid for local updater-v2 tests only and must not be published."
}

New-Item -ItemType Directory -Force -Path $Stage | Out-Null
$PayloadRelativePaths = @('Elitesand Pro.exe', 'resources/app.asar')
foreach ($dirRel in @('resources/tools', 'resources/licenses')) {
  $dir = Join-Path $NewRoot $dirRel.Replace('/', '\')
  if (Test-Path -LiteralPath $dir) {
    Get-ChildItem -LiteralPath $dir -File -Recurse | ForEach-Object {
      $rel = Get-RelativePath -Path $_.FullName -Parent $NewRoot
      if ($rel -ne 'resources/tools/updater-node.exe') { $PayloadRelativePaths += $rel }
    }
  }
}
$PayloadRelativePaths = @($PayloadRelativePaths | Sort-Object -Unique)

$ManifestFiles = @()
foreach ($rel in $PayloadRelativePaths) {
  if (-not (Test-UpdateOwnedPath -RelativePath $rel)) {
    throw "Internal error: payload path escaped update-owned allowlist: $rel"
  }
  if ($rel -match '(?i)(^|/)lyric-template-[^/]+\.js$' -or $rel -match '(?i)\.map$') {
    throw "Raw template/source-map material is forbidden in update.zip: $rel"
  }
  $source = Join-Path $NewRoot $rel.Replace('/', '\')
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing payload file: $rel" }
  $destination = Join-Path $Stage $rel.Replace('/', '\')
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Force
  $item = Get-Item -LiteralPath $destination
  $ManifestFiles += [ordered]@{
    path = $rel
    size = [int64]$item.Length
    sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$Manifest = [ordered]@{
  schemaVersion = 2
  mode = 'electron-asar-v1'
  fromVersion = $FromVersion
  version = $Version
  builtAt = (Get-Date).ToString('o')
  baselineRuntimeFingerprint = $BaselineFingerprint
  baselineImmutableFiles = @($BaselineImmutableFiles)
  files = @($ManifestFiles)
}
$ManifestPath = Join-Path $Stage 'update-manifest.json'
[System.IO.File]::WriteAllText(
  $ManifestPath,
  ($Manifest | ConvertTo-Json -Depth 10),
  [System.Text.UTF8Encoding]::new($false)
)

$SignScript = Join-Path $Root "tools\update-signing\sign-manifest.js"
$SignArgs = @($SignScript, $ManifestPath)
if (-not [string]::IsNullOrWhiteSpace($SigningKeyPath)) {
  $SignArgs += @('--private-key', $SigningKeyPath)
}
if ($SkipBaselineCheck) {
  $SignArgs += '--allow-nonproduction-key'
}
& node @SignArgs
if ($LASTEXITCODE -ne 0) { throw "Ed25519 update manifest signing failed; update.zip was not created." }
$SignedManifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($SignedManifest.signatureAlgorithm -ne 'Ed25519' -or [string]$SignedManifest.signature -notmatch '^[a-f0-9]{128}$') {
  throw "Signed update manifest is missing a valid Ed25519 signature."
}

# Final leakage guard: update.zip contains no raw server/public source, no
# source maps, no named lyric-template JS, and never the updater runtime itself.
Get-ChildItem -LiteralPath $Stage -File -Recurse | ForEach-Object {
  $rel = Get-RelativePath -Path $_.FullName -Parent $Stage
  if ($rel -eq 'update-manifest.json') { return }
  if (-not (Test-UpdateOwnedPath -RelativePath $rel)) { throw "Forbidden update payload entry: $rel" }
  if ($rel -match '(?i)\.map$' -or $rel -match '(?i)lyric-template-[^/]+\.js$') {
    throw "Closed-source leakage guard rejected: $rel"
  }
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Archive = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($File in Get-ChildItem -LiteralPath $Stage -File -Recurse) {
    $EntryName = Get-RelativePath -Path $File.FullName -Parent $Stage
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $Archive,
      $File.FullName,
      $EntryName,
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
} finally {
  $Archive.Dispose()
}

$Hash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText($HashPath, $Hash, [System.Text.Encoding]::ASCII)
if ((Get-Content -LiteralPath $HashPath -Raw -Encoding ASCII) -notmatch '^[a-f0-9]{64}$') {
  throw "Generated SHA-256 file is not exactly 64 hexadecimal characters."
}

Remove-Item -LiteralPath $Stage -Recurse -Force
Remove-TreeWithRetry -Path $BuildRoot -BestEffort
if (Test-Path -LiteralPath $GeneratedBaselineManifest) { Remove-Item -LiteralPath $GeneratedBaselineManifest -Force }

Write-Host "Secure Electron incremental update package ready:"
Write-Host "  from : $FromVersion"
Write-Host "  to   : $Version"
Write-Host "  zip  : $ZipPath"
Write-Host "  sha  : $HashPath"
Write-Host "  sign : Ed25519 / update-ed25519-2026-08-14-01"
