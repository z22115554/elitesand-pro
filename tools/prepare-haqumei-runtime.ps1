param(
  [Parameter(Mandatory = $true)][string]$OutputRoot,
  [Parameter(Mandatory = $true)][string]$LicenseOutput
)

$ErrorActionPreference = "Stop"

# The Japanese xieyin v2 sidecar is intentionally self-contained.  Haqumei's
# Windows wheel embeds its dictionary and has no third-party Python imports, so
# a Python embeddable distribution plus this one wheel is enough at runtime.
$PythonVersion = "3.11.9"
$PythonUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
$PythonSha256 = "009d6bf7e3b2ddca3d784fa09f90fe54336d5b60f0e0f305c37f400bf83cfd3b"
$HaqumeiVersion = "0.12.0"
$HaqumeiUrl = "https://files.pythonhosted.org/packages/41/1d/2f5f57279f2c0215dfc033797ab0845a708466b3d8de639baea6970b3b57/haqumei-0.12.0-cp39-abi3-win_amd64.whl"
$HaqumeiSha256 = "a63f7ca89dbbc246cd5c83468578967ce9fe87dcd511c139499835403bc3e5b9"

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
  $resolvedParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )
  $prefix = $resolvedParent + [System.IO.Path]::DirectorySeparatorChar
  if ($resolvedPath -ne $resolvedParent -and
      -not $resolvedPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside workspace: $resolvedPath"
  }
}

function Download-Asset {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$OutFile
  )

  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl -and (Test-Path -LiteralPath $curl.Source)) {
    & $curl.Source --fail --location --silent --show-error --output $OutFile $Uri
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $Uri" }
  } else {
    Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile
  }
  if (-not (Test-Path -LiteralPath $OutFile) -or (Get-Item -LiteralPath $OutFile).Length -eq 0) {
    throw "Download produced an empty file: $Uri"
  }
}

function Ensure-Asset {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$LiteralPath,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256
  )

  if (Test-Path -LiteralPath $LiteralPath) {
    if ((Get-Sha256Hex -LiteralPath $LiteralPath) -eq $ExpectedSha256) { return }
    Remove-Item -LiteralPath $LiteralPath -Force
  }

  $partial = "$LiteralPath.download"
  if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
  Download-Asset -Uri $Uri -OutFile $partial
  $actual = Get-Sha256Hex -LiteralPath $partial
  if ($actual -ne $ExpectedSha256) {
    Remove-Item -LiteralPath $partial -Force
    throw "SHA-256 mismatch for $Uri (expected $ExpectedSha256, got $actual)."
  }
  Move-Item -LiteralPath $partial -Destination $LiteralPath -Force
}

$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
$LicenseOutput = [System.IO.Path]::GetFullPath($LicenseOutput)
Assert-Inside -Path $OutputRoot -Parent $Root
Assert-Inside -Path $LicenseOutput -Parent $Root

$CacheRoot = Join-Path $Root "dist\.haqumei-cache"
$PythonArchive = Join-Path $CacheRoot "python-$PythonVersion-embed-amd64.zip"
$WheelArchive = Join-Path $CacheRoot "haqumei-$HaqumeiVersion-cp39-abi3-win_amd64.zip"
$BuildRoot = Join-Path $CacheRoot ("build-" + [System.IO.Path]::GetRandomFileName())
$PythonStage = Join-Path $BuildRoot "python"
$WheelStage = Join-Path $BuildRoot "wheel"

