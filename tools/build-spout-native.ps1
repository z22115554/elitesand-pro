param(
  [Parameter(Mandatory = $true)]
  [string]$SpoutSdkRoot,
  [string]$ElectronHeadersRoot = '',
  [string]$BuildRoot = '',
  [string]$VcVars64Path = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$expectedSpoutCommit = 'f49e2f469f8cb25f559a6eaa61a3f5b8173fc100'

if (-not $ElectronHeadersRoot) {
  $ElectronHeadersRoot = Join-Path $projectRoot '.local\electron-headers\43.1.1'
}
if (-not $BuildRoot) {
  $BuildRoot = Join-Path $projectRoot '.local\spout-output-build'
}

$actualSpoutCommit = (git -C $SpoutSdkRoot rev-parse HEAD).Trim()
if ($actualSpoutCommit -ne $expectedSpoutCommit) {
  throw "Spout SDK commit must be $expectedSpoutCommit; got $actualSpoutCommit."
}

$electronInclude = Join-Path $ElectronHeadersRoot 'include\node'
$electronNodeLib = Join-Path $ElectronHeadersRoot 'x64\node.lib'
$nodeGypRoot = Join-Path $projectRoot 'node_modules\node-gyp'
foreach ($required in @($electronInclude, $electronNodeLib, (Join-Path $nodeGypRoot 'src\win_delay_load_hook.cc'))) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required native build input is missing: $required" }
}

if (-not $VcVars64Path) {
  $vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
  if (Test-Path -LiteralPath $vswhere) {
    $installation = (& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1).Trim()
    if ($installation) { $VcVars64Path = Join-Path $installation 'VC\Auxiliary\Build\vcvars64.bat' }
  }
}
if (-not (Test-Path -LiteralPath $VcVars64Path)) { throw 'Could not locate vcvars64.bat. Install or select Visual Studio C++ Build Tools first.' }

$cmake = (Get-Command cmake -ErrorAction Stop).Source
New-Item -ItemType Directory -Force -Path $BuildRoot | Out-Null

function Get-ProjectRelativePath([string]$Path, [string]$Label) {
  $resolved = (Resolve-Path -LiteralPath $Path).Path
  # Windows PowerShell 5.1 uses .NET Framework, which has no
  # System.IO.Path.GetRelativePath(). Use Uri so this script stays usable in
  # the same host that runs the portable build scripts.
  $rootPath = (Resolve-Path -LiteralPath $projectRoot).Path.TrimEnd('\') + '\'
  $rootUri = [System.Uri]::new($rootPath)
  $relative = [System.Uri]::UnescapeDataString($rootUri.MakeRelativeUri([System.Uri]::new($resolved)).ToString()).Replace('/', '\')
  if ([System.IO.Path]::IsPathRooted($relative) -or $relative -eq '..' -or $relative.StartsWith("..$([System.IO.Path]::DirectorySeparatorChar)")) {
    throw "$Label must stay inside this isolated Spout worktree: $resolved"
  }
  return $relative
}

$relativeBuild = Get-ProjectRelativePath $BuildRoot 'BuildRoot'
$relativeSdk = Get-ProjectRelativePath $SpoutSdkRoot 'SpoutSdkRoot'
$relativeElectronInclude = Get-ProjectRelativePath $electronInclude 'ElectronHeadersRoot'
$relativeElectronNodeLib = Get-ProjectRelativePath $electronNodeLib 'Electron node.lib'
$relativeNodeGyp = Get-ProjectRelativePath $nodeGypRoot 'node-gyp'

# CMake 4.2.1 on this machine exits with 0xC0000409 when its source/build
# path contains the repository's CJK characters. Map this one worktree to a
# temporary ASCII drive for the native build only, then always remove it.
$driveLetter = @('S', 'R', 'Q', 'P', 'O', 'N') | Where-Object { -not (Test-Path "${_}:") } | Select-Object -First 1
if (-not $driveLetter) { throw 'No free drive letter is available for the temporary native-build mapping.' }
$mappedDrive = "${driveLetter}:"
subst $mappedDrive $projectRoot
try {
  $mappedRoot = "${mappedDrive}\"
  $mappedSource = Join-Path $mappedRoot 'native\spout-output'
  $mappedBuild = Join-Path $mappedRoot $relativeBuild
  $mappedSdk = Join-Path $mappedRoot $relativeSdk
  $mappedElectronInclude = Join-Path $mappedRoot $relativeElectronInclude
  $mappedElectronNodeLib = Join-Path $mappedRoot $relativeElectronNodeLib
  $mappedNodeGypRoot = Join-Path $mappedRoot $relativeNodeGyp

  $cmd = @(
    "call `"$VcVars64Path`" >nul",
    "`"$cmake`" -S `"$mappedSource`" -B `"$mappedBuild`" -G `"NMake Makefiles`" -DCMAKE_BUILD_TYPE=Release -DSPOUT_SDK_ROOT=`"$mappedSdk`" -DELECTRON_INCLUDE_DIR=`"$mappedElectronInclude`" -DELECTRON_NODE_LIB=`"$mappedElectronNodeLib`" -DNODE_GYP_ROOT=`"$mappedNodeGypRoot`"",
    "`"$cmake`" --build `"$mappedBuild`" --config Release"
  ) -join ' && '

  & cmd.exe /d /s /c $cmd
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  subst $mappedDrive /d
}

$artifact = Join-Path $BuildRoot 'elitesand_spout_output.node'
if (-not (Test-Path -LiteralPath $artifact)) { throw "Native build succeeded but artifact is missing: $artifact" }
Write-Output "Built $artifact"
