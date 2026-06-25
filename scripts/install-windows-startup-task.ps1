[CmdletBinding()]
param(
  [string]$TaskName = 'HomeMediaServer',
  [string]$TaskPath = '\My Home Media Server\'
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$StartScript = Join-Path $ProjectRoot 'scripts\start-server.ps1'
$LogRoot = if ($env:LOCALAPPDATA) {
  Join-Path $env:LOCALAPPDATA 'My Home Media Server\logs'
} else {
  Join-Path $ProjectRoot '.home-media\logs'
}
$InstallLog = Join-Path $LogRoot 'startup-task-install.log'

function Write-InstallLog {
  param([string]$Message)

  New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  "$timestamp $Message" | Tee-Object -FilePath $InstallLog -Append
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

$powerShellExe = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
$serverPort = Get-ConfiguredPort
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name

Write-InstallLog "Installing startup task $TaskPath$TaskName for $currentUser from $ProjectRoot..."

$action = New-ScheduledTaskAction `
  -Execute $powerShellExe `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`" -Background -Port $serverPort" `
  -WorkingDirectory $ProjectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal `
  -UserId $currentUser `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -Compatibility Win8 `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $TaskName `
  -TaskPath $TaskPath `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description 'Starts My Home Media Server for the signed-in user.' `
  -Force | Out-Null

Write-InstallLog 'Stopping any existing Home Media server process before task start...'
& $StartScript -Stop | Tee-Object -FilePath $InstallLog -Append

Write-InstallLog 'Starting startup task...'
Start-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath
Start-Sleep -Seconds 5

$task = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath
Write-InstallLog "Task state: $($task.State)"
Write-Host "Startup task $TaskPath$TaskName is $($task.State)."
Write-Host "Runs as: $currentUser"
Write-Host "Local URL: http://localhost:$serverPort/"
Write-Host "Install log: $InstallLog"
