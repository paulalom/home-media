[CmdletBinding()]
param(
  [string]$ApiBase = 'http://127.0.0.1:23232',
  [int]$DurationMinutes = 60,
  [int]$DurationSeconds = 0,
  [int]$SampleIntervalSeconds = 60,
  [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'

if ($DurationSeconds -le 0) {
  $DurationSeconds = [Math]::Max(1, $DurationMinutes * 60)
}

if ($SampleIntervalSeconds -le 0) {
  throw 'SampleIntervalSeconds must be greater than zero.'
}

if (-not $OutputPath) {
  $logRoot = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA 'My Home Media Server\logs'
  } else {
    Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')).Path '.home-media\logs'
  }

  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $OutputPath = Join-Path $logRoot "tv-idle-$timestamp.jsonl"
}

$outputDirectory = Split-Path -Parent $OutputPath
if ($outputDirectory) {
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}

function Read-JsonEndpoint {
  param([string]$Path)

  try {
    return @{
      ok = $true
      value = Invoke-RestMethod -Uri "$ApiBase$Path" -TimeoutSec 8
    }
  } catch {
    return @{
      error = $_.Exception.Message
      ok = $false
      value = $null
    }
  }
}

function Get-ProcessSample {
  Get-Process emulator-x86_64,node -ErrorAction SilentlyContinue |
    Sort-Object ProcessName,Id |
    ForEach-Object {
      [pscustomobject]@{
        cpuSeconds = if ($null -ne $_.CPU) { [Math]::Round($_.CPU, 3) } else { $null }
        id = $_.Id
        name = $_.ProcessName
        workingSetMiB = [Math]::Round($_.WorkingSet64 / 1MB, 1)
      }
    }
}

function Get-LatestDiagnostic {
  param($Diagnostics)

  $entries = @($Diagnostics.value.entries)
  if (-not $Diagnostics.ok -or $entries.Count -eq 0) {
    return $null
  }

  $entry = $entries[-1]

  [pscustomobject]@{
    appVersion = $entry.event.appVersion
    kind = $entry.event.kind
    memoryUsedMiB = $entry.event.env.memory.usedMiB
    pageAgeMs = $entry.event.pageAgeMs
    receivedAt = $entry.receivedAt
    selectedTitle = $entry.event.ui.selectedTitle.title
    section = $entry.event.ui.focus.sectionLabel
  }
}

$startedAt = Get-Date
$deadline = $startedAt.AddSeconds($DurationSeconds)
$sampleIndex = 0
$samples = New-Object System.Collections.Generic.List[object]

while ($true) {
  $now = Get-Date
  $activity = Read-JsonEndpoint '/api/playback-activity'
  $diagnostics = Read-JsonEndpoint '/api/tv-diagnostics'
  $processes = @(Get-ProcessSample)
  $emulatorProcess = $processes | Where-Object { $_.name -eq 'emulator-x86_64' } | Select-Object -First 1
  $activityValue = $activity.value

  $sample = [pscustomobject]@{
    activity = if ($activity.ok) {
      [pscustomobject]@{
        activeClients = $activityValue.activeClients
        awakeRequired = $activityValue.awakeRequired
      }
    } else {
      [pscustomobject]@{
        error = $activity.error
      }
    }
    diagnostics = if ($diagnostics.ok) {
      [pscustomobject]@{
        entryCount = $diagnostics.value.entryCount
        latest = Get-LatestDiagnostic $diagnostics
      }
    } else {
      [pscustomobject]@{
        error = $diagnostics.error
      }
    }
    elapsedSeconds = [Math]::Round(($now - $startedAt).TotalSeconds, 1)
    emulator = if ($emulatorProcess) {
      $emulatorProcess
    } else {
      $null
    }
    index = $sampleIndex
    processes = $processes
    sampledAt = $now.ToString('o')
    serverOk = $activity.ok -and $diagnostics.ok
  }

  $samples.Add($sample) | Out-Null
  $sample | ConvertTo-Json -Depth 8 -Compress | Add-Content -Path $OutputPath

  if ($now -ge $deadline) {
    break
  }

  $sampleIndex += 1
  $remainingSeconds = [Math]::Max(0, [Math]::Ceiling(($deadline - (Get-Date)).TotalSeconds))
  Start-Sleep -Seconds ([Math]::Min($SampleIntervalSeconds, $remainingSeconds))
}

$first = $samples[0]
$last = $samples[$samples.Count - 1]
$emulatorSamples = @($samples | Where-Object { $_.emulator })
$activitySamples = @($samples | Where-Object { $_.activity.activeClients -gt 0 -or $_.activity.awakeRequired })
$serverFailures = @($samples | Where-Object { -not $_.serverOk })
$firstEmulator = $emulatorSamples | Select-Object -First 1
$lastEmulator = $emulatorSamples | Select-Object -Last 1

[pscustomobject]@{
  activityActiveSamples = $activitySamples.Count
  durationSeconds = [Math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)
  emulatorMemoryDeltaMiB = if ($firstEmulator -and $lastEmulator) {
    [Math]::Round($lastEmulator.emulator.workingSetMiB - $firstEmulator.emulator.workingSetMiB, 1)
  } else {
    $null
  }
  firstSample = $first
  lastSample = $last
  outputPath = $OutputPath
  samples = $samples.Count
  serverFailureSamples = $serverFailures.Count
} | ConvertTo-Json -Depth 8
