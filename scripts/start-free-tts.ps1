$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.venv-tts\Scripts\python.exe'
$worker = Join-Path $root 'scripts\melo-tts-worker.py'
$zrok = Join-Path $env:USERPROFILE 'bin\zrok2.exe'
$tokenPath = Join-Path $env:USERPROFILE '.local-tts-token'

if (-not (Test-Path $python)) { throw "MeloTTS Python not found: $python" }
if (-not (Test-Path $zrok)) { throw "zrok2 not found: $zrok" }
if (-not (Test-Path $tokenPath)) { throw "LOCAL_TTS_TOKEN file not found: $tokenPath" }

$env:LOCAL_TTS_TOKEN = (Get-Content -Raw $tokenPath).Trim()
$env:LOCAL_TTS_HOST = '127.0.0.1'
$env:LOCAL_TTS_PORT = '8766'

$workerRunning = Get-NetTCPConnection -LocalPort 8766 -State Listen -ErrorAction SilentlyContinue
if (-not $workerRunning) {
  Start-Process -WindowStyle Hidden -FilePath $python -ArgumentList $worker
}

$zrokRunning = Get-Process -Name zrok2 -ErrorAction SilentlyContinue
if (-not $zrokRunning) {
  Start-Process -WindowStyle Hidden -FilePath $zrok -ArgumentList @(
    'share', 'public', 'http://127.0.0.1:8766',
    '--headless', '--backend-mode', 'proxy', '--open',
    '-n', 'public:shorts-dashboard-tts'
  )
}
