$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$worker = Join-Path $root 'scripts\free-video-worker.py'
$zrok = Join-Path $env:USERPROFILE 'bin\zrok2.exe'
$renderToken = [Environment]::GetEnvironmentVariable('LOCAL_RENDER_TOKEN', 'User')
$ttsTokenPath = Join-Path $env:USERPROFILE '.local-tts-token'

if (-not $renderToken) { throw 'LOCAL_RENDER_TOKEN user environment variable is missing' }
if (-not (Test-Path $ttsTokenPath)) { throw 'LOCAL_TTS token file is missing' }
if (-not (Test-Path $zrok)) { throw 'zrok2 not found' }

$env:LOCAL_RENDER_TOKEN = $renderToken
$env:LOCAL_RENDER_PUBLIC_URL = 'https://shorts-dashboard-render.shares.zrok.io'
$env:LOCAL_TTS_URL = 'http://127.0.0.1:8766'
$env:LOCAL_TTS_TOKEN = (Get-Content -Raw $ttsTokenPath).Trim()

if (-not (Get-NetTCPConnection -LocalPort 8770 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -WindowStyle Hidden -FilePath python -ArgumentList $worker
}

if (-not (Get-CimInstance Win32_Process -Filter "Name='zrok2.exe'" | Where-Object { $_.CommandLine -match 'shorts-dashboard-render' })) {
  Start-Process -WindowStyle Hidden -FilePath $zrok -ArgumentList @('share', 'public', 'http://127.0.0.1:8770', '--headless', '--backend-mode', 'proxy', '--open', '-n', 'public:shorts-dashboard-render')
}
