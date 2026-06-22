#!/usr/bin/env python3
"""content 테이블에 렌더/업로드 컬럼 추가"""
import sys; sys.path.insert(0, '.')
import db

cols_to_add = [
    ("render_url",    "TEXT DEFAULT ''"),
    ("render_status", "TEXT DEFAULT ''"),
    ("upload_status", "TEXT DEFAULT ''"),
    ("youtube_url",   "TEXT DEFAULT ''"),
]

existing = db.query("PRAGMA table_info(content)")
existing_names = {r["name"] for r in existing}

for col, definition in cols_to_add:
    if col not in existing_names:
        db.execute(f"ALTER TABLE content ADD COLUMN {col} {definition}")
        print(f"  + {col} 추가")
    else:
        print(f"  = {col} 이미 존재")

print("마이그레이션 완료")
