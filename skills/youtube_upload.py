#!/usr/bin/env python3
"""
youtube_upload.py — YouTube Shorts 업로드
로컬 MP4 → Vercel /api/upload/video (multipart 스트리밍) → YouTube 비공개 업로드
"""
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import config
import db

UPLOAD_URL = f"{config.VERCEL_APP_URL}/api/upload/video"


def _upload_with_requests(content_id: int, mp4_path: str) -> dict:
    """requests 라이브러리로 스트리밍 멀티파트 업로드 (P1-B)."""
    import requests  # pip install requests
    with open(mp4_path, "rb") as f:
        resp = requests.post(
            UPLOAD_URL,
            files={"file": (Path(mp4_path).name, f, "video/mp4")},
            data={"content_id": str(content_id)},
            headers={"Authorization": f"Bearer {config.UPLOAD_SECRET}"},
            timeout=300,
        )
    resp.raise_for_status()
    return resp.json()


def _upload_with_urllib(content_id: int, mp4_path: str) -> dict:
    """requests 미설치 시 urllib fallback (전체 파일 메모리 로드 — 소형 파일 한정)."""
    boundary = "ShortsUp2026xKzW9mBq"
    with open(mp4_path, "rb") as f:
        file_bytes = f.read()
    fname = Path(mp4_path).name.replace('"', '').replace('\r', '').replace('\n', '')
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"content_id\"\r\n\r\n"
        f"{content_id}\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{fname}\"\r\n"
        f"Content-Type: video/mp4\r\n\r\n"
    ).encode() + file_bytes + f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        UPLOAD_URL,
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Authorization": f"Bearer {config.UPLOAD_SECRET}",
        },
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read())


def run(content_id: int, mp4_path: str = "") -> dict:
    """로컬 MP4 → Vercel /api/upload/video → YouTube 비공개 업로드."""
    if not config.UPLOAD_SECRET:
        return {"ok": False, "error": "UPLOAD_SECRET 없음 — .env 확인"}
    if not config.VERCEL_APP_URL:
        return {"ok": False, "error": "VERCEL_APP_URL 없음 — .env 확인"}

    if not mp4_path:
        row = db.query_one(
            "SELECT render_url FROM content WHERE id = ? AND render_status = 'done'",
            [content_id],
        )
        if not row or not row.get("render_url"):
            return {"ok": False, "error": f"content_id={content_id} 렌더 완료 파일 없음"}
        mp4_path = row["render_url"]

    if not mp4_path or not Path(mp4_path).exists():
        return {"ok": False, "error": f"MP4 파일 없음: {mp4_path}"}

    size_mb = Path(mp4_path).stat().st_size / 1024 / 1024
    print(f"[youtube_upload] 업로드 시작: content_id={content_id} / {size_mb:.1f}MB")

    try:
        try:
            data = _upload_with_requests(content_id, mp4_path)
        except ImportError:
            print("[youtube_upload] requests 미설치 → urllib fallback (pip install requests 권장)", file=sys.stderr)
            data = _upload_with_urllib(content_id, mp4_path)
    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="replace")
        return {"ok": False, "error": f"HTTP {e.code}: {body_text[:300]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

    video_url = data.get("url", "") or data.get("video_url", "")
    video_id  = data.get("video_id", "")
    ok        = data.get("ok", bool(video_url or video_id))

    if ok:
        print(f"[youtube_upload] 업로드 완료: {video_url or video_id}")
        db.execute(
            "UPDATE content SET youtube_url = ?, upload_status = 'uploaded' WHERE id = ?",
            [video_url, content_id],
        )

    return {
        "ok": ok,
        "content_id": content_id,
        "url": video_url,
        "video_id": video_id,
        "error": data.get("error", ""),
        "summary": f"YouTube 업로드 {'완료' if ok else '실패'}: {video_url or data.get('error', '')}",
    }