New-Item -ItemType Directory -Force -Path $CacheRoot, $BuildRoot | Out-Null
try {
  Ensure-Asset -Uri $PythonUrl -LiteralPath $PythonArchive -ExpectedSha256 $PythonSha256
  Ensure-Asset -Uri $HaqumeiUrl -LiteralPath $WheelArchive -ExpectedSha256 $HaqumeiSha256

  New-Item -ItemType Directory -Force -Path $PythonStage, $WheelStage | Out-Null
  Expand-Archive -LiteralPath $PythonArchive -DestinationPath $PythonStage
  Expand-Archive -LiteralPath $WheelArchive -DestinationPath $WheelStage

  $pthFiles = @(Get-ChildItem -LiteralPath $PythonStage -File -Filter "python3??._pth")
  if ($pthFiles.Count -ne 1) {
    throw "Expected one Python embeddable _pth file, found $($pthFiles.Count)."
  }
  $pthPath = $pthFiles[0].FullName
  $pthLines = [System.IO.File]::ReadAllText($pthPath) -split "\r?\n"
  if (-not ($pthLines -contains "Lib\site-packages")) {
    $pthLines = @($pthLines | Where-Object { $_ -ne "" }) + "Lib\site-packages"
    [System.IO.File]::WriteAllText(
      $pthPath,
      (($pthLines -join "`r`n") + "`r`n"),
      [System.Text.Encoding]::ASCII
    )
  }

  $sitePackages = Join-Path $PythonStage "Lib\site-packages"
  New-Item -ItemType Directory -Force -Path $sitePackages | Out-Null
  Get-ChildItem -LiteralPath $WheelStage -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $sitePackages -Recurse -Force
  }

  $pythonExe = Join-Path $PythonStage "python.exe"
  $haqumeiPyd = Join-Path $sitePackages "haqumei\haqumei.pyd"
  $haqumeiMetadata = Join-Path $sitePackages "haqumei-$HaqumeiVersion.dist-info\METADATA"
  foreach ($required in @($pythonExe, $haqumeiPyd, $haqumeiMetadata)) {
    if (-not (Test-Path -LiteralPath $required)) {
      throw "Haqumei runtime staging is missing required file: $required"
    }
  }

  & $pythonExe -c "from haqumei import Haqumei; from importlib.metadata import version; h=Haqumei(); assert version('haqumei') == '$HaqumeiVersion'; kana=h.g2k('今日は晴れです'); prosody=h.g2p_prosody('がっこう'); assert kana and prosody; print('haqumei-runtime-probe-ok')"
  if ($LASTEXITCODE -ne 0) { throw "Bundled Haqumei runtime probe failed." }

  # The probe imports the native extension and may leave bytecode caches behind.
  # Keep the staged runtime deterministic and ship only the embeddable runtime
  # plus the wheel's actual package files.
  Get-ChildItem -LiteralPath $PythonStage -Directory -Recurse -Filter "__pycache__" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

  if (Test-Path -LiteralPath $OutputRoot) { Remove-Item -LiteralPath $OutputRoot -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
  Get-ChildItem -LiteralPath $PythonStage -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $OutputRoot -Recurse -Force
  }

  if (Test-Path -LiteralPath $LicenseOutput) { Remove-Item -LiteralPath $LicenseOutput -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $LicenseOutput | Out-Null
  $wheelLicenses = Join-Path $sitePackages "haqumei-$HaqumeiVersion.dist-info\licenses"
  if (-not (Test-Path -LiteralPath $wheelLicenses)) {
    throw "Haqumei wheel license directory is missing: $wheelLicenses"
  }
  Get-ChildItem -LiteralPath $wheelLicenses -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $LicenseOutput -Recurse -Force
  }

  $provenance = @"
Haqumei bundled runtime
=======================

Haqumei version: $HaqumeiVersion
Haqumei wheel: $HaqumeiUrl
Haqumei wheel SHA-256: $HaqumeiSha256
Python embeddable version: $PythonVersion
Python embeddable archive: $PythonUrl
Python embeddable SHA-256: $PythonSha256

The wheel embeds the Japanese dictionary and is installed into the adjacent
Python embeddable runtime under Lib/site-packages. License and NOTICE files
from the wheel are included in this directory.
"@
  Set-Content -LiteralPath (Join-Path $LicenseOutput "PROVENANCE.txt") -Value $provenance -Encoding UTF8
  Write-Host "Bundled Haqumei $HaqumeiVersion with Python $PythonVersion."
} finally {
  if (Test-Path -LiteralPath $BuildRoot) { Remove-Item -LiteralPath $BuildRoot -Recurse -Force }
}
