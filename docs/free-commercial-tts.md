# 무료 상업용 한국어 TTS

이 프로젝트는 Google TTS 키가 없을 때 `LOCAL_TTS_URL`로 로컬 MeloTTS 워커를 호출할 수 있습니다.

## 설치

Python 3.10 또는 3.11을 사용합니다. MeloTTS의 일부 의존성은 Windows Python 3.12에서 Rust/C++ 컴파일러가 필요합니다.

```powershell
py -3.11 -m venv .venv-tts
.\.venv-tts\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r scripts/requirements-tts.txt
```

## 실행

```powershell
$env:LOCAL_TTS_TOKEN = "긴-랜덤-토큰"
$env:LOCAL_TTS_HOST = "0.0.0.0"
python scripts/melo-tts-worker.py
```

Vercel에서 접근하려면 워커를 HTTPS로 공개해야 합니다. Cloudflare Tunnel 같은 무료 터널을 사용하고, 그 HTTPS 주소를 `LOCAL_TTS_URL`에 등록합니다. 토큰은 Vercel과 워커에 동일하게 설정합니다.

MeloTTS 저장소는 한국어를 지원하고 MIT 라이선스로 상업적 사용을 허용합니다. 라이선스 파일을 보관하고, 유명인 음성 복제나 무단 음성 데이터 사용은 하지 않습니다.

## 환경변수

```text
LOCAL_TTS_URL=https://your-tts-worker.example.com
LOCAL_TTS_TOKEN=동일한-긴-랜덤-토큰
```

Google TTS 키와 `LOCAL_TTS_URL`이 모두 있으면 기존 Google TTS를 우선 사용합니다. 완전 무료로 운영하려면 Google 키를 비워 두고 로컬 워커만 사용합니다.

## Windows 자동 시작

관리자 PowerShell에서 한 번만 실행합니다.

```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "D:\ai프로젝트\쇼츠자동화\shorts-dashboard\scripts\start-free-tts.ps1"'
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "ShortsDashboard-FreeTTS" -Action $action -Trigger $trigger -Description "Start MeloTTS and zrok tunnel for shorts-dashboard" -Force
```

zrok 예약 주소는 `https://shorts-dashboard-tts.shares.zrok.io`입니다. 무료 서비스이므로 PC가 켜져 있고 인터넷에 연결되어 있어야 합니다.
