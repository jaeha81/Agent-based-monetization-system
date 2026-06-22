#!/usr/bin/env python3
"""
vercel env run으로 실행 시 production 환경변수를 .env에 주입.
실행: vercel env run --environment=production -- python -X utf8 inject_vercel_secrets.py
"""
import os
import sys
from pathlib import Path

ENV_PATH = Path(__file__).parent / ".env"

KEYS = [
    "SHOTSTACK_API_KEY",
    "SHOTSTACK_STAGE",
    "YOUTUBE_CLIENT_ID",
    "YOUTUBE_CLIENT_SECRET",
    "YOUTUBE_REFRESH_TOKEN",
    "YOUTUBE_CHANNEL_ID",
]

content = ENV_PATH.read_text(encoding="utf-8")
lines = content.splitlines()

# 기존 키 제거 (빈 값 포함)
existing_keys = set()
for k in KEYS:
    lines = [l for l in lines if not l.startswith(f"{k}=")]

added = []
for k in KEYS:
    val = os.environ.get(k, "")
    if val:
        lines.append(f"{k}={val}")
        added.append(k)
        print(f"  ✓ {k} ({len(val)}자)")
    else:
        print(f"  ✗ {k} — 없음")

ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"\n{len(added)}개 키 주입 완료 → {ENV_PATH}")
