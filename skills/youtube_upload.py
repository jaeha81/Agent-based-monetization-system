#!/usr/bin/env python3
"""
youtube_upload.py — YouTube Shorts 업로드
우선순위: 로컬 직접 업로드 (YOUTUBE_CLIENT_ID 있을 때) → Vercel /api/upload/video 경유
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import config
import db

_VERCEL_UPLOAD_URL = f"{config.VERCEL_APP_URL}/api/upload/video"
_TOKEN_URL = "https://oauth2.googleapis.com/token"
_UPLOAD_BASE = "https://www.googleapis.com/upload/youtube/v3/videos"
_VIDEO_URL_BASE = "https://www.googleapis.com/youtube/v3/videos"


# ── OAuth ─────────────────────────────────────────────────────────────────────

def _get_access_token() -> str:
    data = urllib.parse.urlencode({
        "client_id":     config.YOUTUBE_CLIENT_ID,
        "client_secret": config.YOUTUBE_CLIENT_SECRET,
        "refresh_token": config.YOUTUBE_REFRESH_TOKEN,
        "grant_type":    "refresh_token",
    }).encode()
    req = urllib.request.Request(
        _TOKEN_URL, data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())["access_token"]


# ── 직접 업로드 (Vercel 우회) ─────────────────────────────────────────────────

def direct_upload(content_id: int, mp4_path: str, title: str = "", description: str = "") -> dict:
    """로컬 MP4 → YouTube Data API v3 resumable upload."""
    if not all([config.YOUTUBE_CLIENT_ID, config.YOUTUBE_CLIENT_SECRET, config.YOUTUBE_REFRESH_TOKEN]):
        return {"ok": False, "error": "YOUTUBE_* 환경변수 없음"}

    mp4 = Path(mp4_path)
    if not mp4.exists():
        return {"ok": False, "error": f"MP4 없음: {mp4_path}"}

    size_bytes = mp4.stat().st_size
    size_mb = size_bytes / 1024 / 1024
    print(f"[youtube_upload] 직접 업로드 시작: content_id={content_id} / {size_mb:.1f}MB")

    try:
        access_token = _get_access_token()
    except Exception as e:
        return {"ok": False, "error": f"access_token 획득 실패: {e}"}

    # 1. Resumable upload 세션 초기화
    if not title:
        title = f"YouTube Shorts #{content_id}"
    snippet = {
        "title": title[:100],
        "description": description[:4000] if description else "쇼핑 숏츠",
        "tags": ["쇼핑", "할인", "추천", "Shorts"],
        "categoryId": "22",  # People & Blogs
    }
    metadata = json.dumps({
        "snippet": snippet,
        "status": {"privacyStatus": "private", "selfDeclaredMadeForKids": False},
    }).encode()

    init_req = urllib.request.Request(
        f"{_UPLOAD_BASE}?uploadType=resumable&part=snippet,status",
        data=metadata,
        headers={
            "Authorization":       f"Bearer {access_token}",
            "Content-Type":        "application/json; charset=UTF-8",
            "X-Upload-Content-Type":   "video/mp4",
            "X-Upload-Content-Length": str(size_bytes),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(init_req, timeout=30) as r:
            upload_url = r.headers.get("Location")
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        return {"ok": False, "error": f"세션 초기화 HTTP {e.code}: {body[:300]}"}

    if not upload_url:
        return {"ok": False, "error": "upload URL 없음"}

    # 2. 파일 전송 (단일 PUT — 로컬이므로 크기 제한 없음)
    print(f"[youtube_upload] 업로드 세션 확보, 전송 중...")
    try:
        with open(mp4_path, "rb") as f:
            file_data = f.read()
        put_req = urllib.request.Request(
            upload_url,
            data=file_data,
            headers={
                "Authorization":  f"Bearer {access_token}",
                "Content-Type":   "video/mp4",
                "Content-Length": str(size_bytes),
            },
            method="PUT",
        )
        with urllib.request.urlopen(put_req, timeout=600) as resp:
            result = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        # 308 Resume Incomplete는 성공 중간 상태 — 여기서는 단일 PUT이므로 실패로 처리
        return {"ok": False, "error": f"업로드 HTTP {e.code}: {body[:300]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

    video_id = result.get("id", "")
    if not video_id:
        return {"ok": False, "error": f"video_id 없음: {result}"}

    video_url = f"https://youtube.com/shorts/{video_id}"
    print(f"[youtube_upload] 완료: {video_url}")
    return {"ok": True, "video_id": video_id, "url": video_url}


# ── Vercel 경유 업로드 (fallback) ─────────────────────────────────────────────

def _upload_via_vercel(content_id: int, mp4_path: str) -> dict:
    try:
        import requests
        with open(mp4_path, "rb") as f:
            resp = requests.post(
                _VERCEL_UPLOAD_URL,
                files={"file": (Path(mp4_path).name, f, "video/mp4")},
                data={"content_id": str(content_id)},
                headers={"Authorization": f"Bearer {config.UPLOAD_SECRET}"},
                timeout=300,
            )
        resp.raise_for_status()
        return resp.json()
    except ImportError:
        pass

    # urllib fallback
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
        _VERCEL_UPLOAD_URL, data=body,
        headers={
            "Content-Type":  f"multipart/form-data; boundary={boundary}",
            "Authorization": f"Bearer {config.UPLOAD_SECRET}",
        },
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read())


# ── 공통 진입점 ───────────────────────────────────────────────────────────────

def run(content_id: int, mp4_path: str = "", title: str = "", description: str = "") -> dict:
    """MP4 → YouTube 업로드. YOUTUBE_* 있으면 직접, 없으면 Vercel 경유."""
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

    # 직접 업로드 우선
    if config.YOUTUBE_CLIENT_ID:
        data = direct_upload(content_id, mp4_path, title=title, description=description)
    else:
        # Vercel 경유 (413 위험 있음)
        if not config.UPLOAD_SECRET or not config.VERCEL_APP_URL:
            return {"ok": False, "error": "YOUTUBE_* 또는 UPLOAD_SECRET 없음 — .env 확인"}
        try:
            data = _upload_via_vercel(content_id, mp4_path)
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            return {"ok": False, "error": f"Vercel HTTP {e.code}: {body[:300]}"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    video_url = data.get("url", "") or data.get("video_url", "")
    video_id  = data.get("video_id", "")
    ok        = data.get("ok", False)

    if ok:
        db.execute(
            "UPDATE content SET youtube_url = ?, upload_status = 'uploaded' WHERE id = ?",
            [video_url, content_id],
        )
        print(f"[youtube_upload] DB 업데이트 완료: content_id={content_id} → {video_url}")

    return {
        "ok":        ok,
        "content_id": content_id,
        "url":       video_url,
        "video_id":  video_id,
        "error":     data.get("error", ""),
        "summary":   f"YouTube 업로드 {'완료' if ok else '실패'}: {video_url or data.get('error', '')}",
    }
