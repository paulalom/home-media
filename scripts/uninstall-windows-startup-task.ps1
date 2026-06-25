[CmdletBinding()]
param(
  [string]$TaskName = 'HomeMediaServer',
  [string]$TaskPath = '\My Home Media Server\'
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$StartScript = Join-Path $ProjectRoot 'scripts\start-server.ps1'

$task = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue

if ($task) {
  Stop-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Confirm:$false
  Write-Host "Uninstalled startup task $TaskPath$TaskName."
} else {
  Write-Host "Startup task $TaskPath$TaskName is not installed."
}

& $StartScript -Stop
