#!/usr/bin/env python3
"""
skill_router.py — Discord 명령 → 스킬 라우팅
Vercel 대시보드 버튼 → Discord Webhook → discord_bot.py → 여기 → 스킬 실행

명령 형식: [SHORTS_CMD] {"action": "...", "params": {...}}
"""
import json
import sys
import traceback
import urllib.request
from pathlib import Path
from datetime import datetime

# Windows CP949 터미널 인코딩 문제 방지
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf-8-sig"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr.encoding and sys.stderr.encoding.lower() not in ("utf-8", "utf-8-sig"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).parent))
import config
import db

ACTIONS = {
    "run_pipeline",      # 전체 파이프라인 실행
    "product_discovery", # 상품 발굴만
    "content_generation",# 콘텐츠 생성만
    "video_maker",       # 로컬 FFmpeg 영상 생성
    "quality_check",     # 영상 품질 검증
    "youtube_upload",    # YouTube Shorts 업로드 (로컬 MP4)
    "revenue_sync",      # 수익 동기화만
    "evolution",         # 진화 분석만
    "status",            # 현재 잡 상태 조회
}

SHORTS_CMD_PREFIX = "[SHORTS_CMD]"


def parse_command(message_content: str) -> dict | None:
    """Discord 메시지에서 SHORTS_CMD 파싱."""
    content = message_content.strip()
    if not content.startswith(SHORTS_CMD_PREFIX):
        return None
    payload_str = content[len(SHORTS_CMD_PREFIX):].strip()
    try:
        return json.loads(payload_str)
    except json.JSONDecodeError:
        return {"action": payload_str.strip(), "params": {}}


def _send_discord_status(webhook_url: str, message: str) -> None:
    """실행 결과를 Discord로 전송."""
    if not webhook_url:
        return
    try:
        payload = json.dumps({"content": message}).encode()
        req = urllib.request.Request(
            webhook_url, data=payload,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "ShortsAgent/1.0",
            }
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        print(f"[skill_router] Discord 알림 실패: {e}", file=sys.stderr)


def _log_job(action: str, status: str, result: str = "") -> None:
    """workflow_jobs 테이블에 실행 기록."""
    try:
        db.execute(
            """INSERT OR IGNORE INTO workflow_jobs
               (workflow_name, node_type, status, created_at, updated_at)
               VALUES (?, ?, ?, datetime('now'), datetime('now'))""",
            [action, "local_skill", status]
        )
    except Exception:
        pass


def route(command: dict, webhook_url: str = "") -> dict:
    """명령을 해당 스킬로 라우팅."""
    action = command.get("action", "")
    params = command.get("params", {})

    if action not in ACTIONS:
        msg = f"⚠️ 알 수 없는 shorts 명령: `{action}`\n가능한 명령: {', '.join(sorted(ACTIONS))}"
        _send_discord_status(webhook_url, msg)
        return {"ok": False, "error": msg}

    if action == "status":
        jobs = db.query(
            "SELECT workflow_name, status, created_at FROM workflow_jobs ORDER BY id DESC LIMIT 10"
        )
        status_text = "\n".join(f"- `{j['workflow_name']}` → {j['status']} ({j['created_at']})" for j in jobs)
        msg = f"📊 **Shorts 잡 현황**\n{status_text or '실행 기록 없음'}"
        _send_discord_status(webhook_url, msg)
        return {"ok": True, "jobs": jobs}

    _log_job(action, "running")
    _send_discord_status(webhook_url, f"⚙️ **[SHORTS]** `{action}` 시작...")

    try:
        result = _dispatch(action, params)
        _log_job(action, "completed", str(result.get("summary", "")))
        summary = result.get("summary", "완료")
        _send_discord_status(webhook_url, f"✅ **[SHORTS]** `{action}` 완료\n{summary}")
        return result
    except Exception as e:
        tb = traceback.format_exc()
        _log_job(action, "failed", str(e))
        _send_discord_status(webhook_url, f"❌ **[SHORTS]** `{action}` 실패: {e}")
        print(f"[skill_router] {action} 실패:\n{tb}", file=sys.stderr)
        return {"ok": False, "error": str(e)}


