[CmdletBinding()]
param(
  [switch]$Background,
  [switch]$Restart,
  [switch]$Stop,
  [int]$Port = 0
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ServiceId = 'HomeMediaServer'
$LogRoot = if ($env:LOCALAPPDATA) {
  Join-Path $env:LOCALAPPDATA 'My Home Media Server\logs'
} else {
  Join-Path $ProjectRoot '.home-media\logs'
}

function Get-HomeMediaServerProcess {
  $projectPattern = [regex]::Escape($ProjectRoot)

  Get-CimInstance Win32_Process |
    Where-Object {
      $_.CommandLine -and
      $_.Name -in @('node.exe', 'cmd.exe') -and
      $_.CommandLine -match $projectPattern -and
      ($_.CommandLine -match 'vite' -or $_.CommandLine -match 'dev:lan' -or $_.CommandLine -match 'npm')
    }
}

function Get-ConfiguredPort {
  $defaultPort = 23232

  try {
    $packagePath = Join-Path $ProjectRoot 'package.json'
    $package = Get-Content -Path $packagePath -Raw | ConvertFrom-Json
    $devLanScript = [string]$package.scripts.'dev:lan'

    if ($devLanScript -match '(?:^|\s)--port(?:=|\s+)(\d+)(?:\s|$)') {
      return [int]$matches[1]
    }
  } catch {
    Write-Warning "Could not read the configured Vite port from package.json: $($_.Exception.Message)"
  }

  $defaultPort
}

function Stop-HomeMediaServerProcess {
  $processes = @(Get-HomeMediaServerProcess)

  foreach ($process in $processes) {
    if ($process.ProcessId -ne $PID) {
      Write-Host "Stopping existing Home Media server process $($process.ProcessId)..."
      Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }

  if ($processes.Count -gt 0) {
    Start-Sleep -Seconds 1
  }
}

function Get-PortOwner {
  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)

  foreach ($listener in $listeners) {
    Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
  }
}

function Test-HomeMediaServiceRunning {
  $service = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
  $service -and $service.Status -eq 'Running'
}

function Test-HomeMediaServerProcessTree {
  param($Process)

  $currentProcess = $Process

  while ($currentProcess) {
    if ($currentProcess.Name -eq 'HomeMediaServer.exe') {
      return $true
    }

    if (
      $currentProcess.CommandLine -and
      $currentProcess.CommandLine -match [regex]::Escape($ProjectRoot)
    ) {
      return $true
    }

    if (-not $currentProcess.ParentProcessId -or $currentProcess.ParentProcessId -eq 0) {
      return $false
    }

    $currentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($currentProcess.ParentProcessId)" -ErrorAction SilentlyContinue
  }

  return $false
}

if ($Restart -or $Stop) {
  Stop-HomeMediaServerProcess
}

if ($Port -le 0) {
  $Port = Get-ConfiguredPort
}

if ($Stop) {
  Write-Host 'Home Media server stop request complete.'
  exit 0
}

$portOwners = @(Get-PortOwner)
foreach ($owner in $portOwners) {
  if (Test-HomeMediaServerProcessTree $owner) {
    if ($Restart) {
      throw "Home Media server is still running on port $Port (PID $($owner.ProcessId)). If it is the Windows service, restart it from an elevated PowerShell session or Services."
    }

    Write-Host "Home Media server is already running on port $Port (PID $($owner.ProcessId))."
    exit 0
  }

  if (Test-HomeMediaServiceRunning) {
    if ($Restart) {
      throw "Home Media server service is still running on port $Port. Restart it from an elevated PowerShell session or Services."
    }

    Write-Host "Home Media server service is already running on port $Port."
    exit 0
  }

  if ($owner.ProcessId) {
    throw "Port $Port is already in use by PID $($owner.ProcessId): $($owner.CommandLine)"
  }
}

New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null

if ($Background) {
  $stdoutLog = Join-Path $LogRoot 'vite.out.log'
  $stderrLog = Join-Path $LogRoot 'vite.err.log'

  Write-Host "Starting Home Media server in the background..."
  Write-Host "Logs: $stdoutLog"

  $process = Start-Process `
    -FilePath 'npm.cmd' `
    -ArgumentList @('run', 'dev:lan') `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

  Start-Sleep -Seconds 3

  $portOwners = @(Get-PortOwner)
  if ($portOwners.Count -eq 0) {
    throw "Home Media server did not start listening on port $Port. Check $stdoutLog and $stderrLog."
  }

  Write-Host "Home Media server started on http://localhost:$Port/ (launcher PID $($process.Id))."
  exit 0
}

Write-Host "Starting Home Media server from $ProjectRoot..."
Write-Host "Local URL: http://localhost:$Port/"
Write-Host 'Press Ctrl+C or close this window to stop the server.'
Write-Host ''

Set-Location $ProjectRoot
& npm.cmd run dev:lan
exit $LASTEXITCODE
