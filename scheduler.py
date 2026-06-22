#!/usr/bin/env python3
"""
scheduler.py — 로컬 Cron 대체 스케줄러
Vercel Cron 대신 홈 PC에서 스케줄 실행
Windows Task Scheduler가 이 스크립트를 호출

사용법:
  python scheduler.py daily_pipeline   # 새벽 2시 전체 파이프라인
  python scheduler.py revenue_sync     # 오후 6시 수익 동기화
  python scheduler.py publish          # 오전 9시 예약 게시
"""
import sys
import json
import logging
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import config

LOG_FILE = config.LOGS_DIR / f"scheduler_{datetime.now().strftime('%Y%m%d')}.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ]
)
log = logging.getLogger(__name__)


def run_daily_pipeline() -> dict:
    log.info("=== daily_pipeline 시작 ===")
    from skill_router import route
    result = route(
        {"action": "run_pipeline", "params": {}},
        webhook_url=config.SHORTS_WEBHOOK_URL
    )
    log.info(f"daily_pipeline 완료: {result.get('summary', '')}")
    return result


def run_revenue_sync() -> dict:
    log.info("=== revenue_sync 시작 ===")
    from skill_router import route
    result = route(
        {"action": "revenue_sync", "params": {}},
        webhook_url=config.SHORTS_WEBHOOK_URL
    )
    log.info(f"revenue_sync 완료: {result.get('summary', '')}")
    return result


def run_publish() -> dict:
    """예약된 콘텐츠 발행 (상태 업데이트만 — 실제 플랫폼 API 연동 시 확장)."""
    log.info("=== publish 시작 ===")
    import db
    updated = db.execute(
        """UPDATE content SET status='posted', updated_at=datetime('now')
           WHERE status='scheduled'
           AND id IN (
             SELECT content_id FROM scheduled_posts
             WHERE status='pending' AND scheduled_for <= datetime('now')
             LIMIT 20
           )"""
    )
    db.execute(
        """UPDATE scheduled_posts SET status='published', published_at=datetime('now')
           WHERE status='pending' AND scheduled_for <= datetime('now')"""
    )
    summary = f"예약 게시 처리 완료"
    log.info(summary)
    return {"ok": True, "summary": summary}


JOBS = {
    "daily_pipeline": run_daily_pipeline,
    "revenue_sync":   run_revenue_sync,
    "publish":        run_publish,
}


if __name__ == "__main__":
    job = sys.argv[1] if len(sys.argv) > 1 else "daily_pipeline"
    if job not in JOBS:
        log.error(f"알 수 없는 잡: {job}. 가능한 잡: {list(JOBS.keys())}")
        sys.exit(1)

    log.info(f"[scheduler] 잡 시작: {job} ({datetime.now().isoformat()})")
    try:
        result = JOBS[job]()
        print(json.dumps(result, ensure_ascii=False, indent=2))
        log.info(f"[scheduler] 잡 완료: {job}")
    except Exception as e:
        log.exception(f"[scheduler] 잡 실패: {job} — {e}")
        sys.exit(1)