def _dispatch(action: str, params: dict) -> dict:
    if action == "run_pipeline":
        return _run_full_pipeline(params)

    if action == "product_discovery":
        from skills.product_discovery import run as pd_run
        return pd_run(keyword=params.get("keyword", ""), top_n=params.get("top_n", 3))

    if action == "content_generation":
        from skills.content_generation import run as cg_run
        pid = params.get("product_id")
        if not pid:
            # 미발굴 상품 자동 선택
            p = db.query_one("SELECT id, name, category FROM products ORDER BY viral_score DESC LIMIT 1")
            if not p:
                return {"ok": False, "error": "상품 없음. product_discovery 먼저 실행하세요."}
            pid, pname, pcat = p["id"], p["name"], p["category"]
        else:
            p = db.query_one("SELECT name, category FROM products WHERE id=?", [pid])
            pname = p["name"] if p else "Unknown"
            pcat = p["category"] if p else "기타"
        return cg_run(pid, pname, pcat)

    if action == "video_maker":
        from skills.video_maker import make_video
        content_id = params.get("content_id")
        if not content_id:
            row = db.query_one("SELECT id FROM content WHERE platform='YouTube' AND (render_status IS NULL OR render_status='') ORDER BY created_at DESC LIMIT 1")
            if not row:
                return {"ok": False, "error": "영상 생성할 YouTube 콘텐츠 없음"}
            content_id = row["id"]
        return make_video(int(content_id))

    if action == "quality_check":
        from skills.quality_check import check as qc_check
        mp4_path = params.get("mp4_path", "")
        if not mp4_path:
            row = db.query_one("SELECT render_url FROM content WHERE render_status='done' ORDER BY created_at DESC LIMIT 1")
            if not row or not row.get("render_url"):
                return {"ok": False, "error": "검사할 MP4 없음"}
            mp4_path = row["render_url"]
        result = qc_check(mp4_path)
        return {**result, "ok": result.get("pass", False)}

    if action == "youtube_upload":
        from skills.youtube_upload import run as yu_run
        content_id = params.get("content_id")
        mp4_path   = params.get("mp4_path", "")
        if not content_id:
            row = db.query_one("SELECT id, render_url FROM content WHERE render_status='done' AND (upload_status IS NULL OR upload_status='') ORDER BY created_at DESC LIMIT 1")
            if not row:
                return {"ok": False, "error": "업로드할 렌더 완료 콘텐츠 없음"}
            content_id = row["id"]
            mp4_path   = row.get("render_url", "")
        return yu_run(int(content_id), mp4_path)

    if action == "revenue_sync":
        from skills.revenue_sync import run as rv_run
        return rv_run()

    if action == "evolution":
        from skills.evolution import run as ev_run
        return ev_run()

    return {"ok": False, "error": f"미구현 액션: {action}"}


