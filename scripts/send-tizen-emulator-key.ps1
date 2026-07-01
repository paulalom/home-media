[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('Back', 'Down', 'Enter', 'Escape', 'Left', 'Pause', 'Play', 'PlayPause', 'Right', 'Up')]
  [string[]]$Key,

  [int]$DelayMs = 650,
  [int]$HoldMs = 80,
  [switch]$NoFocus
)

$ErrorActionPreference = 'Stop'

$virtualKeys = @{
  Back = 0x1B
  Down = 0x28
  Enter = 0x0D
  Escape = 0x1B
  Left = 0x25
  Pause = 0x13
  Play = 0xB3
  PlayPause = 0xB3
  Right = 0x27
  Up = 0x26
}

if (-not ('HomeMediaEmulatorInput' -as [type])) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class HomeMediaEmulatorInput {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool PostMessage(IntPtr hWnd, UInt32 msg, IntPtr wParam, IntPtr lParam);
}
'@
}

$window = Get-Process emulator-x86_64 -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -and $_.MainWindowHandle -ne 0 } |
  Select-Object -First 1

if (-not $window) {
  throw 'Tizen Emulator window was not found. Launch the emulator before sending keys.'
}

if (-not $NoFocus) {
  [HomeMediaEmulatorInput]::SetForegroundWindow($window.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 120
}

$WM_KEYDOWN = 0x0100
$WM_KEYUP = 0x0101

foreach ($name in $Key) {
  $virtualKey = [int]$virtualKeys[$name]

  [HomeMediaEmulatorInput]::PostMessage(
    $window.MainWindowHandle,
    $WM_KEYDOWN,
    [intptr]$virtualKey,
    [intptr]0
  ) | Out-Null

  Start-Sleep -Milliseconds $HoldMs

  [HomeMediaEmulatorInput]::PostMessage(
    $window.MainWindowHandle,
    $WM_KEYUP,
    [intptr]$virtualKey,
    [intptr]0
  ) | Out-Null

  [pscustomobject]@{
    Key = $name
    ProcessId = $window.Id
    VirtualKey = $virtualKey
    WindowTitle = $window.MainWindowTitle
  }

  if ($DelayMs -gt 0) {
    Start-Sleep -Milliseconds $DelayMs
  }
}
