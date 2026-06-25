[CmdletBinding()]
param(
  [string]$ServiceId = 'HomeMediaServer',
  [string]$ServiceName = 'Home Media Server',
  [switch]$NoSelfElevate
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ServiceRoot = Join-Path $ProjectRoot '.home-media\service'
$ServiceExe = Join-Path $ServiceRoot "$ServiceId.exe"
$ServiceXml = Join-Path $ServiceRoot "$ServiceId.xml"
$StartScript = Join-Path $ProjectRoot 'scripts\start-server.ps1'
$InstallLog = Join-Path $ServiceRoot 'install.log'
$WinSwReleaseApi = 'https://api.github.com/repos/winsw/winsw/releases/latest'

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]$identity
  $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-InstallLog {
  param([string]$Message)

  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  "$timestamp $Message" | Tee-Object -FilePath $InstallLog -Append
}

function ConvertTo-XmlValue {
  param([string]$Value)

  [Security.SecurityElement]::Escape($Value)
}

New-Item -ItemType Directory -Path $ServiceRoot -Force | Out-Null

if (-not (Test-Administrator)) {
  if ($NoSelfElevate) {
    throw 'Installing a Windows service requires Administrator rights. Run this script as Administrator.'
  }

  Write-InstallLog 'Requesting Administrator approval to install the Windows service...'

  $argumentList = @(
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    "`"$PSCommandPath`"",
    '-ServiceId',
    "`"$ServiceId`"",
    '-ServiceName',
    "`"$ServiceName`"",
    '-NoSelfElevate'
  )

  Start-Process `
    -FilePath "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -ArgumentList $argumentList `
    -Verb RunAs

  Write-Host 'An Administrator prompt was opened. Approve it to finish installing the service.'
  exit 0
}

Write-InstallLog "Installing $ServiceName from $ProjectRoot..."

$npmCommand = Get-Command npm.cmd -ErrorAction Stop
$powerShellExe = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
$desktop = [Environment]::GetFolderPath('Desktop')
$metadataPath = if ($env:LOCALAPPDATA) {
  Join-Path $env:LOCALAPPDATA 'My Home Media Server\metadata.json'
} else {
  Join-Path $ProjectRoot '.home-media\metadata.json'
}
$serviceLogPath = Join-Path $ServiceRoot 'logs'

New-Item -ItemType Directory -Path $serviceLogPath -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path $metadataPath -Parent) -Force | Out-Null

if (-not (Test-Path $ServiceExe)) {
  Write-InstallLog 'Downloading WinSW service wrapper...'
  $release = Invoke-RestMethod -Uri $WinSwReleaseApi -Headers @{ 'User-Agent' = 'home-media-service-installer' }
  $asset = $release.assets | Where-Object { $_.name -eq 'WinSW-x64.exe' } | Select-Object -First 1

  if (-not $asset) {
    throw 'Could not find WinSW-x64.exe in the latest WinSW release.'
  }

  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $ServiceExe
}

$escapedServiceId = ConvertTo-XmlValue $ServiceId
$escapedServiceName = ConvertTo-XmlValue $ServiceName
$escapedProjectRoot = ConvertTo-XmlValue $ProjectRoot
$escapedStartScript = ConvertTo-XmlValue $StartScript
$escapedPowerShellExe = ConvertTo-XmlValue $powerShellExe
$escapedDesktop = ConvertTo-XmlValue $desktop
$escapedMetadataPath = ConvertTo-XmlValue $metadataPath
$escapedServiceLogPath = ConvertTo-XmlValue $serviceLogPath

$serviceXmlContent = @"
<service>
  <id>$escapedServiceId</id>
  <name>$escapedServiceName</name>
  <description>Runs npm run dev:lan for My Home Media Server.</description>
  <executable>$escapedPowerShellExe</executable>
  <arguments>-NoProfile -ExecutionPolicy Bypass -File "$escapedStartScript"</arguments>
  <workingdirectory>$escapedProjectRoot</workingdirectory>
  <startmode>Automatic</startmode>
  <stoptimeout>15 sec</stoptimeout>
  <stopparentprocessfirst>true</stopparentprocessfirst>
  <env name="HOME_MEDIA_FILES_ROOT" value="$escapedDesktop" />
  <env name="HOME_MEDIA_METADATA_PATH" value="$escapedMetadataPath" />
  <env name="PATH" value="$(ConvertTo-XmlValue "$($npmCommand.Source | Split-Path -Parent);$env:PATH")" />
  <logpath>$escapedServiceLogPath</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10485760</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
  <onfailure action="restart" delay="10 sec" />
</service>
"@

Set-Content -Path $ServiceXml -Value $serviceXmlContent -Encoding UTF8

$existingService = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
if ($existingService) {
  Write-InstallLog 'Stopping existing service...'
  & $ServiceExe stop | Tee-Object -FilePath $InstallLog -Append
  Write-InstallLog 'Uninstalling existing service...'
  & $ServiceExe uninstall | Tee-Object -FilePath $InstallLog -Append
}

Write-InstallLog 'Stopping any manually launched dev server before service start...'
& $StartScript -Stop | Tee-Object -FilePath $InstallLog -Append

Write-InstallLog 'Installing service...'
& $ServiceExe install | Tee-Object -FilePath $InstallLog -Append

Write-InstallLog 'Starting service...'
& $ServiceExe start | Tee-Object -FilePath $InstallLog -Append

Start-Sleep -Seconds 5

$service = Get-Service -Name $ServiceId -ErrorAction Stop
Write-InstallLog "Service status: $($service.Status)"
Write-Host "$ServiceName service is $($service.Status)."
Write-Host "Local URL: http://localhost:5173/"
Write-Host "Install log: $InstallLog"
