function Add-InstallerSmokeRuntimeMarker {
  param(
    [Parameter(Mandatory = $true)][string]$LiteralPath,
    [Parameter(Mandatory = $true)][string]$Marker,
    [ValidateRange(1, 120000)][int]$TimeoutMilliseconds = 60000
  )

  # Electron may exit before a previously spawned yt-dlp probe releases its image.
  # Acquire the actual write handle before changing the fixture; never skip a
  # trust assertion, kill unrelated processes, or retry a partially written marker.
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  $stream = $null
  while ($null -eq $stream) {
    try {
      $stream = [System.IO.File]::Open($LiteralPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    } catch [System.IO.IOException] {
      $nativeCode = $_.Exception.GetBaseException().HResult -band 0xFFFF
      if ($nativeCode -notin @(32, 33)) { throw }
      if ($clock.ElapsedMilliseconds -ge $TimeoutMilliseconds) {
        throw "Installer smoke runtime remained locked after $TimeoutMilliseconds ms: $LiteralPath"
      }
      Start-Sleep -Milliseconds 250
    }
  }
  try {
    [void]$stream.Seek(0, [System.IO.SeekOrigin]::End)
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Marker)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
  } finally {
    $stream.Dispose()
  }
}
