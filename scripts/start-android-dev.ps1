param(
  [string]$AvdName = "Pixel_3a_API_34_extension_level_7_x86_64",
  [int]$ExpoPort = 8082,
  [switch]$NoClearCache,
  [switch]$KeepExistingMetro,
  [switch]$SkipExpo
)

$ErrorActionPreference = "Stop"

$sdkRoot = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$emulatorPath = Join-Path $sdkRoot "emulator\emulator.exe"
$adbPath = Join-Path $sdkRoot "platform-tools\adb.exe"
$projectRoot = Split-Path -Parent $PSScriptRoot

function Get-EmulatorDevices {
  $output = & $adbPath devices
  return $output | Where-Object { $_ -match "^emulator-\d+\s+device$" }
}

function Stop-MetroOnPort {
  param([int]$Port)

  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $connections) {
    return
  }

  $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($processId in $processIds) {
    if ($processId -and $processId -ne 0) {
      try {
        $process = Get-Process -Id $processId -ErrorAction Stop
        Write-Host "Stopping existing process on port ${Port}: $($process.ProcessName) ($processId)"
        Stop-Process -Id $processId -Force
      } catch {
        Write-Host "Unable to stop process $processId on port ${Port}: $($_.Exception.Message)"
      }
    }
  }
}

if (-not (Test-Path $emulatorPath)) {
  throw "Android emulator not found at $emulatorPath"
}

if (-not (Test-Path $adbPath)) {
  throw "adb not found at $adbPath"
}

Write-Host "Using AVD: $AvdName"
Write-Host "Project root: $projectRoot"

$existingDevices = Get-EmulatorDevices
if (-not $existingDevices) {
  Write-Host "Starting emulator..."
  Start-Process -FilePath $emulatorPath -ArgumentList "@$AvdName" | Out-Null
} else {
  Write-Host "An emulator is already running:"
  $existingDevices | ForEach-Object { Write-Host "  $_" }
}

Write-Host "Waiting for emulator to become ready..."
$deadline = (Get-Date).AddMinutes(3)
$deviceReady = $false

while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 5
  $devices = Get-EmulatorDevices
  if ($devices) {
    $deviceReady = $true
    Write-Host "Emulator ready:"
    $devices | ForEach-Object { Write-Host "  $_" }
    break
  }
}

if (-not $deviceReady) {
  throw "No emulator became ready within 3 minutes."
}

Write-Host "Force-stopping old Android app instances..."
& $adbPath shell am force-stop host.exp.exponent | Out-Null
& $adbPath shell am force-stop com.balaji119.flowiq | Out-Null

if ($SkipExpo) {
  Write-Host "SkipExpo was set. Emulator startup completed."
  exit 0
}

if (-not $KeepExistingMetro) {
  Stop-MetroOnPort -Port 8081
  if ($ExpoPort -ne 8081) {
    Stop-MetroOnPort -Port $ExpoPort
  }
}

if ($NoClearCache) {
  Write-Host "Starting Expo on port $ExpoPort without clearing Metro cache..."
  $expoCommand = "Set-Location '$projectRoot'; npx expo start --android --port $ExpoPort"
} else {
  Write-Host "Starting Expo on port $ExpoPort with a clean Metro cache..."
  $expoCommand = "Set-Location '$projectRoot'; npx expo start --android --clear --port $ExpoPort"
}

Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $expoCommand | Out-Null

Write-Host "Expo launch command started in a new PowerShell window."
