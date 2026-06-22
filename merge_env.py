#!/usr/bin/env python3
"""vercel pull된 .env.vercel에서 필요한 키를 .env에 안전하게 추가"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
VERCEL_ENV = HERE / ".env.vercel"
LOCAL_ENV  = HERE / ".env"

NEEDED = [
    "SHOTSTACK_API_KEY",
    "SHOTSTACK_STAGE",
    "YOUTUBE_CLIENT_ID",
    "YOUTUBE_CLIENT_SECRET",
    "YOUTUBE_REFRESH_TOKEN",
    "YOUTUBE_CHANNEL_ID",
]

def parse_env(path: Path) -> dict:
    result = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip().lstrip('﻿')
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        # 따옴표 제거 + 실제 \r\n 문자 제거
        val = val.strip().strip('"').strip("'").rstrip('\\r\\n').rstrip()
        if key:
            result[key] = val
    return result

vercel_vars = parse_env(VERCEL_ENV)
local_vars  = parse_env(LOCAL_ENV)

# 기존 bad 줄 제거 (이미 추가됐다면)
original = LOCAL_ENV.read_text(encoding="utf-8-sig")
lines = original.splitlines()
# "# Shotstack + YouTube" 블록 이후를 제거
cutoff = None
for i, l in enumerate(lines):
    if "# Shotstack + YouTube" in l:
        cutoff = i
        break
if cutoff is not None:
    lines = lines[:cutoff]

to_add = []
for key in NEEDED:
    if key not in local_vars and key in vercel_vars and vercel_vars[key]:
        to_add.append(f"{key}={vercel_vars[key]}")
        print(f"  + {key} ({len(vercel_vars[key])}자)")
    elif key not in local_vars:
        print(f"  ! {key} — Vercel에 없거나 빈 값 (수동 입력 필요)")

if to_add:
    lines.append("")
    lines.append("# Shotstack + YouTube (vercel pull)")
    lines.extend(to_add)
    LOCAL_ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n{len(to_add)}개 키 추가 완료")
else:
    LOCAL_ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("추가할 키 없음 (값이 빈 경우 Vercel에서 직접 확인 필요)")
