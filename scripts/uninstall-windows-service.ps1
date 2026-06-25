[CmdletBinding()]
param(
  [string]$ServiceId = 'HomeMediaServer',
  [switch]$NoSelfElevate
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ServiceRoot = Join-Path $ProjectRoot '.home-media\service'
$ServiceExe = Join-Path $ServiceRoot "$ServiceId.exe"

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]$identity
  $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
  if ($NoSelfElevate) {
    throw 'Uninstalling a Windows service requires Administrator rights. Run this script as Administrator.'
  }

  Start-Process `
    -FilePath "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-ServiceId', "`"$ServiceId`"", '-NoSelfElevate') `
    -Verb RunAs

  Write-Host 'An Administrator prompt was opened. Approve it to uninstall the service.'
  exit 0
}

if (-not (Test-Path $ServiceExe)) {
  Write-Host "Service wrapper not found at $ServiceExe."
  exit 0
}

if (Get-Service -Name $ServiceId -ErrorAction SilentlyContinue) {
  & $ServiceExe stop
  & $ServiceExe uninstall
  Write-Host "Uninstalled $ServiceId."
} else {
  Write-Host "$ServiceId is not installed."
}
