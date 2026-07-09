# DCS:OPT Ops Bot - DCS Hook auto-installer
# Copies the three hook files into every DCS profile's Scripts\Hooks folder.
# The ingest URL is already baked into dcsopt_hook.lua by the dashboard, so
# there is nothing to configure - just run this.
#
# ASCII-only on purpose (PS 5.1 can choke on non-ASCII source). Uses Copy-Item
# so the .lua bytes are preserved exactly - never Get-Content|Set-Content, which
# would add a UTF-8 BOM that makes DCS reject the file.

$ErrorActionPreference = 'Stop'
$src   = Split-Path -Parent $MyInvocation.MyCommand.Definition
$saved = Join-Path $env:USERPROFILE 'Saved Games'
$files = @('dcsopt_hook.lua', 'dcsopt_mission.lua', 'dcsopt_daemon.vbs')

Write-Host ''
Write-Host '  DCS:OPT Ops Bot - DCS Hook Installer' -ForegroundColor Cyan
Write-Host '  ====================================' -ForegroundColor Cyan
Write-Host ''

# All payload files must be extracted next to this script.
foreach ($f in $files) {
  if (-not (Test-Path (Join-Path $src $f))) {
    Write-Host "  ERROR: $f is missing from this folder." -ForegroundColor Red
    Write-Host '  Extract ALL files from the zip into one folder, then run again.' -ForegroundColor Red
    return
  }
}

if (-not (Test-Path $saved)) {
  Write-Host "  Could not find your Saved Games folder:" -ForegroundColor Red
  Write-Host "    $saved"
  Write-Host '  Is DCS installed on this PC?'
  return
}

# DCS profile folders are named DCS, DCS.openbeta, DCS.server, etc.
$variants = @(Get-ChildItem -Path $saved -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like 'DCS*' })
if ($variants.Count -eq 0) {
  Write-Host "  No DCS profile folders found under:" -ForegroundColor Red
  Write-Host "    $saved"
  Write-Host '  (Looking for folders named DCS, DCS.openbeta, DCS.server, ...)'
  return
}

$installed = 0
foreach ($v in $variants) {
  $hooks = Join-Path $v.FullName 'Scripts\Hooks'
  try {
    New-Item -ItemType Directory -Force -Path $hooks | Out-Null
    foreach ($f in $files) {
      Copy-Item -LiteralPath (Join-Path $src $f) -Destination (Join-Path $hooks $f) -Force
    }
    Write-Host "  Installed -> $($v.Name)\Scripts\Hooks" -ForegroundColor Green
    $installed++
  } catch {
    Write-Host "  Could not install into $($v.Name): $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

Write-Host ''
if ($installed -gt 0) {
  Write-Host "  Done - installed into $installed DCS profile(s)." -ForegroundColor Green
  Write-Host ''
  Write-Host '  NEXT: restart DCS, then open the dashboard DCS Server page.'
  Write-Host '  Within a minute it should flip to CONNECTED.'
  if ($variants.Count -gt 1) {
    Write-Host ''
    Write-Host '  Note: found more than one DCS install and set up all of them.'
    Write-Host '  Running two at once means both report telemetry - fine for most,'
    Write-Host '  but delete the hook files from any install you do not actually use.'
  }
} else {
  Write-Host '  Nothing was installed - see the messages above.' -ForegroundColor Red
}
Write-Host ''
