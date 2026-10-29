$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../tools/ci/installer-runtime.ps1')

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$root = Join-Path ([System.IO.Path]::GetTempPath()) ('elitesand-runtime-lock-test-' + [guid]::NewGuid())
$child = $null
New-Item -ItemType Directory -Path $root | Out-Null
try {
  $target = Join-Path $root 'runtime.exe'
  [System.IO.File]::WriteAllText($target, 'seed')
  Add-InstallerSmokeRuntimeMarker -LiteralPath $target -Marker '-approved'
  Assert-True (([System.IO.File]::ReadAllText($target)) -ceq 'seed-approved') 'Unlocked marker must be appended exactly once.'

  $ready = Join-Path $root 'ready'
  $quotedTarget = $target.Replace("'", "''")
  $quotedReady = $ready.Replace("'", "''")
  $childCode = @"
`$ErrorActionPreference = 'Stop'
`$handle = [System.IO.File]::Open('$quotedTarget', 'Open', 'Read', 'Read')
try {
  [System.IO.File]::WriteAllText('$quotedReady', 'locked')
  Start-Sleep -Milliseconds 2500
} finally { `$handle.Dispose() }
"@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childCode))
  $child = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList @('-NoProfile', '-EncodedCommand', $encoded) -PassThru -WindowStyle Hidden
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while (-not (Test-Path -LiteralPath $ready)) {
    if ($child.HasExited -or [DateTime]::UtcNow -gt $deadline) { throw 'Lock-holder process never became ready.' }
    Start-Sleep -Milliseconds 25
  }

  $rejected = $false
  try { Add-InstallerSmokeRuntimeMarker -LiteralPath $target -Marker '-must-not-write' -TimeoutMilliseconds 250 }
  catch {
    if ($_.Exception.Message -notmatch 'remained locked') { throw }
    $rejected = $true
  }
  Assert-True $rejected 'A persistent sharing violation must fail within the deadline.'
  Assert-True (([System.IO.File]::ReadAllText($target)) -ceq 'seed-approved') 'Timed-out fixture mutation must not change bytes.'

  Add-InstallerSmokeRuntimeMarker -LiteralPath $target -Marker '-tampered' -TimeoutMilliseconds 10000
  $child.WaitForExit()
  Assert-True ($child.ExitCode -eq 0) 'Lock-holder process failed.'
  Assert-True (([System.IO.File]::ReadAllText($target)) -ceq 'seed-approved-tampered') 'Released lock must allow exactly one append.'

  $rejected = $false
  try { Add-InstallerSmokeRuntimeMarker -LiteralPath (Join-Path $root 'missing/runtime.exe') -Marker '-invalid' }
  catch {
    if ($_.Exception.Message -match 'remained locked') { throw }
    $rejected = $true
  }
  Assert-True $rejected 'Non-sharing I/O errors must fail immediately.'
  Write-Host 'Installer runtime marker: unlocked write, lock timeout, lock release, and missing-path rejection passed (4 checks).'
} finally {
  if ($child -and -not $child.HasExited) { $child.Kill(); $child.WaitForExit() }
  Remove-Item -LiteralPath $root -Recurse -Force
}
