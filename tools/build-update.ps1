param(
  [string]$OutputRoot = "",
  [string]$BaselineRoot = "",
  [switch]$SkipBaselineCheck
)

$ErrorActionPreference = "Stop"

function Assert-Inside {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Parent
  )
  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  $resolvedParent = [System.IO.Path]::GetFullPath($Parent)
  $parentPrefix = $resolvedParent.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if ($resolvedPath -ne $resolvedParent -and -not $resolvedPath.StartsWith($parentPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside workspace: $resolvedPath"
  }
}

$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$Package = Get-Content -LiteralPath (Join-Path $Root "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$Version = $Package.version
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  # `update.zip` must retain its exact filename for the in-app updater, but
  # each release gets its own parent directory so versions cannot overwrite it.
  $OutputRoot = Join-Path $Root "dist\releases\v$Version\update"
}
$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
$Stage = Join-Path $OutputRoot ".update-stage"
$ZipPath = Join-Path $OutputRoot "update.zip"
$HashPath = Join-Path $OutputRoot "update.zip.sha256"

Assert-Inside -Path $OutputRoot -Parent $Root
Assert-Inside -Path $Stage -Parent $Root
Assert-Inside -Path $ZipPath -Parent $Root
Assert-Inside -Path $HashPath -Parent $Root

if (-not $SkipBaselineCheck) {
  if ([string]::IsNullOrWhiteSpace($BaselineRoot)) {
    throw "Safe update packages require -BaselineRoot pointing to the previous portable app folder. Use -SkipBaselineCheck only for local tests."
  }
  $BaselineRoot = [System.IO.Path]::GetFullPath($BaselineRoot)
  foreach ($name in @("package.json", "package-lock.json")) {
    if (-not (Test-Path -LiteralPath (Join-Path $BaselineRoot $name))) { throw "Baseline is missing $name" }
  }
  $CompareScript = @'
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
function stable(v) { if (Array.isArray(v)) return v.map(stable); if (!v || typeof v !== 'object') return v; return Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])); }
function hash(v) { return crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex'); }
function deps(p) { return hash({ dependencies:p.dependencies||{}, optionalDependencies:p.optionalDependencies||{}, bundledDependencies:p.bundledDependencies||[] }); }
function lock(l) { const packages=l.packages ? Object.fromEntries(Object.entries(l.packages).map(([n,m])=>[n,{version:n?(m.version||null):null,dependencies:m.dependencies||{},optionalDependencies:m.optionalDependencies||{},peerDependencies:m.peerDependencies||{},optional:m.optional===true}])) : {dependencies:l.dependencies||{}}; return hash({lockfileVersion:l.lockfileVersion||null,packages}); }
const [oldRoot,newRoot]=process.argv.slice(1); const read=(r,n)=>JSON.parse(fs.readFileSync(path.join(r,n),'utf8'));
if (deps(read(oldRoot,'package.json'))!==deps(read(newRoot,'package.json')) || lock(read(oldRoot,'package-lock.json'))!==lock(read(newRoot,'package-lock.json'))) process.exit(3);
'@
  & node -e $CompareScript $BaselineRoot $Root
  if ($LASTEXITCODE -eq 3) { throw "Dependencies or lockfile structure changed. Do not publish update.zip; publish the full Portable package only." }
  if ($LASTEXITCODE -ne 0) { throw "Unable to compare dependency structure with baseline." }
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
foreach ($target in @($Stage, $ZipPath, $HashPath)) {
  Assert-Inside -Path $target -Parent $OutputRoot
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

foreach ($dir in @("server", "public")) {
  Copy-Item -LiteralPath (Join-Path $Root $dir) -Destination $Stage -Recurse -Force
}
foreach ($file in @("package.json", "package-lock.json")) {
  Copy-Item -LiteralPath (Join-Path $Root $file) -Destination $Stage -Force
}

$LocalConfig = Join-Path $Stage "server\config.js"
if (Test-Path -LiteralPath $LocalConfig) { Remove-Item -LiteralPath $LocalConfig -Force }

$Files = Get-ChildItem -LiteralPath $Stage -File -Recurse | ForEach-Object {
  $_.FullName.Substring($Stage.Length + 1).Replace('\', '/')
} | Sort-Object
$Manifest = [ordered]@{
  schemaVersion = 1
  version = $Package.version
  builtAt = (Get-Date).ToString("o")
  files = @($Files)
}
$ManifestJson = $Manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText((Join-Path $Stage "update-manifest.json"), $ManifestJson, [System.Text.UTF8Encoding]::new($false))

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Archive = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($File in Get-ChildItem -LiteralPath $Stage -File -Recurse) {
    $EntryName = $File.FullName.Substring($Stage.Length + 1).Replace('\', '/')
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
Write-Host "Safe incremental update package ready:"
Write-Host "  $ZipPath"
Write-Host "  $HashPath"
