# OpenCCTV installer for Windows (x64).
#
#   irm https://opencctv.codext.de/install.ps1 | iex
#
# Downloads the latest release (opencctv-windows-x64.exe) from GitHub, installs it to
# %LOCALAPPDATA%\Programs\OpenCCTV, adds it to your PATH and sets it up to start at
# logon via `opencctv service install` (Task Scheduler). No administrator rights needed.
# Data is kept in %APPDATA%\OpenCCTV.
#
# Options (environment variables):
#   $env:OPENCCTV_VERSION = "v1.2.3"   install a specific release instead of the latest
#   $env:OPENCCTV_NO_SERVICE = "1"     only install the binary, don't set up autostart
#
# Source: https://github.com/codextde/opencctv  (MIT license)

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $repo = 'codextde/opencctv'
  $asset = 'opencctv-windows-x64.exe'
  $version = if ($env:OPENCCTV_VERSION) { $env:OPENCCTV_VERSION } else { 'latest' }
  $url = if ($version -eq 'latest') { "https://github.com/$repo/releases/latest/download/$asset" } else { "https://github.com/$repo/releases/download/$version/$asset" }
  $dir = Join-Path $env:LOCALAPPDATA 'Programs\OpenCCTV'
  $exe = Join-Path $dir 'opencctv.exe'

  function Say($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

  if (-not [Environment]::Is64BitOperatingSystem) { throw 'OpenCCTV needs 64-bit Windows.' }
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { Write-Warning 'Windows on ARM: installing the x64 build, which runs under emulation.' }

  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('opencctv-' + [Guid]::NewGuid().ToString('N') + '.exe')
  Say "Downloading $asset ($version)"
  try {
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
  } catch {
    throw "Download failed: $url"
  }
  Unblock-File -Path $tmp -ErrorAction SilentlyContinue

  Say "Installing to $dir"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  # A running server keeps the exe locked; stop it before replacing.
  Get-Process -Name 'opencctv' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  Move-Item -Force -Path $tmp -Destination $exe

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $userPath) { $userPath = '' }
  if (($userPath -split ';') -notcontains $dir) {
    [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $dir).TrimStart(';'), 'User')
  }
  if (($env:Path -split ';') -notcontains $dir) { $env:Path = $env:Path.TrimEnd(';') + ';' + $dir }

  if ($env:OPENCCTV_NO_SERVICE -eq '1') {
    Say 'Installed. Start the server with: opencctv serve'
    return
  }

  Say 'Setting up autostart'
  & $exe service install
  if ($LASTEXITCODE -ne 0) {
    Write-Warning 'Could not set up autostart. Start the server manually with: opencctv serve'
    return
  }

  Write-Host ''
  Write-Host 'Windows Firewall may ask whether OpenCCTV may accept connections. Allow it for private networks so your phone can connect.'
  $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
  if (-not $ip) { $ip = 'localhost' }
  Write-Host ''
  Say 'OpenCCTV is running.'
  Write-Host "    Open http://${ip}:8080 to create the admin account."
  Write-Host '    Then install the app and scan the pairing code: https://opencctv.codext.de'
  Write-Host ''
}
