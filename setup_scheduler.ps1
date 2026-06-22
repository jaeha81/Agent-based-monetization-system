# setup_scheduler.ps1 — Windows Task Scheduler 등록
# 실행: PowerShell -File setup_scheduler.ps1

$AgentPath = "D:\ai프로젝트\쇼츠자동화\shorts-local-agent"
$PythonExe = "C:\Python314\python.exe"
$SchedulerScript = Join-Path $AgentPath "scheduler.py"
$LogsDir = Join-Path $AgentPath "logs"

function Register-ShortsTask {
    param(
        [string]$TaskName,
        [string]$JobArg,
        [string]$TriggerTime,
        [string]$Description
    )

    # stdout + stderr를 날짜별 로그 파일로 리다이렉트하는 PowerShell 래퍼
    $LogFile = "$LogsDir\${JobArg}_%DATE:~0,4%%DATE:~5,2%%DATE:~8,2%.log"
    $PsArgs = "-NonInteractive -ExecutionPolicy Bypass -Command `"& '$PythonExe' -X utf8 '$SchedulerScript' $JobArg 2>&1 | Tee-Object -FilePath '$LogsDir\${JobArg}_run.log' -Append`""

    $action = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument $PsArgs `
        -WorkingDirectory $AgentPath

    $trigger = New-ScheduledTaskTrigger -Daily -At $TriggerTime

    $settings = New-ScheduledTaskSettingsSet `
        -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
        -RestartCount 2 `
        -RestartInterval (New-TimeSpan -Minutes 5) `
        -StartWhenAvailable `
        -WakeToRun

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Description $Description `
        -RunLevel Highest `
        -Force | Out-Null

    Write-Host "✅ 등록: $TaskName ($TriggerTime)"
}

Write-Host "=== Shorts 자동화 Task Scheduler 등록 ===" -ForegroundColor Cyan

# 로그 디렉터리 생성
New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null

# 1. 새벽 2시 — 전체 파이프라인 (KST)
Register-ShortsTask `
    -TaskName "ShortsAgent_DailyPipeline" `
    -JobArg "daily_pipeline" `
    -TriggerTime "02:00" `
    -Description "쇼핑숏츠 수익화 자동화 — 전체 파이프라인 (상품발굴+콘텐츠생성+수익동기화)"

# 2. 오전 9시 — 예약 게시 발행
Register-ShortsTask `
    -TaskName "ShortsAgent_Publish" `
    -JobArg "publish" `
    -TriggerTime "09:00" `
    -Description "쇼핑숏츠 예약 콘텐츠 발행"

# 3. 오후 6시 — 수익 동기화
Register-ShortsTask `
    -TaskName "ShortsAgent_RevenueSync" `
    -JobArg "revenue_sync" `
    -TriggerTime "18:00" `
    -Description "쇼핑숏츠 수익 동기화"

Write-Host ""
Write-Host "=== 등록된 태스크 목록 ===" -ForegroundColor Green
Get-ScheduledTask | Where-Object { $_.TaskName -like "ShortsAgent_*" } |
    Select-Object TaskName, State | Format-Table -AutoSize

Write-Host ""
Write-Host "즉시 테스트 실행:" -ForegroundColor Yellow
Write-Host "  Start-ScheduledTask -TaskName ShortsAgent_DailyPipeline"
Write-Host "  또는: python -X utf8 scheduler.py daily_pipeline"
Write-Host ""
Write-Host "로그 위치: $LogsDir\daily_pipeline_run.log" -ForegroundColor Cyan