def _run_full_pipeline(params: dict) -> dict:
    """전체 파이프라인:
    evolution → product_discovery → content_generation (YouTube 1개)
    → video_maker → quality_check → youtube_upload (로컬 MP4) → revenue_sync
    """
    results = {}

    # 1. Evolution
    from skills.evolution import run as ev_run
    evo = ev_run()
    results["evolution"] = evo

    # 2. 상품 발굴
    from skills.product_discovery import run as pd_run
    disc = pd_run(keyword=evo.get("next_keyword", ""), top_n=3)
    results["product_discovery"] = disc

    product_ids = disc.get("product_ids", [])
    if not product_ids:
        top = db.query("SELECT id FROM products ORDER BY viral_score DESC LIMIT 3")
        product_ids = [r["id"] for r in top]

    # 3. 콘텐츠 생성 — YouTube 1개 상품만
    from skills.content_generation import run as cg_run
    target_pid = product_ids[0] if product_ids else None
    youtube_content_id = None

    if target_pid:
        p = db.query_one("SELECT name, category, coupang_url FROM products WHERE id=?", [target_pid])
        if p:
            cg = cg_run(
                target_pid, p["name"], p["category"],
                affiliate_url=p.get("coupang_url", ""),
                evolution_insight=evo.get("insights", ""),
            )
            results["content_generation"] = cg
            yt_row = db.query_one(
                "SELECT id FROM content WHERE platform='YouTube' AND product_id=? ORDER BY created_at DESC LIMIT 1",
                [target_pid],
            )
            if yt_row:
                youtube_content_id = yt_row["id"]

    if not youtube_content_id:
        results["youtube_pipeline"] = {"skipped": "YouTube 콘텐츠 생성 실패"}
        from skills.revenue_sync import run as rv_run
        results["revenue_sync"] = rv_run()
        return {"ok": False, "summary": "콘텐츠 생성 실패", "details": results}

    # 4. 로컬 영상 생성
    _send_discord_status(config.SHORTS_WEBHOOK_URL, f"🎬 영상 생성 중... (content_id={youtube_content_id})")
    from skills.video_maker import make_video
    vm = make_video(int(youtube_content_id))
    results["video_maker"] = vm

    if not vm.get("ok"):
        _send_discord_status(config.SHORTS_WEBHOOK_URL, f"❌ 영상 생성 실패: {vm.get('error')}")
        from skills.revenue_sync import run as rv_run
        results["revenue_sync"] = rv_run()
        return {"ok": False, "summary": f"영상 생성 실패: {vm.get('error')}", "details": results}

    mp4_path = vm.get("mp4_path", "")

    # 5. 품질 검증 (최대 2회 시도)
    from skills.quality_check import check as qc_check
    qc = qc_check(mp4_path)
    results["quality_check"] = qc

    if not qc.get("pass") and mp4_path:
        _send_discord_status(
            config.SHORTS_WEBHOOK_URL,
            f"⚠️ 품질 검증 실패 — 재생성 시도\n문제: {'; '.join(qc.get('issues', [])[:2])}"
        )
        # 1회 재시도
        import shutil
        failed_path = mp4_path.replace(".mp4", "_failed.mp4")
        try:
            shutil.move(mp4_path, failed_path)
        except Exception:
            pass
        # Codex#3: render_url도 함께 초기화 (실패한 경로가 DB에 남지 않도록)
        db.execute("UPDATE content SET render_status=NULL, render_url=NULL WHERE id=?", [youtube_content_id])
        vm2 = make_video(int(youtube_content_id))
        results["video_maker_retry"] = vm2
        if vm2.get("ok"):
            mp4_path = vm2.get("mp4_path", "")
            qc2 = qc_check(mp4_path)
            results["quality_check_retry"] = qc2
            if not qc2.get("pass"):
                _send_discord_status(
                    config.SHORTS_WEBHOOK_URL,
                    f"❌ 품질 검증 2회 실패 — 업로드 건너뜀\n{'; '.join(qc2.get('issues', [])[:2])}"
                )
                from skills.revenue_sync import run as rv_run
                results["revenue_sync"] = rv_run()
                return {"ok": False, "summary": "품질 검증 2회 실패", "details": results}

    # 6. YouTube 업로드 (1개, 비공개)
    if config.UPLOAD_SECRET:
        # P0-C: mp4_path 존재 검증 — Path("").stat() OSError 방지
        if not mp4_path or not Path(mp4_path).exists():
            _send_discord_status(config.SHORTS_WEBHOOK_URL, f"❌ 업로드 중단: MP4 파일 없음 ({mp4_path!r})")
            from skills.revenue_sync import run as rv_run
            results["revenue_sync"] = rv_run()
            return {"ok": False, "summary": "MP4 파일 없음 — 업로드 건너뜀", "details": results}
        # Codex#7: 정수 나누기 → 부동소수점으로 수정 (0MB 표시 방지)
        size_mb = Path(mp4_path).stat().st_size / 1024 / 1024
        _send_discord_status(config.SHORTS_WEBHOOK_URL, f"📤 YouTube 업로드 중... ({size_mb:.1f}MB)")
        from skills.youtube_upload import run as yu_run
        yu = yu_run(int(youtube_content_id), mp4_path)
        results["youtube_pipeline"] = yu
        if yu.get("ok"):
            _send_discord_status(
                config.SHORTS_WEBHOOK_URL,
                f"✅ YouTube Shorts 업로드 완료!\n{yu.get('url') or yu.get('video_id')}"
            )
        else:
            _send_discord_status(
                config.SHORTS_WEBHOOK_URL,
                f"⚠️ YouTube 업로드 실패: {yu.get('error')}"
            )
    else:
        results["youtube_pipeline"] = {"skipped": "UPLOAD_SECRET 없음"}

    # 7. 수익 동기화
    from skills.revenue_sync import run as rv_run
    results["revenue_sync"] = rv_run()

    summary = (
        f"파이프라인 완료 — "
        f"영상 생성 {vm.get('summary', '')} / "
        f"품질 {'통과' if qc.get('pass') else '실패'} / "
        f"수익 +₩{results['revenue_sync'].get('revenue_added', 0):,}"
    )
    return {"ok": True, "summary": summary, "details": results}


if __name__ == "__main__":
    # 직접 실행: python skill_router.py run_pipeline
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    params = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    result = route({"action": action, "params": params}, webhook_url=config.SHORTS_WEBHOOK_URL)
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False, indent=2).encode("utf-8"))
    sys.stdout.buffer.write(b"\n")
