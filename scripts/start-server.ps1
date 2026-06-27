[CmdletBinding()]
param(
  [switch]$Background,
  [switch]$Restart,
  [switch]$Stop,
  [switch]$Update,
  [int]$Port = 0
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ServiceId = 'HomeMediaServer'
$AppDataRoot = if ($env:LOCALAPPDATA) {
  Join-Path $env:LOCALAPPDATA 'My Home Media Server'
} else {
  Join-Path $ProjectRoot '.home-media'
}
$LogRoot = if ($env:LOCALAPPDATA) {
  Join-Path $AppDataRoot 'logs'
} else {
  Join-Path $ProjectRoot '.home-media\logs'
}
$StartupLog = Join-Path $LogRoot 'startup.log'

function Write-StartupLog {
  param([string]$Message)

  New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  "$timestamp $Message" | Add-Content -Path $StartupLog
  Write-Host $Message
}

function Invoke-LoggedCommand {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [switch]$IgnoreFailure
  )

  Write-StartupLog "Running: $FilePath $($ArgumentList -join ' ')"

  $output = & $FilePath @ArgumentList 2>&1
  $exitCode = $LASTEXITCODE

  foreach ($line in $output) {
    Write-StartupLog ([string]$line)
  }

  if ($exitCode -ne 0) {
    $message = "$FilePath exited with code $exitCode."

    if ($IgnoreFailure) {
      Write-StartupLog "Warning: $message"
    } else {
      throw $message
    }
  }

  return $exitCode
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

function Set-UserRuntimeEnvironmentDefaults {
  if (-not $env:HOME_MEDIA_FILES_ROOT) {
    $env:HOME_MEDIA_FILES_ROOT = [Environment]::GetFolderPath('Desktop')
  }

  if (-not $env:HOME_MEDIA_METADATA_PATH) {
    $env:HOME_MEDIA_METADATA_PATH = Join-Path $AppDataRoot 'metadata.json'
  }

  if (-not $env:HOME_MEDIA_ARTWORK_CACHE_ROOT) {
    $env:HOME_MEDIA_ARTWORK_CACHE_ROOT = Join-Path $AppDataRoot 'artwork'
  }

  if (-not $env:HOME_MEDIA_PREVIEW_CACHE_ROOT) {
    $env:HOME_MEDIA_PREVIEW_CACHE_ROOT = Join-Path $AppDataRoot 'preview-frames'
  }

  New-Item -ItemType Directory -Path $AppDataRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $env:HOME_MEDIA_ARTWORK_CACHE_ROOT -Force | Out-Null
  New-Item -ItemType Directory -Path $env:HOME_MEDIA_PREVIEW_CACHE_ROOT -Force | Out-Null
}

function Get-DependencyFingerprint {
  $manifestPaths = @(
    (Join-Path $ProjectRoot 'package.json'),
    (Join-Path $ProjectRoot 'package-lock.json')
  ) | Where-Object { Test-Path $_ }

  if ($manifestPaths.Count -eq 0) {
    return ''
  }

  $parts = foreach ($manifestPath in $manifestPaths) {
    $hash = (Get-FileHash -Path $manifestPath -Algorithm SHA256).Hash
    "$(Split-Path -Path $manifestPath -Leaf):$hash"
  }

  $parts -join "`n"
}

function Update-NodeDependenciesIfNeeded {
  $fingerprint = Get-DependencyFingerprint

  if (-not $fingerprint) {
    Write-StartupLog 'No npm manifests found; skipping dependency refresh.'
    return
  }

  $stampPath = Join-Path $AppDataRoot 'dependency-stamp.txt'
  $previousFingerprint = if (Test-Path $stampPath) {
    Get-Content -Path $stampPath -Raw
  } else {
    ''
  }
  $viteBin = Join-Path $ProjectRoot 'node_modules\.bin\vite.cmd'
  $dependenciesPresent = Test-Path $viteBin

  if ($dependenciesPresent -and $previousFingerprint -eq $fingerprint) {
    Write-StartupLog 'Node dependencies are already current.'
    return
  }

  $installArgs = @('install', '--prefer-offline', '--no-audit', '--no-fund')

  try {
    Invoke-LoggedCommand -FilePath 'npm.cmd' -ArgumentList $installArgs | Out-Null
  } catch {
    if ($dependenciesPresent) {
      Write-StartupLog "Warning: npm dependency refresh failed; continuing with existing node_modules. $($_.Exception.Message)"
      return
    }

    throw
  }

  New-Item -ItemType Directory -Path $AppDataRoot -Force | Out-Null
  Set-Content -Path $stampPath -Value $fingerprint -NoNewline
  Write-StartupLog 'Node dependency refresh complete.'
}

function Update-ProjectCheckout {
  if (-not (Test-Path (Join-Path $ProjectRoot '.git'))) {
    Write-StartupLog 'No Git checkout found; skipping source update.'
    return
  }

  if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
    Write-StartupLog 'git.exe was not found; skipping source update.'
    return
  }

  $upstream = & git.exe -C $ProjectRoot rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $upstream) {
    Write-StartupLog 'No upstream branch is configured; skipping source update.'
    return
  }

  $status = & git.exe -C $ProjectRoot status --porcelain 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-StartupLog "Could not inspect Git status; skipping source update. $status"
    return
  }

  if ($status) {
    Write-StartupLog 'Working tree has local changes; skipping automatic source update.'
    return
  }

  $previousGitPrompt = $env:GIT_TERMINAL_PROMPT
  $env:GIT_TERMINAL_PROMPT = '0'

  try {
    Invoke-LoggedCommand `
      -FilePath 'git.exe' `
      -ArgumentList @('-C', $ProjectRoot, 'pull', '--ff-only') `
      -IgnoreFailure | Out-Null
  } finally {
    $env:GIT_TERMINAL_PROMPT = $previousGitPrompt
  }
}

if ($Restart -or $Stop) {
  Stop-HomeMediaServerProcess
}

New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null

if ($Update -and -not $Stop) {
  Write-StartupLog "Preparing latest Home Media checkout in $ProjectRoot..."
  Update-ProjectCheckout
  Update-NodeDependenciesIfNeeded
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

Set-UserRuntimeEnvironmentDefaults

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

  $deadline = (Get-Date).AddSeconds(20)
  $portOwners = @()

  do {
    Start-Sleep -Seconds 1
    $portOwners = @(Get-PortOwner)

    if ($portOwners.Count -gt 0) {
      break
    }

    if ($process.HasExited) {
      throw "Home Media server exited before listening on port $Port with code $($process.ExitCode). Check $stdoutLog and $stderrLog."
    }
  } while ((Get-Date) -lt $deadline)

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
