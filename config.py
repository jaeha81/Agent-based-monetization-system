#!/usr/bin/env python3
"""
config.py — shorts-local-agent 환경 설정
.env 파일 로드 + 공통 경로/상수 정의
"""
import os
import sys
from pathlib import Path

# ── .env 로드 ─────────────────────────────────────────────────────────────────
_HERE = Path(__file__).parent

def _load_env(path: Path) -> None:
    if not path.exists():
        return
    for enc in ("utf-8-sig", "utf-8", "cp949", "latin-1"):
        try:
            text = path.read_text(encoding=enc)
            break
        except (UnicodeDecodeError, LookupError):
            continue
    else:
        return
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip().lstrip('﻿')
        val = val.strip().strip('"').strip("'").lstrip('﻿')
        if key and key not in os.environ:
            os.environ[key] = val

# 로컬 .env (shorts-local-agent/.env) 우선, 없으면 대시보드 .env 참조
_load_env(_HERE / ".env")
_load_env(_HERE.parent / "shorts-dashboard" / ".env")

# ── 경로 ────────────────────────────────────────────────────────────────────
AGENT_ROOT   = _HERE
SKILLS_DIR   = _HERE / "skills"
LOGS_DIR     = _HERE / "logs"
LOGS_DIR.mkdir(exist_ok=True)

BRAIN_ROOT   = Path(os.getenv("BRAIN_ROOT", r"G:\내 드라이브\obsidian-agent-brain-system"))
CLAUDE_CMD   = os.getenv("CLAUDE_COMMAND", "claude.cmd")

# ── Turso DB ─────────────────────────────────────────────────────────────────
TURSO_URL    = os.getenv("TURSO_DATABASE_URL", "")
TURSO_TOKEN  = os.getenv("TURSO_AUTH_TOKEN", "")

# ── Discord ───────────────────────────────────────────────────────────────────
SHORTS_WEBHOOK_URL    = os.getenv("SHORTS_DISCORD_WEBHOOK", "")
SHORTS_CHANNEL_ID     = os.getenv("JH_SHORTS_CHANNEL_ID", "")

# ── AI APIs ──────────────────────────────────────────────────────────────────
GEMINI_API_KEY    = os.getenv("GEMINI_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
STABILITY_API_KEY = os.getenv("STABILITY_API_KEY", "").replace("﻿", "").strip()
OPENAI_API_KEY    = os.getenv("OPENAI_API_KEY", "")

# ── 로컬 영상 생성 ────────────────────────────────────────────────────────────
FONT_PATH = os.getenv("FONT_PATH", r"C:\Windows\Fonts\malgunbd.ttf")
BGM_PATH  = os.getenv("BGM_PATH", str(_HERE / "assets" / "bgm.mp3"))

# ── Vercel 업로드 트리거 ──────────────────────────────────────────────────────
UPLOAD_SECRET   = os.getenv("UPLOAD_SECRET", "")
VERCEL_APP_URL  = os.getenv("VERCEL_APP_URL", "https://shorts-dashboard-one.vercel.app")

# ── YouTube OAuth (로컬 직접 업로드용) ───────────────────────────────────────
YOUTUBE_CLIENT_ID     = os.getenv("YOUTUBE_CLIENT_ID", "")
YOUTUBE_CLIENT_SECRET = os.getenv("YOUTUBE_CLIENT_SECRET", "")
YOUTUBE_REFRESH_TOKEN = os.getenv("YOUTUBE_REFRESH_TOKEN", "")

# ── Coupang ───────────────────────────────────────────────────────────────────
COUPANG_CHANNEL_ID = os.getenv("COUPANG_CHANNEL_ID", "AF5520196")

# ── 검증 ──────────────────────────────────────────────────────────────────────
def require(*keys: str) -> None:
    missing = [k for k in keys if not os.getenv(k)]
    if missing:
        print(f"[config] 필수 환경변수 누락: {missing}", file=sys.stderr)
        sys.exit(1)
